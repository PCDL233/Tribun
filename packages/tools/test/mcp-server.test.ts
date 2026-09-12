import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, describe, expect, it } from 'vitest';
import { buildToolsMcpServer } from '../src/mcp-server.js';

let tempDir: string | undefined;

afterAll(() => {
  if (tempDir !== undefined) rmSync(tempDir, { recursive: true, force: true });
});

describe('tools MCP server (方案 3.4 工具对外暴露)', () => {
  it('lists the registered analysis tools', async () => {
    const server = buildToolsMcpServer();
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = await InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual(['ast_parse', 'complexity_check', 'dependency_scan', 'secret_scan']);

    await client.close();
    await server.close();
  });

  it('calls complexity_check on a real file', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ai-review-mcp-'));
    const filePath = join(tempDir, 'hotspot.ts');
    // 15 个决策点：恰好触发默认阈值 15（规范 §3.1）
    const decisions = Array.from({ length: 15 }, (_, i) => `  if (v > ${i}) count += 1;`).join('\n');
    writeFileSync(filePath, `export function hotspot(v: number): number {\n  let count = 0;\n${decisions}\n  return count;\n}\n`);

    const server = buildToolsMcpServer();
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = await InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({ name: 'complexity_check', arguments: { file_path: filePath } });
    const payload = JSON.parse((result.content?.[0]?.text as string) ?? '[]') as Array<{ name: string; complexity: number }>;
    expect(payload).toHaveLength(1);
    expect(payload[0]).toMatchObject({ name: 'hotspot' });
    expect(payload[0]?.complexity).toBeGreaterThanOrEqual(15);

    await client.close();
    await server.close();
  });

  it('calls secret_scan on a diff text', async () => {
    const server = buildToolsMcpServer();
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = await InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: 'secret_scan',
      arguments: { diff_text: 'diff --git a/x.ts b/x.ts\n+++ b/x.ts\n+const key = "AKIAIOSFODNN7EXAMPLE";\n const ok = 1;\n' },
    });
    const payload = JSON.parse((result.content?.[0]?.text as string) ?? '[]') as Array<{ cweId?: string; severity: string }>;
    expect(payload).toHaveLength(1);
    expect(payload[0]).toMatchObject({ severity: 'BLOCKER', cweId: 'CWE-798' });

    await client.close();
    await server.close();
  });
});
