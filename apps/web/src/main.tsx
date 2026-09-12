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
          colorPrimary: '#1677ff',
          colorInfo: '#1677ff',
          colorLink: '#1677ff',
          colorText: isDark ? '#f0f0f0' : '#1f1f1f',
          colorTextSecondary: isDark ? '#a6a6a6' : '#595959',
          colorBorder: isDark ? '#434343' : '#d9d9d9',
          borderRadius: 6,
          controlHeight: 36,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
        },
        components: {
          Button: { borderRadius: 6, fontWeight: 500 },
          Card: { borderRadiusLG: 8 },
          Table: {
            headerBg: isDark ? '#1f1f1f' : '#fafafa',
            headerColor: isDark ? '#d9d9d9' : '#595959',
            rowHoverBg: isDark ? '#262626' : '#f5faff',
          },
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
