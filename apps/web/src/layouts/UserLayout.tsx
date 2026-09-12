import { Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import {
  AppstoreOutlined,
  BarChartOutlined,
  DashboardOutlined,
  DownOutlined,
  HistoryOutlined,
  MoonOutlined,
  PlayCircleOutlined,
  SettingOutlined,
  SunOutlined,
} from '@ant-design/icons';
import { Button, Dropdown, Layout, Menu, Typography } from 'antd';
import type { ItemType } from 'antd/es/menu/interface';
import { useAuth, useLogout } from '../hooks/use-auth';
import { BrandMark, initials } from '../components/Brand';
import { useTheme } from '../theme-context';

type NavItem = { key: string; label: string; icon: ReactElement };
const navItems: NavItem[] = [
  { key: '/', label: '工作台', icon: <DashboardOutlined /> },
  { key: '/run', label: '发起审查', icon: <PlayCircleOutlined /> },
  { key: '/reviews', label: '审查历史', icon: <HistoryOutlined /> },
  { key: '/stats', label: '统计分析', icon: <BarChartOutlined /> },
];

function currentKey(pathname: string): string {
  if (pathname.startsWith('/reviews/')) return '/reviews';
  return pathname;
}

function pageName(pathname: string): string {
  if (pathname === '/') return '工作台';
  if (pathname === '/run') return '发起审查';
  if (pathname.startsWith('/reviews')) return '审查历史';
  if (pathname === '/stats') return '统计分析';
  if (pathname === '/profile') return '个人设置';
  if (pathname.startsWith('/admin')) return '管理后台';
  return 'ReviewFlow';
}

/** 用户端布局：遵循 Ant Design Pro 的侧栏 + 顶部导航结构。 */
export function UserLayout(): ReactElement {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const logoutMutation = useLogout();
  const { mode, toggle } = useTheme();

  const menuItems: ItemType[] = [
    ...navItems.map((item) => ({ key: item.key, label: item.label, icon: item.icon })),
    ...(user?.role === 'admin'
      ? [{ key: '/admin', label: '管理后台', icon: <AppstoreOutlined /> }]
      : []),
    { key: '/profile', label: '个人设置', icon: <SettingOutlined /> },
  ];

  const handleLogout = async (): Promise<void> => {
    await logoutMutation.mutateAsync();
    await navigate({ to: '/login', replace: true });
  };

  return (
    <Layout className="app-shell">
      <Layout.Sider className="app-sider" width={232} breakpoint="lg" collapsedWidth={0} theme="dark">
        <div className="app-brand">
          <BrandMark />
          <div>
            <div className="app-brand-title">ReviewFlow</div>
            <div className="app-brand-subtitle">CODE REVIEW CONSOLE</div>
          </div>
        </div>
        <div className="app-menu-label">工作空间</div>
        <Menu
          className="app-menu"
          theme="dark"
          mode="inline"
          items={menuItems}
          selectedKeys={[currentKey(location.pathname)]}
          onClick={({ key }) => void navigate({ to: key })}
        />
        <div className="app-sidebar-footer">
          <div className="sidebar-user">
            <span className="sidebar-user-avatar">{initials(user?.username)}</span>
            <div style={{ minWidth: 0 }}>
              <div className="sidebar-user-name">{user?.username ?? '当前用户'}</div>
              <div className="sidebar-user-role">{user?.role === 'admin' ? '管理员' : '成员'}</div>
            </div>
          </div>
        </div>
      </Layout.Sider>
      <Layout className="app-main">
        <header className="app-topbar">
          <div>
            <div className="app-topbar-kicker">REVIEWFLOW</div>
            <Typography.Title level={4} className="app-topbar-title">
              {pageName(location.pathname)}
            </Typography.Title>
          </div>
          <div className="app-topbar-actions">
            <Button
              type="text"
              aria-label={mode === 'dark' ? '切换为浅色模式' : '切换为深色模式'}
              icon={mode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
              onClick={toggle}
            />
            <Dropdown
              trigger={['click']}
              menu={{
                items: [
                  { key: 'profile', label: '个人设置', onClick: () => void navigate({ to: '/profile' }) },
                  { type: 'divider' },
                  { key: 'logout', label: '退出登录', onClick: () => void handleLogout() },
                ],
              }}
            >
              <Button className="app-user-trigger" type="text">
                <span className="app-user-avatar">{initials(user?.username)}</span>
                <span className="app-user-name">{user?.username ?? '当前用户'}</span>
                <DownOutlined className="app-user-chevron" />
              </Button>
            </Dropdown>
          </div>
        </header>
        <Layout.Content className="app-content">
          <Outlet />
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
