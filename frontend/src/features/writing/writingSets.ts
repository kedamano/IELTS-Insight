/**
 * writingSets.ts —— 写作屏的纯函数与常量（不发请求、不碰 DOM）。
 *
 * 固化 FR-W1 的两组枚举（Task 1 五类图表、Task 2 五类题型），并按契约 §10.1 的**实际下发形状**
 * 做防御性读取：`line|bar|dynamic_chart` 可能是 `{labels|years, series}`，`pie` 可能只给
 * `{labels, series:[{values}]}` 而非 `slices`，`table` 可能只给 `series` 而非 `columns/rows`，
 * `dynamic_chart` 也可能只给 `frames`。渲染层只消费 `chartViewOf()` 的归一化结果，不再各自猜字段。
 * AC-W2 的字数以 `writing_grader.count_words`（`len(text.split())`）为唯一口径，
 * 保证屏上显示的词数与后端 `word_count_penalty` 用的是同一个数（AC-W3b）。
 */
import type {
  Band,
  ChartData,
  ChartType,
  Task2QuestionType,
  WritingTask,
  WritingTask1,
  WritingTask2,
  WritingTaskKind,
  WordCountPenalty,
} from '../../types/ielts';
import { CHART_TYPES } from '../../types/ielts';

/** FR-W1 两个任务类型（§1 #20 的 `module` 取值）。 */
export const WRITING_TASK_KINDS: readonly { id: WritingTaskKind; label: string; note: string }[] = [
  { id: 'task1', label: 'Task 1', note: '图表描述 · ≥150 词 · 建议 20 分钟' },
  { id: 'task2', label: 'Task 2', note: '议论文 · ≥250 词 · 建议 40 分钟' },
];

export const CHART_TYPE_LABEL_ZH: Record<ChartType, string> = {
  line: '折线图',
  bar: '柱状图',
  pie: '饼图',
  table: '表格',
  dynamic_chart: '动态对比图',
};

export const TASK2_QUESTION_TYPE_LABEL_ZH: Record<Task2QuestionType, string> = {
  agree_disagree: '是否同意',
  discuss_both_views: '双方观点讨论',
  advantages_disadvantages: '利弊分析',
  problem_solution: '原因与解决',
  two_part_question: '两问复合',
};

/** `writing_grader.STRUCTURE_KINDS` 的四种为主，`types/ielts.ts` 的示例 key 一并覆盖，未知 key 原样显示。 */
export const STRUCTURE_ISSUE_KIND_LABEL_ZH: Record<string, string> = {
  paragraph_function: '段落功能',
  cohesion: '衔接手段',
  mechanical_cohesion: '机械衔接',
  development: '论证展开',
  length: '篇幅分布',
  position: '段落位置',
};

/** 契约 §10/产品稿的草稿 key（与听力 `listening_<set_id>` 同一命名法）。 */
export function draftKeyOf(taskId: string): string {
  return `writing_${taskId}`;
}

/** 后端 `len(text.split())` 的等价实现：任意空白分段，空串为 0。 */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/** 距最低字数还差多少（达线为 0，FR-W2 的达线提示用）。 */
export function missingWords(text: string, minWords: number | undefined): number {
  const floor = typeof minWords === 'number' && Number.isFinite(minWords) ? minWords : 0;
  return Math.max(0, floor - countWords(text));
}

export function isTask1(task: WritingTask | null | undefined): task is WritingTask1 {
  return task?.task === 'task1';
}

export function isTask2(task: WritingTask | null | undefined): task is WritingTask2 {
  return task?.task === 'task2';
}

/** §1 #20 服务端已按 `module` 过滤，这里再按 `task` 兜一层，避免后端字段缺失时串台。 */
export function tasksForKind(tasks: WritingTask[] | null | undefined, kind: WritingTaskKind): WritingTask[] {
  return (tasks ?? []).filter((task) => task.task === kind);
}

/** 选题器里的难度档：只列出本类任务真实存在的 target_band，升序。 */
export function targetBandsOf(tasks: WritingTask[]): Band[] {
  const bands = new Set<number>();
  for (const task of tasks) {
    const value = task.target_band;
    if (typeof value === 'number' && Number.isFinite(value)) bands.add(value);
  }
  return [...bands].sort((a, b) => a - b);
}

