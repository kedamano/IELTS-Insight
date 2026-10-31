/**
 * StorageNotice（契约 §14.6 界面侧）。
 *
 * 这块的存在的意义只有一句话：**降级必须说清代价**。
 * 「只能读」不是「坏了」——练习记录还在、还看得见，但从现在起保存不了。
 * 界面要是只写「出错了」，用户会以为重开就没事，然后继续打字、继续丢东西。
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StorageNotice } from './StorageNotice';
import type { StorageHealth } from '../../types/ielts';

const READONLY: StorageHealth = {
  state: 'readonly',
  reason: '本机学习库文件已损坏，本次启动以只读方式运行。',
};

describe('StorageNotice', () => {
  it('健康时什么都不渲染（平时不许吓用户）', () => {
    const { container } = render(<StorageNotice storage={{ state: 'ok', reason: null }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('还没探到状态时也什么都不渲染', () => {
    const { container } = render(<StorageNotice storage={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('只读降级时告警条说清代价：改动不会保存 + 库文件不会被自动重建', () => {
    render(<StorageNotice storage={READONLY} />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('只能读');
    expect(alert.textContent).toContain('不会保存');
    // 「以前的记录还看得见」在**损坏**这种情况下是假话（读也读不出来），所以不许这么写
    expect(alert.textContent).toContain('不会被自动重建');
    expect(alert.textContent).not.toContain('仍可查看');
  });

  it('原因用后端给的中文原文，前端不自造 sqlite 术语', () => {
    render(<StorageNotice storage={READONLY} />);
    expect(screen.getByRole('alert').textContent).toContain('已损坏');
    expect(screen.getByRole('alert').textContent).not.toMatch(/sqlite|malformed|\.db/i);
  });

  it('原因缺失时也要有兜底文案 + 下一步（空白告警等于没告）', () => {
    render(<StorageNotice storage={{ state: 'readonly', reason: null }} />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent!.trim().length).toBeGreaterThan(10);
    expect(alert.textContent).toContain('重启');
  });
});
