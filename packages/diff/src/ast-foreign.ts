import Parser from 'tree-sitter';
import Python from 'tree-sitter-python';
import Go from 'tree-sitter-go';
import Java from 'tree-sitter-java';
import type { FunctionSignature } from '@ai-review/shared';

/**
 * Tree-sitter 定位变更行所在函数/类（方案 3.1 / Phase 4 多语言支持）。
 * JS/TS 由 ts-morph 承担（context-builder 的 getTypeScriptContext），
 * Python/Go/Java 走官方语法包；与确定性优先原则一致：解析失败（语法错误、
 * 残缺源码）返回空 snippet，由调用方降级为行级窗口，不阻塞流水线
 * （方案 §六 风险表"解析失败自动降级为行级启发式分析"）。
 */

/** 各语言的函数/类容器节点类型（未命中时降级为行级窗口） */
const CONTAINER_NODE_KINDS: Readonly<Record<ForeignLanguage, readonly string[]>> = {
  python: ['function_definition', 'class_definition'],
  go: ['function_declaration', 'method_declaration'],
  java: ['method_declaration', 'class_declaration'],
};

export type ForeignLanguage = 'python' | 'go' | 'java';

function isForeignLanguage(language: string): language is ForeignLanguage {
  return language === 'python' || language === 'go' || language === 'java';
}

const LANGUAGE_BINDINGS: Readonly<Record<ForeignLanguage, Parser.Language>> = {
  // 语法包的官方 d.ts 声明为 { language; nodeTypeInfo } 形状，与 tree-sitter 的
  // Language 接口结构不兼容（运行时对象即原生 Language 绑定，已由 prebuild 冒烟验证），
  // 此处为唯一边界断言（规范 §5.3 豁免：类型声明缺陷，非业务逻辑推断）
  python: Python as unknown as Parser.Language,
  go: Go as unknown as Parser.Language,
  java: Java as unknown as Parser.Language,
};

/** changedLines 的最小结构签名（避免依赖 shared 内部泛型推导差异） */
type LineWindow = ReadonlyArray<{ readonly newLineNo: number | null }>;

/**
 * 提取变更行所在函数/类的完整源码与签名。
 * @param content 文件全文（index/HEAD 新侧内容）
 * @param changedLines 变更行（取 newLineNo 定位）
 * @param language 目标语言
 * @returns 函数级片段与签名；无法定位或解析失败时 snippet 为空串、signature 为 null
 */
export function getTreeSitterContext(
  content: string,
  changedLines: LineWindow,
  language: string,
): { snippet: string; signature: FunctionSignature } {
  if (!isForeignLanguage(language)) return { snippet: '', signature: null };

  const changedLineNumbers = new Set(
    changedLines.flatMap((line) => (line.newLineNo === null ? [] : [line.newLineNo])),
  );
  if (changedLineNumbers.size === 0) return { snippet: '', signature: null };

  let tree: Parser.Tree;
  try {
    const parser = new Parser();
    parser.setLanguage(LANGUAGE_BINDINGS[language]);
    tree = parser.parse(content);
  } catch {
    // 语法包加载/解析异常属可降级错误（规范 §7.7），退化为行级分析
    return { snippet: '', signature: null };
  }
  // 解析含 ERROR 节点时同样降级，避免以残缺语法树给出误导性函数边界
  if (tree.rootNode.hasError) return { snippet: '', signature: null };

  let containerNode: Parser.SyntaxNode | undefined;
  let containerKind = '';
  const visit = (node: Parser.SyntaxNode): void => {
    if (
      CONTAINER_NODE_KINDS[language].includes(node.type) &&
      coversChangedLine(node, changedLineNumbers) &&
      (containerNode === undefined || isSmaller(node, containerNode))
    ) {
      containerNode = node;
      containerKind = node.type;
    }
    for (const child of node.children) visit(child);
  };
  visit(tree.rootNode);
  if (containerNode === undefined) return { snippet: '', signature: null };

  const startLine = containerNode.startPosition.row + 1;
  // endPosition 指向末字符之后：若落在下一行行首（column 0），末行应回退一行
  const endRow =
    containerNode.endPosition.column === 0 && containerNode.endPosition.row >= startLine
      ? containerNode.endPosition.row
      : containerNode.endPosition.row + 1;
  const snippet = content
    .split(/\r?\n/)
    .slice(startLine - 1, endRow)
    .join('\n');
  return {
    snippet,
    signature: buildSignature(containerNode, containerKind, startLine, endRow),
  };
}

/** 节点行区间是否覆盖任一变更行（1-based 行） */
function coversChangedLine(
  node: Parser.SyntaxNode,
  changedLineNumbers: ReadonlySet<number>,
): boolean {
  for (let line = node.startPosition.row + 1; line <= node.endPosition.row + 1; line++) {
    if (changedLineNumbers.has(line)) return true;
  }
  return false;
}

/** 更小（更内层）的容器优先：函数体精确于外层类 */
function isSmaller(a: Parser.SyntaxNode, b: Parser.SyntaxNode): boolean {
  return a.endPosition.row - a.startPosition.row < b.endPosition.row - b.startPosition.row;
}

function buildSignature(
  node: Parser.SyntaxNode,
  kind: string,
  startLine: number,
  endLine: number,
): FunctionSignature {
  const name = node.childForFieldName('name')?.text ?? '(anonymous)';
  const parameters = node.childForFieldName('parameters');
  const isContainerClass = kind.includes('class');
  return {
    name: isContainerClass ? `class ${name}` : name,
    params: parameters?.namedChildren.map((child) => child.text) ?? [],
    // Python 显式 async 前缀；Go/Java 的同步模型无 async 语义
    isAsync: kind === 'function_definition' && (node.firstChild?.text === 'async' || false),
    range: { startLine, endLine },
  };
}