/**
 * 线上 `word_count_penalty` 比 §3-W 多的两个字段（`writing_grader.word_penalty`：另给 `min_words`
 * 与中文 `note_zh`）。`types/ielts.ts` 的 `WordCountPenalty` 只声明了 `kind/missing_words`，
 * 所以这里做一次防御性读取，把后端自己的解释原文取出来显示（CONSTITUTION §3：以后端口径为准）。
 */
export type WordCountPenaltyDetail = {
  kind: string;
  missingWords: number | null;
  minWords: number | null;
  noteZh: string | null;
};

export function penaltyDetailOf(penalty: WordCountPenalty | null | undefined): WordCountPenaltyDetail | null {
  if (!penalty) return null;
  const record = asRecord(penalty);
  return {
    kind: toLabel(record.kind) || 'under_length',
    missingWords: toNumber(record.missing_words),
    minWords: toNumber(record.min_words),
    noteZh: toLabel(record.note_zh) || null,
  };
}

// ============================================================
// 图表归一化（AC-W1：唯一数据源是 chart.data，禁止外部图片）
// ============================================================

export type ChartAxisSeries = {
  name: string;
  /** 与 `axisLabels` 等长；缺失/非数值位为 null（渲染时跳过该点，绝不画到 0 冒充数据）。 */
  values: (number | null)[];
};

export type ChartPieSlice = { label: string; value: number };

export type ChartTable = {
  /** 行首列的表头（派生自 series 名时是「项目」，显式 columns 时为空串）。 */
  leadingLabel: string;
  columns: string[];
  rows: string[][];
};

export type ChartView = {
  /** null = 后端给了无法识别的 `type`，渲染层必须走可读回落而不是空白框。 */
  type: ChartType | null;
  unit: string | null;
  sourceNote: string | null;
  axisLabels: string[];
  series: ChartAxisSeries[];
  slices: ChartPieSlice[];
  table: ChartTable | null;
  /** 归一化后仍然没有任何数值时，渲染层显示说明而不是空图。 */
  hasData: boolean;
};

