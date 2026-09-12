import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Card, Col, Row, Statistic, Typography } from 'antd';
import { fetchAdminOverview } from '../../api/admin';
import { describeError } from '../../parse-response';

/** 系统概览（管理后台首页）：用户规模、审查总量与缓存收益 */
export function AdminOverviewPage(): ReactElement {
  const overviewQuery = useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: fetchAdminOverview,
  });

  if (overviewQuery.isPending) {
    return <Typography.Text type="secondary">加载中…</Typography.Text>;
  }
  if (overviewQuery.isError) {
    return (
      <Alert
        type="error"
        showIcon
        message="概览数据加载失败"
        description={describeError(overviewQuery.error)}
      />
    );
  }

  const overview = overviewQuery.data;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Row gutter={[16, 16]}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="用户总数" value={overview.userCount} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="管理员数" value={overview.adminCount} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="审查总数" value={overview.totalReviews} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="发现总数" value={overview.totalFindings} />
          </Card>
        </Col>
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={12} md={8}>
          <Card size="small">
            <Statistic title="Token 消耗总量" value={overview.totalTokenUsed} />
          </Card>
        </Col>
        <Col xs={12} md={8}>
          <Card size="small">
            <Statistic title="缓存条目数" value={overview.cacheEntries} />
          </Card>
        </Col>
        <Col xs={12} md={8}>
          <Card size="small">
            <Statistic title="缓存节省 Token" value={overview.tokenSavedByCache} />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
