/**
 * 设置屏行为测试（契约 §1 行 2–5、§4、§10.5 裁定 4；AC-C1 / AC-C2 / AC-C3 / AC-C4、CONSTITUTION §3）。
 *
 * 核心断言不是「控件存在」，而是 AC-C1 的形状：**每个控件只 PATCH 自己那一个键**，
 * 未提供的键由后端合并保留；以及 AC-C2 的密钥纪律：`type=password`、提交即清空、
 * 只让配置状态翻转、明文永不出现在 DOM（连后端泄漏在 detail 里的明文也要被脱敏）。
 *
 * msw：只用自带的 `createSettingsHandlers`（基线 handlers 由他人并发维护）。
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '../../test/testUtils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { API_BASE } from '../../services/api';
import SettingsPage from './SettingsPage';
import { createSettingsHandlers, healthFixture, settingsFixture } from './testHandlers';

const LEAKY_KEY = 'sk-submit123456789';

function input(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`${id} 没有渲染`);
  return node;
}

/** DraftField 的保存按钮与输入框同排，按输入框定位才不会互相撞名。 */
function commitOf(id: string): HTMLButtonElement {
  const row = input(id).parentElement as HTMLElement;
  return within(row).getByRole('button', { name: /保存/ });
}

function writeInto(id: string, value: string) {
  fireEvent.change(input(id), { target: { value } });
}

function mockDevices(devices: MediaDeviceInfo[]) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { enumerateDevices: vi.fn(async () => devices) },
  });
}

function mic(deviceId: string, label: string): MediaDeviceInfo {
  return { deviceId, label, kind: 'audioinput', groupId: `group-${deviceId}` } as MediaDeviceInfo;
}

async function openSettings(options = {}) {
  const ctx = createSettingsHandlers(options);
  server.use(...ctx.handlers);
  render(<SettingsPage />);
  await screen.findByLabelText('目标 Band');
  return ctx;
}

afterEach(() => {
  cleanup();
  server.resetHandlers();
  Reflect.deleteProperty(navigator, 'mediaDevices');
});

