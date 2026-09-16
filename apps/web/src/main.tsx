import { StrictMode } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { App as AntdApp, ConfigProvider, theme as antdTheme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { queryClient } from './query-client';
import { router } from './router';
import { ThemeProvider, useTheme } from './theme-context';
import './styles.css';

const rootElement = document.getElementById('root');
if (rootElement === null) throw new Error('missing #root element');

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
        <RouterProvider router={router} />
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
