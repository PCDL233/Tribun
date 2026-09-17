import { FindingSchema, MODEL_PROVIDERS } from '@ai-review/shared';
import type { AiReviewConfig, CodeContext, Finding } from '@ai-review/shared';

/** LLM Provider 的最小边界，真实 AI Provider 与离线 mock 均遵循这一契约。 */
export type ReviewProvider = {
  review(context: CodeContext, signal?: AbortSignal): Promise<Finding[]>;
};

export type ReviewDimension = 'correctness' | 'security' | 'performance';

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

type LlmConfig = AiReviewConfig['llm'];
type HttpProviderKind = Exclude<LlmConfig['provider'], 'mock'>;

type HttpProviderOptions = {
  provider: HttpProviderKind;
  model: string;
  apiKey: string;
  baseUrl?: string;
  temperature: number;
  maxTokens: number;
  dimension: ReviewDimension;
};

function isEnvPlaceholder(value: string): boolean {
  return /^\$\{[A-Z0-9_]+\}$/.test(value);
}

function endpointFor(provider: HttpProviderKind, baseUrl?: string): string {
  if (baseUrl !== undefined && baseUrl !== '') return baseUrl;
  const info = MODEL_PROVIDERS[provider];
  if (info !== undefined) {
    // 统一约定 AI_REVIEW_<PROVIDER>_BASE_URL 环境变量覆盖，缺省用目录默认端点。
    const envBase = process.env[info.envVarName];
    if (envBase !== undefined && envBase !== '') return envBase;
    return info.defaultEndpoint;
  }
  // 防御性兜底：枚举新增但目录未同步时退回本地 Ollama 默认端点。
  return process.env.AI_REVIEW_OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434/v1';
}

function trimEndpoint(value: string): string {
  return value.replace(/\/$/, '');
}

function buildPrompt(context: CodeContext, dimension: ReviewDimension): string {
  const files = context.files.map((file) => ({
    path: file.diff.path,
    changeType: file.changeType,
    summary: file.diff.summary.slice(0, 12000),
    changedLines: file.diff.changedLines.slice(0, 400),
    signature: file.signature,
    ragHits: file.ragHits.slice(0, 5),
  }));
  return [
    `你是代码审查系统的 ${dimension} 专家。只审查提供的变更行，不要猜测未提供的代码。`,
    '请仅输出 JSON 数组，不要 Markdown 代码围栏。每个元素必须包含：agent、severity、confidence、filePath、lineStart、lineEnd、title、description、suggestion；可选 codeSnippet、cweId、lowConfidence。',
    'severity 只能是 BLOCKER、WARNING、NIT、PRAISE；confidence 为 0 到 1。没有问题时输出 []。lineStart/lineEnd 必须落在 changedLines 的 newLineNo 范围内；不确定时不要编造，使用 lowConfidence=true 或忽略该问题。',
    JSON.stringify({ metadata: context.metadata, files }),
  ].join('\n');
}

function extractJson(text: string): unknown {
  const candidates = [
    text.trim(),
    text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim(),
  ];
  const firstArray = text.indexOf('[');
  const lastArray = text.lastIndexOf(']');
  if (firstArray >= 0 && lastArray > firstArray)
    candidates.push(text.slice(firstArray, lastArray + 1));
  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (Array.isArray(parsed)) return parsed;
      if (typeof parsed === 'object' && parsed !== null && 'findings' in parsed) {
        const findings = (parsed as { findings?: unknown }).findings;
        if (Array.isArray(findings)) return findings;
      }
    } catch {
      // 尝试下一个候选片段；最终由调用方给出明确的响应格式错误。
    }
  }
  throw new Error('LLM response did not contain a JSON findings array');
}

function parseFindings(text: string, dimension: ReviewDimension): Finding[] {
  const raw = extractJson(text);
  if (!Array.isArray(raw)) throw new Error('LLM response findings must be an array');
  const findings = raw.flatMap((value): Finding[] => {
    if (typeof value !== 'object' || value === null) return [];
    const normalized = {
      ...(value as Record<string, unknown>),
      agent: (value as { agent?: unknown }).agent ?? dimension,
      isFalsePositive: false,
    };
    const parsed = FindingSchema.safeParse(normalized);
    return parsed.success ? [parsed.data] : [];
  });
  if (raw.length > 0 && findings.length === 0) {
    throw new Error('LLM response contained no valid findings');
  }
  return findings;
}

function responseText(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null)
    throw new Error('LLM response is not an object');
  const value = payload as {
    choices?: Array<{ message?: { content?: unknown } }>;
    content?: Array<{ type?: string; text?: unknown }>;
  };
  const openAiContent = value.choices?.[0]?.message?.content;
  if (typeof openAiContent === 'string') return openAiContent;
  if (Array.isArray(openAiContent)) {
    return openAiContent
      .map((part) =>
        typeof part === 'object' && part !== null && 'text' in part
          ? String((part as { text: unknown }).text)
          : '',
      )
      .join('');
  }
  if (Array.isArray(value.content)) {
    return value.content
      .filter((part) => part.type === 'text')
      .map((part) => String(part.text ?? ''))
      .join('');
  }
  throw new Error('LLM response did not contain text content');
}

