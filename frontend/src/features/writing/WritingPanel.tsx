/**
 * WritingPanel —— 写作屏入口（FR-W1…W3 / AC-W1、AC-W2、AC-W3b、AC-G1、AC-G3）。
 *
 * 四段式流程：选题（Tabs 切 Task 1/Task 2 + target_band 分层）→ 做题（题面 + 本地 SVG 图表 +
 * textarea 实时字数 + 草稿自动落盘 + 建议用时计时）→ 批改中 → 批改视图。
 * 批改走异步端点（#21b，契约 §10.6）：提交即拿 `job_id`，用户可以去练别的科目，`useGradingJobs`
 * 统一轮询并在终态时回到报告；草稿只在批改成功后清空（AC-W2），失败原样保留。
 * 网络只走 `services/api`（#20/#21/#22b，契约 §1），组件内不拼 URL、不裸 fetch。
 * CONSTITUTION §3：批改失败显示后端 `detail`/`error` 原文并提供重试；草稿不可用、离线降级一律显式标记。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Card, Countdown, Field, TabPanel, Tabs, Tile, Toast, bandTone } from '../../components/ui';
import { useApi } from '../../hooks/useApi';
import { useBackendReady } from '../../hooks/useBackendReady';
import { useDraftAutosave } from '../../hooks/useDraftAutosave';
import { forgetJob, markJobViewed, trackJob, useGradingJobs, type TrackedJob } from '../../hooks/useGradingJobs';
import { formatClock, useTimer } from '../../hooks/useTimer';
import { isApiError, postWritingAttemptAsync, writingTasks } from '../../services/api';
import type { Band, WritingAttemptBody, WritingReport, WritingTaskKind } from '../../types/ielts';
import { formatBand, isWritingReport } from '../../types/ielts';
import { GradingJobsCard } from '../shared/GradingJobs';
import { Task1ChartCard } from './Task1Chart';
import WritingResult from './WritingResult';
import {
  CHART_TYPE_LABEL_ZH,
  TASK2_QUESTION_TYPE_LABEL_ZH,
  WRITING_TASK_KINDS,
  countWords,
  draftKeyOf,
  isTask1,
  isTask2,
  missingWords,
  targetBandsOf,
  tasksForKind,
} from './writingSets';

type Stage = 'picker' | 'practice' | 'grading' | 'review';

export type WritingPanelProps = {
  /** 外壳已探测就绪时传入；不传则本屏自己轮询（AC-G1）。 */
  ready?: boolean;
  initialTaskId?: string | null;
  initialKind?: WritingTaskKind;
  /** 一次批改落库后通知外壳刷新概览（AC-G2）。 */
  onAttemptRecorded?: (report: WritingReport) => void;
};

/** 建议用时之外再多留 20 分钟余量，作为 `duration_sec` 的量程上限（超时不自动交卷，那是阅读的 AC-R3）。 */
const ELAPSED_CAP_SEC = 60 * 60;

const TABS_ID = 'writing-task-kind';

/** 后端错误一律显示 `detail`（CONSTITUTION §3：失败可见且可读）。 */
function detailOf(error: unknown): string {
  if (isApiError(error)) return error.detail || error.message;
  return error instanceof Error ? error.message : '操作失败，请重试';
}

