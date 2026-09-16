import type { FileContext, Finding, Severity } from '@ai-review/shared';

/** 密钥检测规则：高置信正则先行（方案四 技术栈选型"依赖与密钥扫描"条目） */
type SecretPattern = {
  name: string;
  pattern: RegExp;
  severity: Severity;
  cweId: string;
};

/**
 * 检测规则表。只扫描新增行（AI 审查聚焦新增/修改代码，方案 3.1）；
 * 云厂商密钥/私钥块误报代价低、漏报代价高，定 BLOCKER；
 * 通用赋值型凭据易误报（占位符/测试值），降为 WARNING 交由交叉验证过滤。
 */
const SECRET_PATTERNS: readonly SecretPattern[] = [
  {
    name: 'AWS access key id',
    pattern: /\bAKIA[0-9A-Z]{16}\b/,
    severity: 'BLOCKER',
    cweId: 'CWE-798',
  },
  {
    name: 'Private key block',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    severity: 'BLOCKER',
    cweId: 'CWE-321',
  },
  {
    name: 'Hardcoded credential assignment',
    // 不加前置 \b：dbPassword/apiKey 等驼峰命名内部无词边界；凭据后必须紧跟赋值与 8+ 字符字面量
    pattern:
      /(password|passwd|api[_-]?key|api[_-]?secret|access[_-]?token|secret[_-]?key)\s*[:=]\s*['"][^'"\s]{8,}['"]/i,
    severity: 'WARNING',
    cweId: 'CWE-798',
  },
];

/** 静态分析的确定性来源决定高基础置信度（方案 3.6 阶段 2：静态分析 0.9） */
const STATIC_CONFIDENCE = 0.9;

/**
 * 扫描上下文各文件新增行中的疑似密钥/凭证（方案 3.4 secret_scan）。
 * @param files 上下文文件列表
 * @returns 密钥泄露发现
 */
export function scanSecrets(files: readonly FileContext[]): Finding[] {
  return files.flatMap((file) =>
    file.diff.changedLines.flatMap((line): Finding[] => {
      if (line.type !== 'added' || line.newLineNo === null) {
        return [];
      }
      const lineNo: number = line.newLineNo;
      return SECRET_PATTERNS.filter((rule) => rule.pattern.test(line.content)).map(
        (rule): Finding => ({
          agent: 'static',
          severity: rule.severity,
          confidence: STATIC_CONFIDENCE,
          filePath: file.diff.path,
          lineStart: lineNo,
          lineEnd: lineNo,
          title: `Possible ${rule.name} in changed code`,
          description:
            'The added line matches a known credential pattern. Hardcoded secrets leak through version history even after later removal.',
          suggestion:
            'Move the secret to an environment variable referenced from configuration and rotate the exposed credential.',
          codeSnippet: line.content,
          cweId: rule.cweId,
          isFalsePositive: false,
        }),
      );
    }),
  );
}

/**
 * 扫描 unified diff 文本中的疑似密钥（MCP `secret_scan` 工具的入参形态，方案 3.4）。
 * 与 scanSecrets 共用同一规则表，保证进程内与 MCP 两条通道的检出行为一致。
 * @param diffText unified diff 文本（只看新增行，忽略删除/上下文行）
 * @returns 密钥泄露发现（filePath 为 "(diff)" 占位——调用方持有原始文件语境）
 */
export function scanDiffTextForSecrets(diffText: string): Finding[] {
  const addedLines = diffText
    .split(/\r?\n/)
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.startsWith('+') && !line.startsWith('+++'));
  return addedLines.flatMap(({ line, index }): Finding[] =>
    SECRET_PATTERNS.filter((rule) => rule.pattern.test(line.slice(1))).map((rule) => ({
      agent: 'static',
      severity: rule.severity,
      confidence: STATIC_CONFIDENCE,
      filePath: '(diff)',
      lineStart: index + 1,
      lineEnd: index + 1,
      title: `Possible ${rule.name} in changed code`,
      description:
        'The added line matches a known credential pattern. Hardcoded secrets leak through version history even after later removal.',
      suggestion:
        'Move the secret to an environment variable referenced from configuration and rotate the exposed credential.',
      codeSnippet: line.slice(1),
      cweId: rule.cweId,
      isFalsePositive: false,
    })),
  );
}
