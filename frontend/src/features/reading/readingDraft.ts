/**
 * 阅读屏的局部类型与草稿序列化。
 *
 * `ReadingSetView`：契约 §10.1 允许阅读 set 带可选 `instruction_zh`（题面指令），
 * 但 `types/ielts.ts` 的 `ReadingSet` 镜像里还没有该字段（那文件不归我改）。
 * 这里只做**读取**用的交叉类型，绝不发明新字段名。
 */
import type { AnswerMap, ReadingSet } from '../../types/ielts';

export type ReadingSetView = ReadingSet & { instruction_zh?: string | null };

/** 草稿键（AC-R3/FR-W2 同规则：`reading_<set_id>`）。 */
export function readingDraftKey(setId: string): string {
  return `reading_${setId}`;
}

export function serializeAnswers(answers: AnswerMap): string {
  return JSON.stringify(answers);
}

/** 草稿可能是空串（clear() 之后）、旧版本或损坏 JSON —— 一律回空答案，绝不崩。 */
export function parseAnswers(raw: string | null | undefined): AnswerMap {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: AnswerMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') out[key] = value;
      else if (typeof value === 'number' || typeof value === 'boolean') out[key] = String(value);
    }
    return out;
  } catch {
    return {};
  }
}

/** 只统计有实际内容的作答。 */
export function answeredCount(answers: AnswerMap): number {
  return Object.values(answers).filter((value) => typeof value === 'string' && value.trim() !== '').length;
}
