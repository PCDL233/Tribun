import { afterEach, describe, expect, it, vi } from 'vitest';
import { runReviewPipeline } from '@ai-review/core';
import type { GitRunner, PipelineDeps, PipelineRunner, ReviewState } from '@ai-review/core';
import { openSqlite, ReviewStore, UserStore } from '@ai-review/db';
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

type Harness = ReturnType<typeof buildApp>;

function makeHarness(runner: PipelineRunner): Harness {
  const sqlite = openSqlite(':memory:');
  const store = new ReviewStore(sqlite);
  const users = new UserStore(sqlite);
  const metrics = createReviewMetrics();
  const service = new ReviewService(store, makeDeps, runner, metrics);
  return buildApp({ store, users, service, metrics });
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

/** 注册并返回会话 Cookie（首个注册用户自动成为 admin） */
async function registerUser(
  app: Harness,
  username: string,
  password = 'password123',
): Promise<{ cookie: string; role: string }> {
  const res = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  expect(res.status).toBe(201);
  const { user } = (await res.json()) as { user: { role: string } };
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  expect(cookie).toContain('ai_review_session=');
  return { cookie, role: user.role };
}

function auth(cookie: string): { cookie: string } {
  return { cookie };
}

async function startReview(app: Harness, cookie: string): Promise<string> {
  const started = await app.request('/api/reviews', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...auth(cookie) },
    body: JSON.stringify({ repoPath: 'D:/tmp/repo', mode: 'fast' }),
  });
  expect(started.status).toBe(202);
  const { reviewId }: { reviewId: string } = await started.json();
  return reviewId;
}

describe('auth API', () => {
  it('makes the first registered user admin and the rest regular users', async () => {
    const app = makeHarness(async () => makeState());
    const first = await registerUser(app, 'boss');
    expect(first.role).toBe('admin');
    const second = await registerUser(app, 'alice');
    expect(second.role).toBe('user');
  });

  it('rejects duplicate usernames and weak payloads', async () => {
    const app = makeHarness(async () => makeState());
    await registerUser(app, 'boss');
    const dup = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'boss', password: 'password123' }),
    });
    expect(dup.status).toBe(409);
    const weak = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'x', password: 'short' }),
    });
    expect(weak.status).toBe(400);
  });

  it('logs in with valid credentials, rejects bad ones, and serves /me', async () => {
    const app = makeHarness(async () => makeState());
    await registerUser(app, 'boss', 's3cret-password');

    const bad = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'boss', password: 'wrong-password' }),
    });
    expect(bad.status).toBe(401);
    const unknown = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'nobody', password: 'whatever-pass' }),
    });
    expect(unknown.status).toBe(401);

    const login = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'boss', password: 's3cret-password' }),
    });
    expect(login.status).toBe(200);
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

    const me = await app.request('/api/auth/me', { headers: auth(cookie) });
    expect(me.status).toBe(200);
    const { user } = (await me.json()) as { user: { username: string; role: string } };
    expect(user).toMatchObject({ username: 'boss', role: 'admin' });
  });

  it('revokes all sessions after a password change', async () => {
    const app = makeHarness(async () => makeState());
    const { cookie } = await registerUser(app, 'boss');

    const changed = await app.request('/api/auth/change-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth(cookie) },
      body: JSON.stringify({ oldPassword: 'password123', newPassword: 'brand-new-pass' }),
    });
    expect(changed.status).toBe(200);

    const revoked = await app.request('/api/auth/me', { headers: auth(cookie) });
    expect(revoked.status).toBe(401);

    const relogin = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'boss', password: 'brand-new-pass' }),
    });
    expect(relogin.status).toBe(200);
  });

  it('rejects unauthenticated API access', async () => {
    const app = makeHarness(async () => makeState());
    expect((await app.request('/api/reviews')).status).toBe(401);
    expect((await app.request('/api/stats')).status).toBe(401);
    expect((await app.request('/api/reviews/review-x')).status).toBe(401);
  });
});

describe('review REST API', () => {
  it('runs a review to completion and serves its report', async () => {
    const app = makeHarness(async () => makeState());
    const { cookie } = await registerUser(app, 'boss');
    const reviewId = await startReview(app, cookie);

    await vi.waitFor(async () => {
      const listResponse = await app.request('/api/reviews', { headers: auth(cookie) });
      const list = await listResponse.json();
      expect(list).toEqual({
        reviews: [expect.objectContaining({ reviewId, blockerCount: 1, branch: 'main' })],
      });
    });

    const detail = await app.request(`/api/reviews/${reviewId}`, { headers: auth(cookie) });
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
    const { cookie } = await registerUser(app, 'boss');
    const detail = await app.request('/api/reviews/review-missing', { headers: auth(cookie) });
    expect(detail.status).toBe(404);
  });

  it('rejects invalid start payloads', async () => {
    const app = makeHarness(async () => makeState());
    const { cookie } = await registerUser(app, 'boss');
    const bad = await app.request('/api/reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth(cookie) },
      body: JSON.stringify({ mode: 'ultra' }),
    });
    expect(bad.status).toBe(400);
  });
});

