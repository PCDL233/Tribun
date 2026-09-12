import { afterEach, describe, expect, it, vi } from 'vitest';
import { runReviewPipeline } from '@ai-review/core';
import type { GitRunner, PipelineDeps, PipelineRunner, ReviewState } from '@ai-review/core';
import { createReviewStore, ReviewStore } from '@ai-review/db';
import { GitReader } from '@ai-review/diff';
import { createMockProvider } from '@ai-review/llm';
import { buildDefaultRegistry } from '@ai-review/tools';
import type { Finding } from '@ai-review/shared';
import { buildApp } from '../src/app.js';
import { createStoreReviewCache } from '../src/cache.js';
import { createReviewMetrics } from '../src/metrics.js';
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
      cacheHits: 0,
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
  const metrics = createReviewMetrics();
  const service = new ReviewService(store, makeDeps, runner, metrics);
  return buildApp({ store, service, metrics });
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

describe('stats and metrics endpoints', () => {
  it('aggregates store statistics after a completed review', async () => {
    const app = makeHarness(async () => makeState());
    await app.request('/api/reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoPath: 'D:/tmp/repo' }),
    });

    await vi.waitFor(async () => {
      const response = await app.request('/api/stats');
      const { stats } = (await response.json()) as {
        stats: { totalReviews: number; totalFindings: number; severityDistribution: Array<{ severity: string; count: number }> };
      };
      expect(stats.totalReviews).toBe(1);
      expect(stats.totalFindings).toBe(1);
      expect(stats.severityDistribution).toEqual([
        { severity: 'BLOCKER', count: 1 },
        { severity: 'WARNING', count: 0 },
        { severity: 'NIT', count: 0 },
        { severity: 'PRAISE', count: 0 },
      ]);
    });
  });

  it('serves prometheus metrics after completion and failure', async () => {
    const app = makeHarness(async () => {
      throw new Error('pipeline boom');
    });
    await app.request('/api/reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoPath: 'D:/tmp/repo' }),
    });

    await vi.waitFor(async () => {
      const body = await (await app.request('/metrics')).text();
      expect(body).toContain('ai_review_reviews_total{status="failed"} 1');
    });
  });
});

describe('review cache integration (方案 3.0 内容哈希去重)', () => {
  /** deep 分流 diff：敏感路径 30 + 大改动 25 + 删除守卫 20 = 75 分 */
  function makeDeepDiff(): string {
    return [
      'diff --git a/src/auth/login.ts b/src/auth/login.ts',
      'index 1111111..2222222 100644',
      '--- a/src/auth/login.ts',
      '+++ b/src/auth/login.ts',
      '@@ -1,2 +1,103 @@',
      ' const config = loadConfig();',
      '-  } catch (error) {',
      '+const cmd = exec(userInput);',
      ...Array.from({ length: 100 }, (_, i) => `+const value${i} = ${i};`),
      ' export function login() {}',
    ].join('\n');
  }

  function makeFakeGit(): GitRunner {
    return async (...args: string[]) => {
      const [command, second] = args;
      if (command === 'diff' && second === '--cached') return makeDeepDiff();
      if (command === 'show' && second !== undefined) {
        return 'const config = loadConfig();\nexport function login() {}\n';
      }
      if (command === 'branch') return 'main\n';
      throw new Error(`unexpected git invocation: ${args.join(' ')}`);
    };
  }

  function makeCacheHarness(): ReturnType<typeof buildApp> {
    const store: ReviewStore = createReviewStore(':memory:');
    const metrics = createReviewMetrics();
    const reviewCache = createStoreReviewCache(store);
    const service = new ReviewService(
      store,
      (repoPath, mode): PipelineDeps => ({
        gitReader: new GitReader(makeFakeGit()),
        rag: { query: async () => [] },
        ignores: { allows: () => true },
        history: { changeFrequency: async () => 0 },
        providers: { correctness: makeDeps(mode).providers.correctness, security: makeDeps(mode).providers.security, performance: makeDeps(mode).providers.performance },
        registry: makeDeps(mode).registry,
        mode,
        reviewCache,
      }),
      runReviewPipeline,
      metrics,
    );
    return buildApp({ store, service, metrics });
  }

  it('persists cache entries through the real pipeline across reviews', async () => {
    const app = makeCacheHarness();
    const post = (): Promise<Response> =>
      app.request('/api/reviews', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repoPath: 'D:/tmp/repo', mode: 'full' }),
      });

    const first = (await (await post()).json()) as { reviewId: string };
    const second = (await (await post()).json()) as { reviewId: string };

    await vi.waitFor(async () => {
      const list = (await (await app.request('/api/reviews')).json()) as {
        reviews: Array<{ reviewId: string }>;
      };
      expect(list.reviews).toHaveLength(2);
    });

    const firstReport = (await (await app.request(`/api/reviews/${first.reviewId}`)).json()) as {
      findings: Array<{ title: string }>;
    };
    const secondReport = (await (await app.request(`/api/reviews/${second.reviewId}`)).json()) as {
      findings: Array<{ title: string }>;
    };
    // 第二次审查对相同内容命中缓存，发现口径与首轮一致
    expect(secondReport.findings.map((f) => f.title)).toEqual(
      firstReport.findings.map((f) => f.title),
    );
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
