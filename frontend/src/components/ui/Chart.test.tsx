import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Chart } from './Chart';
import type { ChartDatum } from './Chart';

describe('Chart', () => {
  it('空数据给出明确空态文案且不渲染坐标系（AC-P3）', () => {
    render(<Chart data={[]} ariaLabel="band 趋势" />);
    expect(screen.getByText('尚无数据')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('全部为 NaN 时也走空态，不出现 NaN 文本', () => {
    const data: ChartDatum[] = [
      { label: '10-01', value: Number.NaN },
      { label: '10-02', value: Number.POSITIVE_INFINITY },
    ];
    const { container } = render(<Chart data={data} ariaLabel="band 趋势" />);
    expect(screen.getByText('尚无数据')).toBeInTheDocument();
    expect(container).not.toHaveTextContent('NaN');
  });

  it('自定义空态文案', () => {
    render(<Chart data={[]} ariaLabel="题型正确率" emptyText="还没有作答记录" />);
    expect(screen.getByText('还没有作答记录')).toBeInTheDocument();
  });

  it('折线模式按标签绘制一条 polyline 并带轴与刻度', () => {
    const data: ChartDatum[] = [
      { label: '10-01', value: 5.5 },
      { label: '10-02', value: 6 },
      { label: '10-03', value: 6.5 },
    ];
    render(<Chart data={data} ariaLabel="阅读 band 趋势" yDomain={[0, 9]} />);
    const svg = screen.getByRole('img', { name: '阅读 band 趋势' });
    const line = svg.querySelector('polyline');
    expect(line?.getAttribute('points')?.split(' ')).toHaveLength(3);
    expect(line?.getAttribute('stroke')).toBe('var(--accent)');
    expect(svg.querySelectorAll('text').length).toBeGreaterThan(0);
  });

  it('条形模式每个数据点一个 rect', () => {
    const data: ChartDatum[] = [
      { label: '填空', value: 7 },
      { label: '选择', value: 4 },
    ];
    const { container } = render(<Chart data={data} type="bar" ariaLabel="题型正确数" />);
    expect(container.querySelectorAll('rect')).toHaveLength(2);
  });

  it('多序列各自着色并在图例中命名', () => {
    const data: ChartDatum[] = [
      { label: '10-01', value: 6, series: '口语' },
      { label: '10-01', value: 7, series: '听力' },
      { label: '10-02', value: 6.5, series: '口语' },
      { label: '10-02', value: 7.5, series: '听力' },
    ];
    const { container } = render(<Chart data={data} ariaLabel="四科 band 趋势" yDomain={[0, 9]} />);
    expect(container.querySelectorAll('polyline')).toHaveLength(2);
    const legend = screen.getAllByRole('listitem');
    expect(legend.map((node) => node.textContent)).toEqual(['口语', '听力']);
    const strokes = Array.from(container.querySelectorAll('polyline')).map((node) =>
      node.getAttribute('stroke'),
    );
    expect(strokes).toEqual(['var(--accent)', 'var(--band-good)']);
  });

  it('颜色只引用设计变量', () => {
    const data: ChartDatum[] = [
      { label: 'a', value: 1 },
      { label: 'b', value: 2 },
    ];
    const { container } = render(<Chart data={data} ariaLabel="趋势" />);
    expect(container.innerHTML).toMatch(/var\(--accent\)/);
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
