/**
 * types/ielts.ts —— `docs/specs/ielts/spec-contracts.md` §2/§3/§4 的 TypeScript 镜像。
 *
 * 真源是契约文件（CONSTITUTION §4）：本文件与契约不一致时，以契约为准并立刻修正本文件。
 * 命名一律保持后端 JSON 的 snake_case 字段名，避免任何转换层。
 *
 * 三条硬规则：
 * 1. `band` 一律 0–9、0.5 步长（FR-G5）。类型上宽松为 `number`（便于算术），取值域用 `BandStep` 表达。
 * 2. 所有含评分的响应必须 `extends AiMeta`（契约 §0）。
 * 3. 题面（public）类型绝不包含 `answer` / `accepted_alternatives` / `explanation_zh`；
 *    这些字段只存在于 `*WithAnswers` 与 attempt 结果里（契约 §2-L、AC §2-L）。
 */

// ============================================================
// 0. 通用（契约 §0）
// ============================================================

/** 四个考试模块。 */
export type Module = 'speaking' | 'listening' | 'reading' | 'writing';

export const MODULES: readonly Module[] = ['speaking', 'listening', 'reading', 'writing'];

export const MODULE_LABEL_ZH: Record<Module, string> = {
  speaking: '口语',
  listening: '听力',
  reading: '阅读',
  writing: '写作',
};

/** band 合法取值（0–9，步长 0.5，共 19 档）。 */
export type BandStep =
  | 0 | 0.5 | 1 | 1.5 | 2 | 2.5 | 3 | 3.5 | 4 | 4.5
  | 5 | 5.5 | 6 | 6.5 | 7 | 7.5 | 8 | 8.5 | 9;

/** 契约里所有 band 字段的运行时形态（JSON number）。取值请用 `BAND_STEPS` / `clampBand()` 约束。 */
export type Band = number;

/** 缺维度时为 `null`（AC-W3：补齐缺失维度为 null）。 */
export type NullableBand = Band | null;

export const BAND_MIN = 0;
export const BAND_MAX = 9;
export const BAND_INCREMENT = 0.5;

export const BAND_STEPS: readonly BandStep[] = [
  0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9,
];

export function isBandStep(value: unknown): value is BandStep {
  return typeof value === 'number' && Number.isFinite(value) && value >= BAND_MIN && value <= BAND_MAX
    && Math.abs(value * 2 - Math.round(value * 2)) < 1e-9;
}

/** 四舍五入到最近 0.5 档并夹紧到 0–9（总分规则）。 */
export function clampBand(value: number): Band {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value * 2) / 2;
  return Math.min(BAND_MAX, Math.max(BAND_MIN, rounded));
}

/** 落在两档之间取较低档（契约 §3-B 折算规则）。 */
export function floorBand(value: number): Band {
  if (!Number.isFinite(value)) return 0;
  return Math.min(BAND_MAX, Math.max(BAND_MIN, Math.floor(value * 2) / 2));
}

/** UI 展示：`7` → `7.0`，`6.5` → `6.5`，`null` → `—`（AC-P3 不允许 NaN/空白）。 */
export function formatBand(value: NullableBand | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toFixed(1);
}

/** AI 失败可见（CONSTITUTION §3）。`null` = 未降级。 */
export type DegradedReason =
  | 'no_api_key'
  | 'network_error'
  | 'timeout'
  | 'invalid_model_output'
  | 'incomplete_dimensions'
  | 'offline_template'
  | null;

export const DEGRADED_REASON_LABEL_ZH: Record<Exclude<DegradedReason, null>, string> = {
  no_api_key: '未配置 AI 密钥',
  network_error: '网络不可用',
  timeout: 'AI 响应超时',
  invalid_model_output: 'AI 返回格式无效',
  incomplete_dimensions: 'AI 返回维度不全',
  offline_template: '离线模板',
};

/** 展示用：`近似分` / `离线模板` / `离线近似`（CONSTITUTION §3、AC-G3）。 */
export function degradedLabelZh(meta: Pick<AiMeta, 'ai_used' | 'approximate' | 'degraded_reason'>): string {
  if (meta.ai_used) return 'AI 评分';
  if (meta.degraded_reason) return DEGRADED_REASON_LABEL_ZH[meta.degraded_reason];
  return meta.approximate ? '离线近似' : '本地评分';
}

/** 所有含评分响应的公共字段（契约 §0）。 */
export interface AiMeta {
  ai_used: boolean;
  /** AI 报告必有；客观题报告（§3-OR）示例中未给出，故为可选。 */
  degraded_reason?: DegradedReason;
  approximate: boolean;
  /** 上游模型名（如 `glm-4.6`）；离线降级时可能缺省。绝不包含密钥。 */
  model?: string | null;
}

