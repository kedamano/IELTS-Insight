/**
 * 草稿双写（契约 §14.5 / FR-W2 扩展）的行为测试。
 *
 * 一句话动机：作文正文原本只有 WebView2 的 localStorage 一份，profile 被清理就是一篇稿子永久消失。
 * 现在学习库里多一行副本，所以本文件守的是「两份副本会不会互相打脸」：
 *
 * 1. 落盘 localStorage 的那一次必须同时发 PUT —— 否则「有副本」只是端点存在而已；
 * 2. 恢复取较新的一份，且比较的是可比的毫秒（远端 `updated_at` vs 本地 `t`）；
 * 3. 用户正在输入时远端返回，不许把没落盘的字盖掉 —— 这是唯一会让用户丢字的顺序；
 * 4. 远端不可达要**可见**（`remoteState === 'unavailable'`），同时本地照写不误；
 * 5. 提交后清草稿：本地立刻清 + 远端删不掉时记入 `pendingClear`，下次挂载补发，
 *    于是「已经交掉的作文」不会被当成草稿恢复回来。
 *
 * 全部请求由 msw 接住（`draftsHandlers`），不会打到用户真实在跑的 sidecar。
 */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { API_BASE } from '../services/api';
import { draftDeleteLog, draftWriteLog, remoteDraft, seedRemoteDraft } from '../test/mocks/handlers';
import { server } from '../test/mocks/server';
import {
  PENDING_CLEAR_STORAGE_KEY,
  draftStorageKey,
  readDraft,
  readPendingClears,
  useDraftAutosave,
} from './useDraftAutosave';

const KEY = 'writing_task2';
const MS = 60_000;

/** 相对「现在」的 ISO 时刻：远端比较用的是服务端时钟，测试里造 offsets 而不是写死日期。 */
function iso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString().replace(/\.\d{3}Z$/, '+00:00');
}

/** 直接造一份本地草稿（模拟上次会话留下的记录，含 `t` 毫秒）。 */
function seedLocal(key: string, value: string, t: number): void {
  localStorage.setItem(draftStorageKey(key), JSON.stringify({ v: value, t }));
}

