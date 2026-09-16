import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EmbeddingModelV2 } from 'ai';
import { afterAll, describe, expect, it } from 'vitest';
import { chunkFile } from '../src/chunker.js';
import { KnowledgeBase, KnowledgeBaseError } from '../src/knowledge-base.js';

let tempDir: string | undefined;

afterAll(() => {
  if (tempDir !== undefined) rmSync(tempDir, { recursive: true, force: true });
});

describe('chunkFile (方案 3.5 AST/文档边界切块)', () => {
  it('chunks markdown by headings', () => {
    const chunks = chunkFile(
      'docs/guide.md',
      '# Title\nintro\n\n## Auth\nuse password login\n\n## Setup\nnpm install',
    );
    expect(chunks.map((chunk) => chunk.text.startsWith('#'))).toEqual([true, true, true]);
    expect(chunks[1]?.text).toContain('password login');
    expect(chunks.every((chunk) => chunk.contentHash.length === 64)).toBe(true);
  });

  it('chunks typescript by function boundaries', () => {
    const chunks = chunkFile(
      'src/a.ts',
      'export function login(user: string) {\n  return user;\n}\n\nexport function logout() {\n  return null;\n}\n',
    );
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({ kind: 'ts:login', path: 'src/a.ts' });
    expect(chunks[1]?.text).toContain('logout');
  });

  it('chunks python by function definition via tree-sitter', () => {
    const chunks = chunkFile(
      'src/b.py',
      'def transfer(amount):\n    return amount\n\ndef audit():\n    return True\n',
    );
    expect(chunks.map((chunk) => chunk.kind)).toEqual(['python:transfer', 'python:audit']);
  });

  it('splits oversized chunks by lines', () => {
    const longBody = Array.from({ length: 200 }, (_, i) => `const value${i} = ${i};`).join('\n');
    const chunks = chunkFile('src/big.ts', `function big() {\n${longBody}\n}\n`);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.text.length <= 1200)).toBe(true);
    expect(chunks[0]?.id).toBe('src/big.ts#0.0');
  });
});

/** 确定性哈希嵌入：词袋散列到 16 维并归一化，测试零外部依赖（方案 4.1 确定性优先） */
function makeHashEmbeddingModel(): EmbeddingModelV2<string> {
  const embed = (text: string): number[] => {
    const vector = new Array<number>(16).fill(0);
    for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
      let hash = 0;
      for (const char of word) hash = (hash * 31 + char.charCodeAt(0)) % 16;
      vector[hash] += 1;
    }
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
    return vector.map((value) => value / norm);
  };
  return {
    specificationVersion: 'v2',
    provider: 'test',
    modelId: 'hash-embedding',
    maxEmbeddingsPerCall: undefined,
    doEmbed: async ({ values }) => ({
      embeddings: values.map(embed),
      usage: { tokens: values.reduce((sum, value) => sum + value.length, 0) },
    }),
  };
}

describe('KnowledgeBase (方案 3.5 混合检索 + 增量索引)', () => {
  function makeKb(): KnowledgeBase {
    tempDir = mkdtempSync(join(tmpdir(), 'ai-review-rag-'));
    const docs = join(tempDir, 'docs');
    mkdirSync(docs);
    writeFileSync(
      join(docs, 'auth.md'),
      '# Auth\n\n## Login\npassword login verifies user credentials before session token issuance\n',
    );
    writeFileSync(
      join(docs, 'garden.md'),
      '# Garden\n\nroses and tulips bloom in spring sunlight\n',
    );
    return new KnowledgeBase(join(tempDir, 'vectors'), makeHashEmbeddingModel());
  }

  it('throws when querying before build', async () => {
    const kb = makeKb();
    await expect(kb.query({ query: 'anything' })).rejects.toThrow(KnowledgeBaseError);
  });

  it('builds an index and ranks the relevant document first', async () => {
    const kb = makeKb();
    const summary = await kb.build([join(tempDir, 'docs')]);
    expect(summary.totalChunks).toBeGreaterThanOrEqual(2);
    expect(summary.embeddedChunks).toBe(summary.totalChunks);

    const hits = await kb.query({ query: 'password login session token', topK: 2 });
    expect(hits).toHaveLength(2);
    expect(hits[0]?.path).toBe(join(tempDir, 'docs', 'auth.md'));
    expect(hits[0]?.text).toContain('password login');
  });

  it('skips re-embedding unchanged chunks and re-embeds only changed ones', async () => {
    const kb = makeKb();
    const docs = join(tempDir, 'docs');
    await kb.build([docs]);

    const unchanged = await kb.build([docs]);
    expect(unchanged.embeddedChunks).toBe(0);
    expect(unchanged.removedChunks).toBe(0);

    writeFileSync(join(docs, 'garden.md'), '# Garden\n\nnew content about compost and soil\n');
    const changed = await kb.build([docs]);
    expect(changed.embeddedChunks).toBe(1);
  });
});
