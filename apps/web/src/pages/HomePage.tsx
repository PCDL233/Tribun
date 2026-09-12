import { useNavigate } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRightOutlined, BarChartOutlined, HistoryOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { Button, Card, Col, Row, Space, Statistic, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { ReviewListItem } from '@ai-review/shared/api';
import { fetchReviews, fetchStats } from '../api';
import { describeError } from '../parse-response';
import { useAuth } from '../hooks/use-auth';
import { CardHeading, PageHeader } from '../components/PageHeader';

function formatCount(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value);
}

export function HomePage(): ReactElement {
  const { user } = useAuth();
  const navigate = useNavigate();
  const statsQuery = useQuery({ queryKey: ['stats'], queryFn: () => fetchStats() });
  const reviewsQuery = useQuery({ queryKey: ['reviews'], queryFn: () => fetchReviews() });

  const recentColumns: ColumnsType<ReviewListItem> = [
    {
      title: '审查 ID',
      dataIndex: 'reviewId',
      render: (reviewId: string) => (
        <Typography.Link
          onClick={() => void navigate({ to: '/reviews/$reviewId', params: { reviewId } })}
        >
          <Typography.Text code>{reviewId}</Typography.Text>
        </Typography.Link>
      ),
    },
    { title: '仓库', dataIndex: 'repoPath', ellipsis: true },
    {
      title: '风险评分',
      dataIndex: 'riskScore',
      width: 110,
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
      width: 130,
      render: (blockerCount: number) =>
        blockerCount > 0 ? (
          <Tag color="error">BLOCKER {blockerCount}</Tag>
        ) : (
          <Tag color="success">无阻断</Tag>
        ),
    },
    { title: '时间', dataIndex: 'createdAt', width: 180 },
  ];

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Workspace"
        title="工作台"
        description="查看团队审查概况，发起新的代码审查，或继续跟进最近的风险发现。"
        actions={<Button type="primary" icon={<PlayCircleOutlined />} onClick={() => void navigate({ to: '/run' })}>发起审查</Button>}
      />

      <Card className="surface-card welcome-card">
        <div>
          <Typography.Title level={3} className="welcome-title">欢迎回来，{user?.username ?? '当前用户'}</Typography.Title>
          <Typography.Paragraph className="welcome-description">
            通过统一的 Diff、静态分析和模型审查结果，在合并前快速确认代码质量。
          </Typography.Paragraph>
          <Space wrap>
            <Button type="primary" onClick={() => void navigate({ to: '/run' })}>开始审查</Button>
            <Button onClick={() => void navigate({ to: '/reviews' })}>查看历史报告</Button>
          </Space>
        </div>
        <div className="welcome-summary">
          <Statistic title="累计审查" value={statsQuery.data?.totalReviews ?? 0} loading={statsQuery.isPending} />
          <Typography.Text type="secondary">持续积累可追踪的质量数据</Typography.Text>
        </div>
      </Card>

      {statsQuery.isError ? (
        <Card className="surface-card">
          <Typography.Text type="danger">
            统计数据加载失败：{describeError(statsQuery.error)}
          </Typography.Text>
        </Card>
      ) : (
        <Row gutter={[16, 16]}>
          <Col xs={12} lg={6}>
            <Card className="surface-card stat-card accent-blue">
              <Statistic
                title="审查总数"
                value={statsQuery.data?.totalReviews ?? 0}
                loading={statsQuery.isPending}
              />
              <div className="stat-caption">累计完成的审查任务</div>
            </Card>
          </Col>
          <Col xs={12} lg={6}>
            <Card className="surface-card stat-card accent-teal">
              <Statistic
                title="发现总数"
                value={statsQuery.data?.totalFindings ?? 0}
                loading={statsQuery.isPending}
              />
              <div className="stat-caption">覆盖多个风险等级</div>
            </Card>
          </Col>
          <Col xs={12} lg={6}>
            <Card className="surface-card stat-card accent-orange">
              <Statistic
                title="平均风险分"
                value={statsQuery.data?.avgRiskScore ?? 0}
                precision={1}
                suffix="/100"
                loading={statsQuery.isPending}
              />
              <div className="stat-caption">分数越低代表越稳健</div>
            </Card>
          </Col>
          <Col xs={12} lg={6}>
            <Card className="surface-card stat-card accent-blue">
              <Statistic
                title="Token 消耗"
                value={statsQuery.data?.totalTokenUsed ?? 0}
                formatter={(value) => formatCount(Number(value))}
                loading={statsQuery.isPending}
              />
              <div className="stat-caption">AI 审查资源使用量</div>
            </Card>
          </Col>
        </Row>
      )}

      <Card className="surface-card" title={<CardHeading title="常用操作" />}>
        <Row gutter={[12, 12]}>
          <Col xs={24} md={8}>
            <Button block icon={<PlayCircleOutlined />} onClick={() => void navigate({ to: '/run' })}>
              发起一次新审查
            </Button>
          </Col>
          <Col xs={24} md={8}>
            <Button block icon={<HistoryOutlined />} onClick={() => void navigate({ to: '/reviews' })}>
              浏览历史报告
            </Button>
          </Col>
          <Col xs={24} md={8}>
            <Button block icon={<BarChartOutlined />} onClick={() => void navigate({ to: '/stats' })}>
              查看统计分析
            </Button>
          </Col>
        </Row>
      </Card>

      <Card
        className="surface-card data-table-card"
        title={<CardHeading title="最近审查" />}
        extra={
          <Button type="link" icon={<ArrowRightOutlined />} onClick={() => void navigate({ to: '/reviews' })}>
            查看全部
          </Button>
        }
      >
        <Table<ReviewListItem>
          rowKey="reviewId"
          columns={recentColumns}
          dataSource={reviewsQuery.data?.slice(0, 5) ?? []}
          loading={reviewsQuery.isPending}
          pagination={false}
          scroll={{ x: 680 }}
          locale={{
            emptyText: <div className="empty-copy">还没有审查记录，从一次新审查开始吧。</div>,
          }}
        />
      </Card>
    </div>
  );
}