const EMPTY_VIEW: ChartView = {
  type: null,
  unit: null,
  sourceNote: null,
  axisLabels: [],
  series: [],
  slices: [],
  table: null,
  hasData: false,
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function toChartType(value: unknown): ChartType | null {
  return CHART_TYPES.includes(value as ChartType) ? (value as ChartType) : null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toLabel(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function toStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(toLabel).filter((item) => item !== '') : [];
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : (Math.round(value * 100) / 100).toFixed(2).replace(/0$/, '');
}

function normalizeSeries(raw: unknown, axisLength: number): ChartAxisSeries[] {
  if (!Array.isArray(raw)) return [];
  const series: ChartAxisSeries[] = [];
  raw.forEach((item, index) => {
    const record = asRecord(item);
    const values = Array.isArray(record.values) ? record.values : [];
    const aligned: (number | null)[] = [];
    const length = Math.max(values.length, axisLength);
    for (let position = 0; position < length; position += 1) {
      aligned.push(position < values.length ? toNumber(values[position]) : null);
    }
    series.push({
      name: toLabel(record.name) || `系列 ${index + 1}`,
      values: aligned,
    });
  });
  return series;
}

/** `frames:[{label,values[]}]`（§10.1 的动态图形状）转成 x=帧标签、按 index 对齐的系列。 */
function seriesFromFrames(frames: { label: string; values: unknown[] }[]): ChartAxisSeries[] {
  const longest = frames.reduce((max, frame) => Math.max(max, frame.values.length), 0);
  const series: ChartAxisSeries[] = [];
  for (let position = 0; position < longest; position += 1) {
    const values: (number | null)[] = frames.map((frame) => toNumber(frame.values[position] ?? null));
    series.push({ name: `项目 ${position + 1}`, values });
  }
  return series;
}

function framesOf(raw: unknown): { label: string; values: unknown[] }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((frame) => {
      const record = asRecord(frame);
      return { label: toLabel(record.label), values: Array.isArray(record.values) ? record.values : [] };
    })
    .filter((frame) => frame.label !== '' || frame.values.length > 0);
}

function normalizeSlices(chart: Record<string, unknown>, axisLabels: string[], series: ChartAxisSeries[]): ChartPieSlice[] {
  const explicit = Array.isArray(chart.slices)
    ? chart.slices
        .map((slice) => {
          const record = asRecord(slice);
          return { label: toLabel(record.label), value: toNumber(record.value) };
        })
        .filter((slice): slice is ChartPieSlice => slice.label !== '' && slice.value !== null && slice.value >= 0)
    : [];
  if (explicit.length) return explicit;

  const first = series[0];
  if (first && axisLabels.length === first.values.length) {
    return first.values
      .map((value, index) => ({ label: axisLabels[index], value }))
      .filter((slice): slice is ChartPieSlice => slice.label !== '' && typeof slice.value === 'number' && slice.value >= 0);
  }

  return series
    .map((item) => ({ label: item.name, value: item.values.find((value) => value !== null) ?? 0 }))
    .filter((slice) => slice.value > 0);
}

function normalizeTable(
  chart: Record<string, unknown>,
  axisLabels: string[],
  series: ChartAxisSeries[],
): ChartTable | null {
  const columns = toStringList(chart.columns);
  const rawRows = Array.isArray(chart.rows) ? chart.rows : [];
  if (columns.length && rawRows.length) {
    const rows = rawRows.map((row) => (Array.isArray(row) ? row.map(toLabel) : []));
    return { leadingLabel: '', columns, rows };
  }
  if (!axisLabels.length || !series.length) return null;
  return {
    leadingLabel: '项目',
    columns: axisLabels,
    rows: series.map((item) => [
      item.name,
      ...item.values.map((value) => (value === null ? '—' : formatNumber(value))),
    ]),
  };
}

/** 把契约里五种互相不兼容的 chart 形状收敛成渲染层唯一可用的 `ChartView`。 */
export function chartViewOf(chart: ChartData | null | undefined): ChartView {
  const record = asRecord(chart);
  const type = toChartType(record.type);
  const unit = toLabel(record.unit) || null;
  if (!type) {
    // 类型不认识也要把 `labels/series` 读出来：渲染层需要降级成柱状图，而不是画空框（CONSTITUTION §3）。
    const unknownLabels = toStringList(record.labels).length ? toStringList(record.labels) : toStringList(record.years);
    const unknownSeries = normalizeSeries(record.series, unknownLabels.length);
    const unknownNumbers = unknownSeries.flatMap((item) => item.values).filter((value): value is number => value !== null);
    return {
      ...EMPTY_VIEW,
      unit,
      sourceNote: toLabel(record.source_note) || null,
      axisLabels: unknownLabels,
      series: unknownSeries,
      hasData: unknownNumbers.length > 0,
    };
  }

  const frames = framesOf(record.frames);
  const explicitLabels = toStringList(record.labels);
  const explicitYears = toStringList(record.years);
  const frameLabels = frames.map((frame) => frame.label).filter((label) => label !== '');

  let axisLabels = explicitLabels.length ? explicitLabels : explicitYears;
  if (!axisLabels.length && frameLabels.length) axisLabels = frameLabels;

  let series = normalizeSeries(record.series, axisLabels.length);
  if (!series.length && frames.length) series = seriesFromFrames(frames);
  if (!axisLabels.length && series.length) {
    axisLabels = Array.from({ length: series[0].values.length }, (_, index) => String(index + 1));
  }

  const slices = type === 'pie' ? normalizeSlices(record, axisLabels, series) : [];
  const table = type === 'table' ? normalizeTable(record, axisLabels, series) : null;

  const numericValues = series.flatMap((item) => item.values).filter((value): value is number => value !== null);
  const hasData =
    numericValues.length > 0 ||
    (slices.length > 0 && slices.some((slice) => slice.value > 0)) ||
    (table !== null && table.rows.some((row) => row.some((cell) => cell !== '')));

  return {
    type,
    unit,
    sourceNote: toLabel(record.source_note) || null,
    axisLabels,
    series,
    slices,
    table,
    hasData,
  };
}

/** y 轴上界：向上取到 1/2/2.5/5×10ⁿ 的干净刻度。 */
export function niceCeil(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const base = 10 ** exponent;
  for (const multiple of [1, 2, 2.5, 5, 10]) {
    if (value <= multiple * base) return multiple * base;
  }
  return 10 * base;
}

/** 图上读数：整数不带小数，小数最多两位（与表格里同一口径）。 */
export function formatChartValue(value: number): string {
  return formatNumber(value);
}

export function chartValueRange(view: ChartView): { min: number; max: number } {
  const values = view.series.flatMap((item) => item.values).filter((value): value is number => value !== null);
  if (!values.length) return { min: 0, max: 1 };
  return { min: Math.min(0, ...values), max: Math.max(...values) };
}
