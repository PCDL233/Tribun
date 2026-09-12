import { startServer } from '@ai-review/server';

export type ServerCommandOptions = {
  port?: string;
  db?: string;
  webDist?: string;
  config?: string;
};

/** 启动团队版服务（方案 3.11 `ai-review server`：Hono API + Dashboard 同端口） */
export async function startServerCommand(options: ServerCommandOptions): Promise<void> {
  await startServer({
    port: options.port === undefined ? 8080 : Number(options.port),
    dbFile: options.db ?? '.ai-review-cache/reviews.db',
    webDistDir: options.webDist,
    ...(options.config !== undefined ? { configPath: options.config } : {}),
  });
}
