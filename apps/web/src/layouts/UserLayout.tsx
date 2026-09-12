import { Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { Dropdown, Layout, Menu, Typography } from 'antd';
import type { ItemType } from 'antd/es/menu/interface';
import { useAuth, useLogout } from '../hooks/use-auth';

const { Header, Sider, Content } = Layout;

export type UserLayoutProps = Record<string, never>;

/** 用户端布局：Sider 导航 + Header 用户菜单（方案 3.10 的 Dashboard 骨架扩展为完整站点） */
export function UserLayout(_props: UserLayoutProps): ReactElement {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const logoutMutation = useLogout();

  const menuItems: ItemType[] = [
    { key: '/', label: '首页' },
    { key: '/run', label: '发起审查' },
    { key: '/reviews', label: '审查历史' },
    { key: '/stats', label: '统计分析' },
    ...(user?.role === 'admin' ? [{ key: '/admin', label: '管理后台' }] : []),
    { key: '/profile', label: '个人设置' },
  ];

  const handleLogout = async (): Promise<void> => {
    await logoutMutation.mutateAsync();
    await navigate({ to: '/login', replace: true });
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography.Title level={4} style={{ color: '#fff', margin: 0 }}>
          AI Code Review
        </Typography.Title>
        <Dropdown
          menu={{
            items: [
              { key: 'profile', label: '个人设置' },
              { type: 'divider' },
              { key: 'logout', label: '退出登录', onClick: () => void handleLogout() },
            ],
          }}
        >
          <Typography.Text style={{ color: '#fff', cursor: 'pointer' }}>
            {user?.username ?? ''}
          </Typography.Text>
        </Dropdown>
      </Header>
      <Layout>
        <Sider theme="dark" width={180}>
          <Menu
            theme="dark"
            mode="inline"
            items={menuItems}
            selectedKeys={[location.pathname]}            onClick={({ key }) => void navigate({ to: key })}
          />
        </Sider>
        <Content style={{ padding: 24, maxWidth: 1200, margin: '0 auto', width: '100%' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
