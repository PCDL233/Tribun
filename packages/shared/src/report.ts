import { z } from 'zod';
import { FindingSchema } from './finding.js';

/** 报告元信息 schema（对齐方案 3.8 五段式报告的"元信息"段与 reviews 表） */
export const ReviewMetaSchema = z.object({
  reviewId: z.string(),
  repoPath: z.string(),
  branch: z.string(),
  commitHash: z.string().optional(),
  author: z.string().optional(),
  /** 如 "claude-sonnet-4.5 + 静态分析" 或 "mock + 静态分析" */
  model: z.string(),
  mode: z.enum(['fast', 'full']),
  /** 0-100 综合风险评分 */
  riskScore: z.number(),
  durationMs: z.number(),
  tokenUsed: z.number(),
});
export type ReviewMeta = z.infer<typeof ReviewMetaSchema>;

/** 五段式报告整体 schema：Markdown/JSON 两种渲染与 API 响应共享同一数据源（方案 3.8） */
export const ReviewReportSchema = z.object({
  meta: ReviewMetaSchema,
  /** 第 1 段：变更概述 */
  summary: z.string(),
  /** 第 2 段：发现的问题（已去重排序） */
  findings: z.array(FindingSchema),
  /** 第 3 段：代码质量考量 */
  qualityNotes: z.array(z.string()),
  /** 第 4 段：改进建议 */
  suggestions: z.array(z.string()),
  /** 第 5 段：总体评估 */
  assessment: z.string(),
  /** 预算受限降级标注（非空时报告附加说明） */
  degradedToStatic: z.array(z.string()),
});
export type ReviewReport = z.infer<typeof ReviewReportSchema>;
