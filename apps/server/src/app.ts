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
} from '@ai-review/shared';
import { createRequireAuth, generateRandomPassword, hashPassword, registerAuthRoutes, requireAdmin } from './auth.js';
import type { ReviewMetrics } from './metrics.js';
import type { ReviewStageEvent } from './review-service.js';
import type { ReviewService } from './review-service.js';

/** POST /api/reviews 入参（方案 2.3：API 入参经 zod 校验） */
export const StartReviewSchema = z.object({
  repoPath: z.string().min(1),
  mode: z.enum(['fast', 'full']).default('fast'),
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
    const { repoPath, mode } = c.req.valid('json');
    const createdBy = c.get('user').id;
    return c.json({ reviewId: deps.service.startReview({ repoPath, mode, createdBy }) }, 202);
  });

  // 数据隔离：admin 可见全部；普通用户仅见本人发起的记录（含 CLI 存量之外的过滤）
  app.get('/api/reviews', (c) => {
    const current = c.get('user');
    const reviews =
      current.role === 'admin'
        ? deps.store.listReviews()
        : deps.store.listReviews({ createdBy: current.id });
    return c.json({ reviews });
  });

  app.get('/api/stats', (c) => {
    const current = c.get('user');
    return c.json({ stats: deps.store.getStats(current.role === 'admin' ? undefined : current.id) });
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
        if (event.type === 'completed' || event.type === 'failed') {
          // 终态事件即流结束；残余等待者由 close 唤醒
          unsubscribe();
          queue.close();
          break;
        }
      }
    });
  });

  // —— 管理员后台（方案 3.10 用户管理/系统概览）——
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

/** 审查归属校验：非本人且非 admin 一律按不存在处理（避免探测有效审查 ID） */
function canAccessReview(
  deps: Pick<AppDeps, 'store'>,
  current: SafeUser,
  reviewId: string,
): boolean {
  if (current.role === 'admin') return true;
  return deps.store.getReviewOwner(reviewId) === current.id;
}
