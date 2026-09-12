import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import type { ReviewReport } from '@ai-review/shared';

/**
 * Prometheus 审查域指标（方案 Phase 3：审查耗时/token 消耗/检出率）。
 * 独立 Registry 而非全局默认值，避免多实例（测试并行）串扰。
 */
export class ReviewMetrics {
  private readonly registry = new Registry();

  private readonly reviewsTotal: Counter<'status'>;
  private readonly findingsTotal: Counter<'severity'>;
  private readonly tokensUsedTotal: Counter;
  private readonly reviewDurationSeconds: Histogram;

  constructor() {
    // 进程维度的默认指标（CPU/GC/事件循环）一并暴露，供 Grafana 通用面板复用
    collectDefaultMetrics({ register: this.registry });

    this.reviewsTotal = new Counter({
      name: 'ai_review_reviews_total',
      help: 'Total reviews by terminal status.',
      labelNames: ['status'],
      registers: [this.registry],
    });
    this.findingsTotal = new Counter({
      name: 'ai_review_findings_total',
      help: 'Total findings produced by reviews, by severity.',
      labelNames: ['severity'],
      registers: [this.registry],
    });
    this.tokensUsedTotal = new Counter({
      name: 'ai_review_tokens_used_total',
      help: 'Total LLM tokens consumed by reviews.',
      registers: [this.registry],
    });
    this.reviewDurationSeconds = new Histogram({
      name: 'ai_review_review_duration_seconds',
      help: 'End-to-end review pipeline duration in seconds.',
      // 覆盖 fast（≤15s）与 full（≤60s）的目标区间，两端留出诊断余量
      buckets: [1, 5, 15, 30, 60, 120, 300],
      registers: [this.registry],
    });
  }

  /** 审查成功终态：记录耗时、token 与各严重度发现数（误报也计入检出，误报率由 stats 接口另算） */
  public recordCompleted(report: ReviewReport): void {
    this.reviewsTotal.inc({ status: 'completed' });
    for (const finding of report.findings) {
      this.findingsTotal.inc({ severity: finding.severity });
    }
    this.tokensUsedTotal.inc(report.meta.tokenUsed);
    this.reviewDurationSeconds.observe(report.meta.durationMs / 1000);
  }

  /** 审查失败终态（流水线抛出/取消） */
  public recordFailed(): void {
    this.reviewsTotal.inc({ status: 'failed' });
  }

  /** 渲染 Prometheus 文本格式（GET /metrics 响应体） */
  public async render(): Promise<string> {
    return this.registry.metrics();
  }
}

/** 创建进程级指标实例（server 入口与测试各持一份） */
export function createReviewMetrics(): ReviewMetrics {
  return new ReviewMetrics();
}