function offline() {
  server.use(
    http.get(`${API_BASE}/drafts/:key`, () => HttpResponse.error()),
    http.put(`${API_BASE}/drafts/:key`, () => HttpResponse.error()),
    http.delete(`${API_BASE}/drafts/:key`, () => HttpResponse.error()),
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('草稿双写', () => {
  it('落盘本地的那一次同时发出PUT', async () => {
    const { result } = renderHook(() => useDraftAutosave(KEY, '', { delayMs: 5 }));

    act(() => result.current.setValue('In recent years, education'));

    await waitFor(() => expect(draftWriteLog()).toHaveLength(1));
    expect(draftWriteLog()[0]).toMatchObject({ key: KEY, value: 'In recent years, education' });
    expect(readDraft(KEY)?.value).toBe('In recent years, education');
    expect(remoteDraft(KEY)?.value).toBe('In recent years, education');
    await waitFor(() => expect(result.current.remoteState).toBe('available'));
  });

  it('flush立即落盘时也一样发出PUT', async () => {
    const { result } = renderHook(() => useDraftAutosave(KEY, '', { delayMs: 60_000 }));

    act(() => {
      result.current.setValue('typing when the tab closed');
      result.current.flush();
    });

    await waitFor(() => expect(draftWriteLog()).toHaveLength(1));
    expect(draftWriteLog()[0].value).toBe('typing when the tab closed');
  });

  it('远端更新时恢复远端并回填本地', async () => {
    seedLocal(KEY, 'stale local', Date.now() - 10 * MS);
    seedRemoteDraft(KEY, 'newer remote copy', iso(5 * MS));

    const { result } = renderHook(() => useDraftAutosave(KEY, '', { delayMs: 5 }));

    await waitFor(() => expect(result.current.value).toBe('newer remote copy'));
    expect(result.current.restored).toBe(true);
    // 两份都要齐：只改内存不改 localStorage 的话，下次断网就退回旧的那份
    await waitFor(() => expect(readDraft(KEY)?.value).toBe('newer remote copy'));
  });

  it('本地更新时不被远端旧副本盖掉', async () => {
    seedLocal(KEY, 'fresh local draft', Date.now());
    seedRemoteDraft(KEY, 'older remote copy', iso(-10 * MS));

    const { result } = renderHook(() => useDraftAutosave(KEY, '', { delayMs: 5 }));

    await waitFor(() => expect(result.current.remoteState).toBe('available'));
    expect(result.current.value).toBe('fresh local draft');
    expect(readDraft(KEY)?.value).toBe('fresh local draft');
  });

  it('远端返回得晚于用户输入时不覆盖正在打的字', async () => {
    seedRemoteDraft(KEY, 'arrives too late', iso(5 * MS));
    server.use(
      http.get(`${API_BASE}/drafts/:key`, async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        return HttpResponse.json({ data: { key: KEY, value: 'arrives too late', updated_at: iso(5 * MS) } });
      }),
    );

    const { result } = renderHook(() => useDraftAutosave(KEY, '', { delayMs: 5 }));

    act(() => result.current.setValue('half a sentence typed'));
    await waitFor(() => expect(result.current.remoteState).toBe('available'), { timeout: 3000 });

    expect(result.current.value).toBe('half a sentence typed');
    expect(readDraft(KEY)?.value).toBe('half a sentence typed');
  });

  it('后端不可达时状态可见且本地照写', async () => {
    offline();
    const { result } = renderHook(() => useDraftAutosave(KEY, '', { delayMs: 5 }));

    await waitFor(() => expect(result.current.remoteState).toBe('unavailable'));

    act(() => result.current.setValue('only in this browser'));

    // 本地落盘走防抖（原语义不变），这里等的是时间窗，不是「等一个可能永远不来的东西」
    await waitFor(() => expect(readDraft(KEY)?.value).toBe('only in this browser'));
    expect(draftWriteLog()).toHaveLength(0);
  });

  it('远端404算可达：本地草稿照常恢复且不报错', async () => {
    seedLocal(KEY, 'never synced', Date.now() - MS);

    const { result } = renderHook(() => useDraftAutosave(KEY, '', { delayMs: 5 }));

    await waitFor(() => expect(result.current.remoteState).toBe('available'));
    expect(result.current.value).toBe('never synced');
    expect(result.current.error).toBeNull();
  });

  it('clear本地立刻空并删掉远端副本', async () => {
    const { result } = renderHook(() => useDraftAutosave(KEY, '', { delayMs: 5 }));
    act(() => result.current.setValue('the submitted essay'));
    await waitFor(() => expect(remoteDraft(KEY)).toBeDefined());

    act(() => result.current.clear());

    expect(result.current.value).toBe('');
    expect(readDraft(KEY)).toBeNull();
    await waitFor(() => expect(remoteDraft(KEY)).toBeUndefined());
    expect(draftDeleteLog()).toContain(KEY);
    await waitFor(() => expect(readPendingClears()).not.toContain(KEY));
  });

  it('远端删不掉时记入待清除名单', async () => {
    const { result } = renderHook(() => useDraftAutosave(KEY, '', { delayMs: 5 }));
    act(() => result.current.setValue('submitted while offline'));
    await waitFor(() => expect(remoteDraft(KEY)).toBeDefined());

    offline();
    act(() => result.current.clear());

    expect(readDraft(KEY)).toBeNull();
    await waitFor(() => expect(readPendingClears()).toContain(KEY));
    expect(remoteDraft(KEY)).toBeDefined();
  });

  it('下次挂载补发没删掉的草稿，且不会把它恢复回来', async () => {
    seedRemoteDraft(KEY, 'essay submitted while offline', iso(-MS));
    localStorage.setItem(PENDING_CLEAR_STORAGE_KEY, JSON.stringify([KEY]));

    const { result } = renderHook(() => useDraftAutosave(KEY, '', { delayMs: 5 }));

    await waitFor(() => expect(readPendingClears()).not.toContain(KEY));
    expect(result.current.value).toBe('');
    expect(result.current.restored).toBe(false);
    expect(remoteDraft(KEY)).toBeUndefined();
    expect(draftDeleteLog()).toContain(KEY);
  });

  it('discardStorage另起一篇时远端副本一起删，避免下次进来又长回来', async () => {
    const { result } = renderHook(() => useDraftAutosave(KEY, '', { delayMs: 5 }));
    act(() => result.current.setValue('draft to abandon'));
    await waitFor(() => expect(remoteDraft(KEY)).toBeDefined());

    act(() => result.current.discardStorage());

    expect(result.current.value).toBe('draft to abandon'); // 保留当前输入（原有语义）
    await waitFor(() => expect(remoteDraft(KEY)).toBeUndefined());
    expect(readDraft(KEY)).toBeNull();
  });

  it('enabled=false 时完全不碰网络', async () => {
    const { result } = renderHook(() => useDraftAutosave(KEY, '', { delayMs: 5, enabled: false }));

    act(() => {
      result.current.setValue('nowhere');
      result.current.flush();
    });
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(draftWriteLog()).toHaveLength(0);
    expect(readDraft(KEY)).toBeNull();
    expect(result.current.remoteState).toBe('unknown');
  });

  it('remote=false 只写本地（留给不需要副本的调用方）', async () => {
    const { result } = renderHook(() => useDraftAutosave(KEY, '', { delayMs: 5, remote: false }));

    act(() => {
      result.current.setValue('local only by choice');
      result.current.flush();
    });
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(readDraft(KEY)?.value).toBe('local only by choice');
    expect(draftWriteLog()).toHaveLength(0);
  });

  it('切换 key 时按新 key 恢复并停掉旧 key 的写入', async () => {
    seedLocal(KEY, 'essay for task2', Date.now() - MS);
    seedLocal('writing_task1', 'chart description', Date.now() - MS);

    const { result, rerender } = renderHook(({ key }: { key: string }) => useDraftAutosave(key, '', { delayMs: 5 }), {
      initialProps: { key: KEY },
    });

    await waitFor(() => expect(result.current.value).toBe('essay for task2'));

    rerender({ key: 'writing_task1' });

    await waitFor(() => expect(result.current.value).toBe('chart description'));
    expect(draftWriteLog().every((row) => row.key !== KEY)).toBe(true);
  });
});
