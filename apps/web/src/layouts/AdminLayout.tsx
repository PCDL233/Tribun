import { Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { ArrowLeftOutlined, MoonOutlined, SunOutlined } from '@ant-design/icons';
import { Button, Layout, Menu, Space, Typography } from 'antd';
import type { ItemType } from 'antd/es/menu/interface';
import { BrandMark } from '../components/Brand';
import { useAuth } from '../hooks/use-auth';
import { adminGroupKeyOf, buildAdminMenu, isAdminMenuGroup } from '../admin-menu';
import { useTheme } from '../theme-context';

function pageTitle(pathname: string): string {
  switch (pathname) {
    case '/admin/users':
      return '用户管理';
    case '/admin/roles':
      return '角色管理';
    case '/admin/rules':
      return '自定义审查规则';
    case '/admin/login-logs':
      return '登录日志';
    case '/admin/operation-logs':
      return '操作日志';
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

  // 分组导航：平铺项（概览/指标）+ 可折叠分组（子项为二级菜单）
  const menu = buildAdminMenu(user?.permissions ?? []);
  const menuItems: ItemType[] = menu.map((entry) =>
    isAdminMenuGroup(entry)
      ? {
          key: entry.key,
          label: entry.label,
          icon: entry.icon,
          children: entry.children.map((child) => ({
            key: child.key,
            label: child.label,
            icon: child.icon,
          })),
        }
      : { key: entry.key, label: entry.label, icon: entry.icon },
  );
  // 可导航叶子路由（分组 key 以 group: 开头，点击仅展开/收起，不导航）
  const leafKeys = new Set<string>(
    menu.flatMap((entry) =>
      isAdminMenuGroup(entry) ? entry.children.map((child) => child.key) : [entry.key],
    ),
  );
  const groupKey = adminGroupKeyOf(location.pathname);
  const defaultOpenKeys = groupKey === null ? [] : [groupKey];

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
          items={menuItems}
          selectedKeys={[location.pathname]}
          defaultOpenKeys={defaultOpenKeys}
          onClick={({ key }) => {
            // 仅叶子路由导航；分组 key 点击只展开/收起
            if (typeof key === 'string' && leafKeys.has(key)) void navigate({ to: key });
          }}
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
