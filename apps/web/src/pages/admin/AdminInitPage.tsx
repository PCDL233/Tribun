import { useState } from 'react';
import type { ReactElement } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Result, Typography } from 'antd';
import { CheckCircleOutlined, FileTextOutlined } from '@ant-design/icons';
import { initializeConfig } from '../../api';
import { describeError } from '../../parse-response';
import { CardHeading, PageHeader } from '../../components/PageHeader';

export function AdminInitPage(): ReactElement {
  const queryClient = useQueryClient();
  const [created, setCreated] = useState(false);
  const initMutation = useMutation({
    mutationFn: initializeConfig,
    onSuccess: () => {
      setCreated(true);
      void queryClient.invalidateQueries({ queryKey: ['admin-config'] });
    },
  });

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Admin / Init"
        title="配置初始化"
        description="为当前工作区生成默认的 .ai-review.yml 配置文件，之后可在系统配置中进一步调整。"
      />
      {created ? (
        <Result
          icon={<CheckCircleOutlined style={{ color: '#10b981' }} />}
          title="配置文件已生成"
          subTitle="默认配置已写入 .ai-review.yml。你可以前往 AI 模型配置或系统配置页面继续调整。"
          extra={
            <Button type="primary" href="/admin/ai">
              前往 AI 模型配置
            </Button>
          }
        />
      ) : (
        <Card className="surface-card" title={<CardHeading title="生成默认配置" />}>
          <Typography.Paragraph>
            点击下方的按钮，系统会根据内置配置 schema 生成一份包含默认值的{' '}
            <Typography.Text code>.ai-review.yml</Typography.Text>：
          </Typography.Paragraph>
          <ul style={{ color: 'var(--muted)', lineHeight: 1.8 }}>
            <li>模型提供商、模型名称与默认端点</li>
            <li>Fast/Full 审查模式与阻断阈值</li>
            <li>静态分析工具与复杂度阈值</li>
            <li>RAG 知识库路径与报告输出策略</li>
          </ul>
          {initMutation.isError && (
            <Alert
              style={{ marginBottom: 16 }}
              type="error"
              showIcon
              message="初始化失败"
              description={describeError(initMutation.error)}
            />
          )}
          <Button
            type="primary"
            icon={<FileTextOutlined />}
            loading={initMutation.isPending}
            onClick={() => initMutation.mutate()}
          >
            生成默认配置
          </Button>
        </Card>
      )}
    </div>
  );
}
