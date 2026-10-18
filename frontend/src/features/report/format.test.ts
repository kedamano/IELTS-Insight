/**
 * 概览/报告共用格式化的行为测试（FR-P3 / AC-P3、AC-G5）。
 *
 * 核心是两条：**永远不出现 NaN / Invalid Date**，以及**时间按本地那天显示**。
 * 后者是真实回归：`PlanList` 曾用 `generated_at.slice(0,16)` 直接截 UTC 字符串，
 * 于是同一屏里「今日计划」挂在 10-18，热力图却按本地 10-19 聚合。
 */
import { describe, expect, it } from 'vitest';
import {
  bandGapHint,
  examCountdown,
  formatDateOnly,
  formatDateTime,
  formatDurationSec,
  formatMinutes,
  localDateKey,
  localDateOf,
  safeNumber,
} from './format';

describe('数值兜底（AC-P3：不许出现 NaN）', () => {
  it('非有限值一律回落，不让 NaN 流进界面', () => {
    expect(safeNumber(null, 3)).toBe(3);
    expect(safeNumber('42', 3)).toBe(3);
    expect(safeNumber(Number.NaN, 0)).toBe(0);
    expect(safeNumber(Infinity, 0)).toBe(0);
    expect(safeNumber(7.4)).toBe(7.4);
    expect(formatMinutes(Number.NaN)).toBe('0');
    expect(formatMinutes(12.6)).toBe('13');
  });

  it('用时文本区分「未记录 / 不足 1 分 / 小时+分钟」', () => {
    expect(formatDurationSec(null)).toBe('未记录用时');
    expect(formatDurationSec(0)).toBe('未记录用时');
    expect(formatDurationSec(40)).toBe('不足 1 分');
    expect(formatDurationSec(125)).toBe('2 分');
    expect(formatDurationSec(3720)).toBe('1 小时 2 分');
  });

  it('目标差说清三种情况，缺数据时不显示 NaN', () => {
    expect(bandGapHint(null, 6.5)).toBe('尚无数据');
    expect(bandGapHint(6, null)).toBe('未设置目标分');
    expect(bandGapHint(5.5, 6.5)).toBe('距目标 1.0');
    expect(bandGapHint(7, 6.5)).toBe('高于目标 0.5');
    expect(bandGapHint(6.5, 6.5)).toBe('已达目标分');
  });
});

describe('日期时间（本地日历日）', () => {
  it('空值与非法值都回落成 —，不出现 Invalid Date', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime('')).toBe('—');
    expect(formatDateTime('不是日期')).toBe('—');
    expect(formatDateOnly(undefined)).toBe('—');
    expect(formatDateOnly('2026 / 10 / 18')).toBe('—');
    expect(formatDateOnly('2026-10-18T09:00:00Z')).toBe('2026-10-18');
  });

  it('显示的日期是**本地那天**，与热力图/趋势的聚合口径一致', () => {
    const iso = '2026-10-18T23:30:00Z';
    const instant = new Date(iso);
    const out = formatDateTime(iso);

    expect(out.startsWith(`${localDateKey(instant)} `)).toBe(true);
    expect(out).toBe(`${localDateKey(instant)} ${String(instant.getHours()).padStart(2, '0')}:${String(instant.getMinutes()).padStart(2, '0')}`);
  });

  it('把显示文本按本地时间读回来，必须还原成同一时刻（截 UTC 字符串做不到）', () => {
    const iso = '2026-06-30T16:05:00Z';
    const out = formatDateTime(iso);
    expect(new Date(out.replace(' ', 'T')).getTime()).toBe(new Date(iso).getTime());
  });

  it('localDateOf 给本地日历日；formatDateOnly 只给纯日期字段用', () => {
    const iso = '2026-10-18T17:30:00+00:00';
    expect(localDateOf(iso)).toBe(localDateKey(new Date(iso)));
    // 后端时间戳带 +00:00，截字符串得到的是 UTC 那天（与本地聚合口径不一致）——只用来锁住差异
    expect(formatDateOnly(iso)).toBe('2026-10-18');
    expect(localDateOf(null)).toBe('—');
    expect(localDateOf('考试那天')).toBe('—');
  });
});

describe('考试倒计时文案（FR-P1）', () => {
  it('未设置 / 无法解析 / 已过期 / 今天 / 还有 N 天，各有可读文案', () => {
    expect(examCountdown(null, null)).toEqual({
      value: '—',
      label: '距考试（天）',
      hint: '尚未设置考试日期，可在「设置」中填写',
    });
    expect(examCountdown(Number.NaN, '2026-13-45').hint).toBe('考试日期 2026-13-45 无法解析');

    const past = examCountdown(-3, '2026-10-01');
    expect(past.value).toBe('0');
    expect(past.hint).toBe('考试日已过（2026-10-01）');

    expect(examCountdown(0, '2026-10-18').hint).toBe('今天考试');
    expect(examCountdown(21.4, '2026-11-08').value).toBe('21');
  });
});
