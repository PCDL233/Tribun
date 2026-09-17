import { delimiter } from 'node:path';
import type { AiReviewConfig } from '@ai-review/shared';

/**
 * 服务端运行参数（web 管理后台可配置，对应原 AI_REVIEW_* 环境变量）。
 * 生效优先级：环境变量 > 配置文件 server 段 > 默认值——
 * 部署层（Docker/compose）显式设置的环境变量仍可覆盖 web 保存的配置值。
 * 属基础设施配置，服务启动时快照一次，保存后需重启服务生效。
 */
export type ServerSettings = {
  /** 允许发起审查的仓库根目录白名单 */
  allowedRoots: readonly string[];
  /** 并行审查任务上限 */
  maxConcurrent: number;
  /** 强制会话 Cookie 携带 Secure（NODE_ENV=production 下自动开启） */
  cookieSecure: boolean;
  /** 放开开放注册 */
  allowRegister: boolean;
  /** 反向代理部署时信任 X-Forwarded-For */
  trustProxy: boolean;
  /** Ollama 回退模型 */
  ollamaModel: string;
};

/**
 * 解析服务端参数：env > config > 默认。
 * COOKIE_SECURE 保留既有语义：未显式设置时，NODE_ENV=production 自动开启
 * （env 显式置 false 仍可关闭）。
 */
export function loadServerSettings(config: AiReviewConfig): ServerSettings {
  const env = process.env;
  const s = config.server;
  const allowedRoots = env.AI_REVIEW_ALLOWED_ROOTS
    ? env.AI_REVIEW_ALLOWED_ROOTS.split(delimiter).filter((p) => p !== '')
    : s.allowedRoots.length > 0
      ? s.allowedRoots
      : [process.cwd()];
  const maxConcurrent = Number(env.AI_REVIEW_MAX_CONCURRENT ?? String(s.maxConcurrent));
  return {
    allowedRoots,
    maxConcurrent:
      Number.isFinite(maxConcurrent) && maxConcurrent > 0 ? Math.floor(maxConcurrent) : 3,
    cookieSecure:
      env.AI_REVIEW_COOKIE_SECURE !== undefined
        ? env.AI_REVIEW_COOKIE_SECURE === 'true'
        : s.cookieSecure || process.env.NODE_ENV === 'production',
    allowRegister:
      env.AI_REVIEW_ALLOW_REGISTER !== undefined
        ? env.AI_REVIEW_ALLOW_REGISTER === 'true'
        : s.allowRegister,
    trustProxy:
      env.AI_REVIEW_TRUST_PROXY !== undefined ? env.AI_REVIEW_TRUST_PROXY === 'true' : s.trustProxy,
    ollamaModel: env.AI_REVIEW_OLLAMA_MODEL ?? s.ollamaModel,
  };
}
