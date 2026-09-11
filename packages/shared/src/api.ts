import { z } from 'zod';
import { FindingSchema } from './finding.js';
import { ReviewReportSchema } from './report.js';

/**
 * —— API 契约（方案 2.3：前端零手工类型，全部推导自 shared）——
 * 本文件是 @ai-review/server 的 REST/SSE 响应形状与 @ai-review/web 的消费端的单一事实源。
 */

/** 附带数据库行 id 的发现——误报标记 API 的目标（Finding 契约本身不含 id） */
export const IdentifiedFindingSchema = FindingSchema.extend({
  id: z.number().int().positive(),
});
export type IdentifiedFinding = z.infer<typeof IdentifiedFindingSchema>;

/** 审查历史列表项（Dashboard 列表页行模型，方案 3.10 页面 1） */
export const ReviewListItemSchema = z.object({
  reviewId: z.string(),
  repoPath: z.string(),
  branch: z.string(),
  model: z.string(),
  mode: z.enum(['fast', 'full']),
  /** 0-100 综合风险评分 */
  riskScore: z.number(),
  totalFindings: z.number().int(),
  blockerCount: z.number().int(),
  warningCount: z.number().int(),
  nitCount: z.number().int(),
  tokenUsed: z.number().int(),
  durationMs: z.number().int(),
  createdAt: z.string(),
});
export type ReviewListItem = z.infer<typeof ReviewListItemSchema>;

/** 报告详情：ReviewReport 的 findings 替换为带行 id 的版本（isFalsePositive 以落库值为准） */
export const ReviewReportDetailSchema = ReviewReportSchema.extend({
  findings: z.array(IdentifiedFindingSchema),
});
export type ReviewReportDetail = z.infer<typeof ReviewReportDetailSchema>;

/**
 * 审查进度事件（SSE，方案 3.9 → Dashboard 实时进度条）。
 * `stage` 为流水线节点名（parse/riskPlan/correctness/security/performance/static/validate/heal/report）。
 */
export const ReviewStageEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('stage'), reviewId: z.string(), stage: z.string() }),
  z.object({
    type: z.literal('completed'),
    reviewId: z.string(),
    riskScore: z.number(),
    blockerCount: z.number(),
    /** 是否达到阻断阈值（等价于 CLI 退出码 1 的语义） */
    blocking: z.boolean(),
  }),
  z.object({ type: z.literal('failed'), reviewId: z.string(), message: z.string() }),
]);
export type ReviewStageEvent = z.infer<typeof ReviewStageEventSchema>;

/** —— REST 响应包装 —— */

/** POST /api/reviews → 202 */
export const StartReviewResponseSchema = z.object({ reviewId: z.string() });
/** GET /api/reviews */
export const ReviewListResponseSchema = z.object({ reviews: z.array(ReviewListItemSchema) });
/** PATCH /api/findings/:id → 200 */
export const FalsePositiveResponseSchema = z.object({ updated: z.boolean() });
