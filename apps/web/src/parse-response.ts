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
    throw new ApiError(`API ${response.status}: ${bodyText}`);
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
