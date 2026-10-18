/**
 * writing/testHandlers.ts —— 写作屏自己的 msw 处理器（Wave 2 约定，msw 生命周期归 `src/test/setup.ts`）。
 *
 * 不依赖 `src/test/mocks/handlers.ts` 的内容，按契约 §1 #20–#22、#21b/#22b 与 §10.1 的**实际下发形状**自备 fixture：
 * 五种 Task 1 图表（line/bar/pie/table/dynamic_chart，数值与 `backend/app/data/ielts/writing/*.json` 同源）、
 * 五类 Task 2 题型、§3-W 的 WritingReport；异步批改的 `jobs` 端点复用 `src/test/mocks/gradingJobs.ts`。
 * 题面文本由本文件自写，不含任何官方真题原文（CONSTITUTION §2）。
 */
import { HttpResponse, http } from 'msw';
import type { RequestHandler } from 'msw';
import { createJobMock } from '../../test/mocks/gradingJobs';
import type {
  ChartData,
  HealthResponse,
  WritingAttemptBody,
  WritingGradingJob,
  WritingReport,
  WritingTask,
  WritingTask1,
  WritingTask2,
} from '../../types/ielts';

export const WRITING_BASE = 'http://127.0.0.1:8765/api';

function ok<T>(data: T, init?: ResponseInit) {
  return HttpResponse.json({ data }, init);
}

export const writingHealth: HealthResponse = {
  version: '2.0.0',
  ai_configured: true,
  ai_base_url_host: 'api.example.test',
  whisper: { loaded: true, model: 'base' },
  tts_ok: true,
  content_counts: { speaking: 8, listening: 8, reading: 8, writing: 10 },
};

const meta = (id: string, title_zh: string, topic: string, target_band: number) => ({
  id,
  module: 'writing' as const,
  kind: 'practice' as const,
  target_band: target_band as WritingTask1['target_band'],
  title_zh,
  topic,
  source: 'hand',
  generated_at: '2026-10-17T12:00:00Z',
});

/**
 * 线上 `chart` 体（§10.1）比 `types/ielts.ts` 的 union 更松：`pie` 另带 `years`、
 * `table` 不带 `columns/rows`、`dynamic_chart` 不带 `frames`，三者都只给 `labels|years` + `series`。
 * 这里按**后端实际下发的形状**原样建模（数值与 `backend/app/data/ielts/writing/*.json` 同源），
 * 归一化交给渲染层的 `chartViewOf`；TS 侧只需一次显式 cast，不在业务代码里到处兜。
 */
function wireTask1(task: Omit<WritingTask1, 'chart'> & { chart: Record<string, unknown> }): WritingTask1 {
  return { ...task, chart: task.chart as unknown as ChartData };
}

export const task1Line = wireTask1({
  ...meta('wr_t1_energy_01', '四种发电方式的占比变化（折线图）', 'energy', 6.5),
  task: 'task1',
  prompt:
    'The line chart below shows how much electricity was generated from four sources in one country between 2000 and 2020.\n\nSummarise the information by selecting and reporting the main features, and make comparisons where relevant.',
  min_words: 150,
  time_recommend_sec: 1200,
  band_descriptors_ref: 'task1',
  chart: {
    type: 'line',
    unit: 'terawatt hours',
    labels: ['2000', '2005', '2010', '2015', '2020'],
    years: [2000, 2005, 2010, 2015, 2020],
    series: [
      { name: 'Coal', values: [120, 105, 88, 62, 41] },
      { name: 'Gas', values: [95, 110, 118, 125, 131] },
      { name: 'Wind and solar', values: [6, 14, 32, 68, 104] },
      { name: 'Nuclear', values: [70, 72, 68, 60, 52] },
    ],
    source_note: 'Data invented for practice; not an official statistic.',
  },
});

export const task1Bar = wireTask1({
  ...meta('wr_t1_visitors_02', '四类场馆入场人次（柱状图）', 'culture', 5.5),
  task: 'task1',
  prompt: 'The bar chart below shows the number of visits to four kinds of venue in a city in 2005 and in 2023.',
  min_words: 150,
  time_recommend_sec: 1200,
  chart: {
    type: 'bar',
    unit: 'thousand visits',
    labels: ['Museums', 'Cinemas', 'Sports stadiums', 'Public libraries'],
    years: [2005, 2023],
    series: [
      { name: '2005', values: [420, 610, 380, 260] },
      { name: '2023', values: [505, 470, 540, 190] },
    ],
  },
});

export const task1Pie = wireTask1({
  ...meta('wr_t1_commute_03', '通勤方式占比（饼图）', 'transport', 6.5),
  task: 'task1',
  prompt: 'The pie chart below shows how residents of one city travelled to work in 2025.',
  min_words: 150,
  time_recommend_sec: 1200,
  chart: {
    type: 'pie',
    unit: 'per cent',
    labels: ['Car', 'Bus or tram', 'Walking', 'Bicycle', 'Rail'],
    years: [2025],
    series: [{ name: 'Share of commuters', values: [38, 22, 18, 14, 8] }],
  },
});

