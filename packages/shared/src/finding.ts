import { z } from 'zod';
import { AGENT_DIMENSIONS, SEVERITIES } from './severity.js';

/**
 * 审查发现——LLM 输出与静态分析产出的统一结构（对齐方案六、findings 表）。
 * 该 schema 是"LLM 输出经 zod 解析"链路的契约：解析失败的发现整条丢弃并计入自愈触发条件（方案 3.6）。
 */
export const FindingSchema = z.object({
  agent: z.enum(AGENT_DIMENSIONS),
  severity: z.enum(SEVERITIES),
  /** 0-1，交叉验证阶段 2 会重算（方案 3.6 阶段 2） */
  confidence: z.number().min(0).max(1),
  filePath: z.string().min(1),
  lineStart: z.number().int().min(1),
  lineEnd: z.number().int().min(1),
  title: z.string().min(1),
  description: z.string(),
  suggestion: z.string().optional(),
  codeSnippet: z.string().optional(),
  /** CWE-89 等编号；无法通过外部校验的 CVE/CWE 引用在交叉验证中移除 */
  cweId: z.string().optional(),
  /** LLM 自标记 LOW_CONFIDENCE（System Prompt 约束：不确定时标记而非编造） */
  lowConfidence: z.boolean().optional(),
  /** Dashboard 误报标记（落库字段，流水线内恒为 false） */
  isFalsePositive: z.boolean().default(false),
});
export type Finding = z.infer<typeof FindingSchema>;
