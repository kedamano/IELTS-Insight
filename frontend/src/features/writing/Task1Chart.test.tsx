import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChartData } from '../../types/ielts';
import Task1Chart from './Task1Chart';
import { task1Bar, task1Dynamic, task1Line, task1Pie, task1Table } from './testHandlers';
import { chartViewOf } from './writingSets';

/**
 * AC-W1 / FR-W1：Task 1 图表必须由 `chart.data` 本地画出来，图例与轴标签与数据一致，
 * 五种类型都能渲染，无法识别的类型走可读回落（不是空框）。
 */

afterEach(cleanup);

function shapes(container: HTMLElement) {
  return {
    svg: container.querySelector('svg'),
    rects: container.querySelectorAll('svg rect').length,
    polylines: container.querySelectorAll('svg polyline').length,
    paths: container.querySelectorAll('svg path').length,
    texts: Array.from(container.querySelectorAll('svg text')).map((node) => node.textContent ?? ''),
  };
}

describe('Task1Chart', () => {
  it('line：轴标签来自 labels，图例来自 series.name，单位与来源注可见', () => {
    const { container } = render(<Task1Chart chart={task1Line.chart} />);
    const drawn = shapes(container);
    const view = chartViewOf(task1Line.chart);
    expect(drawn.svg).not.toBeNull();
    expect(drawn.polylines).toBe(view.series.length);
    for (const year of ['2000', '2005', '2010', '2015', '2020']) {
      expect(drawn.texts).toContain(year);
    }
    for (const series of view.series) {
      expect(screen.getByText(series.name)).toBeInTheDocument();
    }
    expect(screen.getByText('terawatt hours')).toBeInTheDocument();
    expect(screen.getByText('折线图（本地绘制）')).toBeInTheDocument();
    expect(screen.getByText(/Data invented for practice/)).toBeInTheDocument();
  });

  it('bar：四类场馆做 x 轴、两个年份做图例（labels 优先于 years）', () => {
    const { container } = render(<Task1Chart chart={task1Bar.chart} />);
    const drawn = shapes(container);
    // 4 个分组 × 2 个系列 = 8 根柱
    expect(drawn.rects).toBe(8);
    for (const venue of ['Museums', 'Cinemas', 'Sports stadiums', 'Public libraries']) {
      expect(drawn.texts).toContain(venue);
    }
    expect(screen.getByText('2005')).toBeInTheDocument();
    expect(screen.getByText('2023')).toBeInTheDocument();
    expect(screen.getByText('柱状图（本地绘制）')).toBeInTheDocument();
  });

  it('pie：后端只给 labels + 单系列时仍能出扇形，并按占比列出图例', () => {
    const { container } = render(<Task1Chart chart={task1Pie.chart} />);
    const drawn = shapes(container);
    expect(drawn.paths).toBe(5);
    for (const label of ['Car', 'Bus or tram', 'Walking', 'Bicycle', 'Rail']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // 38 / 22 / 18 / 14 / 8 直接相加即 100，占比读数应逐条对上
    expect(screen.getAllByText('8%').length).toBeGreaterThan(0);
    expect(drawn.texts).toContain('38%');
  });

  it('table：labels 当表头、series 名当行首，数值与数据一致', () => {
    render(<Task1Chart chart={task1Table.chart} />);
    const table = screen.getByRole('table');
    expect(table).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '2010' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '2020' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Engineering and technology' }) ?? screen.getByText('Engineering and technology')).toBeInTheDocument();
    expect(screen.getByText('31')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('dynamic_chart：按帧（年份）连线并标出读数', () => {
    const { container } = render(<Task1Chart chart={task1Dynamic.chart} />);
    const drawn = shapes(container);
    expect(drawn.polylines).toBe(2);
    for (const year of ['1990', '2000', '2010', '2020']) {
      expect(drawn.texts).toContain(year);
    }
    expect(drawn.texts).toContain('790');
    expect(screen.getByText('动态对比图（本地绘制）')).toBeInTheDocument();
  });

  it('未知 chart.type：明确说明降级渲染，仍然把数据画出来而不是空框（CONSTITUTION §3）', () => {
    const chart = {
      type: 'sankey_diagram',
      unit: 'per cent',
      labels: ['Flow A', 'Flow B'],
      series: [{ name: 'Input', values: [40, 60] }],
    } as unknown as ChartData;
    const { container } = render(<Task1Chart chart={chart} />);
    expect(screen.getByText(/图表类型无法识别/)).toBeInTheDocument();
    expect(screen.getByText(/已按原始数值降级为柱状图/)).toBeInTheDocument();
    expect(container.querySelectorAll('svg rect').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Flow A')).toBeInTheDocument();
    expect(screen.getByText('Input')).toBeInTheDocument();
  });

  it('缺数值时给出可读说明，不画 NaN 也不留空白', () => {
    const { container } = render(<Task1Chart chart={{ type: 'line' } as unknown as ChartData} />);
    expect(screen.getByRole('status')).toHaveTextContent('本题没有可绘图的图表数据');
    expect(container.querySelector('svg')).toBeNull();
  });
});
