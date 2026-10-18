/**
 * 语义色与 band 规则的唯一实现（spec-contracts.md §8）。
 * 组件侧只允许引用这里的 `var(--…)`，不得出现颜色字面量。
 */

export type Tone = 'good' | 'mid' | 'poor';

/** tone → CSS 变量名（前景/描边通用） */
export const TONE_VAR: Readonly<Record<Tone, string>> = {
  good: 'var(--band-good)',
  mid: 'var(--band-mid)',
  poor: 'var(--band-poor)',
};

export const TONE_LABEL_ZH: Readonly<Record<Tone, string>> = {
  good: '已达目标档',
  mid: '中间档',
  poor: '需重点提升',
};

/** band 三档规则：≥7 good，5.5–6.5 mid，≤5 poor（0.5 步长，无空隙） */
export function bandTone(band: number | null | undefined): Tone | null {
  if (band == null || !Number.isFinite(band)) return null;
  if (band >= 7) return 'good';
  if (band >= 5.5) return 'mid';
  return 'poor';
}

/** 0–9、0.5 步长的显示值（AC-G5：主视觉只有 band，不出现 0–100） */
export function formatBand(band: number): string {
  const clamped = Math.min(9, Math.max(0, band));
  return (Math.round(clamped * 2) / 2).toFixed(1);
}

/** 秒 → `m:ss`（题目编号/计时统一用 --font-mono） */
export function formatSeconds(total: number): string {
  const safe = Math.max(0, Math.floor(total));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** 图表多序列取色：全部来自 token，无字面色值 */
export const CHART_SERIES_VARS: readonly string[] = [
  'var(--accent)',
  'var(--band-good)',
  'var(--band-mid)',
  'var(--ink-secondary)',
  'var(--band-poor)',
];

export function seriesColor(index: number): string {
  return CHART_SERIES_VARS[index % CHART_SERIES_VARS.length];
}
