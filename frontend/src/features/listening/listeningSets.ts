/**
 * listeningSets.ts —— 听力屏的纯函数与常量（不发请求、不碰 DOM）。
 *
 * 只做三件事：
 * 1. 把契约 §1 #13 的筛选维度（accent / kind）与 FR-L4 的播放参数（倍速、回退秒数）固化成常量；
 * 2. 答案草稿的 JSON 编解码（`useDraftAutosave` 只能存字符串）；
 * 3. 对后端下发的 set 做**防御性**读取（运行时数据可能比 `ListeningSet` 类型更松）。
 */
import { TTS_UNAVAILABLE_TEXT } from '../../hooks/useTTS';
import type {
  Accent,
  AnswerMap,
  BandScale,
  ListeningQuestionPublic,
  ListeningSet,
  ListeningSetMeta,
  ObjectiveItemReason,
  QuestionType,
  QuestionTypeTally,
  SentenceAnchor,
  SetKind,
  TtsVoice,
} from '../../types/ielts';
import { ACCENT_VOICE, QUESTION_TYPE_LABEL_ZH } from '../../types/ielts';
import { formatClock } from '../../hooks/useTimer';

/** FR-L1 的两种口音（默认英音）。 */
export const LISTENING_ACCENTS: readonly { id: Accent; label: string; voice: TtsVoice }[] = [
  { id: 'en-GB', label: '英音（Sonia）', voice: ACCENT_VOICE['en-GB'] },
  { id: 'en-US', label: '美音（Guy）', voice: ACCENT_VOICE['en-US'] },
];

/** §1 #13 的 `kind` 过滤；`mock_test` 为完整 4 section 预留（FR-L2）。 */
export const LISTENING_KINDS: readonly { id: SetKind; label: string; note: string }[] = [
  { id: 'practice', label: '短练（2 section × 10 题）', note: '自学用，题少反馈快' },
  { id: 'mock_test', label: '模拟卷', note: '完整 section 结构，预留' },
];

/** FR-L4 倍速区间 0.75×–1.25×。 */
export const LISTENING_SPEEDS: readonly number[] = [0.75, 1, 1.25];
export const DEFAULT_SPEED = 1;
export const BACK_JUMP_SEC = 5;

/** AC-L1b 文案唯一来源（与 useTTS 保持同一句话）。 */
export const AUDIO_UNAVAILABLE_TEXT = TTS_UNAVAILABLE_TEXT;
export const TRANSCRIPT_ENTRY_TEXT = '看原文精读';

/** 草稿 key（契约 §10/产品稿：`listening_<set_id>`）。 */
export function draftKeyOf(setId: string): string {
  return `listening_${setId}`;
}

// ============================================================
// 草稿编解码
// ============================================================

/** 只保留非空答案，键排序后可比较、体积小。 */
export function encodeAnswers(answers: AnswerMap): string {
  const keys = Object.keys(answers).filter((key) => isAnswerFilled(answers[key])).sort();
  const picked: AnswerMap = {};
  for (const key of keys) picked[key] = (answers[key] ?? '').trim();
  return JSON.stringify(picked);
}

/** 坏 JSON / 非对象一律当「没有草稿」，绝不 throw（草稿只是加速器，不是数据源）。 */
export function decodeAnswers(raw: string | null | undefined): AnswerMap {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: AnswerMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') out[key] = value;
      else if (typeof value === 'number') out[key] = String(value);
    }
    return out;
  } catch {
    return {};
  }
}

