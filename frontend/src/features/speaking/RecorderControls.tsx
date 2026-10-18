/**
 * RecorderControls —— 口语作答：麦克风录音（FR-S3）+ 键盘文本兜底（AC-S3b）。
 *
 * 关键点：
 * - `useRecorder({ maxDurationMs, onLimit })` 到点自动停止（AC-S2），此后**续录按钮禁用**；
 * - 提交用的 `duration_sec` 一律取录音器实测时长（`elapsedMs` / `stop()` 返回值，误差 ≤1s）；
 * - 打包后 WebView2 的麦克风授权未实测（契约 §10.4），所以文本输入框**始终存在**，
 *   不是「麦克风失败后才出现」；
 * - 到点自动停止 + 自动提交只发生一次（`limitHandled` / `submitted` 两个闸门）。
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Badge, Button, Card, Countdown, cx } from '../../components/ui';
import { formatClock } from '../../hooks/useTimer';
import { useRecorder } from '../../hooks/useRecorder';
import type { RecorderStopResult, UseRecorderOptions } from '../../hooks/useRecorder';

export type RecorderControlsProps = {
  /** 到点自动停止的时长（Part 2 = 120000ms，AC-S2）；不传则不限时长 */
  maxDurationMs?: number;
  /** 到点后自动提交录音（Part 2 独白用，保证 `duration_sec` 就是实测时长） */
  autoSubmitOnLimit?: boolean;
  /** `settings.audio_device`（AC-C4：真正传进 getUserMedia） */
  deviceId?: string | null;
  disabled?: boolean;
  busy?: boolean;
  label?: string;
  /** 录音区右侧附加操作（如「跳过录音，直接评分」） */
  extraActions?: ReactNode;
  onSubmitAudio: (audio: Blob, durationSec: number) => Promise<void> | void;
  onSubmitText: (text: string, durationSec?: number) => Promise<void> | void;
  /** 到达时长上限（UI 进入「已用时 2:00」状态） */
  onLimit?: () => void;
  /**
   * 麦克风失败原因上报给父级（AC-S3b）：换题时本组件按题重挂载，就地显示会把原因丢掉，
   * 而「当初为什么不能用麦克风」必须一直可见，否则文本兜底看起来像是用户自己的选择。
   */
  onMicError?: (message: string) => void;
  /** 麦克风这次真的开起来了：清除上一次的失败原因 */
  onMicRecovered?: () => void;
  recorderOptions?: Pick<UseRecorderOptions, 'echoCancellation' | 'noiseSuppression'>;
};

/** 秒，最多一位小数（AC-S2 提交口径）。 */
function toSeconds(ms: number): number {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
  return Math.round(safe / 100) / 10;
}

