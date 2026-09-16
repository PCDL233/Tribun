import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as lancedb from '@lancedb/lancedb';
import MiniSearch from 'minisearch';
import { embed, embedMany } from 'ai';
import type { EmbeddingModel } from 'ai';
import type { RagHit, RagQuery, RagRetriever } from '@ai-review/shared';
import { chunkFile } from './chunker.js';
import { rrfFuse } from './fusion.js';
import type { RankedHit } from './fusion.js';

/** LanceDB 行结构（vector 列由嵌入模型生成） */
type ChunkRow = {
  id: string;
  path: string;
  kind: string;
  text: string;
  contentHash: string;
  vector: number[];
};

export type KnowledgeBaseBuildSummary = {
  /** 入库块总数（增量后的最终状态） */
  totalChunks: number;
  /** 本次新向量化/重向化的块数（内容哈希去重后） */
  embeddedChunks: number;
  /** 本次移除的过期块数 */
  removedChunks: number;
};

/** 知识库错误（未 build 即查询等使用错误） */
export class KnowledgeBaseError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'KnowledgeBaseError';
  }
}

const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.py',
  '.go',
  '.java',
  '.md',
  '.txt',
  '.yml',
  '.yaml',
]);
/** 超过 1MB 的"文本"按二进制处理，避免锁文件/产物污染索引 */
const MAX_FILE_BYTES = 1024 * 1024;

/**
 * RAG 知识库（方案 3.5）：LanceDB 向量检索 + MiniSearch BM25 的混合召回，RRF 融合。
 * LanceDB 为嵌入式向量库（进程内运行，随 indexDir 持久化，零外部服务依赖）。
 * 增量索引：以块级内容哈希为键差量更新，仅对变更块重新向量化（方案 3.5）。
 */
export class KnowledgeBase implements RagRetriever {
  private table?: lancedb.Table;
  private bm25 = KnowledgeBase.createBm25();

  private static createBm25(): MiniSearch {
    return new MiniSearch({ fields: ['text'], storeFields: ['id', 'path', 'kind'] });
  }

  constructor(
    private readonly indexDir: string,
    private readonly embeddingModel: EmbeddingModel<string>,
  ) {}

  /**
   * 打开已有索引并重建 BM25 内存索引。
   * 仅加载 LanceDB 元数据和文本，不触发嵌入服务；未建立索引时返回 0。
   */
  public async open(): Promise<number> {
    const db = await lancedb.connect(this.indexDir);
    const tables = await db.tableNames();
    if (!tables.includes('chunks')) return 0;
    const table = await db.openTable('chunks');
    const rows = (await table.query().select(['id', 'path', 'kind', 'text']).toArray()) as Array<{
      id: string;
      path: string;
      kind: string;
      text: string;
    }>;
    this.table = table;
    this.rebuildBm25(rows);
    return rows.length;
  }

  /**
   * 构建/增量更新索引。重复调用是安全的：内容哈希未变的块不重复向量化。
   * @param paths 文件或目录路径列表（目录递归，仅收录文本扩展名）
   */
  public async build(paths: readonly string[]): Promise<KnowledgeBaseBuildSummary> {
    const chunks = paths.flatMap((path) => this.collectChunks(path));

    const db = await lancedb.connect(this.indexDir);
    const tables = await db.tableNames();
    if (!tables.includes('chunks')) {
      if (chunks.length === 0) {
        return { totalChunks: 0, embeddedChunks: 0, removedChunks: 0 };
      }
      const { embeddings } = await embedMany({
        model: this.embeddingModel,
        values: chunks.map((chunk) => chunk.text),
      });
      const rows: ChunkRow[] = chunks.map((chunk, index) => ({
        ...chunk,
        vector: embeddings[index] as number[],
      }));
      this.table = await db.createTable('chunks', rows);
      this.rebuildBm25(rows);
      return { totalChunks: rows.length, embeddedChunks: rows.length, removedChunks: 0 };
    }

    const table = await db.openTable('chunks');
    const existingRows = (await table
      .query()
      .select(['id', 'path', 'contentHash'])
      .toArray()) as Array<{
      id: string;
      path: string;
      contentHash: string;
    }>;
    const existingById = new Map(existingRows.map((row) => [row.id, row]));
    const chunksById = new Map(chunks.map((chunk) => [chunk.id, chunk]));

    // 差量计算：内容哈希未变 → 复用旧向量；新增/变更 → 重新向量化；消失 → 删除
    const changed = chunks.filter((chunk) => {
      const existing = existingById.get(chunk.id);
      return existing === undefined || existing.contentHash !== chunk.contentHash;
    });
    const removedIds = existingRows.filter((row) => !chunksById.has(row.id)).map((row) => row.id);

    // LanceDB 无 upsert：删除谓词覆盖"文件消失"与"内容变更"两类 id，变更块随后重新 add
    const deletedIds = [...removedIds, ...changed.map((chunk) => chunk.id)];
    if (deletedIds.length > 0) {
      // 删除谓词为 SQL 字符串：id 为受控生成的 path#index 形式，双引号转义后无注入面
      const predicate = deletedIds.map((id) => `id = "${id.replaceAll('"', '""')}"`).join(' OR ');
      await table.delete(predicate);
    }
    if (changed.length > 0) {
      const { embeddings } = await embedMany({
        model: this.embeddingModel,
        values: changed.map((chunk) => chunk.text),
      });
      const rows: ChunkRow[] = changed.map((chunk, index) => ({
        ...chunk,
        vector: embeddings[index] as number[],
      }));
      await table.add(rows);
    }

    this.table = table;
    const allRows = (await table
      .query()
      .select(['id', 'path', 'kind', 'text'])
      .toArray()) as Array<{
      id: string;
      path: string;
      kind: string;
      text: string;
    }>;
    this.rebuildBm25(allRows);
    return {
      totalChunks: allRows.length,
      embeddedChunks: changed.length,
      removedChunks: removedIds.length,
    };
  }

