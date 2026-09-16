import { GitReader } from '@ai-review/diff';
import { createMockProvider, TokenBudget } from '@ai-review/llm';
import type { ReviewProvider } from '@ai-review/llm';
import type { CodeContext, Finding, GitRunner } from '@ai-review/shared';
import { buildDefaultRegistry } from '@ai-review/tools';
import { describe, expect, it } from 'vitest';
import { runReviewPipeline } from '../src/index.js';
import type { PipelineDeps } from '../src/index.js';

const FILE_PATH = 'src/auth/login.ts';

/** 构造合法的 unified diff：前 1 行上下文 + 可选删除行 + N 行新增 + 后 1 行上下文 */
function makeStagedDiff(path: string, addedCount: number, removedLine?: string): string {
  const oldCount = 2 + (removedLine === undefined ? 0 : 1);
  const newCount = 2 + addedCount;
  return [
    `diff --git a/${path} b/${path}`,
    'index 1111111..2222222 100644',
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,${oldCount} +1,${newCount} @@`,
    ' const config = loadConfig();',
    ...(removedLine === undefined ? [] : [`-${removedLine}`]),
    ...Array.from({ length: addedCount }, (_, i) => `+const value${i} = ${i};`),
    ' export function login() {}',
  ].join('\n');
}

/** deep 分流（路径 30 + 规模 25 + 删除守卫 20 = 75） */
const DEEP_DIFF = makeStagedDiff(FILE_PATH, 101, '  } catch (error) {');
/** quick 分流（路径 30 + 规模 15 = 45） */
const QUICK_DIFF = makeStagedDiff(FILE_PATH, 50);

function makeFakeGit(diff: string): GitRunner {
  return async (...args: string[]) => {
    const [command, second] = args;
    if (command === 'diff' && second === '--cached') return diff;
    if (command === 'show' && second !== undefined) {
      return 'const config = loadConfig();\nexport function login() {}\n';
    }
    if (command === 'branch') return 'main\n';
    throw new Error(`unexpected git invocation: ${args.join(' ')}`);
  };
}

function makeDeps(overrides: Partial<PipelineDeps> & { diff: string }): PipelineDeps {
  const mock = createMockProvider();
  return {
    gitReader: new GitReader(makeFakeGit(overrides.diff)),
    rag: { query: async () => [] },
    ignores: { allows: () => true },
    history: { changeFrequency: async () => 0 },
    providers: { correctness: mock, security: mock, performance: mock },
    registry: buildDefaultRegistry(),
    mode: 'fast',
    ...overrides,
  };
}

/** 只在拿到文件时产出发现的 Provider：区分"未分到文件"与"审查无发现" */
function llmMarkerProvider(calls: { count: number }): ReviewProvider {
  return {
    review: async (context: CodeContext): Promise<Finding[]> =>
      context.files.flatMap((file): Finding[] => {
        calls.count += 1;
        const line = file.diff.changedLines[0];
        return [
          {
            agent: 'security',
            severity: 'WARNING',
            confidence: 0.8,
            filePath: file.diff.path,
            lineStart: line?.newLineNo ?? 1,
            lineEnd: line?.newLineNo ?? 1,
            title: 'llm marker finding',
            description: 'produced only when the agent received files',
            isFalsePositive: false,
          },
        ];
      }),
  };
}

describe('runReviewPipeline', () => {
  it('runs static analysis end to end without triggering self-heal', async () => {
    const deps = makeDeps({
      diff: [
        `diff --git a/${FILE_PATH} b/${FILE_PATH}`,
        'index 1111111..2222222 100644',
        `--- a/${FILE_PATH}`,
        `+++ b/${FILE_PATH}`,
        '@@ -1,2 +1,4 @@',
        ' const config = loadConfig();',
        "+const accessKey = 'AKIAIOSFODNN7EXAMPLE';",
        '+const value = 1;',
        ' export function login() {}',
      ].join('\n'),
    });
    const state = await runReviewPipeline(deps, { reviewId: 'test-static-only' });

    expect(state.findings).toHaveLength(1);
    expect(state.findings[0]).toMatchObject({
      agent: 'static',
      severity: 'BLOCKER',
      filePath: FILE_PATH,
      confidence: 0.9,
    });
    expect(state.metrics.healRounds).toBe(0);
    expect(state.metrics.filesStaticOnly).toBe(1);
    expect(state.metrics.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('self-heals low-confidence blockers up to three rounds', async () => {
    const lowConfidence: ReviewProvider = {
      review: async (context: CodeContext): Promise<Finding[]> =>
        context.files.flatMap((file): Finding[] => {
          const line = file.diff.changedLines.find((l) => l.type === 'added');
          if (line?.newLineNo === undefined || line.newLineNo === null) return [];
          return [
            {
              agent: 'security',
              severity: 'BLOCKER',
              confidence: 0.4,
              filePath: file.diff.path,
              lineStart: line.newLineNo,
              lineEnd: line.newLineNo,
              title: 'low confidence blocker',
              description: 'needs re-review',
              isFalsePositive: false,
            },
          ];
        }),
    };
    const deps = makeDeps({
      diff: DEEP_DIFF,
      providers: {
        correctness: lowConfidence,
        security: lowConfidence,
        performance: lowConfidence,
      },
    });
    const seenNodes: string[] = [];
    const state = await runReviewPipeline(deps, {
      reviewId: 'test-self-heal',
      onNodeUpdate: (node) => seenNodes.push(node),
    });

    expect(state.metrics.healRounds).toBe(3);
    expect(state.findings).toHaveLength(1);
    expect(state.findings[0]).toMatchObject({ severity: 'BLOCKER', confidence: 0.4 });
    expect(seenNodes).toContain('heal');
    expect(seenNodes.lastIndexOf('heal')).toBeLessThan(seenNodes.lastIndexOf('report'));
  });

  it('degrades files to static-only when the token budget is exhausted', async () => {
    const deps = makeDeps({ diff: DEEP_DIFF, budget: new TokenBudget(0) });
    const state = await runReviewPipeline(deps, { reviewId: 'test-budget' });

    expect(state.metrics.degradedToStatic).toEqual([FILE_PATH]);
    expect(state.plan.deep).toEqual([]);
    expect(state.plan.staticOnly.map((file) => file.diff.path)).toEqual([FILE_PATH]);
  });

  it('reviews quick files only in full mode', async () => {
    const calls = { count: 0 };
    const marker = llmMarkerProvider(calls);
    const fastState = await runReviewPipeline(
      makeDeps({
        diff: QUICK_DIFF,
        providers: { correctness: marker, security: marker, performance: marker },
      }),
      {
        reviewId: 'test-fast',
      },
    );
    expect(fastState.metrics.filesQuick).toBe(1);
    expect(fastState.findings).toEqual([]);

    const fullState = await runReviewPipeline(
      makeDeps({
        diff: QUICK_DIFF,
        providers: { correctness: marker, security: marker, performance: marker },
        mode: 'full',
      }),
      { reviewId: 'test-full' },
    );

    expect(fullState.metrics.filesQuick).toBe(1);
    expect(fullState.findings).toHaveLength(1);
    expect(fullState.findings[0]).toMatchObject({ title: 'llm marker finding', confidence: 0.6 });
    expect(calls.count).toBeGreaterThan(0);
  });

  it('propagates git failures from the parse node', async () => {
    const failingGit: GitRunner = async () => {
      throw new Error('not a git repository');
    };
    const deps = makeDeps({ diff: DEEP_DIFF, gitReader: new GitReader(failingGit) });
    await expect(runReviewPipeline(deps, { reviewId: 'test-failure' })).rejects.toThrow(
      'not a git repository',
    );
  });

  it('reuses cached findings on identical content and skips the LLM (方案 3.0 内容哈希去重)', async () => {
    const cache = new Map<string, { findings: Finding[]; tokenSaved: number }>();
    const reviewCache = {
      get: async (key: string) => cache.get(key)?.findings,
      set: async (key: string, findings: Finding[], tokenSaved: number) => {
        cache.set(key, { findings, tokenSaved });
      },
    };
    const calls = { count: 0 };
    const marker = llmMarkerProvider(calls);
    const deps = makeDeps({
      diff: DEEP_DIFF,
      providers: { correctness: marker, security: marker, performance: marker },
      reviewCache,
      mode: 'full',
    });

    const firstState = await runReviewPipeline(deps, { reviewId: 'test-cache-1' });
    expect(firstState.metrics.cacheHits).toBe(0);
    const firstCalls = calls.count;
    expect(firstCalls).toBeGreaterThan(0);

    const secondState = await runReviewPipeline(deps, { reviewId: 'test-cache-2' });
    expect(secondState.metrics.cacheHits).toBeGreaterThan(0);
    expect(calls.count).toBe(firstCalls); // LLM 零调用：命中文件不再进入 Provider
    // 发现经缓存复用后与首轮一致（findings reducer 去重后仍保留 marker 发现）
    expect(secondState.findings).toHaveLength(firstState.findings.length);
  });
});
