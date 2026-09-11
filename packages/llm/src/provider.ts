import type { CodeContext, Finding } from '@ai-review/shared';

/** LLM Provider 的最小边界，真实 AI SDK Provider 可在此接口后替换。 */
export type ReviewProvider = {
  review(context: CodeContext, signal?: AbortSignal): Promise<Finding[]>;
};

/**
 * 创建无网络、确定性的 Mock Provider。
 * @returns 根据变更内容生成审查结果的 Provider
 */
export function createMockProvider(): ReviewProvider {
  return {
    async review(context: CodeContext, signal?: AbortSignal): Promise<Finding[]> {
      if (signal?.aborted) {
        throw new DOMException('The review was cancelled', 'AbortError');
      }

      return context.files.flatMap((file) => {
        const suspiciousLine = file.diff.changedLines.find((line) =>
          /eval\(|exec\(|child_process/.test(line.content),
        );
        if (suspiciousLine?.newLineNo === null || suspiciousLine === undefined) {
          return [];
        }

        return [
          {
            agent: 'security',
            severity: 'WARNING',
            confidence: 0.8,
            filePath: file.diff.path,
            lineStart: suspiciousLine.newLineNo,
            lineEnd: suspiciousLine.newLineNo,
            title: 'Potential unsafe command or code execution',
            description:
              'The changed code invokes a dynamic execution primitive and requires a trusted-input review.',
            suggestion:
              'Prefer a constrained API and validate all external input before execution.',
            codeSnippet: suspiciousLine.content,
            lowConfidence: false,
            isFalsePositive: false,
          } satisfies Finding,
        ];
      });
    },
  };
}
