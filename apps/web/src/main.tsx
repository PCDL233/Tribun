import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { App as AntdApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { queryClient } from './query-client';
import { router } from './router';
import './styles.css';

const rootElement = document.getElementById('root');
if (rootElement === null) throw new Error('missing #root element');

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ConfigProvider
        locale={zhCN}
        theme={{
          token: {
            colorPrimary: '#5b5ce2',
            colorInfo: '#5b5ce2',
            colorLink: '#5154d8',
            colorText: '#172033',
            colorTextSecondary: '#718096',
            colorBorder: '#e7ebf3',
            borderRadius: 12,
            controlHeight: 40,
            fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
          },
          components: {
            Button: { borderRadius: 11, fontWeight: 650 },
            Card: { borderRadiusLG: 20 },
            Table: { headerBg: '#fbfcfe', headerColor: '#718096', rowHoverBg: '#f8f8ff' },
          },
        }}
      >
        <AntdApp>
          <RouterProvider router={router} />
        </AntdApp>
      </ConfigProvider>
    </QueryClientProvider>
  </StrictMode>,
);
