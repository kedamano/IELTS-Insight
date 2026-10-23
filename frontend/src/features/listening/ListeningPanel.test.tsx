/**
 * 听力屏行为测试（FR-L1…L5 / AC-G1、AC-L1、AC-L1b、AC-L2、AC-L3、AC-L4、CONSTITUTION §3）。
 *
 * 只断言「验收条款」而不是实现细节：
 * - 选题维度真的落到 `GET /listening/sets` 的查询参数上（#13）；
 * - 音频走 blob 而不是把 `/audio` 直接塞进 `<audio src>`（#15），503 时不白屏、可读降级、
 *   精读文本取自题面 `audio_text`（AC-L1b + §10.5 裁定 1：不依赖 `transcript_available`）；
 * - 倍速真的作用到播放元素（AC-L2）、逐句重听真的跳秒；
 * - 提交体是契约 body（`answers` + `duration_sec`），批改视图按 §3-B 的 20 题表给 band
 *   （16→7.0，已对后端实测锚定）并逐题给出错因。
 *
 * msw：基线 handlers 由他人并发维护，本文件只用自带的 `createListeningHandlers`。
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '../../test/testUtils';
import { afterEach, describe, expect, it } from 'vitest';
import { server } from '../../test/mocks/server';
import { API_BASE } from '../../services/api';
import { draftStorageKey } from '../../hooks/useDraftAutosave';
import type { ListeningQuestionPublic } from '../../types/ielts';
import ListeningPanel from './ListeningPanel';
import { AUDIO_UNAVAILABLE_TEXT, TRANSCRIPT_ENTRY_TEXT } from './listeningSets';
import {
  createListeningHandlers,
  listeningAnswerKey,
  listeningMeta,
  listeningQuestions,
  listeningSettings,
  listeningSetDoc,
  listeningSetId,
  mockTestMeta,
} from './testHandlers';

const TRANSCRIPT_MARK = 'flash photography is not allowed';

function fieldNode(questionId: string): HTMLInputElement | HTMLSelectElement {
  const node = document.getElementById(`listening-answer-${questionId}`);
  if (!node) throw new Error(`第 ${questionId} 题的作答控件没有渲染`);
  return node as HTMLInputElement | HTMLSelectElement;
}

function audioElement(): HTMLAudioElement | null {
  return document.querySelector('audio');
}

/** 按题库选项文本还原「点了哪一项」，避免把字面量散落到每个用例里。 */
function optionTextOf(question: ListeningQuestionPublic, letter: string): string {
  if (question.type === 'multiple_choice') {
    return question.options.find((option) => option.startsWith(`${letter}.`)) ?? letter;
  }
  if (question.type === 'matching') {
    return question.options_list.find((option) => option.toUpperCase().startsWith(`${letter}.`)) ?? letter;
  }
  if (question.type === 'map_diagram_label') {
    return question.labels.find((label) => label.toUpperCase() === letter.toUpperCase()) ?? letter;
  }
  return letter;
}

/** 除 `wrong`（答案键后加词，判 wrong）与 `blank`（留空）外全部按答案键作答。 */
function answerEverything(wrong: string[] = [], blank: string[] = []) {
  for (const question of listeningQuestions) {
    const key = listeningAnswerKey[question.id];
    if (blank.includes(question.id)) continue;
    const value = wrong.includes(question.id) ? `${key} maybe` : key;
    if (question.type === 'multiple_choice') {
      fireEvent.click(screen.getByRole('radio', { name: optionTextOf(question, value) }));
      continue;
    }
    fireEvent.change(fieldNode(question.id), { target: { value: optionTextOf(question, value) } });
  }
}

async function openSet(titleZh: string = listeningMeta.title_zh) {
  const title = await screen.findByText(titleZh);
  const row = title.closest('li') as HTMLElement;
  fireEvent.click(within(row).getByRole('button', { name: `开始 ${titleZh}` }));
  await screen.findByRole('region', { name: '答题' });
}

/** 顶部磁贴条容器（契约 §8.3）：aria-label 是条的身份。 */
function strip(): Promise<HTMLElement> {
  return screen.findByLabelText('听力关键指标');
}

/**
 * 磁贴条（契约 §8.3）只按 `data-metric` 取块：class 与文案都会随设计改动，
 * 磁贴身份不会（与 report/Dashboard.test.tsx 同一套选择器）。
 */
