import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';

echarts.use([
  LineChart,
  BarChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

export type StatChartProps = { option: EChartsCoreOption; height?: number };

export function StatChart(props: StatChartProps): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const chart = echarts.init(container);
    chart.setOption(props.option);
    const resize = (): void => chart.resize();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    observer?.observe(container);
    window.addEventListener('resize', resize);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', resize);
      chart.dispose();
    };
  }, [props.option]);
  return <div ref={containerRef} style={{ width: '100%', height: props.height ?? 320 }} />;
}
