/**
 * 严重度是全仓统一词汇（方案 3.8 报告格式 + 规范 §5.7）：
 * 统一为 BLOCKER / WARNING / NIT / PRAISE，禁止另造同义词。
 */
export const SEVERITIES = ['BLOCKER', 'WARNING', 'NIT', 'PRAISE'] as const;
export type Severity = (typeof SEVERITIES)[number];

/** 严重度权重：数值越大越严重，用于排序与阻断阈值比较 */
export const SEVERITY_RANK: Record<Severity, number> = {
  BLOCKER: 3,
  WARNING: 2,
  NIT: 1,
  PRAISE: 0,
};

/**
 * @param blockOn 阻断阈值（取自配置 review.blockOn）
 * @returns 该发现是否达到阻断阈值
 */
export function severityMeetsThreshold(severity: Severity, blockOn: Severity): boolean {
  return SEVERITY_RANK[severity] >= SEVERITY_RANK[blockOn];
}

/**
 * 审查维度。前三个由 LLM Agent 承担（方案 3.3 三 Agent），
 * `static` 为确定性静态分析产出的发现的归属，与 LLM 发现共享同一数据结构。
 */
export const AGENT_DIMENSIONS = ['correctness', 'security', 'performance', 'static'] as const;
export type AgentDimension = (typeof AGENT_DIMENSIONS)[number];
