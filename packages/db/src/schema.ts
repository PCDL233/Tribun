import { AGENT_DIMENSIONS, SEVERITIES } from '@ai-review/shared';
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
  status: text('status', { enum: ['completed', 'failed'] })
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

export type ReviewRow = typeof reviews.$inferSelect;
export type FindingRow = typeof findings.$inferSelect;
export type ReviewCacheRow = typeof reviewCache.$inferSelect;
