import { useState } from 'react';
import type { ReactElement } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Form, Input, Tag, Typography } from 'antd';
import { AUTH_QUERY_KEY, useAuth, useChangePassword } from '../hooks/use-auth';
import { describeError } from '../parse-response';
import { CardHeading, PageHeader } from '../components/PageHeader';

type ChangePasswordFormValues = {
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
};

export function ProfilePage(): ReactElement {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const changePasswordMutation = useChangePassword();
  const [form] = Form.useForm<ChangePasswordFormValues>();
  const [submitted, setSubmitted] = useState(false);

  const handleFinish = async (values: ChangePasswordFormValues): Promise<void> => {
    await changePasswordMutation.mutateAsync({
      oldPassword: values.oldPassword,
      newPassword: values.newPassword,
    });
    queryClient.setQueryData(AUTH_QUERY_KEY, null);
    setSubmitted(true);
    void navigate({ to: '/login', replace: true });
  };

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Workspace settings"
        title="个人设置"
        description="管理你的登录凭据与工作区身份信息。"
      />
      <div className="profile-grid">
        <Card className="surface-card" title={<CardHeading title="账号信息" />}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              paddingBottom: 22,
              borderBottom: '1px solid #eef1f6',
            }}
          >
            <div
              className="app-user-avatar"
              style={{ width: 54, height: 54, borderRadius: 17, fontSize: 18 }}
            >
              {user?.username?.slice(0, 2).toUpperCase() ?? 'AI'}
            </div>
            <div>
              <Typography.Title level={4} style={{ margin: 0 }}>
                {user?.username}
              </Typography.Title>
              <Tag color={user?.role === 'admin' ? 'gold' : 'blue'} style={{ marginTop: 7 }}>
                {user?.role === 'admin' ? '管理员' : '普通用户'}
              </Tag>
            </div>
          </div>
          <Typography.Paragraph type="secondary" style={{ margin: '20px 0 0', lineHeight: 1.7 }}>
            当前账号用于登录
            ReviewFlow。修改密码后，系统会吊销所有已登录会话，需要使用新密码重新登录。
          </Typography.Paragraph>
        </Card>
        <Card className="surface-card" title={<CardHeading title="修改密码" />}>
          {submitted ? (
            <Alert
              type="success"
              showIcon
              message="密码已修改，请使用新密码重新登录"
              style={{ marginBottom: 16 }}
            />
          ) : null}
          {changePasswordMutation.isError && !submitted ? (
            <Alert
              type="error"
              showIcon
              message="修改失败"
              description={describeError(changePasswordMutation.error)}
              style={{ marginBottom: 16 }}
            />
          ) : null}
          <Form<ChangePasswordFormValues>
            form={form}
            layout="vertical"
            onFinish={(values) => void handleFinish(values)}
          >
            <Form.Item
              label="当前密码"
              name="oldPassword"
              rules={[{ required: true, message: '请输入当前密码' }]}
            >
              <Input.Password placeholder="输入当前密码" autoComplete="current-password" />
            </Form.Item>
            <Form.Item
              label="新密码"
              name="newPassword"
              rules={[
                { required: true, message: '请输入新密码' },
                { min: 8, message: '密码至少 8 位' },
              ]}
            >
              <Input.Password placeholder="至少 8 位" autoComplete="new-password" />
            </Form.Item>
            <Form.Item
              label="确认新密码"
              name="confirmPassword"
              dependencies={['newPassword']}
              rules={[
                { required: true, message: '请再次输入新密码' },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (value === undefined || value === getFieldValue('newPassword'))
                      return Promise.resolve();
                    return Promise.reject(new Error('两次输入的密码不一致'));
                  },
                }),
              ]}
            >
              <Input.Password placeholder="再次输入新密码" autoComplete="new-password" />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={changePasswordMutation.isPending}>
              保存新密码
            </Button>
          </Form>
        </Card>
      </div>
    </div>
  );
}
