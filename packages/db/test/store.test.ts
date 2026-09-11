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
