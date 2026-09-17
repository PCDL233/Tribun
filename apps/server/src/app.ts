import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve as resolvePath, sep } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { compress } from 'hono/compress';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { SafeUser, ReviewStore, UserStore } from '@ai-review/db';
import { StoreError } from '@ai-review/db';
import {
  AdminOverviewResponseSchema,
  AdminUserPatchSchema,
  AdminCreateUserSchema,
  AuthResponseSchema,
  UserListResponseSchema,
  RoleInputSchema,
  RoleListResponseSchema,
  RoleResponseSchema,
  AssignRolesSchema,
  ReviewListQuerySchema,
  ReviewStatsQuerySchema,
  ReviewDiffResponseSchema,
  DeleteReviewResponseSchema,
  CancelReviewResponseSchema,
  AdminConfigSchema,
  AdminConfigResponseSchema,
  AdminRulesResponseSchema,
  AdminRulesUpdateSchema,
  CustomRuleTestRequestSchema,
  CustomRuleTestResultSchema,
  AiReviewConfigSchema,
  KnowledgeReindexResponseSchema,
  KnowledgeStatusResponseSchema,
} from '@ai-review/shared';
import { renderHtml, renderJson, renderMarkdown } from '@ai-review/report';
import { analyzeComplexity, compileCustomRulePattern, scanDiffTextForSecrets, testCustomRuleOnSamples } from '@ai-review/tools';
import {
  createRequireAuth,
  generateRandomPassword,
  hashPassword,
  registerAuthRoutes,
  requireAnyPermission,
  requirePermission,
} from './auth.js';
import type { ReviewMetrics } from './metrics.js';
import type { ReviewStageEvent } from './review-service.js';
import { AvatarError, AvatarStore, AVATAR_MAX_BYTES } from './avatar.js';
import { createRateLimiter } from './rate-limit.js';
import { securityHeaders } from './security-headers.js';
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
  /** 允许审查的仓库根目录（方案 3：防任意本地路径读取）；缺省为 process.cwd() */
  allowedRoots?: readonly string[];
  /** 是否允许开放注册（方案 8）；缺省：已存在用户后关闭 */
  registrationOpen?: boolean;
  /** 可选知识库管理器，未装配时返回 idle 状态 */
  knowledge?: KnowledgeManager;
  /** 可选头像存储；未装配时头像上传返回 503 */
  avatars?: AvatarStore;
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
 * - POST /api/admin/init-config 生成默认配置文件（admin）
 * - GET  /api/admin/rules     自定义审查规则列表（admin）
 * - PUT  /api/admin/rules     保存自定义审查规则（admin）
 * - POST /api/admin/rules/test 试跑自定义审查规则（admin）
 * - POST /api/admin/tools/secret-scan diff 密钥扫描（admin）
 * - POST /api/admin/tools/complexity 源码复杂度扫描（admin）
 * - GET  /api/admin/tools/hook-script 获取 pre-commit hook 脚本（admin）
 * - GET  /metrics              Prometheus 指标（admin）
 */
/**
 * 校验 repoPath 是否落在允许的根目录内（方案 3）：
 * 拒绝空路径、绝对路径逃逸到允许根之外的情况，防任意本地目录/文件读取。
 */
export function assertRepoPathAllowed(
  repoPath: string,
  roots: readonly string[] = [process.cwd()],
): void {
  if (repoPath === '') throw new Error('repoPath must not be empty');
  const resolved = resolvePath(repoPath);
  for (const root of roots) {
    const rootResolved = resolvePath(root);
    // 目录边界：根目录本身或其子路径合法；根目录已以分隔符结尾（如 Windows 'D:/'→'D:\\'）时不重复追加
    const boundary = rootResolved.endsWith(sep) ? rootResolved : rootResolved + sep;
    if (resolved === rootResolved || resolved.startsWith(boundary)) return;
  }
  throw new Error('repoPath is outside the allowed workspace roots');
}

/**
 * 请求体大小上限（方案 2：防内存 DoS）。
 * - 有 Content-Length：先按头快速拒绝（读 body 前拦截）
 * - 无论有无 CL 均逐块计数实际字节：修复 chunked/伪造 CL 绕过，超限即断流 413；
 *   未超限则回填等价 Request，供后续 zValidator / formData 正常解析
 * - exempt：对该路径跳过（avatar 有专属上限）
 */
