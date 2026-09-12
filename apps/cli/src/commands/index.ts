import { createOpenAI } from '@ai-sdk/openai';
import { KnowledgeBase } from '@ai-review/rag';
import { AiReviewConfigSchema } from '@ai-review/shared';

export type BuildIndexOptions = {
  paths: string[];
  /** 嵌入模型 id；默认走本地 Ollama（方案 3.5：本地优先降低成本） */
  model?: string;
  /** OpenAI 兼容端点（Ollama 原生提供 /v1 兼容层） */
  baseUrl?: string;
};

/** 构建/增量更新 RAG 索引（方案 3.11 `ai-review index`，索引目录取自配置默认值） */
export async function buildIndex(options: BuildIndexOptions): Promise<void> {
  const config = AiReviewConfigSchema.parse({});
  const openai = createOpenAI({
    baseURL: options.baseUrl ?? 'http://127.0.0.1:11434/v1',
    apiKey: 'ollama',
  });
  const kb = new KnowledgeBase(config.rag.indexDir, openai.textEmbeddingModel(options.model ?? 'nomic-embed-text'));
  const summary = await kb.build(options.paths);
  console.log(
    `index updated: ${summary.totalChunks} chunk(s), ${summary.embeddedChunks} embedded, ${summary.removedChunks} removed`,
  );
}