describe('AC-C1 逐项 PATCH', () => {
  it('首屏用 GET /settings 回填每一项，而不是本地默认值', async () => {
    const ctx = await openSettings({
      settings: {
        ...settingsFixture(),
        target_band: 7,
        accent: 'en-US',
        daily_goal_minutes: 45,
        tts_speed: 1.25,
        show_punctuation: false,
        exam_date: '2026-12-01',
      },
    });

    expect(ctx.getCalls).toBeGreaterThan(0);
    expect(input('setting-target-band')).toHaveValue('7');
    expect(input('setting-accent')).toHaveValue('en-US');
    expect(input('setting-exam-date')).toHaveValue('2026-12-01');
    // type=number 的输入框 toHaveValue 返回 number，不是字符串（写成 '45' 会假失败）。
    expect(input('setting-daily-goal')).toHaveValue(45);
    expect(input('setting-tts-speed')).toHaveValue(1.25);
    expect(screen.getByLabelText('显示标点')).not.toBeChecked();
    expect(screen.getByLabelText('题目与反馈显示中文解析')).toBeChecked();
  });

  it('改动下拉与开关只发送那一个键，其余字段由后端合并保留', async () => {
    const ctx = await openSettings();

    fireEvent.change(input('setting-target-band'), { target: { value: '7' } });
    await waitFor(() => expect(ctx.patchBodies).toHaveLength(1));
    expect(ctx.patchBodies[0]).toEqual({ target_band: 7 });

    fireEvent.change(input('setting-accent'), { target: { value: 'en-US' } });
    await waitFor(() => expect(ctx.patchBodies).toHaveLength(2));
    expect(ctx.patchBodies[1]).toEqual({ accent: 'en-US' });

    fireEvent.click(screen.getByLabelText('允许在线服务'));
    await waitFor(() => expect(ctx.patchBodies).toHaveLength(3));
    expect(ctx.patchBodies[2]).toEqual({ online_enabled: false });

    expect(ctx.patchBodies.every((body) => Object.keys(body).length === 1)).toBe(true);
    expect(ctx.snapshot()).toMatchObject({
      target_band: 7,
      accent: 'en-US',
      online_enabled: false,
      daily_goal_minutes: 60,
      exam_date: '2027-01-15',
      tts_voice: 'en-GB-SoniaNeural',
    });
  });

  it('主题下拉同样只发 theme 一个键，并且立即改写 html[data-theme]', async () => {
    const ctx = await openSettings();

    fireEvent.change(input('setting-theme'), { target: { value: 'dark' } });
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
    expect(ctx.patchBodies.at(-1)).toEqual({ theme: 'dark' });

    fireEvent.change(input('setting-theme'), { target: { value: 'system' } });
    await waitFor(() => expect(ctx.patchBodies).toHaveLength(2));
    expect(ctx.patchBodies[1]).toEqual({ theme: 'system' });
    // 跟随系统在 jsdom（无真实媒体查询）里解析为浅色
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('文本项先显示未保存、点了保存才发请求，成功后显示已保存', async () => {
    const ctx = await openSettings();

    writeInto('setting-daily-goal', '90');
    expect(screen.getByText('未保存')).toBeInTheDocument();
    expect(ctx.patchBodies).toHaveLength(0);

    fireEvent.click(commitOf('setting-daily-goal'));
    await waitFor(() => expect(ctx.patchBodies).toHaveLength(1));
    expect(ctx.patchBodies[0]).toEqual({ daily_goal_minutes: 90 });
    expect(await screen.findByText('已保存')).toBeInTheDocument();
    expect(ctx.snapshot().daily_goal_minutes).toBe(90);
  });

  it('本地校验拦住注定 400 的请求：越界值不发 PATCH，错误就地可见', async () => {
    const ctx = await openSettings();

    writeInto('setting-daily-goal', '999');
    fireEvent.click(commitOf('setting-daily-goal'));

    expect(await screen.findByRole('alert')).toHaveTextContent('每日目标分钟应在 5 到 720 之间');
    expect(input('setting-daily-goal')).toHaveAttribute('aria-invalid', 'true');
    expect(ctx.patchBodies).toHaveLength(0);
  });

  it('留空提交考试日期即清除该字段（发送 null，而不是空串）', async () => {
    const ctx = await openSettings();

    writeInto('setting-exam-date', '');
    fireEvent.click(commitOf('setting-exam-date'));

    await waitFor(() => expect(ctx.patchBodies).toHaveLength(1));
    expect(ctx.patchBodies[0]).toEqual({ exam_date: null });
    await waitFor(() => expect(ctx.snapshot().exam_date).toBeNull());
  });

  it('后端 400 的 validation_failed detail 必须显示出来（CONSTITUTION §3）', async () => {
    const ctx = await openSettings({
      patchError: { status: 400, code: 'validation_failed', detail: 'accent 只能是 en-GB 或 en-US' },
    });

    fireEvent.change(input('setting-accent'), { target: { value: 'en-US' } });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('请求失败 400');
    expect(alert).toHaveTextContent('accent 只能是 en-GB 或 en-US');
    expect(ctx.patchBodies).toHaveLength(1);
    expect(input('setting-accent')).toHaveValue('en-GB');
  });

  it('GET /settings 失败时给可读原因与重试入口，而不是空表单', async () => {
    const ctx = createSettingsHandlers();
    server.use(...ctx.handlers);
    server.use(
      http.get(`${API_BASE}/settings`, () =>
        HttpResponse.json({ detail: '本机设置库被占用', code: 'internal_error' }, { status: 500 }),
      ),
    );
    render(<SettingsPage />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('本机设置库被占用');
    expect(screen.queryByLabelText('目标 Band')).not.toBeInTheDocument();

    server.resetHandlers();
    server.use(...ctx.handlers);
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByLabelText('目标 Band')).toBeInTheDocument();
  });
});

describe('AC-C2 AI 密钥只写不回读', () => {
  it('密钥框是密码框、提交即清空，只有配置状态翻转，明文不进 DOM', async () => {
    const ctx = await openSettings();
    const box = input('setting-ai-key') as HTMLInputElement;

    expect(box).toHaveAttribute('type', 'password');
    expect(box).toHaveAttribute('autocomplete', 'new-password');
    expect(box).toHaveValue('');

    fireEvent.change(box, { target: { value: LEAKY_KEY } });
    fireEvent.click(commitOf('setting-ai-key'));

    expect(await screen.findByText('已保存：后端只确认了密钥存在，没有回显内容。')).toBeInTheDocument();
    expect(ctx.putKeyBodies).toEqual([{ key: LEAKY_KEY }]);
    expect(box).toHaveValue('');
    expect(ctx.snapshot().ai).toMatchObject({ configured: true, key_source: 'settings' });

    expect(await screen.findByText('已配置')).toBeInTheDocument();
    expect(screen.getByText('密钥来源：来自本页保存')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(LEAKY_KEY);
  });

  it('按 §10.5 裁定 4：1 个字符的密钥也接受，超长与控制字符只在前端拦下', async () => {
    const ctx = await openSettings();

    writeInto('setting-ai-key', 'x');
    fireEvent.click(commitOf('setting-ai-key'));
    await waitFor(() => expect(ctx.putKeyBodies).toEqual([{ key: 'x' }]));

    writeInto('setting-ai-key', `k${'y'.repeat(300)}`);
    fireEvent.click(commitOf('setting-ai-key'));
    expect(await screen.findByRole('alert')).toHaveTextContent('密钥长度应不超过 300 个字符');

    writeInto('setting-ai-key', 'a' + String.fromCharCode(1) + 'c');
    fireEvent.click(commitOf('setting-ai-key'));
    expect(await screen.findByRole('alert')).toHaveTextContent('控制字符');
    expect(ctx.putKeyBodies).toHaveLength(1);
  });

  it('后端把明文泄漏在 detail 里时，界面上只剩脱敏文本', async () => {
    await openSettings({
      aiKeyError: { status: 400, code: 'validation_failed', detail: `AI key 校验失败：${LEAKY_KEY}` },
    });
    writeInto('setting-ai-key', LEAKY_KEY);
    fireEvent.click(commitOf('setting-ai-key'));
    expect(await screen.findByRole('alert')).toHaveTextContent('已隐藏');
    expect(document.body.textContent).not.toContain(LEAKY_KEY);
  });

  it('清除本机密钥走 DELETE，且只有 key_source=settings 时才允许点', async () => {
    const ctx = await openSettings();
    expect(screen.getByRole('button', { name: '清除本机保存的密钥' })).toBeDisabled();

    writeInto('setting-ai-key', LEAKY_KEY);
    fireEvent.click(commitOf('setting-ai-key'));
    await screen.findByText('已配置');

    fireEvent.click(screen.getByRole('button', { name: '清除本机保存的密钥' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认清除' }));
    await waitFor(() => expect(ctx.deleteCalls).toBe(1));
    expect(await screen.findByText('未配置')).toBeInTheDocument();
    expect(await screen.findByText(/已清除本机保存的密钥/)).toBeInTheDocument();
  });
});

describe('AC-C3 状态只说真话', () => {
  it('whisper 未加载时如实标注，没有假进度；/health 变化后重新读取才更新', async () => {
    const ctx = await openSettings({ health: healthFixture() });

    // /health 与 /settings 是两个独立请求，状态徽章要等 /health 回来才落地。
    expect(await screen.findByText('模型未加载（首次使用时才加载）')).toBeInTheDocument();
    expect(
      await screen.findByText('后端 2.1.0 · TTS 可用 · AI 配置 未填写（改用本地近似评分）'),
    ).toBeInTheDocument();

    ctx.setHealth({ ...healthFixture(), whisper: { loaded: true, model: 'small' }, ai_configured: true });
    fireEvent.click(screen.getByRole('button', { name: '重新读取状态' }));

    expect(await screen.findByText('模型已加载')).toBeInTheDocument();
    expect(screen.getByText(/AI 配置 已填写（端点异常时评分会标注降级原因）/)).toBeInTheDocument();
  });

  it('/health 拿不到时显示可读原因，而不是假装已就绪', async () => {
    const ctx = createSettingsHandlers();
    server.use(...ctx.handlers);
    server.use(
      http.get(`${API_BASE}/health`, () =>
        HttpResponse.json({ detail: '引擎还没起来', code: 'unavailable' }, { status: 503 }),
      ),
    );
    render(<SettingsPage />);
    await screen.findByLabelText('目标 Band');

    expect(await screen.findByText('状态未知')).toBeInTheDocument();
    expect(screen.getByText(/引擎还没起来/)).toBeInTheDocument();
  });
});

describe('AC-C4 录音输入设备', () => {
  it('列出真实输入设备，选中后只 PATCH audio_device 一个键', async () => {
    mockDevices([mic('dev-1', 'USB 麦克风'), mic('dev-2', '')]);
    const ctx = await openSettings();

    const select = input('setting-audio-device') as HTMLSelectElement;
    // enumerateDevices() 是异步的：下拉先是只有「系统默认」，等设备回来才补齐。
    await waitFor(() =>
      expect(within(select).getAllByRole('option').map((node) => node.textContent)).toEqual([
        '系统默认麦克风',
        'USB 麦克风',
        '麦克风 2（未授权时不显示名称）',
      ]),
    );

    fireEvent.change(select, { target: { value: 'dev-1' } });
    await waitFor(() => expect(ctx.patchBodies).toEqual([{ audio_device: 'dev-1' }]));
    await waitFor(() => expect(ctx.snapshot().audio_device).toBe('dev-1'));

    fireEvent.change(select, { target: { value: '' } });
    await waitFor(() => expect(ctx.patchBodies.at(-1)).toEqual({ audio_device: null }));
  });

  it('枚举不到设备时可见并给重试入口；已保存但拔掉的设备不会被悄悄改掉', async () => {
    mockDevices([]);
    const ctx = await openSettings({ settings: { ...settingsFixture(), audio_device: 'dev-gone' } });

    expect(await screen.findByText(/没有读到任何录音输入设备/)).toBeInTheDocument();
    const select = input('setting-audio-device') as HTMLSelectElement;
    expect(select).toHaveValue('dev-gone');
    expect(within(select).getByRole('option', { name: '已保存的设备（当前不可用）' })).toBeInTheDocument();
    expect(ctx.patchBodies).toHaveLength(0);
  });
});