function limitBody(maxBytes: number, exempt?: (path: string) => boolean) {
  return async (c: import('hono').Context, next: () => Promise<void>) => {
    if (exempt !== undefined && exempt(c.req.path)) return next();
    const raw = c.req.raw;
    if (raw.body === null || raw.method === 'GET' || raw.method === 'HEAD') return next();
    const declared = c.req.header('content-length');
    if (declared !== undefined) {
      const length = Number(declared);
      // CL 仅作快速拒绝；真实体积仍按流计数（声明值可与 chunked 实际体积不符）
      if (Number.isFinite(length) && length > maxBytes) {
        return c.json({ error: '请求体过大' }, 413);
      }
    }
    const reader = raw.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done === true) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return c.json({ error: '请求体过大' }, 413);
      }
      chunks.push(value);
    }
    // 回填等价 Request（Blob 体，无 CL 依赖），后续 c.req.json()/formData() 从它读取
    const headers = new Headers(raw.headers);
    headers.set('content-length', String(total));
    c.req.raw = new Request(raw.url, { method: raw.method, headers, body: new Blob(chunks) });
    await next();
  };
}

// 响应压缩（方案 12）：模块级创建一次复用；SSE 端点在挂载处跳过，避免破坏流式分块
const gzipMiddleware = compress({ encoding: 'gzip' });