export function isAnswerFilled(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function answeredCount(questions: readonly ListeningQuestionPublic[], answers: AnswerMap): number {
  return questions.reduce((sum, question) => (isAnswerFilled(answers[question.id]) ? sum + 1 : sum), 0);
}

export function unansweredNumbers(questions: readonly ListeningQuestionPublic[], answers: AnswerMap): number[] {
  return questions.filter((question) => !isAnswerFilled(answers[question.id])).map((question) => question.number);
}

// ============================================================
// 字数上限（FR-L3 的前端提示；判定权在后端）
// ============================================================

/** `two words and/or a number` 口径：按空白切分，连字符词算一个词。 */
export function countWords(text: string | undefined): number {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function wordLimitOf(question: ListeningQuestionPublic): number | undefined {
  return typeof (question as { word_limit?: number }).word_limit === 'number'
    ? (question as { word_limit: number }).word_limit
    : undefined;
}

/** 超限提示文案（提交前本地提示，后端仍会判 `over_word_limit`）。 */
export function wordLimitHint(question: ListeningQuestionPublic): string | null {
  const limit = wordLimitOf(question);
  return typeof limit === 'number' && limit > 0 ? `不超过 ${limit} 词` : null;
}

export function isOverWordLimit(question: ListeningQuestionPublic, value: string | undefined): boolean {
  const limit = wordLimitOf(question);
  if (typeof limit !== 'number' || limit <= 0) return false;
  return countWords(value) > limit;
}

export function overLimitNumbers(questions: readonly ListeningQuestionPublic[], answers: AnswerMap): number[] {
  return questions.filter((question) => isOverWordLimit(question, answers[question.id])).map((q) => q.number);
}

// ============================================================
// 报告展示辅助
// ============================================================

export const REASON_LABEL_ZH: Record<ObjectiveItemReason, string> = {
  wrong: '答案不正确',
  over_word_limit: '超出字数上限',
  unanswered: '未作答',
  spelling_variant_rejected: '拼写变体未被接受',
};

export function reasonLabelZh(reason: ObjectiveItemReason | null | undefined): string | null {
  if (!reason) return null;
  return REASON_LABEL_ZH[reason] ?? reason;
}

export const BAND_SCALE_LABEL_ZH: Record<BandScale, string> = {
  listening_20q: '听力 20 题制对照表（§3-B）',
  listening_40q: '听力 40 题制对照表（§3-B）',
  reading_13q: '阅读 13 题制对照表（§3-B）',
  reading_40q: '阅读 40 题制对照表（§3-B）',
};

export function bandScaleLabel(scale: BandScale | undefined): string {
  if (!scale) return '按题数对照表折算';
  return BAND_SCALE_LABEL_ZH[scale] ?? scale;
}

export function accuracyPercent(accuracy: number | null | undefined): number {
  if (typeof accuracy !== 'number' || !Number.isFinite(accuracy)) return 0;
  return Math.round(Math.min(1, Math.max(0, accuracy)) * 100);
}

/** `by_question_type` 是 Partial Record，这里按题型字典序展平成列表。 */
export function tallyList(
  byType: Partial<Record<QuestionType, QuestionTypeTally>> | null | undefined,
): { type: QuestionType; label: string; correct: number; total: number; accuracy: number }[] {
  if (!byType) return [];
  return (Object.entries(byType) as [QuestionType, QuestionTypeTally | undefined][])
    .filter((entry): entry is [QuestionType, QuestionTypeTally] => !!entry[1] && (entry[1].total ?? 0) > 0)
    .map(([type, tally]) => ({
      type,
      label: QUESTION_TYPE_LABEL_ZH[type] ?? type,
      correct: tally.correct ?? 0,
      total: tally.total ?? 0,
      accuracy: tally.total > 0 ? (tally.correct ?? 0) / tally.total : 0,
    }))
    .sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));
}

/** 题型中文标签（题号前缀旁的小字）。 */
export function typeLabel(type: QuestionType | string): string {
  return QUESTION_TYPE_LABEL_ZH[type as QuestionType] ?? String(type);
}

// ============================================================
// 防御性读取
// ============================================================

export function questionsOf(set: ListeningSet | null | undefined): ListeningQuestionPublic[] {
  const list = (set as { questions?: unknown } | null)?.questions;
  return Array.isArray(list) ? (list as ListeningQuestionPublic[]) : [];
}

