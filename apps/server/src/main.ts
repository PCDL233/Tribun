import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createReviewStore } from '@ai-review/db';
import { createGitRunner, createIgnoreRules, GitReader } from '@ai-review/diff';
import { createMockProvider } from '@ai-review/llm';
import { runReviewPipeline } from '@ai-review/core';
import type { PipelineDeps } from '@ai-review/core';
import { buildDefaultRegistry } from '@ai-review/tools';
import { buildApp } from './app.js';
import { createReviewMetrics } from './metrics.js';
import { ReviewService } from './review-service.js';

export type ServerCliOptions = {
  port: number;
  dbFile: string;
  webDistDir: string | undefined;
};

function parseArgs(argv: readonly string[]): ServerCliOptions {
  const values: { port: number; dbFile: string; webDistDir?: string } = {
    port: 8080,
    dbFile: '.ai-review-cache/reviews.db',
  };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--port' && value !== undefined) values.port = Number(value);
    else if (flag === '--db' && value !== undefined) values.dbFile = value;
    else if (flag === '--web-dist' && value !== undefined) values.webDistDir = value;
  }
  return {
    ...values,
    webDistDir: values.webDistDir === undefined ? undefined : resolve(values.webDistDir),
  };
}

/** 当前为 mock provider 流水线（与 CLI 一致）；真实 Provider 链接入后替换此工厂 */
function createMockDeps(repoPath: string, mode: 'fast' | 'full'): PipelineDeps {
  const mock = createMockProvider();
  return {
    gitReader: new GitReader(createGitRunner(repoPath)),
    rag: { query: async () => [] },
    ignores: createIgnoreRules([]),
    history: { changeFrequency: async () => 0 },
    providers: { correctness: mock, security: mock, performance: mock },
    registry: buildDefaultRegistry(),
    mode,
  };
}

export async function startServer(options: ServerCliOptions): Promise<void> {
  const store = createReviewStore(options.dbFile);
  const metrics = createReviewMetrics();
  const service = new ReviewService(store, createMockDeps, runReviewPipeline, metrics);
  const app = buildApp({ store, service, metrics });

  if (options.webDistDir !== undefined && existsSync(options.webDistDir)) {
    // Hono 同时托管 Dashboard 静态产物（方案 3.10：单容器提供 API + 前端）
    app.use('*', serveStatic({ root: options.webDistDir }));
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
