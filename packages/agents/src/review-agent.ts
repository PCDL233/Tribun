import { FindingSchema } from '@ai-review/shared';
import type { CodeContext, Finding } from '@ai-review/shared';
import type { ReviewProvider } from '@ai-review/llm';

function validateFindings(findings: Finding[], context: CodeContext): Finding[] {
  const files = new Map(context.files.map((file) => [file.diff.path, file]));
  return findings.flatMap((finding) => {
    const file = files.get(finding.filePath);
    const isChangedLine =
      file?.diff.changedLines.some(
        (line) =>
          line.newLineNo !== null &&
          finding.lineStart <= line.newLineNo &&
          finding.lineEnd >= line.newLineNo,
      ) ?? false;
    if (!isChangedLine || finding.lineEnd < finding.lineStart) {
      return [];
    }
    const parsed = FindingSchema.safeParse(finding);
    return parsed.success ? [parsed.data] : [];
  });
}

/**
 * 单 Agent 审查器，负责 Provider 调用和 Finding 边界校验。
 */
export class ReviewAgent {
  constructor(private readonly provider: ReviewProvider) {}

  /**
   * 审查上下文并丢弃不落在变更行上的结果。
   * @param context staged diff 上下文
   * @param signal 全局取消信号
   * @returns 经过 schema 与变更范围校验的发现
   */
  public async review(context: CodeContext, signal?: AbortSignal): Promise<Finding[]> {
    return validateFindings(await this.provider.review(context, signal), context);
  }
}
