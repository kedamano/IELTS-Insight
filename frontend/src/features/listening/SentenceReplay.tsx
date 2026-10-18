/**
 * SentenceReplay —— FR-L4 的「逐句重听」。
 *
 * `anchor_sec` 只是 TTS 拼接时的**估算**秒数（契约 §2-L 示例如此，后端不保证精确），
 * 所以标签写「约」，并且永远允许用户手动拖进度条校正；不要把它当成权威时间轴。
 */
import { Badge, Button, Card } from '../../components/ui';
import { anchorLabel } from './listeningSets';
import type { SentenceAnchor } from '../../types/ielts';

export type SentenceReplayProps = {
  sentences: SentenceAnchor[];
  /** 高亮最近一次点击的句子 */
  activeIdx?: number | null;
  onReplay?: (sentence: SentenceAnchor) => void;
  /** 无音频时禁用重听，但句子本身仍可阅读 */
  canPlay?: boolean;
  title?: string;
};

export default function SentenceReplay({
  sentences,
  activeIdx = null,
  onReplay,
  canPlay = true,
  title = '逐句重听',
}: SentenceReplayProps) {
  if (!sentences.length) return null;

  return (
    <Card
      title={title}
      subtitle={`共 ${sentences.length} 句；时间点为估算值，音频就绪后按实际时长等比校准，仍可用进度条微调`}
      actions={<Badge tone="neutral">{sentences.length} 句</Badge>}
    >
      <ol className="flex flex-col gap-1.5">
        {sentences.map((sentence, position) => (
          <li key={`${sentence.idx}-${position}`}>
            <div className="flex items-start gap-2">
              <span className="font-code w-10 shrink-0 pt-1 text-xs text-ink-muted">
                {anchorLabel(sentence.anchor_sec)}
              </span>
              <span className="min-w-0 flex-1 text-sm text-ink">{sentence.text}</span>
              <Button
                size="sm"
                variant={activeIdx === sentence.idx ? 'primary' : 'outline'}
                disabled={!canPlay || !onReplay}
                onClick={() => onReplay?.(sentence)}
                aria-label={`重听第 ${sentence.idx + 1} 句`}
              >
                重听
              </Button>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