/** 口音（契约 §4：`en-GB` / `en-US`）。 */
export type Accent = 'en-GB' | 'en-US';

/** edge-tts 音色名。 */
export type TtsVoice = string;

/** FR-L1 指定的两种默认音色。 */
export const ACCENT_VOICE: Record<Accent, TtsVoice> = {
  'en-GB': 'en-GB-SoniaNeural',
  'en-US': 'en-US-GuyNeural',
};

/** set 顶层公共字段（契约 §2）。 */
export type SetKind = 'practice' | 'mock_test';

export interface SetBase {
  id: string;
  module: Module;
  kind: SetKind;
  target_band: Band;
  title_zh: string;
  topic: string;
  /** 如 `ai:glm-4.6`（CONSTITUTION §2 溯源要求）。 */
  source: string;
  generated_at: string;
}

/** 列表端点（§1 #6/#13/#17）返回的精简元数据。 */
export interface SetMeta {
  id: string;
  module: Module;
  kind: SetKind;
  target_band: Band;
  title_zh: string;
  topic: string;
  source?: string;
  generated_at?: string;
  question_count?: number;
}

export interface ListResult<T> {
  items: T[];
  total?: number;
}

// ============================================================
// 1. 健康检查（§1 #1）
// ============================================================

export interface WhisperStatus {
  loaded: boolean;
  model: string | null;
}

export interface ContentCounts extends Record<Module, number> {}

export interface HealthResponse {
  version: string;
  ai_configured: boolean;
  /** 只暴露 host，不含 key（AC-C2）。 */
  ai_base_url_host: string | null;
  /** 契约 §1#1 有此字段、后端也回；标成可选只是为了让老的 mock fixture 不用全部改。 */
  ai_model?: string | null;
  whisper: WhisperStatus;
  tts_ok: boolean;
  content_counts: ContentCounts;
}

// ============================================================
// 2-S. 口语（契约 §2-S、§3-S）
// ============================================================

export type SpeakingPart = 1 | 2 | 3;

/** 前端渲染用的统一题面（契约 §2-S 末行）。 */
export type SpeakingPromptKind = 'question' | 'cue_card';

export interface SpeakingPrompt {
  id: string;
  part: SpeakingPart;
  kind: SpeakingPromptKind;
  /** question = 问句；cue_card = `prompt` 正文。 */
  text: string;
  /** cue_card 的 3 个提示点（FR-S1）；契约的 SpeakingPrompt 行未列，但 CueCard 渲染必需。 */
  bullets?: string[];
  preparation_sec?: number;
  speaking_sec?: number;
  /** 考官音频；离线/未合成时为 null，界面须回落到文本（AC-S6）。 */
  audio_url?: string | null;
}

export interface CueCard {
  prompt: string;
  bullets: string[];
  preparation_sec: number;
  speaking_sec: number;
}

export interface SpeakingQuestion {
  id: string;
  question: string;
  /** Part 3 追问基于 Part 2（FR-S6）。 */
  depends_on_part2?: boolean;
}

export interface SpeakingSet extends SetBase {
  module: 'speaking';
  part2: { cue_card: CueCard };
  part1: SpeakingQuestion[];
  part3: SpeakingQuestion[];
  /** 无 AI 时使用的预置追问（AC-S6）。 */
  fallback_questions: string[];
  examiner_voice: TtsVoice;
}

export interface SpeakingSetMeta extends SetMeta {
  module: 'speaking';
  parts?: SpeakingPart[];
}

export interface StartSpeakingBody {
  set_id: string;
  part: SpeakingPart;
  question_id?: string;
}

/** §1 #8：创建 session。 */
export interface SpeakingSessionStart {
  session_id: string;
  part: SpeakingPart;
  current: SpeakingPrompt;
  index: number;
  total: number;
}

/** 契约未枚举 `state` 取值，按 session 生命周期给出常见集合。 */
export type SpeakingSessionState = 'created' | 'in_progress' | 'awaiting_assess' | 'assessed' | 'closed';

export interface SpeakingTurn {
  turn_id: string;
  prompt_id?: string;
  transcript: string;
  confidence: number;
  duration_sec?: number;
  started_at?: string;
}

/** §1 #9。 */
export interface SpeakingSession {
  session_id: string;
  state: SpeakingSessionState;
  prompts: SpeakingPrompt[];
  turns: SpeakingTurn[];
  result?: SpeakingReport | null;
}

