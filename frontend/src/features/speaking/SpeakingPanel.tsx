/**
 * SpeakingPanel —— 口语屏入口（FR-S1…S6 / AC-G1、AC-S2、AC-S3、AC-S3b、AC-S4、AC-S6、AC-V3）。
 *
 * 只消费 Wave 1 的层：`services/api`（唯一出口）、`hooks/*`、`components/ui`、`types/ielts`；
 * 本文件不重新实现录音、计时、TTS、请求缓存，也不声明任何新数据形状。
 *
 * 流程（契约 §1 #6→#12、#11b、§10.6）：
 * 选题（target_band + Part）→ `startSpeaking` → 逐题 `postSpeakingTurn`（音频或文本兜底）
 * → `assessSpeakingAsync` 排队评分，拿 `job_id` 后可以离开这一屏去做别的，`useGradingJobs`
 * 轮询到终态再出 §3-S 报告；Part 3 先取 `followups`，AI 不可用时用预置 `fallback_questions`。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Card, Toast } from '../../components/ui';
import { useApi } from '../../hooks/useApi';
import { useBackendReady } from '../../hooks/useBackendReady';
import { forgetJob, markJobViewed, trackJob, useGradingJobs, type TrackedJob } from '../../hooks/useGradingJobs';
import {
  assessSpeakingAsync,
  followups,
  getSettings,
  isApiError,
  postSpeakingTurn,
  speakingSet,
  speakingSets,
  startSpeaking,
} from '../../services/api';
import type {
  Band,
  DegradedReason,
  SpeakingPart,
  SpeakingPrompt,
  SpeakingReport,
  SpeakingTurnInput,
} from '../../types/ielts';
import { isSpeakingReport } from '../../types/ielts';
import { GradingJobsCard } from '../shared/GradingJobs';
import CueCard from './CueCard';
import FollowupList from './FollowupList';
import RecorderControls from './RecorderControls';
import SetPicker from './SetPicker';
import SpeakingPromptView from './SpeakingPromptView';
import SpeakingResult from './SpeakingResult';
import {
  LOW_CONFIDENCE_TEXT,
  cueCardOf,
  examinerVoiceOf,
  fallbackQuestionsOf,
  isLowConfidence,
} from './speakingSets';

type Stage = 'picker' | 'session' | 'assessing' | 'result';

interface LiveTurn {
  promptId: string;
  transcript: string;
  /** 文本兜底没有声学置信度（后端给 null） */
  confidence: number | null;
  durationSec: number | null;
}

interface LiveSession {
  sessionId: string;
  setId: string;
  part: SpeakingPart;
  index: number;
  total: number;
  current: SpeakingPrompt;
  turns: LiveTurn[];
  /** 下一题为 null（Part 1/3 走完）或到达时长上限（AC-S2） */
  finished: boolean;
  limitReached: boolean;
}

interface FollowupState {
  questions: string[];
  aiUsed: boolean;
  degradedReason: DegradedReason;
}

export type SpeakingPanelProps = {
  /** 外壳已完成就绪探测时传入；不传则本屏自己轮询（AC-G1） */
  ready?: boolean;
  /** 从今日计划等处直接带入的套题 */
  initialSetId?: string | null;
  initialPart?: SpeakingPart;
  /** 一次评分落库后通知外壳刷新概览（AC-P1 / AC-G2） */
  onAttemptRecorded?: (report: SpeakingReport) => void;
};

/** 后端错误一律显示 `detail`（AC-S3 的可理解中文要求）。 */
function detailOf(error: unknown): string {
  if (isApiError(error)) return error.detail || error.message;
  return error instanceof Error ? error.message : '操作失败，请重试';
}

