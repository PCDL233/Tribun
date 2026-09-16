import { z } from 'zod';

/**
 * —— 认证与用户管理契约（方案 3.10 的登录/后台管理扩展）——
 * @ai-review/server 的 auth/admin 路由与 @ai-review/web 的登录/后台页共用此单一事实源。
 * 密码哈希永不离开服务端：本文件中的任何 schema 均不包含 passwordHash 字段。
 */

/** 用户角色：admin 可访问后台管理页与 /metrics；user 仅可操作本人审查数据 */
export const UserRoleSchema = z.enum(['admin', 'user']);
export type UserRole = z.infer<typeof UserRoleSchema>;

/** 账号状态：disabled 由管理员手动停用，登录被拒绝 */
export const UserStatusSchema = z.enum(['active', 'disabled']);
export type UserStatus = z.infer<typeof UserStatusSchema>;

/** 对外可见的用户模型（GET /api/auth/me、GET /api/admin/users 的行模型） */
export const UserSchema = z.object({
  id: z.string(),
  username: z.string(),
  role: UserRoleSchema,
  status: UserStatusSchema,
  /** 头像 URL（服务端相对路径）；未上传为 null */
  avatarUrl: z.string().nullable(),
  /** 已分配的角色 id 列表（RBAC） */
  roleIds: z.array(z.string()),
  /** 有效权限集合（角色权限并集），路由访问判断依据 */
  permissions: z.array(z.string()),
  createdAt: z.string(),
  lastLoginAt: z.string().nullable(),
});
export type User = z.infer<typeof UserSchema>;

/** 用户名约定：3-32 字符，字母/数字/下划线/连字符（登录凭证与审计日志一致可读） */
export const USERNAME_PATTERN = /^[a-zA-Z0-9_-]{3,32}$/;

export const RegisterSchema = z.object({
  username: z.string().regex(USERNAME_PATTERN, '用户名需为 3-32 位字母、数字、下划线或连字符'),
  password: z.string().min(8, '密码至少 8 位').max(128),
});
export type RegisterInput = z.infer<typeof RegisterSchema>;

/** 管理员创建普通用户：POST /api/admin/users（与注册同约束，但由管理员代办） */
export const AdminCreateUserSchema = z.object({
  username: z.string().regex(USERNAME_PATTERN, '用户名需为 3-32 位字母、数字、下划线或连字符'),
  password: z.string().min(8, '密码至少 8 位').max(128),
});
export type AdminCreateUserInput = z.infer<typeof AdminCreateUserSchema>;

export const LoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof LoginSchema>;

/** 改密需携带旧密码，防止劫持后的会话直接接管账号 */
export const ChangePasswordSchema = z.object({
  oldPassword: z.string().min(1),
  newPassword: z.string().min(8, '密码至少 8 位').max(128),
});
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;

/** POST /api/auth/register | /api/auth/login | GET /api/auth/me 的统一响应体 */
export const AuthResponseSchema = z.object({ user: UserSchema });
export type AuthResponse = z.infer<typeof AuthResponseSchema>;

/** 管理员修改用户（角色/状态二选一或同时），PATCH /api/admin/users/:id */
export const AdminUserPatchSchema = z
  .object({
    role: UserRoleSchema.optional(),
    status: UserStatusSchema.optional(),
  })
  .refine((patch) => patch.role !== undefined || patch.status !== undefined, {
    message: '至少提供 role 或 status 之一',
  });
export type AdminUserPatch = z.infer<typeof AdminUserPatchSchema>;

/** 管理员重置密码（生成新密码由服务端返回明文一次），POST /api/admin/users/:id/reset-password */
export const ResetPasswordResponseSchema = z.object({ newPassword: z.string() });
export type ResetPasswordResponse = z.infer<typeof ResetPasswordResponseSchema>;

/** GET /api/admin/users */
export const UserListResponseSchema = z.object({ users: z.array(UserSchema) });
export type UserListResponse = z.infer<typeof UserListResponseSchema>;

/** 角色模型（RBAC 权限=动态路由访问路径集合） */
export const RoleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  priority: z.number().int(),
  permissions: z.array(z.string()),
  isSystem: z.boolean(),
  createdAt: z.string(),
});
export type Role = z.infer<typeof RoleSchema>;

export const RoleListResponseSchema = z.object({ roles: z.array(RoleSchema) });
export type RoleListResponse = z.infer<typeof RoleListResponseSchema>;

export const RoleResponseSchema = z.object({ role: RoleSchema });
export type RoleResponse = z.infer<typeof RoleResponseSchema>;

/** 创建/更新角色入参 */
export const RoleInputSchema = z.object({
  name: z.string().min(1, '角色名不能为空').max(32),
  description: z.string().max(200).nullable().optional(),
  priority: z.number().int().min(1).max(999),
  permissions: z.array(z.string()),
});
export type RoleInput = z.infer<typeof RoleInputSchema>;

/** 给用户分配角色（整体替换该用户的角色集合） */
export const AssignRolesSchema = z.object({ roleIds: z.array(z.string()) });
export type AssignRolesInput = z.infer<typeof AssignRolesSchema>;

/** GET /api/admin/overview —— 后台系统概览卡片数据源 */
const AdminRecentFailureSchema = z.object({
  reviewId: z.string(),
  repoPath: z.string(),
  errorMessage: z.string().nullable().optional(),
  createdAt: z.string(),
});

const AdminRiskTrendPointSchema = z.object({
  date: z.string(),
  reviews: z.number().int().nonnegative(),
  avgRiskScore: z.number().nonnegative(),
});

export const AdminOverviewSchema = z.object({
  userCount: z.number().int().nonnegative(),
  adminCount: z.number().int().nonnegative(),
  totalReviews: z.number().int().nonnegative(),
  totalFindings: z.number().int().nonnegative(),
  totalTokenUsed: z.number().int().nonnegative(),
  cacheEntries: z.number().int().nonnegative(),
  tokenSavedByCache: z.number().int().nonnegative(),
  /** 失败审查占全部已落库审查的比例（0-1） */
  failureRate: z.number().min(0).max(1),
  /** 管理后台近 7 日风险趋势 */
  riskTrend: z.array(AdminRiskTrendPointSchema),
  /** 最近失败任务，按创建时间倒序 */
  recentFailures: z.array(AdminRecentFailureSchema),
});
export type AdminOverview = z.infer<typeof AdminOverviewSchema>;
export const AdminOverviewResponseSchema = z.object({ overview: AdminOverviewSchema });
