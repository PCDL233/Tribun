import { useEffect } from 'react';
import type { ReactElement } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import type { RegisterInput } from '@ai-review/shared/api';
import { describeError } from '../parse-response';
import { useAuth, useRegister } from '../hooks/use-auth';
import { BrandMark } from '../components/Brand';

export type RegisterPageProps = { redirect?: string };
type RegisterFormValues = RegisterInput & { confirmPassword: string };

function safeRedirectTarget(redirect: string | undefined): string {
  return redirect !== undefined && redirect.startsWith('/') ? redirect : '/';
}

export function RegisterPage(props: RegisterPageProps): ReactElement {
  const { user } = useAuth();
  const navigate = useNavigate();
  const registerMutation = useRegister();

  useEffect(() => {
    if (user !== null) void navigate({ to: '/', replace: true });
  }, [user, navigate]);

  const handleFinish = async (values: RegisterFormValues): Promise<void> => {
    await registerMutation.mutateAsync({ username: values.username, password: values.password });
    await navigate({ to: safeRedirectTarget(props.redirect), replace: true });
  };

  return (
    <div className="auth-shell">
      <section className="auth-visual">
        <div className="auth-brand">
          <BrandMark />
          <div>
            <div className="auth-brand-title">ReviewFlow</div>
            <div className="app-brand-subtitle">CODE REVIEW CONSOLE</div>
          </div>
        </div>
        <div className="auth-visual-copy">
          <h1 className="auth-visual-title">
            从今天开始，
            <br />
            让每次合并都更安心。
          </h1>
          <p className="auth-visual-description">
            建立你的质量工作区，集中管理审查记录、风险趋势与团队协作反馈。
          </p>
        </div>
        <div className="auth-quote">The first account becomes workspace admin</div>
      </section>
      <section className="auth-form-side">
        <Card className="auth-card">
          <Typography.Title level={2} className="auth-form-title">
            注册账号
          </Typography.Title>
          <Typography.Paragraph className="auth-form-subtitle">
            注册一个账号，开始你的第一轮代码审查。
          </Typography.Paragraph>
          {registerMutation.isError ? (
            <Alert
              type="error"
              showIcon
              message="注册失败"
              description={describeError(registerMutation.error)}
              style={{ marginBottom: 22 }}
            />
          ) : null}
          <Form<RegisterFormValues>
            layout="vertical"
            onFinish={(values) => void handleFinish(values)}
          >
            <Form.Item
              label="用户名"
              name="username"
              rules={[
                { required: true, message: '请输入用户名' },
                { pattern: /^[a-zA-Z0-9_-]{3,32}$/, message: '3-32 位字母、数字、下划线或连字符' },
              ]}
            >
              <Input placeholder="3-32 位字母、数字或符号" autoComplete="username" />
            </Form.Item>
            <Form.Item
              label="密码"
              name="password"
              rules={[
                { required: true, message: '请输入密码' },
                { min: 8, message: '密码至少 8 位' },
              ]}
            >
              <Input.Password placeholder="至少 8 位" autoComplete="new-password" />
            </Form.Item>
            <Form.Item
              label="确认密码"
              name="confirmPassword"
              dependencies={['password']}
              rules={[
                { required: true, message: '请再次输入密码' },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (value === undefined || value === getFieldValue('password'))
                      return Promise.resolve();
                    return Promise.reject(new Error('两次输入的密码不一致'));
                  },
                }),
              ]}
            >
              <Input.Password placeholder="再次输入密码" autoComplete="new-password" />
            </Form.Item>
            <Button type="primary" htmlType="submit" block loading={registerMutation.isPending}>
              注册
            </Button>
          </Form>
          <Typography.Paragraph className="auth-footnote">
            已有账号？{' '}
            <Typography.Link onClick={() => void navigate({ to: '/login' })}>
              返回登录
            </Typography.Link>
          </Typography.Paragraph>
        </Card>
      </section>
    </div>
  );
}
