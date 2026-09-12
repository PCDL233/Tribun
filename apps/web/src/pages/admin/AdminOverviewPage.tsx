import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Card, Col, Row, Statistic, Typography } from 'antd';
import { fetchAdminOverview } from '../../api/admin';
import { describeError } from '../../parse-response';
import { CardHeading, PageHeader } from '../../components/PageHeader';

export function AdminOverviewPage(): ReactElement {
  const overviewQuery = useQuery({ queryKey: ['admin', 'overview'], queryFn: fetchAdminOverview });
  if (overviewQuery.isPending) return <div className="empty-copy">正在加载系统概览…</div>;
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
          <Card className="surface-card stat-card accent-purple">
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
