import { AiReviewConfigSchema } from '@ai-review/shared';
import type { AiReviewConfig, CodeContext } from '@ai-review/shared';
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
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: '[]' } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
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

describe('domestic provider endpoint resolution', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.AI_REVIEW_DEEPSEEK_BASE_URL;
  });

  const cases: ReadonlyArray<{
    provider: AiReviewConfig['llm']['provider'];
    endpoint: string;
  }> = [
    { provider: 'deepseek', endpoint: 'https://api.deepseek.com/v1' },
    { provider: 'zhipu', endpoint: 'https://open.bigmodel.cn/api/paas/v4' },
    { provider: 'moonshot', endpoint: 'https://api.moonshot.cn/v1' },
    { provider: 'dashscope', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
    { provider: 'volcengine', endpoint: 'https://ark.cn-beijing.volces.com/api/v3' },
    { provider: 'minimax', endpoint: 'https://api.minimax.chat/v1' },
  ];

  for (const { provider, endpoint } of cases) {
    it(`uses the catalog default endpoint for ${provider}`, async () => {
      const fetchMock = vi.fn(
        async () =>
          new Response(JSON.stringify({ choices: [{ message: { content: '[]' } }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const config = AiReviewConfigSchema.parse({ llm: { provider, apiKey: 'sk-test' } });
      const findings = await createConfiguredProvider(config, 'security').review(context);

      expect(findings).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]?.[0]).toBe(`${endpoint}/chat/completions`);
    });
  }

  it('honors the generalized AI_REVIEW_<PROVIDER>_BASE_URL override', async () => {
    process.env.AI_REVIEW_DEEPSEEK_BASE_URL = 'http://deepseek.test/v1';
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: '[]' } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const config = AiReviewConfigSchema.parse({ llm: { provider: 'deepseek', apiKey: 'sk-test' } });
    await createConfiguredProvider(config, 'security').review(context);

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://deepseek.test/v1/chat/completions');
  });
});
