/**
 * features/report/format.ts —— 概览/报告共用的显示格式化。
 *
 * 唯一职责：把后端可能为 `null` / 缺失 / 非法的数值转成**永不出现 NaN** 的中文文案
 * （FR-P3 / AC-P3、AC-G5）。
 */

/** 安全数值：非有限值（null / undefined / NaN / 字符串）一律回落 fallback。 */
export function safeNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** 练习分钟总数（配合 `Stat` 的「分钟」单位使用）。 */
export function formatMinutes(value: unknown): string {
  return String(Math.round(safeNumber(value)));
}

/** 秒 → 用时文本（存档列表用；未记录时不显示 0 分，避免误读）。 */
export function formatDurationSec(value: unknown): string {
  const total = Math.round(safeNumber(value));
  if (total <= 0) return '未记录用时';
  // 向下取整：40 秒报「1 分」会把练习时长说多，热力图与计划差值都按这个文本读。
  const minutes = Math.floor(total / 60);
  if (minutes < 1) return '不足 1 分';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours} 小时 ${rest} 分` : `${minutes} 分`;
}

/** 本地日历日 `YYYY-MM-DD`（热力图补格与相对日期计算用）。 */
export function localDateKey(day: Date): string {
  const y = day.getFullYear();
  const m = String(day.getMonth() + 1).padStart(2, '0');
  const d = String(day.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** `YYYY-MM-DD`（容忍带时间的 ISO）；无效 → `—`。 */
export function formatDateOnly(value: string | null | undefined): string {
  if (!value) return '—';
  const datePart = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(datePart) ? datePart : '—';
}

/**
 * 时间戳 → **本地**日历日。`formatDateOnly` 截的是字符串里那段日期，而后端时间戳带 `+00:00`，
 * 用它显示 `created_at` 会把晚上 1 点加入的词记到前一天；日期类字段（考试日期）才用 `formatDateOnly`。
 */
export function localDateOf(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return formatDateOnly(value);
  return localDateKey(parsed);
}

/** ISO 时间 → 本地 `YYYY-MM-DD HH:mm`；无效 → `—`（绝不出现 Invalid Date）。 */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return formatDateOnly(value);
  // 日期部分必须取**本地**那天：`2026-10-18T17:30:00Z` 在东八区是 10-19 凌晨 1:30，
  // 直接截字符串的 UTC 日期会让练习记录挂到错误的日历日上（热力图/趋势按本地日聚合）。
  const hh = String(parsed.getHours()).padStart(2, '0');
  const mm = String(parsed.getMinutes()).padStart(2, '0');
  return `${localDateKey(parsed)} ${hh}:${mm}`;
}

export type CountdownCopy = { value: string; label: string; hint: string };

/**
 * 考试倒计时（FR-P1）。`days_left` 由后端算，前端不重复推算日期差；
 * 未设置 / 无法解析 / 已过期三种情况都要给出可读文案，不允许空白（AC-P3）。
 */
export function examCountdown(daysLeft: unknown, examDate: string | null | undefined): CountdownCopy {
  if (daysLeft === null || daysLeft === undefined || typeof daysLeft !== 'number' || !Number.isFinite(daysLeft)) {
    return {
      value: '—',
      label: '距考试（天）',
      hint: examDate ? `考试日期 ${formatDateOnly(examDate)} 无法解析` : '尚未设置考试日期，可在「设置」中填写',
    };
  }
  if (daysLeft < 0) {
    return { value: '0', label: '距考试（天）', hint: `考试日已过（${formatDateOnly(examDate)}）` };
  }
  return {
    value: String(Math.round(daysLeft)),
    label: '距考试（天）',
    hint: daysLeft === 0 ? '今天考试' : `考试日 ${formatDateOnly(examDate)}`,
  };
}

/** 当前 band 与目标差的辅助小字（null 时说清「尚无数据」，不显示 NaN）。 */
export function bandGapHint(current: number | null | undefined, target: number | null | undefined): string {
  if (current === null || current === undefined || !Number.isFinite(current)) return '尚无数据';
  if (target === null || target === undefined || !Number.isFinite(target)) return '未设置目标分';
  const gap = Math.round((target - current) * 2) / 2;
  if (gap > 0) return `距目标 ${gap.toFixed(1)}`;
  if (gap < 0) return `高于目标 ${Math.abs(gap).toFixed(1)}`;
  return '已达目标分';
}
