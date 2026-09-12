import { z } from 'zod';
import { AuthResponseSchema, RegisterSchema } from '@ai-review/shared/api';
import type { LoginInput, RegisterInput, User } from '@ai-review/shared/api';
import { parseResponse } from '../parse-response';

const API_BASE = '/api/auth';

const LogoutResponseSchema = z.object({ loggedOut: z.boolean() });
const ChangePasswordResponseSchema = z.object({ changed: z.boolean() });

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
  const body = await parseResponse(AuthResponseSchema, response);
  return body.user;
}

export async function login(input: LoginInput): Promise<User> {
  const response = await fetch(`${API_BASE}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await parseResponse(AuthResponseSchema, response);
  return body.user;
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
  await parseResponse(ChangePasswordResponseSchema, response);
}
