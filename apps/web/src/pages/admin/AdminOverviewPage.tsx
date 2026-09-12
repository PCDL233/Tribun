import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Card, Col, Empty, List, Progress, Row, Skeleton, Statistic, Tag, Typography } from 'antd';
import { fetchAdminOverview } from '../../api/admin';
import { describeError } from '../../parse-response';
import { CardHeading, PageHeader } from '../../components/PageHeader';

export function AdminOverviewPage(): ReactElement {
  const overviewQuery = useQuery({ queryKey: ['admin', 'overview'], queryFn: fetchAdminOverview });
  if (overviewQuery.isPending) return <Card className="surface-card"><Skeleton active paragraph={{ rows: 6 }} /></Card>;
  if (overviewQuery.isError)
    return (
      <Alert
        type="error"
        showIcon
        message="概览数据加载失败"
        description={describeError(overviewQuery.error)}
      />
    );
  const overview = overviewQuery.data;
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Admin overview"
        title="系统概览"
        description="从用户规模、审查吞吐与缓存效率三个维度了解平台运行状态。"
      />
      <Row gutter={[16, 16]}>
        <Col xs={12} md={6}>
          <Card className="surface-card stat-card accent-blue">
            <Statistic title="用户总数" value={overview.userCount} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card className="surface-card stat-card accent-orange">
            <Statistic title="管理员数" value={overview.adminCount} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card className="surface-card stat-card accent-teal">
            <Statistic title="审查总数" value={overview.totalReviews} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card className="surface-card stat-card accent-blue">
            <Statistic title="发现总数" value={overview.totalFindings} />
          </Card>
        </Col>
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card className="surface-card" title={<CardHeading title="运行健康度" />}>
            <Row gutter={[16, 16]}>
              <Col xs={12}>
                <Statistic title="失败率" value={overview.failureRate * 100} precision={1} suffix="%" />
              </Col>
              <Col xs={12}>
                <Statistic title="近 7 日审查" value={overview.riskTrend.reduce((sum, point) => sum + point.reviews, 0)} />
              </Col>
            </Row>
            <Typography.Paragraph type="secondary" style={{ margin: '20px 0 8px' }}>
              近 7 日平均风险分
            </Typography.Paragraph>
            {overview.riskTrend.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无趋势数据" /> : overview.riskTrend.map((point) => (
              <div key={point.date} className="admin-trend-row">
                <Typography.Text type="secondary">{point.date}</Typography.Text>
                <Progress percent={Math.round(point.avgRiskScore)} size="small" showInfo />
              </div>
            ))}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card className="surface-card" title={<CardHeading title="最近失败审查" />}>
            {overview.recentFailures.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无失败记录" /> : (
              <List
                size="small"
                dataSource={overview.recentFailures}
                renderItem={(failure) => (
                  <List.Item>
                    <List.Item.Meta
                      title={<Typography.Text code>{failure.reviewId}</Typography.Text>}
                      description={<Typography.Text type="secondary" ellipsis={{ tooltip: failure.errorMessage ?? '未记录失败原因' }}>{failure.errorMessage ?? '未记录失败原因'}</Typography.Text>}
                    />
                    <Tag color="error">失败</Tag>
                  </List.Item>
                )}
              />
            )}
          </Card>
        </Col>
      </Row>
      <Card className="surface-card" title={<CardHeading title="资源与缓存" />}>
        <Row gutter={[16, 16]}>
          <Col xs={24} md={8}>
            <Statistic title="Token 消耗总量" value={overview.totalTokenUsed} />
          </Col>
          <Col xs={24} md={8}>
            <Statistic title="缓存条目数" value={overview.cacheEntries} />
          </Col>
          <Col xs={24} md={8}>
            <Statistic title="缓存节省 Token" value={overview.tokenSavedByCache} />
          </Col>
        </Row>
        <Typography.Paragraph type="secondary" style={{ margin: '24px 0 0' }}>
          缓存命中可以减少重复分析成本，同时加快团队常见路径的反馈速度。
        </Typography.Paragraph>
      </Card>
    </div>
  );
}
