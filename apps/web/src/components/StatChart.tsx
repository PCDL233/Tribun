import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';

// 按需注册（方案 3.10：控制 echarts 体积，替代全量 import）
echarts.use([LineChart, BarChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

export type StatChartProps = {
  option: EChartsCoreOption;
  /** 画布高度（px），默认 320 */
  height?: number;
};

/** ECharts 画布封装：负责实例生命周期与容器自适应，图表配置由调用方声明 */
export function StatChart(props: StatChartProps): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;

    const chart = echarts.init(container);
    chart.setOption(props.option);
    const resize = (): void => chart.resize();
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      chart.dispose();
    };
  });

  return <div ref={containerRef} style={{ width: '100%', height: props.height ?? 320 }} />;
}
