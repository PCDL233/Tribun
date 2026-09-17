import { Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import {
  AppstoreOutlined,
  ArrowLeftOutlined,
  BookOutlined,
  BugOutlined,
  FileAddOutlined,
  FileTextOutlined,
  MoonOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  SunOutlined,
  TeamOutlined,
  ToolOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { Button, Layout, Menu, Space, Typography } from 'antd';
import { BrandMark } from '../components/Brand';
import { useAuth } from '../hooks/use-auth';
import { canAccessPath } from '../permissions';
import { useTheme } from '../theme-context';

function pageTitle(pathname: string): string {
  switch (pathname) {
    case '/admin/users':
      return '用户管理';
    case '/admin/roles':
      return '角色管理';
    case '/admin/rules':
      return '自定义审查规则';
    case '/admin/ai':
      return 'AI 模型配置';
    case '/admin/config':
      return '系统配置';
    case '/admin/knowledge':
      return '知识库';
    case '/admin/tools':
      return '静态分析工具';
    case '/admin/init':
      return '配置初始化';
    case '/admin/hook':
      return 'Git Hook 安装';
    case '/admin/metrics':
      return '系统指标';
    default:
      return '系统概览';
  }
}

export function AdminLayout(): ReactElement {
  const navigate = useNavigate();
  const location = useLocation();
  const { mode, toggle } = useTheme();
  const { user } = useAuth();
  const can = (path: string): boolean => canAccessPath(user?.permissions ?? [], path);

  const adminMenuItems = [
    ...(can('/admin') ? [{ key: '/admin', label: '系统概览', icon: <AppstoreOutlined /> }] : []),
    ...(can('/admin/users')
      ? [{ key: '/admin/users', label: '用户管理', icon: <TeamOutlined /> }]
      : []),
    ...(can('/admin/roles')
      ? [{ key: '/admin/roles', label: '角色管理', icon: <SafetyCertificateOutlined /> }]
      : []),
    ...(can('/admin/ai') ? [{ key: '/admin/ai', label: 'AI 模型', icon: <RobotOutlined /> }] : []),
    ...(can('/admin/config')
      ? [{ key: '/admin/config', label: '系统配置', icon: <SettingOutlined /> }]
      : []),
    ...(can('/admin/rules')
      ? [{ key: '/admin/rules', label: '自定义规则', icon: <UnorderedListOutlined /> }]
      : []),
    ...(can('/admin/knowledge')
      ? [{ key: '/admin/knowledge', label: '知识库', icon: <BookOutlined /> }]
      : []),
    ...(can('/admin/tools')
      ? [{ key: '/admin/tools', label: '分析工具', icon: <ToolOutlined /> }]
      : []),
    ...(can('/admin/init')
      ? [{ key: '/admin/init', label: '配置初始化', icon: <FileAddOutlined /> }]
      : []),
    ...(can('/admin/hook')
      ? [{ key: '/admin/hook', label: 'Hook 安装', icon: <BugOutlined /> }]
      : []),
    ...(can('/admin/metrics')
      ? [{ key: '/admin/metrics', label: '系统指标', icon: <FileTextOutlined /> }]
      : []),
  ];

  return (
    <Layout className="app-shell">
      <Layout.Sider
        className="app-sider"
        width={232}
        breakpoint="lg"
        collapsedWidth={0}
        theme="light"
      >
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
          theme="light"
          mode="inline"
          items={adminMenuItems}
          selectedKeys={[location.pathname]}
          onClick={({ key }) => void navigate({ to: key })}
        />
        <div className="app-sidebar-footer">
          <Button
            block
            ghost
            icon={<ArrowLeftOutlined />}
            onClick={() => void navigate({ to: '/' })}
          >
            返回用户端
          </Button>
        </div>
      </Layout.Sider>
      <Layout className="app-main">
        <header className="app-topbar">
          <div>
            <div className="app-topbar-kicker">REVIEWFLOW / ADMIN</div>
            <Typography.Title level={4} className="app-topbar-title">
              {pageTitle(location.pathname)}
            </Typography.Title>
          </div>
          <Space>
            <Button
              type="text"
              aria-label={mode === 'dark' ? '切换为浅色模式' : '切换为深色模式'}
              icon={mode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
              onClick={toggle}
            />
            <Button
              type="link"
              icon={<ArrowLeftOutlined />}
              onClick={() => void navigate({ to: '/' })}
            >
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
