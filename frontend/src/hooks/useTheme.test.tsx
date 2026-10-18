/**
 * `theme` 设置的行为测试（契约 §4：`theme` 只能是 light / dark / system）。
 *
 * 这里守的是三件真会出错的事：
 * 1. 令牌值只写 `html[data-theme]`，CSS 靠它选两套取值 —— 属性没写上就是「设置了但没变」；
 * 2. 切主题必须落库（AC-C1：只发 `theme` 一个键），重启后还是用户选的那套；
 * 3. 落库失败要回滚，不能留下「界面深色、库里浅色」的假状态。
 */
import { act, renderHook } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { API_BASE } from '../services/api';
import { server } from '../test/mocks/server';
import { setPrefersDark } from '../test/matchMedia';
import useTheme, { refreshTheme } from './useTheme';

function themeAttr(): string | undefined {
  return document.documentElement.dataset.theme;
}

describe('外观主题 theme', () => {
  it('首屏解析「跟随系统」并把结果写进 html[data-theme]', async () => {
    const { result } = renderHook(() => useTheme());
    await act(async () => {
      await refreshTheme();
    });
    expect(result.current.mode).toBe('system');
    expect(result.current.resolved).toBe('light');
    expect(themeAttr()).toBe('light');
  });

  it('切到深色：立即生效且只 PATCH theme 一个键', async () => {
    const { result } = renderHook(() => useTheme());
    const patches: Record<string, unknown>[] = [];
    server.use(
      http.patch(`${API_BASE}/settings`, async ({ request }) => {
        patches.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ data: { theme: 'dark' } });
      }),
    );

    let message: string | null = '初始未调用';
    await act(async () => {
      message = await result.current.setMode('dark');
    });

    expect(message).toBeNull();
    expect(patches).toEqual([{ theme: 'dark' }]);
    expect(result.current.mode).toBe('dark');
    expect(result.current.resolved).toBe('dark');
    expect(themeAttr()).toBe('dark');
  });

  it('落库失败回滚到原主题并给出中文错误（不留假状态）', async () => {
    const { result } = renderHook(() => useTheme());
    server.use(
      http.patch(`${API_BASE}/settings`, () =>
        HttpResponse.json({ detail: '本机设置库被占用', code: 'storage_error' }, { status: 500 }),
      ),
    );

    let message: string | null | undefined;
    await act(async () => {
      message = await result.current.setMode('light');
    });

    expect(message).not.toBeNull();
    expect(String(message)).toContain('500');
    expect(result.current.mode).toBe('dark');
    expect(themeAttr()).toBe('dark');
  });

  it('跟随系统时随 Windows 明暗切换，选择本身不变', async () => {
    const { result } = renderHook(() => useTheme());
    await act(async () => {
      await result.current.setMode('system');
    });
    expect(result.current.mode).toBe('system');

    await act(async () => {
      setPrefersDark(true);
    });
    expect(result.current.resolved).toBe('dark');
    expect(themeAttr()).toBe('dark');

    await act(async () => {
      setPrefersDark(false);
    });
    expect(result.current.resolved).toBe('light');
    expect(themeAttr()).toBe('light');
  });

  it('toggle 在浅色/深色间来回切，且不会把 system 当成一个循环档位', async () => {
    const { result } = renderHook(() => useTheme());
    await act(async () => {
      await result.current.setMode('light');
    });
    await act(async () => {
      await result.current.toggle();
    });
    expect(result.current.mode).toBe('dark');
    await act(async () => {
      await result.current.toggle();
    });
    expect(result.current.mode).toBe('light');
  });

  it('库里回传未知值时按「跟随系统」处理，不把脏值写进 data-theme', async () => {
    server.use(http.get(`${API_BASE}/settings`, () => HttpResponse.json({ data: { theme: 'neon' } })));
    const { result } = renderHook(() => useTheme());
    await act(async () => {
      await refreshTheme();
    });
    expect(result.current.mode).toBe('system');
    expect(themeAttr()).toBe('light');
  });
});
