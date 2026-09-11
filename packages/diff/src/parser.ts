import type { DiffHunk, DiffLine, FileDiff } from '@ai-review/shared';

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const DIFF_HEADER = /^diff --git a\/(.+) b\/(.+)$/;

function parsePath(path: string): string {
  return path.replace(/^"|"$/g, '').replace(/\\/g, '/');
}

function parseHunkHeader(line: string): DiffHunk | null {
  const match = HUNK_HEADER.exec(line);
  if (match === null) {
    return null;
  }

  return {
    oldStart: Number(match[1]),
    oldLines: Number(match[2] ?? 1),
    newStart: Number(match[3]),
    newLines: Number(match[4] ?? 1),
    lines: [],
  };
}

function createFileDiff(path: string, oldPath: string | null): FileDiff {
  return {
    path,
    oldPath,
    binary: false,
    additions: 0,
    deletions: 0,
    hunks: [],
    changedLines: [],
    removedLines: [],
    summary: '',
  };
}

function finishFileDiff(fileDiff: FileDiff): FileDiff {
  const additions = fileDiff.changedLines.length;
  const summary = fileDiff.changedLines
    .map((line) => line.content.trim())
    .filter((content) => content.length > 0)
    .slice(0, 8)
    .join('\n');

  return { ...fileDiff, additions, summary };
}

/**
 * 解析 git 产生的 unified diff。
 * @param text git diff 文本
 * @returns 每个变更文件的结构化 diff
 */
export function parseUnifiedDiff(text: string): FileDiff[] {
  const lines = text.split(/\r?\n/);
  const result: FileDiff[] = [];
  let current: FileDiff | null = null;
  let hunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  const finish = (): void => {
    if (current !== null) {
      result.push(finishFileDiff(current));
    }
  };

  for (const line of lines) {
    const header = DIFF_HEADER.exec(line);
    if (header !== null) {
      const oldPathText = header[1];
      const newPathText = header[2];
      if (oldPathText === undefined || newPathText === undefined) {
        continue;
      }
      finish();
      const path = parsePath(newPathText);
      const parsedOldPath = parsePath(oldPathText);
      const oldPath = parsedOldPath === path ? null : parsedOldPath;
      current = createFileDiff(path, oldPath);
      hunk = null;
      continue;
    }

    if (current === null) {
      continue;
    }

    if (line === 'Binary files /dev/null and b/' + current.path + ' differ') {
      current = { ...current, binary: true };
      continue;
    }

    if (line.startsWith('Binary files ')) {
      current = { ...current, binary: true };
      continue;
    }

    if (line.startsWith('--- ') || line.startsWith('+++ ')) {
      continue;
    }

    const parsedHunk = parseHunkHeader(line);
    if (parsedHunk !== null) {
      hunk = parsedHunk;
      current = { ...current, hunks: [...current.hunks, hunk] };
      oldLine = hunk.oldStart;
      newLine = hunk.newStart;
      continue;
    }

    if (hunk === null || line === '\\ No newline at end of file') {
      continue;
    }

    const content = line.slice(1);
    if (line.startsWith('+')) {
      const diffLine: DiffLine = { type: 'added', oldLineNo: null, newLineNo: newLine, content };
      hunk.lines.push(diffLine);
      current.changedLines = [...current.changedLines, diffLine];
      newLine += 1;
      continue;
    }

    if (line.startsWith('-')) {
      hunk.lines.push({ type: 'removed', oldLineNo: oldLine, newLineNo: null, content });
      current.deletions += 1;
      current.removedLines = [...current.removedLines, content];
      oldLine += 1;
      continue;
    }

    if (line.startsWith(' ')) {
      hunk.lines.push({ type: 'context', oldLineNo: oldLine, newLineNo: newLine, content });
      oldLine += 1;
      newLine += 1;
    }
  }

  finish();
  return result;
}
