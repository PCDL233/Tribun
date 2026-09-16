import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createOpenAI } from '@ai-sdk/openai';
import { runReviewPipeline, getMaxRiskScore } from '@ai-review/core';
import type { PipelineDeps } from '@ai-review/core';
import { GitReader, createFileHistory, createGitRunner, createIgnoreRules } from '@ai-review/diff';
import { KnowledgeBase } from '@ai-review/rag';
import { TokenBudget, createConfiguredProviders } from '@ai-review/llm';
import {
  deriveQualityNotes,
  deriveSuggestions,
  renderJson,
  renderMarkdown,
} from '@ai-review/report';
import { EXIT_CODES, severityMeetsThreshold } from '@ai-review/shared';
import { AiReviewConfigSchema, loadConfig } from '@ai-review/shared';
import type { ExitCode, RagRetriever, ReviewReport, Severity } from '@ai-review/shared';
import { buildDefaultRegistry } from '@ai-review/tools';

async function loadRagRetriever(
  config: ReturnType<typeof AiReviewConfigSchema.parse>,
): Promise<RagRetriever> {
  const empty: RagRetriever = { query: async () => [] };
  if (!config.rag.enabled || !existsSync(config.rag.indexDir)) return empty;

  try {
    const embedding = createOpenAI({
      baseURL: process.env.AI_REVIEW_EMBEDDING_BASE_URL ?? 'http://127.0.0.1:11434/v1',
      apiKey: config.llm.apiKey === '${AI_REVIEW_API_KEY}' ? 'ollama' : config.llm.apiKey,
    });
    const knowledgeBase = new KnowledgeBase(
      config.rag.indexDir,
      embedding.textEmbeddingModel(process.env.AI_REVIEW_EMBEDDING_MODEL ?? 'nomic-embed-text'),
    );
    const chunkCount = await knowledgeBase.open();
    return chunkCount > 0 ? knowledgeBase : empty;
  } catch {
    // RAG 是增强能力；索引损坏或嵌入服务不可用时不阻断本次审查。
    return empty;
  }
}
export type RunReviewOptions = {
  repoPath: string;
  mode?: 'fast' | 'full';
  blockOn?: Severity;
  json: boolean;
  /** CI 区间审查基线（方案 3.11）；undefined 表示审查暂存区 */
  base?: string;
  /** 配置文件路径；默认读取当前目录的 .ai-review.yml，缺失时使用 schema 默认值 */
  configPath?: string;
};

/**
 * 经 LangGraph 流水线执行一次离线 staged 审查（parse → riskPlan → 并行审查 → validate → report）。
 * @param options CLI 审查选项
 * @returns 稳定退出码（0 通过 / 1 阻断）
 */
export async function runReview(options: RunReviewOptions): Promise<ExitCode> {
  const startedAt = Date.now();
  const git = createGitRunner(options.repoPath);
  const gitReader = new GitReader(git);
  const configPath = options.configPath ?? '.ai-review.yml';
  const config = existsSync(configPath)
    ? loadConfig(configPath)
    : options.configPath === undefined
      ? AiReviewConfigSchema.parse({})
      : loadConfig(configPath);
  const mode = options.mode ?? config.review.mode;
  const blockOn = options.blockOn ?? config.review.blockOn;
  const rag = await loadRagRetriever(config);
  const deps: PipelineDeps = {
    gitReader,
    rag,
    ignores: createIgnoreRules(config.review.ignorePatterns),
    history: createFileHistory(git),
    providers: createConfiguredProviders(config),
    registry: buildDefaultRegistry({
      complexityThreshold: config.staticAnalysis.complexityThreshold,
    }),
    enabledTools: config.staticAnalysis.enabledTools,
    ragTopK: config.rag.topK,
    budget: new TokenBudget(config.llm.maxTokensPerReview),
    modelName:
      config.llm.provider === 'mock' ? 'mock + 静态分析' : `${config.llm.model} + 静态分析`,
    mode,
  };

  if (options.base !== undefined) deps.base = options.base;

  const state = await runReviewPipeline(deps, { reviewId: `review-${startedAt}` });
  const blocking = state.findings.some((finding) =>
    severityMeetsThreshold(finding.severity, blockOn),
  );

  const report: ReviewReport = {
    meta: {
      reviewId: `review-${startedAt}`,
      repoPath: options.repoPath,
      branch: (await gitReader.readBranch()).trim() || 'HEAD',
      model: deps.modelName ?? 'mock + 静态分析',
      mode,
      riskScore: getMaxRiskScore(state.plan),
      durationMs: state.metrics.durationMs,
      tokenUsed: state.metrics.totalTokens,
    },
    summary: `Reviewed ${state.context.metadata.totalFiles} staged file(s).`,
    findings: state.findings,
    qualityNotes: deriveQualityNotes(
      state.context.metadata.totalFiles,
      state.findings,
      state.metrics.degradedToStatic,
    ),
    suggestions: deriveSuggestions(state.findings),
    assessment: blocking
      ? 'Changes should not be committed until blocking findings are addressed.'
      : 'No findings reached the configured blocking threshold.',
    degradedToStatic: state.metrics.degradedToStatic,
  };

  const markdown = renderMarkdown(report);
  const json = renderJson(report);
  const outputDir = resolve(options.repoPath, config.report.outputDir);
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, `${report.meta.reviewId}.md`), markdown, 'utf8');
  writeFileSync(join(outputDir, `${report.meta.reviewId}.json`), json, 'utf8');
  process.stdout.write(`${options.json ? json : markdown}\n`);
  return blocking ? EXIT_CODES.blocked : EXIT_CODES.ok;
}
