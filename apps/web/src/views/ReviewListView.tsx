import {
  App as AntdApp,
  Button,
  Card,
  Form,
  Input,
  Popconfirm,
  Select,
  Skeleton,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { ReviewListItem } from '@ai-review/shared/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { deleteReview, fetchReviewPage, rerunReview } from '../api';
import { formatDateTime } from '../format';
import { PageHeader } from '../components/PageHeader';
import { useAuth } from '../hooks/use-auth';
import { useNotify } from '../hooks/use-notify';
import { ErrorAlert } from '../components/ErrorAlert';

type ReviewFilters = {
  q?: string;
  status?: 'completed' | 'failed' | 'cancelled';
  mode?: 'fast' | 'full';
  severity?: 'BLOCKER' | 'WARNING' | 'NIT';
  repo?: string;
  branch?: string;
};

function buildColumns(opts: {
  onOpen: (reviewId: string) => void;
  isAdmin: boolean;
  onRerun: (reviewId: string) => void;
  onDelete: (reviewId: string) => void;
}): ColumnsType<ReviewListItem> {
  return [
    {
      title: '审查 ID',
      dataIndex: 'reviewId',
      width: 230,
      render: (reviewId: string) => (
        <Typography.Link onClick={() => opts.onOpen(reviewId)}>
          <Typography.Text code style={{ whiteSpace: 'nowrap' }}>
            {reviewId}
          </Typography.Text>
        </Typography.Link>
      ),
    },
    { title: '仓库', dataIndex: 'repoPath', ellipsis: true, width: 220 },
    { title: '分支', dataIndex: 'branch', width: 130, ellipsis: true },
    {
      title: '模式',
      dataIndex: 'mode',
      width: 90,
      render: (mode: string) => (
        <Tag color={mode === 'full' ? 'blue' : 'default'}>{mode === 'full' ? 'FULL' : 'FAST'}</Tag>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (status: string) => (
        <Tag color={status === 'completed' ? 'success' : status === 'failed' ? 'error' : 'default'}>
          {status === 'completed'
            ? '已完成'
            : status === 'failed'
              ? '失败'
              : status === 'cancelled'
                ? '已取消'
                : '—'}
        </Tag>
      ),
    },
    {
      title: '风险评分',
      dataIndex: 'riskScore',
      width: 110,
      sorter: (a, b) => a.riskScore - b.riskScore,
      render: (riskScore: number) => (
        <span className="score-number">
          {riskScore}
          <span className="score-suffix"> /100</span>
        </span>
      ),
    },
    {
      title: '发现',
      dataIndex: 'blockerCount',
      width: 220,
      render: (blockerCount: number, record) => (
        <Space size={4} wrap>
          {blockerCount > 0 ? <Tag color="error">BLOCKER {blockerCount}</Tag> : null}
          {record.warningCount > 0 ? (
            <Tag color="warning">WARNING {record.warningCount}</Tag>
          ) : null}
          {record.nitCount > 0 ? <Tag color="processing">NIT {record.nitCount}</Tag> : null}
          {record.totalFindings === 0 ? <Tag color="success">无发现</Tag> : null}
        </Space>
      ),
    },
    {
      title: '耗时',
      dataIndex: 'durationMs',
      width: 90,
      render: (durationMs: number) => `${(durationMs / 1000).toFixed(1)}s`,
    },
    { title: '时间', dataIndex: 'createdAt', width: 180, render: (v: string) => formatDateTime(v) },
    ...(opts.isAdmin
      ? [
          {
            title: '操作',
            key: 'actions',
            width: 150,
            render: (_: unknown, record: ReviewListItem) => (
              <Space size={8}>
                <Typography.Link onClick={() => opts.onRerun(record.reviewId)}>
                  重新运行
                </Typography.Link>
                <Popconfirm
                  title="确认删除该审查记录？"
                  description="删除后不可恢复。"
                  onConfirm={() => opts.onDelete(record.reviewId)}
                >
                  <Typography.Link type="danger">删除</Typography.Link>
                </Popconfirm>
              </Space>
            ),
          },
        ]
      : []),
  ];
}

export function ReviewListView(props: { onOpen: (reviewId: string) => void }): ReactElement {
  const { message } = AntdApp.useApp();
  const { notifyError } = useNotify();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<ReviewFilters>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [form] = Form.useForm<ReviewFilters>();
  const reviewsQuery = useQuery({
    queryKey: ['reviews', filters, page, pageSize],
    queryFn: () => fetchReviewPage({ ...filters, page, pageSize }),
  });

  const rerunMutation = useMutation({
    mutationFn: (reviewId: string) => rerunReview(reviewId),
    onSuccess: () => {
      void message.success('已触发重新运行');
      void queryClient.invalidateQueries({ queryKey: ['reviews'] });
    },
    onError: (e) => notifyError(e, { title: '重跑失败' }),
  });
  const deleteMutation = useMutation({
    mutationFn: (reviewId: string) => deleteReview(reviewId),
    onSuccess: () => {
      void message.success('审查记录已删除');
      void queryClient.invalidateQueries({ queryKey: ['reviews'] });
    },
    onError: (e) => notifyError(e, { title: '删除失败' }),
  });

  const clearFilters = (): void => {
    form.resetFields();
    setPage(1);
    setFilters({});
  };
  const applyFilters = (values: ReviewFilters): void => {
    setPage(1);
    setFilters({
      ...Object.fromEntries(
        Object.entries(values).filter(([, value]) => value !== undefined && value !== ''),
      ),
      q: values.q?.trim() || undefined,
      repo: values.repo?.trim() || undefined,
      branch: values.branch?.trim() || undefined,
    } as ReviewFilters);
  };

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Review history"
        title="审查历史"
        description="集中查看审查任务、风险分数与发现分布，快速定位需要跟进的报告。"
        actions={
          <Button type="primary" onClick={() => void navigate({ to: '/run' })}>
            发起审查
          </Button>
        }
      />
      <Card
        className="surface-card review-filter-card"
        title={<Typography.Text strong>筛选审查记录</Typography.Text>}
      >
        <Form<ReviewFilters> form={form} layout="inline" onFinish={applyFilters}>
          <Form.Item name="q">
            <Input allowClear placeholder="搜索 ID 或仓库路径" style={{ width: 240 }} />
          </Form.Item>
          <Form.Item name="repo">
            <Input allowClear placeholder="仓库包含" style={{ width: 180 }} />
          </Form.Item>
          <Form.Item name="branch">
            <Input allowClear placeholder="分支" style={{ width: 140 }} />
          </Form.Item>
          <Form.Item name="status">
            <Select
              allowClear
              placeholder="状态"
              style={{ width: 120 }}
              options={[
                { value: 'completed', label: '已完成' },
                { value: 'failed', label: '失败' },
                { value: 'cancelled', label: '已取消' },
              ]}
            />
          </Form.Item>
          <Form.Item name="mode">
            <Select
              allowClear
              placeholder="模式"
              style={{ width: 110 }}
              options={[
                { value: 'fast', label: 'Fast' },
                { value: 'full', label: 'Full' },
              ]}
            />
          </Form.Item>
          <Form.Item name="severity">
            <Select
              allowClear
              placeholder="严重度"
              style={{ width: 120 }}
              options={[
                { value: 'BLOCKER', label: 'BLOCKER' },
                { value: 'WARNING', label: 'WARNING' },
                { value: 'NIT', label: 'NIT' },
              ]}
            />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">
                应用筛选
              </Button>
              <Button onClick={clearFilters}>重置</Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>
      <Card className="surface-card data-table-card">
        {reviewsQuery.isError ? (
          <ErrorAlert
            error={reviewsQuery.error}
            title="审查历史加载失败"
            onRetry={() => void reviewsQuery.refetch()}
          />
        ) : reviewsQuery.isPending ? (
          <Skeleton active paragraph={{ rows: 7 }} />
        ) : (
          <Table<ReviewListItem>
            rowKey="reviewId"
            columns={buildColumns({
              onOpen: props.onOpen,
              isAdmin: user?.role === 'admin',
              onRerun: (reviewId) => rerunMutation.mutate(reviewId),
              onDelete: (reviewId) => deleteMutation.mutate(reviewId),
            })}
            dataSource={reviewsQuery.data.reviews}
            loading={reviewsQuery.isFetching}
            pagination={{
              current: reviewsQuery.data.page,
              pageSize: reviewsQuery.data.pageSize,
              total: reviewsQuery.data.total,
              showSizeChanger: true,
              showTotal: (total) => `共 ${total} 条记录`,
              onChange: (nextPage, nextPageSize) => {
                setPage(nextPage);
                if (nextPageSize !== pageSize) {
                  setPageSize(nextPageSize);
                  setPage(1);
                }
              },
            }}
            scroll={{ x: 1250 }}
          />
        )}
      </Card>
    </div>
  );
}
