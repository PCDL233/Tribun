import type { Finding } from './finding.js';

/** 报告元信息（对齐方案 3.8 五段式报告的"元信息"段与 reviews 表） */
export type ReviewMeta = {
  reviewId: string;
  repoPath: string;
  branch: string;
  commitHash?: string | undefined;
  author?: string | undefined;
  /** 如 "claude-sonnet-4.5 + 静态分析" 或 "mock + 静态分析" */
  model: string;
  mode: 'fast' | 'full';
  /** 0-100 综合风险评分 */
  riskScore: number;
  durationMs: number;
  tokenUsed: number;
};

/**
 * 报告的类型化数据源：Markdown/JSON 两种渲染共享同一对象（方案 3.8）。
 * 五段式 = summary / findings / qualityNotes / suggestions / assessment。
 */
export type ReviewReport = {
  meta: ReviewMeta;
  /** 第 1 段：变更概述 */
  summary: string;
  /** 第 2 段：发现的问题（已去重排序） */
  findings: Finding[];
  /** 第 3 段：代码质量考量 */
  qualityNotes: string[];
  /** 第 4 段：改进建议 */
  suggestions: string[];
  /** 第 5 段：总体评估 */
  assessment: string;
  /** 预算受限降级标注（非空时报告附加说明） */
  degradedToStatic: string[];
};
