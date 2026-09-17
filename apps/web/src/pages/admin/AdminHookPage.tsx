import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { Alert, Button, Card, Skeleton, Typography } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import { fetchHookScript } from '../../api';
import { CardHeading, PageHeader } from '../../components/PageHeader';
import { ErrorAlert } from '../../components/ErrorAlert';

export function AdminHookPage(): ReactElement {
  const [script, setScript] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [copied, setCopied] = useState(false);

  const retry = useCallback((): void => {
    setError(null);
    setScript(null);
    fetchHookScript().then(setScript).catch(setError);
  }, []);

  useEffect(() => {
    retry();
  }, [retry]);

  const handleCopy = async (): Promise<void> => {
    if (script === null) return;
    await navigator.clipboard.writeText(script);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Admin / Hook"
        title="Git Hook 安装"
        description="获取 pre-commit hook 脚本并在本地仓库安装，提交前自动运行快速审查。"
      />
      <Card className="surface-card" title={<CardHeading title="安装步骤" />}>
        <ol style={{ color: 'var(--muted)', lineHeight: 1.8, marginBottom: 16 }}>
          <li>
            确保本地仓库已启用 husky v9：
            <Typography.Text code>pnpm exec husky init</Typography.Text>
          </li>
          <li>
            将下方脚本复制到 <Typography.Text code>.husky/pre-commit</Typography.Text>
          </li>
          <li>提交代码时即可自动触发 fast 模式审查</li>
        </ol>
        <Alert
          type="info"
          showIcon
          message="服务端无法直接写入你的本地文件系统"
          description="请手动创建 hook 文件，或使用你熟悉的包管理脚本批量写入。"
          style={{ marginBottom: 16 }}
        />
      </Card>
      <Card
        className="surface-card"
        title={<CardHeading title="pre-commit 脚本" />}
        extra={
          <Button
            icon={<CopyOutlined />}
            onClick={() => void handleCopy()}
            disabled={script === null}
          >
            {copied ? '已复制' : '复制脚本'}
          </Button>
        }
      >
        {error !== null ? (
          <ErrorAlert error={error} title="加载失败" onRetry={retry} />
        ) : script === null ? (
          <Skeleton active paragraph={{ rows: 4 }} />
        ) : (
          <pre
            style={{
              margin: 0,
              padding: 16,
              borderRadius: 8,
              background: 'var(--canvas)',
              color: 'var(--ink)',
              fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
              fontSize: 13,
              overflow: 'auto',
            }}
          >
            {script}
          </pre>
        )}
      </Card>
    </div>
  );
}
