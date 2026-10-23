import { cx } from '../../components/ui';
import type { MinutesByDay } from '../../types/ielts';
import { localDateKey, safeNumber } from './format';

export interface MinutesHeatmapProps {
  /** `progressAnalytics().minutes_by_day`（后端只回有练习的日子，空白日由这里补齐）。 */
  days: ReadonlyArray<MinutesByDay>;
  /** 周数，FR-P3 固定 8 周。 */
  weeks?: number;
  /** `settings.daily_goal_minutes`：有值时按目标分档，否则按窗口内最大值分档。 */
  goalMinutes?: number | null;
  className?: string;
}

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'] as const;

/**
 * 5 档色阶只用 token（--heat-0…--heat-4）。
 * 不用「主色 + 递增透明度」：深色下 0.3 档落在卡面上只有 1.6:1，前两档会糊成一片；
 * 两套主题各自给一档实测可辨的颜色，格子本身不再需要 opacity（顺带修掉 opacity 把描边一起淡化的问题）。
 */
const LEVEL_VARS = ['var(--heat-0)', 'var(--heat-1)', 'var(--heat-2)', 'var(--heat-3)', 'var(--heat-4)'] as const;
const LEVEL_LABELS = ['无练习', '少量', '一般', '达标过半', '达标'] as const;
const LEVEL_STYLE: ReadonlyArray<{ label: string; backgroundColor: string }> = LEVEL_LABELS.map((label, index) => ({
  label,
  backgroundColor: LEVEL_VARS[index],
}));

/** 本地日历日 → 周一为一周起点（不引入日期库，纯 Date 运算）。报告屏的周柱状图共用这个周界。 */
export function startOfWeek(day: Date): Date {
  const copy = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const weekday = (copy.getDay() + 6) % 7; // 周一=0
  copy.setDate(copy.getDate() - weekday);
  return copy;
}

export interface HeatmapCell {
  date: string;
  minutes: number;
  level: number;
  future: boolean;
}

/**
 * 生成 `weeks × 7` 的格子（最后一行是当前周，含未来的日子标出来但不着色）。
 * 分档：有 `goalMinutes` 时按「目标完成度」，否则按窗口内最大值均分。
 */
export function buildHeatmapCells(
  days: ReadonlyArray<MinutesByDay>,
  weeks: number,
  goalMinutes?: number | null,
  today = new Date(),
): HeatmapCell[][] {
  const minutesOf = new Map<string, number>();
  for (const day of days) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date)) continue;
    minutesOf.set(day.date, safeNumber(day.minutes));
  }

  const windowDates = [...minutesOf.entries()]
    .filter(([date]) => minutesOf.get(date)! > 0)
    .map(([date]) => date);
  const maxValue = windowDates.reduce((max, date) => Math.max(max, minutesOf.get(date) ?? 0), 0);
  const scale = safeNumber(goalMinutes, 0) > 0 ? safeNumber(goalMinutes) : maxValue;
  const step = scale > 0 ? scale / 4 : 0;

  const firstWeek = startOfWeek(today);
  firstWeek.setDate(firstWeek.getDate() - (weeks - 1) * 7);
  const todayKey = localDateKey(today);

  const rows: HeatmapCell[][] = [];
  for (let week = 0; week < weeks; week += 1) {
    const row: HeatmapCell[] = [];
    for (let offset = 0; offset < 7; offset += 1) {
      const cell = new Date(firstWeek.getFullYear(), firstWeek.getMonth(), firstWeek.getDate() + week * 7 + offset);
      const date = localDateKey(cell);
      const minutes = minutesOf.get(date) ?? 0;
      const future = date > todayKey;
      let level = 0;
      if (!future && minutes > 0 && step > 0) {
        level = Math.min(4, Math.max(1, Math.ceil(minutes / step)));
      }
      row.push({ date, minutes, level, future });
    }
    rows.push(row);
  }
  return rows;
}

/**
 * 练习时长热力（FR-P3：近 8 周）。
 *
 * 用原生 `<table>` 而不是图表库：格值即分钟数，读屏与键盘顺序都跟视觉一致（§8 素色表格风）。
 */
export function MinutesHeatmap({ days, weeks = 8, goalMinutes, className }: MinutesHeatmapProps) {
  const rows = buildHeatmapCells(days, weeks, goalMinutes);
  const totalMinutes = days.reduce((sum, day) => sum + safeNumber(day.minutes), 0);
  const hasData = totalMinutes > 0;

  return (
    <div className={cx('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs text-ink-muted">
          近 {weeks} 周累计 {Math.round(totalMinutes)} 分钟
          {safeNumber(goalMinutes, 0) > 0 ? ` · 每日目标 ${Math.round(safeNumber(goalMinutes))} 分钟` : ''}
        </p>
        <ul className="flex items-center gap-2" aria-label="色阶图例">
          {LEVEL_STYLE.map((style) => (
            <li key={style.label} className="flex items-center gap-1 text-xs text-ink-secondary">
              <span
                aria-hidden="true"
                className="inline-block h-3 w-3 rounded-[2px] border border-rule"
                style={{ backgroundColor: style.backgroundColor }}
              />
              {style.label}
            </li>
          ))}
        </ul>
      </div>

      {!hasData ? (
        <p role="status" className="text-sm text-ink-muted">
          近 {weeks} 周尚无练习时长记录。
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="border-collapse">
            <caption className="sr-only">近 {weeks} 周每日练习分钟数（按周分行，周一为一周起点）</caption>
            <thead>
              <tr>
                <th scope="col" className="text-xs font-normal text-ink-muted">
                  周
                </th>
                {WEEKDAY_LABELS.map((label) => (
                  <th key={label} scope="col" className="px-1 text-xs font-normal text-ink-muted">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row[0].date}>
                  <th scope="row" className="pr-2 font-code text-xs font-normal text-ink-muted">
                    {row[0].date.slice(5)}
                  </th>
                  {row.map((cell) => (
                    <td key={cell.date} className="p-0.5">
                      <span
                        className={cx(
                          'flex h-5 w-5 items-center justify-center rounded-[2px] border border-rule',
                          cell.future && 'border-dashed opacity-40',
                        )}
                        style={
                          cell.future
                            ? undefined
                            : { backgroundColor: LEVEL_STYLE[cell.level].backgroundColor }
                        }
                        title={`${cell.date} · ${Math.round(cell.minutes)} 分钟`}
                      >
                        <span className="sr-only">
                          {cell.future
                            ? `${cell.date} 尚未到来`
                            : `${cell.date} ${Math.round(cell.minutes)} 分钟`}
                        </span>
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default MinutesHeatmap;
