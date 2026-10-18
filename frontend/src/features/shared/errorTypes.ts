import type { Tone } from '../../components/ui';
import { WRITING_ERROR_LABEL_ZH, WRITING_ERROR_TYPES } from '../../types/ielts';

/**
 * features/shared/errorTypes.ts —— 跨报告与错题本共用的归类文本。
 *
 * `error_type` 跨四科不收敛为枚举（契约 §10.2），只有写作 7 类有官方中文名
 * （`WRITING_ERROR_LABEL_ZH`）；其余科别原样显示后端归类字符串，不猜测翻译。
 */
export function errorTypeLabel(errorType: string | null | undefined): string {
  if (!errorType) return '未分类';
  if ((WRITING_ERROR_TYPES as readonly string[]).includes(errorType)) {
    return WRITING_ERROR_LABEL_ZH[errorType as keyof typeof WRITING_ERROR_LABEL_ZH];
  }
  return errorType;
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
