import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useMemo, useState } from 'react';
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Checkbox,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { PlusOutlined, SafetyCertificateOutlined, UserAddOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { Role, User } from '@ai-review/shared/api';
import type { AdminCreateUserInput } from '@ai-review/shared/api';
import {
  assignRoles,
  createUser,
  deleteUser,
  fetchRoles,
  fetchUsers,
  patchUser,
  resetUserPassword,
} from '../../api/admin';
import { describeError } from '../../parse-response';
import { formatDateTime } from '../../format';
import { useAuth } from '../../hooks/use-auth';
import { UserAvatar } from '../../components/UserAvatar';
import { CardHeading } from '../../components/PageHeader';

/** 用户管理（管理后台）：新增用户、角色调整、启用/禁用、重置密码、删除 */
export function AdminUsersPage(): ReactElement {
  const { message, modal } = AntdApp.useApp();
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm<AdminCreateUserInput>();
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<User | null>(null);
  const [assignForm] = Form.useForm<{ roleIds: string[] }>();

  const usersQuery = useQuery({ queryKey: ['admin', 'users'], queryFn: fetchUsers });
  const rolesQuery = useQuery({ queryKey: ['admin', 'roles'], queryFn: fetchRoles });

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

  const createMutation = useMutation({
    mutationFn: (input: AdminCreateUserInput) => createUser(input),
    onSuccess: () => {
      void message.success('用户已创建');
      setCreateOpen(false);
      createForm.resetFields();
      invalidate();
    },
    onError: (e) => setError(e),
  });

  const openAssign = (record: User): void => {
    setAssignTarget(record);
    assignForm.setFieldsValue({ roleIds: record.roleIds });
    setAssignOpen(true);
  };

  const assignMutation = useMutation({
    mutationFn: ({ userId, roleIds }: { userId: string; roleIds: string[] }) =>
      assignRoles(userId, roleIds),
    onSuccess: (user) => {
      void message.success('角色已分配');
      setAssignOpen(false);
      setAssignTarget(null);
      invalidate();
      // 若分配的是当前登录用户，同步刷新本地认证态（导航权限即时生效）
      if (currentUser?.id === user.id) {
        queryClient.setQueryData(['auth'], user);
      }
    },
    onError: (e) => setError(e),
  });

  const filteredUsers = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (keyword === '') return usersQuery.data ?? [];
    return (usersQuery.data ?? []).filter(
      (user) =>
        user.username.toLowerCase().includes(keyword) || user.id.toLowerCase().includes(keyword),
    );
  }, [search, usersQuery.data]);

  const columns: ColumnsType<User> = [
    {
      title: '用户名',
      dataIndex: 'username',
      width: 220,
      render: (_value, record) => (
        <Space size={10}>
          <UserAvatar
            user={record}
            className="app-user-avatar"
            style={{ width: 30, height: 30, borderRadius: 8, fontSize: 12 }}
          />
          <Typography.Text strong>{record.username}</Typography.Text>
        </Space>
      ),
    },
    {
      title: '角色',
      dataIndex: 'role',
      width: 130,
      render: (role: string) => (
        <Tag color={role === 'admin' ? 'gold' : 'blue'}>{role === 'admin' ? '管理员' : '用户'}</Tag>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
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
    {
      title: '注册时间',
      dataIndex: 'createdAt',
      width: 160,
      render: (v: string) => formatDateTime(v),
    },
    {
      title: '最近登录',
      dataIndex: 'lastLoginAt',
      width: 160,
      render: (lastLoginAt: string | null) =>
        lastLoginAt === null ? '从未登录' : formatDateTime(lastLoginAt),
    },
    {
      title: '操作',
      key: 'actions',
      width: 180,
      fixed: 'right',
      render: (_, record) =>
        record.id === currentUser?.id ? (
          <Typography.Text type="secondary">当前账号</Typography.Text>
        ) : (
          <Space size={8}>
            <Typography.Link onClick={() => openAssign(record)}>分配角色</Typography.Link>
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

      <Card className="surface-card data-table-card">
        <div className="table-toolbar">
          <Input.Search
            allowClear
            placeholder="按用户名或用户 ID 搜索"
            onChange={(event) => setSearch(event.target.value)}
            style={{ maxWidth: 320 }}
          />
          <Button type="primary" icon={<UserAddOutlined />} onClick={() => setCreateOpen(true)}>
            增加用户
          </Button>
        </div>
        <Table<User>
          rowKey="id"
          size="middle"
          loading={usersQuery.isPending}
          columns={columns}
          dataSource={filteredUsers}
          scroll={{ x: 1100 }}
          pagination={{
            pageSize: 10,
            showSizeChanger: false,
            showTotal: (total) => `共 ${total} 个用户`,
          }}
        />
      </Card>

      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        提示：无法对当前登录账号降级、禁用或删除，防止误操作导致系统失去管理员。
      </Typography.Paragraph>

      <Modal
        title={<CardHeading title="增加用户" />}
        open={createOpen}
        onOk={() => void createForm.submit()}
        confirmLoading={createMutation.isPending}
        onCancel={() => {
          setCreateOpen(false);
          createForm.resetFields();
        }}
        okText="保存"
        cancelText="取消"
      >
        <Form<AdminCreateUserInput>
          form={createForm}
          layout="vertical"
          onFinish={(values) => createMutation.mutate(values)}
          style={{ marginTop: 16 }}
        >
          <Form.Item
            label="用户名"
            name="username"
            rules={[
              { required: true, message: '请输入用户名' },
              { pattern: /^[a-zA-Z0-9_-]{3,32}$/, message: '3-32 位字母、数字、下划线或连字符' },
            ]}
          >
            <Input placeholder="3-32 位字母、数字或符号" prefix={<PlusOutlined />} />
          </Form.Item>
          <Form.Item
            label="初始密码"
            name="password"
            rules={[
              { required: true, message: '请输入初始密码' },
              { min: 8, message: '密码至少 8 位' },
            ]}
          >
            <Input.Password placeholder="至少 8 位" />
          </Form.Item>
          <Typography.Text type="secondary">
            新用户将以「普通用户」角色创建，创建后可在此页面调整其角色。
          </Typography.Text>
        </Form>
      </Modal>

      <Modal
        title={<CardHeading title={`分配角色：${assignTarget?.username ?? ''}`} />}
        open={assignOpen}
        onOk={() => void assignForm.submit()}
        confirmLoading={assignMutation.isPending}
        onCancel={() => {
          setAssignOpen(false);
          setAssignTarget(null);
          assignForm.resetFields();
        }}
        okText="保存"
        cancelText="取消"
      >
        <Form<{ roleIds: string[] }>
          form={assignForm}
          layout="vertical"
          onFinish={(values) => {
            if (assignTarget === null) return;
            assignMutation.mutate({ userId: assignTarget.id, roleIds: values.roleIds });
          }}
          style={{ marginTop: 16 }}
        >
          <Form.Item name="roleIds" rules={[{ required: true, message: '请至少选择一个角色' }]}>
            <Checkbox.Group style={{ width: '100%' }}>
              <Space direction="vertical" style={{ width: '100%' }}>
                {(rolesQuery.data ?? []).map((role: Role) => (
                  <Checkbox key={role.id} value={role.id}>
                    <Space size={6}>
                      <SafetyCertificateOutlined
                        style={{ color: role.isSystem ? '#f59e0b' : '#4f46e5' }}
                      />
                      {role.name}
                      {role.isSystem ? <Tag color="gold">内置</Tag> : null}
                      <Typography.Text type="secondary">优先级 #{role.priority}</Typography.Text>
                    </Space>
                  </Checkbox>
                ))}
              </Space>
            </Checkbox.Group>
          </Form.Item>
          <Typography.Text type="secondary">
            可多选角色，系统按优先级自动取最高优先级作为默认角色，权限取并集。
          </Typography.Text>
        </Form>
      </Modal>
    </Space>
  );
}
