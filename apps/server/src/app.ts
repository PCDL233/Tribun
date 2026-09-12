import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { SafeUser, ReviewStore, UserStore } from '@ai-review/db';
import { StoreError } from '@ai-review/db';
import {
  AdminOverviewResponseSchema,
  AdminUserPatchSchema,
  UserListResponseSchema,
  ReviewListQuerySchema,
  ReviewStatsQuerySchema,
  ReviewDiffResponseSchema,
  DeleteReviewResponseSchema,
  CancelReviewResponseSchema,
  AdminConfigSchema,
  AdminConfigResponseSchema,
  AiReviewConfigSchema,
  KnowledgeReindexResponseSchema,
  KnowledgeStatusResponseSchema,
} from '@ai-review/shared';
import { renderHtml, renderJson, renderMarkdown } from '@ai-review/report';
import { createRequireAuth, generateRandomPassword, hashPassword, registerAuthRoutes, requireAdmin } from './auth.js';
import type { ReviewMetrics } from './metrics.js';
import type { ReviewStageEvent } from './review-service.js';
import type { ReviewService } from './review-service.js';

/** POST /api/reviews 入参（方案 2.3：API 入参经 zod 校验） */
export const StartReviewSchema = z.object({
  repoPath: z.string().min(1),
  mode: z.enum(['fast', 'full']).default('fast'),
  blockOn: z.enum(['BLOCKER', 'WARNING', 'NIT']).optional(),
});

/** PATCH /api/findings/:id 入参（Dashboard 误报标记回写） */
export const FalsePositiveSchema = z.object({ isFalsePositive: z.boolean() });

/** Hono 环境类型：requireAuth 之后可从 Context 读取登录用户 */
export type AppEnv = {
  Variables: { user: SafeUser };
};

export type AppDeps = {
  store: ReviewStore;
  users: UserStore;
  service: ReviewService;
  metrics: ReviewMetrics;
  /** 管理员配置文件位置；未提供时使用当前目录 .ai-review.yml */
  configPath?: string;
  /** 可选知识库管理器，未装配时返回 idle 状态 */
  knowledge?: KnowledgeManager;
};

export type KnowledgeManager = {
  getStatus(): Promise<unknown> | unknown;
  reindex(): Promise<void>;
};

/** SSE 桥接队列：ReviewService 的同步广播 → streamSSE 的异步消费 */
class EventQueue<T> {
  private readonly items: T[] = [];
  private resolvers: Array<() => void> = [];

  public push(item: T): void {
    this.items.push(item);
    this.resolvers.shift()?.();
  }

  public next(): Promise<T | undefined> {
    const immediate = this.items.shift();
    if (immediate !== undefined) return Promise.resolve(immediate);
    return new Promise((resolve) => {
      this.resolvers.push(() => resolve(this.items.shift()));
    });
  }

  /** 唤醒所有等待者（返回 undefined 表示队列关闭） */
  public close(): void {
    for (const resolve of this.resolvers.splice(0)) resolve();
  }
}

/**
 * 组装 Hono REST + SSE 应用（方案 3.9/3.10 的服务端契约）。
 * 路由一览：
 * - POST /api/auth/register    注册（首个用户自动 admin）
 * - POST /api/auth/login       登录（建立 Cookie 会话）
 * - POST /api/auth/logout      登出
 * - GET  /api/auth/me          当前用户
 * - POST /api/auth/change-password  改密（吊销全部旧会话）
 * - POST /api/reviews          触发审查（202 + reviewId，记录发起人）
 * - GET  /api/reviews          审查历史列表（普通用户仅本人记录）
 * - GET  /api/reviews/:id      报告详情（五段式 + 行级 findings）
 * - GET  /api/reviews/:id/events  实时进度 SSE
 * - PATCH /api/findings/:id    误报标记回写
 * - GET  /api/stats            统计聚合（普通用户仅本人数据）
 * - GET  /api/admin/users      用户管理（admin）
 * - PATCH /api/admin/users/:id 角色与状态管理（admin）
 * - POST /api/admin/users/:id/reset-password  重置密码（admin）
 * - DELETE /api/admin/users/:id  删除用户（admin）
 * - GET  /api/admin/overview   系统概览聚合（admin）
 * - GET  /metrics              Prometheus 指标（admin）
 */
