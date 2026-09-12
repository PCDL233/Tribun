import { useNavigate } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Col, Row, Statistic, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { ReviewListItem } from '@ai-review/shared/api';
import { fetchReviews, fetchStats } from '../api';
import { describeError } from '../parse-response';
import { useAuth } from '../hooks/use-auth';
import { CardHeading } from '../components/PageHeader';

function formatCount(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value);
}

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
          <span style={{ color: '#9aa4b5', fontWeight: 500 }}> /100</span>
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
      <section className="dashboard-hero">
        <div className="hero-content">
          <div className="hero-eyebrow">Good to see you, {user?.username ?? 'there'}</div>
          <h1 className="hero-title">
            让每一次提交，
            <br />
            都更有把握。
          </h1>
          <p className="hero-description">
            用 AI 快速识别风险、聚合团队洞察，在代码进入主分支前，把真正重要的问题提前暴露出来。
          </p>
          <div className="hero-actions">
            <Button type="primary" onClick={() => void navigate({ to: '/run' })}>
              开始一次审查 →
            </Button>
            <Button onClick={() => void navigate({ to: '/reviews' })}>查看历史报告</Button>
          </div>
        </div>
        <div className="hero-signal">
          <div className="hero-signal-label">本月审查完成度</div>
          <div className="hero-signal-value">
            {statsQuery.data ? `${Math.min(statsQuery.data.totalReviews, 999)}` : '—'}{' '}
            <span style={{ fontSize: 12, fontWeight: 500, color: '#aab0ff' }}>次</span>
          </div>
          <div className="hero-signal-bar" />
          <div style={{ marginTop: 8, color: 'rgba(255,255,255,.46)', fontSize: 11 }}>
            持续积累团队质量数据
          </div>
        </div>
      </section>

      {statsQuery.isError ? (
        <Card className="surface-card">
          <Typography.Text type="danger">
            统计数据加载失败：{describeError(statsQuery.error)}
          </Typography.Text>
        </Card>
      ) : (
        <Row gutter={[16, 16]}>
          <Col xs={12} lg={6}>
            <Card className="surface-card stat-card accent-purple">
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

      <section>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 14,
            gap: 12,
          }}
        >
          <div>
            <div className="page-eyebrow" style={{ marginBottom: 4 }}>
              Stay in the loop
            </div>
            <Typography.Title level={4} style={{ margin: 0, letterSpacing: '-.03em' }}>
              快速入口
            </Typography.Title>
          </div>
        </div>
        <div className="quick-grid">
          <div className="quick-link" onClick={() => void navigate({ to: '/run' })}>
            <div>
              <div className="quick-link-title">发起一次新审查</div>
              <div className="quick-link-copy">输入仓库路径，实时查看分析进度</div>
            </div>
            <span className="quick-link-arrow">↗</span>
          </div>
          <div className="quick-link" onClick={() => void navigate({ to: '/reviews' })}>
            <div>
              <div className="quick-link-title">浏览历史报告</div>
              <div className="quick-link-copy">按风险评分回看团队质量趋势</div>
            </div>
            <span className="quick-link-arrow">↗</span>
          </div>
          <div className="quick-link" onClick={() => void navigate({ to: '/stats' })}>
            <div>
              <div className="quick-link-title">查看统计分析</div>
              <div className="quick-link-copy">定位高风险文件与成本变化</div>
            </div>
            <span className="quick-link-arrow">↗</span>
          </div>
        </div>
      </section>

      <Card
        className="surface-card data-table-card"
        title={<CardHeading title="最近审查" />}
        extra={
          <Button type="link" onClick={() => void navigate({ to: '/reviews' })}>
            查看全部 →
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
