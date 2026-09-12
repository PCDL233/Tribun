import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { openSqlite, ReviewStore, UserStore } from '@ai-review/db';
import { createFileHistory, createGitRunner, createIgnoreRules, GitReader } from '@ai-review/diff';
import { TokenBudget, createConfiguredProviders } from '@ai-review/llm';
import { runReviewPipeline } from '@ai-review/core';
import type { PipelineDeps } from '@ai-review/core';
import { AiReviewConfigSchema, loadConfig } from '@ai-review/shared';
import type { AiReviewConfig } from '@ai-review/shared';
import { buildDefaultRegistry } from '@ai-review/tools';
import { buildApp } from './app.js';
import { createStoreReviewCache } from './cache.js';
import { createReviewMetrics } from './metrics.js';
import { ReviewService } from './review-service.js';
import { createKnowledgeManager } from './knowledge.js';

export type ServerCliOptions = {
  port: number;
  dbFile: string;
  webDistDir: string | undefined;
  configPath?: string;
};

function parseArgs(argv: readonly string[]): ServerCliOptions {
  const values: { port: number; dbFile: string; webDistDir?: string; configPath?: string } = {
    port: 8080,
    dbFile: '.ai-review-cache/reviews.db',
  };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--port' && value !== undefined) values.port = Number(value);
    else if (flag === '--db' && value !== undefined) values.dbFile = value;
    else if (flag === '--web-dist' && value !== undefined) values.webDistDir = value;
    else if (flag === '--config' && value !== undefined) values.configPath = value;
  }
  return {
    ...values,
    webDistDir: values.webDistDir === undefined ? undefined : resolve(values.webDistDir),
    ...(values.configPath === undefined ? {} : { configPath: resolve(values.configPath) }),
  };
}

/** 组装服务端审查流水线；Provider 无法使用时仍保留确定性的 mock fallback。 */
function createPipelineDeps(repoPath: string, mode: 'fast' | 'full', config: AiReviewConfig, knowledge: ReturnType<typeof createKnowledgeManager>): PipelineDeps {
  const git = createGitRunner(repoPath);
  return {
    gitReader: new GitReader(git),
    rag: knowledge.retriever,
    ignores: createIgnoreRules(config.review.ignorePatterns),
    history: createFileHistory(git),
    providers: createConfiguredProviders(config),
    registry: buildDefaultRegistry({ complexityThreshold: config.staticAnalysis.complexityThreshold }),
    enabledTools: config.staticAnalysis.enabledTools,
    ragTopK: config.rag.topK,
    budget: new TokenBudget(config.llm.maxTokensPerReview),
    modelName: config.llm.provider === 'mock' ? 'mock + 静态分析' : `${config.llm.model} + 静态分析`,
    mode,
  };
}

export async function startServer(options: ServerCliOptions): Promise<void> {
  const configPath = options.configPath ?? '.ai-review.yml';
  const config = existsSync(configPath)
    ? loadConfig(configPath)
    : options.configPath === undefined
      ? AiReviewConfigSchema.parse({})
      : loadConfig(configPath);

  // ReviewStore 与 UserStore 共用同一 SQLite 连接（users/sessions/reviews 同库）
  const knowledge = createKnowledgeManager(config);
  const sqlite = openSqlite(options.dbFile);
  const store = new ReviewStore(sqlite);
  const users = new UserStore(sqlite);
  const metrics = createReviewMetrics();
  const reviewCache = createStoreReviewCache(store);
  const service = new ReviewService(
    store,
    (repoPath, mode) => ({ ...createPipelineDeps(repoPath, mode, config, knowledge), reviewCache }),
    runReviewPipeline,
    metrics,
  );
  const app = buildApp({ store, users, service, metrics, configPath, knowledge });

  if (options.webDistDir !== undefined && existsSync(options.webDistDir)) {
    // Hono 同时托管 Dashboard 静态产物（方案 3.10：单容器提供 API + 前端）
    app.use('*', serveStatic({ root: options.webDistDir }));
    // SPA fallback：非 API/指标路径的未命中请求回退 index.html，前端深链接（如 /reviews/:id）刷新可用。
    // 直接读文件返回：serveStatic 的 rewriteRequestPath 路径在 node-server 下存在流式响应兼容问题
    const indexHtmlPath = join(options.webDistDir, 'index.html');
    const indexHtml = readFileSync(indexHtmlPath, 'utf8');
    app.get('*', (c) => {
      if (c.req.path.startsWith('/api/') || c.req.path === '/metrics') return c.notFound();
      return c.html(indexHtml);
    });
  }

  const server = serve({ fetch: app.fetch, port: options.port });
  console.log(`ai-review server listening on http://localhost:${options.port}`);
  await new Promise<void>((keepAlive) => {
    server.on('close', () => keepAlive());
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await startServer(parseArgs(process.argv.slice(2)));
}
