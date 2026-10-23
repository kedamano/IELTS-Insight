/**
 * 阅读屏（FR-R1…R5 / AC-R2、AC-R3、AC-R4）。
 *
 * 三个状态：选题 → 做题（限时 20 分钟，左右双栏）→ 讲评（§3-OR）。
 *
 * 契约要点：
 * - 计时只用 `hooks/useTimer`（`durationSec = set.time_limit_sec`），剩 180s 转 `--band-poor`（AC-R3），
 *   到点**自动提交**且 `timed_out: true`，未答题按原样发送（空串）由后端记 `unanswered`（§1 #19、§3-OR）。
 * - 草稿 `useDraftAutosave('reading_<set_id>')`，提交成功后 `clear()`（FR-W2 同规则）。
 * - 题面无答案（§2-R），「定位」只用 `paragraph_label` 或题干关键词，绝不猜答案位置。
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { Badge, Button, Card, Tile, Toast } from '../../components/ui';
import { getSettings, postReadingAttempt, readingSet, readingSets } from '../../services/api';
import { useApi } from '../../hooks/useApi';
import { useDraftAutosave } from '../../hooks/useDraftAutosave';
import { formatClock, useTimer } from '../../hooks/useTimer';
import type {
  AnswerMap,
  ObjectiveAttemptBody,
  ReadingObjectiveReport,
  ReadingQuestionPublic,
  ReadingSetMeta,
} from '../../types/ielts';
import { PassageView } from './PassageView';
import { QuestionNav } from './QuestionNav';
import { ReadingReview } from './ReadingReview';
import { useParagraphHighlight } from './Highlight';
import { Timer } from './Timer';
import {
  answeredCount,
  parseAnswers,
  readingDraftKey,
  serializeAnswers,
  type ReadingSetView,
} from './readingDraft';

/** 按题序构造 `answers`：未答的题按空串原样发送（AC-R3「unanswered items sent as-is」）。 */
export function buildAnswerBody(
  questions: readonly ReadingQuestionPublic[],
  answers: AnswerMap,
): AnswerMap {
  const out: AnswerMap = {};
  for (const question of questions) {
    out[question.id] = (answers[question.id] ?? '').trim();
  }
  return out;
}

export default function ReadingPanel() {
  const [setId, setSetId] = useState<string | null>(null);
  const [report, setReport] = useState<ReadingObjectiveReport | null>(null);
  const highlight = useParagraphHighlight();

  const setsQuery = useApi((options) => readingSets({}, options), []);
  const setQuery = useApi((options) => readingSet(setId ?? '', options), [setId], { enabled: !!setId });
  const settingsQuery = useApi((options) => getSettings(options), [], { enabled: report !== null });

  const set = setQuery.data as ReadingSetView | null;
  const showChineseHints = settingsQuery.data?.show_chinese_hints ?? true;

  const openSet = (id: string) => {
    setSetId(id);
    setReport(null);
    highlight.clear();
  };

  const backToPicker = () => {
    setSetId(null);
    setReport(null);
    highlight.clear();
  };

  if (setsQuery.loading && !setsQuery.data) {
    return <LoadingCard text="正在载入阅读套题…" />;
  }

  if (setsQuery.error) {
    return (
      <Toast
        tone="danger"
        action={
          <Button size="sm" variant="outline" onClick={() => void setsQuery.refetch()}>
            重试
          </Button>
        }
      >
        {setsQuery.error}
      </Toast>
    );
  }

  if (!setId) {
    return <SetPicker items={setsQuery.data ?? []} onPick={openSet} onReload={() => void setsQuery.refetch()} />;
  }

  if (setQuery.loading && !set) {
    return <LoadingCard text="正在载入篇章与题目…" />;
  }

  if (setQuery.error || !set) {
    return (
      <Toast
        tone="danger"
        action={
          <Button size="sm" variant="outline" onClick={() => void setQuery.refetch()}>
            重试
          </Button>
        }
      >
        {setQuery.error ?? '篇章载入失败'}
      </Toast>
    );
  }

  if (report) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" size="sm" onClick={backToPicker}>
            ← 返回选题
          </Button>
          {highlight.activeLabel ? (
            <Badge tone="accent">已定位到段落 {highlight.activeLabel}</Badge>
          ) : (
            <Badge>点「定位到原文」可高亮段落 2 秒</Badge>
          )}
        </div>
        <div className="grid min-h-0 grid-cols-1 gap-3 xl:grid-cols-2">
          <PassageView set={set} activeLabel={highlight.activeLabel} reviewMode className="max-h-[72vh]" />
          <ReadingReview
            set={set}
            report={report}
            showChineseHints={showChineseHints}
            onLocate={(label) => highlight.locate(label)}
            onExit={backToPicker}
            className="max-h-[72vh] overflow-y-auto"
          />
        </div>
      </div>
    );
  }

  return (
    <ReadingExam
      key={set.id}
      set={set}
      highlight={highlight}
      onSubmitted={(next) => setReport(next)}
      onExit={backToPicker}
    />
  );
}

