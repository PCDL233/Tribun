import type { FileDiff, FileHistory, ScoredFile } from '@ai-review/shared';
import { describe, expect, it } from 'vitest';
import { getMaxRiskScore, RiskPlanner } from '../src/index.js';

const stableHistory: FileHistory = { changeFrequency: async () => 0 };
const hotHistory: FileHistory = { changeFrequency: async () => 8 };

function makeDiff(overrides: Partial<FileDiff> & { path: string }): FileDiff {
  return {
    oldPath: null,
    binary: false,
    additions: 1,
    deletions: 0,
    hunks: [],
    changedLines: [{ type: 'added', oldLineNo: null, newLineNo: 2, content: 'return 1;' }],
    removedLines: [],
    summary: 'return 1;',
    ...overrides,
  };
}

async function planWith(history: FileHistory, diffs: FileDiff[]): Promise<ScoredFile[]> {
  const plan = await new RiskPlanner(history).plan(diffs);
  return [...plan.deep, ...plan.quick, ...plan.staticOnly];
}

describe('RiskPlanner', () => {
  it('routes auth-path large changes with removed guards to deep review', async () => {
    const scored = await planWith(stableHistory, [
      makeDiff({
        path: 'src/auth/login.ts',
        additions: 120,
        deletions: 5,
        removedLines: ['  } catch (error) {'],
      }),
    ]);
    // 路径 30 + 规模 25 + 删除守卫 20 = 75
    expect(scored[0]?.score).toBe(75);
  });

  it('adds weight for removed guard logic', async () => {
    const withGuard = await planWith(stableHistory, [
      makeDiff({
        path: 'src/util/math.ts',
        removedLines: ['  } catch (error) {', '    throw error;'],
      }),
    ]);
    const withoutGuard = await planWith(stableHistory, [makeDiff({ path: 'src/util/math.ts' })]);
    expect((withGuard[0]?.score ?? 0) - (withoutGuard[0]?.score ?? 0)).toBe(20);
  });

  it('adds weight for frequently changed files', async () => {
    const hot = await planWith(hotHistory, [makeDiff({ path: 'src/util/math.ts' })]);
    const cold = await planWith(stableHistory, [makeDiff({ path: 'src/util/math.ts' })]);
    expect((hot[0]?.score ?? 0) - (cold[0]?.score ?? 0)).toBe(15);
  });

  it('downweights test files to static-only', async () => {
    const plan = await new RiskPlanner(stableHistory).plan([
      makeDiff({ path: 'test/login.test.ts', additions: 60 }),
    ]);
    expect(plan.deep).toEqual([]);
    expect(plan.quick).toEqual([]);
    expect(plan.staticOnly).toHaveLength(1);
  });

  it('downweights formatting-only changes', async () => {
    const plan = await new RiskPlanner(stableHistory).plan([
      makeDiff({
        path: 'src/auth/login.ts',
        changedLines: [
          { type: 'added', oldLineNo: null, newLineNo: 2, content: '   ' },
          { type: 'added', oldLineNo: null, newLineNo: 3, content: '\t' },
        ],
      }),
    ]);
    expect(plan.staticOnly).toHaveLength(1);
    // 敏感路径 30 - 降权 25 = 5，仍远低于快速审查阈值
    expect(plan.staticOnly[0]?.score).toBe(5);
  });

  it('sorts buckets by descending score', async () => {
    const plan = await new RiskPlanner(stableHistory).plan([
      makeDiff({ path: 'docs/guide.md' }),
      makeDiff({ path: 'src/auth/login.ts', additions: 120 }),
      makeDiff({ path: 'src/util/math.ts' }),
    ]);
    const scores = [...plan.deep, ...plan.quick, ...plan.staticOnly].map((s) => s.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it('reports the maximum file score for the report meta', async () => {
    const plan = await new RiskPlanner(stableHistory).plan([
      makeDiff({
        path: 'src/auth/login.ts',
        additions: 120,
        removedLines: ['  } catch (error) {'],
      }),
      makeDiff({ path: 'docs/guide.md' }),
    ]);
    expect(getMaxRiskScore(plan)).toBe(75);
    expect(getMaxRiskScore({ deep: [], quick: [], staticOnly: [] })).toBe(0);
  });
});
