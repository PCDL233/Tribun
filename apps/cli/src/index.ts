#!/usr/bin/env node
import { Command } from 'commander';
import { EXIT_CODES } from '@ai-review/shared';
import type { Severity } from '@ai-review/shared';
import { runReview } from './run.js';

const program = new Command();

program
  .name('ai-review')
  .description('AI Code Review Agent')
  .command('run')
  .description('审查暂存区变更')
  .option('--staged', '审查暂存区 diff（默认）', true)
  .option('--base <ref>', 'CI 模式：审查 <ref>...HEAD 区间变更')
  .option('--mode <mode>', 'fast | full', 'fast')
  .option('--block-on <severity>', '阻断阈值', 'BLOCKER')
  .option('--json', '输出 JSON')
  .action(async (options: {
    mode: 'fast' | 'full';
    blockOn: Severity;
    json?: boolean;
    base?: string;
  }) => {
    try {
      const exitCode = await runReview({
        repoPath: process.cwd(),
        mode: options.mode,
        blockOn: options.blockOn,
        json: options.json ?? false,
        ...(options.base !== undefined ? { base: options.base } : {}),
      });
      process.exitCode = exitCode;
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : 'review failed'}\n`);
      process.exitCode = EXIT_CODES.configError;
    }
  });

await program.parseAsync();