async function metric(name: string): Promise<HTMLElement> {
  const grid = await strip();
  const node = grid.querySelector<HTMLElement>(`[data-metric="${name}"]`);
  if (!node) throw new Error(`找不到 data-metric="${name}" 的磁贴`);
  return node;
}

afterEach(() => {
  cleanup();
  server.resetHandlers();
  localStorage.clear();
});

describe('ListeningPanel 选题（#13 / AC-G1）', () => {
  it('引擎未就绪时列表与筛选不可用，且给出可点的重试', () => {
    const ctx = createListeningHandlers();
    server.use(...ctx.handlers);
    render(<ListeningPanel ready={false} />);

    expect(screen.getByText('选择听力套题')).toBeInTheDocument();
    expect(screen.getByText('引擎启动中')).toBeInTheDocument();
    expect(screen.getByText(/就绪前不能进入听力练习/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '英音（Sonia）' })).toBeDisabled();
    expect(screen.queryByText(listeningMeta.title_zh)).not.toBeInTheDocument();
    expect(ctx.listQueries).toHaveLength(0);
  });

  it('口音与 kind 真的落到查询参数上，而不是前端自己瞎筛（#13）', async () => {
    const ctx = createListeningHandlers();
    server.use(...ctx.handlers);
    render(<ListeningPanel ready />);

    expect(await screen.findByText(listeningMeta.title_zh)).toBeInTheDocument();
    expect(ctx.listQueries[0]).toEqual({ accent: 'en-GB', kind: 'practice' });
    expect(screen.queryByText(mockTestMeta.title_zh)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '美音（Guy）' }));
    expect(await screen.findByText(/暂无套题/)).toBeInTheDocument();
    expect(ctx.listQueries.at(-1)).toEqual({ accent: 'en-US', kind: 'practice' });

    fireEvent.click(screen.getByRole('button', { name: '英音（Sonia）' }));
    fireEvent.click(await screen.findByRole('tab', { name: '模拟卷' }));
    expect(await screen.findByText(mockTestMeta.title_zh)).toBeInTheDocument();
    await waitFor(() => expect(ctx.listQueries.at(-1)).toEqual({ accent: 'en-GB', kind: 'mock_test' }));
  });
});

describe('AC-L1 / AC-L2 音频、倍速与逐句重听', () => {
  it('音频取回后走 blob 播放，倍速与逐句重听作用到真实播放元素', async () => {
    const ctx = createListeningHandlers();
    server.use(...ctx.handlers);
    render(<ListeningPanel ready />);
    await openSet();

    await screen.findByRole('region', { name: '听力播放器' });
    const player = within(screen.getByRole('region', { name: '听力播放器' }));
    expect(await player.findByText('音频就绪')).toBeInTheDocument();

    const element = audioElement();
    expect(element).not.toBeNull();
    expect(element?.src).toMatch(/^blob:/);
    expect(element?.src).not.toContain(`${API_BASE}/listening`);
    expect(ctx.audioCalls).toEqual([{ setId: listeningSetId, accent: 'en-GB' }]);

    fireEvent.click(screen.getByRole('button', { name: '1.25×' }));
    expect(await screen.findByText(/倍速 1\.25×/)).toBeInTheDocument();
    expect(element?.playbackRate).toBe(1.25);
    fireEvent.click(screen.getByRole('button', { name: '0.75×' }));
    await waitFor(() => expect(element?.playbackRate).toBe(0.75));

    fireEvent.click(screen.getByRole('button', { name: '继续播放' }));
    expect(await screen.findByText(/播放中不显示答案/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '暂停播放' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '重听第 2 句' }));
    await waitFor(() => expect(element?.currentTime).toBe(12));
    expect(player.getByText('0:12')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '回退 5 秒' }));
    await waitFor(() => expect(element?.currentTime).toBe(7));
    expect(player.getByText('0:07')).toBeInTheDocument();
  });
});

