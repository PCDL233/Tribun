import {
  FalsePositiveResponseSchema,
  ReviewListResponseSchema,
  ReviewReportDetailSchema,
  StartReviewResponseSchema,
} from '@ai-review/shared/api';
import type { ReviewListItem, ReviewReportDetail } from '@ai-review/shared/api';
import { parseResponse } from './parse-response.js';

const API_BASE = '/api';

/** 查询审查历史（方案 3.10 页面 1：列表 + 风险分/BLOCKER 计数行内展示） */
export async function fetchReviews(): Promise<ReviewListItem[]> {
  const body = await parseResponse(ReviewListResponseSchema, await fetch(`${API_BASE}/reviews`));
  return body.reviews;
}

/** 查询报告详情（五段式 + 行级 findings，方案 3.10 页面 2） */
export async function fetchReviewDetail(reviewId: string): Promise<ReviewReportDetail> {
  return parseResponse(
    ReviewReportDetailSchema,
    await fetch(`${API_BASE}/reviews/${encodeURIComponent(reviewId)}`),
  );
}

/** 发起一次审查（后台执行，进度经 SSE 订阅） */
export async function startReview(repoPath: string, mode: 'fast' | 'full'): Promise<string> {
  const response = await fetch(`${API_BASE}/reviews`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ repoPath, mode }),
  });
  const body = await parseResponse(StartReviewResponseSchema, response);
  return body.reviewId;
}

/** 误报标记回写（方案 3.10：乐观更新后调用，失败即抛出回滚） */
export async function markFalsePositive(
  findingId: number,
  isFalsePositive: boolean,
): Promise<void> {
  const response = await fetch(`${API_BASE}/findings/${findingId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ isFalsePositive }),
  });
  await parseResponse(FalsePositiveResponseSchema, response);
}
