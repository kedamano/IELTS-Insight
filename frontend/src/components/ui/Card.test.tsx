import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Badge } from './Badge';
import { Card } from './Card';
import { Stat } from './Stat';

describe('Card', () => {
  it('标题、副标题与操作区各就其位，标题进入可访问名', () => {
    render(
      <Card title="今日任务" subtitle="按差距权重生成" actions={<button type="button">重新生成</button>}>
        <p>任务列表</p>
      </Card>,
    );
    expect(screen.getByRole('region', { name: '今日任务' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '今日任务' })).toBeInTheDocument();
    expect(screen.getByText('按差距权重生成')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新生成' })).toBeInTheDocument();
  });

  it('footer 与内容分区渲染', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <Card title="设置">
        <p>表单</p>
      </Card>,
    );
    expect(screen.getByText('表单')).toBeInTheDocument();

    render(
      <Card title="AI 配置" footer={<button type="button" onClick={onSave}>保存</button>}>
        <p>内容</p>
      </Card>,
    );
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('无标题时无 header，也不伪造 aria-label', () => {
    const { container } = render(<Card>纯内容</Card>);
    expect(container.querySelector('header')).toBeNull();
    expect(container.firstElementChild?.getAttribute('aria-label')).toBeNull();
  });
});

describe('Badge', () => {
  it('tone 映射到语义色（outline 变体走内联变量）', () => {
    const { rerender, container } = render(
      <Badge tone="good" variant="outline">
        达标
      </Badge>,
    );
    expect(container.firstElementChild?.getAttribute('style') ?? '').toContain('var(--band-good)');

    rerender(
      <Badge tone="poor" variant="outline">
        需提升
      </Badge>,
    );
    expect(container.firstElementChild?.getAttribute('style') ?? '').toContain('var(--band-poor)');
  });

  it('soft 变体用语义色类，不出现字面色值', () => {
    const { container } = render(<Badge tone="mid">中间档</Badge>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain('text-band-mid');
    expect(el).not.toHaveAttribute('style');
  });

  it('色点是装饰性的，不进入朗读内容', () => {
    render(<Badge dot>已配置</Badge>);
    const dot = screen.getByText('已配置').querySelector('[aria-hidden="true"]');
    expect(dot).not.toBeNull();
  });
});

describe('Stat', () => {
  it('读数走等宽字体，label 与单位分离便于朗读', () => {
    render(<Stat label="今日练习" value="42" unit="分钟" />);
    expect(screen.getByText('今日练习')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('分钟')).toBeInTheDocument();
    expect(screen.getByText('42').className).toContain('font-code');
  });

  it('tone=accent 时使用主色变量', () => {
    render(<Stat label="目标 band" value="6.5" tone="accent" />);
    expect(screen.getByText('6.5').getAttribute('style') ?? '').toContain('var(--accent)');
  });

  it('hint 作为辅助小字（0–100 原分只能这样展示，AC-G5）', () => {
    render(<Stat label="发音" value="7.0" tone="good" hint="原始分 78/100" size="lg" />);
    expect(screen.getByText('原始分 78/100')).toBeInTheDocument();
  });
});
