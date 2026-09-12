import { Node, Project, SyntaxKind, ts } from 'ts-morph';
import type { FileContext, Finding } from '@ai-review/shared';

/** AST 解析结果，供工具总线与 MCP/后续扩展复用。 */
export type AstFunctionSummary = {
  name: string;
  line: number;
  endLine: number;
  params: string[];
  isAsync: boolean;
};

export type AstClassSummary = {
  name: string;
  line: number;
  endLine: number;
};

export type AstDiagnostic = {
  message: string;
  line: number;
  column: number;
};

export type AstSummary = {
  functions: AstFunctionSummary[];
  classes: AstClassSummary[];
  imports: string[];
  diagnostics: AstDiagnostic[];
};

const JS_TS_EXTENSIONS = /\.(?:[cm]?[jt]sx?)$/i;
const STATIC_CONFIDENCE = 0.98;
function scriptKindFor(filePath: string): ts.ScriptKind {
  const extension = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.jsx') return ts.ScriptKind.JSX;
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function flattenMessage(message: unknown): string {
  if (typeof message === 'string') return message;
  if (message !== null && typeof message === 'object' && 'messageText' in message) {
    const value = message as { messageText: unknown; next?: unknown };
    const current = flattenMessage(value.messageText);
    const next = Array.isArray(value.next) ? value.next.map(flattenMessage).join(' ') : '';
    return `${current}${next === '' ? '' : ` ${next}`}`;
  }
  return String(message);
}

/** 解析 JS/TS 文件的函数、类、导入与语法诊断；解析失败时尽量返回已有 AST。 */
export function analyzeAst(source: string, filePath = 'reviewed.ts'): AstSummary {
  const project = new Project({ useInMemoryFileSystem: true });
  const sourceFile = project.createSourceFile(filePath, source);
  const functions = [
    ...sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.MethodDeclaration),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction),
  ].map((fn): AstFunctionSummary => ({
    name: Node.isArrowFunction(fn) ? '(anonymous)' : (fn.getName() ?? '(anonymous)'),
    line: fn.getStartLineNumber(),
    endLine: fn.getEndLineNumber(),
    params: fn.getParameters().map((parameter) => parameter.getName()),
    isAsync: fn.isAsync(),
  }));
  const classes = sourceFile
    .getDescendantsOfKind(SyntaxKind.ClassDeclaration)
    .map((klass): AstClassSummary => ({
      name: klass.getName() ?? '(anonymous)',
      line: klass.getStartLineNumber(),
      endLine: klass.getEndLineNumber(),
    }));
  const imports = sourceFile
    .getImportDeclarations()
    .map((declaration) => declaration.getModuleSpecifierValue());
  const parsedSource = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(filePath),
  );
  const diagnostics = (parsedSource as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics.map((diagnostic) => {
    const position = diagnostic.start ?? 0;
    const location = parsedSource.getLineAndCharacterOfPosition(position);
    return {
      message: flattenMessage(diagnostic.messageText),
      line: location.line + 1,
      column: location.character + 1,
    };
  });

  return { functions, classes, imports, diagnostics };
}

function changedLineNumbers(file: FileContext): Set<number> {
  return new Set(
    file.diff.changedLines.flatMap((line) => (line.newLineNo === null ? [] : [line.newLineNo])),
  );
}

function intersectsChangedLines(start: number, end: number, changed: Set<number>): boolean {
  for (let line = start; line <= end; line += 1) {
    if (changed.has(line)) return true;
  }
  return false;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').trim();
}

function importedBindingNames(sourceFile: import('ts-morph').SourceFile): Array<{ name: string; line: number; text: string }> {
  return sourceFile.getImportDeclarations().flatMap((declaration) => {
    const line = declaration.getStartLineNumber();
    const text = declaration.getText().slice(0, 500);
    const names: Array<{ name: string; line: number; text: string }> = [];
    const defaultImport = declaration.getDefaultImport();
    if (defaultImport !== undefined) names.push({ name: defaultImport.getText(), line, text });
    const namespaceImport = declaration.getNamespaceImport();
    if (namespaceImport !== undefined) names.push({ name: namespaceImport.getText(), line, text });
    for (const specifier of declaration.getNamedImports()) {
      names.push({ name: specifier.getAliasNode()?.getText() ?? specifier.getName(), line, text });
    }
    return names;
  });
}

function unusedImportFindings(file: FileContext, sourceFile: import('ts-morph').SourceFile, changed: Set<number>): Finding[] {
  const identifiers = sourceFile.getDescendantsOfKind(SyntaxKind.Identifier);
  return importedBindingNames(sourceFile)
    .filter((binding) => changed.has(binding.line))
    .filter((binding) => identifiers.filter((identifier) => {
      if (identifier.getText() !== binding.name) return false;
      return identifier.getFirstAncestorByKind(SyntaxKind.ImportDeclaration) === undefined;
    }).length === 0)
    .map((binding) => ({
      agent: 'static' as const,
      severity: 'NIT' as const,
      confidence: 0.96,
      filePath: file.diff.path,
      lineStart: binding.line,
      lineEnd: binding.line,
      title: `Unused import: ${binding.name}`,
      description: `The imported symbol ${binding.name} is not referenced in the changed file.`,
      suggestion: `Remove the unused import ${binding.name} or use it in the implementation.`,
      codeSnippet: binding.text,
      isFalsePositive: false,
    }));
}

/**
 * 将 AST 解析结果映射成确定性发现：语法错误、空 catch 块与未使用导入。
 * 只报告与本次新增/修改行相交的问题，避免把历史遗留错误误报给本次审查。
 */
export function astFindings(files: readonly FileContext[]): Finding[] {
  return files.flatMap((file) => {
    if (!JS_TS_EXTENSIONS.test(file.diff.path) || file.stagedContent === '') return [];
    const changed = changedLineNumbers(file);
    const summary = analyzeAst(file.stagedContent, file.diff.path);
    const findings: Finding[] = summary.diagnostics
      .filter((diagnostic) => changed.has(diagnostic.line))
      .map((diagnostic) => ({
        agent: 'static',
        severity: 'BLOCKER',
        confidence: STATIC_CONFIDENCE,
        filePath: file.diff.path,
        lineStart: diagnostic.line,
        lineEnd: diagnostic.line,
        title: 'Syntax error detected by AST parser',
        description: diagnostic.message,
        suggestion: 'Fix the syntax error before committing the change.',
        codeSnippet: file.stagedContent.split(/\r?\n/)[diagnostic.line - 1]?.trim(),
        isFalsePositive: false,
      }));

    const project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile(file.diff.path, file.stagedContent);
    findings.push(...unusedImportFindings(file, sourceFile, changed));
    for (const catchClause of sourceFile.getDescendantsOfKind(SyntaxKind.CatchClause)) {
      const block = catchClause.getBlock();
      if (stripComments(block.getText().slice(1, -1)) !== '') continue;
      const start = catchClause.getStartLineNumber();
      const end = block.getEndLineNumber();
      if (!intersectsChangedLines(start, end, changed)) continue;
      findings.push({
        agent: 'static',
        severity: 'WARNING',
        confidence: 0.94,
        filePath: file.diff.path,
        lineStart: start,
        lineEnd: end,
        title: 'Empty catch block silently ignores errors',
        description: 'The catch block does not record, rethrow, or otherwise handle the exception, which can hide failures.',
        suggestion: 'Handle the error explicitly or add a documented reason for intentionally ignoring it.',
        codeSnippet: block.getText().slice(0, 500),
        isFalsePositive: false,
      });
    }
    return findings;
  });
}
