import { randomBytes, randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { asc, eq, inArray, lt } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { Role, User } from '@ai-review/shared';
import { roles, sessions, userRoles, users } from './schema.js';
import { StoreError } from './store.js';

/** 对外安全的用户模型（shared User 契约，永不包含 passwordHash） */
export type SafeUser = User;

/**
 * 用户与会话存储（SQLite，与 ReviewStore 共用同一连接，见 openSqlite）。
 * 密码哈希由调用方（server 的 auth 模块）计算后传入——本类只管持久化，
 * 哈希算法不属于存储职责。
 */
export class UserStore {
  private readonly db: BetterSQLite3Database;

  constructor(sqlite: Database.Database) {
    // 单独构造时（如测试）也保证外键级联生效；重复 pragma 幂等
    sqlite.pragma('foreign_keys = ON');
    this.db = drizzle(sqlite);
  }

  /**
   * 创建用户。首个用户自动授予 admin 角色（团队自助部署时产生第一任管理员）。
   * @throws {StoreError} 用户名已存在
   */
  public createUser(input: {
    username: string;
    passwordHash: string;
    role?: 'admin' | 'user';
  }): SafeUser {
    const existing = this.getByUsername(input.username);
    if (existing !== undefined) {
      throw new StoreError(`username already taken: ${input.username}`);
    }
    const isFirstUser = this.countUsers() === 0;
    const row = {
      id: randomUUID(),
      username: input.username,
      passwordHash: input.passwordHash,
      role: input.role ?? (isFirstUser ? ('admin' as const) : ('user' as const)),
      status: 'active' as const,
      avatarUrl: null as string | null,
    };
    this.db.insert(users).values(row).run();
    // 分配默认角色：管理员→内置 admin 角色；普通用户→内置 user 角色
    const defaultRole = row.role === 'admin' ? 'role-admin' : 'role-user';
    this.assignRoles(row.id, [defaultRole]);
    const access = this.getUserAccess(row.id);
    return {
      id: row.id,
      username: row.username,
      role: row.role,
      status: row.status,
      avatarUrl: row.avatarUrl ?? null,
      roleIds: access.roleIds,
      permissions: access.permissions,
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
    };
  }

  /** @throws {StoreError} 用户不存在 */
  public getByUsername(username: string): SafeUser | undefined {
    const row = this.db.select().from(users).where(eq(users.username, username)).get();
    return row === undefined ? undefined : this.toSafeUser(row);
  }

  public getById(userId: string): SafeUser | undefined {
    const row = this.db.select().from(users).where(eq(users.id, userId)).get();
    return row === undefined ? undefined : this.toSafeUser(row);
  }

  /** 用户列表（后台管理页，按注册时间正序：首任管理员排在最前） */
  public listUsers(): SafeUser[] {
    const rows = this.db.select().from(users).orderBy(asc(users.createdAt)).all();
    return rows.map((row) => this.toSafeUser(row));
  }

  /** @returns 目标用户是否存在 */
  public updateUserRole(userId: string, role: 'admin' | 'user'): boolean {
    const result = this.db.update(users).set({ role }).where(eq(users.id, userId)).run();
    return result.changes > 0;
  }

  /** @returns 目标用户是否存在 */
  public setUserStatus(userId: string, status: 'active' | 'disabled'): boolean {
    const result = this.db.update(users).set({ status }).where(eq(users.id, userId)).run();
    return result.changes > 0;
  }

  /** @returns 目标用户是否存在 */
  public resetPassword(userId: string, passwordHash: string): boolean {
    const result = this.db.update(users).set({ passwordHash }).where(eq(users.id, userId)).run();
    return result.changes > 0;
  }

  /** @returns 目标用户是否存在 */
  public deleteUser(userId: string): boolean {
    // 显式清会话：即使调用方未开启 foreign_keys 级联也不会留下悬挂令牌
    this.db.delete(sessions).where(eq(sessions.userId, userId)).run();
    const result = this.db.delete(users).where(eq(users.id, userId)).run();
    return result.changes > 0;
  }

  public touchLastLogin(userId: string): void {
    this.db
      .update(users)
      .set({ lastLoginAt: new Date().toISOString() })
      .where(eq(users.id, userId))
      .run();
  }

  /** 登录与改密的哈希比对输入；@returns 用户不存在时 undefined（哈希不出 UserStore 之外的安全边界由调用方维持） */
  public getPasswordHash(userId: string): string | undefined {
    const row = this.db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, userId))
      .get();
    return row?.passwordHash;
  }

  public countUsers(): number {
    return this.db.select({ id: users.id }).from(users).all().length;
  }

  /** 后台概览用：总数与 admin 数一次查全 */
  public getUserRoleCounts(): { total: number; admins: number } {
    const rows = this.db.select({ role: users.role }).from(users).all();
    return {
      total: rows.length,
      admins: rows.filter((row) => row.role === 'admin').length,
    };
  }

  /**
   * 创建会话并惰性清理过期会话。
   * @returns 随机不透明令牌（写入 Cookie，库里不存明文密码关联信息，泄露面最小）
   */
  public createSession(userId: string, expiresAt: Date): string {
    this.purgeExpiredSessions();
    const token = randomBytes(32).toString('base64url');
    this.db.insert(sessions).values({ token, userId, expiresAt: expiresAt.toISOString() }).run();
    return token;
  }

  /**
   * 按令牌取会话用户。
   * @returns 用户不存在、令牌过期或令牌未知时返回 undefined；过期行顺手删除
   */
  public getSessionUser(token: string): SafeUser | undefined {
    const row = this.db.select().from(sessions).where(eq(sessions.token, token)).get();
    if (row === undefined) return undefined;
    if (new Date(row.expiresAt).getTime() <= Date.now()) {
      this.db.delete(sessions).where(eq(sessions.token, token)).run();
      return undefined;
    }
    const user = this.getById(row.userId);
    if (user === undefined) {
      // 用户已被删除而会话残留：清掉并视为未登录
      this.db.delete(sessions).where(eq(sessions.token, token)).run();
      return undefined;
    }
    return user;
  }

  public deleteSession(token: string): void {
    this.db.delete(sessions).where(eq(sessions.token, token)).run();
  }

  /** 吊销某用户全部会话（改密、禁用、删除后立即生效） */
  public deleteSessionsForUser(userId: string): void {
    this.db.delete(sessions).where(eq(sessions.userId, userId)).run();
  }

  private purgeExpiredSessions(): void {
    this.db.delete(sessions).where(lt(sessions.expiresAt, new Date().toISOString())).run();
  }

  private toSafeUser(row: typeof users.$inferSelect): SafeUser {
    const access = this.getUserAccess(row.id);
    return {
      id: row.id,
      username: row.username,
      role: row.role,
      status: row.status,
      avatarUrl: row.avatarUrl ?? null,
      roleIds: access.roleIds,
      permissions: access.permissions,
      createdAt: row.createdAt,
      lastLoginAt: row.lastLoginAt,
    };
  }

  /** 取用户角色 id 与权限并集（RBAC） */
  public getUserAccess(userId: string): { roleIds: string[]; permissions: string[] } {
    const roleIds = this.db
      .select({ roleId: userRoles.roleId })
      .from(userRoles)
      .where(eq(userRoles.userId, userId))
      .all()
      .map((r) => r.roleId);
    if (roleIds.length === 0) return { roleIds: [], permissions: [] };
    const roleRows = this.db
      .select({ permissions: roles.permissions })
      .from(roles)
      .where(inArray(roles.id, roleIds))
      .all();
    const permissionSet = new Set<string>();
    let hasWildcard = false;
    for (const role of roleRows) {
      for (const perm of JSON.parse(role.permissions) as string[]) {
        if (perm === '*') hasWildcard = true;
        permissionSet.add(perm);
      }
    }
    const permissions = hasWildcard ? ['*'] : [...permissionSet];
    return { roleIds, permissions };
  }

  /** 分配角色（整体替换该用户角色集合）。@returns 目标用户是否存在 */
  public assignRoles(userId: string, roleIds: string[]): boolean {
    const exists = this.getById(userId);
    if (exists === undefined) return false;
    this.db.delete(userRoles).where(eq(userRoles.userId, userId)).run();
    if (roleIds.length > 0) {
      const now = new Date().toISOString();
      for (const roleId of roleIds) {
        this.db.insert(userRoles).values({ userId, roleId, createdAt: now }).run();
      }
    }
    // 依据所分配角色是否含 '*' 权限自动派生 role 字段（管理员统一由分配角色授予）
    const isAdmin =
      roleIds.length > 0 &&
      roleIds.some((roleId) => {
        const role = this.getRole(roleId);
        return role !== undefined && role.permissions.includes('*');
      });
    this.db
      .update(users)
      .set({ role: isAdmin ? 'admin' : 'user' })
      .where(eq(users.id, userId))
      .run();
    return true;
  }

  /**
   * 存量迁移：为无任何角色分配的用户按 role 列补发内置角色（admin→role-admin，user→role-user）。
   * 幂等，仅处理缺角色的用户。@returns 补发数量
   */
  public backfillDefaultRoles(): number {
    const rows = this.db.select().from(users).all();
    let count = 0;
    const now = new Date().toISOString();
    for (const row of rows) {
      const assigned = this.db
        .select({ roleId: userRoles.roleId })
        .from(userRoles)
        .where(eq(userRoles.userId, row.id))
        .all();
      if (assigned.length === 0) {
        const defaultRole = row.role === 'admin' ? 'role-admin' : 'role-user';
        this.db
          .insert(userRoles)
          .values({ userId: row.id, roleId: defaultRole, createdAt: now })
          .run();
        count += 1;
      }
    }
    return count;
  }

  /** 角色 CRUD */
  public listRoles(): Role[] {
    const rows = this.db.select().from(roles).orderBy(asc(roles.priority)).all();
    return rows.map((row) => this.toRole(row));
  }

  public getRole(roleId: string): Role | undefined {
    const row = this.db.select().from(roles).where(eq(roles.id, roleId)).get();
    return row === undefined ? undefined : this.toRole(row);
  }

  public createRole(input: {
    name: string;
    description: string | null;
    priority: number;
    permissions: string[];
  }): Role {
    const existing = this.db.select().from(roles).where(eq(roles.name, input.name)).get();
    if (existing !== undefined) throw new StoreError(`role name already taken: ${input.name}`);
    const row = {
      id: randomUUID(),
      name: input.name,
      description: input.description,
      priority: input.priority,
      permissions: JSON.stringify(input.permissions),
      isSystem: false,
    };
    this.db.insert(roles).values(row).run();
    const created = this.getRole(row.id);
    if (created === undefined) throw new StoreError('role create failed');
    return created;
  }

  public updateRole(
    roleId: string,
    input: {
      name: string;
      description: string | null;
      priority: number;
      permissions: string[];
    },
  ): Role | undefined {
    const existing = this.getRole(roleId);
    if (existing === undefined) return undefined;
    const dup = this.db.select().from(roles).where(eq(roles.name, input.name)).get();
    if (dup !== undefined && dup.id !== roleId) {
      throw new StoreError(`role name already taken: ${input.name}`);
    }
    this.db
      .update(roles)
      .set({
        name: input.name,
        description: input.description,
        priority: input.priority,
        permissions: JSON.stringify(input.permissions),
      })
      .where(eq(roles.id, roleId))
      .run();
    return this.getRole(roleId);
  }

  /** @returns 是否删除成功；内置角色拒绝删除 */
  public deleteRole(roleId: string): boolean {
    const existing = this.getRole(roleId);
    if (existing === undefined) return false;
    if (existing.isSystem) throw new StoreError('cannot delete system role');
    this.db.delete(userRoles).where(eq(userRoles.roleId, roleId)).run();
    const result = this.db.delete(roles).where(eq(roles.id, roleId)).run();
    return result.changes > 0;
  }

  private toRole(row: typeof roles.$inferSelect): Role {
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? null,
      priority: row.priority,
      permissions: JSON.parse(row.permissions) as string[],
      isSystem: row.isSystem,
      createdAt: row.createdAt,
    };
  }

  /** @returns 目标用户是否存在；更新头像后调用方需用 getById 取回最新 SafeUser */
  public setAvatarUrl(userId: string, avatarUrl: string | null): boolean {
    const result = this.db.update(users).set({ avatarUrl }).where(eq(users.id, userId)).run();
    return result.changes > 0;
  }
}
