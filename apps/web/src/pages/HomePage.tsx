import { useNavigate } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Row, Statistic, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { ReviewListItem } from '@ai-review/shared/api';
import { fetchReviews, fetchStats } from '../api';
import { describeError } from '../parse-response';
import { useAuth } from '../hooks/use-auth';

/** 首页 Dashboard：统计概览 + 最近审查 + 快捷入口 */
export function HomePage(): ReactElement {
  const { user } = useAuth();
  const navigate = useNavigate();
  const statsQuery = useQuery({ queryKey: ['stats'], queryFn: fetchStats });
  const reviewsQuery = useQuery({ queryKey: ['reviews'], queryFn: () => fetchReviews() });

  const recentColumns: ColumnsType<ReviewListItem> = [
    {
      title: '审查 ID',
      dataIndex: 'reviewId',
      render: (reviewId: string) => (
        <Typography.Link onClick={() => void navigate({ to: '/reviews/$reviewId', params: { reviewId } })}>
          {reviewId}
        </Typography.Link>
      ),
    },
    { title: '仓库', dataIndex: 'repoPath', ellipsis: true },
    {
      title: '风险评分',
      dataIndex: 'riskScore',
      width: 96,
      render: (riskScore: number) => `${riskScore}/100`,
    },
    {
      title: '发现',
      dataIndex: 'blockerCount',
      width: 140,
      render: (blockerCount: number) =>
        blockerCount > 0 ? <Tag color="red">BLOCKER {blockerCount}</Tag> : <Tag color="green">无阻断</Tag>,
    },
    { title: '时间', dataIndex: 'createdAt', width: 180 },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card size="small">
        <Typography.Title level={4} style={{ marginTop: 0 }}>
          你好，{user?.username}
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          在这里发起代码审查、查看历史报告与统计分析；提交前也可继续使用 CLI（ai-review run）完成快审。
        </Typography.Paragraph>
      </Card>

      {statsQuery.isError ? (
        <Alert type="error" showIcon message="统计数据加载失败" description={describeError(statsQuery.error)} />
      ) : (
        <Row gutter={[16, 16]}>
          <Col xs={12} md={6}>
            <Card size="small">
              <Statistic title="审查总数" value={statsQuery.data?.totalReviews ?? 0} loading={statsQuery.isPending} />
            </Card>
          </Col>
          <Col xs={12} md={6}>
            <Card size="small">
              <Statistic title="发现总数" value={statsQuery.data?.totalFindings ?? 0} loading={statsQuery.isPending} />
            </Card>
          </Col>
          <Col xs={12} md={6}>
            <Card size="small">
              <Statistic
                title="平均风险分"
                value={statsQuery.data?.avgRiskScore ?? 0}
                precision={1}
                suffix="/100"
                loading={statsQuery.isPending}
              />
            </Card>
          </Col>
          <Col xs={12} md={6}>
            <Card size="small">
              <Statistic
                title="Token 消耗"
                value={statsQuery.data?.totalTokenUsed ?? 0}
                loading={statsQuery.isPending}
              />
            </Card>
          </Col>
        </Row>
      )}

      <Card
        size="small"
        title="最近审查"
        extra={
          <Button type="primary" size="small" onClick={() => void navigate({ to: '/run' })}>
            发起审查
          </Button>
        }
      >
        <Table<ReviewListItem>
          rowKey="reviewId"
          size="small"
          loading={reviewsQuery.isPending}
          columns={recentColumns}
          dataSource={reviewsQuery.data?.slice(0, 5) ?? []}
          pagination={false}
        />
      </Card>
    </div>
  );
}
