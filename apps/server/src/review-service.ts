import { getMaxRiskScore, runReviewPipeline } from '@ai-review/core';
import type { PipelineDeps, PipelineNodeName, ReviewState } from '@ai-review/core';
import type { ReviewStore } from '@ai-review/db';
import { severityMeetsThreshold } from '@ai-review/shared';
import { deriveQualityNotes, deriveSuggestions } from '@ai-review/report';
import type { ReviewReport, ReviewStageEvent, Severity } from '@ai-review/shared';
import type { ReviewMetrics } from './metrics.js';

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
  /** 发起人用户 id（Web 端数据隔离依据；CLI 直跑路径不传） */
  createdBy?: string;
};

/** 组装流水线依赖；Provider 链由配置选择云端、本地 Ollama 与 mock 保底。 */
export type PipelineDepsFactory = (repoPath: string, mode: 'fast' | 'full') => PipelineDeps;

/** 允许测试注入假流水线；生产即 @ai-review/core 的 runReviewPipeline */
export type PipelineRunner = typeof runReviewPipeline;

/**
 * 后台审查调度：触发流水线 → 节点级事件广播（SSE）→ 报告落库。
 * 事件为同步广播 + 内存分发，进程重启后不回放（checkpoint 持久化属团队版后续任务）。
 */
export class ReviewService {
  private jobSeq = 0;
  private readonly controllers = new Map<string, AbortController>();
  private readonly jobs = new Map<string, StartReviewOptions>();
  private readonly listeners = new Map<string, Set<(event: ReviewStageEvent) => void>>();
  private readonly terminalEvents = new Map<string, ReviewStageEvent>();

  constructor(
    private readonly store: ReviewStore,
    private readonly depsFactory: PipelineDepsFactory,
    private readonly runner: PipelineRunner = runReviewPipeline,
    private readonly metrics?: ReviewMetrics,
  ) {}

  /**
   * 触发一次异步审查。
   * @returns 审查 ID（调用方凭此订阅 SSE 与查询报告）
   */
  public startReview(options: StartReviewOptions): string {
    this.jobSeq += 1;
    const reviewId = `review-${Date.now()}-${this.jobSeq}`;
    // 后台执行：失败不抛给调用方，经 'failed' 事件与订阅者约定（规范 §7.4 转译而非静默）
    const controller = new AbortController();
    this.controllers.set(reviewId, controller);
    this.jobs.set(reviewId, options);
    void this.runJob(reviewId, options, controller);
    return reviewId;
  }

  /** 取消运行中的审查；任务已进入终态时返回 false。 */
  public cancelReview(reviewId: string): boolean {
    const controller = this.controllers.get(reviewId);
    if (controller === undefined || controller.signal.aborted) return false;
    controller.abort();
    return true;
  }

  /** 查询运行中任务的归属；用于 SSE/取消在报告落库前的访问控制。 */
  public getReviewOwner(reviewId: string): string | null {
    return this.jobs.get(reviewId)?.createdBy ?? null;
  }

  /** 返回已落库任务的终态事件，避免客户端晚连接 SSE 后永久等待。 */
  public getTerminalEvent(reviewId: string): ReviewStageEvent | undefined {
    const remembered = this.terminalEvents.get(reviewId);
    if (remembered !== undefined) return remembered;
    try {
      const report = this.store.getReportDetail(reviewId);
      const status = report.meta.status ?? 'completed';
      if (status === 'failed' || status === 'cancelled') {
        return {
          type: status,
          reviewId,
          message: report.meta.errorMessage ?? report.assessment,
        };
      }
      return {
        type: 'completed',
        reviewId,
        riskScore: report.meta.riskScore,
        blockerCount: report.findings.filter(
          (finding) => finding.severity === 'BLOCKER' && !finding.isFalsePositive,
        ).length,
        blocking: report.findings.some((finding) =>
          severityMeetsThreshold(finding.severity, 'BLOCKER'),
        ),
      };
    } catch {
      // 运行中的任务尚未落库；订阅者会从实时广播中收到终态事件。
      return undefined;
    }
  }

