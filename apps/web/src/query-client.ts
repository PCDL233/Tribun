import { QueryClient } from '@tanstack/react-query';

/** 全局唯一的 QueryClient：路由守卫（beforeLoad）与组件层共享同一份认证缓存 */
export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});
