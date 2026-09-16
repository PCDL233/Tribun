import { AGENT_DIMENSIONS, SEVERITIES } from '@ai-review/shared';
import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * 审查记录表（对齐方案六 reviews 表）。
 * 与方案的差异：追加 model / report_json 列——报告五段落（summary/assessment 等）为非规范化字符串，
 * 拆列存储成本过高，故整体以 JSON 存于 report_json，findings 仍走规范化的行级存储（支持误报标记）。
 */
export const reviews = sqliteTable('reviews', {
  id: text('id').primaryKey(),
  repoPath: text('repo_path').notNull(),
  branch: text('branch').notNull(),
  commitHash: text('commit_hash'),
  author: text('author'),
  /** 如 "mock + 静态分析" */
  model: text('model').notNull(),
  mode: text('mode', { enum: ['fast', 'full'] }).notNull(),
  status: text('status', { enum: ['completed', 'failed', 'cancelled'] })
    .notNull()
    .default('completed'),
  /** 0-100 综合风险评分（Risk Planner 输出的最大文件风险分） */
  riskScore: real('risk_score').notNull(),
  totalFindings: integer('total_findings').notNull().default(0),
  blockerCount: integer('blocker_count').notNull().default(0),
  warningCount: integer('warning_count').notNull().default(0),
  nitCount: integer('nit_count').notNull().default(0),
  tokenUsed: integer('token_used').notNull().default(0),
  durationMs: integer('duration_ms').notNull(),
  reportJson: text('report_json').notNull(),
  /** 被审查的原始 unified diff（Dashboard diff 视图数据源；超长截断，存量记录为 NULL） */
  diffText: text('diff_text'),
  /** 失败/取消原因（status 异常时非空） */
  errorMessage: text('error_message'),
  /**
   * 发起人用户 id（Web 端数据隔离依据）。
   * 软引用：不建 FK——存量 CLI 直跑的记录无发起人，且删除用户时历史审查应保留。
   */
  createdBy: text('created_by'),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

/** 审查发现表（对齐方案六 findings 表；id 为误报标记 API 的行键） */
export const findings = sqliteTable(
  'findings',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    reviewId: text('review_id')
      .notNull()
      .references(() => reviews.id),
    agent: text('agent', { enum: AGENT_DIMENSIONS }).notNull(),
    severity: text('severity', { enum: SEVERITIES }).notNull(),
    /** 0-1（交叉验证阶段 2 计算后落库） */
    confidence: real('confidence').notNull(),
    filePath: text('file_path').notNull(),
    lineStart: integer('line_start').notNull(),
    lineEnd: integer('line_end').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    suggestion: text('suggestion'),
    codeSnippet: text('code_snippet'),
    cweId: text('cwe_id'),
    lowConfidence: integer('low_confidence', { mode: 'boolean' }).notNull().default(false),
    /** Dashboard 误报标记，回流为置信度模型优化数据（方案 3.10） */
    isFalsePositive: integer('is_false_positive', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [index('idx_findings_review').on(table.reviewId)],
);

/**
 * 审查缓存表（方案六 review_cache；方案 3.0 步骤 8 内容哈希去重）。
 * 键为 hash(agent + prompt 版本 + 新侧内容全文)，与仓库路径无关——
 * 相同代码块跨仓库、跨审查复用同一份发现，token_saved 量化节省成本。
 */
export const reviewCache = sqliteTable('review_cache', {
  cacheKey: text('cache_key').primaryKey(),
  reviewId: text('review_id'),
  findingsJson: text('findings_json').notNull(),
  tokenSaved: integer('token_saved').notNull().default(0),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

/**
 * 用户表（Web 端认证，方案 3.10 团队版扩展）。
 * 首个注册用户自动获得 admin 角色（服务端事务内判定），其余为 user。
 */
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  /** scrypt 哈希（salt$hash 格式），明文密码与哈希均不出服务端 */
  passwordHash: text('password_hash').notNull(),
  /** 头像文件在服务端的相对访问路径；未上传为 NULL */
  avatarUrl: text('avatar_url'),
  role: text('role', { enum: ['admin', 'user'] })
    .notNull()
    .default('user'),
  status: text('status', { enum: ['active', 'disabled'] })
    .notNull()
    .default('active'),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  lastLoginAt: text('last_login_at'),
});

/** 会话表：不透明令牌（Cookie 承载）→ 用户。过期行由创建新会话时惰性清理 */
export const sessions = sqliteTable('sessions', {
  token: text('token').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

/** 角色表（RBAC）：权限为系统动态路由的访问路径集合（JSON 数组） */
export const roles = sqliteTable('roles', {
  id: text('id').primaryKey(),
  /** 角色名唯一 */
  name: text('name').notNull().unique(),
  description: text('description'),
  /** 数值越小优先级越高；多角色时取最高优先级角色作为默认角色 */
  priority: integer('priority').notNull().default(100),
  /** 权限集合：JSON 字符串数组，元素为路由路径，'*' 表示全部 */
  permissions: text('permissions').notNull().default('[]'),
  /** 内置角色不可删除（admin/user） */
  isSystem: integer('is_system', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

/** 用户-角色关联表（多对多） */
export const userRoles = sqliteTable(
  'user_roles',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [primaryKey({ columns: [table.userId, table.roleId] })],
);

export type ReviewRow = typeof reviews.$inferSelect;
export type FindingRow = typeof findings.$inferSelect;
export type ReviewCacheRow = typeof reviewCache.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
