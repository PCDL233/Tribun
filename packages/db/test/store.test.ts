import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, describe, expect, it } from 'vitest';
import type { Finding, ReviewReport } from '@ai-review/shared';
import { createReviewStore, ReviewStore, StoreError } from '../src/store.js';

let tempDir: string | undefined;

afterAll(() => {
  if (tempDir !== undefined) rmSync(tempDir, { recursive: true, force: true });
});

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    agent: 'static',
    severity: 'BLOCKER',
    confidence: 0.9,
    filePath: 'src/config.ts',
    lineStart: 1,
    lineEnd: 1,
    title: 'Possible AWS access key id in changed code',
    description: 'Hardcoded credential detected on an added line.',
    isFalsePositive: false,
    ...overrides,
  };
}

function makeReport(reviewId: string, findings: Finding[]): ReviewReport {
  return {
    meta: {
      reviewId,
      repoPath: '/repo/demo',
      branch: 'main',
      model: 'mock + 静态分析',
      mode: 'fast',
      riskScore: 45,
      durationMs: 120,
      tokenUsed: 0,
    },
    summary: 'Reviewed 1 staged file(s).',
    findings,
    qualityNotes: ['no complexity hotspots'],
    suggestions: ['rotate the exposed key'],
    assessment: 'Blocking findings present.',
    degradedToStatic: [],
  };
}

describe('ReviewStore', () => {
  it('round-trips a report through the file-backed store with computed counts', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ai-review-db-'));
    const store = createReviewStore(join(tempDir, 'reviews.db'));
    try {
      store.saveReport(
        makeReport('review-1', [
          makeFinding(),
          makeFinding({ severity: 'WARNING', agent: 'correctness', title: 'missing guard' }),
          makeFinding({ severity: 'NIT', agent: 'performance', title: 'long function' }),
        ]),
      );

      const list = store.listReviews();
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({
        reviewId: 'review-1',
        blockerCount: 1,
        warningCount: 1,
        nitCount: 1,
        totalFindings: 3,
      });

      const detail = store.getReportDetail('review-1');
      expect(detail.summary).toBe('Reviewed 1 staged file(s).');
      expect(detail.findings).toHaveLength(3);
      expect(detail.findings.map((finding) => finding.id)).toEqual([1, 2, 3]);
      expect(detail.findings[0]?.title).toBe('Possible AWS access key id in changed code');
      expect(detail.suggestions).toEqual(['rotate the exposed key']);
    } finally {
      store.close();
    }
  });

  it('persists false-positive flags across reads (Dashboard 回写)', () => {
    const store = new ReviewStore(new Database(':memory:'));
    try {
      store.saveReport(makeReport('review-fp', [makeFinding(), makeFinding({ title: 'second' })]));
      const [first] = store.getReportDetail('review-fp').findings;
      if (first === undefined) throw new Error('expected at least one finding row');

      expect(store.setFindingFalsePositive(first.id, true)).toBe(true);

      const detail = store.getReportDetail('review-fp');
      expect(detail.findings[0]?.isFalsePositive).toBe(true);
      expect(detail.findings[1]?.isFalsePositive).toBe(false);
      expect(store.setFindingFalsePositive(999, true)).toBe(false);
    } finally {
      store.close();
    }
  });

  it('returns zeroed statistics for an empty store', () => {
    const store = new ReviewStore(new Database(':memory:'));
    try {
      expect(store.getStats()).toEqual({
        totalReviews: 0,
        totalFindings: 0,
        falsePositiveCount: 0,
        avgRiskScore: 0,
        avgDurationMs: 0,
        totalTokenUsed: 0,
        severityDistribution: [
          { severity: 'BLOCKER', count: 0 },
          { severity: 'WARNING', count: 0 },
          { severity: 'NIT', count: 0 },
          { severity: 'PRAISE', count: 0 },
        ],
        riskTrend: [],
        topRiskyFiles: [],
        agentDistribution: [],
        tokenTrend: [],
      });
    } finally {
      store.close();
    }
  });

  it('round-trips cache entries keyed by content hash (方案 3.0 内容哈希去重)', () => {
    const store = new ReviewStore(new Database(':memory:'));
    try {
      expect(store.getCachedFindings('missing-key')).toBeUndefined();

      const finding = makeFinding();
      store.saveCacheEntries('review-1', [
        { cacheKey: 'key-a', findings: [finding], tokenSaved: 1200 },
      ]);
      // 相同键以最新口径覆盖（insert or replace）
      store.saveCacheEntries('review-2', [
        { cacheKey: 'key-a', findings: [finding, makeFinding({ title: 'second' })], tokenSaved: 800 },
      ]);

      expect(store.getCachedFindings('key-a')).toHaveLength(2);
      expect(store.getCacheSummary()).toEqual({ entries: 1, tokenSaved: 800 });

      // 损坏条目按"未命中"降级（core 侧语义），不抛错不阻断
      store['sqlite'].exec("UPDATE review_cache SET findings_json = '{broken' WHERE cache_key = 'key-a'");
      expect(store.getCachedFindings('key-a')).toBeUndefined();
    } finally {
      store.close();
    }
  });

  it('aggregates severity distribution, daily trend and top risky files', () => {
    const store = new ReviewStore(new Database(':memory:'));
    try {
      store.saveReport(
        makeReport('review-a', [
          makeFinding(),
          makeFinding({ severity: 'NIT', filePath: 'src/other.ts', title: 'nit' }),
        ]),
      );
      store.saveReport(
        makeReport('review-b', [makeFinding({ filePath: 'src/other.ts', title: 'again' })]),
      );
      // 标记一条误报：误报仍计入检出分布，但单独计数（误报率 = falsePositiveCount / totalFindings）
      const [flagged] = store.getReportDetail('review-b').findings;
      if (flagged === undefined) throw new Error('expected a finding row');
      store.setFindingFalsePositive(flagged.id, true);

      const stats = store.getStats();
      expect(stats.totalReviews).toBe(2);
      expect(stats.totalFindings).toBe(3);
      expect(stats.falsePositiveCount).toBe(1);
      expect(stats.avgRiskScore).toBe(45);
      expect(stats.severityDistribution[0]).toEqual({ severity: 'BLOCKER', count: 2 });
      // Top 高风险文件按发现数降序：other.ts 两条（NIT + BLOCKER），config.ts 一条
      expect(stats.topRiskyFiles[0]).toMatchObject({
        filePath: 'src/other.ts',
        findingCount: 2,
        blockerCount: 1,
      });
      expect(stats.riskTrend).toHaveLength(1);
      expect(stats.riskTrend[0]).toMatchObject({ reviews: 2, avgRiskScore: 45 });
    } finally {
      store.close();
    }
  });

  it('rejects unknown review ids and corrupt report rows', () => {
    const store = new ReviewStore(new Database(':memory:'));
    try {
      expect(() => store.getReportDetail('missing')).toThrow(StoreError);

      store.saveReport(makeReport('review-corrupt', []));
      // 直接改写 report_json 制造损坏行，验证读路径的 zod 防线
      store['sqlite'].exec(
        "UPDATE reviews SET report_json = '{broken' WHERE id = 'review-corrupt'",
      );
      expect(() => store.getReportDetail('review-corrupt')).toThrow(StoreError);
    } finally {
      store.close();
    }
  });
});
