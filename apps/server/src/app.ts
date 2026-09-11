import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { ReviewStore } from '@ai-review/db';
import { StoreError } from '@ai-review/db';
import type { ReviewStageEvent } from './review-service.js';
import type { ReviewService } from './review-service.js';

/** POST /api/reviews 入参（方案 2.3：API 入参经 zod 校验） */
export const StartReviewSchema = z.object({
  repoPath: z.string().min(1),
  mode: z.enum(['fast', 'full']).default('fast'),
});

/** PATCH /api/findings/:id 入参（Dashboard 误报标记回写） */
export const FalsePositiveSchema = z.object({ isFalsePositive: z.boolean() });

export type AppDeps = {
  store: ReviewStore;
  service: ReviewService;
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
 * - POST /api/reviews          触发审查（202 + reviewId）
 * - GET  /api/reviews          审查历史列表
 * - GET  /api/reviews/:id      报告详情（五段式 + 行级 findings）
 * - GET  /api/reviews/:id/events  实时进度 SSE
 * - PATCH /api/findings/:id    误报标记回写
 */
export function buildApp(deps: AppDeps): Hono {
  const app = new Hono();

  app.post('/api/reviews', zValidator('json', StartReviewSchema), (c) => {
    const { repoPath, mode } = c.req.valid('json');
    return c.json({ reviewId: deps.service.startReview({ repoPath, mode }) }, 202);
  });

  app.get('/api/reviews', (c) => c.json({ reviews: deps.store.listReviews() }));

  app.get('/api/reviews/:id', (c) => {
    try {
      return c.json(deps.store.getReportDetail(c.req.param('id')));
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
    const { isFalsePositive } = c.req.valid('json');
    if (!deps.store.setFindingFalsePositive(id, isFalsePositive)) {
      return c.json({ error: 'finding not found' }, 404);
    }
    return c.json({ updated: true });
  });

  app.get('/api/reviews/:id/events', (c) => {
    const reviewId = c.req.param('id');
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

  // 统一结构化错误响应：未分类异常不向调用方泄露堆栈，仅透出 message
  app.onError((error, c) =>
    c.json({ error: error instanceof Error ? error.message : String(error) }, 500),
  );

  return app;
}
