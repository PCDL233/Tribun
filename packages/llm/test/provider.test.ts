import { AiReviewConfigSchema } from '@ai-review/shared';
import type { CodeContext } from '@ai-review/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConfiguredProvider, createMockProvider } from '../src/index.js';

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

describe('createConfiguredProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.AI_REVIEW_OLLAMA_BASE_URL;
  });

  it('tries local Ollama before mock when the cloud key is still a placeholder', async () => {
    process.env.AI_REVIEW_OLLAMA_BASE_URL = 'http://ollama.test/v1';
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ choices: [{ message: { content: '[]' } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const config = AiReviewConfigSchema.parse({
      llm: { provider: 'anthropic', apiKey: '${AI_REVIEW_API_KEY}' },
    });
    const findings = await createConfiguredProvider(config, 'security').review(context);

    expect(findings).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://ollama.test/v1/chat/completions');
  });
});