/** §1 #10：multipart `audio` 或 form `text` + `duration_sec`。 */
export interface SpeakingTurnResult {
  turn_id: string;
  transcript: string;
  confidence: number;
  next: SpeakingPrompt | null;
  /** 到达时长上限（AC-S2）。 */
  elapsed_limit_reached: boolean;
}

/** `postSpeakingTurn` 可接受的结构化入参（api.ts 会转成 FormData）。 */
export type SpeakingTurnInput =
  | { audio: Blob; durationSec: number; text?: undefined }
  | { text: string; durationSec?: number; audio?: undefined };

/** §1 #12。 */
export interface FollowupsBody {
  set_id: string;
  part2_transcript: string;
}

export interface FollowupsResult {
  questions: string[];
  ai_used?: boolean;
  degraded_reason?: DegradedReason;
}

/** 口语四维（FR-S4）。 */
export type SpeakingCriterion =
  | 'fluency_coherence'
  | 'lexical_resource'
  | 'grammatical_range_accuracy'
  | 'pronunciation';

export const SPEAKING_CRITERIA: readonly SpeakingCriterion[] = [
  'fluency_coherence',
  'lexical_resource',
  'grammatical_range_accuracy',
  'pronunciation',
];

/** FR-G4：缩写首次出现给中文注释。 */
export const SPEAKING_CRITERION_LABEL: Record<SpeakingCriterion, { abbr: string; full: string; zh: string }> = {
  fluency_coherence: { abbr: 'FC', full: 'Fluency and Coherence', zh: '流利与连贯' },
  lexical_resource: { abbr: 'LR', full: 'Lexical Resource', zh: '词汇资源' },
  grammatical_range_accuracy: { abbr: 'GRA', full: 'Grammatical Range and Accuracy', zh: '语法范围与准确度' },
  pronunciation: { abbr: 'P', full: 'Pronunciation', zh: '发音' },
};

export type PronunciationConfidence = 'high' | 'low';

export interface SpeakingBands extends Record<SpeakingCriterion, NullableBand> {
  overall: NullableBand;
  /** 无音频时由转写推断，标记为 low（FR-S4）。 */
  pronunciation_confidence?: PronunciationConfidence;
}

/** `evidence` 的 `level` 在契约里是字符串（如 `"6.0"`）。 */
export interface SpeakingEvidence {
  criterion: SpeakingCriterion;
  /** 考生原文连续片段（§3-P 规则 2 校验）。 */
  quote: string;
  why: string;
  level?: string | null;
}

export interface SpeakingImprovement {
  issue: string;
  fix: string;
  quote?: string;
}

export interface UpgradeVocabularyItem {
  from: string;
  to: string;
  note_zh?: string;
  /** FR-S5：来源须标注。 */
  source?: string | null;
}

export interface SpeakingMetrics {
  word_count: number;
  wpm: number;
  pause_total_sec: number;
  fillers: string[];
  repeats: number;
}

export interface ProblemWord {
  word: string;
  expected: string;
  actual: string;
}

/** FR-V3：仅作口语结果页「发音细节」折叠区数据源。 */
export interface PronunciationDetail {
  /** 词错误率 0–1。 */
  wer: number;
  /** 仅辅助小字（AC-G5）。 */
  score_0_100: number;
  problem_words: ProblemWord[];
}

export interface SpeakingReport extends AiMeta {
  attempt_id: string;
  module?: 'speaking';
  band: SpeakingBands;
  evidence: SpeakingEvidence[];
  strengths: string[];
  improvements: SpeakingImprovement[];
  model_answer: string;
  upgrade_vocabulary: UpgradeVocabularyItem[];
  metrics: SpeakingMetrics;
  pronunciation_detail: PronunciationDetail;
}

// ============================================================
// 题型（§2-L / §2-R / FR-L2 / FR-R1）
// ============================================================

/** 全集：听力 + 阅读出现过的所有题型。 */
export type QuestionType =
  | 'gap_fill'
  | 'multiple_choice'
  | 'matching'
  | 'map_diagram_label'
  | 'true_false_notgiven'
  | 'heading_match'
  | 'sentence_completion';

export type ListeningQuestionType =
  | 'gap_fill'
  | 'multiple_choice'
  | 'matching'
  | 'map_diagram_label';

export type ReadingQuestionType =
  | 'true_false_notgiven'
  | 'multiple_choice'
  | 'heading_match'
  | 'sentence_completion'
  | 'gap_fill';

export const QUESTION_TYPE_LABEL_ZH: Record<QuestionType, string> = {
  gap_fill: '填空',
  multiple_choice: '选择题',
  matching: '配对题',
  map_diagram_label: '地图/图表标签',
  true_false_notgiven: '判断题（TRUE/FALSE/NOT GIVEN）',
  heading_match: '段落标题匹配',
  sentence_completion: '句子完成',
};

