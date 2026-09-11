import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { Alert, Descriptions, Space, Spin, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
// Severity 为纯类型导入（编译期擦除），走主入口；运行时契约走 ./api 子路径（浏览器安全）
import type { Severity } from '@ai-review/shared';
import type { IdentifiedFinding, ReviewReportDetail } from '@ai-review/shared/api';
import { FalsePositiveSwitch } from '../components/FalsePositiveSwitch';
import { describeError } from '../parse-response';
import { fetchReviewDetail } from '../api';

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
      width: 96,
      render: (severity: Severity) => <Tag color={SEVERITY_COLORS[severity]}>{severity}</Tag>,
    },
    {
      title: '位置',
      dataIndex: 'filePath',
      width: 220,
      render: (filePath: string, record) => (
        <Typography.Text code>
          {filePath}:{record.lineStart}
          {record.lineEnd > record.lineStart ? `-${record.lineEnd}` : ''}
        </Typography.Text>
      ),
    },
    {
      title: '问题',
      dataIndex: 'title',
      render: (title: string, record) => (
        <>
          <Typography.Text strong>{title}</Typography.Text>
          <br />
          <Typography.Text type="secondary">{record.description}</Typography.Text>
          {record.suggestion !== undefined ? (
            <>
              <br />
              <Typography.Text type="warning">建议：{record.suggestion}</Typography.Text>
            </>
          ) : null}
        </>
      ),
    },
    {
      title: '来源',
      dataIndex: 'agent',
      width: 110,
      render: (agent: string, record) => (
        <Space size={4}>
          <Tag>{agent}</Tag>
          {record.cweId !== undefined ? <Tag color="volcano">{record.cweId}</Tag> : null}
        </Space>
      ),
    },
    {
      title: '置信度',
      dataIndex: 'confidence',
      width: 84,
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

export type ReportDetailViewProps = {
  reviewId: string;
  onBack: () => void;
};

/** 报告详情（方案 3.10 页面 2）：元信息 + 发现列表（支持误报标记） */
export function ReportDetailView(props: ReportDetailViewProps): ReactElement {
  const detailQuery = useQuery({
    queryKey: ['review', props.reviewId],
    queryFn: () => fetchReviewDetail(props.reviewId),
  });

  if (detailQuery.isPending) return <Spin tip="加载报告中…" />;
  if (detailQuery.isError) {
    return (
      <Alert
        type="error"
        showIcon
        message="报告加载失败"
        description={describeError(detailQuery.error)}
      />
    );
  }

  const detail: ReviewReportDetail = detailQuery.data;
  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Typography.Link onClick={props.onBack}>← 返回列表</Typography.Link>
      <Descriptions
        title={`审查报告 ${detail.meta.reviewId}`}
        size="small"
        column={3}
        items={[
          { key: 'repo', label: '仓库', children: detail.meta.repoPath },
          { key: 'branch', label: '分支', children: detail.meta.branch },
          { key: 'mode', label: '模式', children: detail.meta.mode },
          { key: 'model', label: '审查模型', children: detail.meta.model },
          { key: 'risk', label: '风险评分', children: `${detail.meta.riskScore}/100` },
          {
            key: 'duration',
            label: '耗时',
            children: `${(detail.meta.durationMs / 1000).toFixed(1)}s · ${detail.meta.tokenUsed} tokens`,
          },
        ]}
      />
      {detail.degradedToStatic.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          message="预算受限，部分文件已降级为仅静态分析"
          description={detail.degradedToStatic.join('、')}
        />
      ) : null}
      <Alert
        type={detail.findings.some((f) => f.severity === 'BLOCKER') ? 'error' : 'success'}
        showIcon
        message={detail.assessment}
      />
      <Typography.Title level={5}>发现的问题（{detail.findings.length}）</Typography.Title>
      <Table<IdentifiedFinding>
        rowKey="id"
        size="small"
        columns={buildFindingColumns(props.reviewId)}
        dataSource={detail.findings}
        pagination={false}
      />
      <Typography.Paragraph type="secondary">{detail.summary}</Typography.Paragraph>
    </Space>
  );
}
