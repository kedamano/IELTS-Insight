import type { Tone } from '../../components/ui';
import { WRITING_ERROR_LABEL_ZH, WRITING_ERROR_TYPES } from '../../types/ielts';

/**
 * features/shared/errorTypes.ts —— 跨报告与错题本共用的归类文本。
 *
 * `error_type` 跨四科不收敛为枚举（契约 §10.2）：写作 7 类有官方中文名
 * （`WRITING_ERROR_LABEL_ZH`），听力/阅读用的是 `answer_norm` 的 reason 闭集（下面 4 个）；
 * 两者都不在列表里的字符串一律原样显示，不猜测翻译。
 */
const OBJECTIVE_ERROR_LABEL_ZH: Record<string, string> = {
  wrong: '答案不正确',
  unanswered: '未作答',
  spelling_variant_rejected: '拼写被判不一致',
  over_word_limit: '超出字数限制',
};

export function errorTypeLabel(errorType: string | null | undefined): string {
  if (!errorType) return '未分类';
  if ((WRITING_ERROR_TYPES as readonly string[]).includes(errorType)) {
    return WRITING_ERROR_LABEL_ZH[errorType as keyof typeof WRITING_ERROR_LABEL_ZH];
  }
  return OBJECTIVE_ERROR_LABEL_ZH[errorType] ?? errorType;
}

/**
 * 正确率分档（报告页 / 错题本共用）。
 *
 * 阈值 ≥80% / ≥60% 是**产品自选的显示分档**，与 band 三档规则（`bandTone`）无关，
 * 因此不复用 `ui/tokens.ts`；UI 图例里同步标注了阈值，避免被误读为分数色。
 */
export function accuracyTone(accuracy: number): Tone {
  if (!Number.isFinite(accuracy)) return 'poor';
  if (accuracy >= 0.8) return 'good';
  if (accuracy >= 0.6) return 'mid';
  return 'poor';
}

export function accuracyPercent(accuracy: number | null | undefined): number {
  return Number.isFinite(accuracy ?? NaN) ? Math.round((accuracy as number) * 100) : 0;
}
