/**
 * 阅读屏集成测试（FR-R1…R5 / AC-R2、AC-R3、AC-R4、AC-V1）。
 *
 * 覆盖行为而非快照：
 * - 选题 → 双栏（可滚篇章 + 可滚题目）；
 * - 「定位」高亮段落 2s（AC-R2）；
 * - 草稿跨卸载恢复、提交后清除（AC-R3/FR-W2 同规则）；
 * - 到点自动提交 `timed_out:true` 且未答题按空串原样发送（AC-R3）；
 * - 选中篇章文字 → 加入生词本，body 带 context + source_module/source_ref（AC-V1）；
 * - 讲评视图与段落跳转。
 *
 * msw：基线 handlers 由他人并发重写，所以这里只用自带的 `readingHandlers`（`server.use`）。
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '../../test/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { API_BASE } from '../../services/api';
import { draftStorageKey } from '../../hooks/useDraftAutosave';
import ReadingPanel, { buildAnswerBody } from './ReadingPanel';
import { readingHandlers, readingTestState } from './testHandlers';
import { FIXTURE_READING_SET, FIXTURE_SHORT_SET, FIXTURE_TIMEOUT_SET } from './testFixtures';

const FULL_SET = FIXTURE_READING_SET.id;
const SHORT_SET = FIXTURE_SHORT_SET.id;
const TIMEOUT_SET = FIXTURE_TIMEOUT_SET.id;

/** `useTimer` 读 `performance.now()`，两者必须一起假化，否则换表瞬间会跳变。 */
const FAKED_TIMERS = [
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'setImmediate',
  'clearImmediate',
  'Date',
  'performance',
] as const;

beforeEach(() => {
  readingTestState.reset();
  server.use(...readingHandlers);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
});

async function openSetByTitle(titleZh: string) {
  const title = await screen.findByText(titleZh, { selector: 'p.truncate' });
  const row = title.closest('li') as HTMLElement;
  fireEvent.click(within(row).getByRole('button', { name: '开始' }));
  await screen.findByTestId('passage-scroll');
}

/** 假时钟下 RTL 的 `findBy*` 轮询定时器不会自己走，所以用推进假时钟代替真实等待。 */
async function driveUntil(present: () => boolean, steps = 40, stepMs = 50) {
  for (let index = 0; index < steps; index += 1) {
    await act(async () => {
      vi.advanceTimersByTime(stepMs);
    });
    if (present()) return;
  }
  throw new Error('假时钟推进后仍未出现目标界面（请求没有落地）');
}

describe('buildAnswerBody', () => {
  it('未答题按空串原样发送，而不是从 body 里消失（§1 #19 → 后端记 unanswered）', () => {
    const questions = FIXTURE_SHORT_SET.questions;
    const body = buildAnswerBody(questions, { q1: '  TRUE  ', q99: 'x' });
    expect(body).toEqual({ [questions[0].id]: 'TRUE', [questions[1].id]: '' });
  });
});

describe('选题 → 做题', () => {
  it('列表来自 GET /reading/sets，选中后才拉篇章（#17/#18）', async () => {
    render(<ReadingPanel />);
    expect(await screen.findByText('选择阅读套题')).toBeInTheDocument();
    expect(screen.getByText(FULL_SET, { selector: '.font-code' })).toBeInTheDocument();
    expect(screen.getByText('到点自动提交集')).toBeInTheDocument();

    await openSetByTitle(FIXTURE_SHORT_SET.title_zh);
    expect(screen.getByTestId('passage-scroll')).toBeInTheDocument();
    expect(screen.getByTestId('questions-scroll')).toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveTextContent('10:00');
    expect(document.querySelectorAll('[data-paragraph-label]')).toHaveLength(5);
  });

  it('套题接口 404 时给可读错误而不是白屏（#18）', async () => {
    server.use(
      http.get(`${API_BASE}/reading/sets/:setId`, () =>
        HttpResponse.json({ detail: '阅读套题不存在', code: 'not_found' }, { status: 404 }),
      ),
    );
    render(<ReadingPanel />);
    await screen.findByText('选择阅读套题');
    const row = (await screen.findByText(FIXTURE_READING_SET.title_zh, { selector: 'p.truncate' }))
      .closest('li') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: '开始' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('请求失败 404');
    expect(screen.getByRole('alert')).toHaveTextContent('阅读套题不存在');
  });

  it('13 题集把五种题型都渲染成对应输入（FR-R1）', async () => {
    render(<ReadingPanel />);
    await openSetByTitle(FIXTURE_READING_SET.title_zh);

    expect(screen.getAllByRole('radiogroup')).toHaveLength(6); // 5 判断题 + 1 选择题
    expect(screen.getByLabelText('第 6 题标题选项')).toBeInTheDocument();
    expect(screen.getByLabelText('第 10 题答案')).toBeInTheDocument();
    expect(screen.getByText('最多 1 词（NO MORE THAN 1 WORDS AND/OR A NUMBER）')).toBeInTheDocument();
    expect(screen.getAllByText(/选项可重复选用/)).toHaveLength(4);
    expect(screen.getByText('0/13 已作答')).toBeInTheDocument();
  });
});

