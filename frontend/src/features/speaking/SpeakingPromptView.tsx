/**
 * SpeakingPromptView —— 考官题面（契约 §2-S、FR-S2）。
 *
 * Part 1/3 用问句、Part 2 用题卡；`audio_url` 为 null 时由 `ExaminerAudio` 显示「无音频」
 * 回落（不渲染坏掉的 `<audio>`）。Part 3 的动态追问文本由父级传入（FR-S6）。
 */
import { Card } from '../../components/ui';
import type { SpeakingPrompt, TtsVoice } from '../../types/ielts';
import ExaminerAudio from './ExaminerAudio';

export type SpeakingPromptViewProps = {
  prompt: SpeakingPrompt;
  /** Part 3：`followups()` / `fallback_questions` 的文本覆盖 session 预置题面 */
  displayText?: string;
  examinerVoice?: TtsVoice | null;
  speed?: number | null;
  /** 进度（契约 §1 #8 的 index/total） */
  position?: { index: number; total: number };
};

export default function SpeakingPromptView({
  prompt,
  displayText,
  examinerVoice,
  speed,
  position,
}: SpeakingPromptViewProps) {
  const text = (displayText ?? prompt.text).trim();

  return (
    <Card
      title={prompt.kind === 'cue_card' ? '题卡（Part 2）' : `考官提问（Part ${prompt.part}）`}
      subtitle={position ? `第 ${position.index + 1} / ${position.total} 题` : undefined}
    >
      <div className="flex flex-col gap-3">
        <p className="font-serif text-[15px] leading-relaxed text-ink">{text}</p>

        {prompt.bullets?.length ? (
          <div className="rounded-card border border-rule bg-paper-sunken px-3 py-2">
            <div className="mb-1 text-xs text-ink-muted">答题提示</div>
            <ul className="list-disc pl-4 text-sm text-ink-secondary">
              {prompt.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <ExaminerAudio text={text} audioUrl={prompt.audio_url} voice={examinerVoice} speed={speed} />
      </div>
    </Card>
  );
}
