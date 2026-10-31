/**
 * ErrorBoundary（契约 §15.1）。
 *
 * 它存在的理由只有一句话：**一屏抛错不许变成全白**。
 * 白屏最伤的地方不是「看不见」，而是它把「数据其实还在」伪装成「全没了」——
 * 跟 §14.6 里「坏库返回 200 + 零数据」是同一类错觉，只是发生在渲染层。
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

// 抛的错里故意带上模块 URL 与组件名：兜底面板要是把它们漏进 DOM，
// 第 3 条断言就会红 —— 那是 CONSTITUTION §3 的红线，不是审美问题。
const BOOM = new Error(
  'Cannot read properties of undefined (reading band) at ReportPage (http://127.0.0.1:5174/src/features/report/ReportPage.tsx:88:12)',
);

let shouldFail = false;

function Probe() {
  if (shouldFail) throw BOOM;
  return <p>这一屏好好的</p>;
}

afterEach(() => {
  shouldFail = false;
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('不抛错时原样渲染 children，不许有多余的告警', () => {
    render(
      <ErrorBoundary scope="view">
        <Probe />
      </ErrorBoundary>,
    );
    expect(screen.getByText('这一屏好好的')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('children 抛错时兜底面板出现，而且根节点仍有内容（白屏=失败）', () => {
    shouldFail = true;
    const { container } = render(
      <ErrorBoundary scope="view">
        <Probe />
      </ErrorBoundary>,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('这一屏');
    expect(container.textContent!.trim().length).toBeGreaterThan(10);
  });

  it('兜底里不许出现技术细节：组件名、堆栈、模块 URL、路径都不行', () => {
    shouldFail = true;
    render(
      <ErrorBoundary scope="view">
        <Probe />
      </ErrorBoundary>,
    );
    const text = screen.getByRole('alert').textContent ?? '';
    expect(text).not.toMatch(/ReportPage|Probe/);
    expect(text).not.toMatch(/Error|undefined|Cannot read/);
    expect(text).not.toMatch(/\.tsx|\.ts:|http:|127\.0\.0\.1/);
    expect(text).not.toMatch(/[A-Za-z]:\\|\/api\//);
  });

  it('兜底不承诺数据安全（草稿可能正卡在防抖窗口里，说了就是假话）', () => {
    shouldFail = true;
    render(
      <ErrorBoundary scope="view">
        <Probe />
      </ErrorBoundary>,
    );
    const text = screen.getByRole('alert').textContent ?? '';
    expect(text).not.toMatch(/都不会丢|数据都还在|记录完好/);
  });

  it('焦点落在面板第一个按钮上，键盘用户进来就能按', () => {
    shouldFail = true;
    render(
      <ErrorBoundary scope="view">
        <Probe />
      </ErrorBoundary>,
    );
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '重试这一屏' }));
  });

  it('点「重试这一屏」会重新渲染 children，修好了就恢复正常', () => {
    shouldFail = true;
    render(
      <ErrorBoundary scope="view">
        <Probe />
      </ErrorBoundary>,
    );
    shouldFail = false;
    fireEvent.click(screen.getByRole('button', { name: '重试这一屏' }));
    expect(screen.getByText('这一屏好好的')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('重试仍然抛错时继续显示兜底，不许二次抛错把外层也打穿', () => {
    shouldFail = true;
    render(
      <ErrorBoundary scope="view">
        <Probe />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole('button', { name: '重试这一屏' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('这一屏好好的')).toBeNull();
  });

  it('key 变化（切到别的视图）会复位：坏屏切走再回来不再卡着', () => {
    shouldFail = true;
    const { rerender } = render(
      <ErrorBoundary scope="view" key="report">
        <Probe />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    shouldFail = false;
    rerender(
      <ErrorBoundary scope="view" key="writing">
        <Probe />
      </ErrorBoundary>,
    );
    expect(screen.getByText('这一屏好好的')).toBeInTheDocument();
  });

  it('外层（scope="app"）给的是「重新载入应用」，点了确实走重载', () => {
    shouldFail = true;
    const onReload = vi.fn();
    render(
      <ErrorBoundary scope="app" onReload={onReload}>
        <Probe />
      </ErrorBoundary>,
    );
    const text = screen.getByRole('alert').textContent ?? '';
    expect(text).not.toContain('重试这一屏');
    fireEvent.click(screen.getByRole('button', { name: '重新载入应用' }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('原始错误仍交给 console.error，排查的人开 DevTools 拿得到', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    shouldFail = true;
    render(
      <ErrorBoundary scope="view">
        <Probe />
      </ErrorBoundary>,
    );
    expect(spy.mock.calls.some((args) => args.includes(BOOM))).toBe(true);
  });
});
