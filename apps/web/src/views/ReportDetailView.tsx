import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Empty,
  List,
  Popconfirm,
  Progress,
  Skeleton,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { Severity } from '@ai-review/shared';
import type { IdentifiedFinding, ReviewReportDetail } from '@ai-review/shared/api';
import { FalsePositiveSwitch } from '../components/FalsePositiveSwitch';
import { DiffViewer } from '../components/DiffViewer';
import { describeError } from '../parse-response';
import {
  deleteReview,
  fetchReviewDetail,
  fetchReviewDiff,
  rerunReview,
  reviewExportUrl,
} from '../api';
import { CardHeading, PageHeader } from '../components/PageHeader';

const SEVERITY_COLORS: Record<Severity, string> = {
  BLOCKER: 'red',
  WARNING: 'orange',
  NIT: 'blue',
  PRAISE: 'green',
};

function statusTag(status: ReviewReportDetail['meta']['status']): ReactElement {
  const actualStatus = status ?? 'completed';
  return (
    <Tag
      color={
        actualStatus === 'completed' ? 'success' : actualStatus === 'failed' ? 'error' : 'default'
      }
    >
      {actualStatus === 'completed' ? '已完成' : actualStatus === 'failed' ? '失败' : '已取消'}
    </Tag>
  );
}

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
          {record.codeSnippet !== undefined ? (
            <Typography.Text code className="finding-snippet">
              {record.codeSnippet}
            </Typography.Text>
          ) : null}
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
      render: (confidence: number) => `${Math.round(confidence * 100)}%`,
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
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const detailQuery = useQuery({
    queryKey: ['review', props.reviewId],
    queryFn: () => fetchReviewDetail(props.reviewId),
  });
  const diffQuery = useQuery({
    queryKey: ['review-diff', props.reviewId],
    queryFn: () => fetchReviewDiff(props.reviewId),
  });
  const rerunMutation = useMutation({
    mutationFn: () => rerunReview(props.reviewId),
    onSuccess: (reviewId) => {
      message.success(`已创建新的审查任务：${reviewId}`);
      void queryClient.invalidateQueries({ queryKey: ['reviews'] });
      props.onBack();
    },
    onError: (error) => message.error(`重跑失败：${describeError(error)}`),
  });
  const deleteMutation = useMutation({
    mutationFn: () => deleteReview(props.reviewId),
    onSuccess: () => {
      message.success('审查记录已删除');
      void queryClient.invalidateQueries({ queryKey: ['reviews'] });
      props.onBack();
    },
    onError: (error) => message.error(`删除失败：${describeError(error)}`),
  });

  if (detailQuery.isPending)
    return (
      <Card className="surface-card">
        <Skeleton active paragraph={{ rows: 8 }} />
      </Card>
    );
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
  const blockerCount = detail.findings.filter((finding) => finding.severity === 'BLOCKER').length;
  const warningCount = detail.findings.filter((finding) => finding.severity === 'WARNING').length;
  const status = detail.meta.status ?? 'completed';

  const overview = (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card className="surface-card" title={<CardHeading title="审查摘要" />}>
        <Descriptions
          className="meta-grid"
          column={{ xs: 1, sm: 2, lg: 3 }}
          items={[
            { key: 'repo', label: '仓库', children: detail.meta.repoPath },
            { key: 'branch', label: '分支', children: detail.meta.branch },
            { key: 'status', label: '状态', children: statusTag(status) },
            {
              key: 'mode',
              label: '模式',
              children: (
                <Tag color={detail.meta.mode === 'full' ? 'blue' : 'default'}>
                  {detail.meta.mode.toUpperCase()}
                </Tag>
              ),
            },
            { key: 'model', label: '审查模型', children: detail.meta.model },
            {
              key: 'risk',
              label: '风险评分',
              children: (
                <Space>
                  <Progress
                    type="circle"
                    percent={detail.meta.riskScore}
                    size={42}
                    strokeColor={detail.meta.riskScore >= 70 ? '#ff4d4f' : '#1677ff'}
                  />
                  <Typography.Text strong>{detail.meta.riskScore}/100</Typography.Text>
                </Space>
              ),
            },
            {
              key: 'duration',
              label: '耗时 / Token',
              children: `${(detail.meta.durationMs / 1000).toFixed(1)}s · ${detail.meta.tokenUsed}`,
            },
          ]}
        />
      </Card>
      {status !== 'completed' && detail.meta.errorMessage !== undefined ? (
        <Alert
          type={status === 'failed' ? 'error' : 'warning'}
          showIcon
          message={detail.meta.errorMessage}
        />
      ) : null}
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
        description={`共发现 ${detail.findings.length} 个问题，其中 BLOCKER ${blockerCount} 个，WARNING ${warningCount} 个。`}
      />
      <Card className="surface-card" title={<CardHeading title="变更概述" />}>
        <Typography.Paragraph className="report-copy">{detail.summary}</Typography.Paragraph>
      </Card>
      <div className="report-columns">
        <Card className="surface-card" title={<CardHeading title="代码质量考量" />}>
          {detail.qualityNotes.length > 0 ? (
            <List
              size="small"
              dataSource={detail.qualityNotes}
              renderItem={(item) => <List.Item>{item}</List.Item>}
            />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无额外质量说明" />
          )}
        </Card>
        <Card className="surface-card" title={<CardHeading title="改进建议" />}>
          {detail.suggestions.length > 0 ? (
            <List
              size="small"
              dataSource={detail.suggestions}
              renderItem={(item) => <List.Item>{item}</List.Item>}
            />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无改进建议" />
          )}
        </Card>
      </div>
    </Space>
  );

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Review report"
        title="审查报告"
        description={`任务 ${detail.meta.reviewId} · 查看变更、风险发现与改进建议`}
        actions={
          <Space wrap>
            <Button onClick={props.onBack}>返回历史</Button>
            <Button href={reviewExportUrl(props.reviewId, 'markdown')} target="_blank">
              导出 Markdown
            </Button>
            <Button href={reviewExportUrl(props.reviewId, 'html')} target="_blank">
              导出 HTML
            </Button>
            <Button href={reviewExportUrl(props.reviewId, 'json')} target="_blank">
              导出 JSON
            </Button>
            <Button loading={rerunMutation.isPending} onClick={() => rerunMutation.mutate()}>
              重新审查
            </Button>
            <Popconfirm
              title="确定删除这条审查记录吗？"
              description="删除后报告、发现和 Diff 将无法恢复。"
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => deleteMutation.mutate()}
            >
              <Button danger loading={deleteMutation.isPending}>
                删除
              </Button>
            </Popconfirm>
          </Space>
        }
      />
      <Tabs
        defaultActiveKey="overview"
        items={[
          { key: 'overview', label: '概览', children: overview },
          {
            key: 'diff',
            label: `Diff 视图${diffQuery.isPending ? '' : ''}`,
            children: diffQuery.isError ? (
              <Alert
                type="error"
                showIcon
                message="Diff 加载失败"
                description={describeError(diffQuery.error)}
              />
            ) : diffQuery.isPending ? (
              <Card className="surface-card">
                <Skeleton active paragraph={{ rows: 12 }} />
              </Card>
            ) : (
              <Card className="surface-card" title={<CardHeading title="代码变更" />}>
                <DiffViewer diffText={diffQuery.data} findings={detail.findings} />
              </Card>
            ),
          },
          {
            key: 'findings',
            label: `发现列表 · ${detail.findings.length}`,
            children: (
              <Card className="surface-card data-table-card">
                <Table<IdentifiedFinding>
                  rowKey="id"
                  columns={buildFindingColumns(props.reviewId)}
                  dataSource={detail.findings}
                  pagination={false}
                  scroll={{ x: 1080 }}
                  locale={{
                    emptyText: (
                      <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description="这份报告没有发现需要处理的问题。"
                      />
                    ),
                  }}
                />
              </Card>
            ),
          },
        ]}
      />
    </div>
  );
}