async function requestJson(
  options: HttpProviderOptions,
  context: CodeContext,
  signal?: AbortSignal,
): Promise<unknown> {
  const endpoint = trimEndpoint(endpointFor(options.provider, options.baseUrl));
  const prompt = buildPrompt(context, options.dimension);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  let url = `${endpoint}/chat/completions`;
  let body: Record<string, unknown> = {
    model: options.model,
    temperature: options.temperature,
    max_tokens: options.maxTokens,
    messages: [{ role: 'user', content: prompt }],
  };
  if (options.provider === 'anthropic') {
    url = `${endpoint}/messages`;
    headers['x-api-key'] = options.apiKey;
    headers['anthropic-version'] = '2023-06-01';
    body = {
      model: options.model,
      max_tokens: options.maxTokens,
      temperature: options.temperature,
      system: '你是严谨的代码审查专家。',
      messages: [{ role: 'user', content: prompt }],
    };
  } else {
    headers.authorization = `Bearer ${options.apiKey}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    ...(signal === undefined ? {} : { signal }),
  });
  const responseBody = await response.text();
  if (!response.ok)
    throw new Error(
      `${options.provider} request failed (${response.status}): ${responseBody.slice(0, 500)}`,
    );
  try {
    return JSON.parse(responseBody) as unknown;
  } catch (error) {
    throw new Error(`${options.provider} returned invalid JSON`, { cause: error });
  }
}

/** 创建一个直接调用 OpenAI/Anthropic/国内厂商/Ollama HTTP API 的 Provider。 */
export function createHttpProvider(options: HttpProviderOptions): ReviewProvider {
  return {
    async review(context, signal): Promise<Finding[]> {
      if (signal?.aborted) throw new DOMException('The review was cancelled', 'AbortError');
      const payload = await requestJson(options, context, signal);
      return parseFindings(responseText(payload), options.dimension);
    },
  };
}

/**
 * 根据 .ai-review.yml 装配真实 Provider，并在服务不可用时退回本地 Ollama，
 * 最后退回确定性的 mock，确保静态分析仍可继续输出结果。
 */
export function createConfiguredProvider(
  config: AiReviewConfig,
  dimension: ReviewDimension,
): ReviewProvider {
  const llm = config.llm;
  const mock = createMockProvider();
  if (llm.provider === 'mock') return mock;

  // 未配置云端密钥时跳过 primary，仍尝试本地 Ollama；这样默认配置不会直接退化成 mock。
  const primary =
    llm.provider !== 'ollama' && isEnvPlaceholder(llm.apiKey)
      ? undefined
      : createHttpProvider({
          provider: llm.provider,
          model: llm.model,
          apiKey: llm.provider === 'ollama' ? 'ollama' : llm.apiKey,
          ...(llm.baseUrl !== undefined && llm.baseUrl !== '' ? { baseUrl: llm.baseUrl } : {}),
          temperature: llm.temperature,
          maxTokens: llm.maxTokensPerReview,
          dimension,
        });
  const fallback =
    llm.provider === 'ollama'
      ? undefined
      : createHttpProvider({
          provider: 'ollama',
          model: process.env.AI_REVIEW_OLLAMA_MODEL ?? config.server.ollamaModel,
          apiKey: 'ollama',
          ...(process.env.AI_REVIEW_OLLAMA_BASE_URL !== undefined &&
          process.env.AI_REVIEW_OLLAMA_BASE_URL !== ''
            ? { baseUrl: process.env.AI_REVIEW_OLLAMA_BASE_URL }
            : {}),
          temperature: llm.temperature,
          maxTokens: llm.maxTokensPerReview,
          dimension,
        });

  return {
    async review(context, signal): Promise<Finding[]> {
      if (primary !== undefined) {
        try {
          return await primary.review(context, signal);
        } catch (primaryError) {
          if (signal?.aborted) throw primaryError;
          // 云端失败后继续尝试本地模型；本地也失败时再由 mock 保底。
        }
      }
      if (fallback !== undefined) {
        try {
          return await fallback.review(context, signal);
        } catch (fallbackError) {
          if (signal?.aborted) throw fallbackError;
          // 云端和本地模型均不可用时，交给静态工具与 mock 最低保障链路。
        }
      }
      return mock.review(context, signal);
    },
  };
}

/** 为三个审查维度装配同一份配置。 */
export function createConfiguredProviders(
  config: AiReviewConfig,
): Record<ReviewDimension, ReviewProvider> {
  return {
    correctness: createConfiguredProvider(config, 'correctness'),
    security: createConfiguredProvider(config, 'security'),
    performance: createConfiguredProvider(config, 'performance'),
  };
}
