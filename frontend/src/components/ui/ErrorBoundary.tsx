import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from './Button';

export type ErrorBoundaryProps = {
  /** 'view' 只兜当前这一屏（左轨与右栏仍可点）；'app' 兜整个应用，只剩重载 */
  scope?: 'view' | 'app';
  /** 默认走 location.reload()，测试里注入 spy */
  onReload?: () => void;
  children: ReactNode;
};

type State = { error: Error | null };

/**
 * 渲染异常兜底（契约 §15.1）。
 *
 * DOM 里不出现任何技术细节：原始错误只交给 console.error。
 * React 的 message 常带 `http://127.0.0.1:5174/src/...` 这类模块 URL，
 * 甩给用户看既看不懂，又违反 CONSTITUTION §3。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  state: State = { error: null };

  private panel: HTMLElement | null = null;

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  componentDidMount() {
    this.focusAction();
  }

  componentDidUpdate() {
    this.focusAction();
  }

  /** 键盘用户不该在兜底面板上按 Tab 找按钮 */
  private focusAction() {
    if (this.state.error && document.activeElement === document.body) {
      this.panel?.querySelector('button')?.focus();
    }
  }

  private retry = () => {
    this.setState({ error: null });
  };

  private reload = () => {
    (this.props.onReload ?? (() => window.location.reload()))();
  };

  render() {
    if (!this.state.error) return this.props.children;
    const appScope = this.props.scope === 'app';
    return (
      <section
        role="alert"
        ref={(node) => {
          this.panel = node;
        }}
        className="flex flex-col gap-3 rounded-card border border-rule bg-paper-raised p-5 shadow-elevated"
      >
        <h3 className="font-serif text-[15px] leading-snug text-ink">
          {appScope ? '应用没能显示出来' : '这一屏没能显示出来'}
        </h3>
        <p className="text-sm text-ink-secondary">
          {appScope
            ? '请重新载入应用。如果重新载入后仍然这样，请退出应用再打开。'
            : '其它部分照常可用：可以先切到别的页面继续，或者点下面的重试。如果反复出现，请退出应用再打开。'}
        </p>
        {appScope ? (
          <Button variant="primary" size="sm" className="self-start" onClick={this.reload}>
            重新载入应用
          </Button>
        ) : (
          <Button variant="primary" size="sm" className="self-start" onClick={this.retry}>
            重试这一屏
          </Button>
        )}
      </section>
    );
  }
}

export default ErrorBoundary;
