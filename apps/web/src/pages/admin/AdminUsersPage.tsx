import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useMemo, useState } from 'react';
import { Alert, App as AntdApp, Input, Popconfirm, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { User } from '@ai-review/shared/api';
import { deleteUser, fetchUsers, patchUser, resetUserPassword } from '../../api/admin';
import { describeError } from '../../parse-response';
import { useAuth } from '../../hooks/use-auth';

/** 用户管理（管理后台）：角色调整、启用/禁用、重置密码、删除 */
export function AdminUsersPage(): ReactElement {
  const { message, modal } = AntdApp.useApp();
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const [search, setSearch] = useState('');

  const usersQuery = useQuery({ queryKey: ['admin', 'users'], queryFn: fetchUsers });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'overview'] });
  };

  const patchMutation = useMutation({
    mutationFn: (input: { userId: string; patch: Parameters<typeof patchUser>[1] }) =>
      patchUser(input.userId, input.patch),
    onSuccess: invalidate,
    onError: (e) => setError(e),
  });

  const resetMutation = useMutation({
    mutationFn: (userId: string) => resetUserPassword(userId),
    onSuccess: (newPassword) => {
      // 新密码仅此一次可见，强制弹窗展示避免遗漏
      void modal.success({
        title: '密码已重置',
        content: (
          <Space direction="vertical">
            <Typography.Text type="secondary">
              新密码（仅显示一次，请立即转告该用户）：
            </Typography.Text>
            <Typography.Text copyable code style={{ fontSize: 16 }}>
              {newPassword}
            </Typography.Text>
          </Space>
        ),
      });
      invalidate();
    },
    onError: (e) => setError(e),
  });

  const deleteMutation = useMutation({
    mutationFn: (userId: string) => deleteUser(userId),
    onSuccess: () => {
      void message.success('用户已删除');
      invalidate();
    },
    onError: (e) => setError(e),
  });

  const filteredUsers = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (keyword === '') return usersQuery.data ?? [];
    return (usersQuery.data ?? []).filter((user) =>
      user.username.toLowerCase().includes(keyword) || user.id.toLowerCase().includes(keyword),
    );
  }, [search, usersQuery.data]);

  const columns: ColumnsType<User> = [
    { title: '用户名', dataIndex: 'username', width: 160 },
    {
      title: '角色',
      dataIndex: 'role',
      width: 120,
      render: (role: string, record) => (
        <Space size={4}>
          <Tag color={role === 'admin' ? 'gold' : 'blue'}>
            {role === 'admin' ? '管理员' : '用户'}
          </Tag>
          {record.id !== currentUser?.id ? (
            <Typography.Link
              onClick={() =>
                patchMutation.mutate({
                  userId: record.id,
                  patch: { role: role === 'admin' ? 'user' : 'admin' },
                })
              }
            >
              {role === 'admin' ? '降为用户' : '设为管理员'}
            </Typography.Link>
          ) : null}
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 120,
      render: (status: string, record) => (
        <Space size={4}>
          <Tag color={status === 'active' ? 'green' : 'red'}>
            {status === 'active' ? '正常' : '已禁用'}
          </Tag>
          {record.id !== currentUser?.id ? (
            <Typography.Link
              onClick={() =>
                patchMutation.mutate({
                  userId: record.id,
                  patch: { status: status === 'active' ? 'disabled' : 'active' },
                })
              }
            >
              {status === 'active' ? '禁用' : '启用'}
            </Typography.Link>
          ) : null}
        </Space>
      ),
    },
    { title: '注册时间', dataIndex: 'createdAt', width: 180 },
    {
      title: '最近登录',
      dataIndex: 'lastLoginAt',
      width: 180,
      render: (lastLoginAt: string | null) => lastLoginAt ?? '从未登录',
    },
    {
      title: '操作',
      width: 180,
      render: (_, record) =>
        record.id === currentUser?.id ? (
          <Typography.Text type="secondary">当前账号</Typography.Text>
        ) : (
          <Space size={8}>
            <Typography.Link onClick={() => resetMutation.mutate(record.id)}>
              重置密码
            </Typography.Link>
            <Popconfirm
              title="确认删除该用户？"
              description="删除后该用户将无法登录，其历史审查记录保留。"
              onConfirm={() => deleteMutation.mutate(record.id)}
            >
              <Typography.Link type="danger">删除</Typography.Link>
            </Popconfirm>
          </Space>
        ),
    },
  ];

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      {error !== null ? (
        <Alert
          type="error"
          showIcon
          message="操作失败"
          description={describeError(error)}
          closable
          onClose={() => setError(null)}
        />
      ) : null}
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Input.Search
          allowClear
          placeholder="按用户名或用户 ID 搜索"
          onChange={(event) => setSearch(event.target.value)}
          style={{ maxWidth: 360 }}
        />
        <Table<User>
          rowKey="id"
          size="small"
          loading={usersQuery.isPending}
          columns={columns}
          dataSource={filteredUsers}
          pagination={{ pageSize: 10, showSizeChanger: false, showTotal: (total) => `共 ${total} 个用户` }}
        />
      </Space>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        提示：无法对当前登录账号降级、禁用或删除，防止误操作导致系统失去管理员。
      </Typography.Paragraph>
    </Space>
  );
}
