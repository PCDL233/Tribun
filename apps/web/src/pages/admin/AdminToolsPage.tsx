import { useState } from 'react';
import type { ReactElement } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Alert, Button, Card, Input, InputNumber, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { analyzeComplexity, scanSecrets, type FunctionMetrics } from '../../api';
import { describeError } from '../../parse-response';
import { CardHeading, PageHeader } from '../../components/PageHeader';

export function AdminToolsPage(): ReactElement {
  const [diffText, setDiffText] = useState('');
  const [source, setSource] = useState('');
  const [threshold, setThreshold] = useState<number | null>(15);

  const secretMutation = useMutation({ mutationFn: () => scanSecrets(diffText) });
  const complexityMutation = useMutation({
    mutationFn: () => analyzeComplexity(source, threshold ?? undefined),
  });

  const functionColumns: ColumnsType<FunctionMetrics> = [
    { title: '函数', dataIndex: 'name', width: 200 },
    {
      title: '行号',
      dataIndex: 'line',
      width: 80,
      render: (line: number, record) => `${line}-${record.endLine}`,
    },
    {
      title: '复杂度',
      dataIndex: 'complexity',
      width: 100,
      render: (value: number) => <Tag color={value > 20 ? 'error' : 'warning'}>{value}</Tag>,
    },
    { title: '参数', dataIndex: 'params', render: (params: string[]) => params.join(', ') || '—' },
    {
      title: '异步',
      dataIndex: 'isAsync',
      width: 80,
      render: (isAsync: boolean) => (isAsync ? '是' : '否'),
    },
  ];

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Admin / Tools"
        title="静态分析工具"
        description="直接调用内置静态分析工具，快速验证 diff 或源码片段的扫描结果。"
      />
      <Card className="surface-card" title={<CardHeading title="密钥扫描" />}>
        <Typography.Paragraph type="secondary">
          粘贴 unified diff 文本，工具只检查新增行中的疑似密钥或凭证。
        </Typography.Paragraph>
        <Input.TextArea
          rows={8}
          value={diffText}
          onChange={(e) => setDiffText(e.target.value)}
          placeholder="+ const apiKey = 'sk-...'"
        />
        <Button
          style={{ marginTop: 12 }}
          type="primary"
          onClick={() => secretMutation.mutate()}
          loading={secretMutation.isPending}
        >
          扫描
        </Button>
        {secretMutation.isError && (
          <Alert
            style={{ marginTop: 16 }}
            type="error"
            showIcon
            message="扫描失败"
            description={describeError(secretMutation.error)}
          />
        )}
        {secretMutation.data !== undefined && (
          <div style={{ marginTop: 16 }}>
            {secretMutation.data.length === 0 ? (
              <Alert type="success" showIcon message="未发现疑似密钥" />
            ) : (
              <Space direction="vertical" style={{ width: '100%' }}>
                {secretMutation.data.map((finding, index) => (
                  <Alert
                    key={index}
                    type={finding.severity === 'BLOCKER' ? 'error' : 'warning'}
                    showIcon
                    message={
                      <span>
                        {finding.title} <Tag>{finding.cweId}</Tag>
                      </span>
                    }
                    description={finding.codeSnippet}
                  />
                ))}
              </Space>
            )}
          </div>
        )}
      </Card>
      <Card className="surface-card" title={<CardHeading title="复杂度检查" />}>
        <Typography.Paragraph type="secondary">
          粘贴 TypeScript/JavaScript 源码，检查超过阈值的函数。
        </Typography.Paragraph>
        <Space align="start" style={{ marginBottom: 12 }}>
          <InputNumber
            min={1}
            value={threshold}
            onChange={(value) => setThreshold(value)}
            placeholder="阈值"
          />
        </Space>
        <Input.TextArea
          rows={10}
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="function example() { ... }"
        />
        <Button
          style={{ marginTop: 12 }}
          type="primary"
          onClick={() => complexityMutation.mutate()}
          loading={complexityMutation.isPending}
        >
          检查
        </Button>
        {complexityMutation.isError && (
          <Alert
            style={{ marginTop: 16 }}
            type="error"
            showIcon
            message="检查失败"
            description={describeError(complexityMutation.error)}
          />
        )}
        {complexityMutation.data !== undefined && (
          <div style={{ marginTop: 16 }}>
            {complexityMutation.data.length === 0 ? (
              <Alert type="success" showIcon message="未发现超过阈值的函数" />
            ) : (
              <Table<FunctionMetrics>
                rowKey={(row) => `${row.name}:${row.line}`}
                columns={functionColumns}
                dataSource={complexityMutation.data}
                pagination={false}
              />
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
