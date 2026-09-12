import {
  ReviewListResponseSchema,
  ReviewReportDetailSchema,
  ReviewStatsResponseSchema,
  StartReviewResponseSchema,
  FalsePositiveResponseSchema,
  ReviewDiffResponseSchema,
  RerunReviewResponseSchema,
  DeleteReviewResponseSchema,
  CancelReviewResponseSchema,
  AdminConfigResponseSchema,
  KnowledgeStatusResponseSchema,
  KnowledgeReindexResponseSchema,
} from '@ai-review/shared/api';
import type { AdminConfig, KnowledgeStatus, ReviewListItem, ReviewReportDetail, ReviewStats } from '@ai-review/shared/api';
import { parseResponse } from './parse-response.js';

const API_BASE = '/api';
type ReviewQueryOptions = {
  q?: string;
  status?: 'completed' | 'failed' | 'cancelled';
  mode?: 'fast' | 'full';
  severity?: 'BLOCKER' | 'WARNING' | 'NIT';
  page?: number;
  pageSize?: number;
  repo?: string;
  branch?: string;
  from?: string;
  to?: string;
};

export async function fetchReviewPage(options: ReviewQueryOptions = {}): Promise<{
  reviews: ReviewListItem[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...options, page: options.page ?? 1, pageSize: options.pageSize ?? 20 })) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const query = params.toString();
  return parseResponse(ReviewListResponseSchema, await fetch(`${API_BASE}/reviews?${query}`));
}

export async function fetchReviews(options: ReviewQueryOptions = {}): Promise<ReviewListItem[]> {
  return (await fetchReviewPage({ ...options, pageSize: options.pageSize ?? 100 })).reviews;
}

export async function fetchReviewDetail(reviewId: string): Promise<ReviewReportDetail> {
  return parseResponse(
    ReviewReportDetailSchema,
    await fetch(`${API_BASE}/reviews/${encodeURIComponent(reviewId)}`),
  );
}

export async function startReview(repoPath: string, mode: 'fast' | 'full', blockOn?: 'BLOCKER' | 'WARNING' | 'NIT'): Promise<string> {
  const response = await fetch(`${API_BASE}/reviews`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ repoPath, mode, ...(blockOn !== undefined ? { blockOn } : {}) }),
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

export async function fetchStats(options: { from?: string; to?: string } = {}): Promise<ReviewStats> {
  const params = new URLSearchParams();
  if (options.from !== undefined) params.set('from', options.from);
  if (options.to !== undefined) params.set('to', options.to);
  const query = params.toString();
  const body = await parseResponse(ReviewStatsResponseSchema, await fetch(`${API_BASE}/stats${query === '' ? '' : `?${query}`}`));
  return body.stats;
}


export async function fetchReviewDiff(reviewId: string): Promise<string | null> {
  const body = await parseResponse(ReviewDiffResponseSchema, await fetch(`${API_BASE}/reviews/${encodeURIComponent(reviewId)}/diff`));
  return body.diffText;
}

export async function rerunReview(reviewId: string): Promise<string> {
  const body = await parseResponse(RerunReviewResponseSchema, await fetch(`${API_BASE}/reviews/${encodeURIComponent(reviewId)}/rerun`, { method: 'POST' }));
  return body.reviewId;
}

export async function cancelReview(reviewId: string): Promise<void> {
  await parseResponse(CancelReviewResponseSchema, await fetch(`${API_BASE}/reviews/${encodeURIComponent(reviewId)}/cancel`, { method: 'POST' }));
}

export async function deleteReview(reviewId: string): Promise<void> {
  await parseResponse(DeleteReviewResponseSchema, await fetch(`${API_BASE}/reviews/${encodeURIComponent(reviewId)}`, { method: 'DELETE' }));
}

export function reviewExportUrl(reviewId: string, format: 'markdown' | 'html' | 'json'): string {
  return `${API_BASE}/reviews/${encodeURIComponent(reviewId)}/export?format=${format}`;
}


export async function fetchAdminConfig(): Promise<AdminConfig> {
  const body = await parseResponse(AdminConfigResponseSchema, await fetch(`${API_BASE}/admin/config`));
  return body.config;
}

export async function updateAdminConfig(config: AdminConfig): Promise<AdminConfig> {
  const body = await parseResponse(
    AdminConfigResponseSchema,
    await fetch(`${API_BASE}/admin/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(config),
    }),
  );
  return body.config;
}

export async function fetchKnowledgeStatus(): Promise<KnowledgeStatus> {
  const body = await parseResponse(KnowledgeStatusResponseSchema, await fetch(`${API_BASE}/admin/knowledge`));
  return body.knowledge;
}

export async function reindexKnowledge(): Promise<void> {
  await parseResponse(
    KnowledgeReindexResponseSchema,
    await fetch(`${API_BASE}/admin/knowledge/reindex`, { method: 'POST' }),
  );
}
