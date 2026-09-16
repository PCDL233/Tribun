import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { Alert, Card, Skeleton, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { describeError } from '../../parse-response';
import { CardHeading, PageHeader } from '../../components/PageHeader';

type MetricRow = {
  name: string;
  type: string;
  labels: Record<string, string>;
  value: string;
  help?: string;
};

function parseMetrics(text: string): MetricRow[] {
  const rows: MetricRow[] = [];
  const lines = text.split('\n');
  let currentHelp = '';
  let currentType = '';

  for (const line of lines) {
    if (line.startsWith('# HELP ')) {
      const parts = line.slice('# HELP '.length).split(' ');
      currentHelp = parts.slice(1).join(' ');
    } else if (line.startsWith('# TYPE ')) {
      const parts = line.slice('# TYPE '.length).split(' ');
      currentType = parts[1] ?? '';
    } else if (line.trim() === '' || line.startsWith('#')) {
      continue;
    } else {
      const match = line.match(/^([a-zA-Z0-9_:]+)(\{[^}]*\})?\s+(.+)$/);
      if (match !== null) {
        const name = match[1] ?? '';
        const labelText = match[2] ?? '{}';
        const value = match[3] ?? '';
        const labels: Record<string, string> = {};
        const labelMatch = labelText.slice(1, -1).match(/([a-zA-Z0-9_]+)="([^"]*)"/g);
        if (labelMatch !== null) {
          for (const pair of labelMatch) {
            const segments = pair.split('=');
            const key = segments[0];
            const val = segments[1];
            if (key !== undefined && val !== undefined) {
              labels[key] = val.replace(/"/g, '');
            }
          }
        }
        rows.push({ name, type: currentType, labels, value, help: currentHelp });
      }
    }
  }
  return rows;
}

export function AdminMetricsPage(): ReactElement {
  const [metrics, setMetrics] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    fetch('/metrics')
      .then(async (response) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        return response.text();
      })
      .then(setMetrics)
      .catch(setError);
  }, []);

  const rows = metrics === null ? [] : parseMetrics(metrics);
  const columns: ColumnsType<MetricRow> = [
    {
      title: '指标',
      dataIndex: 'name',
      width: 240,
      render: (name: string) => <Typography.Text code>{name}</Typography.Text>,
    },
    { title: '类型', dataIndex: 'type', width: 100, render: (type: string) => <Tag>{type}</Tag> },
    {
      title: '标签',
      dataIndex: 'labels',
      render: (labels: Record<string, string>) =>
        Object.entries(labels).map(([key, value]) => (
          <Tag key={String(key)}>
            {String(key)}={String(value)}
          </Tag>
        )),
    },
    { title: '数值', dataIndex: 'value', width: 140, render: (value: string) => value },
  ];

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Admin / Metrics"
        title="系统指标"
        description="实时查看 Prometheus 格式的系统运行指标，包括审查量、发现数、Token 消耗与运行时数据。"
      />
      <Card className="surface-card" title={<CardHeading title="Prometheus 指标" />}>
        {error !== null ? (
          <Alert type="error" showIcon message="加载失败" description={describeError(error)} />
        ) : metrics === null ? (
          <Skeleton active paragraph={{ rows: 8 }} />
        ) : (
          <Table<MetricRow>
            rowKey={(row, index) => `${row.name}:${index}`}
            columns={columns}
            dataSource={rows}
            pagination={false}
            scroll={{ x: 800 }}
          />
        )}
      </Card>
      {metrics !== null && (
        <Card className="surface-card" title={<CardHeading title="原始文本" />}>
          <pre
            style={{
              margin: 0,
              padding: 16,
              borderRadius: 8,
              background: 'var(--canvas)',
              color: 'var(--ink)',
              fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
              fontSize: 12,
              overflow: 'auto',
              maxHeight: 400,
            }}
          >
            {metrics}
          </pre>
        </Card>
      )}
    </div>
  );
}
