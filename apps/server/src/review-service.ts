import { getMaxRiskScore, runReviewPipeline } from '@ai-review/core';
import type { PipelineDeps, PipelineNodeName, ReviewState } from '@ai-review/core';
import type { ReviewStore } from '@ai-review/db';
import { severityMeetsThreshold } from '@ai-review/shared';
import type { ReviewReport, ReviewStageEvent, Severity } from '@ai-review/shared';

// SSE 事件契约以 shared 为单一事实源，此处转出口供既有调用方使用
export type { ReviewStageEvent } from '@ai-review/shared';

/** 与 packages/core 的 PipelineNodeName 保持一致（SSE stage 值契约，方案 3.9） */
const PIPELINE_NODE_NAMES: readonly PipelineNodeName[] = [
  'parse',
  'riskPlan',
  'correctness',
  'security',
  'performance',
  'static',
  'validate',
  'heal',
  'report',
];

function isPipelineNodeName(node: string): node is PipelineNodeName {
  return PIPELINE_NODE_NAMES.some((name) => name === node);
}

export type StartReviewOptions = {
  repoPath: string;
  mode: 'fast' | 'full';
  /** 阻断阈值，默认 BLOCKER（退出码契约的 BLOCKER 级语义） */
  blockOn?: Severity;
};

/** 组装流水线依赖（当前为 mock provider；真实 Provider 链接入后在此替换） */
export type PipelineDepsFactory = (repoPath: string, mode: 'fast' | 'full') => PipelineDeps;

/** 允许测试注入假流水线；生产即 @ai-review/core 的 runReviewPipeline */
export type PipelineRunner = typeof runReviewPipeline;

/**
 * 后台审查调度：触发流水线 → 节点级事件广播（SSE）→ 报告落库。
 * 事件为同步广播 + 内存分发，进程重启后不回放（checkpoint 持久化属团队版后续任务）。
 */
export class ReviewService {
  private jobSeq = 0;
  private readonly listeners = new Map<string, Set<(event: ReviewStageEvent) => void>>();

  constructor(
    private readonly store: ReviewStore,
    private readonly depsFactory: PipelineDepsFactory,
    private readonly runner: PipelineRunner = runReviewPipeline,
  ) {}

  /**
   * 触发一次异步审查。
   * @returns 审查 ID（调用方凭此订阅 SSE 与查询报告）
   */
  public startReview(options: StartReviewOptions): string {
    this.jobSeq += 1;
    const reviewId = `review-${Date.now()}-${this.jobSeq}`;
    // 后台执行：失败不抛给调用方，经 'failed' 事件与订阅者约定（规范 §7.4 转译而非静默）
    void this.runJob(reviewId, options);
    return reviewId;
  }

  /**
   * 订阅某次审查的进度事件。
   * @returns 取消订阅函数
   */
  public subscribe(reviewId: string, listener: (event: ReviewStageEvent) => void): () => void {
    const set = this.listeners.get(reviewId) ?? new Set<(event: ReviewStageEvent) => void>();
    set.add(listener);
    this.listeners.set(reviewId, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(reviewId);
    };
  }

  private emit(event: ReviewStageEvent): void {
    for (const listener of this.listeners.get(event.reviewId) ?? []) {
      listener(event);
    }
  }

  private async runJob(reviewId: string, options: StartReviewOptions): Promise<void> {
    const deps = this.depsFactory(options.repoPath, options.mode);
    try {
      const state = await this.runner(deps, {
        reviewId,
        onNodeUpdate: (node) => {
          if (isPipelineNodeName(node)) {
            this.emit({ type: 'stage', reviewId, stage: node });
          }
        },
      });
      const report = await this.buildReport(reviewId, options, deps, state);
      this.store.saveReport(report);
      const blockerCount = report.findings.filter(
        (finding) => finding.severity === 'BLOCKER' && !finding.isFalsePositive,
      ).length;
      this.emit({
        type: 'completed',
        reviewId,
        riskScore: report.meta.riskScore,
        blockerCount,
        blocking: report.findings.some((finding) =>
          severityMeetsThreshold(finding.severity, options.blockOn ?? 'BLOCKER'),
        ),
      });
    } catch (e) {
      this.emit({
        type: 'failed',
        reviewId,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /** 与 CLI run.ts 的报告装配保持同一形状（方案 3.8 五段式） */
  private async buildReport(
    reviewId: string,
    options: StartReviewOptions,
    deps: PipelineDeps,
    state: ReviewState,
  ): Promise<ReviewReport> {
    const blocking = state.findings.some((finding) =>
      severityMeetsThreshold(finding.severity, options.blockOn ?? 'BLOCKER'),
    );
    const branch = (await deps.gitReader.readBranch()).trim() || 'HEAD';
    return {
      meta: {
        reviewId,
        repoPath: options.repoPath,
        branch,
        model: 'mock + 静态分析',
        mode: options.mode,
        riskScore: getMaxRiskScore(state.plan),
        durationMs: state.metrics.durationMs,
        tokenUsed: state.metrics.totalTokens,
      },
      summary: `Reviewed ${state.context.metadata.totalFiles} staged file(s).`,
      findings: state.findings,
      qualityNotes: [],
      suggestions: [],
      assessment: blocking
        ? 'Changes should not be committed until blocking findings are addressed.'
        : 'No findings reached the configured blocking threshold.',
      degradedToStatic: state.metrics.degradedToStatic,
    };
  }
}
