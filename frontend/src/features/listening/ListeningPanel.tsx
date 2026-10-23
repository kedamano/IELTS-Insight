/**
 * ListeningPanel —— 听力屏入口（FR-L1…L5 / AC-G1、AC-L1、AC-L1b、AC-L2、AC-L4）。
 *
 * 只消费 Wave 1 的层：`services/api`（唯一网络出口）、`hooks/*`、`components/ui`、`types/ielts`。
 * 流程（契约 §1 #13→#16）：
 *   选题（口音 / kind）→ 拉题面（不含答案）→ 拉音频 blob（503 可见）→ 答题（草稿自动落盘）
 *   → `postListeningAttempt` → §3-OR 批改视图。
 * 答案的唯一真源是 `useDraftAutosave` 里的 JSON 串，避免组件状态与本地存储两份数据打架。
 */
import { useCallback, useMemo, useState } from 'react';
import { Badge, Button, Card, Tile, Toast } from '../../components/ui';
import { useApi } from '../../hooks/useApi';
import { useBackendReady } from '../../hooks/useBackendReady';
import { useDraftAutosave } from '../../hooks/useDraftAutosave';
import { formatClock, useTimer } from '../../hooks/useTimer';
import { getSettings, isApiError, listeningSet, listeningSets, postListeningAttempt } from '../../services/api';
import type { Accent, AnswerMap, ListeningObjectiveReport, SetKind } from '../../types/ielts';
import AnswerSheet from './AnswerSheet';
import AudioPlayer from './AudioPlayer';
import ListeningReview from './ListeningReview';
import ListeningSetPicker from './ListeningSetPicker';
import SentenceReplay from './SentenceReplay';
import TranscriptPanel from './TranscriptPanel';
import {
  DEFAULT_SPEED,
  LISTENING_ACCENTS,
  answeredCount,
  audioTextOf,
  decodeAnswers,
  draftKeyOf,
  encodeAnswers,
  instructionOf,
  questionsOf,
  scaleAnchorsToDuration,
  sectionOf,
  sentencesOf,
} from './listeningSets';
import { useListeningAudio } from './useListeningAudio';

type Stage = 'picker' | 'practice' | 'review';

export type ListeningPanelProps = {
  /** 外壳已探测就绪时传入；不传则本屏自己轮询（AC-G1） */
  ready?: boolean;
  initialSetId?: string | null;
  initialAccent?: Accent;
  /** 一次练习落库后通知外壳刷新概览（AC-G2） */
  onAttemptRecorded?: (report: ListeningObjectiveReport) => void;
};

/** 后端错误一律显示 `detail`（CONSTITUTION §3：失败可见且可读）。 */
function detailOf(error: unknown): string {
  if (isApiError(error)) return error.detail || error.message;
  return error instanceof Error ? error.message : '操作失败，请重试';
}

/** 听力没有到点自动交卷（那是阅读的 AC-R3），这里只是累计 `duration_sec` 的量程上限。 */
const ELAPSED_CAP_SEC = 60 * 60;

