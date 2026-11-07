/**
 * 契约 §15.6：录音出错不许按「录完了」处理。
 *
 * 为什么要单独钉这个 hook：界面上的症状不是「报错不好看」，而是**假的成功** ——
 * `finish()` 拿当时手上的 chunk 拼出一个 blob 就当一次完整录音发布，
 * 于是出现「录音 0:12 · 34 KB」和「提交录音」按钮，用户提交一段自己不知道被截断的音频，
 * 报告屏还照一次完整作答给它打分。这种失败比报错更难发现，因为它看起来是成功的。
 *
 * 四例里最后一例是护栏：防止把修复做成「一律判失败」（那会让录音功能整个不可用）。
 */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RECORDER_ERROR_TEXT, useRecorder } from './useRecorder';
import type { RecorderStopResult, UseRecorderResult } from './useRecorder';

type StopBehavior = 'onstop' | 'onerror' | 'throw';

class FakeMediaRecorder {
  static isTypeSupported() {
    return true;
  }

  /** 本用例创建的实例（钩子里没有对外引用，测试只能从这里拿） */
  static instances: FakeMediaRecorder[] = [];

  state = 'inactive';
  mimeType = 'audio/webm';
  /** 真 MediaRecorder 停止时的报错形态：抛异常 / 派发 error / 正常派发 stop */
  stopBehavior: StopBehavior = 'onstop';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: { type: string }) => void) | null = null;

  constructor() {
    FakeMediaRecorder.instances.push(this);
  }

  start() {
    this.state = 'recording';
    // 真实现按 start(1000) 每秒给一片；这里给一片足以拼出「非空但残缺」的 blob
    this.ondataavailable?.({ data: new Blob(['webm-bytes'], { type: 'audio/webm' }) });
  }

  /** 模拟录制中途设备被拔走：派发 error，之后不再派发 stop */
  failMidway() {
    this.onerror?.({ type: 'error' });
  }

  stop() {
    if (this.stopBehavior === 'throw') {
      throw new Error('stop exploded');
    }
    this.state = 'inactive';
    if (this.stopBehavior === 'onerror') {
      this.onerror?.({ type: 'error' });
      return;
    }
    this.onstop?.();
  }

  static last(): FakeMediaRecorder {
    const instance = FakeMediaRecorder.instances[FakeMediaRecorder.instances.length - 1];
    if (!instance) throw new Error('还没有创建 MediaRecorder');
    return instance;
  }
}

/** 麦克风轨道计数：失败路径也必须把麦克风还回去（§15.6 第 3 条）。 */
let tracksStopped = 0;

beforeEach(() => {
  FakeMediaRecorder.instances = [];
  tracksStopped = 0;
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => ({
        getTracks: () => [{ kind: 'audio', stop: () => { tracksStopped += 1; } }],
      })),
    },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** 点开始并等到 `recording === true`（否则 onerror 还没地方可挂）。 */
async function startRecording(current: () => UseRecorderResult) {
  await act(async () => {
    await current().start();
  });
  await waitFor(() => expect(current().recording).toBe(true));
}

/**
 * 点停止并拿到 resolve 出来的值。
 * `let settled!` 而不是 `| null`：赋值发生在闭包里，加了 null 会被 TS 收窄成 never；
 * 而「失败时也必须 resolve」（§15.6 第 3 条）正是靠这里能不能走到断言来证明。
 */
async function clickStop(current: () => UseRecorderResult): Promise<RecorderStopResult> {
  let settled!: RecorderStopResult;
  await act(async () => {
    settled = await current().stop();
  });
  return settled;
}

it('录制中途 onerror：立即报失败、归还麦克风，不把残缺 chunk 发布成一次完整录音', async () => {
  const view = renderHook(() => useRecorder());
  await startRecording(() => view.result.current);

  act(() => {
    FakeMediaRecorder.last().failMidway();
  });

  await waitFor(() => expect(view.result.current.errorCode).toBe('recorder_failed'));
  // 失败当场可见，不是等到点停止才发现
  expect(view.result.current.recording).toBe(false);
  expect(view.result.current.error).toBeTruthy();
  expect(tracksStopped).toBeGreaterThan(0);
  // 「假的成功」就是这个按钮的来历：残缺音频一旦落进 lastResult，界面立刻给「提交录音」
  expect(view.result.current.lastResult).toBeNull();
});

it('停止时 onerror：stop() 照常 resolve，但标记 failed 且不落 lastResult', async () => {
  const view = renderHook(() => useRecorder());
  await startRecording(() => view.result.current);
  FakeMediaRecorder.last().stopBehavior = 'onerror';

  const settled = await clickStop(() => view.result.current);

  // 调用方一律 await stop()：契约选「值里带标记」而不是抛错（§15.6 第 1 条）
  expect(settled.failed).toBe(true);
  // 残缺 chunk 确实存在（size>0），所以「不许提交」只能靠 failed，不能靠 size
  expect(settled.blob.size).toBeGreaterThan(0);
  expect(view.result.current.lastResult).toBeNull();
  expect(view.result.current.errorCode).toBe('recorder_failed');
  expect(tracksStopped).toBeGreaterThan(0);
});

it('recorder.stop() 抛异常：同样按失败处理，界面卡在「录音中」不算修好', async () => {
  const view = renderHook(() => useRecorder());
  await startRecording(() => view.result.current);
  FakeMediaRecorder.last().stopBehavior = 'throw';

  const settled = await clickStop(() => view.result.current);

  expect(settled.failed).toBe(true);
  expect(view.result.current.lastResult).toBeNull();
  expect(view.result.current.recording).toBe(false);
  expect(tracksStopped).toBeGreaterThan(0);
});

it('中途出错之后再点停止：仍然返回失败的空结果，不缓存任何残缺录音', async () => {
  const view = renderHook(() => useRecorder());
  await startRecording(() => view.result.current);
  act(() => {
    FakeMediaRecorder.last().failMidway();
  });
  await waitFor(() => expect(view.result.current.errorCode).toBe('recorder_failed'));

  const settled = await clickStop(() => view.result.current);

  expect(settled.failed).toBe(true);
  expect(settled.blob.size).toBe(0);
});

it('失败文案是固定中文句子，不含异常原文（§15.5 同一条规矩）', async () => {
  expect(RECORDER_ERROR_TEXT.recorder_failed).toContain('重新录音');
  expect(RECORDER_ERROR_TEXT.recorder_failed).not.toMatch(/[A-Za-z]+Error/);
});

it('正常停止：failed === false 且 lastResult 落进（护栏：别把修复做成一律判失败）', async () => {
  const view = renderHook(() => useRecorder());
  await startRecording(() => view.result.current);

  const settled = await clickStop(() => view.result.current);

  expect(settled.failed).toBe(false);
  expect(settled.blob.size).toBeGreaterThan(0);
  expect(view.result.current.lastResult).not.toBeNull();
  expect(view.result.current.error).toBeNull();
});
