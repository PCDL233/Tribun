/**
 * 自定义错误基类（规范 §7.5）：继承 Error、携带 cause。
 * 禁止 throw 字符串或普通对象。
 */
export class AiReviewError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AiReviewError';
  }
}

/** 配置文件缺失、schema 校验失败、环境变量引用无法解析等（CLI 映射退出码 2） */
export class ConfigError extends AiReviewError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ConfigError';
  }
}

/** 审查超时或被取消（CLI 映射退出码 3，不阻断提交） */
export class PipelineTimeoutError extends AiReviewError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PipelineTimeoutError';
  }
}