describe('per-user data isolation', () => {
  it('hides user B reviews from user A but shows everything to admin', async () => {
    const app = makeHarness(async () => makeState());
    const admin = await registerUser(app, 'boss');
    const alice = await registerUser(app, 'alice');
    const bob = await registerUser(app, 'bob');

    const aliceReview = await startReview(app, alice.cookie);
    const bobReview = await startReview(app, bob.cookie);

    // alice 看不到 bob 的报告详情 / 列表 / 统计
    expect((await app.request(`/api/reviews/${bobReview}`, { headers: auth(alice.cookie) })).status).toBe(404);
    const aliceList = (await (await app.request('/api/reviews', { headers: auth(alice.cookie) })).json()) as {
      reviews: Array<{ reviewId: string }>;
    };
    expect(aliceList.reviews.map((r) => r.reviewId)).toEqual([aliceReview]);
    const aliceStats = (await (await app.request('/api/stats', { headers: auth(alice.cookie) })).json()) as {
      stats: { totalReviews: number };
    };
    expect(aliceStats.stats.totalReviews).toBe(1);

    // SSE 订阅同样按归属隔离
    expect(
      (await app.request(`/api/reviews/${bobReview}/events`, { headers: auth(alice.cookie) })).status,
    ).toBe(404);

    // admin 全量可见
    const adminList = (await (await app.request('/api/reviews', { headers: auth(admin.cookie) })).json()) as {
      reviews: Array<{ reviewId: string }>;
    };
    expect(adminList.reviews.map((r) => r.reviewId).sort()).toEqual([aliceReview, bobReview].sort());
    expect(
      (await app.request(`/api/reviews/${bobReview}`, { headers: auth(admin.cookie) })).status,
    ).toBe(200);
  });

  it('rejects false-positive marking across users', async () => {
    const app = makeHarness(async () => makeState());
    const admin = await registerUser(app, 'boss');
    const alice = await registerUser(app, 'alice');
    const bob = await registerUser(app, 'bob');
    const bobReview = await startReview(app, bob.cookie);
    const detail = (await (
      await app.request(`/api/reviews/${bobReview}`, { headers: auth(bob.cookie) })
    ).json()) as { findings: Array<{ id: number }> };
    const findingId = detail.findings[0]?.id;
    if (findingId === undefined) throw new Error('expected a finding row');

    expect(
      (
        await app.request(`/api/findings/${findingId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', ...auth(alice.cookie) },
          body: JSON.stringify({ isFalsePositive: true }),
        })
      ).status,
    ).toBe(404);
    // admin 跨用户可标记
    expect(
      (
        await app.request(`/api/findings/${findingId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', ...auth(admin.cookie) },
          body: JSON.stringify({ isFalsePositive: true }),
        })
      ).status,
    ).toBe(200);
  });
});

