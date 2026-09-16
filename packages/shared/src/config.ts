import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { ConfigError } from './errors.js';
import { AiReviewConfigSchema } from './config-schema.js';
import type { AiReviewConfig } from './config-schema.js';

export { AiReviewConfigSchema } from './config-schema.js';
export type { AiReviewConfig } from './config-schema.js';

/** 递归解析字符串中的 ${ENV_NAME} 引用；env 未定义时保留占位符（由 provider 层报错） */
export function resolveEnvRefs(node: unknown): unknown {
  if (typeof node === 'string') {
    return node.replace(/\$\{([A-Z0-9_]+)\}/g, (match, name: string) => {
      const value = process.env[name];
      return value === undefined ? match : value;
    });
  }
  if (Array.isArray(node)) {
    return node.map((item) => resolveEnvRefs(item));
  }
  if (node !== null && typeof node === 'object') {
    return Object.fromEntries(
      Object.entries(node).map(([key, value]) => [key, resolveEnvRefs(value)]),
    );
  }
  return node;
}

/**
 * 加载并严格校验 .ai-review.yml。
 * @throws {ConfigError} 文件不存在、YAML 非法或 schema 校验失败（字段级错误提示，CLI 映射退出码 2）
 */
export function loadConfig(path = '.ai-review.yml'): AiReviewConfig {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    throw new ConfigError(`config file not readable: ${path}`, { cause: e });
  }

  let parsedYaml: unknown;
  try {
    parsedYaml = parseYaml(raw);
  } catch (e) {
    throw new ConfigError(`invalid YAML in ${path}`, { cause: e });
  }

  const result = AiReviewConfigSchema.safeParse(resolveEnvRefs(parsedYaml));
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new ConfigError(`config validation failed for ${path}:\n${issues}`);
  }
  return result.data;
}
