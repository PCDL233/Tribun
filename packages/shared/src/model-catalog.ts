/**
 * 模型服务商目录（浏览器安全：无 node 依赖，可被 @ai-review/llm 与 @ai-review/web 共用）。
 * provider 枚举、默认端点、Base URL 覆盖变量名与推荐模型预设的单一事实源，
 * 与 config-schema 的 AiReviewConfigSchema.llm.provider 保持同源（后者直接引用 MODEL_PROVIDER_IDS）。
 */

/** provider 枚举的合法取值；AiReviewConfigSchema.llm.provider 直接引用本数组。 */
export const MODEL_PROVIDER_IDS = [
  'anthropic',
  'openai',
  'deepseek',
  'zhipu',
  'moonshot',
  'dashscope',
  'volcengine',
  'minimax',
  'ollama',
  'mock',
] as const;

export type ModelProviderId = (typeof MODEL_PROVIDER_IDS)[number];

export type ModelProviderInfo = {
  /** provider 枚举值，与配置 schema 一致 */
  id: ModelProviderId;
  /** 后台页面展示的中文标签 */
  label: string;
  /** 默认端点；mock 不适用，为空字符串 */
  defaultEndpoint: string;
  /** Base URL 覆盖环境变量名（统一约定 AI_REVIEW_<PROVIDER>_BASE_URL） */
  envVarName: string;
  /** 推荐模型预设（仅供前端 AutoComplete 提示，模型名仍可自由输入） */
  recommendedModels: string[];
};

/** 按 id 索引的服务商目录。 */
export const MODEL_PROVIDERS: Record<ModelProviderId, ModelProviderInfo> = {
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    defaultEndpoint: 'https://api.anthropic.com/v1',
    envVarName: 'AI_REVIEW_ANTHROPIC_BASE_URL',
    recommendedModels: ['claude-sonnet-5', 'claude-opus-5', 'claude-haiku-4-5'],
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    defaultEndpoint: 'https://api.openai.com/v1',
    envVarName: 'AI_REVIEW_OPENAI_BASE_URL',
    recommendedModels: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'],
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek（深度求索）',
    defaultEndpoint: 'https://api.deepseek.com/v1',
    envVarName: 'AI_REVIEW_DEEPSEEK_BASE_URL',
    recommendedModels: ['deepseek-v4-pro', 'deepseek-flash'],
  },
  zhipu: {
    id: 'zhipu',
    label: '智谱 GLM',
    defaultEndpoint: 'https://open.bigmodel.cn/api/paas/v4',
    envVarName: 'AI_REVIEW_ZHIPU_BASE_URL',
    recommendedModels: ['glm-5.3', 'glm-4.7', 'glm-4.5-air'],
  },
  moonshot: {
    id: 'moonshot',
    label: 'Moonshot Kimi',
    defaultEndpoint: 'https://api.moonshot.cn/v1',
    envVarName: 'AI_REVIEW_MOONSHOT_BASE_URL',
    recommendedModels: ['kimi-k2.7-code', 'kimi-k2.6', 'kimi-k2.5'],
  },
  dashscope: {
    id: 'dashscope',
    label: '阿里云百炼·通义千问',
    defaultEndpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    envVarName: 'AI_REVIEW_DASHSCOPE_BASE_URL',
    recommendedModels: ['qwen3.7-max', 'qwen3-coder-next', 'qwen3.7-plus'],
  },
  volcengine: {
    id: 'volcengine',
    label: '火山方舟·豆包',
    defaultEndpoint: 'https://ark.cn-beijing.volces.com/api/v3',
    envVarName: 'AI_REVIEW_VOLCENGINE_BASE_URL',
    recommendedModels: [
      'doubao-seed-2-1-pro-260628',
      'doubao-seed-evolving',
      'doubao-seed-1-6-250615',
    ],
  },
  minimax: {
    id: 'minimax',
    label: 'MiniMax',
    defaultEndpoint: 'https://api.minimax.chat/v1',
    envVarName: 'AI_REVIEW_MINIMAX_BASE_URL',
    recommendedModels: ['MiniMax-M3', 'MiniMax-M2.7', 'MiniMax-M2.7-highspeed'],
  },
  ollama: {
    id: 'ollama',
    label: 'Ollama（本地）',
    defaultEndpoint: 'http://127.0.0.1:11434/v1',
    envVarName: 'AI_REVIEW_OLLAMA_BASE_URL',
    recommendedModels: ['qwen3-coder:30b', 'qwen3-coder:14b', 'qwen3-coder:480b'],
  },
  mock: {
    id: 'mock',
    label: 'Mock（离线）',
    defaultEndpoint: '',
    envVarName: '',
    recommendedModels: [],
  },
};

/** 后台 Provider 下拉的有序选项（国际厂商 → 国内厂商 → 本地/离线）。 */
export const MODEL_PROVIDER_LIST: ModelProviderInfo[] = [
  MODEL_PROVIDERS.anthropic,
  MODEL_PROVIDERS.openai,
  MODEL_PROVIDERS.deepseek,
  MODEL_PROVIDERS.zhipu,
  MODEL_PROVIDERS.moonshot,
  MODEL_PROVIDERS.dashscope,
  MODEL_PROVIDERS.volcengine,
  MODEL_PROVIDERS.minimax,
  MODEL_PROVIDERS.ollama,
  MODEL_PROVIDERS.mock,
];
