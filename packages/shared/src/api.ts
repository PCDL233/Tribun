import { z } from 'zod';
import { FindingSchema } from './finding.js';
import { AiReviewConfigSchema, CustomRuleSchema } from './config-schema.js';
import { ReviewReportSchema } from './report.js';
import { CUSTOM_RULE_MATCH_SCOPES } from './config-schema.js';

// 认证/用户契约无 node 依赖，随 api 子路径一并供浏览器端消费
export * from './auth.js';
export { FindingSchema } from './finding.js';
export type { Finding } from './finding.js';
// 自定义规则 schema 与匹配范围枚举：供管理后台规则表单与试跑面板消费
export { CustomRuleSchema, CUSTOM_RULE_MATCH_SCOPES } from './config-schema.js';
export type { CustomRule, CustomRuleMatchScope } from './config-schema.js';
// 模型服务商目录同样无 node 依赖，供管理后台页面经浏览器安全子路径导入
export * from './model-catalog.js';

/**
 * —— API 契约（方案 2.3：前端零手工类型，全部推导自 shared）——
 * 本文件是 @ai-review/server 的 REST/SSE 响应形状与 @ai-review/web 的消费端的单一事实源。
 */

/** 附带数据库行 id 的发现——误报标记 API 的目标（Finding 契约本身不含 id） */
export const IdentifiedFindingSchema = FindingSchema.extend({
  id: z.number().int().positive(),
});
export type IdentifiedFinding = z.infer<typeof IdentifiedFindingSchema>;

/** 审查历史列表项（Dashboard 列表页行模型，方案 3.10 页面 1） */
export const ReviewListItemSchema = z.object({
  reviewId: z.string(),
  repoPath: z.string(),
  branch: z.string(),
  model: z.string(),
  mode: z.enum(['fast', 'full']),
  status: z.enum(['completed', 'failed', 'cancelled']).default('completed'),
  /** 失败/取消原因（status 异常时非空） */
  errorMessage: z.string().nullable().optional(),
  /** 0-100 综合风险评分 */
  riskScore: z.number(),
  totalFindings: z.number().int(),
  blockerCount: z.number().int(),
  warningCount: z.number().int(),
  nitCount: z.number().int(),
  tokenUsed: z.number().int(),
  durationMs: z.number().int(),
  createdAt: z.string(),
  /** 发起人用户 id（数据隔离依据；存量旧记录为 null） */
  createdBy: z.string().nullable().optional(),
});
export type ReviewListItem = z.infer<typeof ReviewListItemSchema>;

/**
 * 列表筛选与分页查询参数（GET /api/reviews?...）。
 * from/to 接受 ISO 日期串（含 `YYYY-MM-DD`，按字符串前缀比较即可命中同日记录）。
 */
export const ReviewListQuerySchema = z.object({
  /** 关键词：模糊匹配 repoPath / branch / reviewId */
  q: z.string().trim().min(1).optional(),
  status: z.enum(['completed', 'failed', 'cancelled']).optional(),
  mode: z.enum(['fast', 'full']).optional(),
  /** 严重度筛选：映射为对应计数列 > 0 */
  severity: z.enum(['BLOCKER', 'WARNING', 'NIT']).optional(),
  repo: z.string().trim().min(1).optional(),
  branch: z.string().trim().min(1).optional(),
  from: z.string().trim().min(1).optional(),
  to: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ReviewListQuery = z.infer<typeof ReviewListQuerySchema>;

/** 报告详情：ReviewReport 的 findings 替换为带行 id 的版本（isFalsePositive 以落库值为准） */
export const ReviewReportDetailSchema = ReviewReportSchema.extend({
  findings: z.array(IdentifiedFindingSchema),
});
export type ReviewReportDetail = z.infer<typeof ReviewReportDetailSchema>;

/**
 * 审查进度事件（SSE，方案 3.9 → Dashboard 实时进度条）。
 * `stage` 为流水线节点名（parse/riskPlan/correctness/security/performance/static/validate/heal/report）。
 */
export const ReviewStageEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('stage'),
    reviewId: z.string(),
    stage: z.string(),
    /** 阶段明细（如文件数、分流结果、发现计数），由节点增量状态推导 */
    detail: z.string().optional(),
  }),
  z.object({
    type: z.literal('completed'),
    reviewId: z.string(),
    riskScore: z.number(),
    blockerCount: z.number(),
    /** 是否达到阻断阈值（等价于 CLI 退出码 1 的语义） */
    blocking: z.boolean(),
  }),
  z.object({ type: z.literal('failed'), reviewId: z.string(), message: z.string() }),
  z.object({ type: z.literal('cancelled'), reviewId: z.string(), message: z.string() }),
]);
export type ReviewStageEvent = z.infer<typeof ReviewStageEventSchema>;