  /**
   * 混合检索：向量召回与 BM25 召回各取 topK 条，经 RRF 融合排序。
   * @throws {KnowledgeBaseError} 未调用 build() 时查询
   */
  public async query({ query, topK = 5, filter }: RagQuery): Promise<RagHit[]> {
    // table 由 build() 先行创建（规范 §5.3 断言豁免：生命周期保证，未 build 时显式报错）
    const table = this.table;
    if (table === undefined) {
      throw new KnowledgeBaseError('knowledge base is not built; call build() before query()');
    }

    const { embedding: queryVector } = await embed({
      model: this.embeddingModel,
      value: query,
    });
    const vectorRows = (await table
      .search(queryVector as number[])
      .limit(topK * 3)
      .toArray()) as Array<{ id: string; path: string; kind: string; text: string }>;
    const vectorHits: RankedHit[] = vectorRows.map((row) => ({
      id: row.id,
      path: row.path,
      kind: row.kind,
      text: row.text,
    }));

    const bm25Hits: RankedHit[] = this.bm25
      .search(query)
      .slice(0, topK * 3)
      .map((result) => ({
        id: String(result.id),
        path: String(result.path),
        kind: String(result.kind),
        text: typeof result.text === 'string' ? result.text : '',
      }));

    return rrfFuse(vectorHits, bm25Hits, topK, filter);
  }

  private rebuildBm25(
    rows: ReadonlyArray<{ id: string; path: string; kind: string; text: string }>,
  ): void {
    // MiniSearch 无持久化：全量重建（单机审查历史量级为毫秒级操作）
    this.bm25 = KnowledgeBase.createBm25();
    this.bm25.addAll(
      rows.map((row) => ({ id: row.id, path: row.path, kind: row.kind, text: row.text })),
    );
  }

  /** 递归遍历时跳过的目录：依赖、产物与版本库元数据不进索引 */
  private static readonly SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([
    'node_modules',
    'dist',
    '.git',
    '.turbo',
    '.ai-review-cache',
    '.ai-review-reports',
  ]);

  private collectChunks(path: string): ReturnType<typeof chunkFile> {
    const stats = statSync(path);
    if (stats.isDirectory()) {
      return readdirSync(path).flatMap((entry) => {
        // 隐藏目录（.git/.turbo 等）与依赖/产物目录不递归，防止误圈定 node_modules 打爆索引
        if (entry.startsWith('.') || KnowledgeBase.SKIPPED_DIRECTORIES.has(entry)) return [];
        return this.collectChunks(join(path, entry));
      });
    }
    const dot = path.lastIndexOf('.');
    const extension = dot === -1 ? '' : path.slice(dot).toLowerCase();
    if (!TEXT_EXTENSIONS.has(extension) || stats.size > MAX_FILE_BYTES) return [];
    return chunkFile(path, readFileSync(path, 'utf8'));
  }
}
