import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import type { Context, Hono, MiddlewareHandler } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { StoreError, type SafeUser, type UserStore } from '@ai-review/db';
import {
  AuthResponseSchema,
  ChangePasswordSchema,
  LoginSchema,
  RegisterSchema,
} from '@ai-review/shared';
import { createRateLimiter } from './rate-limit.js';
import type { AppEnv } from './app.js';

const scrypt = promisify(scryptCallback);

/** 会话 Cookie 名与有效期（7 天）；SSE 的 EventSource 无法带 Authorization 头，故用 Cookie 承载令牌 */
export const SESSION_COOKIE = 'ai_review_session';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// scrypt 参数：Node 默认 N=16384 / r=8 / p=1，满足交互式登录场景的暴力破解成本
const SALT_LENGTH = 16;

/**
 * 哈希密码（格式 `scrypt:<salt b64>:<hash b64>`）。
 * 明文密码与哈希仅存在于内存与 SQLite users 表，不写入任何日志或 API 响应。
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt.toString('base64')}:${derived.toString('base64')}`;
}

/** 校验密码；存储格式非法时按"不匹配"处理（兼容性优先于报错暴露） */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, hashB64] = stored.split(':');
  if (scheme !== 'scrypt' || saltB64 === undefined || hashB64 === undefined) return false;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  const derived = (await scrypt(password, salt, expected.length)) as Buffer;
  return timingSafeEqual(derived, expected);
}

/** 后台重置密码用：base64url 无歧义字符集，16 位满足长度要求且可口头转述 */
export function generateRandomPassword(): string {
  return randomBytes(12).toString('base64url');
}

export interface AuthDeps {
  users: UserStore;
  /** 是否允许开放注册（方案 8）；缺省：已存在用户时关闭，需管理员在后台创建 */
  registrationOpen?: boolean;
}

/** requireAuth 中间件工厂：校验 Cookie 会话，通过后把 SafeUser 写入 Context 变量 */
export function createRequireAuth(deps: AuthDeps): MiddlewareHandler<AppEnv> {
  return createMiddleware<AppEnv>(async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token === undefined || token === '') {
      return c.json({ error: '请先登录' }, 401);
    }
    const user = deps.users.getSessionUser(token);
    if (user === undefined) {
      return c.json({ error: '登录已失效，请重新登录' }, 401);
    }
    if (user.status === 'disabled') {
      return c.json({ error: '账号已被禁用' }, 403);
    }
    c.set('user', user);
    await next();
  });
}

/** requireAdmin 中间件：必须挂在 requireAuth 之后（依赖 Context 中的 user 变量） */
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.get('user');
  // 管理员判定：拥有 '*' 权限或 role 字段为 admin（assignRoles 会依据角色自动派生 role）
  if (user.permissions.includes('*') === false && user.role !== 'admin') {
    return c.json({ error: '需要管理员权限' }, 403);
  }
  await next();
});

/**
 * requirePermission(permission) 中间件：必须挂在 requireAuth 之后。
 * 按页面权限校验：拥有 '*' 权限、admin 角色、或精确命中 permission 时放行。
 * 用于为被授予部分管理页权限的普通用户开放对应接口。
 */
export function requirePermission(permission: string): MiddlewareHandler<AppEnv> {
  return createMiddleware<AppEnv>(async (c, next) => {
    const user = c.get('user');
    const allowed =
      user.permissions.includes('*') ||
      user.role === 'admin' ||
      user.permissions.includes(permission);
    if (!allowed) {
      return c.json({ error: '没有执行此操作的权限' }, 403);
    }
    await next();
  });
}

/**
 * requireAnyPermission(...permissions)：命中任一权限即放行（`*`/admin 角色始终放行）。
 * 用于同一接口服务多个页面权限的场景，如配置接口同时服务 /admin/config 与 /admin/ai。
 */
export function requireAnyPermission(...permissions: string[]): MiddlewareHandler<AppEnv> {
  return createMiddleware<AppEnv>(async (c, next) => {
    const user = c.get('user');
    const allowed =
      user.permissions.includes('*') ||
      user.role === 'admin' ||
      permissions.some((p) => user.permissions.includes(p));
    if (!allowed) {
      return c.json({ error: '没有执行此操作的权限' }, 403);
    }
    await next();
  });
}

