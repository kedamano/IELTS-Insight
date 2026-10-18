/**
 * CueCard —— Part 2 题卡 + 60s 准备倒计时（FR-S2 / AC-S2「可跳过」）。
 *
 * 独白阶段的 120s 计时与到点自动停止在 `RecorderControls` 里（AC-S2），
 * 本组件只负责「准备 → 开始独白」的交接。
 */
import { Badge, Button, Card, Countdown } from '../../components/ui';
import type { CueCard as CueCardData, SpeakingPrompt, TtsVoice } from '../../types/ielts';
import { DEFAULT_PREPARATION_SEC } from './speakingSets';
import ExaminerAudio from './ExaminerAudio';

export type CueCardProps = {
  prompt: SpeakingPrompt;
  card: CueCardData;
  /** true = 已进入独白阶段（准备倒计时结束并收起） */
  speakingStarted: boolean;
  onBeginSpeaking: () => void;
  examinerVoice?: TtsVoice | null;
  speed?: number | null;
};

export default function CueCard({
  prompt,
  card,
  speakingStarted,
  onBeginSpeaking,
  examinerVoice,
  speed,
}: CueCardProps) {
  const preparationSec = prompt.preparation_sec ?? card.preparation_sec ?? DEFAULT_PREPARATION_SEC;
  const speakingSec = prompt.speaking_sec ?? card.speaking_sec;

  return (
    <Card
      title="Part 2 题卡"
      subtitle={`准备 ${preparationSec}s · 独白 ${speakingSec}s（FR-S2）`}
      actions={speakingStarted ? <Badge tone="good" dot>准备结束</Badge> : <Badge tone="accent" dot>准备中</Badge>}
    >
      <div className="flex flex-col gap-3">
        <p className="font-serif text-[15px] leading-relaxed text-ink">{prompt.text}</p>
        {prompt.bullets?.length ? (
          <ul className="list-disc pl-5 text-sm text-ink-secondary">
            {prompt.bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
        ) : null}

        <ExaminerAudio text={prompt.text} audioUrl={prompt.audio_url} voice={examinerVoice} speed={speed} />

        {!speakingStarted ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-rule bg-paper-sunken px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink-muted">准备时间</span>
              <Countdown
                seconds={preparationSec}
                warnAt={10}
                size="md"
                expireText="准备时间到"
                onExpire={onBeginSpeaking}
              />
            </div>
            <Button size="sm" onClick={onBeginSpeaking}>
              跳过准备，直接开始
            </Button>
          </div>
        ) : (
          <p className="text-xs text-ink-muted">点击下方「开始录音」进入 2 分钟独白；到点会自动停止且不可续录。</p>
        )}
      </div>
    </Card>
  );
}