interface QuestionBase {
  id: string;
  /** 官方题号（11、12…），用于 `1.–13.` 前缀（契约 §8）。 */
  number: number;
}

/** 题面（无答案）判别联合。 */
export interface GapFillQuestion extends QuestionBase {
  type: 'gap_fill';
  prompt: string;
  /** 字数上限，超限判 `over_word_limit`（FR-L3）。 */
  word_limit?: number;
}

export interface MultipleChoiceQuestion extends QuestionBase {
  type: 'multiple_choice';
  prompt: string;
  /** 形如 `"A. …"` 的完整选项文本。 */
  options: string[];
}

export interface MatchingQuestion extends QuestionBase {
  type: 'matching';
  prompt: string;
  /** 可重复使用的选项列表。 */
  options_list: string[];
}

export interface MapDiagramLabelQuestion extends QuestionBase {
  type: 'map_diagram_label';
  prompt: string;
  /** A/B/C 标签集合。 */
  labels: string[];
  /** 本地渲染用的示意图说明文字（禁止外链图片，契约 §2-W 同规则）。 */
  diagram_note?: string;
}

export type TfngAnswer = 'TRUE' | 'FALSE' | 'NOTGIVEN';

export interface TrueFalseNotGivenQuestion extends QuestionBase {
  type: 'true_false_notgiven';
  statement: string;
}

export interface HeadingOption {
  /** 罗马数字 `i`、`iv`… */
  i: string;
  text: string;
}

export interface HeadingMatchQuestion extends QuestionBase {
  type: 'heading_match';
  paragraph_label: string;
  options_headings: HeadingOption[];
}

export interface SentenceCompletionQuestion extends QuestionBase {
  type: 'sentence_completion';
  prompt: string;
  word_limit?: number;
}

export type ListeningQuestionPublic =
  | GapFillQuestion
  | MultipleChoiceQuestion
  | MatchingQuestion
  | MapDiagramLabelQuestion;

export type ReadingQuestionPublic =
  | TrueFalseNotGivenQuestion
  | HeadingMatchQuestion
  | SentenceCompletionQuestion
  | GapFillQuestion
  | MultipleChoiceQuestion;

export type QuestionPublic = ListeningQuestionPublic | ReadingQuestionPublic;

/**
 * 答案字段。只允许出现在后端内部内容与 attempt 结果里 —— 见 `*WithAnswers`
 * 与 `ObjectiveReportItem`（契约 §2-L「GET 响应必须剔除」）。
 */
export interface AnswerKeyFields {
  answer: string;
  accepted_alternatives: string[];
  explanation_zh: string;
  /** tfng 的 A/B/C 之类映射标签。 */
  answer_label?: string;
  answer_paragraph?: string;
  answer_quote?: string;
}

export type ListeningQuestionWithAnswers = ListeningQuestionPublic & Partial<AnswerKeyFields>;
export type ReadingQuestionWithAnswers = ReadingQuestionPublic & Partial<AnswerKeyFields>;

// ============================================================
// 2-L. 听力（契约 §2-L、§1 #13–#16）
// ============================================================

/** 逐句重听时间轴锚点（FR-L4）。 */
export interface SentenceAnchor {
  idx: number;
  text: string;
  anchor_sec: number;
}

export interface ListeningSet extends SetBase {
  module: 'listening';
  section: number;
  instruction_zh: string;
  /** AC-L1b 的「原文精读模式」数据源，题面接口保留。 */
  audio_text: string;
  sentences: SentenceAnchor[];
  /** 不含答案（§2-L）。 */
  questions: ListeningQuestionPublic[];
  accent?: Accent;
}

/** 仅后端内部/attempt 结果使用：题面 + 答案。 */
export interface ListeningSetWithAnswers extends Omit<ListeningSet, 'questions'> {
  questions: ListeningQuestionWithAnswers[];
}

export interface ListeningSetMeta extends SetMeta {
  module: 'listening';
  section?: number;
  accent?: Accent;
  duration_sec?: number;
}

export interface ListeningSetsQuery {
  accent?: Accent;
  kind?: SetKind;
}

// ============================================================
// 2-R. 阅读（契约 §2-R、§1 #17–#19）
// ============================================================

/** §2-R 示例值 `upper-intermediate`；其余取 CEFR 常见档位。 */
export type ReadingLevel = 'beginner' | 'intermediate' | 'upper-intermediate' | 'advanced';

export interface PassageParagraph {
  label: string;
  text: string;
}

