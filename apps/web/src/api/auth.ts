import { z } from 'zod';
import { AuthResponseSchema, RegisterSchema } from '@ai-review/shared/api';
import type { LoginInput, RegisterInput, User } from '@ai-review/shared/api';
import { ApiError, parseResponse } from '../parse-response';

const API_BASE = '/api/auth';

const LogoutResponseSchema = z.object({ loggedOut: z.boolean() });
const ChangePasswordResponseSchema = z.object({ changed: z.boolean() });

/**
 * 认证端点专属文案：按状态码覆盖全局前缀，避免「登录已失效」等会话语义错配；
 * 其余错误原样透传。
 */
export function localizeApiError(error: unknown, map: Record<number, string>): unknown {
  if (error instanceof ApiError && error.status !== undefined && map[error.status] !== undefined) {
    return new ApiError(map[error.status]!, { status: error.status });
  }
  return error;
}

const LOGIN_ERRORS: Record<number, string> = {
  400: '用户名或密码格式不正确',
  401: '用户名或密码错误',
  403: '账号已被禁用',
  429: '尝试次数过多，请稍后再试',
};

const REGISTER_ERRORS: Record<number, string> = {
  400: '注册信息不合法，请检查后重试',
  403: '注册已关闭，请联系管理员开通账号',
  409: '用户名已被占用，请更换一个',
  429: '注册过于频繁，请稍后再试',
};

const CHANGE_PASSWORD_ERRORS: Record<number, string> = {
  400: '当前密码不正确',
  401: '登录已失效，请重新登录',
};

/** 头像上传响应：返回更新后的用户对象 */
export async function uploadAvatar(file: File): Promise<User> {
  const formData = new FormData();
  formData.append('avatar', file);
  const response = await fetch(`${API_BASE}/avatar`, {
    method: 'POST',
    body: formData,
  });
  const body = await parseResponse(AuthResponseSchema, response);
  return body.user;
}

/**
 * 查询当前登录用户。
 * 401 视为"未登录"这一正常状态返回 null，而非错误——路由守卫据此决定重定向。
 */
export async function fetchMe(): Promise<User | null> {
  const response = await fetch(`${API_BASE}/me`);
  if (response.status === 401) return null;
  const body = await parseResponse(AuthResponseSchema, response);
  return body.user;
}

export async function register(input: RegisterInput): Promise<User> {
  const payload = RegisterSchema.parse(input);
  const response = await fetch(`${API_BASE}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  try {
    const body = await parseResponse(AuthResponseSchema, response, {
      skipUnauthorizedRedirect: true,
    });
    return body.user;
  } catch (e) {
    throw localizeApiError(e, REGISTER_ERRORS);
  }
}

export async function login(input: LoginInput): Promise<User> {
  const response = await fetch(`${API_BASE}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  try {
    const body = await parseResponse(AuthResponseSchema, response, {
      skipUnauthorizedRedirect: true,
    });
    return body.user;
  } catch (e) {
    throw localizeApiError(e, LOGIN_ERRORS);
  }
}

export async function logout(): Promise<void> {
  await parseResponse(LogoutResponseSchema, await fetch(`${API_BASE}/logout`, { method: 'POST' }));
}

export async function changePassword(input: {
  oldPassword: string;
  newPassword: string;
}): Promise<void> {
  const response = await fetch(`${API_BASE}/change-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  try {
    await parseResponse(ChangePasswordResponseSchema, response);
  } catch (e) {
    throw localizeApiError(e, CHANGE_PASSWORD_ERRORS);
  }
}
