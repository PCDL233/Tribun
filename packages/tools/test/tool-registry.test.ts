import type { CodeContext, Finding } from '@ai-review/shared';
import { describe, expect, it } from 'vitest';
import { buildDefaultRegistry, ToolRegistry } from '../src/index.js';

function makeContext(paths: string[]): CodeContext {
  return {
    files: paths.map((path) => ({
      diff: {
        path,
        oldPath: null,
        binary: false,
        additions: 1,
        deletions: 0,
        hunks: [],
        changedLines: [{ type: 'added', oldLineNo: null, newLineNo: 1, content: 'x' }],
        removedLines: [],
        summary: 'x',
      },
      stagedContent: 'x',
      snippet: 'x',
      signature: null,
      ragHits: [],
      changeType: 'feature',
    })),
    metadata: {
      totalFiles: paths.length,
      totalAdditions: paths.length,
      totalDeletions: 0,
      languages: [],
      generatedAt: new Date().toISOString(),
    },
  };
}

const noopTool = {
  name: 'noop',
  description: 'does nothing',
  run: (): Finding[] => [],
};

describe('ToolRegistry', () => {
  it('runs all registered tools and merges findings', () => {
    const registry = new ToolRegistry();
    registry.register(noopTool);
    registry.register({
      name: 'flag-all',
      description: 'flags one finding',
      run: (context) =>
        context.files.map((file): Finding => ({
          agent: 'static',
          severity: 'NIT',
          confidence: 0.9,
          filePath: file.diff.path,
          lineStart: 1,
          lineEnd: 1,
          title: 'flagged',
          description: 'flagged by tool',
          isFalsePositive: false,
        })),
    });
    const context = makeContext(['a.ts']);
    expect(registry.runAll(context)).toHaveLength(1);
  });

  it('honors the enabled tool list and ignores unknown names', () => {
    const registry = buildDefaultRegistry();
    const context = makeContext(['a.ts']);
    expect(registry.runAll(context, ['secret_scan', 'dependency_scan'])).toEqual([]);
    expect(registry.list()).toEqual([
      'ast_parse',
      'complexity_check',
      'dependency_scan',
      'secret_scan',
    ]);
  });
});
