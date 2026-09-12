import { useEffect } from 'react';
import type { ReactElement } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import type { LoginInput } from '@ai-review/shared/api';
import { describeError } from '../parse-response';
import { useAuth, useLogin } from '../hooks/use-auth';

export type LoginPageProps = {
  /** 登录成功后的跳转目标（仅接受站内路径） */
  redirect?: string;
};

function safeRedirectTarget(redirect: string | undefined): string {
  // 仅接受站内路径，防开放重定向
  return redirect !== undefined && redirect.startsWith('/') ? redirect : '/';
}

/** 登录页（公开路由） */
export function LoginPage(props: LoginPageProps): ReactElement {
  const { user } = useAuth();
  const navigate = useNavigate();
  const loginMutation = useLogin();

  // 已登录用户访问登录页时直接回到首页
  useEffect(() => {
    if (user !== null) void navigate({ to: '/', replace: true });
  }, [user, navigate]);

  const handleFinish = async (values: LoginInput): Promise<void> => {
    await loginMutation.mutateAsync(values);
    await navigate({ to: safeRedirectTarget(props.redirect), replace: true });
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
          AI Code Review
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ textAlign: 'center' }}>
          团队代码审查平台 · 请登录
        </Typography.Paragraph>
        {loginMutation.isError ? (
          <Alert
            type="error"
            showIcon
            message="登录失败"
            description={describeError(loginMutation.error)}
            style={{ marginBottom: 16 }}
          />
        ) : null}
        <Form<LoginInput> layout="vertical" onFinish={(values) => void handleFinish(values)}>
          <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input placeholder="用户名" autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password placeholder="密码" autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={loginMutation.isPending}>
            登录
          </Button>
        </Form>
        <Typography.Paragraph style={{ marginTop: 16, textAlign: 'center', marginBottom: 0 }}>
          还没有账号？<Typography.Link onClick={() => void navigate({ to: '/register' })}>注册</Typography.Link>
        </Typography.Paragraph>
      </Card>
    </div>
  );
}
