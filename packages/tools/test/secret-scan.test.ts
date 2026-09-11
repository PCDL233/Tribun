import type { CodeContext, FileContext } from '@ai-review/shared';
import { describe, expect, it } from 'vitest';
import { scanSecrets } from '../src/index.js';

/** 构造最小 FileContext：changedLines 供密钥扫描 */
function makeFileContext(options: {
  path: string;
  stagedContent?: string;
  addedLines?: { content: string; line: number }[];
}): FileContext {
  const added = options.addedLines ?? [];
  return {
    diff: {
      path: options.path,
      oldPath: null,
      binary: false,
      additions: added.length,
      deletions: 0,
      hunks: [],
      changedLines: added.map((line) => ({
        type: 'added',
        oldLineNo: null,
        newLineNo: line.line,
        content: line.content,
      })),
      removedLines: [],
      summary: added.map((line) => line.content).join('\n'),
    },
    stagedContent: options.stagedContent ?? '',
    snippet: '',
    signature: null,
    ragHits: [],
    changeType: 'feature',
  };
}

function makeContext(files: FileContext[]): CodeContext {
  return {
    files,
    metadata: {
      totalFiles: files.length,
      totalAdditions: files.reduce((total, file) => total + file.diff.additions, 0),
      totalDeletions: 0,
      languages: [],
      generatedAt: new Date().toISOString(),
    },
  };
}

describe('scanSecrets', () => {
  it('flags AWS keys and hardcoded credentials with expected severities', () => {
    const context = makeContext([
      makeFileContext({
        path: 'src/config.ts',
        addedLines: [
          { content: "const accessKey = 'AKIAIOSFODNN7EXAMPLE';", line: 3 },
          { content: "const dbPassword = 'super-secret-123';", line: 4 },
        ],
      }),
    ]);
    const findings = scanSecrets(context.files);
    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({
      severity: 'BLOCKER',
      filePath: 'src/config.ts',
      lineStart: 3,
      cweId: 'CWE-798',
    });
    expect(findings[1]).toMatchObject({ severity: 'WARNING', lineStart: 4 });
  });

  it('flags private key blocks', () => {
    const context = makeContext([
      makeFileContext({
        path: 'keys.pem',
        addedLines: [{ content: '-----BEGIN RSA PRIVATE KEY-----', line: 1 }],
      }),
    ]);
    expect(scanSecrets(context.files)).toHaveLength(1);
  });

  it('ignores env references and removed lines', () => {
    const context = makeContext([
      makeFileContext({
        path: 'src/env.ts',
        addedLines: [
          { content: 'const apiKey = process.env.API_KEY;', line: 2 },
          { content: 'const apiKey = config.apiKey;', line: 3 },
        ],
      }),
    ]);
    const file = context.files[0];
    if (file === undefined) throw new Error('fixture missing');
    file.diff.changedLines.push({
      type: 'removed',
      oldLineNo: 9,
      newLineNo: null,
      content: "const token = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ12';",
    });
    expect(scanSecrets(context.files)).toEqual([]);
  });
});
