import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff } from '../src/index.js';

describe('parseUnifiedDiff', () => {
  it('parses additions, deletions, and line numbers', () => {
    const diff = [
      'diff --git a/src/example.ts b/src/example.ts',
      'index 1111111..2222222 100644',
      '--- a/src/example.ts',
      '+++ b/src/example.ts',
      '@@ -2,3 +2,4 @@ export function example(): string {',
      ' context',
      '-  return oldValue;',
      '+  const value = "new";',
      '+  return value;',
      ' }',
      '',
    ].join('\n');

    const [fileDiff] = parseUnifiedDiff(diff);

    expect(fileDiff).toMatchObject({
      path: 'src/example.ts',
      oldPath: null,
      additions: 2,
      deletions: 1,
      changedLines: [
        { type: 'added', newLineNo: 3, content: '  const value = "new";' },
        { type: 'added', newLineNo: 4, content: '  return value;' },
      ],
      removedLines: ['  return oldValue;'],
    });
    expect(fileDiff?.summary).toContain('const value = "new";');
  });

  it('marks binary files without hunks', () => {
    const diff = [
      'diff --git a/assets/logo.png b/assets/logo.png',
      'index 1111111..2222222 100644',
      'Binary files a/assets/logo.png and b/assets/logo.png differ',
    ].join('\n');

    const [fileDiff] = parseUnifiedDiff(diff);

    expect(fileDiff).toMatchObject({ path: 'assets/logo.png', binary: true, hunks: [] });
  });
});