export type ReadingExamProps = {
  set: ReadingSetView;
  highlight: ReturnType<typeof useParagraphHighlight>;
  onSubmitted: (report: ReadingObjectiveReport) => void;
  onExit: () => void;
};

/** 做题区：计时 + 草稿 + 双栏 + 提交。`key={set.id}` 保证切集时整段重置。 */
export function ReadingExam({ set, highlight, onSubmitted, onExit }: ReadingExamProps) {
  const draft = useDraftAutosave(readingDraftKey(set.id), '{}', { delayMs: 300 });
  const answers = useMemo(() => parseAnswers(draft.value), [draft.value]);
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const submittedRef = useRef(false);

  const total = set.questions.length;
  const answered = answeredCount(answers);
  // 磁贴条读数（契约 §8.3 规则 2）：全取本屏已有的草稿 / 计时 / 篇章状态，不另发请求。
  const blank = total - answered;
  const paragraphs = set.passage?.paragraphs?.length ?? 0;

  // onExpire 与 submit 互相引用：submit 走 ref，timer 只调用最新那一份。
  const submitRef = useRef<((timedOut: boolean) => Promise<void>) | null>(null);
  const timer = useTimer({
    durationSec: set.time_limit_sec,
    autoStart: true,
    onExpire: () => {
      void submitRef.current?.(true);
    },
  });
  const elapsedRef = useRef(timer.elapsedSec);
  elapsedRef.current = timer.elapsedSec;
  const expiredRef = useRef(timer.expired);
  expiredRef.current = timer.expired;

  const submit = useCallback(
    async (timedOut: boolean) => {
      if (submittedRef.current) return;
      submittedRef.current = true;
      setConfirming(false);
      setSubmitError(null);
      setPending(true);
      const body: ObjectiveAttemptBody = {
        answers: buildAnswerBody(set.questions, answers),
        // 到点自动提交时 `elapsedRef` 还没被这次过期的 render 刷新，直接用题限时限（§1 #19）
        duration_sec: timedOut ? set.time_limit_sec : elapsedRef.current,
        timed_out: timedOut,
      };
      try {
        draft.flush();
        const result = await postReadingAttempt(set.id, body);
        draft.clear();
        onSubmitted(result);
      } catch (caught: unknown) {
        // 失败必须可见且可重试（CONSTITUTION §3）
        submittedRef.current = false;
        setPending(false);
        const message = caught instanceof Error ? caught.message : '提交失败';
        setSubmitError(timedOut ? `自动提交失败：${message}` : message);
      }
    },
    [answers, draft, onSubmitted, set.id, set.questions],
  );
  submitRef.current = submit;

  const onAnswer = useCallback(
    (questionId: string, value: string) => {
      setSubmitError(null);
      const next: AnswerMap = { ...parseAnswers(draft.value), [questionId]: value };
      draft.setValue(serializeAnswers(next));
    },
    [draft],
  );

  const onLocate = useCallback(
    (label: string | null) => {
      if (!label) {
        setNotice('本题无法唯一定位，请通读全文');
        return;
      }
      const ok = highlight.locate(label);
      setNotice(ok ? `已定位到段落 ${label}` : `篇章里找不到段落 ${label}`);
    },
    [highlight],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-rule bg-paper-raised px-3 py-2 shadow-elevated">
        <div className="flex flex-wrap items-center gap-4">
          <Timer remainingSec={timer.remainingSec} expired={timer.expired} running={timer.running} />
          {draft.restored ? <Badge tone="mid">已恢复上次草稿</Badge> : null}
          {draft.available ? null : <Badge tone="poor">本地草稿不可用</Badge>}
          {draft.error ? <Badge tone="poor">{draft.error}</Badge> : null}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onExit}>
            退出练习
          </Button>
          {answered < total && !confirming ? (
            <Button variant="primary" onClick={() => setConfirming(true)} loading={pending}>
              提交作答
            </Button>
          ) : (
            <Button variant="primary" onClick={() => void submit(false)} loading={pending}>
              提交作答
            </Button>
          )}
        </div>
      </div>

      {/* 磁贴条（契约 §8.3）：紧跟工具条、只在作答阶段出现，双栏答题区一行不动。
          面只有 plain，唯一暖面给「未作答」这个待处理信号；
          「篇章词数」没进条是因为篇章卡头已有该读数（规则 4 不许同屏两份同源数字）。 */}
      <dl aria-label="阅读关键指标" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile metric="reading.answered" label="已作答" value={`${answered}/${total}`} />
        <Tile metric="reading.elapsed" label="用时" value={formatClock(timer.elapsedSec)} />
        {blank > 0 ? (
          <Tile
            metric="reading.blank"
            surface="warm"
            label="未作答"
            value={blank}
            unit="题"
            hint="未答题按 0 分计入总分"
          />
        ) : null}
        {paragraphs > 0 ? (
          <Tile metric="reading.paragraphs" label="段落" value={paragraphs} unit="段" />
        ) : null}
      </dl>

      {confirming ? (
        <Toast tone="warn">
          <div className="flex flex-col gap-2">
            <span>还有 {total - answered} 题未作答，未答题会按 0 分计入总分。</span>
            <div className="flex gap-2">
              <Button size="sm" variant="primary" onClick={() => void submit(false)}>
                仍然提交
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                返回继续作答
              </Button>
            </div>
          </div>
        </Toast>
      ) : null}

      {submitError ? (
        <Toast
          tone="danger"
          onDismiss={() => setSubmitError(null)}
          action={
            <Button size="sm" variant="outline" onClick={() => void submit(expiredRef.current)}>
              重试提交
            </Button>
          }
        >
          {submitError}
        </Toast>
      ) : null}

      {notice ? (
        <Toast tone="info" onDismiss={() => setNotice(null)}>
          {notice}
        </Toast>
      ) : null}

      <div className="grid min-h-0 grid-cols-1 gap-3 xl:grid-cols-2">
        <PassageView set={set} activeLabel={highlight.activeLabel} className="max-h-[72vh]" />
        <QuestionNav
          set={set}
          answers={answers}
          onAnswer={onAnswer}
          onLocate={onLocate}
          disabled={pending}
          className="max-h-[72vh]"
        />
      </div>
    </div>
  );
}

