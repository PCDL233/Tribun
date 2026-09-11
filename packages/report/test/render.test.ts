import type { ReviewReport } from '@ai-review/shared';
import { describe, expect, it } from 'vitest';
import { renderJson, renderMarkdown } from '../src/index.js';

const report = {
  meta: {
    reviewId: 'review-test',
    repoPath: '.',
    model: 'mock',
    mode: 'fast',
    riskScore: 20,
    durationMs: 1,
    tokenUsed: 0,
  },
  summary: 'One changed file.',
  findings: [],
  qualityNotes: [],
  suggestions: [],
  assessment: 'Pass.',
  degradedToStatic: [],
} satisfies ReviewReport;

describe('report renderers', () => {
  it('renders the five markdown sections', () => {
    const markdown = renderMarkdown(report);
    expect(markdown).toContain('## 5. 总体评估');
    expect(markdown).toContain('No findings');
  });

  it('renders valid JSON from the shared report object', () => {
    expect(JSON.parse(renderJson(report))).toEqual(report);
  });
});
