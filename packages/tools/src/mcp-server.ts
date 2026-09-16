import { readFile } from 'node:fs/promises';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { analyzeAst } from './ast-parse.js';
import { analyzeComplexity } from './complexity.js';
import { scanDependencyManifest } from './dependency-scan.js';
import { scanDiffTextForSecrets } from './secret-scan.js';

/**
 * MCP 工具服务器（方案 3.4）：把进程内静态分析工具经 MCP 协议（stdio）对外暴露，
 * 供 Claude Code 等外部 Agent 即插即用。与 ToolRegistry 共享同一实现——
 * 工具逻辑不在此重复，MCP 层只做协议适配（规范 §6.5：调用必须经总线，禁止绕过）。
 */

/**
 * 组装 MCP Server（未连接传输层，测试用 InMemoryTransport 注入）。
 * 工具名与方案 3.4 工具清单一致：ast_parse / complexity_check / dependency_scan / secret_scan。
 */
export function buildToolsMcpServer(): McpServer {
  const server = new McpServer({ name: 'ai-review-tools', version: '1.0.0' });

  server.registerTool(
    'ast_parse',
    {
      title: 'AST parse',
      description:
        'Parse a JavaScript or TypeScript file and return functions, classes, imports, and syntax diagnostics.',
      inputSchema: {
        file_path: z.string().describe('Absolute or cwd-relative path of the source file'),
      },
    },
    async ({ file_path }) => {
      const source = await readFile(file_path, 'utf8');
      const result = analyzeAst(source, file_path);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  server.registerTool(
    'complexity_check',
    {
      title: 'Cyclomatic complexity check',
      description: 'List functions whose cyclomatic complexity exceeds the threshold (TS/JS).',
      inputSchema: {
        file_path: z.string().describe('Absolute or cwd-relative path of the source file'),
        threshold: z.number().int().min(1).optional().describe('Complexity threshold, default 15'),
      },
    },
    async ({ file_path, threshold }) => {
      const source = await readFile(file_path, 'utf8');
      const result = analyzeComplexity(source, threshold ?? 15);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  server.registerTool(
    'dependency_scan',
    {
      title: 'Dependency advisory scan',
      description:
        'Check a package.json manifest against the bundled offline dependency advisory set.',
      inputSchema: {
        file_path: z.string().describe('Absolute or cwd-relative path to package.json'),
      },
    },
    async ({ file_path }) => {
      const source = await readFile(file_path, 'utf8');
      const result = scanDependencyManifest(source, file_path);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  server.registerTool(
    'secret_scan',
    {
      title: 'Secret scan',
      description: 'Detect hardcoded secrets/credentials in the added lines of a unified diff.',
      inputSchema: {
        diff_text: z.string().describe('Unified diff text to scan'),
      },
    },
    async ({ diff_text }) => {
      const result = scanDiffTextForSecrets(diff_text);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  return server;
}

/** 启动 stdio 传输的 MCP 工具服务器（阻塞至传输关闭） */
export async function startToolsMcpServer(): Promise<void> {
  const server = buildToolsMcpServer();
  await server.connect(new StdioServerTransport());
  // stdio MCP 服务器的生命周期由对端控制，保持进程存活直到传输关闭
  await new Promise<void>(() => {});
}
