#!/usr/bin/env node
import { Command } from 'commander';
import { EXIT_CODES } from '@ai-review/shared';
import type { Severity } from '@ai-review/shared';
import { buildIndex } from './commands/index.js';
import { initConfig } from './commands/init.js';
import { installHook } from './commands/install-hook.js';
import { startMcpServerCommand } from './commands/mcp.js';
import { startServerCommand } from './commands/server.js';
import { runReview } from './run.js';

const program = new Command();

program
  .name('ai-review')
  .description('AI Code Review Agent')
  .command('run')
  .description('审查暂存区变更')
  .option('--staged', '审查暂存区 diff（默认）', true)
  .option('--base <ref>', 'CI 模式：审查 <ref>...HEAD 区间变更')
  .option('--config <file>', '配置文件路径（默认 .ai-review.yml）')
  .option('--mode <mode>', 'fast | full；未传时读取配置')
  .option('--block-on <severity>', '阻断阈值；未传时读取配置')
  .option('--json', '输出 JSON')
  .action(async (options: {
    config?: string;
    mode?: 'fast' | 'full';
    blockOn?: Severity;
    json?: boolean;
    base?: string;
  }) => {
    try {
      const exitCode = await runReview({
        repoPath: process.cwd(),
        ...(options.config !== undefined ? { configPath: options.config } : {}),
        ...(options.mode !== undefined ? { mode: options.mode } : {}),
        ...(options.blockOn !== undefined ? { blockOn: options.blockOn } : {}),
        json: options.json ?? false,
        ...(options.base !== undefined ? { base: options.base } : {}),
      });
      process.exitCode = exitCode;
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : 'review failed'}\n`);
      process.exitCode = EXIT_CODES.configError;
    }
  });

program
  .command('init')
  .description('生成 .ai-review.yml 配置骨架（交互式）')
  .action(() => void initConfig());

program
  .command('index')
  .description('构建/增量更新 RAG 索引')
  .option('--paths <paths...>', '纳入索引的文件或目录')
  .option('--model <model>', '嵌入模型 id（默认本地 Ollama nomic-embed-text）')
  .option('--base-url <url>', 'OpenAI 兼容嵌入端点')
  .option('--config <file>', '配置文件路径（默认 .ai-review.yml）')
  .action((options: { paths?: string[]; model?: string; baseUrl?: string; config?: string }) => {
    const { paths, model, baseUrl, config } = options;
    if (paths === undefined || paths.length === 0) {
      console.error('error: --paths is required');
      process.exitCode = EXIT_CODES.configError;
      return;
    }
    void buildIndex({
      paths,
      // exactOptionalPropertyTypes：可选字段用条件展开，不显式传 undefined
      ...(model !== undefined ? { model } : {}),
      ...(baseUrl !== undefined ? { baseUrl } : {}),
      ...(config !== undefined ? { configPath: config } : {}),
    }).catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = EXIT_CODES.configError;
    });
  });

program.command('install-hook').description('安装 .husky/pre-commit 钩子').action(installHook);

program.command('server').description('启动 API Server + Dashboard')
  .option('--port <port>', '监听端口', '8080')
  .option('--db <file>', 'SQLite 审查库路径')
  .option('--web-dist <dir>', 'Dashboard 静态产物目录')
  .option('--config <file>', '配置文件路径（默认 .ai-review.yml）')
  .action((options: { port: string; db?: string; webDist?: string; config?: string }) => void startServerCommand(options));

program.command('mcp').description('以 stdio MCP 服务器暴露静态分析工具')
  .action(() => void startMcpServerCommand());

await program.parseAsync();
