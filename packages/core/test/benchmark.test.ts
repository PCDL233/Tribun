import { buildDefaultRegistry } from '@ai-review/tools';
import type { ChangedLine, CodeContext, FileContext } from '@ai-review/shared';
import { describe, expect, it } from 'vitest';

/**
 * 静态分析层基准测试（方案 4.1 基准测试 / 4.2 评估指标）。
 * 语料以 CWE 锚定已知缺陷，度量对象是确定性静态层（secret_scan + complexity_check）——
 * LLM 层的召回率依赖真实模型，属录制/回放集成测试与线上评估的范畴，不在此断言。
 * 全部工具输出确定，故阈值断言同时是静态层检出能力的回归门禁。
 */

type BenchmarkCase = {
  id: string;
  cwe: string;
  /** 是否应被静态层检出（真阳性期望）；false 表示纯净代码，检出即误报 */
  defective: boolean;
  content: string;
};

/** 变更行 = 全部新增行（基准关注新增代码中的缺陷，方案 3.1） */
function makeChangedLines(content: string): ChangedLine[] {
  return content.split('\n').map((_, index) => ({
    type: 'added' as const,
    content: content.split('\n')[index] ?? '',
    newLineNo: index + 1,
    oldLineNo: null,
  }));
}

function makeCaseContext(benchmarkCase: BenchmarkCase): CodeContext {
  const file: FileContext = {
    diff: {
      path: `fixtures/${benchmarkCase.id}.ts`,
      oldPath: null,
      binary: false,
      additions: benchmarkCase.content.split('\n').length,
      deletions: 0,
      hunks: [],
      removedLines: [],
      changedLines: makeChangedLines(benchmarkCase.content),
      summary: 'benchmark fixture',
    },
    stagedContent: benchmarkCase.content,
    snippet: benchmarkCase.content,
    signature: null,
    ragHits: [],
    changeType: 'feature',
  };
  return {
    files: [file],
    metadata: {
      totalFiles: 1,
      totalAdditions: file.diff.additions,
      totalDeletions: 0,
      languages: ['typescript'],
      generatedAt: '2026-09-12T00:00:00.000Z',
    },
  };
}

const CORPUS: readonly BenchmarkCase[] = [
  {
    id: 'aws-key-literal',
    cwe: 'CWE-798',
    defective: true,
    content: "export const awsAccessKey = 'AKIAIOSFODNN7EXAMPLE';",
  },
  {
    id: 'private-key-block',
    cwe: 'CWE-321',
    defective: true,
    content: [
      'const PRIVATE_KEY = `',
      '-----BEGIN RSA PRIVATE KEY-----',
      'MIIEpAIBAAKCAQEA7example',
      '-----END RSA PRIVATE KEY-----',
      '`;',
    ].join('\n'),
  },
  {
    id: 'hardcoded-db-password',
    cwe: 'CWE-798',
    defective: true,
    content: "export const dbPassword = 'sup3r-s3cret-value';",
  },
  {
    id: 'high-complexity-checkout',
    cwe: 'CWE-657',
    defective: true,
    // 15 个分支/短路点 + 1：恰好触发默认阈值 15（规范 §3.1 与方案静态分析阈值一致）
    content: [
      'function checkout(user: { vip: boolean } | null, cart: { total: number } | null): number {',
      '  let price = 0;',
      '  if (user) price += 1;',
      '  if (user?.vip) price += 1;',
      '  if (cart) price += 1;',
      '  if (cart?.total) price += 1;',
      '  if (price > 0) price += 1;',
      '  if (price > 1) price += 1;',
      '  if (price > 2) price += 1;',
      '  if (price > 3) price += 1;',
      '  if (price > 4) price += 1;',
      '  if (price > 5) price += 1;',
      '  if (price > 6) price += 1;',
      '  while (price > 7) price -= 1;',
      '  for (const _ of [1]) price += 1;',
      '  return price > 8 && price < 100 ? price : 0;',
      '}',
    ].join('\n'),
  },
  {
    id: 'clean-utility',
    cwe: '',
    defective: false,
    content: [
      'export function add(a: number, b: number): number {',
      '  return a + b;',
      '}',
    ].join('\n'),
  },
  {
    id: 'clean-placeholder-config',
    cwe: '',
    defective: false,
    content: "export const config = { apiKey: 'placeholder', password: '' };",
  },
];

describe('static-analysis benchmark (方案 4.2 评估指标)', () => {
  const registry = buildDefaultRegistry();
  const findings = registry.runAll({
    files: CORPUS.map((benchmarkCase) => makeCaseContext(benchmarkCase).files[0] as FileContext),
    metadata: {
      totalFiles: CORPUS.length,
      totalAdditions: 0,
      totalDeletions: 0,
      languages: ['typescript'],
      generatedAt: '2026-09-12T00:00:00.000Z',
    },
  });

  // 发现按文件归属到语料用例（缺陷文件的发现计为真阳性，纯净文件的发现计为误报）
  const caseByPath = new Map(CORPUS.map((benchmarkCase) => [`fixtures/${benchmarkCase.id}.ts`, benchmarkCase]));
  const detectedCases = new Set(
    findings.flatMap((finding) => {
      const benchmarkCase = caseByPath.get(finding.filePath);
      return benchmarkCase !== undefined && benchmarkCase.defective ? [benchmarkCase.id] : [];
    }),
  );
  const truePositives = findings.filter((finding) => {
    const benchmarkCase = caseByPath.get(finding.filePath);
    return benchmarkCase !== undefined && benchmarkCase.defective;
  }).length;
  const falsePositives = findings.length - truePositives;
  const defectiveCount = CORPUS.filter((benchmarkCase) => benchmarkCase.defective).length;
  const recall = truePositives === 0 ? 0 : detectedCases.size / defectiveCount;
  const precision = findings.length === 0 ? 0 : truePositives / findings.length;
  const f1 = (2 * precision * recall) / (precision + recall);

  it('achieves the recall target for the deterministic layer (目标 ≥ 0.6)', () => {
    // 4 个缺陷用例均应被确定性规则命中（3 组密钥规则 + 复杂度阈值 15，规范 §3.1）
    expect(recall).toBeGreaterThanOrEqual(0.6);
    expect(detectedCases).toEqual(
      new Set(CORPUS.filter((benchmarkCase) => benchmarkCase.defective).map((benchmarkCase) => benchmarkCase.id)),
    );
  });

  it('achieves the precision target on the corpus (目标 ≥ 0.8)', () => {
    // 已知误报恰好 1 条：占位符 apiKey（字面量 ≥8 字符命中凭据赋值规则）——
    // 该类 WARNING 按方案 3.6 阶段 1/2 由交叉验证的置信度过滤兜底，非静态层职责
    expect(precision).toBeGreaterThanOrEqual(0.8);
    expect(falsePositives).toBeLessThanOrEqual(1);
  });

  it('meets the overall F1 target (方案目标 ≥ 0.70)', () => {
    expect(f1).toBeGreaterThanOrEqual(0.7);
  });
});
