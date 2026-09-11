import type { CodeContext } from '@ai-review/shared';
import { describe, expect, it } from 'vitest';
import { createMockProvider } from '../src/index.js';

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

describe('createMockProvider', () => {
  it('reports dynamic execution primitives', async () => {
    const findings = await createMockProvider().review(context);
    expect(findings[0]).toMatchObject({ agent: 'security', filePath: 'src/run.ts', lineStart: 3 });
  });

  it('honors an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(createMockProvider().review(context, controller.signal)).rejects.toThrow(
      'cancelled',
    );
  });
});
