/**
 * 外壳「记住上次那一屏」的行为（契约 §16.3 第 7 条）。
 *
 * 这条是**真浏览器实拍**逼出来的：陪练会话接回（§16.3 第 6 条）依赖 `SparringPanel` 在树上，
 * 而刷新后外壳默认回 `overview`、口语屏默认回 `bank`，于是那条「自动接回」的 effect 一次都没跑，
 * 后端日志里连一条 `GET /sparring/sessions/{id}` 都没有。三段（view / mode / sessionId）
 * 缺任何一段，用户看到的都是「刷新后我那场对话没了」。
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import App from './App';
import { server } from './test/mocks/server';
import { resetGradingJobs } from './hooks/useGradingJobs';

const VIEW_KEY = 'ielts.view';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.removeItem(VIEW_KEY);
  resetGradingJobs();
  server.resetHandlers();
});

describe('外壳记住上次那一屏', () => {
  it('点进「设置」后刷新，仍停在设置（不是回概览）', async () => {
    render(<App />);
    const nav = await screen.findByRole('navigation', { name: '主导航' });
    await waitFor(() => expect(screen.getByText('引擎已就绪')).toBeInTheDocument(), { timeout: 10000 });
    fireEvent.click(within(nav).getByRole('button', { name: /设置/ }));
    expect(await screen.findByRole('heading', { level: 1, name: '设置' })).toBeInTheDocument();
    expect(localStorage.getItem(VIEW_KEY)).toBe('settings');
  });

  it('刷新后按本地凭据直接落在口语屏（陪练接回的前置条件）', async () => {
    localStorage.setItem(VIEW_KEY, 'speaking');
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: '口语' })).toBeInTheDocument();
  });

  it('脏值不许把应用带进空白页：回落到概览', async () => {
    localStorage.setItem(VIEW_KEY, 'not-a-view');
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: '概览' })).toBeInTheDocument();
  });

  it('切换视图会同步改写凭据（不是只在挂载时读一次）', async () => {
    render(<App />);
    const nav = await screen.findByRole('navigation', { name: '主导航' });
    await waitFor(() => expect(screen.getByText('引擎已就绪')).toBeInTheDocument(), { timeout: 10000 });
    fireEvent.click(within(nav).getByRole('button', { name: /报告/ }));
    await waitFor(() => expect(localStorage.getItem(VIEW_KEY)).toBe('report'));
  });
});
