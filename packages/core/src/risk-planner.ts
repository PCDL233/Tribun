import type { FileDiff, FileHistory, ReviewPlan, ScoredFile } from '@ai-review/shared';

/** 高风险路径特征：认证、支付、数据访问等（大小写不敏感，方案 3.2） */
const HIGH_RISK_PATTERNS: RegExp[] = [
  /auth/,
  /login/,
  /password/,
  /token/,
  /secret/,
  /permission/,
  /payment/,
  /billing/,
  /admin/,
  /sql/,
  /query/,
  /execute/,
  /eval/,
];

/** 删除行中的高风险信号：移除错误处理/校验是典型危险变更（方案 3.2 维度 ③） */
const REMOVED_GUARD_PATTERNS: RegExp[] = [
  /\b(try|except|catch|finally|rollback)\b/,
  /\b(validate|sanitize|escape|checkPermission|requireUser)\b/,
];

/** 风险分流阈值：≥60 深度 LLM 审查（方案 3.2） */
const DEEP_THRESHOLD = 60;
/** 快速审查下限：40~60 快速 LLM 审查，<40 仅静态分析（方案 3.2） */
const QUICK_THRESHOLD = 40;

function isTestOrDocs(path: string): boolean {
  return (
    /(^|[/\\])(tests?|spec|__tests__)([/\\]|$)/.test(path) ||
    /(^|[/\\])docs?[/\\]/.test(path) ||
    /\.(md|mdx|txt|rst)$/i.test(path)
  );
}

function isFormattingOnly(diff: FileDiff): boolean {
  return (
    diff.changedLines.length > 0 &&
    diff.changedLines.every((line) => line.content.trim().length === 0)
  );
}

/**
 * 确定性风险规划器（方案 3.2 Deterministic Planner）：
 * 对每个变更文件评分分流，将 LLM 注意力集中在高风险区域，减少 token 浪费。
 */
export class RiskPlanner {
  constructor(private readonly history: FileHistory) {}

  /**
   * 评分并分流全部变更文件。
   * @param diffs 过滤后的文件 diff（score 降序排列后按阈值分桶）
   * @returns deep / quick / staticOnly 三桶审查计划
   */
  public async plan(diffs: readonly FileDiff[]): Promise<ReviewPlan> {
    const scored: ScoredFile[] = [];

    for (const diff of diffs) {
      let score = 0;
      const path = diff.path.toLowerCase();

      // ① 路径风险：命中认证/支付等敏感路径 +30（魔法数值来源：方案 3.2 风险评估规则）
      if (HIGH_RISK_PATTERNS.some((pattern) => pattern.test(path))) score += 30;

      // ② 变更规模：>100 行 +25，>30 行 +15
      const changed = diff.additions + diff.deletions;
      if (changed > 100) score += 25;
      else if (changed > 30) score += 15;

      // ③ 删除守卫逻辑 +20（删除错误处理是高风险信号）
      if (diff.removedLines.some((line) => REMOVED_GUARD_PATTERNS.some((p) => p.test(line)))) {
        score += 20;
      }

      // ④ 文件热度：近 30 天修改次数 > 5 +15
      if ((await this.history.changeFrequency(diff.path, 30)) > 5) score += 15;

      // ⑤ 测试/文档/纯格式化降权 -25，下限 0（降权后不再叠加其他维度）
      if (isTestOrDocs(path) || isFormattingOnly(diff)) score = Math.max(0, score - 25);

      scored.push({ diff, score: Math.min(score, 100) });
    }

    scored.sort((a, b) => b.score - a.score);
    return {
      deep: scored.filter((s) => s.score >= DEEP_THRESHOLD),
      quick: scored.filter((s) => s.score >= QUICK_THRESHOLD && s.score < DEEP_THRESHOLD),
      staticOnly: scored.filter((s) => s.score < QUICK_THRESHOLD),
    };
  }
}

/**
 * 计划内最高文件风险分，作为报告的综合风险评分（reviews.risk_score，0-100）。
 * @param plan 审查计划
 * @returns 最高文件风险分；空计划为 0
 */
export function getMaxRiskScore(plan: ReviewPlan): number {
  const all = [...plan.deep, ...plan.quick, ...plan.staticOnly];
  return all.reduce((max, file) => Math.max(max, file.score), 0);
}