export function WritingPanel({
  ready,
  initialTaskId = null,
  initialKind = 'task1',
  onAttemptRecorded,
}: WritingPanelProps = {}) {
  const backend = useBackendReady();
  const isReady = ready ?? backend.ready;

  const [kind, setKind] = useState<WritingTaskKind>(initialKind);
  const [band, setBand] = useState<Band | null>(null);
  const [taskId, setTaskId] = useState<string | null>(initialTaskId);
  const [stage, setStage] = useState<Stage>('picker');
  const [report, setReport] = useState<WritingReport | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const settledJobRef = useRef<string | null>(null);

  const grading = useGradingJobs();
  const myJobs = useMemo(
    () => grading.jobs.filter((job) => job.module === 'writing'),
    [grading.jobs],
  );

  const tasksApi = useApi((options) => writingTasks(kind, options), [kind], { enabled: isReady });

  const kindTasks = useMemo(() => tasksForKind(tasksApi.data, kind), [tasksApi.data, kind]);
  const bands = useMemo(() => targetBandsOf(kindTasks), [kindTasks]);
  const visibleTasks = band === null ? kindTasks : kindTasks.filter((task) => task.target_band === band);
  const task = useMemo(() => kindTasks.find((item) => item.id === taskId) ?? null, [kindTasks, taskId]);

  // `useTimer` 只用于累计 `duration_sec`（无漂移，见 hooks/useTimer）；建议用时的倒计时显示交给 Countdown。
  const timer = useTimer({ durationSec: ELAPSED_CAP_SEC });
  const suggestedSec = task?.time_recommend_sec ?? 0;
  const overSuggested = suggestedSec > 0 && timer.elapsedSec >= suggestedSec;
  const draftKey = taskId ? draftKeyOf(taskId) : 'writing_none';
  const draft = useDraftAutosave(draftKey, '', { enabled: !!taskId });

  const wordCount = countWords(draft.value);
  const minWords = task?.min_words ?? 0;
  const shortBy = missingWords(draft.value, minWords);
  const reached = minWords > 0 && shortBy === 0;

  const startTask = useCallback(
    (nextId: string) => {
      setError(null);
      setReport(null);
      setTaskId(nextId);
      setStage('practice');
      // 换题即不再认领上一个批改任务的结果：它仍在后台跑，完成提示交给左轨与选题页横幅。
      setActiveJobId(null);
      settledJobRef.current = null;
      timer.start(ELAPSED_CAP_SEC);
    },
    [timer],
  );

  const backToPicker = useCallback(() => {
    timer.pause();
    setStage('picker');
    setReport(null);
    setError(null);
  }, [timer]);

  const submit = useCallback(async () => {
    if (!taskId) return;
    const text = draft.value;
    if (!text.trim()) {
      setError('作文为空，请先写内容再提交批改');
      return;
    }
    setSubmitting(true);
    setError(null);
    timer.pause();
    // 提交前先落盘：万一批改失败，刷新后正文还在（AC-W2）
    draft.flush();
    const savedAt = draft.savedAt ?? Date.now();
    const body: WritingAttemptBody = {
      task_id: taskId,
      response: text,
      duration_sec: Math.max(0, timer.elapsedSec),
      draft_saved_at: new Date(savedAt).toISOString(),
    };
    try {
      const job = await postWritingAttemptAsync(body);
      trackJob(job, `写作 · ${task?.title_zh ?? taskId}`);
      settledJobRef.current = null;
      setActiveJobId(job.job_id);
      setStage('grading');
    } catch (caught) {
      setError(detailOf(caught));
    } finally {
      setSubmitting(false);
    }
  }, [draft, task?.title_zh, taskId, timer]);

  const activeJob = useMemo(
    () => (activeJobId ? myJobs.find((job) => job.job_id === activeJobId) ?? null : null),
    [activeJobId, myJobs],
  );

  // 轮询到终态：成功才清空草稿（AC-W2），失败把后端 error 原文留在屏幕上并可重试（CONSTITUTION §3）。
  // 用户若已经离开等待页，结果不硬闯当前界面 —— 交给横幅/左轨的「查看报告」，所以只有当场看到才标已读。
  useEffect(() => {
    if (!activeJob || settledJobRef.current === activeJob.job_id) return;
    if (activeJob.status === 'queued' || activeJob.status === 'running') return;
    settledJobRef.current = activeJob.job_id;
    const jobId = activeJob.job_id;
    const wasWaiting = stage === 'grading';
    setActiveJobId(null);
    if (activeJob.status === 'succeeded' && activeJob.report && isWritingReport(activeJob.report)) {
      const result = activeJob.report;
      setReport(result);
      draft.clear();
      onAttemptRecorded?.(result);
      if (wasWaiting) {
        markJobViewed(jobId);
        setStage('review');
      }
      return;
    }
    setError(
      activeJob.error ||
        (activeJob.status === 'succeeded' ? '批改完成但没有回传写作报告，结果请在「练习记录」里查看。' : '批改失败，请重新提交'),
    );
    if (wasWaiting) {
      markJobViewed(jobId);
      setStage('practice');
    }
  }, [activeJob, draft, onAttemptRecorded, stage]);

  const openJobReport = useCallback((job: TrackedJob) => {
    if (!job.report || !isWritingReport(job.report)) return;
    markJobViewed(job.job_id);
    setReport(job.report);
    setTaskId(job.task_ref);
    setError(null);
    setStage('review');
  }, []);

  const dismissJob = useCallback((job: TrackedJob) => {
    forgetJob(job.job_id);
    const wasActive = job.job_id === activeJobId;
    if (wasActive) setActiveJobId(null);
    setStage((current) => (wasActive && current === 'grading' ? 'practice' : current));
  }, [activeJobId]);

  // ---------- 选题 ----------
  if (stage === 'picker') {
    const activeKind = WRITING_TASK_KINDS.find((item) => item.id === kind);
    return (
      <div className="flex flex-col gap-3">
        {error ? (
          <Toast tone="danger" onDismiss={() => setError(null)}>
            {error}
          </Toast>
        ) : null}

        <GradingJobsCard jobs={myJobs} onView={openJobReport} onDismiss={dismissJob} onRefresh={grading.refresh} />

        <Card
          title="选择写作任务"
          subtitle={activeKind ? `${activeKind.label} · ${activeKind.note}` : 'Task 1 图表描述 / Task 2 议论文'}
          actions={
            <Badge tone={isReady ? 'good' : 'mid'} dot>
              {isReady ? '引擎已就绪' : '引擎启动中'}
            </Badge>
          }
        >
          <div className="flex flex-col gap-3">
            {!isReady ? (
              <div role="status" aria-live="polite" className="flex flex-col gap-2">
                <p className="text-sm text-ink-secondary">{backend.message}</p>
                <div>
                  <Button size="sm" onClick={backend.retry}>
                    重试
                  </Button>
                </div>
                <p className="text-xs text-ink-muted">就绪前不能进入写作练习（AC-G1）。</p>
              </div>
            ) : null}

            {tasksApi.error ? (
              <Toast tone="danger">
                任务列表加载失败：{tasksApi.error}
                <Button size="sm" variant="ghost" className="ml-2" onClick={() => void tasksApi.refetch()}>
                  重试
                </Button>
              </Toast>
            ) : null}

            <Tabs
              id={TABS_ID}
              ariaLabel="写作任务类型"
              value={kind}
              onChange={(next) => {
                setKind(next as WritingTaskKind);
                setBand(null);
              }}
              items={WRITING_TASK_KINDS.map((item) => ({
                id: item.id,
                label: item.label,
                disabled: !isReady,
              }))}
            />

            <TabPanel baseId={TABS_ID} tabId={kind} key={kind}>
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-ink-secondary">目标 Band（难度分层）</span>
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="目标 band">
                    <Button
                      size="sm"
                      variant={band === null ? 'primary' : 'outline'}
                      aria-pressed={band === null}
                      disabled={!isReady}
                      onClick={() => setBand(null)}
                    >
                      全部
                    </Button>
                    {bands.map((item) => (
                      <Button
                        key={item}
                        size="sm"
                        variant={band === item ? 'primary' : 'outline'}
                        aria-pressed={band === item}
                        disabled={!isReady}
                        onClick={() => setBand(item)}
                      >
                        {formatBand(item)}
                      </Button>
                    ))}
                  </div>
                </div>

                {tasksApi.loading ? <p className="text-sm text-ink-muted">任务加载中…</p> : null}
                {isReady && !tasksApi.loading && !tasksApi.error && !visibleTasks.length ? (
                  <p className="text-sm text-ink-muted">该难度档暂无 {activeKind?.label ?? kind} 任务，换个档位试试。</p>
                ) : null}

                <ul className="flex flex-col gap-2">
                  {visibleTasks.map((item) => {
                    const chartType = isTask1(item) ? item.chart?.type : undefined;
                    const questionType = isTask2(item) ? TASK2_QUESTION_TYPE_LABEL_ZH[item.question_type] : null;
                    return (
                      <li key={item.id} className="rounded-control px-3 py-2.5 transition-colors duration-[var(--motion-fast)] hover:bg-paper-sunken">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="font-serif text-sm text-ink">{item.title_zh}</h3>
                              <Badge tone="accent" variant="outline">
                                {item.task === 'task2' ? 'Task 2' : 'Task 1'}
                              </Badge>
                              {chartType ? (
                                <Badge variant="outline">
                                  {CHART_TYPE_LABEL_ZH[chartType] ?? `未知图表 ${String(chartType)}`}
                                </Badge>
                              ) : null}
                              {questionType ? <Badge variant="outline">{questionType}</Badge> : null}
                              <Badge tone={bandTone(item.target_band) ?? 'neutral'} dot>
                                目标 {formatBand(item.target_band)}
                              </Badge>
                            </div>
                            <p className="mt-1 line-clamp-2 text-xs text-ink-secondary">{item.prompt}</p>
                            <p className="mt-1 font-code text-xs text-ink-muted">
                              {item.id} · ≥{item.min_words} 词 · 建议 {Math.round(item.time_recommend_sec / 60)} 分钟
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!isReady}
                            aria-label={`开始 ${item.title_zh}`}
                            onClick={() => startTask(item.id)}
                          >
                            开始练习
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </TabPanel>
          </div>
        </Card>
      </div>
    );
  }

  // ---------- 批改中（FR-W3：提交后可以离开，不必盯着转圈） ----------
  if (stage === 'grading' && activeJob) {
    return (
      <div className="view-enter flex flex-col gap-3">
        <Card
          title="已提交批改"
          subtitle={task ? `${task.title_zh} · ${wordCount} 词` : '写作批改任务'}
          actions={
            <Badge tone="accent" dot>
              {activeJob.status === 'queued' ? '排队中' : '批改中'}
            </Badge>
          }
        >
          <div className="flex flex-col gap-2">
            <p className="text-sm text-ink-secondary">
              推理模型批改通常要 1–2 分钟。现在可以去练听力、阅读或口语，完成后左轨和选题页都会给出报告入口。
            </p>
            <p className="text-xs text-ink-muted">批改成功前草稿仍留在本机（AC-W2）；失败可原样重交。</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={backToPicker}>
                离开等待，去选题
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setActiveJobId(null);
                  setStage('practice');
                  timer.resume();
                }}
              >
                回正文继续修改
              </Button>
            </div>
          </div>
        </Card>

        <GradingJobsCard jobs={myJobs} onView={openJobReport} onDismiss={dismissJob} onRefresh={grading.refresh} />
      </div>
    );
  }

  // ---------- 批改结果 ----------
  if (stage === 'review' && report) {
    return (
      <WritingResult
        report={report}
        task={task}
        onChangeTask={backToPicker}
        onPracticeAgain={() => (taskId ? startTask(taskId) : backToPicker())}
      />
    );
  }

  if (!task) return null;

  return (
    <div className="flex flex-col gap-3">
      <Card
        title={task.title_zh}
        subtitle={`${task.id} · ${task.task === 'task2' ? 'Task 2' : 'Task 1'} · 目标 ${formatBand(task.target_band)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Countdown
              seconds={task.time_recommend_sec}
              running={timer.running}
              warnAt={180}
              label="剩余建议用时"
              expireText="建议用时已到"
              size="sm"
            />
            <Button size="sm" variant="ghost" onClick={timer.running ? timer.pause : timer.resume}>
              {timer.running ? '暂停计时' : '继续计时'}
            </Button>
            <Button size="sm" variant="ghost" onClick={backToPicker}>
              退出
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {overSuggested ? <Badge tone="mid" dot>已超过建议用时，仍可继续写并提交</Badge> : null}
            {draft.restored ? <Badge tone="accent">已恢复上次草稿</Badge> : null}
            {!draft.available ? <Badge tone="mid">本机草稿不可用（隐私模式）</Badge> : null}
            <Badge tone={minWords && !reached ? 'mid' : 'good'} dot>
              {reached ? `已达 ${minWords} 词` : `还差 ${shortBy} 词达 ${minWords} 词`}
            </Badge>
          </div>
          <p className="font-serif text-sm leading-relaxed text-ink whitespace-pre-line">{task.prompt}</p>
          {isTask2(task) && task.outline_hint?.length ? (
            <div className="rounded-card border border-rule bg-paper-sunken px-3 py-2">
              <span className="text-xs text-ink-muted">写作提纲提示</span>
              <ol className="mt-1 list-decimal pl-5 text-sm text-ink-secondary">
                {task.outline_hint.map((hint, index) => (
                  <li key={`${hint}-${index}`}>{hint}</li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      </Card>

      {/* 磁贴条（契约 §8.3）：正文作答阶段的读数，全部来自本地草稿状态与计时器，不新增请求。
          原「你的作文」卡头的 词数/已用时 span 与卡内两个 Stat 已搬到这里并删除（规则 4 去重）。 */}
      <dl aria-label="写作关键指标" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile metric="writing.words" label="词数" value={wordCount} unit={minWords ? `/ ${minWords}` : undefined} />
        <Tile metric="writing.elapsed" label="已用时" value={formatClock(timer.elapsedSec)} />
        <Tile
          metric="writing.draft"
          label="草稿"
          value={draft.dirty ? '待保存' : draft.savedAt ? '已保存' : '未保存'}
          hint={draft.savedAt ? new Date(draft.savedAt).toLocaleTimeString() : '尚未保存过'}
        />
        {/* 未达最低词数才出现，且是本屏唯一暖块；已达线整块不渲染（不显示 0）。 */}
        {minWords && !reached ? (
          <Tile metric="writing.short" surface="warm" label="还差词数" value={shortBy} unit="词" />
        ) : null}
      </dl>

      {isTask1(task) ? <Task1ChartCard chart={task.chart} /> : null}

      {draft.error ? <Toast tone="warn">{draft.error}</Toast> : null}

      <Card title="你的作文" subtitle="本地草稿自动保存，刷新后可恢复（AC-W2）">
        <div className="flex flex-col gap-3">
          <Field
            label="正文（英文）"
            htmlFor="writing-response"
            hint={`最低 ${minWords} 词；Task ${task.task === 'task2' ? '2' : '1'} 建议 ${Math.round(task.time_recommend_sec / 60)} 分钟内完成`}
          >
            <textarea
              id="writing-response"
              className="min-h-64 w-full rounded-card border border-rule bg-paper px-3 py-2 font-serif text-sm leading-relaxed text-ink outline-none focus:border-accent"
              placeholder={
                task.task === 'task2'
                  ? 'Write your essay. State your position, develop two or three body paragraphs, then conclude.'
                  : 'Write your summary: overview sentence first, then the key trends with figures.'
              }
              value={draft.value}
              onChange={(event) => draft.setValue(event.target.value)}
              disabled={submitting}
            />
          </Field>

          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" disabled={submitting || !draft.value} onClick={() => draft.setValue('')}>
                清空重写
              </Button>
              <Button variant="primary" loading={submitting} disabled={!draft.value.trim()} onClick={() => void submit()}>
                {submitting ? '提交中…' : '提交批改'}
              </Button>
            </div>
          </div>

          {error ? (
            <Toast tone="danger" onDismiss={() => setError(null)}>
              <span className="font-medium">批改失败：</span>
              {error}
              <Button size="sm" variant="outline" className="ml-2" onClick={() => void submit()}>
                重试
              </Button>
            </Toast>
          ) : null}
        </div>
      </Card>

      <p className="text-xs text-ink-muted">
        提交后进后端批改队列（契约 §10.6），按 §3-W 出四维报告；期间可以继续练别的，离线时结果为近似分并带「降级」标记（CONSTITUTION §3）。
      </p>
    </div>
  );
}

export default WritingPanel;
