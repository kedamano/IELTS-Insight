/**
 * ExaminerAudio —— 考官提问音频（契约 §2-S `audio_url: string | null`、§10.2）。
 *
 * 离线/未合成时 `audio_url` 为 null：渲染「无音频」标识，**绝不渲染 `src={null}` 的 `<audio>`**，
 * 题面文本照常完整可读（CONSTITUTION §3 的可见回落）。
 * 在线时先经 `useTTS` 取字节流再播，这样 503 能被识别成「音频不可用」而不是静默失败。
 */
import { Badge, Button } from '../../components/ui';
import { useTTS } from '../../hooks/useTTS';
import type { TtsVoice } from '../../types/ielts';

export type ExaminerAudioProps = {
  /** 朗读内容（题面文本） */
  text: string;
  /** null/空 = 没有可用音频 */
  audioUrl?: string | null;
  voice?: TtsVoice | null;
  speed?: number | null;
  size?: 'sm' | 'md';
};

export function hasExaminerAudio(audioUrl: string | null | undefined): boolean {
  return typeof audioUrl === 'string' && audioUrl.trim().length > 0;
}

export default function ExaminerAudio({ text, audioUrl, voice, speed, size = 'sm' }: ExaminerAudioProps) {
  const tts = useTTS({ voice: voice ?? null, speed: speed ?? null });
  const available = hasExaminerAudio(audioUrl);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size={size}
        variant="outline"
        disabled={!available || tts.preparing}
        loading={tts.preparing}
        title={available ? '播放考官提问' : '考官音频不可用（离线或未合成）'}
        onClick={() => void tts.play(text)}
      >
        听考官提问
      </Button>
      {available ? (
        <Badge tone="accent" dot>
          考官音频
        </Badge>
      ) : (
        <Badge tone="mid" dot title="离线或未合成音频；题面文本已完整显示">
          无音频
        </Badge>
      )}
      {tts.error ? (
        <span role="alert" className="text-xs" style={{ color: 'var(--band-poor)' }}>
          {tts.error}
        </span>
      ) : null}
    </div>
  );
}