/** —— REST 响应包装 —— */

/** POST /api/reviews → 202 */
export const StartReviewResponseSchema = z.object({ reviewId: z.string() });
/** POST /api/reviews/:id/rerun → 202 */
export const RerunReviewResponseSchema = z.object({ reviewId: z.string() });
/** DELETE /api/reviews/:id → 200 */
export const DeleteReviewResponseSchema = z.object({ deleted: z.boolean() });
/** POST /api/reviews/:id/cancel → 200（目标不在运行中时 404） */
export const CancelReviewResponseSchema = z.object({ cancelled: z.boolean() });

/** GET /api/reviews（筛选 + 服务端分页；旧记录无 diff/错误信息字段为空） */
export const ReviewListResponseSchema = z.object({
  reviews: z.array(ReviewListItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});

/** GET /api/reviews/:id/diff → 被审查的原始 unified diff（存量记录未持久化时为 null） */
export const ReviewDiffResponseSchema = z.object({ diffText: z.string().nullable() });

/** PATCH /api/findings/:id → 200 */
export const FalsePositiveResponseSchema = z.object({ updated: z.boolean() });

/** —— 统计分析（方案 3.10 页面 4：ECharts 数据源，全部由 db 聚合产出）—— */

/** 严重度维度的发现计数（含 PRAISE，与 Finding 契约的严重度字面量一致） */
export const SeverityCountSchema = z.object({
  severity: z.enum(['BLOCKER', 'WARNING', 'NIT', 'PRAISE']),
  count: z.number().int().nonnegative(),
});
export type SeverityCount = z.infer<typeof SeverityCountSchema>;

/** 按自然日聚合的风险分趋势点（createdAt 截取日期部分） */
export const RiskTrendPointSchema = z.object({
  date: z.string(),
  reviews: z.number().int().nonnegative(),
  avgRiskScore: z.number(),
});
export type RiskTrendPoint = z.infer<typeof RiskTrendPointSchema>;

/** 发现数最多的文件（Top 高风险文件榜，按发现数降序） */
export const RiskyFileSchema = z.object({
  filePath: z.string(),
  findingCount: z.number().int().nonnegative(),
  blockerCount: z.number().int().nonnegative(),
});
export type RiskyFile = z.infer<typeof RiskyFileSchema>;

/** GET /api/stats 查询范围；日期按 UTC 自然日闭区间处理。 */
export const ReviewStatsQuerySchema = z.object({
  from: z.string().trim().min(1).optional(),
  to: z.string().trim().min(1).optional(),
});
export type ReviewStatsQuery = z.infer<typeof ReviewStatsQuerySchema>;

export const AgentCountSchema = z.object({
  agent: z.string(),
  count: z.number().int().nonnegative(),
});
export type AgentCount = z.infer<typeof AgentCountSchema>;

export const TokenTrendPointSchema = z.object({
  date: z.string(),
  tokenUsed: z.number().int().nonnegative(),
});
export type TokenTrendPoint = z.infer<typeof TokenTrendPointSchema>;

/** GET /api/stats 响应体（空库时所有计数为 0、均值与趋势为空数组） */
export const ReviewStatsSchema = z.object({
  totalReviews: z.number().int().nonnegative(),
  totalFindings: z.number().int().nonnegative(),
  falsePositiveCount: z.number().int().nonnegative(),
  avgRiskScore: z.number().nonnegative(),
  /** 全部审查的平均耗时（毫秒） */
  avgDurationMs: z.number().nonnegative(),
  totalTokenUsed: z.number().int().nonnegative(),
  severityDistribution: z.array(SeverityCountSchema),
  /** 按日期升序的风险分趋势 */
  riskTrend: z.array(RiskTrendPointSchema),
  topRiskyFiles: z.array(RiskyFileSchema),
  /** 各审查 agent 产出的发现数量 */
  agentDistribution: z.array(AgentCountSchema),
  /** 按自然日聚合的 token 消耗 */
  tokenTrend: z.array(TokenTrendPointSchema),
});
export type ReviewStats = z.infer<typeof ReviewStatsSchema>;

/** GET /api/stats */
export const ReviewStatsResponseSchema = z.object({ stats: ReviewStatsSchema });

/** 管理后台配置读写契约；API key 支持环境变量引用、直接填写或由服务端返回的掩码。 */
export const AdminConfigSchema = AiReviewConfigSchema.superRefine((config, ctx) => {
  if (config.llm.apiKey !== '********' && config.llm.apiKey.trim().length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['llm', 'apiKey'],
      message: 'apiKey cannot be empty',
    });
  }
});
export const AdminConfigResponseSchema = z.object({ config: AiReviewConfigSchema });
export type AdminConfig = z.infer<typeof AiReviewConfigSchema>;
export type AdminConfigResponse = z.infer<typeof AdminConfigResponseSchema>;

