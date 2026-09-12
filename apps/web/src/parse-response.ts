import { ZodError } from 'zod';

/** zod 校验器的最小结构签名（避免依赖 zod 内部泛型的推导差异） */
type SchemaParser<T> = {
  safeParse(data: unknown): { success: true; data: T } | { success: false; error: unknown };
};

/**
 * API 响应统一经 zod 校验后返回（规范 §5.5 四链路之"API 响应"）。
 * 校验失败抛 ApiError，由调用方以错误 UI 呈现，禁止静默吞掉。
 */
export class ApiError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ApiError';
  }
}

export async function parseResponse<T>(schema: SchemaParser<T>, response: Response): Promise<T> {
  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    let detail = bodyText;
    try {
      const parsed = JSON.parse(bodyText) as unknown;
      if (typeof parsed === 'object' && parsed !== null && 'error' in parsed && typeof parsed.error === 'string') {
        detail = parsed.error;
      }
    } catch {
      // 非 JSON 错误体保留原始文本，便于定位代理或网关问题。
    }
    const statusMessage: Record<number, string> = {
      400: '请求参数有误',
      401: '登录已失效，请重新登录',
      403: '没有执行此操作的权限',
      404: '请求的资源不存在',
      409: '当前状态不允许执行此操作',
      429: '请求过于频繁，请稍后再试',
    };
    const prefix = statusMessage[response.status] ?? `请求失败（${response.status}）`;
    throw new ApiError(detail === '' ? prefix : `${prefix}：${detail}`);
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch (e) {
    throw new ApiError('API returned non-JSON body', { cause: e });
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    throw new ApiError('API response failed schema validation', { cause: result.error });
  }
  return result.data;
}

export function describeError(error: unknown): string {
  if (error instanceof ZodError) return '响应数据不符合契约';
  if (error instanceof Error) return error.message;
  return String(error);
}