export interface ReadingSet extends SetBase {
  module: 'reading';
  level: ReadingLevel;
  title: string;
  time_limit_sec: number;
  word_count: number;
  passage: { paragraphs: PassageParagraph[] };
  /** 不含答案（§2-R）。 */
  questions: ReadingQuestionPublic[];
}

export interface ReadingSetWithAnswers extends Omit<ReadingSet, 'questions'> {
  questions: ReadingQuestionWithAnswers[];
}

export interface ReadingSetMeta extends SetMeta {
  module: 'reading';
  level?: ReadingLevel;
  time_limit_sec?: number;
  word_count?: number;
}

export interface ReadingSetsQuery {
  level?: ReadingLevel;
}

// ============================================================
// 2-W. 写作（契约 §2-W、§3-W、FR-W1/W3）
// ============================================================

export type WritingTaskKind = 'task1' | 'task2';

/** FR-W1 Task 2 五类。 */
export type Task2QuestionType =
  | 'agree_disagree'
  | 'discuss_both_views'
  | 'advantages_disadvantages'
  | 'problem_solution'
  | 'two_part_question';

/** FR-W1 五类图表；`chart.type` 是判别字段。 */
export type ChartType = 'line' | 'bar' | 'pie' | 'table' | 'dynamic_chart';

export const CHART_TYPES: readonly ChartType[] = ['line', 'bar', 'pie', 'table', 'dynamic_chart'];

export interface ChartSeries {
  name: string;
  values: (number | null)[];
}

interface ChartCommon {
  unit?: string | null;
  source_note?: string | null;
  /** 通用 x 轴/图例标签；`years` 缺省时用它。 */
  labels?: (string | number)[];
}

export interface LineChart extends ChartCommon {
  type: 'line';
  years?: (string | number)[];
  series: ChartSeries[];
}

export interface BarChart extends ChartCommon {
  type: 'bar';
  years?: (string | number)[];
  series: ChartSeries[];
  /** 横向条形图（可选）。 */
  horizontal?: boolean;
}

export interface PieChart extends ChartCommon {
  type: 'pie';
  slices: { label: string; value: number }[];
  /** 兼容后端复用 `series`（单系列）的情况。 */
  series?: ChartSeries[];
}

export interface TableChart extends ChartCommon {
  type: 'table';
  columns: string[];
  rows: (string | number)[][];
  years?: (string | number)[];
  series?: ChartSeries[];
}

/** 动态图（随时间变化的多帧对比）。 */
export interface DynamicChart extends ChartCommon {
  type: 'dynamic_chart';
  frames: { label: string; values: number[] }[];
  series?: ChartSeries[];
  years?: (string | number)[];
}

export type ChartData = LineChart | BarChart | PieChart | TableChart | DynamicChart;

interface WritingTaskBase extends SetBase {
  module: 'writing';
  prompt: string;
  min_words: number;
  time_recommend_sec: number;
  band_descriptors_ref?: string;
}

export interface WritingTask1 extends WritingTaskBase {
  task: 'task1';
  /** 本地 SVG 渲染的唯一数据源（AC-W1，禁止外部图片 URL）。 */
  chart: ChartData;
}

export interface WritingTask2 extends WritingTaskBase {
  task: 'task2';
  question_type: Task2QuestionType;
  outline_hint?: string[];
}

export type WritingTask = WritingTask1 | WritingTask2;

export type WritingTasksQuery = WritingTaskKind | { module: WritingTaskKind };

export type WritingCriterion =
  | 'task_response'
  | 'coherence_cohesion'
  | 'lexical_resource'
  | 'grammatical_range_accuracy';

export const WRITING_CRITERIA: readonly WritingCriterion[] = [
  'task_response',
  'coherence_cohesion',
  'lexical_resource',
  'grammatical_range_accuracy',
];

/** FR-G4：TR/CC/LR/GRA 中文注释。 */
export const WRITING_CRITERION_LABEL: Record<WritingCriterion, { abbr: string; full: string; zh: string }> = {
  task_response: { abbr: 'TR', full: 'Task Achievement / Response', zh: '任务回应' },
  coherence_cohesion: { abbr: 'CC', full: 'Coherence and Cohesion', zh: '连贯与衔接' },
  lexical_resource: { abbr: 'LR', full: 'Lexical Resource', zh: '词汇资源' },
  grammatical_range_accuracy: { abbr: 'GRA', full: 'Grammatical Range and Accuracy', zh: '语法范围与准确度' },
};

export interface WritingBands extends Record<WritingCriterion, NullableBand> {
  overall: NullableBand;
}