describe('AC-L1b 音频不可用的可见降级', () => {
  it('503 时不白屏：可读提示 + 精读入口，原文来自题面而不是 503 响应体', async () => {
    const ctx = createListeningHandlers({
      audio: 'unavailable',
      // §10.5 裁定 1：503 体不含 transcript_available，客户端也必须能回落
      audio503Body: { detail: '语音合成不可用（离线）', code: 'tts_unavailable' },
    });
    server.use(...ctx.handlers);
    render(<ListeningPanel ready />);
    await openSet();

    expect(await screen.findByText(AUDIO_UNAVAILABLE_TEXT)).toBeInTheDocument();
    // 「音频不可用」现在同时是卡头 Badge 与 §8.3 暖面磁贴的标签，整页 getByText 会两处命中；
    // 断言收紧到卡头所在的练习卡（意图不变：Badge 仍然给出降级状态）。
    const headerCard = screen.getByRole('region', { name: listeningMeta.title_zh });
    expect(within(headerCard).getByText('音频不可用')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '听力音频' })).toBeInTheDocument();
    expect(audioElement()).toBeNull();
    expect(fieldNode('q1')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: TRANSCRIPT_ENTRY_TEXT })[0]);
    expect(await screen.findByRole('region', { name: '原文精读' })).toBeInTheDocument();
    expect(screen.getByText(new RegExp(TRANSCRIPT_MARK))).toBeInTheDocument();
    // 同上：磁贴 hint 也含「已按 AC-L1b」，收紧到精读卡（意图不变：精读视图说明降级生效）。
    expect(
      within(screen.getByRole('region', { name: '原文精读' })).getByText(/已按 AC-L1b 进入原文精读模式/),
    ).toBeInTheDocument();

    answerEverything();
    fireEvent.click(screen.getByRole('button', { name: '提交批改' }));
    expect(await screen.findByText('听力批改结果')).toBeInTheDocument();
    expect(ctx.attemptCalls).toHaveLength(1);
    expect(ctx.attemptCalls[0].answers.q1).toBe(listeningAnswerKey.q1);
  });

  it('网络失败显示可读原因，后端恢复后可重试音频', async () => {
    const ctx = createListeningHandlers({ audio: 'network-error' });
    server.use(...ctx.handlers);
    render(<ListeningPanel ready />);
    await openSet();

    expect(await screen.findByRole('alert')).toHaveTextContent('无法连接后端服务');
    expect(screen.getByText('音频异常')).toBeInTheDocument();

    ctx.setAudioMode('ok');
    fireEvent.click(screen.getByRole('button', { name: '重试音频' }));
    expect(await within(screen.getByRole('region', { name: '听力播放器' })).findByText('音频就绪')).toBeInTheDocument();
    expect(audioElement()?.src).toMatch(/^blob:/);
    expect(ctx.audioCalls).toHaveLength(2);
  });
});

