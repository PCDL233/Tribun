import { Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { Button, Layout, Menu, Typography } from 'antd';

const { Header, Sider, Content } = Layout;

export type AdminLayoutProps = Record<string, never>;

/** 管理后台布局：与用户端隔离的独立导航（路由守卫已确保仅 admin 可达） */
export function AdminLayout(_props: AdminLayoutProps): ReactElement {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography.Title level={4} style={{ color: '#fff', margin: 0 }}>
          AI Code Review · 管理后台
        </Typography.Title>
        <Button onClick={() => void navigate({ to: '/' })}>返回用户端</Button>
      </Header>
      <Layout>
        <Sider theme="dark" width={180}>
          <Menu
            theme="dark"
            mode="inline"
            items={[
              { key: '/admin', label: '系统概览' },
              { key: '/admin/users', label: '用户管理' },
            ]}
            selectedKeys={[location.pathname]}
            onClick={({ key }) => void navigate({ to: key })}
          />
        </Sider>
        <Content style={{ padding: 24, maxWidth: 1200, margin: '0 auto', width: '100%' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