  /** 使用原审查的仓库与模式创建新任务。 */
  public rerunReview(reviewId: string, createdBy?: string): string {
    const input = this.store.getReviewInput(reviewId);
    return this.startReview({
      repoPath: input.repoPath,
      mode: input.mode,
      ...(createdBy === undefined ? {} : { createdBy }),
    });
  }

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
    if (event.type !== 'stage') {
      this.terminalEvents.set(event.reviewId, event);
      // 仅保留最近 1,000 条终态，避免长时间运行的服务发生无界内存增长。
      if (this.terminalEvents.size > 1000) {
        const oldest = this.terminalEvents.keys().next().value;
        if (oldest !== undefined) this.terminalEvents.delete(oldest);
      }
    }
    for (const listener of this.listeners.get(event.reviewId) ?? []) {
      listener(event);
    }
  }

  private async runJob(
    reviewId: string,
    options: StartReviewOptions,
    controller: AbortController,
  ): Promise<void> {
    try {
      const deps = this.depsFactory(options.repoPath, options.mode);
      const state = await this.runner(deps, {
        reviewId,
        signal: controller.signal,
        onNodeUpdate: (node, update) => {
          if (isPipelineNodeName(node)) {
            const detail =
              typeof update === 'object' && update !== null
                ? JSON.stringify(update).slice(0, 240)
                : undefined;
            this.emit({
              type: 'stage',
              reviewId,
              stage: node,
              ...(detail === undefined ? {} : { detail }),
            });
          }
        },
      });
      if (controller.signal.aborted) {
        throw new DOMException('The review was cancelled', 'AbortError');
      }
      const report = await this.buildReport(reviewId, options, deps, state);
      this.store.saveReport(report, options.createdBy, { diffText: state.rawDiff });
      this.metrics?.recordCompleted(report);
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
      const cancelled =
        controller.signal.aborted || (e instanceof DOMException && e.name === 'AbortError');
      const message = cancelled ? '审查已取消' : e instanceof Error ? e.message : String(e);
      this.metrics?.recordFailed();
      const status = cancelled ? ('cancelled' as const) : ('failed' as const);
      const failureReport: ReviewReport = {
        meta: {
          reviewId,
          repoPath: options.repoPath,
          branch: '—',
          model: '未完成',
          mode: options.mode,
          status,
          errorMessage: message,
          riskScore: 0,
          durationMs: 0,
          tokenUsed: 0,
        },
        summary: cancelled ? '审查任务已取消。' : '审查任务执行失败。',
        findings: [],
        qualityNotes: [],
        suggestions: [],
        assessment: message,
        degradedToStatic: [],
      };
      this.store.saveReport(failureReport, options.createdBy, { errorMessage: message });
      this.emit({ type: cancelled ? 'cancelled' : 'failed', reviewId, message });
    } finally {
      this.controllers.delete(reviewId);
      this.jobs.delete(reviewId);
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
    const suggestions = deriveSuggestions(state.findings);
    const qualityNotes = deriveQualityNotes(
      state.context.metadata.totalFiles,
      state.findings,
      state.metrics.degradedToStatic,
    );
    return {
      meta: {
        reviewId,
        repoPath: options.repoPath,
        branch,
        model: deps.modelName ?? 'mock + 静态分析',
        mode: options.mode,
        riskScore: getMaxRiskScore(state.plan),
        durationMs: state.metrics.durationMs,
        tokenUsed: state.metrics.totalTokens,
      },
      summary: `本次审查覆盖 ${state.context.metadata.totalFiles} 个文件，发现 ${state.findings.length} 个问题。`,
      findings: state.findings,
      qualityNotes,
      suggestions,
      assessment: blocking
        ? '存在达到阻断阈值的发现。Changes should not be committed until blocking findings are addressed.'
        : '未发现达到当前阻断阈值的问题。No findings reached the configured blocking threshold.',
      degradedToStatic: state.metrics.degradedToStatic,
    };
  }
}
