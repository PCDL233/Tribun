import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { Alert, Button, Card, Descriptions, Space, Spin, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { Severity } from '@ai-review/shared';
import type { IdentifiedFinding, ReviewReportDetail } from '@ai-review/shared/api';
import { FalsePositiveSwitch } from '../components/FalsePositiveSwitch';
import { describeError } from '../parse-response';
import { fetchReviewDetail } from '../api';
import { CardHeading, PageHeader } from '../components/PageHeader';

const SEVERITY_COLORS: Record<Severity, string> = {
  BLOCKER: 'red',
  WARNING: 'orange',
  NIT: 'blue',
  PRAISE: 'green',
};

function buildFindingColumns(reviewId: string): ColumnsType<IdentifiedFinding> {
  return [
    {
      title: '严重度',
      dataIndex: 'severity',
      width: 105,
      render: (severity: Severity) => <Tag color={SEVERITY_COLORS[severity]}>{severity}</Tag>,
    },
    {
      title: '位置',
      dataIndex: 'filePath',
      width: 240,
      render: (filePath: string, record) => (
        <Typography.Text code>
          {filePath}:{record.lineStart}
          {record.lineEnd > record.lineStart ? `-${record.lineEnd}` : ''}
        </Typography.Text>
      ),
    },
    {
      title: '问题与建议',
      dataIndex: 'title',
      render: (title: string, record) => (
        <Space direction="vertical" size={3}>
          <Typography.Text strong>{title}</Typography.Text>
          <Typography.Text type="secondary">{record.description}</Typography.Text>
          {record.suggestion !== undefined ? (
            <Typography.Text type="warning">建议：{record.suggestion}</Typography.Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: '来源',
      dataIndex: 'agent',
      width: 130,
      render: (agent: string, record) => (
        <Space size={4} wrap>
          <Tag>{agent}</Tag>
          {record.cweId !== undefined ? <Tag color="volcano">{record.cweId}</Tag> : null}
        </Space>
      ),
    },
    {
      title: '置信度',
      dataIndex: 'confidence',
      width: 86,
      render: (confidence: number) => confidence.toFixed(2),
    },
    {
      title: '误报',
      dataIndex: 'isFalsePositive',
      width: 110,
      render: (_: boolean, record) => <FalsePositiveSwitch finding={record} reviewId={reviewId} />,
    },
  ];
}

export function ReportDetailView(props: { reviewId: string; onBack: () => void }): ReactElement {
  const detailQuery = useQuery({
    queryKey: ['review', props.reviewId],
    queryFn: () => fetchReviewDetail(props.reviewId),
  });
  if (detailQuery.isPending)
    return (
      <div className="empty-copy">
        <Spin tip="加载报告中…" />
      </div>
    );
  if (detailQuery.isError)
    return (
      <Alert
        type="error"
        showIcon
        message="报告加载失败"
        description={describeError(detailQuery.error)}
      />
    );
  const detail: ReviewReportDetail = detailQuery.data;
  const blockerCount = detail.findings.filter((finding) => finding.severity === 'BLOCKER').length;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Review report"
        title="审查报告"
        description={`任务 ${detail.meta.reviewId} · 查看风险发现、分析建议与处理状态`}
        actions={<Button onClick={props.onBack}>← 返回历史</Button>}
      />
      <Card className="surface-card" title={<CardHeading title="审查摘要" />}>
        <Descriptions
          className="meta-grid"
          column={{ xs: 1, sm: 2, lg: 3 }}
          items={[
            { key: 'repo', label: '仓库', children: detail.meta.repoPath },
            { key: 'branch', label: '分支', children: detail.meta.branch },
            {
              key: 'mode',
              label: '模式',
              children: (
                <Tag color={detail.meta.mode === 'full' ? 'purple' : 'cyan'}>
                  {detail.meta.mode.toUpperCase()}
                </Tag>
              ),
            },
            { key: 'model', label: '审查模型', children: detail.meta.model },
            {
              key: 'risk',
              label: '风险评分',
              children: <Typography.Text strong>{detail.meta.riskScore}/100</Typography.Text>,
            },
            {
              key: 'duration',
              label: '耗时 / Token',
              children: `${(detail.meta.durationMs / 1000).toFixed(1)}s · ${detail.meta.tokenUsed}`,
            },
          ]}
        />
      </Card>
      {detail.degradedToStatic.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          message="预算受限，部分文件已降级为仅静态分析"
          description={detail.degradedToStatic.join('、')}
        />
      ) : null}
      <Alert
        type={blockerCount > 0 ? 'error' : 'success'}
        showIcon
        message={detail.assessment}
        description={`共发现 ${detail.findings.length} 个问题，其中 BLOCKER ${blockerCount} 个。`}
      />
      <Card
        className="surface-card data-table-card"
        title={<CardHeading title={`发现的问题 · ${detail.findings.length}`} />}
      >
        <Table<IdentifiedFinding>
          rowKey="id"
          columns={buildFindingColumns(props.reviewId)}
          dataSource={detail.findings}
          pagination={false}
          scroll={{ x: 1080 }}
          locale={{ emptyText: <div className="empty-copy">这份报告没有发现需要处理的问题。</div> }}
        />
      </Card>
      <Card className="surface-card" style={{ background: '#fbfcff' }}>
        <Typography.Paragraph style={{ margin: 0, color: '#5f6b80', lineHeight: 1.8 }}>
          <Typography.Text strong>总结：</Typography.Text> {detail.summary}
        </Typography.Paragraph>
      </Card>
    </div>
  );
}
