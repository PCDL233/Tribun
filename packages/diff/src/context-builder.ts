import pMap from 'p-map';
import { Node, Project, SyntaxKind } from 'ts-morph';
import type {
  CodeContext,
  FileContext,
  FileDiff,
  FunctionSignature,
  IgnoreRules,
  RagRetriever,
} from '@ai-review/shared';
import { createIgnoreRules, filterMeaningfulDiffs } from './filter.js';
import { GitReader } from './git-reader.js';
import { parseUnifiedDiff } from './parser.js';

const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.java': 'java',
};

function getLanguage(path: string): string | null {
  const extension = path.slice(path.lastIndexOf('.')).toLowerCase();
  return LANGUAGE_BY_EXTENSION[extension] ?? null;
}

function getLineWindow(
  content: string,
  changedLines: FileDiff['changedLines'],
  radius: number,
): string {
  const lines = content.split(/\r?\n/);
  const lineNumbers = changedLines
    .map((line) => line.newLineNo)
    .filter((line): line is number => line !== null);
  const start = Math.max(1, Math.min(...lineNumbers, 1) - radius);
  const end = Math.min(lines.length, Math.max(...lineNumbers, 1) + radius);
  return lines.slice(start - 1, end).join('\n');
}

function getTypeScriptContext(
  content: string,
  changedLines: FileDiff['changedLines'],
): { snippet: string; signature: FunctionSignature } {
  const project = new Project({ useInMemoryFileSystem: true });
  const sourceFile = project.createSourceFile('reviewed.ts', content);
  const changedLineNumbers = new Set(
    changedLines.flatMap((line) => (line.newLineNo === null ? [] : [line.newLineNo])),
  );
  const candidates = [
    ...sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.MethodDeclaration),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.ClassDeclaration),
  ];
  const candidate = candidates.find((node) => {
    const startLine = node.getStartLineNumber();
    const endLine = node.getEndLineNumber();
    return [...changedLineNumbers].some((line) => line >= startLine && line <= endLine);
  });

  if (candidate === undefined) {
    return { snippet: '', signature: null };
  }

  const startLine = candidate.getStartLineNumber();
  const endLine = candidate.getEndLineNumber();
  const snippet = sourceFile
    .getFullText()
    .split(/\r?\n/)
    .slice(startLine - 1, endLine)
    .join('\n');
  if (
    !Node.isFunctionDeclaration(candidate) &&
    !Node.isMethodDeclaration(candidate) &&
    !Node.isArrowFunction(candidate)
  ) {
    return { snippet, signature: null };
  }

  return {
    snippet,
    signature: {
      name: Node.isArrowFunction(candidate)
        ? '(anonymous)'
        : (candidate.getName() ?? '(anonymous)'),
      params: candidate.getParameters().map((parameter) => parameter.getName()),
      isAsync: candidate.isAsync(),
      range: { startLine, endLine },
    },
  };
}

function classifyChange(diff: FileDiff): FileContext['changeType'] {
  const text = `${diff.path}\n${diff.summary}`.toLowerCase();
  if (/(^|[./])test|spec|__tests__/.test(text)) return 'test';
  if (/(^|[./])docs?\//.test(text) || /\.md$/.test(diff.path)) return 'docs';
  if (/fix|bug|patch/.test(text)) return 'bugfix';
  if (/refactor|rename|move/.test(text)) return 'refactor';
  if (/format|prettier|eslint/.test(text)) return 'formatting';
  return 'feature';
}

function buildMetadata(contexts: FileContext[]): CodeContext['metadata'] {
  return {
    totalFiles: contexts.length,
    totalAdditions: contexts.reduce((total, context) => total + context.diff.additions, 0),
    totalDeletions: contexts.reduce((total, context) => total + context.diff.deletions, 0),
    languages: [
      ...new Set(
        contexts
          .map((context) => getLanguage(context.diff.path))
          .filter((language): language is string => language !== null),
      ),
    ],
    generatedAt: new Date().toISOString(),
  };
}

/**
 * 从暂存区 diff 构建 AI 审查上下文。
 * @throws {Error} staged diff 读取失败时透传 Git 错误
 */
export class DiffContextBuilder {
  constructor(
    private readonly gitReader: GitReader,
    private readonly rag: RagRetriever,
    private readonly ignores: IgnoreRules = createIgnoreRules([]),
    private readonly contextRadius = 50,
  ) {}

  /**
   * 读取、过滤并并行构建文件级上下文。
   * @returns 审查上下文包
   */
  public async build(): Promise<CodeContext> {
    const diffs = filterMeaningfulDiffs(
      parseUnifiedDiff(await this.gitReader.readStagedDiff()),
      this.ignores,
    );
    const contexts = await pMap(diffs, (diff) => this.buildFileContext(diff), { concurrency: 8 });
    return { files: contexts, metadata: buildMetadata(contexts) };
  }

  private async buildFileContext(diff: FileDiff): Promise<FileContext> {
    const stagedContent = await this.gitReader.readStagedFile(diff.path);
    const language = getLanguage(diff.path);
    const astContext =
      language === 'typescript' || language === 'javascript'
        ? getTypeScriptContext(stagedContent, diff.changedLines)
        : { snippet: '', signature: null };
    const snippet =
      astContext.snippet || getLineWindow(stagedContent, diff.changedLines, this.contextRadius);
    const ragHits = await this.rag.query({
      query: diff.summary,
      topK: 5,
      filter: { path: diff.path },
    });
    return {
      diff,
      stagedContent,
      snippet,
      signature: astContext.signature,
      ragHits,
      changeType: classifyChange(diff),
    };
  }
}
