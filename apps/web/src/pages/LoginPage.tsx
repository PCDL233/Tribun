import { useEffect } from 'react';
import type { ReactElement } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import type { LoginInput } from '@ai-review/shared/api';
import { describeError } from '../parse-response';
import { useAuth, useLogin } from '../hooks/use-auth';
import { BrandMark } from '../components/Brand';

export type LoginPageProps = { redirect?: string };

function safeRedirectTarget(redirect: string | undefined): string {
  return redirect !== undefined && redirect.startsWith('/') ? redirect : '/';
}

export function LoginPage(props: LoginPageProps): ReactElement {
  const { user } = useAuth();
  const navigate = useNavigate();
  const loginMutation = useLogin();

  useEffect(() => {
    if (user !== null) void navigate({ to: '/', replace: true });
  }, [user, navigate]);

  const handleFinish = async (values: LoginInput): Promise<void> => {
    await loginMutation.mutateAsync(values);
    await navigate({ to: safeRedirectTarget(props.redirect), replace: true });
  };

  return (
    <div className="auth-shell">
      <section className="auth-visual">
        <div className="auth-brand">
          <BrandMark />
          <div>
            <div className="auth-brand-title">ReviewFlow</div>
            <div className="app-brand-subtitle">AI CODE REVIEW</div>
          </div>
        </div>
        <div className="auth-visual-copy">
          <h1 className="auth-visual-title">
            让代码质量
            <br />
            成为团队的共识。
          </h1>
          <p className="auth-visual-description">
            从一次提交，到整个团队的工程质量，我们用更清晰的洞察，帮助你把时间花在真正重要的地方。
          </p>
        </div>
        <div className="auth-quote">Built for thoughtful engineering teams · 2026</div>
      </section>
      <section className="auth-form-side">
        <Card className="auth-card">
          <Typography.Title level={2} className="auth-form-title">
            欢迎回来
          </Typography.Title>
          <Typography.Paragraph className="auth-form-subtitle">
            登录你的 ReviewFlow 工作区，继续查看团队代码质量。
          </Typography.Paragraph>
          {loginMutation.isError ? (
            <Alert
              type="error"
              showIcon
              message="登录失败"
              description={describeError(loginMutation.error)}
              style={{ marginBottom: 22 }}
            />
          ) : null}
          <Form<LoginInput> layout="vertical" onFinish={(values) => void handleFinish(values)}>
            <Form.Item
              label="用户名"
              name="username"
              rules={[{ required: true, message: '请输入用户名' }]}
            >
              <Input placeholder="例如：zhangsan" autoComplete="username" />
            </Form.Item>
            <Form.Item
              label="密码"
              name="password"
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password placeholder="输入登录密码" autoComplete="current-password" />
            </Form.Item>
            <Button type="primary" htmlType="submit" block loading={loginMutation.isPending}>
              登录工作区
            </Button>
          </Form>
          <Typography.Paragraph className="auth-footnote">
            还没有账号？{' '}
            <Typography.Link onClick={() => void navigate({ to: '/register' })}>
              创建一个
            </Typography.Link>
          </Typography.Paragraph>
        </Card>
      </section>
    </div>
  );
}
