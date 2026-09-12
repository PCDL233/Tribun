import { useState } from 'react';
import type { ReactElement } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import { AUTH_QUERY_KEY, useAuth, useChangePassword } from '../hooks/use-auth';
import { describeError } from '../parse-response';

type ChangePasswordFormValues = {
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
};

/** 个人设置：修改密码（改密成功后服务端吊销全部会话，需重新登录） */
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
    // 服务端已吊销全部会话：清空本地登录态并回登录页
    queryClient.setQueryData(AUTH_QUERY_KEY, null);
    setSubmitted(true);
    void navigate({ to: '/login', replace: true });
  };

  return (
    <Card title="个人设置" style={{ maxWidth: 480 }}>
      <Typography.Paragraph type="secondary">
        当前用户：{user?.username}（{user?.role === 'admin' ? '管理员' : '普通用户'}）
      </Typography.Paragraph>
      {submitted ? (
        <Alert type="success" showIcon message="密码已修改，请使用新密码重新登录" style={{ marginBottom: 16 }} />
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
      <Form<ChangePasswordFormValues> form={form} layout="vertical" onFinish={(values) => void handleFinish(values)}>
        <Form.Item name="oldPassword" rules={[{ required: true, message: '请输入当前密码' }]}>
          <Input.Password placeholder="当前密码" autoComplete="current-password" />
        </Form.Item>
        <Form.Item
          name="newPassword"
          rules={[
            { required: true, message: '请输入新密码' },
            { min: 8, message: '密码至少 8 位' },
          ]}
        >
          <Input.Password placeholder="新密码（至少 8 位）" autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="confirmPassword"
          dependencies={['newPassword']}
          rules={[
            { required: true, message: '请再次输入新密码' },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (value === undefined || value === getFieldValue('newPassword')) {
                  return Promise.resolve();
                }
                return Promise.reject(new Error('两次输入的密码不一致'));
              },
            }),
          ]}
        >
          <Input.Password placeholder="确认新密码" autoComplete="new-password" />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={changePasswordMutation.isPending}>
          修改密码
        </Button>
      </Form>
    </Card>
  );
}
