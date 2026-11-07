/**
 * SparringPanel —— 1 对 1 口语陪练（契约 §16；FR-S7 / AC-S7.1–S7.6）。
 *
 * 与 `SpeakingPanel` 的关系：**同一屏里的第二种模式**（App 里用 Tabs 切换），不是新导航项。
 * 复用的东西一件不重写：录音（`RecorderControls`）、评分队列（`useGradingJobs`，§10.6）、
 * 报告渲染（`SpeakingResult`，因为 §16.4 要求陪练报告与题库口语报告同形状）、磁贴语言（§8.3）。
 *
 * 三个阶段：`picker`（选场景）→ `session`（对话）→ `result`（报告）。
 * 评分走异步路径：提交后进 `assessing` 骨架态，用户可离开这一屏（§10.6 的用户侧兑现）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Card, Tile, Toast } from '../../components/ui';
import { useApi } from '../../hooks/useApi';
import { useBackendReady } from '../../hooks/useBackendReady';
import { forgetJob, markJobViewed, trackJob, useGradingJobs, type TrackedJob } from '../../hooks/useGradingJobs';
import {
  assessSparringAsync,
  getSettings,
  getSparringSession,
  isApiError,
  postSparringTurn,
  sparringTopic,
  sparringTopics,
  startSparring,
} from '../../services/api';
import type {
  SparringMessage,
  SparringSession,
  SparringState,
  SparringTopic,
  SpeakingReport,
  SpeakingTurnInput,
} from '../../types/ielts';import { isSpeakingReport } from '../../types/ielts';
import { GradingJobsCard } from '../shared/GradingJobs';
import RecorderControls from './RecorderControls';
import SparringMessageList from './SparringMessageList';
import SparringTopicPicker from './SparringTopicPicker';
import SpeakingResult from './SpeakingResult';
import {
  LIMIT_REACHED_TEXT,
  SPARRING_TEXT_FALLBACK_LABEL,
  fallbackCount,
  forgetSession,
  messagesFromTurn,
  rememberSession,
  rememberedSession,
  turnsRemaining,
  turnsUsed,
} from './sparringSets';

type Stage = 'picker' | 'session' | 'assessing' | 'result';

export type SparringPanelProps = {
  /** 外壳已完成就绪探测时传入；不传则本屏自己轮询（AC-G1） */
  ready?: boolean;
  /** 一次评分落库后通知外壳（AC-P1 / AC-G2）：与题库口语同一个回调签名 */
  onAttemptRecorded?: (report: SpeakingReport) => void;
};

function detailOf(error: unknown): string {
  if (isApiError(error)) return error.detail || error.message;
  return error instanceof Error ? error.message : '操作失败，请重试';
}

const LOW_CONFIDENCE_TEXT = '转写置信度较低，可重录本轮或改用键盘输入继续。';

