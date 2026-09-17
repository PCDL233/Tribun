import { StrictMode, Suspense } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { App as AntdApp, ConfigProvider, Spin, theme as antdTheme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { GlobalFeedbackBridge } from './components/GlobalFeedbackBridge';
import { queryClient } from './query-client';
import { router } from './router';
import { ThemeProvider, useTheme } from './theme-context';
import { setUnauthorizedHandler } from './parse-response';
import { AUTH_QUERY_KEY } from './hooks/use-auth';
import './styles.css';

const rootElement = document.getElementById('root');
if (rootElement === null) throw new Error('missing #root element');

// 会话过期（401）全局处理：清除本地认证缓存并跳转登录页（带回跳地址）。
// 在模块顶层注册，登录/注册表单内的 401 由调用方显式跳过，不会误触发。
setUnauthorizedHandler(() => {
  queryClient.setQueryData(AUTH_QUERY_KEY, null);
  const current = window.location.pathname + window.location.search;
  if (current === '/login' || current.startsWith('/register')) return;
  const target =
    current === '/' ? '/login' : `/login?redirect=${encodeURIComponent(current)}`;
  window.location.assign(target);
});

function AppRoot(): ReactElement {
  const { mode } = useTheme();
  const isDark = mode === 'dark';

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: isDark ? '#818cf8' : '#4f46e5',
          colorInfo: isDark ? '#818cf8' : '#4f46e5',
          colorLink: isDark ? '#818cf8' : '#4f46e5',
          colorText: isDark ? '#f1f5f9' : '#0f172a',
          colorTextSecondary: isDark ? '#94a3b8' : '#64748b',
          colorBorder: isDark ? '#334155' : '#e2e8f0',
          colorBgContainer: isDark ? '#1e293b' : '#ffffff',
          borderRadius: 8,
          borderRadiusLG: 12,
          controlHeight: 36,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
        },
        components: {
          Button: { borderRadius: 8, fontWeight: 500 },
          Card: { borderRadiusLG: 12, borderRadius: 12 },
          Table: {
            headerBg: isDark ? '#1e293b' : '#f8fafc',
            headerColor: isDark ? '#e2e8f0' : '#475569',
            rowHoverBg: isDark ? '#334155' : '#f1f5f9',
          },
          Menu: {
            itemSelectedBg: isDark ? '#312e81' : '#eef2ff',
            itemSelectedColor: isDark ? '#818cf8' : '#4f46e5',
            itemHoverBg: isDark ? '#334155' : '#f1f5f9',
          },
          Input: { borderRadius: 8 },
          Select: { borderRadius: 8 },
        },
      }}
    >
      <AntdApp>
        {/* 全局兜底监听：必须位于 <AntdApp> 内部才能拿到真实 message 实例 */}
        <GlobalFeedbackBridge />
        {/* 渲染期兜底：组件抛错时展示统一错误页而非白屏 */}
        <AppErrorBoundary>
          {/* 方案 11：路由级懒加载所需的 Suspense 边界 */}
          <Suspense
            fallback={
              <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
                <Spin tip="加载中…" />
              </div>
            }
          >
            <RouterProvider router={router} />
          </Suspense>
        </AppErrorBoundary>
      </AntdApp>
    </ConfigProvider>
  );
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AppRoot />
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
