/**
 * DegradationNotice —— CONSTITUTION §3「失败必须可见」在口语屏的落点。
 *
 * `ai_used === false` 或 `approximate === true` 时，绝不允许把近似分说成真 band
 * （AC-G3/AC-G5）：文案以「降级」开头，并给出 `degradedLabelZh(degraded_reason)`。
 */
import { Badge, Toast } from '../../components/ui';
import type { AiMeta } from '../../types/ielts';
import { degradedLabelZh } from '../../types/ielts';

export type DegradationNoticeProps = {
  meta: Pick<AiMeta, 'ai_used' | 'approximate' | 'degraded_reason'>;
  /** 追加说明（如「四维分数由本地模板估算」） */
  detail?: string;
  /** 结果区用 Toast（tone 固定 warn），列表/卡片内用 Badge */
  variant?: 'toast' | 'badge';
};

export function isDegraded(meta: Pick<AiMeta, 'ai_used' | 'approximate'>): boolean {
  return meta.ai_used === false || meta.approximate === true;
}

export default function DegradationNotice({ meta, detail, variant = 'toast' }: DegradationNoticeProps) {
  if (!isDegraded(meta)) return null;
  const label = degradedLabelZh(meta);

  if (variant === 'badge') {
    return (
      <Badge tone="mid" dot title={detail}>
        降级 · {label}
      </Badge>
    );
  }

  return (
    <Toast tone="warn">
      <span className="font-medium">已降级：{label}</span>
      <span className="text-ink-secondary">
        {' '}
        —— 这不是 AI 精确评分，请勿当作真实 band；{detail ?? '可作为练习参考。'}
      </span>
    </Toast>
  );
}
