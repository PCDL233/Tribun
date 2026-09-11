import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { Alert, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { ReviewListItem } from '@ai-review/shared/api';
import { describeError } from '../parse-response';
import { fetchReviews } from '../api';

function buildColumns(onOpen: (reviewId: string) => void): ColumnsType<ReviewListItem> {
  return [
    {
      title: '审查 ID',
      dataIndex: 'reviewId',
      render: (reviewId: string) => (
        <Typography.Link onClick={() => onOpen(reviewId)}>{reviewId}</Typography.Link>
      ),
    },
    { title: '仓库', dataIndex: 'repoPath', ellipsis: true },
    { title: '分支', dataIndex: 'branch', width: 110 },
    { title: '模式', dataIndex: 'mode', width: 72 },
    {
      title: '风险评分',
      dataIndex: 'riskScore',
      width: 96,
      sorter: (a, b) => a.riskScore - b.riskScore,
      render: (riskScore: number) => `${riskScore}/100`,
    },
    {
      title: '发现',
      dataIndex: 'blockerCount',
      width: 200,
      render: (blockerCount: number, record) => (
        <>
          {blockerCount > 0 ? <Tag color="red">BLOCKER {blockerCount}</Tag> : null}
          {record.warningCount > 0 ? <Tag color="orange">WARNING {record.warningCount}</Tag> : null}
          {record.nitCount > 0 ? <Tag color="blue">NIT {record.nitCount}</Tag> : null}
          {record.totalFindings === 0 ? <Tag color="green">无发现</Tag> : null}
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

export type ReviewListViewProps = {
  onOpen: (reviewId: string) => void;
};

/** 审查历史列表（方案 3.10 页面 1） */
export function ReviewListView(props: ReviewListViewProps): ReactElement {
  const reviewsQuery = useQuery({ queryKey: ['reviews'], queryFn: fetchReviews });

  if (reviewsQuery.isPending) return <Typography.Text type="secondary">加载中…</Typography.Text>;
  if (reviewsQuery.isError) {
    return (
      <Alert
        type="error"
        showIcon
        message="审查历史加载失败"
        description={describeError(reviewsQuery.error)}
      />
    );
  }

  return (
    <Table<ReviewListItem>
      rowKey="reviewId"
      size="small"
      columns={buildColumns(props.onOpen)}
      dataSource={reviewsQuery.data}
      pagination={{ pageSize: 15 }}
    />
  );
}
