/**
 * EngineNotice（契约 §15.4 第 7 条，Wave 7 B4）。
 *
 * 防的是这一种具体的坑：上一个实例没退干净，占着 8765，新窗口「让位」给它之后界面照常就绪，
 * 用户以为在用新版本，其实连的是旧引擎 —— 旧引擎没有新端点，症状是「某个按钮点了没反应」，
 * 排查方向会被带到界面代码里。所以版本不一致必须当场说破。
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { HealthResponse } from '../../types/ielts';
import { APP_VERSION } from '../../version';
import { EngineNotice } from './EngineNotice';

function 引擎(补丁: Partial<HealthResponse> = {}): HealthResponse {
  return {
    version: APP_VERSION,
    pid: 4321,
    port: 8765,
    port_source: 'probe',
    started_at: '2026-10-30T21:10:00+08:00',
    ai_configured: false,
    ai_base_url_host: null,
    ai_model: null,
    whisper: { loaded: false, model: 'base' },
    tts_ok: false,
    content_counts: { speaking: 18, listening: 4, reading: 4, writing: 10 },
    storage: { state: 'ok', reason: null },
    ...补丁,
  };
}

describe('EngineNotice', () => {
  // 静默用例断言 `firstChild` 为 null，不是 `textContent` 为空：前者能抓住「返回一个空 div」——
  // 主区是 flex gap-4，多一个空 div 就真的多一道空隙，而 textContent 为空对这个缺陷毫无反应。
  it('版本一致时什么都不渲染', () => {
    const { container } = render(<EngineNotice health={引擎()} />);
    expect(container.firstChild).toBeNull();
  });

  it('还没探到引擎时不猜', () => {
    const { container } = render(<EngineNotice health={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('版本不一致时指认是上一个未退出的引擎', () => {
    render(<EngineNotice health={引擎({ version: '1.9.0' })} />);
    const 文本 = screen.getByRole('status').textContent ?? '';
    expect(文本).toContain('上一次未退出的引擎');
    expect(文本).toContain('1.9.0');
    expect(文本).toContain(APP_VERSION);
    expect(文本).toContain('4321');
    expect(文本).toContain('2026-10-30 21:10');
    // 可操作：告诉用户怎么做，而不是只报「不匹配」
    expect(文本).toContain('关闭全部 IELTS Insight 窗口');
  });

  it('端口没核实时不冒充实测值', () => {
    render(<EngineNotice health={引擎({ version: '1.9.0', port_source: 'config' })} />);
    const 文本 = screen.getByRole('status').textContent ?? '';
    expect(文本).toContain('配置值');
    expect(文本).not.toContain('实测');
  });

  it('文案不含路径、文件名或异常文本', () => {
    render(<EngineNotice health={引擎({ version: '1.9.0' })} />);
    const 文本 = screen.getByRole('status').textContent ?? '';
    // CONSTITUTION §3：界面文案不许出现盘符路径、文件名或异常 repr
    expect(文本).not.toMatch(/[A-Za-z]:[\\/]/);
    expect(文本).not.toMatch(/\.(exe|py|tsx?|json)\b/);
    expect(文本).not.toMatch(/\\/);
  });
});