export function SparringPanel({ ready, onAttemptRecorded }: SparringPanelProps = {}) {
  const backend = useBackendReady();
  const isReady = ready ?? backend.ready;

  const [stage, setStage] = useState<Stage>('picker');
  const [topic, setTopic] = useState<SparringTopic | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SparringMessage[]>([]);
  const [state, setState] = useState<SparringState>('created');
  const [maxTurns, setMaxTurns] = useState(10);
  const [report, setReport] = useState<SpeakingReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  /**
   * 本会话内存里的「我上一轮录音」：`seq → Blob`。
   * 刻意不落库、不进 localStorage（契约 §5 没有音频列，宪法 §8 不留兼容壳）——
   * 它只服务「刚说完想立刻听第二遍」这一个动作，刷新即弃。
   */
  const [playback, setPlayback] = useState<Record<number, Blob>>({});
  const settledJobRef = useRef<string | null>(null);

  const grading = useGradingJobs();
  const myJobs = useMemo(() => grading.jobs.filter((job) => job.module === 'speaking'), [grading.jobs]);

  const topicsApi = useApi((options) => sparringTopics(null, options), [], { enabled: isReady });
  const settingsApi = useApi((options) => getSettings(options), [], { enabled: isReady });
  const deviceId = settingsApi.data?.audio_device ?? null;
  const ttsSpeed = settingsApi.data?.tts_speed ?? null;

  const used = turnsUsed(messages);
  const remaining = turnsRemaining(maxTurns, messages);
  const fallbacks = fallbackCount(messages);
  const limitReached = remaining <= 0;
  const finished = state === 'awaiting_assess' || state === 'assessed';

  const begin = useCallback(async (topicId: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    setMicError(null);
    setReport(null);
    setPlayback({});
    settledJobRef.current = null;
    setActiveJobId(null);
    try {
      const [detail, started] = await Promise.all([sparringTopic(topicId), startSparring({ topic_id: topicId })]);
      setTopic(detail);
      setSessionId(started.session_id);
      rememberSession(started.session_id);
      setMessages(started.messages ?? []);
      setState(started.state);
      setMaxTurns(started.max_turns);
      setStage('session');
    } catch (caught) {
      setError(detailOf(caught));
    } finally {
      setBusy(false);
    }
  }, []);

  const resume = useCallback(async (id: string) => {
    setBusy(true);
    setError(null);
    // 刷新接回时回放内存是空的（音频本来就不落库）—— 转写文本才是事实源，
    // 「回听」按钮自然不出现，这是「没有」而不是「坏了」。
    setPlayback({});
    try {
      const view: SparringSession = await getSparringSession(id);
      setSessionId(view.session_id);
      rememberSession(view.session_id);
      setMessages(view.messages ?? []);
      setState(view.state);
      setMaxTurns(view.max_turns);
      if (view.result && isSpeakingReport(view.result)) setReport(view.result);
      setStage('session');
    } catch (caught) {
      // 换过库 / 被清理时的 404：静默丢弃凭据并留在选题页（契约 §16.3 第 6 条）
      if (isApiError(caught) && caught.status === 404) {
        forgetSession();
        setSessionId(null);
        return;
      }
      setError(detailOf(caught));
    } finally {
      setBusy(false);
    }
  }, []);

  const submitTurn = useCallback(
    async (input: SpeakingTurnInput) => {
      if (!sessionId) return;
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const result = await postSparringTurn(sessionId, input);
        setMessages((previous) => messagesFromTurn(previous, result));
        setState(result.state);
        // 回听自己刚说的那句（FR-S7.6 / §16.5）：音频字节**不落库**（契约 §5 的
        // speaking_turns 就没有音频列），只在**本会话内存**里按 seq 留一份 ——
        // 刷新后回听消失是可接受的（转写文本才是事实源），但当场想听第二遍必须能听到。
        if (input.audio) {
          setPlayback((previous) => ({ ...previous, [result.seq]: input.audio as Blob }));
        }
        if (result.hint_zh) setNotice(result.hint_zh);
        else if (result.degraded_reason) {
          setNotice(
            result.source === 'fallback'
              ? 'AI 追问不可用，这一轮改用本话题的预置追问（流程照常继续）。'
              : null,
          );
        }
      } catch (caught) {
        setError(detailOf(caught));
      } finally {
        setBusy(false);
      }
    },
    [sessionId],
  );

  const assess = useCallback(async () => {
    if (!sessionId) return;
    setBusy(true);
    setError(null);
    try {
      const job = await assessSparringAsync(sessionId);
      trackJob(job, `口语陪练 · ${topic?.title_zh ?? sessionId}`);
      settledJobRef.current = null;
      setActiveJobId(job.job_id);
      // 已交付的会话不该再被「继续上一场」拉回来（契约 §16.3 第 6 条）
      forgetSession();
      setStage('assessing');
    } catch (caught) {
      setError(detailOf(caught));
    } finally {
      setBusy(false);
    }
  }, [sessionId, topic]);

  const activeJob = useMemo(
    () => (activeJobId ? myJobs.find((job) => job.job_id === activeJobId) ?? null : null),
    [activeJobId, myJobs],
  );

  /**
   * 刷新/重开应用后把未结束的会话接回来（契约 §16.3 第 6 条）。
   * 只在就绪后跑一次：`backend.ready` 之前打不到端点，而重连一次就够 —— 之后由 `begin` 接管。
   * 404/403 由 `resume` 内部静默丢弃凭据（换过库、被清理都不是用户的错）。
   */
  const restoredRef = useRef(false);
  useEffect(() => {
    if (!isReady || restoredRef.current) return;
    restoredRef.current = true;
    const pending = rememberedSession();
    if (!pending) return;
    void resume(pending);
  }, [isReady, resume]);

  // 评分是异步的（§10.6）：离开这一屏不影响结果，终态后才落到报告视图。
  useEffect(() => {
    if (!activeJob || settledJobRef.current === activeJob.job_id) return;
    if (activeJob.status === 'queued' || activeJob.status === 'running') return;
    settledJobRef.current = activeJob.job_id;
    const jobId = activeJob.job_id;
    const wasWaiting = stage === 'assessing';
    setActiveJobId(null);
    if (activeJob.status === 'succeeded' && activeJob.report && isSpeakingReport(activeJob.report)) {
      setReport(activeJob.report);
      onAttemptRecorded?.(activeJob.report);
      if (wasWaiting) {
        markJobViewed(jobId);
        setStage('result');
      }
      return;
    }
    setError(
      activeJob.error ||
        (activeJob.status === 'succeeded'
          ? '评分完成但没有回传口语报告，结果请在「练习记录」里查看。'
          : '评分失败，请重试'),
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

  const dismissJob = useCallback(
    (job: TrackedJob) => {
      forgetJob(job.job_id);
      if (job.job_id === activeJobId) setActiveJobId(null);
    },
    [activeJobId],
  );

  const backToPicker = () => {
    setStage('picker');
    setSessionId(null);
    setMessages([]);
    setState('created');
    setReport(null);
    setNotice(null);
    setError(null);
    setMicError(null);
    // 新会话从空回放开始：上一场的录音内存不属于这一场（也不该跨场攒着）
    setPlayback({});
    // 刻意**不**清 `localStorage` 里的凭据：退出不等于放弃。已经答过的对话留在学习库里，
    // 选题页给一颗「继续上一场」，下次进屏也会自动接回（契约 §16.3 第 6 条）。
    // 只有「已提交评分」才清（见 `assess`），因为那场已经交付了。
  };

  if (stage === 'result' && report) {
    return (
      <div className="flex flex-col gap-3">
        {error ? (
          <Toast tone="danger" onDismiss={() => setError(null)}>
            {error}
          </Toast>
        ) : null}
        <SpeakingResult
          report={report}
          transcript={messages
            .filter((item) => item.role === 'user')
            .map((item) => item.text)
            .join(' ')}
          onPracticeAgain={backToPicker}
        />
      </div>
    );
  }

  if (stage === 'picker') {
    return (
      <div className="flex flex-col gap-3">
        {error ? (
          <Toast tone="danger" onDismiss={() => setError(null)}>
            {error}
          </Toast>
        ) : null}
        {sessionId ? (
          <Toast
            tone="info"
            action={
              <Button size="sm" variant="outline" onClick={() => void resume(sessionId)}>
                继续上一场
              </Button>
            }
          >
            你有一场未结束的陪练会话。
          </Toast>
        ) : null}
        <GradingJobsCard jobs={myJobs} onView={openJobReport} onDismiss={dismissJob} onRefresh={grading.refresh} />
        <SparringTopicPicker
          ready={isReady}
          topics={topicsApi.data ?? []}
          loading={topicsApi.loading}
          error={topicsApi.error}
          onStart={(topicId) => void begin(topicId)}
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
          title="陪练评分中"
          subtitle={topic ? `${topic.title_zh} · 已答 ${used} 轮` : '口语陪练评分任务'}
          actions={
            <Badge tone="accent" dot>
              {activeJob.status === 'queued' ? '排队中' : '评分中'}
            </Badge>
          }
        >
          <div className="flex flex-col gap-2">
            <p className="text-sm text-ink-secondary">
              推理模型评整场对话通常要 1–2 分钟。现在可以去练别的科目，完成后左轨和选题页都会给出报告入口。
            </p>
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
                回对话查看
              </Button>
            </div>
          </div>
        </Card>
        <GradingJobsCard jobs={myJobs} onView={openJobReport} onDismiss={dismissJob} onRefresh={grading.refresh} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Card
        title={topic ? `1 对 1 陪练 · ${topic.title_zh}` : '1 对 1 陪练'}
        subtitle={topic?.scenario_zh}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {limitReached ? (
              <Badge tone="mid" dot>
                已到轮次上限
              </Badge>
            ) : null}
            <Button size="sm" variant="ghost" onClick={backToPicker}>
              退出
            </Button>
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent">{sessionId ?? '会话'}</Badge>
          {topic?.level ? <Badge variant="outline">{String(topic.level).toUpperCase()}</Badge> : null}
          <Badge tone="neutral">{formatLevel(topic)}</Badge>
        </div>
      </Card>

      {/* 磁贴条（契约 §16.5 / §8.3 同族）：只吃本地会话状态，不加新请求 */}
      <dl aria-label="陪练关键指标" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          metric="sparring.turns"
          label="已答轮次"
          value={`${used}/${maxTurns}`}
          hint="每答一轮，陪练官追问一句"
        />
        <Tile metric="sparring.remaining" label="剩余轮次" value={remaining} hint="到 0 后自动进入待评分" />
        <Tile
          metric="sparring.fallback"
          label="预置追问"
          value={fallbacks}
          hint="AI 不可用时逐轮回落；离线也能练完"
          surface={fallbacks > 0 ? 'warm' : 'plain'}
        />
        <Tile
          metric="sparring.topic"
          label="话题难度"
          value={topic?.level ? String(topic.level).toUpperCase() : '—'}
          hint={topic ? `目标 band ${formatLevel(topic)}` : '选题后显示'}
        />
      </dl>

      {error ? (
        <Toast tone="danger" onDismiss={() => setError(null)}>
          {error}
        </Toast>
      ) : null}
      {notice ? (
        <Toast tone="warn" onDismiss={() => setNotice(null)}>
          {notice}
        </Toast>
      ) : null}
      {micError ? (
        <Toast tone="warn" autoDismissMs={0} onDismiss={() => setMicError(null)}>
          {micError}
        </Toast>
      ) : null}
      {limitReached ? (
        <Toast tone="info" autoDismissMs={0}>
          {LIMIT_REACHED_TEXT}
        </Toast>
      ) : null}

      <Card title="对话" subtitle="陪练官开口 → 你答一句 → 它顺着你的话追问；离线时逐条标注预置来源">
        <SparringMessageList messages={messages} voice={topic?.partner_voice ?? null} speed={ttsSpeed} playback={playback} />
      </Card>

      {busy ? <p className="text-xs text-ink-muted">提交中…</p> : null}

      {finished ? (
        <Card title="结束并评分" subtitle="四维 band + 证据 + 改进建议（契约 §16.4，与题库口语同形状）">
          <div className="flex flex-col gap-3">
            <p className="text-sm text-ink-secondary">
              本场共 {used} 轮。评分会把整段对话当作一次自由口语练习记录进学习库。
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" loading={busy} onClick={() => void assess()}>
                评分这场对话
              </Button>
              <Button variant="ghost" onClick={backToPicker}>
                换一个场景
              </Button>
            </div>
          </div>
        </Card>
      ) : limitReached ? (
        <Card title="结束并评分" subtitle="已到轮次上限，先评分；想继续练可以开一个新会话">
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" loading={busy} onClick={() => void assess()}>
              评分这场对话
            </Button>
            <Button variant="ghost" onClick={backToPicker}>
              换一个场景
            </Button>
          </div>
        </Card>
      ) : (
        <RecorderControls
          /* 每答完一轮就按轮次重挂载：`RecorderControls` 内部有「只能提交一次」的闸门（防止连点），
             而陪练是**多轮**对话 —— 不换 key 的话第二轮输入框会被上一轮的 submitted 状态永久禁用。
             与题库口语按题号重挂载同一手法（`key={sessionId}-{promptId}`）。 */
          key={`${sessionId ?? 'sparring'}-${used}`}
          label={`这一轮我的话（第 ${used + 1} 轮）`}
          textLabel={SPARRING_TEXT_FALLBACK_LABEL}
          textPlaceholder="例如：I would like a table for two, please."
          deviceId={deviceId}
          busy={busy}
          disabled={limitReached}
          onSubmitAudio={(audio, durationSec) => submitTurn({ audio, durationSec })}
          onSubmitText={(text, durationSec) => submitTurn({ text, durationSec })}
          onMicError={setMicError}
          onMicRecovered={() => setMicError(null)}
          extraActions={
            used > 0 ? (
              // FR-S7.6「结束并评分」入口：不必答满上限也能交；练习到一半想收尾是常态
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void assess()}>
                结束并评分
              </Button>
            ) : null
          }
        />
      )}

      {/* AC-S7.6b：把「为什么不能继续」写在发送区旁边，而不是只靠禁用态 */}
      <p className="text-xs text-ink-muted">
        {SPARRING_TEXT_FALLBACK_LABEL}；转写置信度低于 0.5 时界面会提示重录（{LOW_CONFIDENCE_TEXT}）
      </p>
    </div>
  );
}

function formatLevel(topic: SparringTopic | null): string {
  const band = topic?.target_band;
  return typeof band === 'number' && Number.isFinite(band) ? band.toFixed(1) : '—';
}

export default SparringPanel;