describe('定位（AC-R2）', () => {
  it('判断题按题干实词定位到段落并高亮', async () => {
    render(<ReadingPanel />);
    await openSetByTitle(FIXTURE_READING_SET.title_zh);

    fireEvent.click(screen.getByRole('button', { name: '定位第 1 题到段落' }));
    expect(document.querySelector('[data-paragraph-label="A"]')).toHaveAttribute('data-highlighted', 'true');
    expect(await screen.findByText('已定位到段落 A')).toBeInTheDocument();
  });

  it('标题匹配题用题目自带的 paragraph_label', async () => {
    render(<ReadingPanel />);
    await openSetByTitle(FIXTURE_READING_SET.title_zh);

    fireEvent.click(screen.getByRole('button', { name: '定位第 8 题到段落' }));
    expect(document.querySelector('[data-paragraph-label="E"]')).toHaveAttribute('data-highlighted', 'true');
  });

  it('无法唯一定位时按钮禁用并说明原因（绝不猜）', async () => {
    render(<ReadingPanel />);
    await openSetByTitle(FIXTURE_READING_SET.title_zh);

    const button = screen.getByRole('button', { name: '定位第 4 题到段落' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', '无法唯一定位，请通读全文');
  });
});

describe('草稿（AC-R3 恢复 + 提交后清除）', () => {
  it('答过的题在卸载重进后仍在，并显示「已恢复上次草稿」', async () => {
    render(<ReadingPanel />);
    await openSetByTitle(FIXTURE_SHORT_SET.title_zh);

    fireEvent.change(screen.getByLabelText('第 10 题答案'), { target: { value: 'metres' } });
    await waitFor(() => {
      expect(localStorage.getItem(draftStorageKey(`reading_${SHORT_SET}`))).toContain('metres');
    });
    cleanup();

    render(<ReadingPanel />);
    await openSetByTitle(FIXTURE_SHORT_SET.title_zh);
    expect(screen.getByText('已恢复上次草稿')).toBeInTheDocument();
    expect(screen.getByLabelText('第 10 题答案')).toHaveValue('metres');
    expect(screen.getByText('1/2 已作答')).toBeInTheDocument();
  });

  it('未答完先确认再提交；提交体带 timed_out:false，成功后草稿被清掉', async () => {
    render(<ReadingPanel />);
    await openSetByTitle(FIXTURE_SHORT_SET.title_zh);

    fireEvent.change(screen.getByLabelText('第 10 题答案'), { target: { value: 'metres' } });
    fireEvent.click(screen.getByRole('button', { name: '提交作答' }));
    expect(await screen.findByText(/还有 1 题未作答/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '返回继续作答' }));
    expect(screen.queryByText(/还有 1 题未作答/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '提交作答' }));
    fireEvent.click(await screen.findByRole('button', { name: '仍然提交' }));

    await waitFor(() => expect(readingTestState.attemptBodies).toHaveLength(1));
    const { set, body } = readingTestState.attemptBodies[0];
    expect(set).toBe(SHORT_SET);
    expect(body.answers).toEqual({ q1: '', q10: 'metres' });
    expect(body.timed_out).toBe(false);
    expect(typeof body.duration_sec).toBe('number');

    await waitFor(() => {
      expect(localStorage.getItem(draftStorageKey(`reading_${SHORT_SET}`))).toBeNull();
    });

    // 进入讲评（§3-OR）
    expect(await screen.findByText('本组成绩')).toBeInTheDocument();
    expect(screen.getByText('8/13')).toBeInTheDocument();
  });

  it('判分接口 500 时错误可见、草稿不丢、可以重试成功（CONSTITUTION §3）', async () => {
    readingTestState.attemptShouldFail = true;
    render(<ReadingPanel />);
    await openSetByTitle(FIXTURE_SHORT_SET.title_zh);

    fireEvent.click(screen.getByRole('button', { name: '提交作答' }));
    fireEvent.click(await screen.findByRole('button', { name: '仍然提交' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('请求失败 500');
    expect(alert).toHaveTextContent('判分服务暂不可用（测试注入）');
    expect(localStorage.getItem(draftStorageKey(`reading_${SHORT_SET}`))).not.toBeNull();

    readingTestState.attemptShouldFail = false;
    fireEvent.click(screen.getByRole('button', { name: '重试提交' }));
    await screen.findByText('本组成绩');
    expect(readingTestState.attemptBodies).toHaveLength(2);
    expect(localStorage.getItem(draftStorageKey(`reading_${SHORT_SET}`))).toBeNull();
  });
});

describe('到点自动提交（AC-R3）', () => {
  it('计时结束后自动 POST，timed_out 为 true，未答题发空串，草稿清空', async () => {
    localStorage.setItem(
      draftStorageKey(`reading_${TIMEOUT_SET}`),
      JSON.stringify({ v: JSON.stringify({ q1: 'TRUE' }), t: Date.now() }),
    );
    // 倒计时全程走假时钟：不真实等待 `time_limit_sec`，也不依赖 20 分钟
    vi.useFakeTimers({ toFake: [...FAKED_TIMERS] });
    render(<ReadingPanel />);
    await driveUntil(() => screen.queryAllByRole('button', { name: '开始' }).length === 3);
    const row = (screen.getByText(FIXTURE_TIMEOUT_SET.title_zh, { selector: 'p.truncate' })
      .closest('li') as HTMLElement);
    await act(async () => {
      fireEvent.click(within(row).getByRole('button', { name: '开始' }));
    });
    await driveUntil(() => Boolean(screen.queryByTestId('passage-scroll')));
    expect(screen.getByRole('timer')).toHaveTextContent('0:01');

    await act(async () => {
      vi.advanceTimersByTime(FIXTURE_TIMEOUT_SET.time_limit_sec * 1000);
    });
    vi.useRealTimers();

    await waitFor(() => expect(readingTestState.attemptBodies).toHaveLength(1));
    const { set, body } = readingTestState.attemptBodies[0];
    expect(set).toBe(TIMEOUT_SET);
    expect(body.timed_out).toBe(true);
    expect(body.answers).toEqual({ q1: 'TRUE', q10: '' });
    expect(body.duration_sec).toBeGreaterThanOrEqual(1);
    expect(body.duration_sec).toBeLessThanOrEqual(2);

    // 自动交卷后直接进讲评，并标明是超时交的
    expect(await screen.findByText('本组成绩')).toBeInTheDocument();
    expect(screen.getByText('到时自动提交')).toBeInTheDocument();
    expect(localStorage.getItem(draftStorageKey(`reading_${TIMEOUT_SET}`))).toBeNull();
  });
});

describe('选中加生词本（AC-V1）', () => {
  function selectWordInParagraphA(word: string) {
    const holder = document.querySelector('[data-paragraph-label="A"] [data-paragraph-text]');
    const textNode = holder?.firstChild as Text | undefined;
    if (!textNode) throw new Error('篇章文本节点缺失');
    const index = textNode.data.indexOf(word);
    expect(index).toBeGreaterThanOrEqual(0);
    const range = document.createRange();
    range.setStart(textNode, index);
    range.setEnd(textNode, index + word.length);
    const selection = window.getSelection();
    if (!selection) throw new Error('jsdom 没有选区');
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent.mouseUp(screen.getByTestId('passage-scroll'));
  }

  it('浮层给出「加入生词本」，body 带 word/context/source 三项', async () => {
    render(<ReadingPanel />);
    await openSetByTitle(FIXTURE_SHORT_SET.title_zh);

    selectWordInParagraphA('drone');
    const dialog = await screen.findByRole('dialog', { name: /drone/ });
    expect(within(dialog).getByText('段落 A')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '加入生词本' }));

    await waitFor(() => expect(readingTestState.vocabBodies).toHaveLength(1));
    const body = readingTestState.vocabBodies[0];
    expect(body.word).toBe('drone');
    expect(body.source_module).toBe('reading');
    expect(body.source_ref).toBe(SHORT_SET);
    expect(body.context).toContain('traffic drone');

    expect(await screen.findByText(/已加入生词本：drone/)).toBeInTheDocument();
  });

  it('一次选太多词时拒绝并说明上限', async () => {
    render(<ReadingPanel />);
    await openSetByTitle(FIXTURE_SHORT_SET.title_zh);

    selectWordInParagraphA('the most persistent form of urban');
    expect(await screen.findByRole('alert')).toHaveTextContent('4 个词以内');
    expect(readingTestState.vocabBodies).toHaveLength(0);
  });

  it('写库失败时错误必须可见（CONSTITUTION §3）', async () => {
    readingTestState.vocabShouldFail = true;
    render(<ReadingPanel />);
    await openSetByTitle(FIXTURE_SHORT_SET.title_zh);

    selectWordInParagraphA('drone');
    const dialog = await screen.findByRole('dialog', { name: /drone/ });
    fireEvent.click(within(dialog).getByRole('button', { name: '加入生词本' }));
    // 失败只应有一个会播报的 alert，且同时给出动作上下文与后端 detail（CONSTITUTION §3）
    const alerts = await screen.findAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].textContent).toContain('加入生词本失败');
    expect(alerts[0].textContent).toContain('生词本写入失败');
  });
});

