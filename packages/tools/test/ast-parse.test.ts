import type { FileContext } from '@ai-review/shared';
import { describe, expect, it } from 'vitest';
import { analyzeAst, astFindings } from '../src/ast-parse.js';

function makeFile(stagedContent: string, changedLines: number[]): FileContext {
  return {
    diff: {
      path: 'src/sample.ts',
      oldPath: null,
      binary: false,
      additions: changedLines.length,
      deletions: 0,
      hunks: [],
      changedLines: changedLines.map((newLineNo) => ({
        type: 'added',
        oldLineNo: null,
        newLineNo,
        content: stagedContent.split(/\r?\n/)[newLineNo - 1] ?? '',
      })),
      removedLines: [],
      summary: 'sample change',
    },
    stagedContent,
    snippet: stagedContent,
    signature: null,
    ragHits: [],
    changeType: 'feature',
  };
}

describe('analyzeAst', () => {
  it('returns functions, classes, imports and syntax diagnostics', () => {
    const summary = analyzeAst("import { x } from 'module';\nclass Demo {}\nfunction run(value: number) { return value; }");
    expect(summary.imports).toEqual(['module']);
    expect(summary.classes[0]?.name).toBe('Demo');
    expect(summary.functions[0]?.name).toBe('run');
    expect(summary.diagnostics).toEqual([]);

    expect(analyzeAst('function broken( {').diagnostics[0]?.message).toContain('expected');
  });
});

describe('astFindings', () => {
  it('reports changed syntax errors and empty catch blocks', () => {
    const source = 'try {\n  work();\n} catch {\n}\nconst broken: = 1;';
    const findings = astFindings([makeFile(source, [4, 5])]);
    expect(findings).toHaveLength(2);
    expect(findings.map((finding) => finding.severity)).toEqual(['BLOCKER', 'WARNING']);
    expect(findings.map((finding) => finding.lineStart).sort((a, b) => a - b)).toEqual([3, 5]);
  });

  it('suggests removing imports that are added but never referenced', () => {
    const source = "import { unused } from 'module';\nexport function run() { return 1; }";
    const findings = astFindings([makeFile(source, [1, 2])]);
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Unused import: unused', severity: 'NIT' }),
    ]));
  });

  it('skips non JS/TS files and unchanged diagnostics', () => {
    expect(astFindings([makeFile('const broken: = 1;', [1])])).toHaveLength(1);
    const markdown = makeFile('const broken: = 1;', [1]);
    markdown.diff.path = 'README.md';
    expect(astFindings([markdown])).toEqual([]);
  });
});


