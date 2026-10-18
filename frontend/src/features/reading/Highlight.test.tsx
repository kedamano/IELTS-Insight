/**
 * 段落高亮与滚动（AC-R2：高亮 2 秒 + 滚动到可视区）。
 *
 * jsdom 两点必须知道：
 * 1. `Element.prototype.scrollIntoView` 在 jsdom 里是 undefined → 生产代码要 guard，测试里才需要打桩；
 * 2. 高亮自动撤除用 setTimeout，测试用 fake timers 精确推进，不靠真实等待。
 */
import { act, fireEvent, render, screen } from '../../test/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HighlightedParagraph, HIGHLIGHT_MS, paragraphDomId, useParagraphHighlight } from './Highlight';

function Harness({ durationMs }: { durationMs?: number }) {
  const highlight = useParagraphHighlight(undefined, durationMs);
  return (
    <div>
      <button type="button" onClick={() => highlight.locate('C')}>
        定位 C
      </button>
      <button type="button" onClick={() => highlight.locate(null)}>
        定位空
      </button>
      <button type="button" onClick={() => highlight.locate('ZZZ')}>
        定位不存在的段落
      </button>
      <button type="button" onClick={() => highlight.clear()}>
        清除
      </button>
      <span data-testid="active">{highlight.activeLabel ?? 'none'}</span>
      {['A', 'C'].map((label) => (
        <HighlightedParagraph key={label} label={label} setId="re_x" active={highlight.activeLabel === label}>
          <p>段落 {label} 内容</p>
        </HighlightedParagraph>
      ))}
    </div>
  );
}

const originalScroll = Element.prototype.scrollIntoView;

beforeEach(() => {
  vi.useFakeTimers();
  Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView;
});

afterEach(() => {
  vi.useRealTimers();
  Element.prototype.scrollIntoView = originalScroll;
});

describe('useParagraphHighlight', () => {
  it('locate 高亮目标段落并滚动到可视区（AC-R2）', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '定位 C' }));

    expect(screen.getByTestId('active')).toHaveTextContent('C');
    const node = document.querySelector('[data-paragraph-label="C"]') as HTMLElement;
    expect(node).toHaveAttribute('data-highlighted', 'true');
    expect(node.getAttribute('style') ?? '').toContain('var(--accent-soft)');
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('2 秒后自动撤除高亮（AC-R2 的「高亮 2s」）', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '定位 C' }));
    expect(document.querySelector('[data-paragraph-label="C"]')).toHaveAttribute('data-highlighted', 'true');

    act(() => {
      vi.advanceTimersByTime(HIGHLIGHT_MS - 1);
    });
    expect(document.querySelector('[data-paragraph-label="C"]')).toHaveAttribute('data-highlighted', 'true');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId('active')).toHaveTextContent('none');
    expect(document.querySelector('[data-paragraph-label="C"]')).toHaveAttribute('data-highlighted', 'false');
  });

  it('重复点同一段落会重新计时，而不是把高亮点灭', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '定位 C' }));
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    fireEvent.click(screen.getByRole('button', { name: '定位 C' }));
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.getByTestId('active')).toHaveTextContent('C');
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByTestId('active')).toHaveTextContent('none');
  });

  it('找不到段落/label 为空时返回 false 且不动高亮（调用方据此提示）', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '定位不存在的段落' }));
    expect(screen.getByTestId('active')).toHaveTextContent('none');
    fireEvent.click(screen.getByRole('button', { name: '定位空' }));
    expect(screen.getByTestId('active')).toHaveTextContent('none');
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it('clear() 立刻撤销高亮并取消定时器', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '定位 C' }));
    act(() => {
      vi.advanceTimersByTime(500);
    });
    fireEvent.click(screen.getByRole('button', { name: '清除' }));
    expect(screen.getByTestId('active')).toHaveTextContent('none');
    act(() => {
      vi.advanceTimersByTime(HIGHLIGHT_MS * 2);
    });
    expect(screen.getByTestId('active')).toHaveTextContent('none');
  });

  it('scrollIntoView 缺失时只高亮，绝不抛错（jsdom / 老 WebView）', () => {
    Element.prototype.scrollIntoView = originalScroll;
    render(<Harness />);
    expect(() => fireEvent.click(screen.getByRole('button', { name: '定位 C' }))).not.toThrow();
    expect(screen.getByTestId('active')).toHaveTextContent('C');
  });

  it('卸载后定时器被清掉，不再 setState', () => {
    const { unmount } = render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '定位 C' }));
    unmount();
    const errors: unknown[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    act(() => {
      vi.advanceTimersByTime(HIGHLIGHT_MS + 10);
    });
    console.error = originalError;
    expect(errors).toHaveLength(0);
  });
});

describe('paragraphDomId', () => {
  it('稳定可预测，供讲评跳转与测试定位', () => {
    expect(paragraphDomId('re_p_birdsong_01', 'B')).toBe('passage-re_p_birdsong_01-p-B');
  });
});
