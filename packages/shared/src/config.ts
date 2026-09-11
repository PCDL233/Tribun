import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { ConfigError } from './errors.js';

/**
 * 配置 schema（对齐方案 5.2 .ai-review.yml）。
 * 单一事实源：API 契约、前端表单、文档示例全部推导自此（方案 2.3）。
 *
 * 与方案的差异：provider 追加 `mock`（测试/离线回放模式，无 API Key 可跑通流水线），
 * 以及 `llm.mockFixturesDir`（录制/回放 fixture 目录）。
 */
export const AiReviewConfigSchema = z.object({
  // 各段外层 .prefault({})：空配置文件也能借内层字段默认值通过校验
  llm: z
    .object({
      provider: z.enum(['anthropic', 'openai', 'ollama', 'mock']).default('anthropic'),
      model: z.string().default('claude-sonnet-4.5'),
      /** 仅支持 ${ENV} 引用（loadConfig 递归解析），禁止明文提交密钥 */
      apiKey: z.string().default('${AI_REVIEW_API_KEY}'),
      maxTokensPerReview: z.number().int().positive().max(200_000).default(50_000),
      /** 低温度保证审查一致性（方案 3.3） */
      temperature: z.number().min(0).max(2).default(0.1),
      /** mock provider 的录制/回放 fixture 目录 */
      mockFixturesDir: z.string().default('.ai-review-cache/llm-fixtures'),
    })
    .prefault({}),
  review: z
    .object({
      mode: z.enum(['fast', 'full']).default('fast'),
      dimensions: z
        .array(z.enum(['correctness', 'security', 'performance', 'maintainability']))
        .default(['correctness', 'security', 'performance', 'maintainability']),
      blockOn: z.enum(['BLOCKER', 'WARNING', 'NIT']).default('BLOCKER'),
      ignorePatterns: z
        .array(z.string())
        .default(['*.lock', 'pnpm-lock.yaml', 'dist/**', '*.min.js']),
    })
    .prefault({}),
  rag: z
    .object({
      enabled: z.boolean().default(true),
      knowledgeBasePaths: z.array(z.string()).default(['docs/']),
      indexDir: z.string().default('.ai-review-cache/vectors'),
      topK: z.number().int().min(1).max(20).default(5),
    })
    .prefault({}),
  staticAnalysis: z
    .object({
      enabledTools: z
        .array(z.string())
        .default(['complexity_check', 'secret_scan', 'dependency_scan']),
      complexityThreshold: z.number().int().min(1).default(15),
    })
    .prefault({}),
  report: z
    .object({
      format: z.enum(['markdown', 'html', 'json']).default('markdown'),
      outputDir: z.string().default('.ai-review-reports'),
      includePraise: z.boolean().default(true),
    })
    .prefault({}),
});

export type AiReviewConfig = z.infer<typeof AiReviewConfigSchema>;

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
