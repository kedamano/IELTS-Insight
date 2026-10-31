/**
 * 外壳级集成（契约 §15.1、§15.2 第 5 条）：验的是**接线**，不是组件本身 ——
 * 那是 ErrorBoundary.test.tsx / SettingsPage.test.tsx 的活。这里钉三件事：
 * ① 一屏抛错时兜底出现且不含技术细节；② 左轨仍然可点，切到别的屏恢复正常；
 * ③ 设置里改「允许在线服务」时，外壳那份 `/health` 读数真的被重探（右栏跟着变）。
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { server } from './test/mocks/server';
import { API_BASE } from './services/api';
import { healthFixture, settingsFixture } from './features/settings/testHandlers';

// 只炸概览：Dashboard 一渲染就抛，模拟「某一屏的渲染 bug」这个真实事故形态。
vi.mock('./features/report/Dashboard', () => ({
  Dashboard: () => {
    throw new Error(
      'Cannot read properties of undefined (reading band) at Dashboard (http://127.0.0.1:5174/src/features/report/Dashboard.tsx:41:9)',
    );
  },
}));

const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

beforeEach(() => {
  consoleError.mockClear();
});

describe('App 外壳 × ErrorBoundary', () => {
  it('概览抛错时不白屏，切到「设置」照常可用', async () => {
    render(<App />);

    const title = await screen.findByText('这一屏没能显示出来', {}, { timeout: 10000 });
    expect(title.closest('[role="alert"]')).not.toBeNull();
    const panel = title.closest('[role="alert"]')!.textContent ?? '';
    expect(panel).not.toMatch(/Dashboard|http:|\.tsx|Cannot read/);

    const nav = screen.getByRole('navigation', { name: '主导航' });
    fireEvent.click(within(nav).getByRole('button', { name: /设置/ }));
    expect(await screen.findByRole('heading', { level: 1, name: '设置' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('这一屏没能显示出来')).toBeNull());

    // 切回来时边界已复位：仍然会抛，但仍然被兜住（不许把外壳打穿）
    fireEvent.click(within(nav).getByRole('button', { name: /概览/ }));
    expect(await screen.findByText('这一屏没能显示出来')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument();
  }, 20000);

  it('设置里关掉「允许在线服务」后，右栏音频合成读数跟着变（§15.2 第 5 条）', async () => {
    let ttsOk = true;
    server.use(
      http.get(`${API_BASE}/health`, () => HttpResponse.json({ data: { ...healthFixture(), tts_ok: ttsOk } })),
      http.patch(`${API_BASE}/settings`, async ({ request }) => {
        const patch = (await request.json()) as Record<string, unknown>;
        // 后端在 §15.2 之后确实这么答：用户关掉在线服务 ⇒ tts_ok 转 false
        if ('online_enabled' in patch) ttsOk = Boolean(patch.online_enabled);
        return HttpResponse.json({ data: { ...settingsFixture(), ...patch } });
      }),
    );

    render(<App />);
    const nav = screen.getByRole('navigation', { name: '主导航' });
    await waitFor(() => expect(screen.getByText('引擎已就绪')).toBeInTheDocument(), { timeout: 10000 });
    fireEvent.click(within(nav).getByRole('button', { name: /设置/ }));

    const audioRow = (await screen.findByText('音频合成')).closest('li');
    if (!audioRow) throw new Error('右栏的音频合成行结构变了');
    expect(within(audioRow).getByText('可用')).toBeInTheDocument();

    fireEvent.click(await screen.findByLabelText('允许在线服务'));
    await waitFor(() => expect(within(audioRow).getByText('不可用')).toBeInTheDocument(), { timeout: 10000 });
    expect(ttsOk).toBe(false);
  }, 20000);
});
