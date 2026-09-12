import { Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { Dropdown, Layout, Menu, Typography } from 'antd';
import type { ItemType } from 'antd/es/menu/interface';
import { useAuth, useLogout } from '../hooks/use-auth';
import { BrandMark, initials } from '../components/Brand';

type NavItem = { key: string; label: string; icon: string };
const navItems: NavItem[] = [
  { key: '/', label: '工作台', icon: '⌂' },
  { key: '/run', label: '发起审查', icon: '+' },
  { key: '/reviews', label: '审查历史', icon: '↺' },
  { key: '/stats', label: '统计分析', icon: '◔' },
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

/** 用户端布局：深色品牌侧栏 + 轻量内容区，适配桌面与移动端。 */
export function UserLayout(): ReactElement {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const logoutMutation = useLogout();

  const menuItems: ItemType[] = [
    ...navItems.map((item) => ({
      key: item.key,
      label: item.label,
      icon: (
        <span className="nav-icon" aria-hidden="true">
          {item.icon}
        </span>
      ),
    })),
    ...(user?.role === 'admin'
      ? [
          {
            key: '/admin',
            label: '管理后台',
            icon: (
              <span className="nav-icon" aria-hidden="true">
                ▦
              </span>
            ),
          },
        ]
      : []),
    {
      key: '/profile',
      label: '个人设置',
      icon: (
        <span className="nav-icon" aria-hidden="true">
          ⚙
        </span>
      ),
    },
  ];

  const handleLogout = async (): Promise<void> => {
    await logoutMutation.mutateAsync();
    await navigate({ to: '/login', replace: true });
  };

  return (
    <Layout className="app-shell">
      <Layout.Sider className="app-sider" width={248} breakpoint="lg" collapsedWidth={0}>
        <div className="app-brand">
          <BrandMark />
          <div>
            <div className="app-brand-title">ReviewFlow</div>
            <div className="app-brand-subtitle">AI CODE REVIEW</div>
          </div>
        </div>
        <div className="app-menu-label">Workspace</div>
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
              <div className="sidebar-user-role">
                {user?.role === 'admin' ? '管理员' : '成员'} · 已登录
              </div>
            </div>
          </div>
        </div>
      </Layout.Sider>
      <Layout className="app-main">
        <div className="app-topbar">
          <div>
            <div className="app-topbar-kicker">AI CODE REVIEW PLATFORM</div>
            <Typography.Title level={4} className="app-topbar-title">
              {pageName(location.pathname)}
            </Typography.Title>
          </div>
          <div className="app-topbar-actions">
            <Dropdown
              trigger={['click']}
              menu={{
                items: [
                  {
                    key: 'profile',
                    label: '个人设置',
                    onClick: () => void navigate({ to: '/profile' }),
                  },
                  { type: 'divider' },
                  { key: 'logout', label: '退出登录', onClick: () => void handleLogout() },
                ],
              }}
            >
              <button className="app-user-trigger" type="button">
                <span className="app-user-avatar">{initials(user?.username)}</span>
                <span className="app-user-name">{user?.username ?? '当前用户'}</span>
                <span style={{ color: '#9aa4b5', fontSize: 11 }}>⌄</span>
              </button>
            </Dropdown>
          </div>
        </div>
        <Layout.Content className="app-content">
          <Outlet />
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