export const KnowledgeStatusSchema = z.object({
  status: z.enum(['disabled', 'idle', 'ready', 'running', 'error']),
  indexDir: z.string(),
  chunkCount: z.number().int().nonnegative(),
  paths: z.array(z.string()),
  lastIndexedAt: z.string().nullable(),
  error: z.string().nullable(),
});
export type KnowledgeStatus = z.infer<typeof KnowledgeStatusSchema>;
export const KnowledgeStatusResponseSchema = z.object({ knowledge: KnowledgeStatusSchema });
export const KnowledgeReindexResponseSchema = z.object({ accepted: z.boolean() });

/** —— 自定义审查规则（admin）—— */

/** GET /api/admin/rules 与 PUT /api/admin/rules 响应体 */
export const AdminRulesResponseSchema = z.object({ rules: z.array(CustomRuleSchema) });
export type AdminRulesResponse = z.infer<typeof AdminRulesResponseSchema>;

/** PUT /api/admin/rules 请求体（整体替换规则列表） */
export const AdminRulesUpdateSchema = z.object({ rules: z.array(CustomRuleSchema) });
export type AdminRulesUpdate = z.infer<typeof AdminRulesUpdateSchema>;

/**
 * POST /api/admin/rules/test 入参：待试跑的规则 + 示例输入。
 * added 范围从 sampleDiffText 的 + 行取；staged/snippet 范围对 sampleSource 逐行匹配。
 */
export const CustomRuleTestRequestSchema = z.object({
  rule: CustomRuleSchema,
  /** 用于 added 范围试跑的 unified diff 文本（仅取新增行） */
  sampleDiffText: z.string().default(''),
  /** 用于 staged/snippet 范围试跑的源码全文 */
  sampleSource: z.string().default(''),
});
export type CustomRuleTestRequest = z.infer<typeof CustomRuleTestRequestSchema>;

/** POST /api/admin/rules/test 响应体：规则在示例输入上的命中行 */
export const CustomRuleTestResultSchema = z.object({
  matches: z.array(
    z.object({
      scope: z.enum(CUSTOM_RULE_MATCH_SCOPES),
      /** 命中行号（1 基）；snippet 无 AST 签名时相对片段起始行 */
      line: z.number().int().nonnegative(),
      text: z.string(),
    }),
  ),
});
export type CustomRuleTestResult = z.infer<typeof CustomRuleTestResultSchema>;

/** —— 审计日志（登录日志 + 操作日志，参照云审计事件字段规范）—— */

/** 登录/认证事件动作（登录日志） */
export const LOGIN_LOG_ACTIONS = ['login', 'logout', 'register', 'change_password'] as const;
export type LoginLogAction = (typeof LOGIN_LOG_ACTIONS)[number];

