import { Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { Button, Layout, Menu, Typography } from 'antd';
import { BrandMark } from '../components/Brand';

export function AdminLayout(): ReactElement {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <Layout className="app-shell">
      <Layout.Sider className="app-sider" width={248} breakpoint="lg" collapsedWidth={0}>
        <div className="app-brand">
          <BrandMark />
          <div>
            <div className="app-brand-title">ReviewFlow</div>
            <div className="app-brand-subtitle">ADMIN CONSOLE</div>
          </div>
        </div>
        <div className="app-menu-label">Administration</div>
        <Menu
          className="app-menu"
          theme="dark"
          mode="inline"
          items={[
            { key: '/admin', label: '系统概览', icon: <span className="nav-icon">▦</span> },
            { key: '/admin/users', label: '用户管理', icon: <span className="nav-icon">♙</span> },
          ]}
          selectedKeys={[location.pathname]}
          onClick={({ key }) => void navigate({ to: key })}
        />
        <div className="app-sidebar-footer">
          <Button block ghost onClick={() => void navigate({ to: '/' })}>
            返回用户端
          </Button>
        </div>
      </Layout.Sider>
      <Layout className="app-main">
        <div className="app-topbar">
          <div>
            <div className="app-topbar-kicker">REVIEWFLOW / ADMIN</div>
            <Typography.Title level={4} className="app-topbar-title">
              {location.pathname === '/admin/users' ? '用户管理' : '系统概览'}
            </Typography.Title>
          </div>
          <Button type="text" onClick={() => void navigate({ to: '/' })}>
            ← 用户端
          </Button>
        </div>
        <Layout.Content className="app-content">
          <Outlet />
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