export function buildApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // —— 认证路由（匿名可访问 + me/change-password 自带 requireAuth）——
  registerAuthRoutes(app, { users: deps.users });

  // —— 数据隔离：除 auth 前缀外所有 /api 请求必须登录 ——
  const requireAuth = createRequireAuth({ users: deps.users });
  app.use('/api/*', async (c, next) => {
    if (c.req.path.startsWith('/api/auth/')) return next();
    return requireAuth(c, next);
  });

  // Prometheus 拉取端点：仅 admin 可读（审查量与 token 成本属团队敏感数据）
  app.get('/metrics', requireAuth, requireAdmin, async (c) =>
    c.text(await deps.metrics.render(), 200, { 'content-type': 'text/plain; version=0.0.4' }),
  );

  app.post('/api/reviews', zValidator('json', StartReviewSchema), (c) => {
    const { repoPath, mode, blockOn } = c.req.valid('json');
    const createdBy = c.get('user').id;
    return c.json({ reviewId: deps.service.startReview({ repoPath, mode, createdBy, ...(blockOn === undefined ? {} : { blockOn }) }) }, 202);
  });

  // 数据隔离：admin 可见全部；普通用户仅见本人发起的记录，筛选与分页在数据库侧完成
  app.get('/api/reviews', zValidator('query', ReviewListQuerySchema), (c) => {
    const current = c.get('user');
    const queryParams = c.req.query();
    const query = c.req.valid('query');
    const page = deps.store.listReviewPage(query, current.role === 'admin' ? undefined : current.id);
    // 保留无参数旧客户端的响应形状；显式分页参数使用完整分页契约。
    if (Object.keys(queryParams).length === 0) return c.json({ reviews: page.reviews });
    return c.json(page);
  });

  app.get('/api/reviews/:id/diff', (c) => {
    const current = c.get('user');
    const reviewId = c.req.param('id');
    if (!canAccessReview(deps, current, reviewId)) return c.json({ error: 'review not found' }, 404);
    try {
      return c.json(ReviewDiffResponseSchema.parse({ diffText: deps.store.getDiff(reviewId) }));
    } catch (e) {
      if (e instanceof StoreError) return c.json({ error: e.message }, 404);
      throw e;
    }
  });

  app.post('/api/reviews/:id/rerun', (c) => {
    const current = c.get('user');
    const reviewId = c.req.param('id');
    if (!canAccessReview(deps, current, reviewId)) return c.json({ error: 'review not found' }, 404);
    try {
      return c.json({ reviewId: deps.service.rerunReview(reviewId, current.id) }, 202);
    } catch (e) {
      if (e instanceof StoreError) return c.json({ error: e.message }, 404);
      throw e;
    }
  });

  app.post('/api/reviews/:id/cancel', (c) => {
    const current = c.get('user');
    const reviewId = c.req.param('id');
    if (!canAccessReview(deps, current, reviewId)) return c.json({ error: 'review not found' }, 404);
    if (!deps.service.cancelReview(reviewId)) return c.json({ error: 'review is not running' }, 409);
    return c.json(CancelReviewResponseSchema.parse({ cancelled: true }));
  });

  app.delete('/api/reviews/:id', (c) => {
    const current = c.get('user');
    const reviewId = c.req.param('id');
    if (!canAccessReview(deps, current, reviewId)) return c.json({ error: 'review not found' }, 404);
    return c.json(DeleteReviewResponseSchema.parse({ deleted: deps.store.deleteReview(reviewId) }));
  });

  app.get('/api/reviews/:id/export', (c) => {
    const current = c.get('user');
    const reviewId = c.req.param('id');
    if (!canAccessReview(deps, current, reviewId)) return c.json({ error: 'review not found' }, 404);
    const format = c.req.query('format') ?? 'markdown';
    if (format !== 'markdown' && format !== 'json' && format !== 'html') return c.json({ error: 'format must be markdown, html or json' }, 400);
    try {
      const report = deps.store.getReportDetail(reviewId);
      const body = format === 'json' ? renderJson(report) : format === 'html' ? renderHtml(report) : renderMarkdown(report);
      return c.body(body, 200, {
        'content-type': format === 'json' ? 'application/json; charset=utf-8' : format === 'html' ? 'text/html; charset=utf-8' : 'text/markdown; charset=utf-8',
        'content-disposition': `attachment; filename="${reviewId}.${format === 'json' ? 'json' : format === 'html' ? 'html' : 'md'}"`,
      });
    } catch (e) {
      if (e instanceof StoreError) return c.json({ error: e.message }, 404);
      throw e;
    }
  });

  app.get('/api/stats', zValidator('query', ReviewStatsQuerySchema), (c) => {
    const current = c.get('user');
    const query = c.req.valid('query');
    return c.json({
      stats: deps.store.getStats(
        current.role === 'admin' ? undefined : current.id,
        query,
      ),
    });
  });

  app.get('/api/reviews/:id', (c) => {
    const current = c.get('user');
    const reviewId = c.req.param('id');
    if (!canAccessReview(deps, current, reviewId)) return c.json({ error: 'review not found' }, 404);
    try {
      return c.json(deps.store.getReportDetail(reviewId));
    } catch (e) {
      if (e instanceof StoreError) return c.json({ error: e.message }, 404);
      throw e;
    }
  });

  app.patch('/api/findings/:id', zValidator('json', FalsePositiveSchema), (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) {
      return c.json({ error: 'invalid finding id' }, 400);
    }
    const current = c.get('user');
    const owner = deps.store.getFindingReviewOwner(id);
    if (owner !== current.id && current.role !== 'admin') {
      return c.json({ error: 'finding not found' }, 404);
    }
    const { isFalsePositive } = c.req.valid('json');
    if (!deps.store.setFindingFalsePositive(id, isFalsePositive)) {
      return c.json({ error: 'finding not found' }, 404);
    }
    return c.json({ updated: true });
  });

  app.get('/api/reviews/:id/events', (c) => {
    const current = c.get('user');
    const reviewId = c.req.param('id');
    if (!canAccessReview(deps, current, reviewId)) return c.json({ error: 'review not found' }, 404);

    const queue = new EventQueue<ReviewStageEvent>();
    const unsubscribe = deps.service.subscribe(reviewId, (event) => queue.push(event));
    // 订阅后再次检查，覆盖“任务刚完成、实时事件已广播但客户端尚未连接”的竞态窗口。
    const terminal = deps.service.getTerminalEvent(reviewId);
    if (terminal !== undefined) queue.push(terminal);
    c.req.raw.signal.addEventListener('abort', () => {
      unsubscribe();
      queue.close();
    });

    return streamSSE(c, async (stream) => {
      await stream.writeSSE({ event: 'subscribed', data: JSON.stringify({ reviewId }) });
      for (;;) {
        const event = await queue.next();
        if (event === undefined) break;
        await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
        if (event.type === 'completed' || event.type === 'failed' || event.type === 'cancelled') {
          // 终态事件即流结束；残余等待者由 close 唤醒
          unsubscribe();
          queue.close();
          break;
        }
      }
    });
  });

  // —— 管理员后台（配置、知识库、用户管理、系统概览）——
  app.get('/api/admin/config', requireAdmin, (c) => {
    const configPath = deps.configPath ?? '.ai-review.yml';
    const config = readAdminConfig(configPath);
    return c.json(AdminConfigResponseSchema.parse({ config: maskApiKey(config) }));
  });

  app.put('/api/admin/config', requireAdmin, zValidator('json', AdminConfigSchema), (c) => {
    const config = c.req.valid('json');
    const configPath = deps.configPath ?? '.ai-review.yml';
    const current = readAdminConfig(configPath);
    const persisted = config.llm.apiKey === '********'
      ? { ...config, llm: { ...config.llm, apiKey: current.llm.apiKey } }
      : config;
    writeFileSync(configPath, stringifyYaml(persisted), 'utf8');
    return c.json(AdminConfigResponseSchema.parse({ config: maskApiKey(persisted) }));
  });

  app.get('/api/admin/knowledge', requireAdmin, async (c) => {
    const status = deps.knowledge === undefined
      ? defaultKnowledgeStatus(deps.configPath ?? '.ai-review.yml')
      : await deps.knowledge.getStatus();
    return c.json(KnowledgeStatusResponseSchema.parse({ knowledge: status }));
  });

  app.post('/api/admin/knowledge/reindex', requireAdmin, (c) => {
    if (deps.knowledge === undefined) return c.json({ error: 'knowledge manager is not configured' }, 503);
    void deps.knowledge.reindex().catch(() => undefined);
    return c.json(KnowledgeReindexResponseSchema.parse({ accepted: true }), 202);
  });

  app.get('/api/admin/users', requireAdmin, (c) => {
    return c.json(UserListResponseSchema.parse({ users: deps.users.listUsers() }));
  });

  app.patch('/api/admin/users/:id', requireAdmin, zValidator('json', AdminUserPatchSchema), (c) => {
    const targetId = c.req.param('id');
    const current = c.get('user');
    const patch = c.req.valid('json');
    // 防自锁：唯一操作人不可自降权限或自禁用（admin 数量判定交给列表页展示，此处守住直接风险）
    if (targetId === current.id && (patch.role === 'user' || patch.status === 'disabled')) {
      return c.json({ error: 'cannot demote or disable your own account' }, 400);
    }
    let updated = false;
    if (patch.role !== undefined) updated = deps.users.updateUserRole(targetId, patch.role);
    if (patch.status !== undefined) updated = deps.users.setUserStatus(targetId, patch.status);
    if (!updated) return c.json({ error: 'user not found' }, 404);
    const nextUser = deps.users.getById(targetId);
    if (nextUser === undefined) return c.json({ error: 'user not found' }, 404);
    return c.json({ user: nextUser });
  });

  app.post('/api/admin/users/:id/reset-password', requireAdmin, async (c) => {
    const targetId = c.req.param('id');
    const newPassword = generateRandomPassword();
    if (!deps.users.resetPassword(targetId, await hashPassword(newPassword))) {
      return c.json({ error: 'user not found' }, 404);
    }
    // 旧凭据立即失效
    deps.users.deleteSessionsForUser(targetId);
    return c.json({ newPassword });
  });

  app.delete('/api/admin/users/:id', requireAdmin, (c) => {
    const targetId = c.req.param('id');
    if (targetId === c.get('user').id) {
      return c.json({ error: 'cannot delete your own account' }, 400);
    }
    if (!deps.users.deleteUser(targetId)) return c.json({ error: 'user not found' }, 404);
    return c.json({ deleted: true });
  });

  app.get('/api/admin/overview', requireAdmin, (c) => {
    const stats = deps.store.getStats();
    const cache = deps.store.getCacheSummary();
    const roleCounts = deps.users.getUserRoleCounts();
    const recentFailures = deps.store.listReviewPage({ status: 'failed', page: 1, pageSize: 5 }).reviews.map((review) => ({
      reviewId: review.reviewId,
      repoPath: review.repoPath,
      errorMessage: review.errorMessage,
      createdAt: review.createdAt,
    }));
    const failedTotal = deps.store.listReviewPage({ status: 'failed', page: 1, pageSize: 1 }).total;
    return c.json(
      AdminOverviewResponseSchema.parse({
        overview: {
          userCount: roleCounts.total,
          adminCount: roleCounts.admins,
          totalReviews: stats.totalReviews,
          totalFindings: stats.totalFindings,
          totalTokenUsed: stats.totalTokenUsed,
          cacheEntries: cache.entries,
          tokenSavedByCache: cache.tokenSaved,
          failureRate: stats.totalReviews === 0 ? 0 : failedTotal / stats.totalReviews,
          riskTrend: stats.riskTrend.filter((point) => {
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - 6);
            return point.date >= cutoff.toISOString().slice(0, 10);
          }),
          recentFailures,
        },
      }),
    );
  });

  // 统一结构化错误响应：未分类异常不向调用方泄露堆栈，仅透出 message
  app.onError((error, c) =>
    c.json({ error: error instanceof Error ? error.message : String(error) }, 500),
  );

  return app;
}