describe('admin privilege isolation', () => {
  it('forbids admin endpoints and /metrics for regular users', async () => {
    const app = makeHarness(async () => makeState());
    const admin = await registerUser(app, 'boss');
    const alice = await registerUser(app, 'alice');

    expect((await app.request('/api/admin/users', { headers: auth(alice.cookie) })).status).toBe(403);
    expect((await app.request('/metrics', { headers: auth(alice.cookie) })).status).toBe(403);
    expect((await app.request('/api/admin/users', { headers: auth(admin.cookie) })).status).toBe(200);
    expect((await app.request('/metrics', { headers: auth(admin.cookie) })).status).toBe(200);
  });

  it('manages users: role change, disable, reset password, delete, self-lockout guards', async () => {
    const app = makeHarness(async () => makeState());
    const admin = await registerUser(app, 'boss');
    const alice = await registerUser(app, 'alice');

    // 自锁防护
    const me = (await (await app.request('/api/auth/me', { headers: auth(admin.cookie) })).json()) as {
      user: { id: string };
    };
    const aliceMe = (await (await app.request('/api/auth/me', { headers: auth(alice.cookie) })).json()) as {
      user: { id: string };
    };
    expect(
      (
        await app.request(`/api/admin/users/${me.user.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', ...auth(admin.cookie) },
          body: JSON.stringify({ role: 'user' }),
        })
      ).status,
    ).toBe(400);

    // 提升 alice 为 admin
    const promoted = await app.request(`/api/admin/users/${aliceMe.user.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...auth(admin.cookie) },
      body: JSON.stringify({ role: 'admin' }),
    });
    expect(promoted.status).toBe(200);

    // 重置密码后旧会话失效、新密码可登录
    const reset = await app.request(`/api/admin/users/${aliceMe.user.id}/reset-password`, {
      method: 'POST',
      headers: { ...auth(admin.cookie) },
    });
    expect(reset.status).toBe(200);
    const { newPassword } = (await reset.json()) as { newPassword: string };
    expect((await app.request('/api/auth/me', { headers: auth(alice.cookie) })).status).toBe(401);
    expect(
      (
        await app.request('/api/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ username: 'alice', password: newPassword }),
        })
      ).status,
    ).toBe(200);

    // 禁用后登录被拒
    await app.request(`/api/admin/users/${aliceMe.user.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...auth(admin.cookie) },
      body: JSON.stringify({ status: 'disabled' }),
    });
    const disabledLogin = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: newPassword }),
    });
    expect(disabledLogin.status).toBe(403);

    // 删除
    expect(
      (
        await app.request(`/api/admin/users/${aliceMe.user.id}`, {
          method: 'DELETE',
          headers: { ...auth(admin.cookie) },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(`/api/admin/users/${aliceMe.user.id}`, {
          method: 'DELETE',
          headers: { ...auth(admin.cookie) },
        })
      ).status,
    ).toBe(404);
  });

  it('serves the admin overview aggregation', async () => {
    const app = makeHarness(async () => makeState());
    const admin = await registerUser(app, 'boss');
    await registerUser(app, 'alice');
    await startReview(app, admin.cookie);

    await vi.waitFor(async () => {
      const res = await app.request('/api/admin/overview', { headers: auth(admin.cookie) });
      const { overview } = (await res.json()) as {
        overview: { userCount: number; adminCount: number; totalReviews: number };
      };
      expect(overview).toMatchObject({ userCount: 2, adminCount: 1, totalReviews: 1 });
    });
  });
});

describe('false-positive marking API', () => {
  it('persists the flag and reports 404 for unknown ids', async () => {
    const app = makeHarness(async () => makeState());
    const { cookie } = await registerUser(app, 'boss');
    const reviewId = await startReview(app, cookie);
    const detail: { findings: Array<{ id: number }> } = await (
      await app.request(`/api/reviews/${reviewId}`, { headers: auth(cookie) })
    ).json();
    const findingId = detail.findings[0]?.id;
    if (findingId === undefined) throw new Error('expected a finding row');

    const marked = await app.request(`/api/findings/${findingId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...auth(cookie) },
      body: JSON.stringify({ isFalsePositive: true }),
    });
    expect(marked.status).toBe(200);

    const report = await (
      await app.request(`/api/reviews/${reviewId}`, { headers: auth(cookie) })
    ).json();
    expect(report.findings[0].isFalsePositive).toBe(true);

    expect(
      (
        await app.request('/api/findings/999', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', ...auth(cookie) },
          body: JSON.stringify({ isFalsePositive: true }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request('/api/findings/abc', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', ...auth(cookie) },
          body: JSON.stringify({ isFalsePositive: true }),
        })
      ).status,
    ).toBe(400);
  });
});

describe('stats and metrics endpoints', () => {
  it('aggregates store statistics after a completed review', async () => {
    const app = makeHarness(async () => makeState());
    const { cookie } = await registerUser(app, 'boss');
    await startReview(app, cookie);

    await vi.waitFor(async () => {
      const response = await app.request('/api/stats', { headers: auth(cookie) });
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
    const { cookie } = await registerUser(app, 'boss');
    await startReview(app, cookie);

    await vi.waitFor(async () => {
      const body = await (await app.request('/metrics', { headers: auth(cookie) })).text();
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

  function makeCacheHarness(): Harness {
    const sqlite = openSqlite(':memory:');
    const store = new ReviewStore(sqlite);
    const users = new UserStore(sqlite);
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
    return buildApp({ store, users, service, metrics });
  }

  it('persists cache entries through the real pipeline across reviews', async () => {
    const app = makeCacheHarness();
    const { cookie } = await registerUser(app, 'boss');
    const post = (): Promise<Response> =>
      app.request('/api/reviews', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...auth(cookie) },
        body: JSON.stringify({ repoPath: 'D:/tmp/repo', mode: 'full' }),
      });

    const first = (await (await post()).json()) as { reviewId: string };
    const second = (await (await post()).json()) as { reviewId: string };

    await vi.waitFor(async () => {
      const list = (await (await app.request('/api/reviews', { headers: auth(cookie) })).json()) as {
        reviews: Array<{ reviewId: string }>;
      };
      expect(list.reviews).toHaveLength(2);
    });

    const firstReport = (await (await app.request(`/api/reviews/${first.reviewId}`, { headers: auth(cookie) })).json()) as {
      findings: Array<{ title: string }>;
    };
    const secondReport = (await (await app.request(`/api/reviews/${second.reviewId}`, { headers: auth(cookie) })).json()) as {
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
    const { cookie } = await registerUser(app, 'boss');
    const reviewId = await startReview(app, cookie);

    const streamResponse = app.request(`/api/reviews/${reviewId}/events`, { headers: auth(cookie) });
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
    const { cookie } = await registerUser(app, 'boss');
    const reviewId = await startReview(app, cookie);

    const streamResponse = app.request(`/api/reviews/${reviewId}/events`, { headers: auth(cookie) });
    await new Promise((resolve) => setTimeout(resolve, 50));
    gate.resolve();

    const body = await (await streamResponse).text();
    expect(body).toContain('event: failed');
    expect(body).toContain('git repo invalid');
  });
});
