import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { Alert, Card, Col, Empty, Row, Segmented, Skeleton, Statistic, Typography } from 'antd';
import type { EChartsCoreOption } from 'echarts/core';
import type { ReviewStats } from '@ai-review/shared/api';
import { fetchStats } from '../api';
import { describeError } from '../parse-response';
import { StatChart } from '../components/StatChart';
import { CardHeading, PageHeader } from '../components/PageHeader';

const SEVERITY_COLORS: Record<string, string> = {
  BLOCKER: '#cf1322',
  WARNING: '#d46b08',
  NIT: '#1677ff',
  PRAISE: '#389e0d',
};
const chartText = {
  color: '#64748b',
  fontFamily: 'Inter, PingFang SC, Microsoft YaHei, sans-serif',
  fontSize: 12,
};
const axisLine = { lineStyle: { color: '#e2e8f0' } };
const splitLine = { lineStyle: { color: '#eef1f6', type: 'dashed' as const } };
const tooltipBase = {
  backgroundColor: 'rgba(255,255,255,0.96)',
  borderColor: '#e2e8f0',
  borderWidth: 1,
  padding: [10, 14] as [number, number],
  textStyle: { color: '#0f172a', fontFamily: chartText.fontFamily, fontSize: 12 },
  extraCssText: 'box-shadow: 0 8px 24px rgba(15,23,42,.12); border-radius: 10px;',
};
const legendBase = { textStyle: chartText, icon: 'roundRect', itemWidth: 10, itemHeight: 10 };

function lineAreaGradient(color: string): Record<string, unknown> {
  return {
    type: 'linear' as const,
    x: 0,
    y: 0,
    x2: 0,
    y2: 1,
    colorStops: [
      { offset: 0, color: color + '40' },
      { offset: 1, color: color + '00' },
    ],
  };
}

function buildTrendOption(stats: ReviewStats): EChartsCoreOption {
  return {
    color: ['#4f46e5', '#14b8a6'],
    tooltip: { ...tooltipBase, trigger: 'axis' },
    legend: { ...legendBase, top: 0, data: ['平均风险分', '审查次数'] },
    grid: { left: 14, right: 18, top: 64, bottom: 12, containLabel: true },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: stats.riskTrend.map((point) => point.date),
      axisLine,
      axisTick: { show: false },
      axisLabel: chartText,
    },
    yAxis: [
      { type: 'value', max: 100, splitLine, axisLabel: chartText, axisLine: { show: false } },
      {
        type: 'value',
        splitLine: { show: false },
        axisLabel: chartText,
        axisLine: { show: false },
      },
    ],
    series: [
      {
        name: '平均风险分',
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 6,
        showSymbol: false,
        lineStyle: { width: 3 },
        itemStyle: { color: '#4f46e5' },
        areaStyle: { color: lineAreaGradient('#4f46e5') },
        data: stats.riskTrend.map((point) => point.avgRiskScore),
      },
      {
        name: '审查次数',
        type: 'bar',
        yAxisIndex: 1,
        barWidth: 14,
        itemStyle: { color: '#14b8a6', borderRadius: [6, 6, 0, 0] },
        data: stats.riskTrend.map((point) => point.reviews),
      },
    ],
  };
}

function buildSeverityOption(stats: ReviewStats): EChartsCoreOption {
  return {
    tooltip: { ...tooltipBase, trigger: 'axis' },
    grid: { left: 16, right: 16, top: 22, bottom: 18, containLabel: true },
    xAxis: {
      type: 'category',
      data: stats.severityDistribution.map((item) => item.severity),
      axisLine,
      axisTick: { show: false },
      axisLabel: chartText,
    },
    yAxis: { type: 'value', splitLine, axisLabel: chartText, axisLine: { show: false } },
    series: [
      {
        type: 'bar',
        barWidth: 36,
        data: stats.severityDistribution.map((item) => ({
          value: item.count,
          itemStyle: {
            color: SEVERITY_COLORS[item.severity],
            borderRadius: [8, 8, 0, 0],
            shadowColor: SEVERITY_COLORS[item.severity] + '55',
            shadowBlur: 8,
            shadowOffsetY: 3,
          },
        })),
      },
    ],
  };
}

function buildAgentOption(stats: ReviewStats): EChartsCoreOption {
  return {
    tooltip: { ...tooltipBase, trigger: 'axis' },
    grid: { left: 18, right: 18, top: 22, bottom: 18, containLabel: true },
    xAxis: {
      type: 'category',
      data: stats.agentDistribution.map((item) => item.agent),
      axisLine,
      axisTick: { show: false },
      axisLabel: chartText,
    },
    yAxis: { type: 'value', splitLine, axisLabel: chartText, axisLine: { show: false } },
    series: [
      {
        type: 'bar',
        barWidth: 30,
        itemStyle: { color: '#4f46e5', borderRadius: [6, 6, 0, 0] },
        data: stats.agentDistribution.map((item) => item.count),
      },
    ],
  };
}

function buildTokenOption(stats: ReviewStats): EChartsCoreOption {
  return {
    tooltip: { ...tooltipBase, trigger: 'axis' },
    grid: { left: 18, right: 18, top: 22, bottom: 18, containLabel: true },
    xAxis: {
      type: 'category',
      data: stats.tokenTrend.map((item) => item.date),
      axisLine,
      axisTick: { show: false },
      axisLabel: chartText,
    },
    yAxis: { type: 'value', splitLine, axisLabel: chartText, axisLine: { show: false } },
    series: [
      {
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 6,
        itemStyle: { color: '#14b8a6' },
        lineStyle: { color: '#14b8a6', width: 2.5 },
        areaStyle: { color: lineAreaGradient('#14b8a6') },
        data: stats.tokenTrend.map((item) => item.tokenUsed),
      },
    ],
  };
}