function LoadingCard({ text }: { text: string }) {
  return (
    <Card title="阅读">
      <p role="status" className="text-sm text-ink-secondary">
        {text}
      </p>
    </Card>
  );
}

export type SetPickerProps = {
  items: ReadingSetMeta[];
  onPick: (id: string) => void;
  onReload: () => void;
};

function SetPicker({ items, onPick, onReload }: SetPickerProps) {
  return (
    <Card
      title="选择阅读套题"
      subtitle="每集 1 篇 800–950 词原创篇章 + 13 题，限时 20 分钟（FR-R1）"
      actions={
        <Button size="sm" variant="ghost" onClick={onReload}>
          刷新
        </Button>
      }
    >
      {items.length === 0 ? (
        <p className="text-sm text-ink-muted">尚无可用的阅读套题（题库为空）。</p>
      ) : (
        <ul className="flex flex-col">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 border-b border-rule py-2.5 last:border-b-0">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-ink">{item.title_zh || item.id}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                  <span className="font-code">{item.id}</span>
                  {item.level ? <Badge>{item.level}</Badge> : null}
                  {typeof item.question_count === 'number' ? <span>{item.question_count} 题</span> : null}
                  {typeof item.word_count === 'number' ? <span>{item.word_count} 词</span> : null}
                  {typeof item.time_limit_sec === 'number' ? (
                    <span className="font-code">{formatClock(item.time_limit_sec)}</span>
                  ) : null}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => onPick(item.id)}>
                开始
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