export function sentencesOf(set: ListeningSet | null | undefined): SentenceAnchor[] {
  const list = (set as { sentences?: unknown } | null)?.sentences;
  if (!Array.isArray(list)) return [];
  return (list as unknown[]).map((item, index) => {
    const raw = (item ?? {}) as Partial<SentenceAnchor>;
    const anchor = typeof raw.anchor_sec === 'number' && Number.isFinite(raw.anchor_sec) ? raw.anchor_sec : null;
    return {
      idx: typeof raw.idx === 'number' ? raw.idx : index,
      text: typeof raw.text === 'string' ? raw.text : '',
      anchor_sec: anchor === null ? 0 : anchor,
    } satisfies SentenceAnchor;
  });
}

/** AC-L1b 的精读数据源；后端可能不带（§10.1 只保证 practice 内容保留）。 */
export function audioTextOf(set: ListeningSet | null | undefined): string {
  const value = (set as { audio_text?: unknown } | null)?.audio_text;
  return typeof value === 'string' ? value.trim() : '';
}

export function instructionOf(set: ListeningSet | null | undefined): string {
  const value = (set as { instruction_zh?: unknown } | null)?.instruction_zh;
  return typeof value === 'string' && value.trim() ? value.trim() : '听录音，完成下面的题目。';
}

export function sectionOf(meta: ListeningSetMeta | ListeningSet): number | null {
  const value = (meta as { section?: unknown }).section;
  return typeof value === 'number' ? value : null;
}

export function durationSecOf(set: ListeningSet | null | undefined): number | null {
  const value = (set as { duration_sec?: unknown } | null)?.duration_sec;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** 官方题号前缀（契约 §8 排版：`11.`）。 */
export function numberLabel(number: number | undefined): string {
  return typeof number === 'number' ? `${number}.` : '·';
}

/** 锚点秒 → `m:ss`（仅估算，标签要说明）。 */
export function anchorLabel(anchorSec: number): string {
  return formatClock(anchorSec);
}

/**
 * 把估算锚点线性缩放到真实音频时长。
 *
 * `anchor_sec` 是后端按词数估的（实测 li_s1_leisure_01：末句估算 267.6s，音频实际 225s，
 * 偏 19%）。不缩放时点末句会 seek 到音频结尾之后 —— 用户按下「重听」却什么都听不到，
 * 同时句子时间标签也一路虚高。这里假定语速均匀，用「末句锚点 + 平均句间距」当作估算总时长。
 * 时长未知（null/0/非法）时原样返回，绝不自己编一个时间轴。
 */
export function scaleAnchorsToDuration(
  sentences: readonly SentenceAnchor[],
  durationSec: number | null | undefined,
): SentenceAnchor[] {
  const usable = typeof durationSec === 'number' && Number.isFinite(durationSec) && durationSec > 0;
  if (!usable || sentences.length === 0) return sentences.map((sentence) => ({ ...sentence }));
  const total = durationSec as number;
  const lastAnchor = sentences[sentences.length - 1].anchor_sec;
  if (!(lastAnchor > 0)) return sentences.map((sentence) => ({ ...sentence }));
  const estimatedTotal =
    sentences.length > 1 ? lastAnchor * (sentences.length / (sentences.length - 1)) : lastAnchor;
  const scale = total / estimatedTotal;
  // 留 1s 余量：seek 到最后一刻浏览器会直接 ended，等于没播。
  const ceiling = Math.max(0, total - 1);
  return sentences.map((sentence) => ({
    ...sentence,
    anchor_sec: Math.min(sentence.anchor_sec * scale, ceiling),
  }));
}

/** 从列表元数据里挑口音（缺省跟随设置）。 */
export function accentOfMeta(meta: ListeningSetMeta): Accent | null {
  return meta.accent === 'en-GB' || meta.accent === 'en-US' ? meta.accent : null;
}
