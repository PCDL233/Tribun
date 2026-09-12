import { startToolsMcpServer } from '@ai-review/tools';

/**
 * 以 stdio MCP 服务器形态对外暴露静态分析工具（方案 3.4/5.3）：
 * Claude Code 等 MCP 客户端可直接复用 complexity_check / secret_scan。
 */
export async function startMcpServerCommand(): Promise<void> {
  await startToolsMcpServer();
}
