import { ReviewAgent } from '@ai-review/agents';
import { DiffContextBuilder } from '@ai-review/diff';
import type { GitReader } from '@ai-review/diff';
import type { ReviewProvider, TokenBudget } from '@ai-review/llm';
import type { ToolRegistry } from '@ai-review/tools';
import type { CodeContext, FileContext, FileHistory, IgnoreRules, RagRetriever, ReviewPlan } from '@ai-review/shared';
import type { RunnableConfig } from '@langchain/core/runnables';
import { crossValidate } from './cross-validate.js';
import { RiskPlanner } from './risk-planner.js';
import type { ReviewState } from './state.js';

/** LLM 语义审查承担的三个维度（方案 3.3 三 Agent）；static 由工具总线产出 */
const LLM_DIMENSIONS = ['correctness', 'security', 'performance'] as const;
export type LlmDimension = (typeof LLM_DIMENSIONS)[number];

/** 自愈回退触发条件：BLOCKER 置信度低于该阈值（方案 3.7/3.9 routeAfterValidate） */
export const HEAL_CONFIDENCE_THRESHOLD = 0.6;
/** 自愈回退轮次上限（方案 3.7：最多 3 轮、逐轮收窄范围） */
export const MAX_HEAL_ROUNDS = 3;

/** 流水线依赖：全部面向接口注入（规范 §4.1），节点工厂经闭包捕获 */
export type PipelineDeps = {
  gitReader: GitReader;
  rag: RagRetriever;
  ignores: IgnoreRules;
  history: FileHistory;
  /** 三个 LLM 审查维度的 Provider；fast 模式仅 deep 文件，full 模式 deep+quick */
  providers: Record<LlmDimension, ReviewProvider>;
  registry: ToolRegistry;
  mode: 'fast' | 'full';
  /** token 硬预算；预算耗尽时低优先级文件降级为 staticOnly（方案 3.3） */
  budget?: TokenBudget | undefined;
};

export type PipelineNode = (state: ReviewState, config: RunnableConfig) => Promise<Partial<ReviewState>>;

/** 预留估算：约 4 字符/token，加固定的指令与输出余量 */
function estimateTokens(diff: FileContext['diff']): number {
  return Math.ceil(diff.summary.length / 4) + 600;
}

function selectFiles(context: CodeContext, paths: ReadonlySet<string>): CodeContext {
  const files = context.files.filter((file) => paths.has(file.diff.path));
  return { files, metadata: { ...context.metadata, totalFiles: files.length } };
}

/** 读取暂存区 diff 并构建上下文包（方案 3.1） */
export function makeParseNode(deps: PipelineDeps): PipelineNode {
  const builder = new DiffContextBuilder(deps.gitReader, deps.rag, deps.ignores);
  return async (state) => {
    void state;
    return { context: await builder.build() };
  };
}

/**
 * 预算降级（方案 3.3）：按风险分降序逐文件预留，余额不足的文件移入 staticOnly。
 * 在 plan 节点单点执行（而非并行审查节点内），避免并行分支对共享预算的竞争写入。
 */
function applyBudget(plan: ReviewPlan, budget: TokenBudget | undefined): {
  plan: ReviewPlan;
  degraded: string[];
} {
  if (budget === undefined) return { plan, degraded: [] };
  const deep = [];
  const quick = [];
  const staticOnly = [...plan.staticOnly];
  const degraded = [];
  for (const file of [...plan.deep, ...plan.quick]) {
    if (!budget.tryReserve(estimateTokens(file.diff))) {
      staticOnly.push(file);
      degraded.push(file.diff.path);
      continue;
    }
    if (file.score >= 60) deep.push(file);
    else quick.push(file);
  }
  return { plan: { deep, quick, staticOnly }, degraded };
}

/** 风险规划分流 + 预算降级（方案 3.2/3.3） */
export function makePlanNode(deps: PipelineDeps): PipelineNode {
  const planner = new RiskPlanner(deps.history);
  return async (state) => {
    const plan = await planner.plan(state.context.files.map((file) => file.diff));
    const budgeted = applyBudget(plan, deps.budget);
    return {
      plan: budgeted.plan,
      metrics: {
        ...state.metrics,
        filesDeep: budgeted.plan.deep.length,
        filesQuick: budgeted.plan.quick.length,
        filesStaticOnly: budgeted.plan.staticOnly.length,
        degradedToStatic: budgeted.degraded,
      },
    };
  };
}

/** LLM 审查节点工厂（方案 3.3 makeReviewNode）：按维度注入 Provider，审查本维度分到的文件 */
export function makeReviewNode(dimension: LlmDimension, deps: PipelineDeps): PipelineNode {
  const agent = new ReviewAgent(deps.providers[dimension]);
  return async (state, config) => {
    const selected =
      deps.mode === 'fast' ? state.plan.deep : [...state.plan.deep, ...state.plan.quick];
    const paths = new Set(selected.map((file) => file.diff.path));
    const subContext = selectFiles(state.context, paths);
    if (subContext.files.length === 0) return { findings: [] };
    return { findings: await agent.review(subContext, config.signal) };
  };
}

/** 静态分析节点：确定性工具覆盖全部文件（fast/full 模式均全量执行，方案 3.0） */
export function makeStaticReviewNode(deps: PipelineDeps): PipelineNode {
  return async (state) => ({ findings: deps.registry.runAll(state.context) });
}

/** 交叉验证 + 幻觉抑制（方案 3.6 五阶段后处理，当前实现阶段 1/2/5） */
export function makeValidateNode(): PipelineNode {
  return async (state) => ({ findings: crossValidate(state.findings, state.context) });
}

function isHealCandidate(finding: ReviewState['findings'][number]): boolean {
  return finding.severity === 'BLOCKER' && finding.confidence < HEAL_CONFIDENCE_THRESHOLD;
}

/**
 * 自愈回退（方案 3.7）：将低置信度 BLOCKER 涉及的文件收窄为重审范围，
 * 携带完整上下文重新调用全部 LLM 维度；轮次由条件边控制，逐轮消耗独立计入预算。
 */
export function makeHealNode(deps: PipelineDeps): PipelineNode {
  return async (state, config) => {
    const targets = new Set(
      state.findings.filter(isHealCandidate).map((finding) => finding.filePath),
    );
    const subContext = selectFiles(state.context, targets);
    const findings =
      subContext.files.length === 0
        ? []
        : await Promise.all(
            LLM_DIMENSIONS.map(async (dimension) =>
              new ReviewAgent(deps.providers[dimension]).review(subContext, config.signal),
            ),
          ).then((groups) => groups.flat());
    const healRounds = state.healRounds + 1;
    return { findings, healRounds, metrics: { ...state.metrics, healRounds } };
  };
}

/** 报告收尾：固化流水线总耗时（方案 3.9 report 节点；落库与 SSE 推送由调用方承担） */
export function makeReportNode(startedAt: number): PipelineNode {
  return async (state) => ({ metrics: { ...state.metrics, durationMs: Date.now() - startedAt } });
}
