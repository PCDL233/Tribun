import { SEVERITY_RANK } from '@ai-review/shared';
import type { CodeContext, Finding } from '@ai-review/shared';

/** 静态分析发现的确定性来源决定高基础置信度（方案 3.6 阶段 2） */
const STATIC_BASE_CONFIDENCE = 0.9;
/** LLM 语义发现的基础置信度上限：语义判断本质不确定（方案 3.6 阶段 2） */
const LLM_BASE_CONFIDENCE = 0.6;
/** 多源交叉确认加成：另一维度 Agent 在同文件同区间给出发现（方案 3.6 阶段 2） */
const CROSS_SOURCE_BONUS = 0.2;

function overlaps(a: Finding, b: Finding): boolean {
  return a.lineStart <= b.lineEnd && b.lineStart <= a.lineEnd;
}

/**
 * 阶段 1：严重度重分类（方案 3.6）。
 * 测试/文档文件中的高危发现降级为 NIT——例如测试文件中的硬编码值。
 */
export function reclassifySeverity(findings: readonly Finding[], context: CodeContext): Finding[] {
  const lowStakesPaths = new Set(
    context.files
      .filter((file) => file.changeType === 'test' || file.changeType === 'docs')
      .map((file) => file.diff.path),
  );
  return findings.map((finding) => {
    if (
      !lowStakesPaths.has(finding.filePath) ||
      SEVERITY_RANK[finding.severity] <= SEVERITY_RANK.NIT
    ) {
      return finding;
    }
    return {
      ...finding,
      severity: 'NIT' as const,
      description: `${finding.description} (severity reclassified: finding is in a test or docs file)`,
    };
  });
}

/**
 * 阶段 2：置信度评分（方案 3.6）。
 * 按确定性来源设定基准：静态分析 0.9、LLM 语义 0.6；多源交叉确认在基准上 +0.2；
 * 无交叉确认时不超过 Provider 给出的置信度且不超过基准——既压制 LLM 过度自信，
 * 又保留其 LOW_CONFIDENCE 低分信号（自愈回退依赖低置信度触发）。
 */
export function scoreConfidence(findings: readonly Finding[]): Finding[] {
  return findings.map((finding) => {
    const base = finding.agent === 'static' ? STATIC_BASE_CONFIDENCE : LLM_BASE_CONFIDENCE;
    const crossConfirmed = findings.some(
      (other) =>
        other !== finding &&
        other.agent !== finding.agent &&
        other.filePath === finding.filePath &&
        overlaps(other, finding),
    );
    const confidence = crossConfirmed
      ? Math.min(1, base + CROSS_SOURCE_BONUS)
      : Math.min(finding.confidence, base);
    return { ...finding, confidence };
  });
}

/**
 * 阶段 5：去重（方案 3.6）。
 * 按"文件 + Agent 维度 + 标题 + 行区间重叠"聚类；同簇保留后写入的版本——
 * 交叉验证修正与自愈回退的重审结果由此覆盖流水线早期的原始发现，
 * 而并行分支（不同 Agent 维度）落在不同簇内互不影响。
 */
export function dedupeFindings(findings: readonly Finding[]): Finding[] {
  const clusters = new Map<string, Finding[]>();
  for (const finding of findings) {
    const key = `${finding.filePath}::${finding.agent}::${finding.title}`;
    const group = clusters.get(key) ?? [];
    const overlappingIndex = group.findIndex((existing) => overlaps(existing, finding));
    if (overlappingIndex === -1) {
      group.push(finding);
    } else {
      group[overlappingIndex] = finding;
    }
    clusters.set(key, group);
  }
  return [...clusters.values()].flat();
}

/**
 * 阶段 5：排序（方案 3.6）。
 * 按"严重度 × 置信度"降序，同分按文件与行号升序保证输出确定性。
 */
export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const bySeverity = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (bySeverity !== 0) return bySeverity;
    const byConfidence = b.confidence - a.confidence;
    if (byConfidence !== 0) return byConfidence;
    const byPath = a.filePath.localeCompare(b.filePath);
    if (byPath !== 0) return byPath;
    return a.lineStart - b.lineStart;
  });
}

/**
 * 交叉验证入口（方案 3.6）：阶段 1 重分类 → 阶段 2 置信度 → 阶段 5 去重排序。
 * 阶段 3（跨文件分析）与阶段 4（自动修复建议）依赖 ts-morph 编译级核对与
 * ESLint 规则元数据，在后续里程碑接入；接入后插入本组合序列。
 */
export function crossValidate(findings: readonly Finding[], context: CodeContext): Finding[] {
  return sortFindings(dedupeFindings(scoreConfidence(reclassifySeverity(findings, context))));
}