/** 登录日志行（登录日志页数据源） */
export const LoginLogSchema = z.object({
  id: z.number().int().positive(),
  /** 操作用户 id；登录失败（用户不存在）时为 null */
  userId: z.string().nullable(),
  /** 尝试登录的用户名（失败登录同样记录，供安全分析） */
  username: z.string(),
  action: z.enum(LOGIN_LOG_ACTIONS),
  status: z.enum(['success', 'failed']),
  /** 失败原因（如 invalid-credentials / account-disabled）；成功为 null */
  reason: z.string().nullable(),
  /** 来源 IP（复用限流模块的客户端 IP 判定） */
  ip: z.string(),
  /** 客户端 User-Agent；无则空串 */
  userAgent: z.string(),
  createdAt: z.string(),
});
export type LoginLog = z.infer<typeof LoginLogSchema>;

/** 操作日志动作（资源上的 create/update/delete 等） */
export const OPERATION_LOG_ACTIONS = [
  'create',
  'update',
  'delete',
  'login',
  'logout',
  'register',
  'change_password',
  'reset_password',
  'assign_roles',
  'start_review',
  'rerun_review',
  'cancel_review',
  'delete_review',
  'mark_false_positive',
  'save_config',
  'save_rules',
  'test_rules',
  'reindex_knowledge',
] as const;
export type OperationLogAction = (typeof OPERATION_LOG_ACTIONS)[number];

/** 操作日志行（操作日志页数据源） */
export const OperationLogSchema = z.object({
  id: z.number().int().positive(),
  /** 操作者用户 id；匿名请求（如登录失败）为 null */
  userId: z.string().nullable(),
  username: z.string(),
  action: z.enum(OPERATION_LOG_ACTIONS),
  /** 资源类型（user / role / config / rules / review / finding / knowledge / auth） */
  resource: z.string(),
  /** 目标资源 id（如用户 id、审查 id）；无则空串 */
  resourceId: z.string(),
  /** 操作摘要（JSON 字符串，如 patch 内容）；不记录密码/令牌等敏感字段 */
  detail: z.string(),
  status: z.enum(['success', 'failed']),
  reason: z.string().nullable(),
  ip: z.string(),
  userAgent: z.string(),
  createdAt: z.string(),
});
export type OperationLog = z.infer<typeof OperationLogSchema>;

/** 登录日志查询参数（GET /api/admin/login-logs，分页 + 日期/状态/动作/用户名筛选） */
export const LoginLogQuerySchema = z.object({
  /** 关键词：模糊匹配用户名 */
  q: z.string().trim().min(1).optional(),
  status: z.enum(['success', 'failed']).optional(),
  action: z.enum(LOGIN_LOG_ACTIONS).optional(),
  /** 日期范围（YYYY-MM-DD，按 UTC 自然日闭区间） */
  from: z.string().trim().min(1).optional(),
  to: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type LoginLogQuery = z.infer<typeof LoginLogQuerySchema>;

/** 操作日志查询参数（GET /api/admin/operation-logs） */
export const OperationLogQuerySchema = z.object({
  /** 关键词：模糊匹配用户名 / 资源类型 / 目标 id */
  q: z.string().trim().min(1).optional(),
  action: z.enum(OPERATION_LOG_ACTIONS).optional(),
  resource: z.string().trim().min(1).optional(),
  status: z.enum(['success', 'failed']).optional(),
  from: z.string().trim().min(1).optional(),
  to: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type OperationLogQuery = z.infer<typeof OperationLogQuerySchema>;

/** GET /api/admin/login-logs 响应体 */
export const LoginLogListResponseSchema = z.object({
  logs: z.array(LoginLogSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type LoginLogListResponse = z.infer<typeof LoginLogListResponseSchema>;

/** GET /api/admin/operation-logs 响应体 */
export const OperationLogListResponseSchema = z.object({
  logs: z.array(OperationLogSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type OperationLogListResponse = z.infer<typeof OperationLogListResponseSchema>;
