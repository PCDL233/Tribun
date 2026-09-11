import type { Finding, ReviewReport } from '@ai-review/shared';

function renderFinding(finding: Finding): string {
  const suggestion = finding.suggestion === undefined ? '' : `\n建议：${finding.suggestion}`;
  return `| ${finding.severity} | ${finding.filePath}:${finding.lineStart} | ${finding.title} | ${finding.confidence.toFixed(2)} | ${finding.description}${suggestion} |`;
}

/**
 * 将类型化报告渲染为五段式 Markdown。
 * @param report 报告数据源
 * @returns Markdown 报告文本
 */
export function renderMarkdown(report: ReviewReport): string {
  const findings =
    report.findings.length === 0
      ? '| - | - | No findings | - | The reviewed changes passed the configured checks. |'
      : report.findings.map(renderFinding).join('\n');
  const degraded =
    report.degradedToStatic.length === 0
      ? ''
      : `\n\n预算受限，以下文件降级为静态分析：${report.degradedToStatic.join(', ')}`;
  return [
    '# 代码审查报告',
    '',
    '## 元信息',
    `- 审查 ID: ${report.meta.reviewId}`,
    `- 模型: ${report.meta.model}`,
    `- 模式: ${report.meta.mode}`,
    `- 风险评分: ${report.meta.riskScore}/100`,
    `- Token: ${report.meta.tokenUsed}`,
    '',
    '## 1. 变更概述',
    report.summary,
    '',
    '## 2. 发现的问题',
    '| 严重度 | 文件:行号 | 标题 | 置信度 | 描述 |',
    '|--------|-----------|------|--------|------|',
    findings,
    '',
    '## 3. 代码质量考量',
    ...report.qualityNotes.map((note) => `- ${note}`),
    '',
    '## 4. 改进建议',
    ...report.suggestions.map((suggestion) => `- ${suggestion}`),
    '',
    '## 5. 总体评估',
    report.assessment,
    degraded,
  ].join('\n');
}

/**
 * 将类型化报告序列化为稳定 JSON。
 * @param report 报告数据源
 * @returns JSON 报告文本
 */
export function renderJson(report: ReviewReport): string {
  return JSON.stringify(report, null, 2);
}
