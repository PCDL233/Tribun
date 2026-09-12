import { existsSync, statSync } from 'node:fs';
import { createOpenAI } from '@ai-sdk/openai';
import { KnowledgeBase } from '@ai-review/rag';
import type { RagHit, RagQuery } from '@ai-review/shared';
import type { AiReviewConfig, KnowledgeStatus } from '@ai-review/shared';
import type { KnowledgeManager } from './app.js';

/**
 * 服务端知识库管理器：索引任务在后台执行，检索失败自动降级为空结果，
 * 避免本地 Ollama/嵌入服务不可用时阻断普通代码审查。
 */
export class ServerKnowledgeManager implements KnowledgeManager {
  private status: KnowledgeStatus;
  private readonly knowledgeBase: KnowledgeBase;
  private readonly ready: Promise<void>;

  constructor(private readonly config: AiReviewConfig) {
    const embedding = createOpenAI({
      baseURL: process.env.AI_REVIEW_EMBEDDING_BASE_URL ?? 'http://127.0.0.1:11434/v1',
      apiKey: config.llm.apiKey === '${AI_REVIEW_API_KEY}' ? 'ollama' : config.llm.apiKey,
    });
    this.knowledgeBase = new KnowledgeBase(
      config.rag.indexDir,
      embedding.textEmbeddingModel(process.env.AI_REVIEW_EMBEDDING_MODEL ?? 'nomic-embed-text'),
    );
    const exists = existsSync(config.rag.indexDir);
    this.status = {
      status: config.rag.enabled ? 'idle' : 'disabled',
      indexDir: config.rag.indexDir,
      chunkCount: 0,
      paths: [...config.rag.knowledgeBasePaths],
      lastIndexedAt: exists ? statSync(config.rag.indexDir).mtime.toISOString() : null,
      error: null,
    };
    this.ready = this.loadExistingIndex(exists);
  }

  private async loadExistingIndex(exists: boolean): Promise<void> {
    if (!this.config.rag.enabled || !exists) return;
    try {
      const chunkCount = await this.knowledgeBase.open();
      this.status = { ...this.status, status: chunkCount > 0 ? 'ready' : 'idle', chunkCount };
    } catch (error) {
      this.status = {
        ...this.status,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  public async getStatus(): Promise<KnowledgeStatus> {
    await this.ready;
    return this.status;
  }

  public async reindex(): Promise<void> {
    await this.ready;
    if (!this.config.rag.enabled || this.status.status === 'running') return;
    this.status = { ...this.status, status: 'running', error: null };
    try {
      const summary = await this.knowledgeBase.build(this.config.rag.knowledgeBasePaths);
      this.status = {
        ...this.status,
        status: 'ready',
        chunkCount: summary.totalChunks,
        lastIndexedAt: new Date().toISOString(),
        error: null,
      };
    } catch (error) {
      this.status = {
        ...this.status,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** RagRetriever 兼容适配：知识库未初始化或嵌入服务不可用时返回空召回。 */
  public readonly retriever = {
    query: async (query: RagQuery): Promise<RagHit[]> => {
      await this.ready;
      if (!this.config.rag.enabled || this.status.status !== 'ready') return [];
      try {
        return await this.knowledgeBase.query(query);
      } catch {
        return [];
      }
    },
  };
}

export function createKnowledgeManager(config: AiReviewConfig): ServerKnowledgeManager {
  return new ServerKnowledgeManager(config);
}