describe('FR-L2 / FR-L3 题型渲染与字数上限', () => {
  it('四种题型各自渲染对应控件，题号沿用官方编号 11–30，题面不含答案', async () => {
    const ctx = createListeningHandlers();
    server.use(...ctx.handlers);
    render(<ListeningPanel ready />);
    await openSet();

    expect(ctx.setCalls).toEqual([listeningSetId]);
    expect(screen.getAllByRole('radiogroup')).toHaveLength(4);
    expect(screen.getAllByRole('textbox')).toHaveLength(9);
    expect(screen.getAllByRole('combobox')).toHaveLength(7);
    expect(screen.getByText('11.')).toBeInTheDocument();
    expect(screen.getByText('30.')).toBeInTheDocument();
    expect(fieldNode('q1')).toHaveAccessibleDescription('不超过 3 词');
    expect(screen.getByText('已答 0 / 20')).toBeInTheDocument();
    expect(screen.getByText(listeningSetDoc.instruction_zh)).toBeInTheDocument();
    expect(screen.queryByText(listeningAnswerKey.q1)).not.toBeInTheDocument();
  });

  it('填空超字数上限当场可见，不必等到批改（FR-L3）', async () => {
    const ctx = createListeningHandlers();
    server.use(...ctx.handlers);
    render(<ListeningPanel ready />);
    await openSet();

    fireEvent.change(fieldNode('q1'), { target: { value: 'nine thirty in the morning' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('over_word_limit');
    expect(screen.getByText('已答 1 / 20')).toBeInTheDocument();
    expect(screen.getByText(/超出字数上限：11\./)).toBeInTheDocument();
    expect(ctx.attemptCalls).toHaveLength(0);
  });
});

describe('AC-L3 提交与批改', () => {
  it('提交体是契约 body（answers + duration_sec），批改视图按 20 题表给 band 与错因', async () => {
    const ctx = createListeningHandlers();
    server.use(...ctx.handlers);
    render(<ListeningPanel ready />);
    await openSet();

    answerEverything(['q1'], ['q18', 'q19', 'q20']);
    expect(screen.getByText('已答 17 / 20')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '提交批改' }));
    expect(await screen.findByText('听力批改结果')).toBeInTheDocument();

    const post = ctx.requests.find((request) => request.method === 'POST');
    expect(post?.url).toBe(`${API_BASE}/listening/sets/${listeningSetId}/attempt`);
    expect(Object.keys(post?.body ?? {}).sort()).toEqual(['answers', 'duration_sec']);
    expect(typeof post?.body?.duration_sec).toBe('number');
    const answers = post?.body?.answers as Record<string, string>;
    expect(Object.keys(answers)).toHaveLength(17);
    expect(answers.q1).toBe(`${listeningAnswerKey.q1} maybe`);
    expect(answers.q18).toBeUndefined();

    // 16/20 → §3-B 听力 20 题表的 7.0（后端实测锚点）
    expect(screen.getByText('Listening Band')).toBeInTheDocument();
    expect(screen.getByText('7.0')).toBeInTheDocument();
    expect(screen.getByText('共 20 题，其中 4 题需要回看')).toBeInTheDocument();
    expect(screen.getAllByText('未作答')).toHaveLength(3);
    expect(screen.getAllByText('答案不正确')).toHaveLength(1);
    expect(screen.getByText(listeningAnswerKey.q1)).toBeInTheDocument();
    expect(screen.getByText(/第 11 题自写解析占位/)).toBeInTheDocument();
  });

  it('关闭中文提示的设置会一路带到批改视图（GET /settings → AC-L4）', async () => {
    const ctx = createListeningHandlers({
      settings: { ...listeningSettings, show_chinese_hints: false },
    });
    server.use(...ctx.handlers);
    render(<ListeningPanel ready />);
    await openSet();

    answerEverything(['q1']);
    fireEvent.click(screen.getByRole('button', { name: '提交批改' }));
    expect(await screen.findByText('听力批改结果')).toBeInTheDocument();
    expect(screen.getByText(/中文解析已按设置关闭/)).toBeInTheDocument();
    expect(screen.queryByText(/第 11 题自写解析占位/)).not.toBeInTheDocument();
  });

  it('判分失败时后端 detail 可见、草稿不丢、可重试成功（CONSTITUTION §3）', async () => {
    const ctx = createListeningHandlers({
      attemptError: { status: 500, code: 'internal_error', detail: '判分服务暂不可用（测试注入）' },
    });
    server.use(...ctx.handlers);
    render(<ListeningPanel ready />);
    await openSet();

    fireEvent.change(fieldNode('q1'), { target: { value: listeningAnswerKey.q1 } });
    await waitFor(() =>
      expect(localStorage.getItem(draftStorageKey(`listening_${listeningSetId}`))).toContain(listeningAnswerKey.q1),
    );

    fireEvent.click(screen.getByRole('button', { name: '提交批改' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('判分服务暂不可用（测试注入）');
    expect(screen.queryByText('听力批改结果')).not.toBeInTheDocument();
    expect(fieldNode('q1')).toHaveValue(listeningAnswerKey.q1);
    expect(localStorage.getItem(draftStorageKey(`listening_${listeningSetId}`))).not.toBeNull();

    ctx.setAttemptError(null);
    fireEvent.click(screen.getByRole('button', { name: '提交批改' }));
    expect(await screen.findByText('听力批改结果')).toBeInTheDocument();
    expect(ctx.attemptCalls).toHaveLength(2);
    await waitFor(() => expect(localStorage.getItem(draftStorageKey(`listening_${listeningSetId}`))).toBeNull());
  });
});

describe('FR-W2 草稿恢复', () => {
  it('退出再进同一套题时答案仍在，并提示已恢复上次草稿', async () => {
    const ctx = createListeningHandlers();
    server.use(...ctx.handlers);
    render(<ListeningPanel ready />);
    await openSet();

    fireEvent.change(fieldNode('q2'), { target: { value: listeningAnswerKey.q2 } });
    await waitFor(() =>
      expect(localStorage.getItem(draftStorageKey(`listening_${listeningSetId}`))).toContain('left desk'),
    );

    // 关掉整个屏再打开（刷新/切模块回来），草稿必须从本机存储恢复
    cleanup();
    render(<ListeningPanel ready />);
    await openSet();

    expect(await screen.findByText('已恢复上次草稿')).toBeInTheDocument();
    expect(fieldNode('q2')).toHaveValue(listeningAnswerKey.q2);
    expect(screen.getByText('已答 1 / 20')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '退出' }));
    expect(await screen.findByText('选择听力套题')).toBeInTheDocument();
  });
});

describe('听力磁贴条（契约 §8.3：只在作答阶段出现）', () => {
  it('作答屏给已答/用时/可重听三块读数，音频就绪时不渲染降级块', async () => {
    const ctx = createListeningHandlers();
    server.use(...ctx.handlers);
    render(<ListeningPanel ready />);
    await openSet();

    const answered = await metric('listening.answered');
    expect(within(answered).getByText('已作答')).toBeInTheDocument();
    expect(within(answered).getByText('0/20')).toBeInTheDocument();

    const replay = await metric('listening.replay');
    expect(within(replay).getByText('4')).toBeInTheDocument();
    expect(within(replay).getByText('句')).toBeInTheDocument();

    // 时钟读数只在磁贴里出现一次：卡头那个「已用时 0:00」span 已按规则 4 删掉
    // （磁贴的 dt 是纯标签「已用时」，不带数字，所以这里匹配「标签 + 读数」连排的那个旧形态）
    expect(within(await metric('listening.elapsed')).getByText(/^\d+:\d{2}$/)).toBeInTheDocument();
    expect(screen.queryByText(/已用时\s+\d/)).not.toBeInTheDocument();

    // 分子只算 trim 后非空的题
    fireEvent.change(fieldNode('q1'), { target: { value: listeningAnswerKey.q1 } });
    expect(await within(answered).findByText('1/20')).toBeInTheDocument();
    fireEvent.change(fieldNode('q1'), { target: { value: '   ' } });
    expect(await within(answered).findByText('0/20')).toBeInTheDocument();

    const grid = await strip();
    expect(grid.querySelector('[data-metric="listening.degraded"]')).toBeNull();
    expect(grid.querySelectorAll('[data-surface="warm"]')).toHaveLength(0);
    expect(grid.querySelectorAll('[data-surface="hero"], [data-surface="solid"]')).toHaveLength(0);
  });

  it('音频 503 时唯一的暖面块是「音频不可用」，提示给出下一步（§8.3 规则 1）', async () => {
    const ctx = createListeningHandlers({ audio: 'unavailable' });
    server.use(...ctx.handlers);
    render(<ListeningPanel ready />);
    await openSet();

    const degraded = await metric('listening.degraded');
    expect(degraded).toHaveAttribute('data-surface', 'warm');
    expect(within(degraded).getByText('音频不可用')).toBeInTheDocument();
    expect(within(degraded).getByText('已按 AC-L1b 进入原文精读模式')).toBeInTheDocument();

    const grid = await strip();
    expect(grid.querySelectorAll('[data-surface="warm"]')).toHaveLength(1);
    expect(grid.querySelectorAll('[data-surface="hero"], [data-surface="solid"]')).toHaveLength(0);
    // 就绪/加载中都不该有块：没有行动价值的读数不进磁贴
    expect(grid.textContent).not.toMatch(/加载中/);
  });

  it('题面为空时仍渲染已答/用时两块（读数 0/0 是真的），没有句子就不摆重听块', async () => {
    const ctx = createListeningHandlers({ set: { ...listeningSetDoc, questions: [], sentences: [] } });
    server.use(...ctx.handlers);
    render(<ListeningPanel ready />);
    await openSet();

    const answered = await metric('listening.answered');
    expect(within(answered).getByText('0/0')).toBeInTheDocument();
    await metric('listening.elapsed');

    const grid = await strip();
    expect(grid.querySelector('[data-metric="listening.replay"]')).toBeNull();
    expect(grid.querySelectorAll('[data-surface="warm"]')).toHaveLength(0);
  });

  it('选题与批改阶段不插磁贴条（答题区版式一律不动）', async () => {
    const ctx = createListeningHandlers();
    server.use(...ctx.handlers);
    render(<ListeningPanel ready />);

    expect(await screen.findByText(listeningMeta.title_zh)).toBeInTheDocument();
    expect(screen.queryByLabelText('听力关键指标')).not.toBeInTheDocument();

    await openSet();
    answerEverything();
    fireEvent.click(screen.getByRole('button', { name: '提交批改' }));
    expect(await screen.findByText('听力批改结果')).toBeInTheDocument();
    expect(screen.queryByLabelText('听力关键指标')).not.toBeInTheDocument();
  });
});