export const task1Table = wireTask1({
  ...meta('wr_t1_enrolment_04', '各学院全日制学生占比（表格）', 'education', 7.5),
  task: 'task1',
  prompt:
    'The table below shows what proportion of full-time students at one university were enrolled in each faculty in 2010 and in 2020.',
  min_words: 150,
  time_recommend_sec: 1200,
  chart: {
    type: 'table',
    unit: 'per cent of all students',
    labels: ['2010', '2020'],
    years: [2010, 2020],
    series: [
      { name: 'Engineering and technology', values: [31, 38] },
      { name: 'Humanities', values: [18, 12] },
    ],
  },
});

export const task1Dynamic = wireTask1({
  ...meta('wr_t1_migration_05', '五个地区人口增长（动态图）', 'population', 6.5),
  task: 'task1',
  prompt: 'The chart below shows changes in the population living in five regions of the world between 1990 and 2020.',
  min_words: 150,
  time_recommend_sec: 1200,
  chart: {
    type: 'dynamic_chart',
    unit: 'million people',
    labels: ['1990', '2000', '2010', '2020'],
    years: [1990, 2000, 2010, 2020],
    series: [
      { name: 'Region A', values: [610, 680, 740, 790] },
      { name: 'Region E', values: [95, 110, 128, 141] },
    ],
  },
});

export const task2Agree: WritingTask2 = {
  ...meta('wr_t2_remotework_01', '远程办公对雇员更有利（同意型）', 'work', 6.5),
  task: 'task2',
  question_type: 'agree_disagree',
  prompt:
    'In many countries workers can now do the same job from home that they used to do in an office. Some people believe this change is better for employees than for employers.\n\nTo what extent do you agree or disagree?',
  min_words: 250,
  time_recommend_sec: 2400,
  outline_hint: ['State your position clearly', 'Develop two reasons with examples', 'Acknowledge the other side, then conclude'],
  band_descriptors_ref: 'task2',
};

export const task2Water: WritingTask2 = {
  ...meta('wr_t2_water_04', '家庭用水浪费的因与对策', 'environment', 5.5),
  task: 'task2',
  question_type: 'problem_solution',
  prompt: 'In many cities household water use keeps rising even though supplies are under pressure.\n\nWhat are the main causes, and what measures could reduce domestic water consumption?',
  min_words: 250,
  time_recommend_sec: 2400,
  outline_hint: ['Describe the problem', 'Causes', 'Measures'],
};

export const task2History: WritingTask2 = {
  ...meta('wr_t2_history_05', '历史课是否应当必修（两问型）', 'education', 7.5),
  task: 'task2',
  question_type: 'two_part_question',
  prompt: 'Many people believe that studying history is essential, while others think timetables should focus on subjects with clearer job prospects.\n\nWhy do some people consider history important? Should it be compulsory?',
  min_words: 250,
  time_recommend_sec: 2400,
};

export const writingTaskList: WritingTask[] = [
  task1Line,
  task1Bar,
  task1Pie,
  task1Table,
  task1Dynamic,
  task2Agree,
  task2Water,
  task2History,
];

export function writingReport(partial: Partial<WritingReport> = {}): WritingReport {
  return {
    attempt_id: 'att_wr_t2_remotework_01_01',
    task: 'task2',
    ai_used: true,
    degraded_reason: null,
    approximate: false,
    model: 'glm-4.6',
    band: {
      overall: 6.5,
      task_response: 6.5,
      coherence_cohesion: 7,
      lexical_resource: 6,
      grammatical_range_accuracy: 6,
    },
    word_count: 268,
    word_count_penalty: null,
    corrections: [
      {
        quote: 'Working from home is good for family life.',
        error_type: 'lexical',
        explanation_zh: 'good 过于笼统，应说明具体收益。',
        suggestion: 'Working from home gives families more predictable time together.',
        severity: 'medium',
      },
      {
        quote: 'people is less stressed',
        error_type: 'grammar',
        explanation_zh: '主谓一致：people 是复数。',
        suggestion: 'people are less stressed',
        severity: 'high',
      },
    ],
    upgraded_sentences: [
      { from: 'Commuting wastes time.', to: 'Daily commuting consumes hours that could be spent on work or family.', why_zh: '把抽象判断落成可衡量的收益' },
      { from: 'Companies save money.', to: 'Firms can cut overheads by leasing less office space.', why_zh: '给出机制而非结论' },
      { from: 'Teamwork is hard.', to: 'Coordinating a dispersed team demands more deliberate planning.', why_zh: '避免 over-generalisation' },
    ],
    structure_issues: [
      { kind: 'paragraph_function', issue_zh: '第二段只重复立场，没有展开论证', paragraph_index: 2 },
      { kind: 'mechanical_cohesion', issue_zh: 'First / Second / Third 之后缺段落间衔接', paragraph_index: 3 },
    ],
    strengths: ['立场明确且贯穿全文', '数据与例子贴合题目'],
    model_answer:
      'Remote working has reshaped the way many employees spend their working day, and on balance I agree that the shift favours employees more than employers.\n\nThe clearest benefit to individuals is the time recovered from commuting, which can be redirected to family or training. A second advantage is autonomy over when deep work happens.\n\nEmployers, however, are not simply losers from this change: they save on premises, although they must invest in coordination. On balance, the gains to workers remain larger.',
    error_summary: { grammar: 1, lexical: 1 },
    ...partial,
  };
}