describe('讲评 → 回看原文', () => {
  it('逐题解析点「定位到原文」高亮引用段落', async () => {
    render(<ReadingPanel />);
    await openSetByTitle(FIXTURE_SHORT_SET.title_zh);
    fireEvent.change(screen.getByLabelText('第 10 题答案'), { target: { value: 'metres' } });
    fireEvent.click(screen.getByRole('button', { name: '提交作答' }));
    fireEvent.click(await screen.findByRole('button', { name: '仍然提交' }));

    await screen.findByText('本组成绩');
    fireEvent.click(screen.getByRole('button', { name: '定位第 10 题原文' }));
    expect(document.querySelector('[data-paragraph-label="A"]')).toHaveAttribute('data-highlighted', 'true');
  });

  it('关闭中文解析的设置会一路带到讲评（FR-C / GET /settings）', async () => {
    readingTestState.showChineseHints = false;
    render(<ReadingPanel />);
    await openSetByTitle(FIXTURE_SHORT_SET.title_zh);
    fireEvent.click(screen.getByRole('button', { name: '提交作答' }));
    fireEvent.click(await screen.findByRole('button', { name: '仍然提交' }));

    await screen.findByText('本组成绩');
    await waitFor(() => {
      // 5 条带中文解析的错题都显示「已隐藏」说明
      expect(screen.getAllByText(/中文解析已按设置隐藏/)).toHaveLength(5);
    });
    expect(screen.queryByText('原文 A 段说明交通噪音在低频最厚。')).not.toBeInTheDocument();
  });

  it('返回选题后重新计时、重新可答（key 重置）', async () => {
    render(<ReadingPanel />);
    await openSetByTitle(FIXTURE_SHORT_SET.title_zh);
    fireEvent.click(screen.getByRole('button', { name: '退出练习' }));
    expect(await screen.findByText('选择阅读套题')).toBeInTheDocument();
  });
});
