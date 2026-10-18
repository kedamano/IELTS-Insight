import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ScoreBand } from './ScoreBand';
import { bandTone, formatBand } from './tokens';

describe('ScoreBand 三档规则', () => {
  it.each([
    [9, 'good'],
    [7, 'good'],
    [6.5, 'mid'],
    [5.5, 'mid'],
    [5, 'poor'],
    [2, 'poor'],
  ])('band %f → %s', (band, tone) => {
    expect(bandTone(band)).toBe(tone);
  });

  it.each([7, 6.5, 5])('渲染 %f 时使用对应语义变量', (band) => {
    const { container } = render(<ScoreBand band={band} />);
    const root = container.querySelector('[data-band-tone]');
    expect(root?.getAttribute('data-band-tone')).toBe(bandTone(band));
    expect(root?.getAttribute('style') ?? '').not.toMatch(/#[0-9a-f]{3,8}/i);
  });

  it('显示大号 band 数字，0–9 步长 0.5', () => {
    render(<ScoreBand band={6.5} label="口语" />);
    expect(screen.getByText('口语')).toBeInTheDocument();
    expect(screen.getByText('6.5')).toBeInTheDocument();
    expect(formatBand(6.75)).toBe('7.0');
    expect(formatBand(6.3)).toBe('6.5');
    expect(formatBand(11)).toBe('9.0');
  });

  it('null / undefined / NaN 一律渲染「尚无数据」', () => {
    const { rerender, container } = render(<ScoreBand band={null} />);
    expect(screen.getByText('尚无数据')).toBeInTheDocument();
    expect(container.querySelector('[data-band-tone="none"]')).not.toBeNull();

    rerender(<ScoreBand band={undefined} />);
    expect(screen.getByText('尚无数据')).toBeInTheDocument();

    rerender(<ScoreBand band={Number.NaN} />);
    expect(screen.getByText('尚无数据')).toBeInTheDocument();
    expect(screen.queryByText('NaN')).not.toBeInTheDocument();
  });

  it('delta 只在非零时出现，并带符号', () => {
    const { rerender } = render(<ScoreBand band={6.5} delta={0.5} />);
    expect(screen.getByText('+0.5')).toBeInTheDocument();
    rerender(<ScoreBand band={6.5} delta={-1} />);
    expect(screen.getByText('−1.0')).toBeInTheDocument();
    rerender(<ScoreBand band={6.5} delta={0} />);
    expect(screen.queryByText(/^[+−]/)).not.toBeInTheDocument();
  });
});
