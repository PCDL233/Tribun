import { z } from 'zod';
import { MODEL_PROVIDER_IDS } from './model-catalog.js';

/**
 * 配置 schema 的浏览器安全版本。
 * 该文件不引用 node:fs，供 API 契约和前端配置表单共享同一份结构定义。
 */
export const AiReviewConfigSchema = z.object({
  llm: z
    .object({
      provider: z.enum(MODEL_PROVIDER_IDS).default('anthropic'),
      model: z.string().default('claude-sonnet-5'),
      apiKey: z.string().default('${AI_REVIEW_API_KEY}'),
      baseUrl: z.string().optional(),
      maxTokensPerReview: z.number().int().positive().max(200_000).default(50_000),
      temperature: z.number().min(0).max(2).default(0.1),
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
        .default(['ast_parse', 'complexity_check', 'secret_scan', 'dependency_scan']),
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