/** FR-W4 七类错误。 */
export type WritingErrorType =
  | 'grammar'
  | 'lexical'
  | 'collocation'
  | 'punctuation'
  | 'spelling'
  | 'task_response'
  | 'cohesion';

export const WRITING_ERROR_TYPES: readonly WritingErrorType[] = [
  'grammar',
  'lexical',
  'collocation',
  'punctuation',
  'spelling',
  'task_response',
  'cohesion',
];

export const WRITING_ERROR_LABEL_ZH: Record<WritingErrorType, string> = {
  grammar: '语法',
  lexical: '词汇',
  collocation: '搭配',
  punctuation: '标点',
  spelling: '拼写',
  task_response: '任务回应',
  cohesion: '衔接',
};

/** 契约只示范 `high`，此处补全三档。 */
export type CorrectionSeverity = 'high' | 'medium' | 'low';

export interface WritingCorrection {
  quote: string;
  error_type: WritingErrorType;
  explanation_zh: string;
  suggestion: string;
  severity: CorrectionSeverity;
}

export interface UpgradedSentence {
  from: string;
  to: string;
  why_zh: string;
}

/** `kind` 契约只示范 `paragraph_function`，保留字符串扩展。 */
export interface StructureIssue {
  kind: 'paragraph_function' | 'mechanical_cohesion' | 'length' | 'position' | string;
  issue_zh: string;
  paragraph_index?: number;
}

/** AC-W3b：未达字数时的硬性提示（此时 `band.task_response` 上限夹到 5.0）。 */
export interface WordCountPenalty {
  kind: 'under_length';
  missing_words: number;
  /** 官方最低词数（后端同一版本起才回传；更早的 attempts 记录里没有）。 */
  min_words?: number;
  note_zh?: string;
}

export interface WritingReport extends AiMeta {
  attempt_id: string;
  task: WritingTaskKind;
  band: WritingBands;
  word_count: number;
  word_count_penalty: WordCountPenalty | null;
  corrections: WritingCorrection[];
  upgraded_sentences: UpgradedSentence[];
  structure_issues: StructureIssue[];
  strengths: string[];
  /** 范文（Task1 ≥150 词、Task2 ≥260 词，FR-W3）。 */
  model_answer: string;
  error_summary: Partial<Record<WritingErrorType, number>>;
}

export interface WritingAttemptBody {
  task_id: string;
  response: string;
  duration_sec: number;
  draft_saved_at?: string | null;
}

// ============================================================
// 3-OR. 客观题报告（听力/阅读共用，契约 §3-OR）
// ============================================================

/** 题面作答映射：`{qid: string}`。未答用空串或省略。 */
export type AnswerMap = Record<string, string>;

export interface ObjectiveAttemptBody {
  answers: AnswerMap;
  duration_sec: number;
  /** 阅读到点自动提交（AC-R3）。 */
  timed_out?: boolean;
}

/** `reason` 取值（§3-OR）。答对时后端可能省略/null。 */
export type ObjectiveItemReason =
  | 'wrong'
  | 'over_word_limit'
  | 'unanswered'
  | 'spelling_variant_rejected';

export interface ObjectiveReportItem {
  id: string;
  number: number;
  type: QuestionType;
  your_answer: string | null;
  expected: string | null;
  accepted_alternatives?: string[];
  correct: boolean;
  reason?: ObjectiveItemReason | null;
  /** AC-R4：错题必须有非空中文解析。 */
  explanation_zh?: string;
  answer_quote?: string;
  answer_paragraph?: string;
  time_spent_sec?: number;
}

export interface QuestionTypeTally {
  correct: number;
  total: number;
}

export type BandScale = 'listening_20q' | 'listening_40q' | 'reading_13q' | 'reading_40q';

interface ObjectiveReportBase extends AiMeta {
  attempt_id: string;
  raw_correct: number;
  raw_total: number;
  /** 客观题为标量 band（口语/写作用对象）。 */
  band: Band;
  band_scale: BandScale;
  items: ObjectiveReportItem[];
  by_question_type: Partial<Record<QuestionType, QuestionTypeTally>>;
  /** 0–1。 */
  accuracy: number;
}

export interface ListeningObjectiveReport extends ObjectiveReportBase {
  module: 'listening';
  /** AC-L2：听力回传原文，供精读模式。 */
  transcript?: string | null;
}

export interface ReadingObjectiveReport extends ObjectiveReportBase {
  module: 'reading';
  timed_out?: boolean;
}

export type ObjectiveReport = ListeningObjectiveReport | ReadingObjectiveReport;

// ============================================================
// attempts / progress / plan / review / vocab / settings
// ============================================================

