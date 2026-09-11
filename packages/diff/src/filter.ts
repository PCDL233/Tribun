import picomatch from 'picomatch';
import type { FileDiff, IgnoreRules } from '@ai-review/shared';

/**
 * 创建基于 picomatch 的忽略规则。
 * @param patterns 仓库相对路径匹配模式
 * @returns 文件过滤器
 */
export function createIgnoreRules(patterns: string[]): IgnoreRules {
  const isIgnored = picomatch(patterns, { dot: true });
  return { allows: (path: string): boolean => !isIgnored(path.replaceAll('\\', '/')) };
}

/**
 * 判断 diff 是否包含非空白的实际变更。
 * @param diff 文件 diff
 * @returns 是否值得进入上下文构建
 */
export function isMeaningfulChange(diff: FileDiff): boolean {
  return diff.binary || diff.changedLines.some((line) => line.content.trim().length > 0);
}

/**
 * 过滤二进制、忽略路径和纯空白变更。
 * @param diffs 文件 diff 列表
 * @param ignores 忽略规则
 * @returns 可进入审查的文件 diff
 */
export function filterMeaningfulDiffs(diffs: FileDiff[], ignores: IgnoreRules): FileDiff[] {
  return diffs.filter(
    (diff) => !diff.binary && ignores.allows(diff.path) && isMeaningfulChange(diff),
  );
}
