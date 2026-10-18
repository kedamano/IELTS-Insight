/**
 * TranscriptPanel —— AC-L1b 的「原文精读」视图。
 *
 * 存在意义：音频依赖（edge-tts）不可用时，听力练习不能白屏，必须仍能读原文、做题、拿分。
 * 数据源是题面接口保留的 `audio_text`（契约 §10.1）与批改响应回传的 `transcript`。
 */
import { Badge, Card } from '../../components/ui';

export type TranscriptPanelProps = {
  text: string;
  title?: string;
  /** 说明为什么走精读（例如「音频 503」） */
  note?: string;
  emptyText?: string;
};

export default function TranscriptPanel({
  text,
  title = '原文精读',
  note,
  emptyText = '题面没有附带原文（audio_text 为空），本次只能盲做。',
}: TranscriptPanelProps) {
  const trimmed = text.trim();
  return (
    <Card
      title={title}
      subtitle={note}
      actions={<Badge tone={trimmed ? 'accent' : 'neutral'} dot>{trimmed ? '有原文' : '无原文'}</Badge>}
    >
      {trimmed ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{trimmed}</p>
      ) : (
        <p className="text-sm text-ink-muted">{emptyText}</p>
      )}
    </Card>
  );
}
