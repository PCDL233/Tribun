import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PipelineDeps, PipelineRunner, ReviewState } from '@ai-review/core';
import { createReviewStore, ReviewStore } from '@ai-review/db';
import { GitReader } from '@ai-review/diff';
import { createMockProvider } from '@ai-review/llm';
import { buildDefaultRegistry } from '@ai-review/tools';
import type { Finding } from '@ai-review/shared';
import { buildApp } from '../src/app.js';
import { ReviewService } from '../src/review-service.js';

function makeDeps(mode: 'fast' | 'full'): PipelineDeps {
  const mock = createMockProvider();
  return {
    gitReader: new GitReader(async () => 'main'),
    rag: { query: async () => [] },
    ignores: { allows: () => true },
    history: { changeFrequency: async () => 0 },
    providers: { correctness: mock, security: mock, performance: mock },
    registry: buildDefaultRegistry(),
    mode,
  };
}

const BLOCKER_FINDING: Finding = {
  agent: 'static',
  severity: 'BLOCKER',
  confidence: 0.9,
  filePath: 'config.ts',
  lineStart: 1,
  lineEnd: 1,
  title: 'Possible AWS access key id in changed code',
  description: 'Hardcoded credential detected.',
  isFalsePositive: false,
};

function makeState(): ReviewState {
  return {
    context: {
      files: [],
      metadata: {
        totalFiles: 1,
        totalAdditions: 10,
        totalDeletions: 2,
        languages: ['ts'],
        generatedAt: new Date().toISOString(),
      },
    },
    plan: { deep: [], quick: [], staticOnly: [] },
    findings: [BLOCKER_FINDING],
    healRounds: 0,
    metrics: {
      totalTokens: 0,
      durationMs: 5,
      filesDeep: 0,
      filesQuick: 0,
      filesStaticOnly: 1,
      degradedToStatic: [],
      healRounds: 0,
    },
  };
}

/** 节点事件 → 等 gate → 完成，供 SSE 订阅时序测试 */
function makeGatedRunner(gate: { promise: Promise<void>; resolve: () => void }): PipelineRunner {
  return async (_deps, options) => {
    options.onNodeUpdate?.('parse', {});
    await gate.promise;
    options.onNodeUpdate?.('report', {});
    return makeState();
  };
}

function makeHarness(runner: PipelineRunner): ReturnType<typeof buildApp> {
  const store: ReviewStore = createReviewStore(':memory:');
  const service = new ReviewService(store, makeDeps, runner);
  return buildApp({ store, service });
}

const gates: Array<{ promise: Promise<void>; resolve: () => void }> = [];
function newGate(): { promise: Promise<void>; resolve: () => void } {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  const gate = { promise, resolve: resolve as () => void };
  gates.push(gate);
  return gate;
}

afterEach(() => {
  for (const gate of gates.splice(0)) gate.resolve();
});

describe('review REST API', () => {
  it('runs a review to completion and serves its report', async () => {
    const app = makeHarness(async () => makeState());
    const started = await app.request('/api/reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoPath: 'D:/tmp/repo', mode: 'fast' }),
    });
    expect(started.status).toBe(202);
    const { reviewId }: { reviewId: string } = await started.json();

    await vi.waitFor(async () => {
      const listResponse = await app.request('/api/reviews');
      const list = await listResponse.json();
      expect(list).toEqual({
        reviews: [expect.objectContaining({ reviewId, blockerCount: 1, branch: 'main' })],
      });
    });

    const detail = await app.request(`/api/reviews/${reviewId}`);
    expect(detail.status).toBe(200);
    const report = await detail.json();
    expect(report.meta).toMatchObject({ reviewId, repoPath: 'D:/tmp/repo', branch: 'main' });
    expect(report.findings[0]).toMatchObject({
      severity: 'BLOCKER',
      title: 'Possible AWS access key id in changed code',
    });
    expect(report.assessment).toContain('should not be committed');
  });

  it('returns 404 for unknown reviews', async () => {
    const app = makeHarness(async () => makeState());
    const detail = await app.request('/api/reviews/review-missing');
    expect(detail.status).toBe(404);
  });

  it('rejects invalid start payloads', async () => {
    const app = makeHarness(async () => makeState());
    const bad = await app.request('/api/reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'ultra' }),
    });
    expect(bad.status).toBe(400);
  });
});

describe('false-positive marking API', () => {
  it('persists the flag and reports 404 for unknown ids', async () => {
    const app = makeHarness(async () => makeState());
    const started = await app.request('/api/reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoPath: 'D:/tmp/repo' }),
    });
    const { reviewId }: { reviewId: string } = await started.json();
    const detail: { findings: Array<{ id: number }> } = await (
      await app.request(`/api/reviews/${reviewId}`)
    ).json();
    const findingId = detail.findings[0]?.id;
    if (findingId === undefined) throw new Error('expected a finding row');

    const marked = await app.request(`/api/findings/${findingId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ isFalsePositive: true }),
    });
    expect(marked.status).toBe(200);

    const report = await (await app.request(`/api/reviews/${reviewId}`)).json();
    expect(report.findings[0].isFalsePositive).toBe(true);

    expect(
      (
        await app.request('/api/findings/999', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ isFalsePositive: true }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request('/api/findings/abc', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ isFalsePositive: true }),
        })
      ).status,
    ).toBe(400);
  });
});

describe('SSE progress stream', () => {
  it('streams stage events and the terminal completed event', async () => {
    const gate = newGate();
    const app = makeHarness(makeGatedRunner(gate));
    const started = await app.request('/api/reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoPath: 'D:/tmp/repo' }),
    });
    const { reviewId }: { reviewId: string } = await started.json();

    const streamResponse = app.request(`/api/reviews/${reviewId}/events`);
    // 等订阅建立后再放行流水线，保证事件落在订阅窗口内
    await new Promise((resolve) => setTimeout(resolve, 50));
    gate.resolve();

    const body = await (await streamResponse).text();
    expect(body).toContain('event: stage');
    expect(body).toContain('"type":"stage"');
    expect(body).toContain('event: completed');
    expect(body).toContain('"blocking":true');
  });

  it('streams the failed event when the pipeline throws', async () => {
    const gate = newGate();
    const app = makeHarness(async (_deps, options) => {
      await gate.promise;
      options.onNodeUpdate?.('parse', {});
      throw new Error('git repo invalid');
    });
    const started = await app.request('/api/reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoPath: 'D:/tmp/not-a-repo' }),
    });
    const { reviewId }: { reviewId: string } = await started.json();

    const streamResponse = app.request(`/api/reviews/${reviewId}/events`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    gate.resolve();

    const body = await (await streamResponse).text();
    expect(body).toContain('event: failed');
    expect(body).toContain('git repo invalid');
  });
});
