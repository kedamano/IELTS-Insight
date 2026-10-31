/**
 * `refreshHealth`（契约 §15.2 第 5 条）：改完「允许在线服务」要让右栏读数跟着变，
 * 但**不许**把界面退回启动面板 —— `state` 一旦变 `pending`，`App` 会整站换成 BootPanel，
 * 用户只是改了个开关，却看到应用「重新启动」，那是比读数陈旧更糟的错觉。
 */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useBackendReady } from './useBackendReady';
import type { HealthResponse } from '../types/ielts';

function health(ttsOk: boolean): HealthResponse {
  return {
    version: '2.1.0',
    // §15.4 引擎自证身份：mock 也要带齐，界面才分得清「就绪」与「连的是上一个实例」
    pid: 4321,
    port: 8765,
    port_source: 'probe',
    started_at: '2026-10-30T21:10:00+08:00',
    ai_configured: false,
    ai_base_url_host: null,
    whisper: { loaded: false, model: 'base' },
    tts_ok: ttsOk,
    content_counts: { speaking: 6, listening: 4, reading: 3, writing: 6 },
    storage: { state: 'ok', reason: null },
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('refreshHealth', () => {
  it('就绪后重探只替换读数，state 仍是 ready（§15.2 第 5 条）', async () => {
    const probe = vi.fn(async () => health(true));
    const { result } = renderHook(() => useBackendReady({ probe }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.health?.tts_ok).toBe(true);

    probe.mockImplementation(async () => health(false));
    await act(async () => {
      await result.current.refreshHealth();
    });

    expect(result.current.state).toBe('ready');
    expect(result.current.health?.tts_ok).toBe(false);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('重探失败保留上一次读数，不弹错也不退回启动面板', async () => {
    const probe = vi.fn(async () => health(true));
    const { result } = renderHook(() => useBackendReady({ probe }));
    await waitFor(() => expect(result.current.ready).toBe(true));

    probe.mockRejectedValueOnce(new Error('后端没应答'));
    await act(async () => {
      await result.current.refreshHealth();
    });

    expect(result.current.state).toBe('ready');
    expect(result.current.health?.tts_ok).toBe(true);
    expect(result.current.lastError).toBeNull();
  });

  it('重探不启动退避轮询（一次调用就是一次请求）', async () => {
    const probe = vi.fn(async () => health(true));
    const { result } = renderHook(() => useBackendReady({ probe, initialDelayMs: 1 }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    const before = probe.mock.calls.length;

    await act(async () => {
      await result.current.refreshHealth();
    });

    expect(probe.mock.calls.length).toBe(before + 1);
  });
});