function buildRiskyFilesOption(stats: ReviewStats): EChartsCoreOption {
  const files = [...stats.topRiskyFiles].reverse();
  return {
    tooltip: { ...tooltipBase, trigger: 'axis' },
    legend: { ...legendBase, top: 0, data: ['发现数', 'BLOCKER'] },
    grid: { left: 8, right: 18, top: 64, bottom: 8, containLabel: true },
    xAxis: { type: 'value', splitLine, axisLabel: chartText, axisLine: { show: false } },
    yAxis: {
      type: 'category',
      data: files.map((file) => file.filePath),
      axisLine,
      axisTick: { show: false },
      axisLabel: { ...chartText, width: 120, overflow: 'truncate' },
    },
    series: [
      {
        name: '发现数',
        type: 'bar',
        itemStyle: { color: '#a5b4fc', borderRadius: [0, 6, 6, 0] },
        data: files.map((file) => file.findingCount),
      },
      {
        name: 'BLOCKER',
        type: 'bar',
        itemStyle: { color: '#f87171', borderRadius: [0, 6, 6, 0] },
        data: files.map((file) => file.blockerCount),
      },
    ],
  };
}

type SummaryCard = {
  title: string;
  value: number;
  precision?: number;
  suffix?: string;
  accent: string;
};
function buildSummaryCards(stats: ReviewStats): SummaryCard[] {
  return [
    { title: '审查总数', value: stats.totalReviews, accent: 'accent-blue' },
    { title: '发现总数', value: stats.totalFindings, accent: 'accent-teal' },
    { title: '误报标记', value: stats.falsePositiveCount, accent: 'accent-orange' },
    {
      title: '平均风险分',
      value: stats.avgRiskScore,
      precision: 1,
      suffix: '/100',
      accent: 'accent-blue',
    },
    {
      title: '平均耗时',
      value: stats.avgDurationMs / 1000,
      precision: 1,
      suffix: 's',
      accent: 'accent-blue',
    },
    { title: 'Token 消耗', value: stats.totalTokenUsed, accent: 'accent-teal' },
  ];
}

type RangeKey = '7d' | '30d' | 'all';

function getRange(key: RangeKey): { from?: string; to?: string } {
  if (key === 'all') return {};
  const today = new Date();
  const from = new Date(today);
  from.setDate(today.getDate() - (key === '7d' ? 6 : 29));
  return { from: from.toISOString().slice(0, 10), to: today.toISOString().slice(0, 10) };
}

export function StatisticsView(): ReactElement {
  const [range, setRange] = useState<RangeKey>('7d');
  const statsQuery = useQuery({
    queryKey: ['stats', range],
    queryFn: () => fetchStats(getRange(range)),
  });
  if (statsQuery.isPending)
    return (
      <div className="page-stack">
        <Skeleton active paragraph={{ rows: 2 }} />
        <Row gutter={[16, 16]}>
          {[1, 2, 3, 4].map((item) => (
            <Col key={item} xs={12} md={6}>
              <Card className="surface-card">
                <Skeleton active paragraph={{ rows: 2 }} />
              </Card>
            </Col>
          ))}
        </Row>
        <Card className="surface-card">
          <Skeleton active paragraph={{ rows: 8 }} />
        </Card>
      </div>
    );
  if (statsQuery.isError)
    return (
      <Alert
        type="error"
        showIcon
        message="统计数据加载失败"
        description={describeError(statsQuery.error)}
      />
    );
  const stats = statsQuery.data;
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Team insights"
        title="统计分析"
        description="用趋势和分布图快速了解团队的代码风险、审查效率与资源消耗。"
        extra={
          <Segmented
            value={range}
            onChange={(value) => setRange(value as RangeKey)}
            options={[
              { label: '近 7 天', value: '7d' },
              { label: '近 30 天', value: '30d' },
              { label: '全部', value: 'all' },
            ]}
          />
        }
      />
      <Row gutter={[16, 16]}>
        {buildSummaryCards(stats).map((card) => (
          <Col key={card.title} xs={12} md={8} lg={4}>
            <Card className={`surface-card stat-card ${card.accent}`}>
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
      <Card
        className="surface-card"
        title={<CardHeading title="风险分趋势" />}
        extra={<Typography.Text type="secondary">按日统计</Typography.Text>}
      >
        <StatChart option={buildTrendOption(stats)} />
      </Card>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card className="surface-card" title={<CardHeading title="严重度分布" />}>
            {stats.totalFindings === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无发现" />
            ) : (
              <StatChart option={buildSeverityOption(stats)} height={280} />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card className="surface-card" title={<CardHeading title="Agent 命中分布" />}>
            {stats.agentDistribution.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无发现" />
            ) : (
              <StatChart option={buildAgentOption(stats)} height={280} />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card className="surface-card" title={<CardHeading title="Token 成本趋势" />}>
            {stats.tokenTrend.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无消耗" />
            ) : (
              <StatChart option={buildTokenOption(stats)} height={280} />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card className="surface-card" title={<CardHeading title="Top 高风险文件" />}>
            {stats.topRiskyFiles.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无高风险文件" />
            ) : (
              <StatChart option={buildRiskyFilesOption(stats)} height={280} />
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
