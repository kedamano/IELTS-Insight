/**
 * speakingSets —— 口语题面的只读辅助（契约 §2-S + §10.1）。
 *
 * 为什么要单独一个文件：§10.1 定稿「口语一文件一 `part`」，但 `types/ielts.ts` 的
 * `SpeakingSetMeta` 只声明了 `parts?: SpeakingPart[]`，后端实际下发的是 `part: 1|2` 与
 * `question_counts`。这里**不声明新形状**（类型真源仍是 types/ielts.ts），只做防御性读取：
 * 缺字段时回落到「按题面数组长度判断」，任何情况下都不抛。
 */
import type {
  Band,
  CueCard,
  SpeakingPart,
  SpeakingPrompt,
  SpeakingQuestion,
  SpeakingSet,
  SpeakingSetMeta,
} from '../../types/ielts';

/** FR-S1 的三档难度分层（选择器只用这三档）。 */
export const SPEAKING_TARGET_BANDS: readonly Band[] = [5.5, 6.5, 7.5];

/** Part 1/2/3（FR-G4：Part 术语保持英文）。 */
export const SPEAKING_PARTS: readonly { id: SpeakingPart; label: string; note: string }[] = [
  { id: 1, label: 'Part 1', note: '快问快答' },
  { id: 2, label: 'Part 2', note: '题卡：1 分钟准备 + 2 分钟独白' },
  { id: 3, label: 'Part 3', note: '考官追问' },
];

/** 契约 §2-S：Part 2 计时缺省值（后端同口径给 preparation_sec/speaking_sec）。 */
export const DEFAULT_PREPARATION_SEC = 60;
export const DEFAULT_SPEAKING_SEC = 120;

type LooseRecord = Record<string, unknown>;

function asRecord(value: unknown): LooseRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as LooseRecord) : null;
}

function asParts(value: unknown): SpeakingPart[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is SpeakingPart => item === 1 || item === 2 || item === 3);
}

/** 一个元数据条目支持哪些 Part（§10.1：一文件一 part；兼容 `parts` 写法）。 */
export function partsOfSetMeta(meta: SpeakingSetMeta): SpeakingPart[] {
  const declared = asParts(meta.parts);
  if (declared.length) return declared;

  const loose = asRecord(meta);
  const single = loose?.part;
  if (single === 1 || single === 2 || single === 3) {
    // part:2 的文件同时携带 Part 3 追问（§2-S）
    return single === 2 ? [2, 3] : [single];
  }
  const counts = asRecord(loose?.question_counts);
  if (counts) {
    const out: SpeakingPart[] = [];
    if (Number(counts.part1 ?? 0) > 0) out.push(1);
    if (Number(counts.part2 ?? 0) > 0) out.push(2, 3);
    if (Number(counts.part3 ?? 0) > 0 && !out.includes(3)) out.push(3);
    if (out.length) return out;
  }
  // 元数据没给线索：交给题面请求去证实（后端会返回可读的 400）
  return [1, 2, 3];
}

/** 题面里真实存在的 Part（用于进入某一 Part 前的自检）。 */
export function partsOfSet(set: SpeakingSet | null): SpeakingPart[] {
  if (!set) return [];
  const out: SpeakingPart[] = [];
  if (questionsOf(set, 'part1').length) out.push(1);
  if (cueCardOf(set)) out.push(2, 3);
  if (!out.includes(3) && questionsOf(set, 'part3').length) out.push(3);
  return out;
}

/** 后端可能缺 `part1`/`part3`（§10.1 一文件一 part），一律按数组防御性读取。 */
export function questionsOf(set: SpeakingSet | null, key: 'part1' | 'part3'): SpeakingQuestion[] {
  const raw = set ? asRecord(set)?.[key] : undefined;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is SpeakingQuestion => {
    const rec = asRecord(item);
    return !!rec && typeof rec.question === 'string' && typeof rec.id === 'string';
  });
}

export function cueCardOf(set: SpeakingSet | null): CueCard | null {
  const part2 = asRecord(asRecord(set)?.part2);
  const card = part2 ? asRecord(part2.cue_card) : null;
  if (!card) return null;
  const prompt = typeof card.prompt === 'string' ? card.prompt : typeof card.text === 'string' ? card.text : '';
  if (!prompt.trim()) return null;
  const bullets = Array.isArray(card.bullets)
    ? card.bullets.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
  return {
    prompt,
    bullets,
    preparation_sec: positiveInt(card.preparation_sec, DEFAULT_PREPARATION_SEC),
    speaking_sec: positiveInt(card.speaking_sec, DEFAULT_SPEAKING_SEC),
  };
}

export function fallbackQuestionsOf(set: SpeakingSet | null): string[] {
  const raw = asRecord(set)?.fallback_questions;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

export function examinerVoiceOf(set: SpeakingSet | null): string | null {
  const voice = asRecord(set)?.examiner_voice;
  return typeof voice === 'string' && voice.trim() ? voice : null;
}

function positiveInt(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** §2-S 末行：把题面统一成 SpeakingPrompt 供渲染（Part 1/3 问句、Part 2 题卡）。 */
export function promptsOfSet(set: SpeakingSet | null, part: SpeakingPart): SpeakingPrompt[] {
  if (part === 2) {
    const card = cueCardOf(set);
    if (!card) return [];
    return [
      {
        id: 'cue_card',
        part: 2,
        kind: 'cue_card',
        text: card.prompt,
        bullets: card.bullets,
        preparation_sec: card.preparation_sec,
        speaking_sec: card.speaking_sec,
        audio_url: null,
      },
    ];
  }
  const key = part === 1 ? 'part1' : 'part3';
  return questionsOf(set, key).map((question) => ({
    id: question.id,
    part,
    kind: 'question' as const,
    text: question.question,
    audio_url: null,
  }));
}

/** 转写置信度阈值（AC-S3）。 */
export const LOW_CONFIDENCE = 0.5;

export function isLowConfidence(confidence: number | null | undefined): boolean {
  return typeof confidence === 'number' && Number.isFinite(confidence) && confidence < LOW_CONFIDENCE;
}

/** AC-S3：置信度过低时「说明问题 + 给出下一步」（文本来自 spec，不是后端英文）。 */
export const LOW_CONFIDENCE_TEXT = '转写置信度较低，录音可能不清晰：可重录本题，或改用键盘输入答案文本继续。';
