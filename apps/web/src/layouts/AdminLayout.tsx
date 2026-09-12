import { Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { AppstoreOutlined, ArrowLeftOutlined, BookOutlined, MoonOutlined, SettingOutlined, SunOutlined, TeamOutlined } from '@ant-design/icons';
import { Button, Layout, Menu, Space, Typography } from 'antd';
import { BrandMark } from '../components/Brand';
import { useTheme } from '../theme-context';

export function AdminLayout(): ReactElement {
  const navigate = useNavigate();
  const location = useLocation();
  const { mode, toggle } = useTheme();

  return (
    <Layout className="app-shell">
      <Layout.Sider className="app-sider" width={232} breakpoint="lg" collapsedWidth={0} theme="dark">
        <div className="app-brand">
          <BrandMark />
          <div>
            <div className="app-brand-title">ReviewFlow</div>
            <div className="app-brand-subtitle">ADMIN CONSOLE</div>
          </div>
        </div>
        <div className="app-menu-label">管理中心</div>
        <Menu
          className="app-menu"
          theme="dark"
          mode="inline"
          items={[
            { key: '/admin', label: '系统概览', icon: <AppstoreOutlined /> },
            { key: '/admin/users', label: '用户管理', icon: <TeamOutlined /> },
            { key: '/admin/config', label: '系统配置', icon: <SettingOutlined /> },
            { key: '/admin/knowledge', label: '知识库', icon: <BookOutlined /> },
          ]}
          selectedKeys={[location.pathname]}
          onClick={({ key }) => void navigate({ to: key })}
        />
        <div className="app-sidebar-footer">
          <Button block ghost icon={<ArrowLeftOutlined />} onClick={() => void navigate({ to: '/' })}>
            返回用户端
          </Button>
        </div>
      </Layout.Sider>
      <Layout className="app-main">
        <header className="app-topbar">
          <div>
            <div className="app-topbar-kicker">REVIEWFLOW / ADMIN</div>
            <Typography.Title level={4} className="app-topbar-title">
              {location.pathname === '/admin/users' ? '用户管理' : location.pathname === '/admin/config' ? '系统配置' : location.pathname === '/admin/knowledge' ? '知识库' : '系统概览'}
            </Typography.Title>
          </div>
          <Space>
            <Button
              type="text"
              aria-label={mode === 'dark' ? '切换为浅色模式' : '切换为深色模式'}
              icon={mode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
              onClick={toggle}
            />
            <Button type="link" icon={<ArrowLeftOutlined />} onClick={() => void navigate({ to: '/' })}>
              用户端
            </Button>
          </Space>
        </header>
        <Layout.Content className="app-content">
          <Outlet />
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
