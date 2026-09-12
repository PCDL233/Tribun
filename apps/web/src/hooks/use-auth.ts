import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult } from '@tanstack/react-query';
import type { LoginInput, RegisterInput, User } from '@ai-review/shared/api';
import { changePassword, fetchMe, login, logout, register } from '../api/auth';

/** 认证状态的唯一查询键（路由守卫与组件共享） */
export const AUTH_QUERY_KEY = ['auth'] as const;

/**
 * 当前登录用户；未登录为 null。
 * staleTime Infinity：登录态只随显式 mutation 变更，不自动重拉。
 */
export function useAuth(): { user: User | null; isPending: boolean } {
  const query = useQuery({
    queryKey: AUTH_QUERY_KEY,
    queryFn: fetchMe,
    staleTime: Infinity,
    retry: false,
  });
  return { user: query.data ?? null, isPending: query.isPending };
}

export function useLogin(): UseMutationResult<User, Error, LoginInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: login,
    onSuccess: (user) => queryClient.setQueryData(AUTH_QUERY_KEY, user),
  });
}

export function useRegister(): UseMutationResult<User, Error, RegisterInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: register,
    onSuccess: (user) => queryClient.setQueryData(AUTH_QUERY_KEY, user),
  });
}

export function useLogout(): UseMutationResult<void, Error, void> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: logout,
    onSettled: () => queryClient.setQueryData(AUTH_QUERY_KEY, null),
  });
}

export function useChangePassword(): UseMutationResult<void, Error, { oldPassword: string; newPassword: string }> {
  return useMutation({ mutationFn: changePassword });
}
