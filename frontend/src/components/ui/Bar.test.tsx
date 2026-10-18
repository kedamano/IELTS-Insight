import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Bar } from './Bar';
import { Sparkline } from './Sparkline';

describe('Bar', () => {
  it('按 max 归一并输出可读的 aria 数值', () => {
    render(<Bar value={16} max={20} label="听力正确率" />);
    const meter = screen.getByRole('progressbar');
    expect(meter).toHaveAttribute('aria-valuenow', '16');
    expect(meter).toHaveAttribute('aria-valuemax', '20');
    expect(meter).toHaveAttribute('aria-valuetext', '80%');
    expect(screen.getByText('听力正确率')).toBeInTheDocument();
  });

  it('越界值夹紧到 [0, max]，负值不产生异常宽度', () => {
    render(<Bar value={120} max={100} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');

    render(<Bar value={-5} max={10} />);
    const bars = screen.getAllByRole('progressbar');
    expect(bars[1]).toHaveAttribute('aria-valuenow', '0');
    expect(bars[1].querySelectorAll('rect')[1].getAttribute('width')).toBe('0%');
  });

  it('tone 走语义变量，不自带颜色', () => {
    const { container } = render(<Bar value={5} max={10} tone="good" />);
    const rect = container.querySelectorAll('rect')[1];
    expect(rect.getAttribute('fill')).toBe('var(--band-good)');
  });

  it('自定义读数文本用于 band 显示', () => {
    render(<Bar value={7} max={9} tone="good" valueLabel="Band 7.0" />);
    expect(screen.getByText('Band 7.0')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', 'Band 7.0');
  });
});

describe('Sparkline', () => {
  it('多点序列生成等距折线且末点加圆点', () => {
    const { container } = render(<Sparkline points={[5, 6, 7]} ariaLabel="口语趋势" />);
    const svg = screen.getByRole('img', { name: '口语趋势' });
    const line = svg.querySelector('polyline');
    expect(line?.getAttribute('points')?.split(' ')).toHaveLength(3);
    expect(container.querySelectorAll('circle')).toHaveLength(1);
    expect(svg.innerHTML).not.toContain('NaN');
  });

  it('单点退化为虚线基准与居中圆点，全相同值不产生除以零的 NaN', () => {
    const single = render(<Sparkline points={[6.5]} />);
    expect(single.container.querySelector('polyline')).toBeNull();
    const baseline = single.container.querySelector('line');
    expect(baseline?.getAttribute('stroke-dasharray')).toBe('3 4');
    expect(baseline?.getAttribute('y1')).toBe(baseline?.getAttribute('y2'));
    expect(single.container.querySelector('circle')).not.toBeNull();
    expect(single.container.innerHTML).not.toContain('NaN');
    single.unmount();

    const flat = render(<Sparkline points={[6, 6, 6]} />);
    const coords = flat.container.querySelector('polyline')?.getAttribute('points')?.split(' ');
    expect(coords).toHaveLength(3);
    expect(flat.container.innerHTML).not.toContain('NaN');
  });

  it('空数据退化为占位符而不是空白', () => {
    render(<Sparkline points={[]} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('过滤掉非有限值后再画线', () => {
    const { container } = render(<Sparkline points={[6, Number.NaN, 7]} />);
    expect(container.querySelector('polyline')?.getAttribute('points')?.split(' ')).toHaveLength(2);
  });
});