export function SpeakingPanel({
  ready,
  initialSetId = null,
  initialPart = 1,
  onAttemptRecorded,
}: SpeakingPanelProps = {}) {
  const backend = useBackendReady();
  const isReady = ready ?? backend.ready;

  const [targetBand, setTargetBand] = useState<Band>(6.5);
  const [part, setPart] = useState<SpeakingPart>(initialPart);
  const [selectedSetId, setSelectedSetId] = useState<string | null>(initialSetId);
  const [stage, setStage] = useState<Stage>('picker');
  const [session, setSession] = useState<LiveSession | null>(null);
  const [report, setReport] = useState<SpeakingReport | null>(null);
  const [followup, setFollowup] = useState<FollowupState | null>(null);
  const [speakingStarted, setSpeakingStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** 麦克风为什么不可用（AC-S3b）：换题不丢，用户看得见自己为什么在用文本兜底 */
  const [micError, setMicError] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const settledJobRef = useRef<string | null>(null);

  const grading = useGradingJobs();
  const myJobs = useMemo(
    () => grading.jobs.filter((job) => job.module === 'speaking'),
    [grading.jobs],
  );

  /** Part 2 的转写要喂给 Part 3 的动态追问（FR-S6） */
  const part2TranscriptRef = useRef('');

  const setsApi = useApi(
    (options) => speakingSets(targetBand, options),
    [targetBand],
    { enabled: isReady },
  );

  const setApi = useApi(
    (options) => (selectedSetId ? speakingSet(selectedSetId, options) : Promise.resolve(null)),
    [selectedSetId],
    { enabled: isReady && !!selectedSetId },
  );

  const settingsApi = useApi((options) => getSettings(options), [], { enabled: isReady });
  const deviceId = settingsApi.data?.audio_device ?? null;
  const ttsSpeed = settingsApi.data?.tts_speed ?? null;
  const examinerVoice = examinerVoiceOf(setApi.data);

  const set = setApi.data;
  const card = cueCardOf(set);
  const fallbackQuestions = fallbackQuestionsOf(set);
  const transcript = session?.turns.map((turn) => turn.transcript).join(' ') ?? '';

  const begin = useCallback(
    async (setId: string, chosenPart: SpeakingPart) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      setMicError(null);
      setFollowup(null);
      setReport(null);
      setSpeakingStarted(false);
      setSelectedSetId(setId);
      try {
        const started = await startSpeaking({ set_id: setId, part: chosenPart });
        let nextFollowup: FollowupState | null = null;
        if (chosenPart === 3) {
          try {
            const result = await followups({ set_id: setId, part2_transcript: part2TranscriptRef.current });
            const aiUsed = result.ai_used !== false;
            nextFollowup = {
              questions: result.questions ?? [],
              aiUsed,
              degradedReason: result.degraded_reason ?? null,
            };
            if (!aiUsed) {
              setNotice('AI 追问不可用，已改用本套题的预置追问（流程照常进行）。');
            }
          } catch (caught) {
            nextFollowup = { questions: [], aiUsed: false, degradedReason: 'network_error' };
            setError(`追问生成失败：${detailOf(caught)}；已改用预置追问继续。`);
          }
        }
        setFollowup(nextFollowup);
        setSession({
          sessionId: started.session_id,
          setId,
          part: started.part,
          index: started.index,
          total: started.total,
          current: started.current,
          turns: [],
          finished: false,
          limitReached: false,
        });
        setStage('session');
      } catch (caught) {
        setError(detailOf(caught));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const submitTurn = useCallback(
    async (input: SpeakingTurnInput) => {
      if (!session) return;
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const result = await postSpeakingTurn(session.sessionId, input);
        const confidence = typeof result.confidence === 'number' ? result.confidence : null;
        const turn: LiveTurn = {
          promptId: session.current.id,
          transcript: result.transcript,
          confidence,
          durationSec: typeof input.durationSec === 'number' ? input.durationSec : null,
        };
        const turns = [...session.turns, turn];
        if (session.part === 2) part2TranscriptRef.current = result.transcript;

        if (isLowConfidence(confidence)) setNotice(LOW_CONFIDENCE_TEXT);

        const limitReached = result.elapsed_limit_reached === true;
        setSession({
          ...session,
          turns,
          current: result.next ?? session.current,
          index: result.next ? session.index + 1 : session.index,
          finished: limitReached || result.next === null,
          limitReached,
        });
      } catch (caught) {
        setError(detailOf(caught));
      } finally {
        setBusy(false);
      }
    },
    [session],
  );

  const assess = useCallback(async () => {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const job = await assessSpeakingAsync(session.sessionId);
      trackJob(job, `口语 · Part ${session.part} ${session.setId}`);
      settledJobRef.current = null;
      setActiveJobId(job.job_id);
      setStage('assessing');
    } catch (caught) {
      setError(detailOf(caught));
    } finally {
      setBusy(false);
    }
  }, [session]);

  const activeJob = useMemo(
    () => (activeJobId ? myJobs.find((job) => job.job_id === activeJobId) ?? null : null),
    [activeJobId, myJobs],
  );

  // 评分排队是异步的（§10.6）：离开这一屏不影响结果，任务终态后才落到报告视图。
  useEffect(() => {
    if (!activeJob || settledJobRef.current === activeJob.job_id) return;
    if (activeJob.status === 'queued' || activeJob.status === 'running') return;
    settledJobRef.current = activeJob.job_id;
    const jobId = activeJob.job_id;
    const wasWaiting = stage === 'assessing';
    setActiveJobId(null);
    if (activeJob.status === 'succeeded' && activeJob.report && isSpeakingReport(activeJob.report)) {
      const result = activeJob.report;
      setReport(result);
      onAttemptRecorded?.(result);
      if (wasWaiting) {
        markJobViewed(jobId);
        setStage('result');
      }
      return;
    }
    setError(
      activeJob.error ||
        (activeJob.status === 'succeeded' ? '评分完成但没有回传口语报告，结果请在「练习记录」里查看。' : '评分失败，请重试'),
    );
    if (wasWaiting) {
      markJobViewed(jobId);
      setStage('session');
    }
  }, [activeJob, onAttemptRecorded, stage]);

  const openJobReport = useCallback((job: TrackedJob) => {
    if (!job.report || !isSpeakingReport(job.report)) return;
    markJobViewed(job.job_id);
    setReport(job.report);
    setError(null);
    setStage('result');
  }, []);

  const dismissJob = useCallback((job: TrackedJob) => {
    forgetJob(job.job_id);
    if (job.job_id === activeJobId) setActiveJobId(null);
  }, [activeJobId]);

  const clearMicError = useCallback(() => setMicError(null), []);

  const backToPicker = () => {
    setStage('picker');
    setSession(null);
    setReport(null);
    setFollowup(null);
    setNotice(null);
    setError(null);
    setMicError(null);
    setSpeakingStarted(false);
  };

  if (!isReady && stage === 'picker') {
    return (
      <SetPicker
        ready={false}
        sets={[]}
        loading={false}
        error={backend.state === 'failed' ? backend.lastError : null}
        targetBand={targetBand}
        part={part}
        onTargetBandChange={setTargetBand}
        onPartChange={setPart}
        onStart={(setId, chosen) => void begin(setId, chosen)}
        readyMessage={backend.message}
        onRetry={backend.retry}
      />
    );
  }

  if (stage === 'picker') {
    return (
      <div className="flex flex-col gap-3">
        {error ? <Toast tone="danger" onDismiss={() => setError(null)}>{error}</Toast> : null}
        <GradingJobsCard jobs={myJobs} onView={openJobReport} onDismiss={dismissJob} onRefresh={grading.refresh} />
        <SetPicker
          ready={isReady}
          sets={setsApi.data ?? []}
          loading={setsApi.loading}
          error={setsApi.error}
          targetBand={targetBand}
          part={part}
          onTargetBandChange={setTargetBand}
          onPartChange={setPart}
          onStart={(setId, chosen) => void begin(setId, chosen)}
          readyMessage={backend.message}
          onRetry={backend.retry}
        />
      </div>
    );
  }

  if (stage === 'assessing' && activeJob) {
    return (
      <div className="view-enter flex flex-col gap-3">
        <Card
          title="评分中"
          subtitle={session ? `会话 ${session.sessionId} · 已答 ${session.turns.length} 题` : '口语评分任务'}
          actions={
            <Badge tone="accent" dot>
              {activeJob.status === 'queued' ? '排队中' : '评分中'}
            </Badge>
          }
        >
          <div className="flex flex-col gap-2">
            <p className="text-sm text-ink-secondary">
              推理模型评分通常要 1–2 分钟。现在可以去练写作、阅读或听力，完成后左轨和选题页都会给出报告入口。
            </p>
            <p className="text-xs text-ink-muted">转写与会话保留在本机，评分失败可原样重试。</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={backToPicker}>
                离开等待，去选题
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setActiveJobId(null);
                  setStage('session');
                }}
              >
                回会话查看作答
              </Button>
            </div>
          </div>
        </Card>

        <GradingJobsCard jobs={myJobs} onView={openJobReport} onDismiss={dismissJob} onRefresh={grading.refresh} />
      </div>
    );
  }

  if (stage === 'result' && report) {
    return (
      <div className="flex flex-col gap-3">
        {error ? <Toast tone="danger" onDismiss={() => setError(null)}>{error}</Toast> : null}
        <SpeakingResult report={report} transcript={transcript} onPracticeAgain={backToPicker} />
      </div>
    );
  }

  if (!session) return null;

  const isCueCard = session.current.kind === 'cue_card';
  const monologueMaxMs = isCueCard && card ? card.speaking_sec * 1000 : undefined;
  const followupTexts = followup
    ? followup.aiUsed
      ? followup.questions
      : fallbackQuestions.length
        ? fallbackQuestions
        : followup.questions
    : [];
  const displayText = session.part === 3 ? (followupTexts[session.index] ?? session.current.text) : undefined;

  return (
    <div className="flex flex-col gap-3">
      <Card
        title={`${session.part === 2 ? 'Part 2 题卡' : `Part ${session.part}`} · 第 ${Math.min(session.index + 1, session.total)} / ${session.total} 题`}
        subtitle={`会话 ${session.sessionId}（已答 ${session.turns.length} 题）`}
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={backToPicker}>
              退出
            </Button>
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent">{session.setId}</Badge>
          {session.limitReached ? <Badge tone="mid" dot>已到时长上限</Badge> : null}
          {session.finished ? <Badge tone="good" dot>本题组已作答，可评分</Badge> : null}
        </div>
      </Card>

      {error ? <Toast tone="danger" onDismiss={() => setError(null)}>{error}</Toast> : null}
      {notice ? <Toast tone="warn" onDismiss={() => setNotice(null)}>{notice}</Toast> : null}
      {micError ? (
        <Toast tone="warn" autoDismissMs={0} onDismiss={clearMicError}>
          {micError}
        </Toast>
      ) : null}
      {setApi.error ? <Toast tone="warn">{`题面加载失败：${setApi.error}`}</Toast> : null}

      {session.part === 3 ? (
        <FollowupList
          questions={followup?.questions ?? []}
          aiUsed={followup?.aiUsed ?? true}
          degradedReason={followup?.degradedReason ?? null}
          fallbackQuestions={fallbackQuestions}
          activeIndex={session.index}
        />
      ) : null}

      {isCueCard && card ? (
        <CueCard
          prompt={session.current}
          card={card}
          speakingStarted={speakingStarted}
          onBeginSpeaking={() => setSpeakingStarted(true)}
          examinerVoice={examinerVoice}
          speed={ttsSpeed}
        />
      ) : (
        <SpeakingPromptView
          prompt={session.current}
          displayText={displayText}
          examinerVoice={examinerVoice}
          speed={ttsSpeed}
          position={{ index: session.index, total: session.total }}
        />
      )}

      {busy ? <p className="text-xs text-ink-muted">提交中…</p> : null}

      {isCueCard && card && !speakingStarted ? null : (
        <RecorderControls
          key={`${session.sessionId}-${session.current.id}`}
          label={isCueCard ? 'Part 2 独白（2 分钟）' : `Part ${session.part} 作答`}
          maxDurationMs={monologueMaxMs}
          autoSubmitOnLimit={isCueCard}
          deviceId={deviceId}
          busy={busy}
          disabled={session.finished}
          onSubmitAudio={(audio, durationSec) => submitTurn({ audio, durationSec })}
          onSubmitText={(text, durationSec) => submitTurn({ text, durationSec })}
          onLimit={() => setNotice('已到 2:00 上限：录音自动停止且不可续录（AC-S2）。')}
          onMicError={setMicError}
          onMicRecovered={clearMicError}
        />
      )}

      {session.finished ? (
        <Card title="评分" subtitle="四维 band + 证据 + 改进建议（契约 §3-S）">
          <div className="flex flex-col gap-3">
            <ul className="flex flex-col gap-1 text-sm text-ink-secondary">
              {session.turns.map((turn, index) => (
                <li key={`${turn.promptId}-${index}`} className="flex items-start gap-2">
                  <span className="font-code text-xs text-ink-muted">{index + 1}.</span>
                  <span className="min-w-0 flex-1">{turn.transcript}</span>
                  {typeof turn.confidence === 'number' ? (
                    <Badge tone={isLowConfidence(turn.confidence) ? 'mid' : 'neutral'}>
                      置信 {turn.confidence.toFixed(2)}
                    </Badge>
                  ) : (
                    <Badge tone="neutral">文本输入</Badge>
                  )}
                </li>
              ))}
            </ul>
            <div>
              <Button variant="primary" loading={busy} onClick={() => void assess()}>
                开始评分
              </Button>
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

export default SpeakingPanel;
