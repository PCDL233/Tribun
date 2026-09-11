import { ReviewAgent } from '@ai-review/agents';
import { DiffContextBuilder, GitReader, createGitRunner, createIgnoreRules } from '@ai-review/diff';
import { createMockProvider } from '@ai-review/llm';
import { renderJson, renderMarkdown } from '@ai-review/report';
import { EXIT_CODES, severityMeetsThreshold } from '@ai-review/shared';
import type { ExitCode, ReviewReport, Severity } from '@ai-review/shared';

export type RunReviewOptions = {
  repoPath: string;
  mode: 'fast' | 'full';
  blockOn: Severity;
  json: boolean;
};

/**
 * 执行一次离线 staged 审查。
 * @param options CLI 审查选项
 * @returns 稳定退出码
 */
export async function runReview(options: RunReviewOptions): Promise<ExitCode> {
  const startedAt = Date.now();
  const gitReader = new GitReader(createGitRunner(options.repoPath));
  const emptyRag = { query: async (): Promise<[]> => [] };
  const context = await new DiffContextBuilder(gitReader, emptyRag, createIgnoreRules([])).build();
  const findings = await new ReviewAgent(createMockProvider()).review(context);
  const report: ReviewReport = {
    meta: {
      reviewId: `review-${startedAt}`,
      repoPath: options.repoPath,
      branch: (await gitReader.readBranch()).trim() || 'HEAD',
      model: 'mock',
      mode: options.mode,
      riskScore: findings.length === 0 ? 0 : 50,
      durationMs: Date.now() - startedAt,
      tokenUsed: 0,
    },
    summary: `Reviewed ${context.metadata.totalFiles} staged file(s).`,
    findings,
    qualityNotes: [],
    suggestions: [],
    assessment: findings.some((finding) =>
      severityMeetsThreshold(finding.severity, options.blockOn),
    )
      ? 'Changes should not be committed until blocking findings are addressed.'
      : 'No findings reached the configured blocking threshold.',
    degradedToStatic: [],
  };
  process.stdout.write(`${options.json ? renderJson(report) : renderMarkdown(report)}\n`);
  return findings.some((finding) => severityMeetsThreshold(finding.severity, options.blockOn))
    ? EXIT_CODES.blocked
    : EXIT_CODES.ok;
}
