import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { Alert, Button, Card, Form, Input, Select, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { ReviewListItem } from '@ai-review/shared/api';
import { describeError } from '../parse-response';
import { fetchReviews } from '../api';
import { PageHeader } from '../components/PageHeader';

type ReviewFilters = {
  q?: string;
  status?: 'completed' | 'failed' | 'cancelled';
  mode?: 'fast' | 'full';
  severity?: 'BLOCKER' | 'WARNING' | 'NIT';
};

function buildColumns(onOpen: (reviewId: string) => void): ColumnsType<ReviewListItem> {
  return [
    {
      title: '审查 ID',
      dataIndex: 'reviewId',
      render: (reviewId: string) => (
        <Typography.Link onClick={() => onOpen(reviewId)}>
          <Typography.Text code>{reviewId}</Typography.Text>
        </Typography.Link>
      ),
    },
    { title: '仓库', dataIndex: 'repoPath', ellipsis: true },
    { title: '分支', dataIndex: 'branch', width: 110 },
    {
      title: '模式',
      dataIndex: 'mode',
      width: 100,
      render: (mode: string) => (
        <Tag color={mode === 'full' ? 'purple' : 'cyan'}>{mode === 'full' ? 'FULL' : 'FAST'}</Tag>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
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
          <span style={{ color: '#9aa4b5', fontWeight: 500 }}> /100</span>
        </span>
      ),
    },
    {
      title: '发现',
      dataIndex: 'blockerCount',
      width: 220,
      render: (blockerCount: number, record) => (
        <>
          {blockerCount > 0 ? <Tag color="error">BLOCKER {blockerCount}</Tag> : null}
          {record.warningCount > 0 ? (
            <Tag color="warning">WARNING {record.warningCount}</Tag>
          ) : null}
          {record.nitCount > 0 ? <Tag color="processing">NIT {record.nitCount}</Tag> : null}
          {record.totalFindings === 0 ? <Tag color="success">无发现</Tag> : null}
        </>
      ),
    },
    {
      title: '耗时',
      dataIndex: 'durationMs',
      width: 90,
      render: (durationMs: number) => `${(durationMs / 1000).toFixed(1)}s`,
    },
    { title: '时间', dataIndex: 'createdAt', width: 180 },
  ];
}

export function ReviewListView(props: { onOpen: (reviewId: string) => void }): ReactElement {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<ReviewFilters>({});
  const [form] = Form.useForm<ReviewFilters>();
  const reviewsQuery = useQuery({
    queryKey: ['reviews', filters],
    queryFn: () => fetchReviews({ ...filters, pageSize: 100 }),
  });
  if (reviewsQuery.isPending) return <div className="empty-copy">正在加载审查历史…</div>;
  if (reviewsQuery.isError)
    return (
      <Alert
        type="error"
        showIcon
        message="审查历史加载失败"
        description={describeError(reviewsQuery.error)}
      />
    );
  const clearFilters = (): void => {
    form.resetFields();
    setFilters({});
  };
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Review history"
        title="审查历史"
        description="集中查看所有审查任务、风险分数与发现分布，快速定位需要跟进的报告。"
        actions={
          <Button type="primary" onClick={() => void navigate({ to: '/run' })}>
            发起审查 →
          </Button>
        }
      />
      <Card
        className="surface-card review-filter-card"
        title={<Typography.Text strong>筛选审查记录</Typography.Text>}
      >
        <Form<ReviewFilters>
          form={form}
          layout="inline"
          onFinish={(values) =>
            setFilters({
              ...Object.fromEntries(
                Object.entries(values).filter(([, value]) => value !== undefined && value !== ''),
              ),
              q: values.q?.trim() || undefined,
            } as ReviewFilters)
          }
        >
          <Form.Item name="q">
            <Input allowClear placeholder="搜索仓库、分支或审查 ID" style={{ width: 280 }} />
          </Form.Item>
          <Form.Item name="status">
            <Select
              allowClear
              placeholder="状态"
              style={{ width: 130 }}
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
              style={{ width: 120 }}
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
              style={{ width: 130 }}
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
        <Table<ReviewListItem>
          rowKey="reviewId"
          columns={buildColumns(props.onOpen)}
          dataSource={reviewsQuery.data}
          pagination={{ pageSize: 15, showSizeChanger: false }}
          scroll={{ x: 1050 }}
        />
      </Card>
    </div>
  );
}