function issueSessionCookie(deps: AuthDeps, c: Context, userId: string): void {
  const token = deps.users.createSession(userId, new Date(Date.now() + SESSION_TTL_MS));
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
    // HTTPS 部署下强制 secure（方案 6）；默认仅在生产环境开启，兼容本地 http 开发
    secure: process.env.NODE_ENV === 'production' || process.env.AI_REVIEW_COOKIE_SECURE === 'true',
  });
}

// 未知用户的“哑哈希”：登录时对不存在用户也执行一次等代价 scrypt，抹平响应时间差（方案 7）
let dummyHashPromise: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  if (dummyHashPromise === undefined) {
    dummyHashPromise = hashPassword('__dummy__rate-limit__');
  }
  return dummyHashPromise;
}

/**
 * 注册认证路由（匿名可访问的 register/login 与需登录的 me/change-password；
 * logout 无条件生效，便于清理悬挂 Cookie）。
 * 挂载前缀 /api/auth/*——数据隔离中间件对此前缀放行。
 */
export function registerAuthRoutes(app: Hono<AppEnv>, deps: AuthDeps): void {
  // 认证端点限流（方案 1）：按 IP+路径 每分钟 10 次，防在线爆破与撞库。
  // 每 App 实例独立计数，避免测试等共享模块级状态互相干扰。
  const authLimiter = createRateLimiter({ windowMs: 60_000, max: 10, keyByPath: true });

  app.post('/api/auth/register', authLimiter, zValidator('json', RegisterSchema), async (c) => {
    const { username, password } = c.req.valid('json');
    // 开放注册（方案 8）：显式配置优先；缺省为“首个管理员引导后关闭”
    const openRegistration =
      deps.registrationOpen !== undefined
        ? deps.registrationOpen
        : process.env.AI_REVIEW_ALLOW_REGISTER === 'true' || deps.users.countUsers() === 0;
    if (!openRegistration) {
      return c.json(
        { error: '注册已关闭，请联系管理员开通账号' },
        403,
      );
    }
    let user: SafeUser;
    try {
      user = deps.users.createUser({ username, passwordHash: await hashPassword(password) });
    } catch (e) {
      if (e instanceof StoreError) return c.json({ error: e.message }, 409);
      throw e;
    }
    issueSessionCookie(deps, c, user.id);
    return c.json(AuthResponseSchema.parse({ user }), 201);
  });

  app.post('/api/auth/login', authLimiter, zValidator('json', LoginSchema), async (c) => {
    const { username, password } = c.req.valid('json');
    const user = deps.users.getByUsername(username);
    // 用户不存在与密码错误统一口径，避免枚举有效用户名；
    // 无论用户是否存在都无条件执行一次等代价 scrypt 校验（方案 7 恒时化）——
    // 若在 user === undefined 时短路跳过 verifyPassword，未知用户名会显著快于错误密码，
    // 时间侧信道依旧存在。
    const storedHash =
      user === undefined
        ? await getDummyHash()
        : (deps.users.getPasswordHash(user.id) ?? (await getDummyHash()));
    const passwordOk = await verifyPassword(password, storedHash);
    if (user === undefined || !passwordOk) {
      return c.json({ error: '用户名或密码错误' }, 401);
    }
    if (user.status === 'disabled') {
      return c.json({ error: '账号已被禁用' }, 403);
    }
    issueSessionCookie(deps, c, user.id);
    deps.users.touchLastLogin(user.id);
    return c.json(AuthResponseSchema.parse({ user }));
  });

  app.post('/api/auth/logout', (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token !== undefined) deps.users.deleteSession(token);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ loggedOut: true });
  });

  app.get('/api/auth/me', createRequireAuth(deps), (c) => {
    return c.json(AuthResponseSchema.parse({ user: c.get('user') }));
  });

  app.post(
    '/api/auth/change-password',
    createRequireAuth(deps),
    zValidator('json', ChangePasswordSchema),
    async (c) => {
      const user = c.get('user');
      const { oldPassword, newPassword } = c.req.valid('json');
      const storedHash = deps.users.getPasswordHash(user.id);
      if (storedHash === undefined || !(await verifyPassword(oldPassword, storedHash))) {
        return c.json({ error: '当前密码不正确' }, 400);
      }
      deps.users.resetPassword(user.id, await hashPassword(newPassword));
      // 旧密码可能已泄露：改密后吊销全部会话，强制所有端重新登录
      deps.users.deleteSessionsForUser(user.id);
      deleteCookie(c, SESSION_COOKIE, { path: '/' });
      return c.json({ changed: true });
    },
  );
}
