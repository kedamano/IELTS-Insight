/**
 * SparringMessageList —— 1 对 1 陪练的对话流（契约 §16.5 / AC-S7.6a）。
 *
 * 两条硬要求：
 * 1. **降级要逐条标注**，不能只在页脚写一句「离线中」：每一条预置追问自己带「预置追问」徽标，
 *    用户读到哪一句就知道那一句的来源（CONSTITUTION §3）；
 * 2. **发音按钮在离线时必须真的不可用**，并写明原因 —— 禁用但不解释等于让用户反复点。
 *
 * 陪练官消息的自读文本（英文问句）用衬线体，我的一侧用正文字体并带置信度徽标，
 * 这样「谁在说话」不靠颜色单独承载（与 §8 的无障碍口径一致）。
 *
 * 第三条（Wave 8）：**回听自己刚说的录音**。音频字节不落库（契约 §5），由父级在**本会话内存**
 * 里按 `seq` 留一份传进来；没有录音（文本兜底/刷新后）时按钮不出现 —— 那是「没有」，
 * 不是「坏了」，禁用一个本来就没有的东西只会让人以为是缺陷。
 */
import { useState } from 'react';
import { Badge, Button, cx } from '../../components/ui';
import { useTTS } from '../../hooks/useTTS';
import type { SparringMessage, TtsVoice } from '../../types/ielts';
import { hasExaminerAudio } from './ExaminerAudio';
import { partnerSourceLabel } from './sparringSets';

export type SparringMessageListProps = {
  messages: readonly SparringMessage[];
  voice?: TtsVoice | null;
  speed?: number | null;
  /** 低置信度阈值与口语同口径（AC-S3：<0.5 提示重录） */
  lowConfidence?: number;
  /** `seq → 本轮录音 Blob`（仅本会话内存，见 SparringPanel 的 playback） */
  playback?: Readonly<Record<number, Blob>>;
};

const LOW_CONFIDENCE = 0.5;

/** 回听自己：直接播内存里的 Blob，不经 TTS、不发请求、不依赖网络。 */
function SelfPlayback({ blob }: { blob: Blob }) {
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);

  const play = async () => {
    const url = URL.createObjectURL(blob);
    setPlaying(true);
    setError(null);
    try {
      const audio = new Audio(url);
      await audio.play();
      await new Promise<void>((resolve) => {
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
      });
    } catch {
      setError('浏览器拒绝了播放，再点一次试试');
    } finally {
      URL.revokeObjectURL(url);
      setPlaying(false);
    }
  };

  return (
    <>
      <Button size="sm" variant="ghost" disabled={playing} onClick={() => void play()}>
        {playing ? '播放中' : '回听我的录音'}
      </Button>
      {error ? (
        <span role="alert" className="text-[11px] text-band-mid">
          {error}
        </span>
      ) : null}
    </>
  );
}

function PartnerRow({
  message,
  voice,
  speed,
}: {
  message: SparringMessage;
  voice?: TtsVoice | null;
  speed?: number | null;
}) {
  const tts = useTTS({ voice: voice ?? null, speed: speed ?? null });
  const playable = hasExaminerAudio(message.audio_url);
  const fallback = message.source === 'fallback';
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-ink-secondary">陪练官</span>
        <Badge tone={fallback ? 'mid' : message.source === 'ai' ? 'accent' : 'neutral'}>
          {partnerSourceLabel(message.source)}
        </Badge>
        {playable ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={tts.preparing}
            loading={tts.preparing}
            onClick={() => void tts.play(message.text)}
          >
            朗读
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            disabled
            title="离线没有合成音频，读文本即可（AC-S7.3 规则 5）"
          >
            无音频
          </Button>
        )}
        {tts.error ? (
          <span role="alert" className="text-[11px] text-band-mid">
            {tts.error}
          </span>
        ) : null}
      </div>
      <p className="rounded-card border border-rule bg-paper-sunken px-3 py-2 font-serif text-[15px] leading-relaxed text-ink">
        {message.text}
      </p>
    </li>
  );
}

function UserRow({
  message,
  lowConfidence,
  recording,
}: {
  message: SparringMessage;
  lowConfidence: number;
  recording?: Blob;
}) {
  const confidence = typeof message.confidence === 'number' ? message.confidence : null;
  const low = confidence !== null && confidence < lowConfidence;
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {recording ? <SelfPlayback blob={recording} /> : null}
        {confidence !== null ? (
          <Badge tone={low ? 'mid' : 'neutral'}>置信 {confidence.toFixed(2)}</Badge>
        ) : (
          <Badge tone="neutral">文本输入</Badge>
        )}
        <span className="text-xs font-medium text-ink-secondary">我</span>
      </div>
      <p
        className={cx(
          'rounded-card border border-rule bg-paper-raised px-3 py-2 text-sm leading-relaxed text-ink',
          low && 'border-band-mid',
        )}
      >
        {message.text}
      </p>
    </li>
  );
}

export default function SparringMessageList({
  messages,
  voice,
  speed,
  lowConfidence = LOW_CONFIDENCE,
  playback = {},
}: SparringMessageListProps) {
  if (!messages.length) {
    return <p className="text-sm text-ink-muted">对话还没有开始。</p>;
  }
  return (
    <ul aria-label="陪练对话" className="flex flex-col gap-3">
      {messages.map((message) =>
        message.role === 'partner' ? (
          <PartnerRow key={`${message.seq}-${message.role}`} message={message} voice={voice} speed={speed} />
        ) : (
          <UserRow
            key={`${message.seq}-${message.role}`}
            message={message}
            lowConfidence={lowConfidence}
            recording={playback[message.seq]}
          />
        ),
      )}
    </ul>
  );
}