function readAdminConfig(path: string): ReturnType<typeof AiReviewConfigSchema.parse> {
  if (!existsSync(path)) return AiReviewConfigSchema.parse({});
  const parsed = parseYaml(readFileSync(path, 'utf8')) as unknown;
  return AiReviewConfigSchema.parse(parsed);
}

function maskApiKey(config: ReturnType<typeof AiReviewConfigSchema.parse>): ReturnType<typeof AiReviewConfigSchema.parse> {
  const apiKey = config.llm.apiKey;
  return {
    ...config,
    llm: {
      ...config.llm,
      apiKey: /^\$\{[A-Z0-9_]+\}$/.test(apiKey) ? apiKey : '********',
    },
  };
}

function defaultKnowledgeStatus(configPath: string): {
  status: 'disabled' | 'idle';
  indexDir: string;
  chunkCount: number;
  paths: string[];
  lastIndexedAt: string | null;
  error: string | null;
} {
  const config = readAdminConfig(configPath);
  return {
    status: config.rag.enabled ? 'idle' : 'disabled',
    indexDir: config.rag.indexDir,
    chunkCount: 0,
    paths: config.rag.knowledgeBasePaths,
    lastIndexedAt: null,
    error: null,
  };
}

/** 审查归属校验：非本人且非 admin 一律按不存在处理（避免探测有效审查 ID） */
function canAccessReview(
  deps: Pick<AppDeps, 'store' | 'service'>,
  current: SafeUser,
  reviewId: string,
): boolean {
  if (current.role === 'admin') return true;
  return deps.store.getReviewOwner(reviewId) === current.id || deps.service.getReviewOwner(reviewId) === current.id;
}