function countWords(value: string): number {
  const trimmed = value.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export default function RecorderControls({
  maxDurationMs,
  autoSubmitOnLimit = false,
  deviceId = null,
  disabled = false,
  busy = false,
  label,
  extraActions,
  onSubmitAudio,
  onSubmitText,
  onLimit,
  onMicError,
  onMicRecovered,
  recorderOptions,
}: RecorderControlsProps) {
  const [text, setText] = useState('');
  const [limitHandled, setLimitHandled] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  /** 闸门用 ref（同步）：Countdown 到点与录音器到点可能在同一批次各触发一次，state 还来不及更新 */
  const limitGateRef = useRef(false);
  const submittedRef = useRef(false);

  const secondsLimit = typeof maxDurationMs === 'number' && maxDurationMs > 0 ? Math.round(maxDurationMs / 1000) : 0;

  const markSubmitted = () => {
    if (submittedRef.current) return false;
    submittedRef.current = true;
    setSubmitted(true);
    return true;
  };

  /** 到点：自动停止 + 只提交一次（AC-S2） */
  const handleLimit = (result: RecorderStopResult) => {
    if (limitGateRef.current) return;
    limitGateRef.current = true;
    setLimitHandled(true);
    onLimit?.();
    if (!autoSubmitOnLimit) return;
    if (result.blob.size > 0 && markSubmitted()) {
      void onSubmitAudio(result.blob, toSeconds(result.durationMs));
    }
  };

  const recorder = useRecorder({
    deviceId,
    maxDurationMs,
    ...recorderOptions,
    onLimit: handleLimit,
    onError: (_code, message) => onMicError?.(message),
  });

  useEffect(() => {
    if (recorder.recording) onMicRecovered?.();
  }, [recorder.recording, onMicRecovered]);

  const startAgain = () => {
    limitGateRef.current = false;
    submittedRef.current = false;
    setLimitHandled(false);
    setSubmitted(false);
    void recorder.start();
  };

  const submitAudio = () => {
    const blob = recorder.lastResult?.blob;
    if (!blob || blob.size === 0 || submittedRef.current) return;
    if (!markSubmitted()) return;
    // AC-S2：提交时长取实测 elapsedMs
    void onSubmitAudio(blob, toSeconds(recorder.elapsedMs));
  };

  const submitText = () => {
    const value = text.trim();
    if (!value || submittedRef.current) return;
    if (!markSubmitted()) return;
    void onSubmitText(value, recorder.elapsedMs > 0 ? toSeconds(recorder.elapsedMs) : undefined);
  };

  const blocked = recorder.stoppedByLimit || limitHandled;

  return (
    <Card
      title={label ?? '作答'}
      subtitle="麦克风录音或直接输入文本：打包版麦克风未验证，文本输入始终可用（AC-S3b）"
      actions={
        secondsLimit > 0 ? (
          <Badge tone={blocked ? 'mid' : recorder.recording ? 'poor' : 'neutral'} dot>
            {blocked ? '已到上限' : recorder.recording ? '录音中' : '未录音'}
          </Badge>
        ) : null
      }
    >
      <div className="flex flex-col gap-3">
        {secondsLimit > 0 ? (
          <div className="flex flex-wrap items-center gap-3">
            <Countdown
              seconds={secondsLimit}
              running={recorder.recording && !blocked}
              warnAt={20}
              label="独白剩余"
              onExpire={() => {
                void recorder.stop().then(handleLimit);
              }}
            />
            {recorder.recording ? (
              <span className="font-code text-xs text-ink-muted">
                已用 {formatClock(recorder.elapsedMs / 1000)}
              </span>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          {!recorder.recording ? (
            <Button
              variant="primary"
              size="sm"
              disabled={disabled || busy || blocked}
              onClick={startAgain}
              title={blocked ? '已达时长上限，录音不可续（AC-S2）' : undefined}
            >
              {blocked ? '录音不可续' : recorder.lastResult ? '重新录音' : '开始录音'}
            </Button>
          ) : (
            <Button variant="danger" size="sm" onClick={() => void recorder.stop()}>
              停止
            </Button>
          )}

          {recorder.lastResult && !recorder.recording ? (
            <>
              <Badge tone="accent">
                录音 {formatClock(recorder.lastResult.durationMs / 1000)} ·{' '}
                {Math.round(recorder.lastResult.sizeBytes / 1024)} KB
              </Badge>
              <Button size="sm" variant="outline" disabled={disabled || busy || submitted} onClick={submitAudio}>
                提交录音
              </Button>
              <Button size="sm" variant="ghost" disabled={disabled || busy} onClick={() => recorder.cancel()}>
                丢弃
              </Button>
            </>
          ) : null}

          {recorder.recording ? (
            <span className="font-code text-xs text-ink-muted" aria-hidden="true">
              电平 {Math.round(recorder.level * 100)}%
            </span>
          ) : null}

          {extraActions}
        </div>

        {blocked ? (
          <p role="status" className="text-xs text-ink-secondary">
            时长到点，录音已自动停止且不可续录（AC-S2）。
            {submitted ? '本次录音已自动提交，可直接评分。' : '可提交本题，或改用下方文本输入。'}
          </p>
        ) : null}

        {recorder.warning ? <p className="text-xs text-band-mid">{recorder.warning}</p> : null}

        <div className="rule" role="presentation" />

        <div className="flex flex-col gap-2">
          <label htmlFor="speaking-text-answer" className="text-xs font-medium text-ink-secondary">
            直接输入答案文本（麦克风不可用时练习不中断）
          </label>
          <textarea
            id="speaking-text-answer"
            className={cx(
              'min-h-24 w-full rounded-card border border-rule bg-paper px-3 py-2 text-sm text-ink',
              'disabled:cursor-not-allowed disabled:opacity-45',
            )}
            value={text}
            placeholder="例如：I would like to talk about a book I have read twice because…"
            disabled={disabled || busy || submitted}
            onChange={(event) => setText(event.target.value)}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="font-code text-xs text-ink-muted">{countWords(text)} 词</span>
            <Button size="sm" variant="outline" disabled={disabled || busy || submitted || !text.trim()} onClick={submitText}>
              提交文本答案
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
