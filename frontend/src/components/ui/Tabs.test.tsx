import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { TabPanel, Tabs } from './Tabs';

function Stateful({ onValueChange }: { onValueChange?: (id: string) => void } = {}) {
  const [value, setValue] = useState('listening');
  return (
    <>
      <Tabs
        id="skill"
        ariaLabel="技能模块"
        value={value}
        onChange={(id) => {
          setValue(id);
          onValueChange?.(id);
        }}
        items={[
          { id: 'speaking', label: '口语' },
          { id: 'listening', label: '听力' },
          { id: 'writing', label: '写作' },
          { id: 'locked', label: '未就绪', disabled: true },
        ]}
      />
      <TabPanel baseId="skill" tabId={value}>
        面板内容：{value}
      </TabPanel>
    </>
  );
}

describe('Tabs', () => {
  it('暴露 tablist / tab / tabpanel 角色与无障碍名', () => {
    render(<Stateful />);
    expect(screen.getByRole('tablist', { name: '技能模块' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.getByRole('tabpanel')).toBeInTheDocument();
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('听力');
  });

  it('选中项 aria-selected=true 且只有它进入 Tab 序列（roving tabindex）', () => {
    render(<Stateful />);
    const selected = screen.getByRole('tab', { name: '听力' });
    expect(selected).toHaveAttribute('aria-selected', 'true');
    expect(selected).toHaveAttribute('tabindex', '0');
    const other = screen.getByRole('tab', { name: '口语' });
    expect(other).toHaveAttribute('aria-selected', 'false');
    expect(other).toHaveAttribute('tabindex', '-1');
  });

  it('tab 与 panel 双向 id 关联', () => {
    render(<Stateful />);
    const tab = screen.getByRole('tab', { name: '听力' });
    const panel = screen.getByRole('tabpanel');
    expect(tab.getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.getAttribute('aria-labelledby')).toBe(tab.id);
  });

  it('点击切换选中项', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Stateful onValueChange={onChange} />);
    await user.click(screen.getByRole('tab', { name: '写作' }));
    expect(screen.getByRole('tab', { name: '写作' })).toHaveAttribute('aria-selected', 'true');
    expect(onChange).toHaveBeenCalledWith('writing');
    await waitFor(() => expect(screen.getByRole('tabpanel')).toHaveTextContent('writing'));
  });

  it('方向键移动选中并跳过禁用项，Home/End 直达两端', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Stateful onValueChange={onChange} />);
    screen.getByRole('tab', { name: '听力' }).focus();

    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('writing'));

    await user.keyboard('{ArrowRight}');
    await waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith('speaking');
      expect(screen.getByRole('tab', { name: '口语' })).toHaveAttribute('aria-selected', 'true');
    });

    await user.keyboard('{ArrowLeft}');
    await waitFor(() => expect(screen.getByRole('tab', { name: '写作' })).toHaveAttribute('aria-selected', 'true'));

    await user.keyboard('{Home}');
    await waitFor(() => expect(screen.getByRole('tab', { name: '口语' })).toHaveAttribute('aria-selected', 'true'));

    await user.keyboard('{End}');
    await waitFor(() => expect(screen.getByRole('tab', { name: '写作' })).toHaveAttribute('aria-selected', 'true'));
  });

  it('禁用项不可点击', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Stateful onValueChange={onChange} />);
    await user.click(screen.getByRole('tab', { name: '未就绪' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