export function ListeningPanel({
  ready,
  initialSetId = null,
  initialAccent,
  onAttemptRecorded,
}: ListeningPanelProps = {}) {
  const backend = useBackendReady();
  const isReady = ready ?? backend.ready;

  const [accent, setAccent] = useState<Accent>(initialAccent ?? 'en-GB');
  const [kind, setKind] = useState<SetKind>('practice');
  const [setId, setSetId] = useState<string | null>(initialSetId);
  const [stage, setStage] = useState<Stage>('picker');
  const [speed, setSpeed] = useState<number>(DEFAULT_SPEED);
  const [report, setReport] = useState<ListeningObjectiveReport | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  /** 真实音频时长：逐句重听的时间轴靠它把估算锚点缩放成实际秒数。 */
  const [durationSec, setDurationSec] = useState<number | null>(null);
  const [jump, setJump] = useState<{ sec: number; nonce: number } | null>(null);
  const [activeSentence, setActiveSentence] = useState<number | null>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(false);

  const setsApi = useApi(
    (options) => listeningSets({ accent, kind }, options),
    [accent, kind],
    { enabled: isReady },
  );

  const setApi = useApi(
    (options) => (setId ? listeningSet(setId, options) : Promise.resolve(null)),
    [setId],
    { enabled: isReady && !!setId },
  );

  const settingsApi = useApi((options) => getSettings(options), [], { enabled: isReady });
  const showChineseHints = settingsApi.data?.show_chinese_hints ?? true;

  const audio = useListeningAudio(stage === 'practice' ? setId : null, accent, {
    enabled: isReady && stage === 'practice',
  });

  const elapsed = useTimer({ durationSec: ELAPSED_CAP_SEC });

  const set = setApi.data;
  const questions = useMemo(() => questionsOf(set), [set]);
  const sentences = useMemo(() => sentencesOf(set), [set]);
  const timedSentences = useMemo(
    () => scaleAnchorsToDuration(sentences, durationSec),
    [sentences, durationSec],
  );
  const audioText = useMemo(() => audioTextOf(set), [set]);
  const promptById = useMemo(() => {
    const map = new Map<string, string>();
    for (const question of questions) map.set(question.id, question.prompt);
    return map;
  }, [questions]);

  const draftKey = setId ? draftKeyOf(setId) : 'listening_none';
  const draft = useDraftAutosave(draftKey, '', { enabled: !!setId });
  const answers = useMemo<AnswerMap>(() => decodeAnswers(draft.value), [draft.value]);
  // 磁贴条读数（契约 §8.3 规则 2）一律现算自本屏已有的 answers / timer / sentences，
  // 不许为填一块磁贴多发一次请求。
  const answeredTotal = useMemo(() => answeredCount(questions, answers), [questions, answers]);

  const setAnswer = useCallback(
    (questionId: string, next: string) => {
      draft.setValue(encodeAnswers({ ...answers, [questionId]: next }));
    },
    [answers, draft],
  );

  const startSet = useCallback(
    (nextId: string) => {
      setError(null);
      setReport(null);
      setTranscriptOpen(false);
      setJump(null);
      setActiveSentence(null);
      setDurationSec(null);
      setSetId(nextId);
      setStage('practice');
      elapsed.start(ELAPSED_CAP_SEC);
    },
    [elapsed],
  );

  const backToPicker = useCallback(() => {
    elapsed.pause();
    setStage('picker');
    setReport(null);
    setError(null);
    setTranscriptOpen(false);
    setPlaying(false);
  }, [elapsed]);

  const submit = useCallback(async () => {
    if (!setId) return;
    setSubmitting(true);
    setError(null);
    elapsed.pause();
    try {
      // 提交前先把草稿落盘：万一批改请求失败，刷新后答案还在
      draft.flush();
      const result = await postListeningAttempt(setId, {
        answers,
        duration_sec: Math.max(0, elapsed.elapsedSec),
      });
      setReport(result);
      setStage('review');
      draft.clear();
      onAttemptRecorded?.(result);
    } catch (caught) {
      setError(detailOf(caught));
    } finally {
      setSubmitting(false);
    }
  }, [answers, draft, elapsed, onAttemptRecorded, setId]);

  const replay = useCallback((idx: number, anchorSec: number) => {
    setActiveSentence(idx);
    setJump((prev) => ({ sec: anchorSec, nonce: (prev?.nonce ?? 0) + 1 }));
  }, []);

  // ---------- 渲染 ----------

  if (stage === 'picker') {
    return (
      <div className="flex flex-col gap-3">
        {error ? (
          <Toast tone="danger" onDismiss={() => setError(null)}>
            {error}
          </Toast>
        ) : null}
        <ListeningSetPicker
          ready={isReady}
          sets={setsApi.data ?? []}
          loading={setsApi.loading}
          error={setsApi.error ?? (backend.state === 'failed' ? backend.lastError : null)}
          accent={accent}
          kind={kind}
          onAccentChange={setAccent}
          onKindChange={setKind}
          onStart={startSet}
          readyMessage={backend.message}
          onRetry={backend.retry}
        />
      </div>
    );
  }

  if (stage === 'review' && report) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" onClick={backToPicker}>
            换一套
          </Button>
        </div>
        <ListeningReview
          report={report}
          showChineseHints={showChineseHints}
          onPracticeAgain={() => (setId ? startSet(setId) : backToPicker())}
          questionsPrompt={(itemId) => promptById.get(itemId) ?? null}
        />
      </div>
    );
  }

  if (!setId) return null;

  const accentLabel = LISTENING_ACCENTS.find((item) => item.id === accent)?.label ?? accent;
  const section = set ? sectionOf(set) : null;

  return (
    <div className="flex flex-col gap-3">
      <Card
        title={set?.title_zh ?? '听力练习'}
        subtitle={set ? `${set.id}${section ? ` · Section ${section}` : ''}` : '题面加载中…'}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone="neutral">{accentLabel}</Badge>
            <Button size="sm" variant="ghost" onClick={backToPicker}>
              退出
            </Button>
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={audio.status === 'ready' ? 'good' : audio.status === 'unavailable' ? 'mid' : 'neutral'} dot>
            {audio.status === 'ready' ? '音频就绪' : audio.status === 'unavailable' ? '音频不可用' : '音频加载中'}
          </Badge>
          {draft.restored ? <Badge tone="accent">已恢复上次草稿</Badge> : null}
          {!draft.available ? <Badge tone="mid">本机草稿不可用（隐私模式）</Badge> : null}
          <Button
            size="sm"
            variant={transcriptOpen ? 'primary' : 'outline'}
            aria-pressed={transcriptOpen}
            onClick={() => setTranscriptOpen((open) => !open)}
          >
            看原文精读
          </Button>
        </div>
      </Card>

      {/* 磁贴条（契约 §8.3）：只在作答阶段出现，答题区版式与交互一律不动。
          面只有 plain，唯一的暖面给「音频不可用」这个降级信号；缺数据的块整块不渲染。 */}
      <dl aria-label="听力关键指标" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile metric="listening.answered" label="已作答" value={`${answeredTotal}/${questions.length}`} />
        <Tile metric="listening.elapsed" label="已用时" value={formatClock(elapsed.elapsedSec)} />
        {sentences.length > 0 ? (
          <Tile metric="listening.replay" label="可逐句重听" value={sentences.length} unit="句" />
        ) : null}
        {audio.status === 'unavailable' ? (
          <Tile
            metric="listening.degraded"
            surface="warm"
            label="音频不可用"
            value="已降级"
            hint="已按 AC-L1b 进入原文精读模式"
          />
        ) : null}
      </dl>

      {setApi.error ? <Toast tone="danger">{`题面加载失败：${setApi.error}`}</Toast> : null}
      {draft.error ? <Toast tone="warn">{draft.error}</Toast> : null}

      <AudioPlayer
        audioUrl={audio.audioUrl}
        status={audio.status}
        errorText={audio.errorText}
        speed={speed}
        onSpeedChange={setSpeed}
        jump={jump}
        onEnterTranscript={() => setTranscriptOpen(true)}
        onRetryAudio={audio.retry}
        onPlayingChange={setPlaying}
        onDurationChange={setDurationSec}
      />

      <AnswerSheet
        instruction={instructionOf(set)}
        questions={questions}
        answers={answers}
        onChange={setAnswer}
        onSubmit={() => void submit()}
        submitting={submitting}
        disabled={setApi.loading || !questions.length}
        playingNote={playing}
        draftText={draft.dirty ? '草稿待保存…' : draft.savedAt ? '草稿已保存' : null}
        errorText={error}
        onDismissError={() => setError(null)}
      />

      {transcriptOpen ? (
        <TranscriptPanel
          text={audioText}
          note={
            audio.unavailable
              ? '音频服务不可用（503），已按 AC-L1b 进入原文精读模式。'
              : '精读模式：对照原文理解，不影响批改。'
          }
        />
      ) : null}

      <SentenceReplay
        sentences={timedSentences}
        activeIdx={activeSentence}
        canPlay={audio.status === 'ready'}
        onReplay={(sentence) => replay(sentence.idx, sentence.anchor_sec)}
      />
    </div>
  );
}

export default ListeningPanel;
