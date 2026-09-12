import { useEffect } from 'react';
import type { ReactElement } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import type { RegisterInput } from '@ai-review/shared/api';
import { describeError } from '../parse-response';
import { useAuth, useRegister } from '../hooks/use-auth';

export type RegisterPageProps = {
  /** 注册成功后的跳转目标（仅接受站内路径） */
  redirect?: string;
};

type RegisterFormValues = RegisterInput & { confirmPassword: string };

/** 注册页（公开路由）：首个注册用户自动成为管理员，其余为普通用户 */
export function RegisterPage(props: RegisterPageProps): ReactElement {
  const { user } = useAuth();
  const navigate = useNavigate();
  const registerMutation = useRegister();

  useEffect(() => {
    if (user !== null) void navigate({ to: '/', replace: true });
  }, [user, navigate]);

  const handleFinish = async (values: RegisterFormValues): Promise<void> => {
    await registerMutation.mutateAsync({ username: values.username, password: values.password });
    await navigate({ to: props.redirect ?? '/', replace: true });
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f5f5f5',
      }}
    >
      <Card style={{ width: 380 }}>
        <Typography.Title level={3} style={{ textAlign: 'center' }}>
          注册账号
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ textAlign: 'center' }}>
          系统的第一个注册用户将成为管理员
        </Typography.Paragraph>
        {registerMutation.isError ? (
          <Alert
            type="error"
            showIcon
            message="注册失败"
            description={describeError(registerMutation.error)}
            style={{ marginBottom: 16 }}
          />
        ) : null}
        <Form<RegisterFormValues> layout="vertical" onFinish={(values) => void handleFinish(values)}>
          <Form.Item
            name="username"
            rules={[
              { required: true, message: '请输入用户名' },
              {
                pattern: /^[a-zA-Z0-9_-]{3,32}$/,
                message: '3-32 位字母、数字、下划线或连字符',
              },
            ]}
          >
            <Input placeholder="用户名" autoComplete="username" />
          </Form.Item>
          <Form.Item
            name="password"
            rules={[
              { required: true, message: '请输入密码' },
              { min: 8, message: '密码至少 8 位' },
            ]}
          >
            <Input.Password placeholder="密码（至少 8 位）" autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            dependencies={['password']}
            rules={[
              { required: true, message: '请再次输入密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (value === undefined || value === getFieldValue('password')) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('两次输入的密码不一致'));
                },
              }),
            ]}
          >
            <Input.Password placeholder="确认密码" autoComplete="new-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={registerMutation.isPending}>
            注册
          </Button>
        </Form>
        <Typography.Paragraph style={{ marginTop: 16, textAlign: 'center', marginBottom: 0 }}>
          已有账号？<Typography.Link onClick={() => void navigate({ to: '/login' })}>去登录</Typography.Link>
        </Typography.Paragraph>
      </Card>
    </div>
  );
}