export interface WritingAttemptCall {
  url: string;
  method: string;
  body: WritingAttemptBody;
}

export interface WritingTestContext {
  handlers: RequestHandler[];
  /** 每次 `GET /writing/tasks` 的 URL 与解析出的 module 值。 */
  taskRequests: { url: string; module: string | null }[];
  attemptCalls: WritingAttemptCall[];
  attemptGetCalls: string[];
  /** 每次 `GET /jobs/{id}` 轮询的 job_id（按顺序）。 */
  jobPolls: string[];
  /** 手动模式：把最早的未结束任务落成 succeeded，返回它的 job_id。 */
  settleJob: (report?: WritingReport) => string;
  /** 手动模式：落成 failed，`error` 即后端 `jobs.error` 原文。 */
  failJob: (error: string) => string;
}

export interface WritingHandlerOptions {
  tasks?: WritingTask[];
  /** 未按 module 过滤时的完整列表（默认用 writingTaskList） */
  report?: WritingReport;
  /** 按次返回报告；用尽后返回最后一项 */
  reports?: WritingReport[];
  attemptError?: { status: number; code: string; detail: string };
  tasksError?: { status: number; code: string; detail: string };
  /** 首次轮询即落终态（默认 true）。设 false 时任务停在「批改中」，由 `settleJob`/`failJob` 手动收尾。 */
  jobAutoSettle?: boolean;
  /** 让异步任务以 `failed` 收尾，值即后端 `jobs.error` 原文（需 jobAutoSettle）。 */
  jobError?: string;
}

export function createWritingHandlers(options: WritingHandlerOptions = {}): WritingTestContext {
  const tasks = options.tasks ?? writingTaskList;
  const reports = options.reports ?? [options.report ?? writingReport()];
  const taskRequests: { url: string; module: string | null }[] = [];
  const attemptCalls: WritingAttemptCall[] = [];
  const attemptGetCalls: string[] = [];
  let attemptIndex = 0;

  const nextReport = (): WritingReport => {
    const report = reports[Math.min(attemptIndex, reports.length - 1)];
    attemptIndex += 1;
    return report;
  };

  const jobs = createJobMock({
    base: WRITING_BASE,
    autoSettle: options.jobAutoSettle ?? true,
    reportOf: nextReport,
    jobError: options.jobError,
  });

  const errorResponse = (error: { status: number; code: string; detail: string }) =>
    HttpResponse.json({ detail: error.detail, code: error.code }, { status: error.status });

  const handlers: RequestHandler[] = [
    http.get(`${WRITING_BASE}/health`, () => ok(writingHealth)),
    http.get(`${WRITING_BASE}/writing/tasks`, ({ request }) => {
      const url = new URL(request.url);
      const module = url.searchParams.get('module');
      taskRequests.push({ url: request.url, module });
      if (options.tasksError) return errorResponse(options.tasksError);
      const items = module ? tasks.filter((task) => task.task === module) : tasks;
      return ok({ items });
    }),
    http.post(`${WRITING_BASE}/writing/attempts`, async ({ request }) => {
      const body = (await request.json()) as WritingAttemptBody;
      attemptCalls.push({ url: request.url, method: request.method, body });
      if (options.attemptError) return errorResponse(options.attemptError);
      return ok(nextReport());
    }),
    // §1 #21b：排队批改，提交即返回 job_id；报告要等轮询（契约 §10.6）
    http.post(`${WRITING_BASE}/writing/attempts/async`, async ({ request }) => {
      const body = (await request.json()) as WritingAttemptBody;
      attemptCalls.push({ url: request.url, method: request.method, body });
      if (options.attemptError) return errorResponse(options.attemptError);
      return ok(jobs.create<WritingGradingJob>('writing', body.task_id));
    }),
    ...jobs.handlers,
  ];

  return {
    handlers,
    taskRequests,
    attemptCalls,
    attemptGetCalls,
    jobPolls: jobs.polls,
    settleJob: (report?: WritingReport) => jobs.settle(report),
    failJob: jobs.fail,
  };
}
