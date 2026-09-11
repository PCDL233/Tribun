import { runReviewPipeline, getMaxRiskScore } from '@ai-review/core';
import type { PipelineDeps } from '@ai-review/core';
import { GitReader, createGitRunner, createIgnoreRules } from '@ai-review/diff';
import { createMockProvider } from '@ai-review/llm';
import { renderJson, renderMarkdown } from '@ai-review/report';
import { EXIT_CODES, severityMeetsThreshold } from '@ai-review/shared';
import type { ExitCode, ReviewReport, Severity } from '@ai-review/shared';
import { buildDefaultRegistry } from '@ai-review/tools';

export type RunReviewOptions = {
  repoPath: string;
  mode: 'fast' | 'full';
  blockOn: Severity;
  json: boolean;
};

/**
 * 经 LangGraph 流水线执行一次离线 staged 审查（parse → riskPlan → 并行审查 → validate → report）。
 * @param options CLI 审查选项
 * @returns 稳定退出码（0 通过 / 1 阻断）
 */
export async function runReview(options: RunReviewOptions): Promise<ExitCode> {
  const startedAt = Date.now();
  const gitReader = new GitReader(createGitRunner(options.repoPath));
  const mock = createMockProvider();
  const deps: PipelineDeps = {
    gitReader,
    rag: { query: async () => [] },
    ignores: createIgnoreRules([]),
    history: { changeFrequency: async () => 0 },
    providers: { correctness: mock, security: mock, performance: mock },
    registry: buildDefaultRegistry(),
    mode: options.mode,
  };

  const state = await runReviewPipeline(deps, { reviewId: `review-${startedAt}` });
  const blocking = state.findings.some((finding) =>
    severityMeetsThreshold(finding.severity, options.blockOn),
  );

  const report: ReviewReport = {
    meta: {
      reviewId: `review-${startedAt}`,
      repoPath: options.repoPath,
      branch: (await gitReader.readBranch()).trim() || 'HEAD',
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

  process.stdout.write(`${options.json ? renderJson(report) : renderMarkdown(report)}\n`);
  return blocking ? EXIT_CODES.blocked : EXIT_CODES.ok;
}
