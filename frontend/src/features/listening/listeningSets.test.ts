import { describe, expect, it } from 'vitest';
import { scaleAnchorsToDuration } from './listeningSets';
import type { SentenceAnchor } from '../../types/ielts';

function anchors(seconds: number[]): SentenceAnchor[] {
  return seconds.map((anchor_sec, idx) => ({ idx, text: `s${idx}`, anchor_sec }));
}

describe('scaleAnchorsToDuration', () => {
  it('时长未知时原样返回，不编造时间轴', () => {
    const source = anchors([0, 2.8, 10.4]);
    for (const duration of [null, undefined, 0, -3, Number.NaN]) {
      expect(scaleAnchorsToDuration(source, duration)).toEqual(source);
    }
  });

  it('空列表不炸', () => {
    expect(scaleAnchorsToDuration([], 225)).toEqual([]);
  });

  it('实测场景：末句估算 267.6s 的 39 句缩进 225s 音频内，且仍单调递增', () => {
    const step = 267.6 / 38;
    const source = anchors(Array.from({ length: 39 }, (_unused, idx) => Number((idx * step).toFixed(1))));
    const scaled = scaleAnchorsToDuration(source, 225);

    // seek 到 225s 等于 ended，所以末句必须留出余量落在音频内。
    expect(scaled[38].anchor_sec).toBeLessThan(225);
    expect(scaled[38].anchor_sec).toBeGreaterThan(200);
    for (let idx = 1; idx < scaled.length; idx += 1) {
      expect(scaled[idx].anchor_sec).toBeGreaterThanOrEqual(scaled[idx - 1].anchor_sec);
    }
    expect(scaled[0].anchor_sec).toBe(0);
  });

  it('只有两句时按「末句锚点 + 一个平均间距」推算总时长', () => {
    // 估算总长 = 40 × 2/1 = 80s，真实 20s ⇒ 缩放 0.25
    const scaled = scaleAnchorsToDuration(anchors([0, 40]), 20);
    expect(scaled.map((item) => item.anchor_sec)).toEqual([0, 10]);
  });

  it('锚点全部为 0 时无从推算，保持原值', () => {
    const source = anchors([0, 0, 0]);
    expect(scaleAnchorsToDuration(source, 30)).toEqual(source);
  });

  it('不修改入参（面板会复用同一份 sentences）', () => {
    const source = anchors([0, 10, 20]);
    scaleAnchorsToDuration(source, 10);
    expect(source[2].anchor_sec).toBe(20);
  });
});
