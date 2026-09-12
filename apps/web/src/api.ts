import {
  ReviewListResponseSchema,
  ReviewReportDetailSchema,
  ReviewStatsResponseSchema,
  StartReviewResponseSchema,
  FalsePositiveResponseSchema,
} from '@ai-review/shared/api';
import type { ReviewListItem, ReviewReportDetail, ReviewStats } from '@ai-review/shared/api';
import { parseResponse } from './parse-response.js';

const API_BASE = '/api';
type ReviewQueryOptions = {
  q?: string;
  status?: 'completed' | 'failed' | 'cancelled';
  mode?: 'fast' | 'full';
  severity?: 'BLOCKER' | 'WARNING' | 'NIT';
  page?: number;
  pageSize?: number;
};

export async function fetchReviews(options: ReviewQueryOptions = {}): Promise<ReviewListItem[]> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({
    ...options,
    page: options.page ?? 1,
    pageSize: options.pageSize ?? 100,
  })) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const query = params.toString();
  const body = await parseResponse(
    ReviewListResponseSchema,
    await fetch(`${API_BASE}/reviews${query ? `?${query}` : ''}`),
  );
  return body.reviews;
}

export async function fetchReviewDetail(reviewId: string): Promise<ReviewReportDetail> {
  return parseResponse(
    ReviewReportDetailSchema,
    await fetch(`${API_BASE}/reviews/${encodeURIComponent(reviewId)}`),
  );
}

export async function startReview(repoPath: string, mode: 'fast' | 'full'): Promise<string> {
  const response = await fetch(`${API_BASE}/reviews`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ repoPath, mode }),
  });
  const body = await parseResponse(StartReviewResponseSchema, response);
  return body.reviewId;
}

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

export async function fetchStats(): Promise<ReviewStats> {
  const body = await parseResponse(ReviewStatsResponseSchema, await fetch(`${API_BASE}/stats`));
  return body.stats;
}
