import type { CodeContext, Finding } from '@ai-review/shared';
import { describe, expect, it } from 'vitest';
import { ReviewAgent } from '../src/index.js';

const context = {
  files: [
    {
      diff: {
        path: 'src/run.ts',
        oldPath: null,
        binary: false,
        additions: 1,
        deletions: 0,
        hunks: [],
        changedLines: [{ type: 'added', oldLineNo: null, newLineNo: 3, content: 'eval(input);' }],
        removedLines: [],
        summary: 'eval(input);',
      },
      stagedContent: 'eval(input);',
      snippet: 'eval(input);',
      signature: null,
      ragHits: [],
      changeType: 'feature',
    },
  ],
  metadata: {
    totalFiles: 1,
    totalAdditions: 1,
    totalDeletions: 0,
    languages: ['typescript'],
    generatedAt: new Date().toISOString(),
  },
} satisfies CodeContext;

describe('ReviewAgent', () => {
  it('keeps findings that point to changed lines', async () => {
    const provider = {
      review: async (): Promise<Finding[]> => [
        {
          agent: 'security',
          severity: 'WARNING',
          confidence: 0.8,
          filePath: 'src/run.ts',
          lineStart: 3,
          lineEnd: 3,
          title: 'Unsafe execution',
          description: 'Review input.',
          isFalsePositive: false,
        },
      ],
    };
    await expect(new ReviewAgent(provider).review(context)).resolves.toHaveLength(1);
  });

  it('drops findings outside changed lines', async () => {
    const provider = {
      review: async (): Promise<Finding[]> => [
        {
          agent: 'security',
          severity: 'WARNING',
          confidence: 0.8,
          filePath: 'src/run.ts',
          lineStart: 9,
          lineEnd: 9,
          title: 'Unchanged line',
          description: 'Ignore this.',
          isFalsePositive: false,
        },
      ],
    };
    await expect(new ReviewAgent(provider).review(context)).resolves.toEqual([]);
  });
});
