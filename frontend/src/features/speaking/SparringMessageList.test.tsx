/**
 * SparringMessageList 的回听行为（Wave 8：FR-S7.6「回听自己上一轮」）。
 *
 * 钉三件事：
 * 1. 有内存录音（`playback[seq]`）时，「我」那一侧出现「回听我的录音」；
 * 2. 没有录音（文本兜底 / 刷新接回）时按钮**不出现** —— 那是「没有」，不是禁用一个坏按钮；
 * 3. 点击真的用 Blob 建了一次播放（`URL.createObjectURL` + `Audio.play`），播完 revoke。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SparringMessageList from './SparringMessageList';
import type { SparringMessage } from '../../types/ielts';

const userTurn: SparringMessage = {
  seq: 1,
  role: 'user',
  text: 'I would like a table for two, please.',
  confidence: 0.9,
  duration_sec: 3,
};

const partnerTurn: SparringMessage = {
  seq: 2,
  role: 'partner',
  text: 'How many people will be joining you today?',
  source: 'fallback',
  audio_url: null,
};

let createObjectURL: ReturnType<typeof vi.fn>;
let revokeObjectURL: ReturnType<typeof vi.fn>;
let playMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  createObjectURL = vi.fn(() => 'blob:fake-url');
  revokeObjectURL = vi.fn();
  playMock = vi.fn(() => Promise.resolve());
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
  // 组件里是 `new Audio(url)`：必须替换全局构造器本身。另外组件在 `await play()` **之后**
  // 才挂 `onended`，所以这里用 setter：一被赋值就立刻触发「播完」——
  // 若在 play() 里定时触发，会抢在挂回调之前跑掉，用例永远等不到 resolve。
  class FakeAudio {
    src: string;
    play = playMock;
    pause() {
      /* noop */
    }
    set onended(cb: (() => void) | null) {
      if (cb) Promise.resolve().then(cb);
    }
    onerror: (() => void) | null = null;
    constructor(src: string) {
      this.src = src;
    }
  }
  vi.stubGlobal('Audio', FakeAudio);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SparringMessageList 回听', () => {
  it('本会话内存里有录音时，「我」那一侧出现回听按钮', () => {
    const blob = new Blob(['webm-bytes'], { type: 'audio/webm' });
    render(<SparringMessageList messages={[partnerTurn, userTurn]} playback={{ 1: blob }} />);
    expect(screen.getByRole('button', { name: '回听我的录音' })).toBeInTheDocument();
  });

  it('没有录音（文本兜底/刷新接回）时按钮不出现，也不留一个禁用的假按钮', () => {
    render(<SparringMessageList messages={[partnerTurn, userTurn]} playback={{}} />);
    expect(screen.queryByRole('button', { name: '回听我的录音' })).not.toBeInTheDocument();
    expect(screen.getByText('I would like a table for two, please.')).toBeInTheDocument();
  });

  it('点击回听：用那一段 Blob 播一次，播完释放 object URL', async () => {
    const blob = new Blob(['webm-bytes'], { type: 'audio/webm' });
    render(<SparringMessageList messages={[partnerTurn, userTurn]} playback={{ 1: blob }} />);

    fireEvent.click(screen.getByRole('button', { name: '回听我的录音' }));

    await waitFor(() => expect(playMock).toHaveBeenCalledTimes(1));
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url'));
  });

  it('陪练官一侧的朗读按钮与回听互不干扰：离线时朗读禁用并写明原因', () => {
    const blob = new Blob(['webm-bytes'], { type: 'audio/webm' });
    render(<SparringMessageList messages={[partnerTurn, userTurn]} playback={{ 1: blob }} />);
    const read = screen.getByRole('button', { name: '无音频' });
    expect(read).toBeDisabled();
    expect(read.getAttribute('title')).toContain('离线');
  });
});