export function buildApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // —— 全局安全响应头（方案 5）——
  app.use('*', securityHeaders());

  // —— 响应压缩（方案 12）：跳过 SSE 实时事件端点，避免破坏流式分块 ——
  app.use('*', async (c, next) => {
    if (c.req.path.endsWith('/events')) return next();
    return gzipMiddleware(c, next);
  });

  // —— /api/* 泛化限流（方案 1：认证端点另有更严限流）——
  app.use('/api/*', createRateLimiter({ windowMs: 60_000, max: 300 }));

  // —— /api/* 请求体大小上限（方案 2）：avatar 路由有专属上限（2MB+multipart 开销），在此豁免 ——
  app.use('/api/auth/avatar', limitBody(AVATAR_MAX_BYTES + 256 * 1024));
  app.use(
    '/api/*',
    limitBody(1024 * 1024, (path) => path === '/api/auth/avatar'),
  );

  // —— 认证路由（匿名可访问 + me/change-password 自带 requireAuth）——
  registerAuthRoutes(app, {
    users: deps.users,
    ...(deps.registrationOpen === undefined ? {} : { registrationOpen: deps.registrationOpen }),
  });

  // —— 数据隔离：除 auth 前缀外所有 /api 请求必须登录 ——
  const requireAuth = createRequireAuth({ users: deps.users });
  app.use('/api/*', async (c, next) => {
    if (c.req.path.startsWith('/api/auth/')) return next();
    return requireAuth(c, next);
  });

  // 头像上传：仅本人（requireAuth），multipart 表单字段名为 avatar。
  // /api/auth/* 被上方全局中间件放行，故在此显式挂 requireAuth。
  app.post('/api/auth/avatar', createRequireAuth({ users: deps.users }), async (c) => {
    if (deps.avatars === undefined) {
      return c.json({ error: '头像存储未配置，请联系管理员' }, 503);
    }
    // 读取前按 Content-Length 前置拦截，避免超大 multipart 被整体读入内存（方案 2）；
    // chunked / 无 CL 请求由上方 limitBody 流式计数兜底
    const avatarContentLength = Number(c.req.header('content-length') ?? 0);
    if (
      Number.isFinite(avatarContentLength) &&
      avatarContentLength > AVATAR_MAX_BYTES + 256 * 1024
    ) {
      return c.json({ error: '图片大小不能超过 2MB' }, 413);
    }
    let body: FormData;
    try {
      body = await c.req.formData();
    } catch {
      return c.json({ error: '图片上传数据无效，请重新选择图片' }, 400);
    }
    const file = body.get('avatar');
    if (!(file instanceof File)) {
      return c.json({ error: '未接收到头像文件' }, 400);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength > AVATAR_MAX_BYTES) {
      return c.json({ error: '图片大小不能超过 2MB' }, 413);
    }
    try {
      deps.avatars.save(c.get('user').id, bytes);
    } catch (e) {
      if (e instanceof AvatarError) return c.json({ error: e.message }, 400);
      throw e;
    }
    deps.users.setAvatarUrl(c.get('user').id, `/api/users/${c.get('user').id}/avatar`);
    const user = deps.users.getById(c.get('user').id);
    if (user === undefined) return c.json({ error: '用户不存在' }, 404);
    return c.json(AuthResponseSchema.parse({ user }));
  });

  // 头像读取：登录可见（业务侧可读任何用户头像，供后台列表展示）
  app.get('/api/users/:id/avatar', (c) => {
    if (deps.avatars === undefined)
      return c.json({ error: '头像存储未配置，请联系管理员' }, 503);
    const target = deps.users.getById(c.req.param('id'));
    if (target === undefined || target.avatarUrl === null)
      return c.json({ error: '头像不存在' }, 404);
    const avatar = deps.avatars.read(target.id);
    if (avatar === null) return c.json({ error: '头像不存在' }, 404);
    return c.body(avatar.buffer, 200, {
      'content-type': avatar.mime,
      'cache-control': 'no-store',
    });
  });

  // Prometheus 拉取端点：仅 admin 可读（审查量与 token 成本属团队敏感数据）
  app.get('/metrics', requireAuth, requirePermission('/admin/metrics'), async (c) =>
    c.text(await deps.metrics.render(), 200, { 'content-type': 'text/plain; version=0.0.4' }),
  );

  app.post('/api/reviews', zValidator('json', StartReviewSchema), (c) => {
    const { repoPath, mode, blockOn } = c.req.valid('json');
    // 方案 3：仅允许审查落在白名单根目录内的仓库，防任意本地路径读取
    try {
      assertRepoPathAllowed(repoPath, deps.allowedRoots ?? [process.cwd()]);
    } catch {
      return c.json({ error: '仓库路径不在允许的目录白名单内' }, 400);
    }
    const createdBy = c.get('user').id;
    return c.json(
      {
        reviewId: deps.service.startReview({
          repoPath,
          mode,
          createdBy,
          ...(blockOn === undefined ? {} : { blockOn }),
        }),
      },
      202,
    );
  });

  // 数据隔离：admin 可见全部；普通用户仅见本人发起的记录，筛选与分页在数据库侧完成
  app.get('/api/reviews', zValidator('query', ReviewListQuerySchema), (c) => {
    const current = c.get('user');
    const queryParams = c.req.query();
    const query = c.req.valid('query');
    const page = deps.store.listReviewPage(
      query,
      current.role === 'admin' ? undefined : current.id,
    );
    // 保留无参数旧客户端的响应形状；显式分页参数使用完整分页契约。
    if (Object.keys(queryParams).length === 0) return c.json({ reviews: page.reviews });
    return c.json(page);
  });

  app.get('/api/reviews/:id/diff', (c) => {
    const current = c.get('user');
    const reviewId = c.req.param('id');
    if (!canAccessReview(deps, current, reviewId))
      return c.json({ error: '审查记录不存在' }, 404);
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
    if (!canAccessReview(deps, current, reviewId))
      return c.json({ error: '审查记录不存在' }, 404);
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
    if (!canAccessReview(deps, current, reviewId))
      return c.json({ error: '审查记录不存在' }, 404);
    if (!deps.service.cancelReview(reviewId))
      return c.json({ error: '审查任务已结束或不存在' }, 409);
    return c.json(CancelReviewResponseSchema.parse({ cancelled: true }));
  });

  app.delete('/api/reviews/:id', (c) => {
    const current = c.get('user');
    const reviewId = c.req.param('id');
    if (!canAccessReview(deps, current, reviewId))
      return c.json({ error: '审查记录不存在' }, 404);
    return c.json(DeleteReviewResponseSchema.parse({ deleted: deps.store.deleteReview(reviewId) }));
  });

  app.get('/api/reviews/:id/export', (c) => {
    const current = c.get('user');
    const reviewId = c.req.param('id');
    if (!canAccessReview(deps, current, reviewId))
      return c.json({ error: '审查记录不存在' }, 404);
    const format = c.req.query('format') ?? 'markdown';
    if (format !== 'markdown' && format !== 'json' && format !== 'html')
      return c.json({ error: '导出格式仅支持 markdown / html / json' }, 400);
    try {
      const report = deps.store.getReportDetail(reviewId);
      const body =
        format === 'json'
          ? renderJson(report)
          : format === 'html'
            ? renderHtml(report)
            : renderMarkdown(report);
      return c.body(body, 200, {
        'content-type':
          format === 'json'
            ? 'application/json; charset=utf-8'
            : format === 'html'
              ? 'text/html; charset=utf-8'
              : 'text/markdown; charset=utf-8',
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
      stats: deps.store.getStats(current.role === 'admin' ? undefined : current.id, query),
    });
  });

  app.get('/api/reviews/:id', (c) => {
    const current = c.get('user');
    const reviewId = c.req.param('id');
    if (!canAccessReview(deps, current, reviewId))
      return c.json({ error: '审查记录不存在' }, 404);
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
      return c.json({ error: '发现 ID 无效' }, 400);
    }
    const current = c.get('user');
    const owner = deps.store.getFindingReviewOwner(id);
    if (owner !== current.id && current.role !== 'admin') {
      return c.json({ error: '发现记录不存在' }, 404);
    }
    const { isFalsePositive } = c.req.valid('json');
    if (!deps.store.setFindingFalsePositive(id, isFalsePositive)) {
      return c.json({ error: '发现记录不存在' }, 404);
    }
    return c.json({ updated: true });
  });

  app.get('/api/reviews/:id/events', (c) => {
    const current = c.get('user');
    const reviewId = c.req.param('id');
    if (!canAccessReview(deps, current, reviewId))
      return c.json({ error: '审查记录不存在' }, 404);

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
  app.get('/api/admin/config', requireAnyPermission('/admin/config', '/admin/ai'), (c) => {
    const configPath = deps.configPath ?? '.ai-review.yml';
    const config = readAdminConfig(configPath);
    return c.json(AdminConfigResponseSchema.parse({ config: maskApiKey(config) }));
  });

  app.put(
    '/api/admin/config',
    requireAnyPermission('/admin/config', '/admin/ai'),
    zValidator('json', AdminConfigSchema),
    (c) => {
      const config = c.req.valid('json');
      const configPath = deps.configPath ?? '.ai-review.yml';
      const current = readAdminConfig(configPath);
      const persisted = {
        ...(config.llm.apiKey === '********'
          ? { ...config, llm: { ...config.llm, apiKey: current.llm.apiKey } }
          : config),
        // 系统配置表单不渲染规则字段：入参为空时保留既有规则，避免保存配置时误清空自定义规则
        customRules: config.customRules.length === 0 ? current.customRules : config.customRules,
      };
      writeFileSync(configPath, stringifyYaml(persisted), 'utf8');
      return c.json(AdminConfigResponseSchema.parse({ config: maskApiKey(persisted) }));
    },
  );

  app.post('/api/admin/init-config', requirePermission('/admin/init'), (c) => {
    const configPath = deps.configPath ?? '.ai-review.yml';
    if (existsSync(configPath)) {
      return c.json({ error: '配置文件已存在' }, 409);
    }
    const config = AiReviewConfigSchema.parse({});
    writeFileSync(configPath, stringifyYaml(config), 'utf8');
    return c.json(AdminConfigResponseSchema.parse({ config: maskApiKey(config) }));
  });

  // —— 自定义审查规则（admin）：规则随配置持久化，经 custom_rule_check 工具在审查时生效 ——
  app.get('/api/admin/rules', requirePermission('/admin/rules'), (c) => {
    const configPath = deps.configPath ?? '.ai-review.yml';
    const config = readAdminConfig(configPath);
    return c.json(AdminRulesResponseSchema.parse({ rules: config.customRules }));
  });

  app.put(
    '/api/admin/rules',
    requirePermission('/admin/rules'),
    zValidator('json', AdminRulesUpdateSchema),
    (c) => {
      const { rules } = c.req.valid('json');
      // 正则可编译校验：非法表达式在保存时即拒绝，避免规则在审查中静默失效
      const invalid = rules.find((rule) => compileCustomRulePattern(rule) === null);
      if (invalid !== undefined) {
        return c.json(
          { error: `规则「${invalid.name}」的正则表达式无法编译，请检查 pattern 与 flags` },
          400,
        );
      }
      const configPath = deps.configPath ?? '.ai-review.yml';
      const current = readAdminConfig(configPath);
      const persisted = { ...current, customRules: rules };
      writeFileSync(configPath, stringifyYaml(persisted), 'utf8');
      return c.json(AdminRulesResponseSchema.parse({ rules: persisted.customRules }));
    },
  );

  app.post(
    '/api/admin/rules/test',
    requirePermission('/admin/rules'),
    zValidator('json', CustomRuleTestRequestSchema),
    (c) => {
      const { rule, sampleDiffText, sampleSource } = c.req.valid('json');
      if (compileCustomRulePattern(rule) === null) {
        return c.json({ error: '正则表达式无法编译，请检查 pattern 与 flags' }, 400);
      }
      const matches = testCustomRuleOnSamples(rule, {
        diffText: sampleDiffText,
        source: sampleSource,
      });
      return c.json(CustomRuleTestResultSchema.parse({ matches }));
    },
  );

  app.post(
    '/api/admin/tools/secret-scan',
    requirePermission('/admin/tools'),
    zValidator('json', z.object({ diffText: z.string() })),
    (c) => {
      const { diffText } = c.req.valid('json');
      return c.json({ findings: scanDiffTextForSecrets(diffText) });
    },
  );

  app.post(
    '/api/admin/tools/complexity',
    requirePermission('/admin/tools'),
    zValidator(
      'json',
      z.object({ source: z.string(), threshold: z.coerce.number().int().min(1).optional() }),
    ),
    (c) => {
      const { source, threshold } = c.req.valid('json');
      return c.json({ functions: analyzeComplexity(source, threshold) });
    },
  );

  app.get('/api/admin/tools/hook-script', requirePermission('/admin/hook'), (c) => {
    const script = [
      '# ai-review pre-commit hook (husky v9, Windows/macOS/Linux universal)',
      '# fast mode target <= 15s; BLOCKER findings block the commit',
      'ai-review run --staged --mode fast --block-on BLOCKER',
      '',
    ].join('\n');
    return c.text(script);
  });

  app.get('/api/admin/knowledge', requirePermission('/admin/knowledge'), async (c) => {
    const status =
      deps.knowledge === undefined
        ? defaultKnowledgeStatus(deps.configPath ?? '.ai-review.yml')
        : await deps.knowledge.getStatus();
    return c.json(KnowledgeStatusResponseSchema.parse({ knowledge: status }));
  });

  app.post('/api/admin/knowledge/reindex', requirePermission('/admin/knowledge'), (c) => {
    if (deps.knowledge === undefined)
      return c.json({ error: '知识库服务未配置' }, 503);
    void deps.knowledge.reindex().catch(() => undefined);
    return c.json(KnowledgeReindexResponseSchema.parse({ accepted: true }), 202);
  });

  app.get('/api/admin/users', requirePermission('/admin/users'), (c) => {
    return c.json(UserListResponseSchema.parse({ users: deps.users.listUsers() }));
  });

  app.post(
    '/api/admin/users',
    requirePermission('/admin/users'),
    zValidator('json', AdminCreateUserSchema),
    async (c) => {
      const { username, password } = c.req.valid('json');
      let user: SafeUser;
      try {
        // 管理员代办创建：固定为普通用户角色
        user = deps.users.createUser({
          username,
          passwordHash: await hashPassword(password),
          role: 'user',
        });
      } catch (e) {
        if (e instanceof StoreError) return c.json({ error: e.message }, 409);
        throw e;
      }
      return c.json(AuthResponseSchema.parse({ user }), 201);
    },
  );

  // —— 角色管理（RBAC）：拥有角色管理权限即可 ——
  app.get('/api/admin/roles', requirePermission('/admin/roles'), (c) => {
    return c.json(RoleListResponseSchema.parse({ roles: deps.users.listRoles() }));
  });

  app.post(
    '/api/admin/roles',
    requirePermission('/admin/roles'),
    zValidator('json', RoleInputSchema),
    (c) => {
      const input = c.req.valid('json');
      try {
        const role = deps.users.createRole({
          name: input.name,
          description: input.description ?? null,
          priority: input.priority,
          permissions: input.permissions,
        });
        return c.json(RoleResponseSchema.parse({ role }), 201);
      } catch (e) {
        if (e instanceof StoreError) return c.json({ error: e.message }, 409);
        throw e;
      }
    },
  );

  app.put(
    '/api/admin/roles/:id',
    requirePermission('/admin/roles'),
    zValidator('json', RoleInputSchema),
    (c) => {
      const input = c.req.valid('json');
      try {
        const role = deps.users.updateRole(c.req.param('id'), {
          name: input.name,
          description: input.description ?? null,
          priority: input.priority,
          permissions: input.permissions,
        });
        if (role === undefined) return c.json({ error: '角色不存在' }, 404);
        return c.json(RoleResponseSchema.parse({ role }));
      } catch (e) {
        if (e instanceof StoreError) return c.json({ error: e.message }, 409);
        throw e;
      }
    },
  );

  app.delete('/api/admin/roles/:id', requirePermission('/admin/roles'), (c) => {
    try {
      if (!deps.users.deleteRole(c.req.param('id'))) {
        return c.json({ error: '角色不存在' }, 404);
      }
      return c.json({ deleted: true });
    } catch (e) {
      if (e instanceof StoreError) return c.json({ error: e.message }, 400);
      throw e;
    }
  });

  // 给用户分配角色（整体替换）
  app.put(
    '/api/admin/users/:id/roles',
    requirePermission('/admin/users'),
    zValidator('json', AssignRolesSchema),
    (c) => {
      const { roleIds } = c.req.valid('json');
      if (!deps.users.assignRoles(c.req.param('id'), roleIds)) {
        return c.json({ error: '用户不存在' }, 404);
      }
      const user = deps.users.getById(c.req.param('id'));
      if (user === undefined) return c.json({ error: '用户不存在' }, 404);
      return c.json(AuthResponseSchema.parse({ user }));
    },
  );

  app.patch(
    '/api/admin/users/:id',
    requirePermission('/admin/users'),
    zValidator('json', AdminUserPatchSchema),
    (c) => {
      const targetId = c.req.param('id');
      const current = c.get('user');
      const patch = c.req.valid('json');
      // 防自锁：唯一操作人不可自降权限或自禁用（admin 数量判定交给列表页展示，此处守住直接风险）
      if (targetId === current.id && (patch.role === 'user' || patch.status === 'disabled')) {
        return c.json({ error: '不能降级或禁用当前登录账号' }, 400);
      }
      let updated = false;
      if (patch.role !== undefined) updated = deps.users.updateUserRole(targetId, patch.role);
      if (patch.status !== undefined) updated = deps.users.setUserStatus(targetId, patch.status);
      if (!updated) return c.json({ error: '用户不存在' }, 404);
      const nextUser = deps.users.getById(targetId);
      if (nextUser === undefined) return c.json({ error: '用户不存在' }, 404);
      return c.json({ user: nextUser });
    },
  );

  app.post('/api/admin/users/:id/reset-password', requirePermission('/admin/users'), async (c) => {
    const targetId = c.req.param('id');
    const newPassword = generateRandomPassword();
    if (!deps.users.resetPassword(targetId, await hashPassword(newPassword))) {
      return c.json({ error: '用户不存在' }, 404);
    }
    // 旧凭据立即失效
    deps.users.deleteSessionsForUser(targetId);
    return c.json({ newPassword });
  });

  app.delete('/api/admin/users/:id', requirePermission('/admin/users'), (c) => {
    const targetId = c.req.param('id');
    if (targetId === c.get('user').id) {
      return c.json({ error: '不能删除当前登录账号' }, 400);
    }
    if (!deps.users.deleteUser(targetId)) return c.json({ error: '用户不存在' }, 404);
    return c.json({ deleted: true });
  });

  app.get('/api/admin/overview', requirePermission('/admin'), (c) => {
    const stats = deps.store.getStats();
    const cache = deps.store.getCacheSummary();
    const roleCounts = deps.users.getUserRoleCounts();
    const recentFailures = deps.store
      .listReviewPage({ status: 'failed', page: 1, pageSize: 5 })
      .reviews.map((review) => ({
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

  // 统一错误响应（方案 4）：完整异常仅记录到服务端日志，向调用方返回泛化信息，避免泄露内部路径/细节
  app.onError((error, c) => {
    console.error(`[ai-review] unhandled error on ${c.req.method} ${c.req.path}:`, error);
    return c.json({ error: '服务器内部错误' }, 500);
  });

  return app;
}

function readAdminConfig(path: string): ReturnType<typeof AiReviewConfigSchema.parse> {
  if (!existsSync(path)) return AiReviewConfigSchema.parse({});
  const parsed = parseYaml(readFileSync(path, 'utf8')) as unknown;
  return AiReviewConfigSchema.parse(parsed);
}

function maskApiKey(
  config: ReturnType<typeof AiReviewConfigSchema.parse>,
): ReturnType<typeof AiReviewConfigSchema.parse> {
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
  return (
    deps.store.getReviewOwner(reviewId) === current.id ||
    deps.service.getReviewOwner(reviewId) === current.id
  );
}
