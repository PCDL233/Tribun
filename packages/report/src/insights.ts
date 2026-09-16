import type { Finding } from '@ai-review/shared';

/** 根据流水线结果生成报告中的代码质量摘要，保证 CLI 与服务端输出一致。 */
export function deriveQualityNotes(
  totalFiles: number,
  findings: readonly Finding[],
  degradedToStatic: readonly string[] = [],
): string[] {
  return [
    `本次变更涉及 ${totalFiles} 个文件。`,
    findings.length === 0
      ? '未发现配置规则覆盖范围内的问题。'
      : `共识别 ${findings.length} 个问题，已按严重度排序。`,
    ...(degradedToStatic.length > 0 ? ['部分文件因预算限制仅完成静态分析。'] : []),
  ];
}

/** 从发现中提取去重后的改进建议，避免报告只展示问题而没有行动项。 */
export function deriveSuggestions(findings: readonly Finding[]): string[] {
  return [
    ...new Set(
      findings
        .map((finding) => finding.suggestion)
        .filter((value): value is string => value !== undefined && value.trim() !== ''),
    ),
  ];
}
