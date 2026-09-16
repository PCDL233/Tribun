import { createHash } from 'node:crypto';
import { Node, Project, SyntaxKind } from 'ts-morph';
import Parser from 'tree-sitter';
import Python from 'tree-sitter-python';
import Go from 'tree-sitter-go';
import Java from 'tree-sitter-java';
import type { Chunk } from '@ai-review/shared';

/**
 * AST 边界切块（方案 3.5 知识库构建流程第 1 步）：
 * 代码按函数/类边界切分（JS/TS 走 ts-morph，Python/Go/Java 走 Tree-sitter 语法包，
 * 与 packages/diff 的上下文提取共用同一套语言矩阵）；Markdown 按标题切分。
 * 单块超过上限时按行二次切分，保证向量输入长度有界。
 */

/** 单块字符上限：约 300 token 的块在向量检索中粒度与召回兼顾 */
const MAX_CHUNK_CHARS = 1200;

/** 与 packages/diff ast-foreign 一致的容器节点类型（语言矩阵保持同步维护） */
const TREE_SITTER_CONTAINER_KINDS: Readonly<Record<string, readonly string[]>> = {
  python: ['function_definition', 'class_definition'],
  go: ['function_declaration', 'method_declaration'],
  java: ['method_declaration', 'class_declaration'],
};

const TREE_SITTER_BINDINGS: Readonly<Record<string, Parser.Language>> = {
  // 与 ast-foreign 相同的边界断言豁免：语法包官方 d.ts 与 tree-sitter 的 Language 接口结构不兼容
  python: Python as unknown as Parser.Language,
  go: Go as unknown as Parser.Language,
  java: Java as unknown as Parser.Language,
};

const TREE_SITTER_EXTENSIONS: Readonly<Record<string, string>> = {
  '.py': 'python',
  '.go': 'go',
  '.java': 'java',
};

function extensionOf(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot === -1 ? '' : path.slice(dot).toLowerCase();
}

/** 块内容哈希（增量索引键，方案 3.5：仅在文件内容变更时重新切块与向量化） */
export function contentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** 超长块按行二次切分，保持 id 后缀有序 */
function splitLongChunk(chunk: Chunk, path: string, index: number): Chunk[] {
  if (chunk.text.length <= MAX_CHUNK_CHARS) return [chunk];
  const pieces: string[] = [];
  const lines = chunk.text.split('\n');
  let buffer: string[] = [];
  let length = 0;
  for (const line of lines) {
    if (length + line.length + 1 > MAX_CHUNK_CHARS && buffer.length > 0) {
      pieces.push(buffer.join('\n'));
      buffer = [];
      length = 0;
    }
    buffer.push(line);
    length += line.length + 1;
  }
  if (buffer.length > 0) pieces.push(buffer.join('\n'));
  return pieces.map((text, pieceIndex) => ({
    id: `${path}#${index}.${pieceIndex}`,
    path,
    kind: chunk.kind,
    text,
    contentHash: contentHash(text),
  }));
}

function makeChunk(path: string, index: number, kind: string, text: string): Chunk {
  return { id: `${path}#${index}`, path, kind, text, contentHash: contentHash(text) };
}

/** Markdown 标题切分：无标题的文档整块入索引 */
function chunkMarkdown(path: string, content: string): Chunk[] {
  const sections = content.split(/^(?=#{1,6} )/m).filter((section) => section.trim() !== '');
  if (sections.length === 0) return [];
  return sections.flatMap((section, index) =>
    splitLongChunk(makeChunk(path, index, 'doc', section.trimEnd()), path, index),
  );
}

/** JS/TS 容器切块（ts-morph）：函数/方法/箭头函数/类 */
function chunkTypeScript(path: string, content: string): Chunk[] {
  const project = new Project({ useInMemoryFileSystem: true });
  const sourceFile = project.createSourceFile('chunked.ts', content);
  const containers = [
    ...sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.MethodDeclaration),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.ClassDeclaration),
  ].sort((a, b) => a.getStartLineNumber() - b.getStartLineNumber());

  if (containers.length === 0) {
    return [makeChunk(path, 0, 'module', content.trimEnd())];
  }
  const lines = content.split(/\r?\n/);
  return containers.flatMap((container, index) => {
    const text = lines
      .slice(container.getStartLineNumber() - 1, container.getEndLineNumber())
      .join('\n');
    const name =
      Node.isFunctionDeclaration(container) ||
      Node.isMethodDeclaration(container) ||
      Node.isClassDeclaration(container)
        ? (container.getName() ?? '(anonymous)')
        : '(anonymous)';
    return splitLongChunk(makeChunk(path, index, `ts:${name}`, text), path, index);
  });
}

/** Python/Go/Java 容器切块（Tree-sitter）：解析失败降级为整文件单块（规范 §7.7 可降级） */
function chunkTreeSitter(path: string, content: string, language: string): Chunk[] {
  let tree: Parser.Tree;
  try {
    const binding = TREE_SITTER_BINDINGS[language];
    if (binding === undefined) return [makeChunk(path, 0, `${language}:module`, content.trimEnd())];
    const parser = new Parser();
    parser.setLanguage(binding);
    tree = parser.parse(content);
  } catch {
    return [makeChunk(path, 0, `${language}:module`, content.trimEnd())];
  }
  if (tree.rootNode.hasError) return [makeChunk(path, 0, `${language}:module`, content.trimEnd())];

  const kinds = TREE_SITTER_CONTAINER_KINDS[language];
  if (kinds === undefined) return [makeChunk(path, 0, `${language}:module`, content.trimEnd())];
  const containers: Parser.SyntaxNode[] = [];
  const visit = (node: Parser.SyntaxNode): void => {
    if (kinds.includes(node.type)) containers.push(node);
    for (const child of node.children) visit(child);
  };
  visit(tree.rootNode);
  containers.sort((a, b) => a.startPosition.row - b.startPosition.row);

  if (containers.length === 0) {
    return [makeChunk(path, 0, `${language}:module`, content.trimEnd())];
  }
  const lines = content.split(/\r?\n/);
  return containers.flatMap((container, index) => {
    const name = container.childForFieldName('name')?.text ?? '(anonymous)';
    const text = lines.slice(container.startPosition.row, container.endPosition.row + 1).join('\n');
    return splitLongChunk(makeChunk(path, index, `${language}:${name}`, text), path, index);
  });
}

/**
 * 按语言将单文件切为 AST/文档边界块。
 * @param path 仓库内相对路径（同时作为语言判定与块 id 前缀）
 * @param content 文件全文
 * @returns 有序块列表；不认识的语言按整文件单块处理
 */
export function chunkFile(path: string, content: string): Chunk[] {
  const extension = extensionOf(path);
  if (extension === '.md') return chunkMarkdown(path, content);
  if (['.ts', '.tsx', '.js', '.jsx'].includes(extension)) return chunkTypeScript(path, content);
  const treeSitterLanguage = TREE_SITTER_EXTENSIONS[extension];
  if (treeSitterLanguage !== undefined) return chunkTreeSitter(path, content, treeSitterLanguage);
  return [makeChunk(path, 0, 'text', content.trimEnd())];
}
