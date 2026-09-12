import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { Alert, Card, Col, Row, Statistic, Typography } from 'antd';
import type { EChartsCoreOption } from 'echarts/core';
import type { ReviewStats } from '@ai-review/shared/api';
import { fetchStats } from '../api';
import { describeError } from '../parse-response';
import { StatChart } from '../components/StatChart';

/** 严重度 → 图表颜色（与列表页 Tag 配色一致） */
const SEVERITY_COLORS: Record<string, string> = {
  BLOCKER: '#cf1322',
  WARNING: '#d46b08',
  NIT: '#1677ff',
  PRAISE: '#389e0d',
};

function buildTrendOption(stats: ReviewStats): EChartsCoreOption {
  return {
    tooltip: { trigger: 'axis' },
    legend: { data: ['平均风险分', '审查次数'] },
    xAxis: { type: 'category', data: stats.riskTrend.map((point) => point.date) },
    yAxis: [{ type: 'value', max: 100 }, { type: 'value' }],
    series: [
      {
        name: '平均风险分',
        type: 'line',
        smooth: true,
        data: stats.riskTrend.map((point) => point.avgRiskScore),
      },
      {
        name: '审查次数',
        type: 'bar',
        yAxisIndex: 1,
        data: stats.riskTrend.map((point) => point.reviews),
      },
    ],
  };
}

function buildSeverityOption(stats: ReviewStats): EChartsCoreOption {
  return {
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: stats.severityDistribution.map((item) => item.severity),
    },
    yAxis: { type: 'value' },
    series: [
      {
        type: 'bar',
        data: stats.severityDistribution.map((item) => ({
          value: item.count,
          itemStyle: { color: SEVERITY_COLORS[item.severity] },
        })),
      },
    ],
  };
}

function buildRiskyFilesOption(stats: ReviewStats): EChartsCoreOption {
  const files = [...stats.topRiskyFiles].reverse(); // 横向条形图自下而上，反转使最高项在最上
  return {
    tooltip: { trigger: 'axis' },
    legend: { data: ['发现数', 'BLOCKER'] },
    grid: { containLabel: true },
    xAxis: { type: 'value' },
    yAxis: { type: 'category', data: files.map((file) => file.filePath) },
    series: [
      { name: '发现数', type: 'bar', data: files.map((file) => file.findingCount) },
      { name: 'BLOCKER', type: 'bar', data: files.map((file) => file.blockerCount) },
    ],
  };
}

type SummaryCard = {
  title: string;
  value: number;
  precision?: number;
  suffix?: string;
};

function buildSummaryCards(stats: ReviewStats): SummaryCard[] {
  return [
    { title: '审查总数', value: stats.totalReviews },
    { title: '发现总数', value: stats.totalFindings },
    { title: '误报标记', value: stats.falsePositiveCount },
    { title: '平均风险分', value: stats.avgRiskScore, precision: 1, suffix: '/100' },
    { title: '平均耗时', value: stats.avgDurationMs / 1000, precision: 1, suffix: 's' },
    { title: 'Token 消耗', value: stats.totalTokenUsed },
  ];
}

/** 统计分析（方案 3.10 页面 4：风险趋势 / 严重度分布 / Top 高风险文件 / token 成本） */
export function StatisticsView(): ReactElement {
  const statsQuery = useQuery({ queryKey: ['stats'], queryFn: fetchStats });

  if (statsQuery.isPending) return <Typography.Text type="secondary">加载中…</Typography.Text>;
  if (statsQuery.isError) {
    return (
      <Alert
        type="error"
        showIcon
        message="统计数据加载失败"
        description={describeError(statsQuery.error)}
      />
    );
  }

  const stats = statsQuery.data;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Row gutter={[16, 16]}>
        {buildSummaryCards(stats).map((card) => (
          <Col key={card.title} xs={12} md={8} lg={4}>
            <Card size="small">
              {/* exactOptionalPropertyTypes 下可选 prop 用条件展开，不显式传 undefined */}
              <Statistic
                title={card.title}
                value={card.value}
                {...(card.precision !== undefined ? { precision: card.precision } : {})}
                {...(card.suffix !== undefined ? { suffix: card.suffix } : {})}
              />
            </Card>
          </Col>
        ))}
      </Row>
      <Card size="small" title="风险分趋势（按日）">
        <StatChart option={buildTrendOption(stats)} />
      </Card>
      <Row gutter={16}>
        <Col xs={24} lg={12}>
          <Card size="small" title="严重度分布">
            <StatChart option={buildSeverityOption(stats)} />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card size="small" title="Top 高风险文件">
            <StatChart option={buildRiskyFilesOption(stats)} />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