/** 各维度 band（DB `band_sub_json`）。 */
export type BandSub = Partial<Record<SpeakingCriterion | WritingCriterion | string, NullableBand>>;

/** §1 #23/#24 列表项。DB 主键列名是 `id`，报告里是 `attempt_id`，此处跟随 DB。 */
export interface AttemptSummary extends AiMeta {
  id: string;
  module: Module;
  task_ref: string;
  part: string | null;
  /** 列表展示用的补充标题（后端可缺省，前端回落到 `task_ref`）。 */
  title_zh?: string | null;
  topic?: string | null;
  band_overall: NullableBand;
  band_sub: BandSub | null;
  raw_correct?: number | null;
  raw_total?: number | null;
  duration_sec: number | null;
  started_at: string | null;
  created_at: string;
}

/** 任一模块的完整报告。 */
export type ModuleReport = SpeakingReport | WritingReport | ObjectiveReport;

/**
 * 契约 §10.6 `JobView`：异步批改任务（FR-W3「提交后先做别的」）。
 * 状态机 `queued → running → succeeded | failed`；只有写作与口语走这条路，
 * 因为只有这两科的耗时来自 LLM（实测推理模型批改一篇 Task 2 要 133s）。
 */
export type GradingJobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface GradingJob<R extends ModuleReport = ModuleReport> {
  job_id: string;
  module: Extract<Module, 'speaking' | 'writing'>;
  /** 写作是 task_id，口语是 session_id。 */
  task_ref: string;
  status: GradingJobStatus;
  attempt_id: string | null;
  /** 成功时的完整报告，与同步批改端点同形状（前端拿到即可直接渲染）。 */
  report: R | null;
  /** `failed` 时的中文可读原因；`error` 为空而状态是 failed 属于后端违约。 */
  error: string | null;
  degraded_reason: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export type WritingGradingJob = GradingJob<WritingReport>;
export type SpeakingGradingJob = GradingJob<SpeakingReport>;

export function isJobSettled(status: GradingJobStatus): boolean {
  return status === 'succeeded' || status === 'failed';
}

/** §1 #24：`{attempt, payload}`。`payload` 的模块由 `attempt.module` 决定，用下面的守卫收窄。 */
export interface AttemptDetail {
  attempt: AttemptSummary;
  payload: ModuleReport;
}

export interface AttemptsQuery {
  module?: Module;
  limit?: number;
  offset?: number;
}

export interface AttemptListResult extends ListResult<AttemptSummary> {}

/** §1 #26。 */
export interface ProgressSummary {
  target_band: Band;
  exam_date: string | null;
  days_left: number | null;
  current: Record<Module, NullableBand>;
  delta_vs_previous: Record<Module, number | null>;
  attempts_total: number;
  minutes_total: number;
  last_practice_at: string | null;
}

/** §1 #27。 */
export interface TrendPoint {
  date: string;
  band: Band;
}

export interface ProgressTrend {
  points: TrendPoint[];
}

export interface TrendQuery {
  module?: Module;
  days?: number;
}

/** §1 #28。 */
export interface AccuracyByQuestionType {
  question_type: QuestionType;
  correct: number;
  total: number;
  accuracy: number;
}

/**
 * §1 #28 的 `by_module`：只有客观题两科（听力/阅读）有逐题对错，
 * 所以这里刻意不用 `Module` 而是它的一个子集类型；缺某科就是数组里没有该项，不是 0。
 */
export interface AccuracyByModule {
  module: 'listening' | 'reading';
  correct: number;
  total: number;
  accuracy: number;
}

/**
 * 错题/错误的类型。写作有固定 7 类（FR-W4）；听力/阅读/口语由后端归类，
 * 因此这里放宽为 string（见 `WRITING_ERROR_TYPES` 常量）。
 */
export type ErrorType = string;

export interface ErrorTypeStat {
  error_type: ErrorType;
  count: number;
  latest_quote: string;
}

export interface MinutesByDay {
  date: string;
  minutes: number;
}

export interface Analytics {
  by_question_type: AccuracyByQuestionType[];
  by_module: AccuracyByModule[];
  by_error_type: ErrorTypeStat[];
  minutes_by_day: MinutesByDay[];
}

export interface AnalyticsQuery {
  weeks?: number;
}

/** §1 #29 + `plan_tasks` 表。 */
export interface PlanTask {
  id: string;
  date: string;
  module: Module;
  set_ref: string;
  reason_zh: string;
  done: boolean;
}

export interface PlanTodayResult {
  items: PlanTask[];
  generated_at: string;
}

export interface PlanDoneBody {
  done: boolean;
}

/** §1 #31 + `review_items` 表（FR-V2：手动「已掌握」）。 */
export type ReviewStatus = 'open' | 'resolved';

export interface ReviewItem {
  id: string;
  module: Module;
  item_ref: string;
  question_type: QuestionType | null;
  error_type: ErrorType;
  quote: string;
  detail_zh: string;
  status: ReviewStatus;
  first_seen_at: string;
  last_seen_at: string;
  seen_count: number;
  resolved_at: string | null;
  source_attempt_id: string | null;
}

export interface ReviewQuery {
  module?: Module;
  status?: ReviewStatus;
  error_type?: ErrorType;
}

// ============================================================
// 词汇（§1 #34–#38、FR-V1/V3）
// ============================================================

export interface PhonemeTip {
  phoneme: string;
  tip: string;
}

/** #34：沿用现有 WordInfo 结构 + 三个新字段。 */
export interface WordInfo {
  word: string;
  phonetic: string;
  zh: string;
  difficulty: number;
  examples: string[];
  source: string;
  audio_url?: string | null;
  collocations?: string[];
  topic?: string | null;
  pronunciation_tips?: PhonemeTip[];
}

/** #35：生词本条目。 */
export interface VocabNote {
  word: string;
  /** 出处句子（AC-V1）。 */
  context: string;
  source_module: Module | null;
  source_ref: string | null;
  note_zh: string;
  tags: string[];
  created_at?: string;
  /** `vocab.phonetics_json` 解出的详情，可缺省。 */
  phonetics?: WordInfo | null;
}

export interface VocabAddBody {
  word: string;
  context: string;
  source_module: Module | string;
  source_ref: string;
  note_zh?: string;
  tags?: string[];
}

export type VocabExportFormat = 'csv' | 'anki';

// ============================================================
// 4. Settings（契约 §4）
// ============================================================

/** `ai.key_source`：key 来自 `.env` 还是设置页写入。契约示例仅出现 `env`。 */
export type AiKeySource = 'env' | 'settings' | 'none';

export interface AiSettings {
  configured: boolean;
  /** 只回 host，绝不回 key（AC-C2）。 */
  base_url_host: string | null;
  model: string | null;
  key_source: AiKeySource;
}

/** 外观主题（契约 §4 `theme`）：浅色 / 深色 / 跟随系统。 */
export const THEME_MODES = ['light', 'dark', 'system'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export interface Settings {
  target_band: Band;
  /** `YYYY-MM-DD`。 */
  exam_date: string | null;
  daily_goal_minutes: number;
  accent: Accent;
  tts_voice: TtsVoice;
  tts_speed: number;
  show_chinese_hints: boolean;
  show_punctuation: boolean;
  online_enabled: boolean;
  /** 录音输入设备 deviceId（AC-C4：必须真正传给 getUserMedia）。 */
  audio_device: string | null;
  recording_input_gain: number;
  /** Wave 4 双主题：`system` 由 `useTheme` 用 matchMedia 解析，后端只存原始选择。 */
  theme: ThemeMode;
  ai: AiSettings;
}

/** `PATCH /settings` 的 body：只带要改的字段，其余保持原值（AC-C1）。 */
export type SettingsPatch = Partial<Omit<Settings, 'ai'>>;

/** #4/#5：key 只回状态，不回明文。 */
export interface AiKeyPresence {
  ai_key_present: boolean;
}

// ============================================================
// 报告类型守卫（`/attempts/{id}` 的 payload 收窄用）
// ============================================================

function hasBandObject(report: ModuleReport): report is SpeakingReport | WritingReport {
  return typeof (report as SpeakingReport).band === 'object' && (report as SpeakingReport).band !== null;
}

export function isSpeakingReport(report: ModuleReport): report is SpeakingReport {
  if (!hasBandObject(report)) return false;
  const band = (report as SpeakingReport).band as SpeakingBands;
  return 'fluency_coherence' in band || 'pronunciation' in band;
}

export function isWritingReport(report: ModuleReport): report is WritingReport {
  if (!hasBandObject(report)) return false;
  return 'word_count' in report && 'task' in report;
}

export function isObjectiveReport(report: ModuleReport): report is ObjectiveReport {
  return 'raw_total' in report && 'items' in report;
}

export function isListeningReport(report: ModuleReport): report is ListeningObjectiveReport {
  return isObjectiveReport(report) && report.module === 'listening';
}

export function isReadingReport(report: ModuleReport): report is ReadingObjectiveReport {
  return isObjectiveReport(report) && report.module === 'reading';
}

export function isSpeakingSetMeta(meta: SetMeta): meta is SpeakingSetMeta {
  return meta.module === 'speaking';
}
