/**
 * 异步批改的等待/完成界面（契约 §10.6；FR-W3「提交后先做别的」的用户侧兑现）。
 *
 * 三件事必须同时成立，用户才会相信「提交之后程序没死」：
 * 1. 等待期间有明确的时长与预期（推理模型实测 1–2 分钟，不写「马上就好」这种假话）；
 * 2. 可以离开：横幅挂在选题页与左轨，回来还能接上同一个任务；
 * 3. 失败要看得见：`error` 直接进正文，而不是只有一行日志。
 */
import { useEffect, useState } from 'react';
import { Badge, Button, Card, cx } from '../../components/ui';
import type { TrackedJob } from '../../hooks/useGradingJobs';
import { MODULE_LABEL_ZH } from '../../types/ielts';

const RUNNING_HINT = '推理模型批改通常要 1–2 分钟，期间可以继续练别的。';

function statusLabel(job: TrackedJob): string {
  if (job.status === 'queued') return '排队中';
  if (job.status === 'running') return '批改中';
  if (job.status === 'succeeded') return '批改完成';
  return '批改失败';
}

function statusTone(job: TrackedJob): 'good' | 'mid' | 'poor' | 'neutral' {
  if (job.status === 'succeeded') return 'good';
  if (job.status === 'failed') return 'poor';
  return 'mid';
}

/** 已等秒数（1s 一跳，让等待有反馈）。 */
function useElapsedSince(sinceMs: number, active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return Math.max(0, Math.round((now - sinceMs) / 1000));
}

function JobRow({
  job,
  onView,
  onDismiss,
}: {
  job: TrackedJob;
  onView?: (job: TrackedJob) => void;
  onDismiss: (job: TrackedJob) => void;
}) {
  const running = job.status === 'queued' || job.status === 'running';
  const elapsed = useElapsedSince(job.submitted_at, running);
  const succeeded = job.status === 'succeeded' && job.report != null;

  return (
    <li className="flex flex-col gap-2 rounded-control border border-rule bg-paper-sunken px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={statusTone(job)} dot={running}>
          {statusLabel(job)}
        </Badge>
        <span className="min-w-0 flex-1 truncate text-sm text-ink">{job.label}</span>
        <span className="font-code text-xs text-ink-muted">
          {running ? `已等 ${elapsed}s` : MODULE_LABEL_ZH[job.module]}
        </span>
      </div>

      {running ? (
        <div className="flex flex-col gap-1.5" aria-hidden="true">
          <div className="skeleton h-3 w-3/4 rounded-full" />
          <div className="skeleton h-3 w-1/2 rounded-full" />
          <p className="text-xs text-ink-muted">{RUNNING_HINT}</p>
        </div>
      ) : null}

      {job.status === 'failed' ? (
        <p role="alert" className="text-xs text-ink-secondary">
          {job.error || '批改失败，原因未回传，请重新提交或查看后端日志。'}
        </p>
      ) : null}

      {succeeded && job.degraded_reason ? (
        <p className="text-xs text-ink-muted">本次为近似评分（{job.degraded_reason}），报告已如实标注。</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {succeeded && onView ? (
          <Button size="sm" variant={job.viewed ? 'ghost' : 'primary'} onClick={() => onView(job)}>
            {job.viewed ? '再看一次报告' : '查看报告'}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={() => onDismiss(job)}>
          {job.status === 'failed' ? '知道了' : '从列表移除'}
        </Button>
      </div>
    </li>
  );
}

export interface GradingJobsCardProps {
  jobs: ReadonlyArray<TrackedJob>;
  onView?: (job: TrackedJob) => void;
  onDismiss: (job: TrackedJob) => void;
  /** 手动拉一次后端状态：轮询是 2.5s 一跳，用户想立刻知道结果时有地方可点。 */
  onRefresh?: () => void;
  className?: string;
}

/** 面板顶部的批改任务横幅：只有存在任务时才占位。 */
export function GradingJobsCard({ jobs, onView, onDismiss, onRefresh, className }: GradingJobsCardProps) {
  if (jobs.length === 0) return null;
  const runningCount = jobs.filter((job) => job.status === 'queued' || job.status === 'running').length;
  return (
    <Card
      title="批改任务"
      subtitle={
        runningCount > 0
          ? `${runningCount} 篇正在批改，完成后这里会变成报告入口。`
          : '批改已结束，可查看或移除。'
      }
      actions={
        onRefresh && runningCount > 0 ? (
          <Button size="sm" variant="ghost" onClick={onRefresh}>
            刷新进度
          </Button>
        ) : null
      }
      className={className}
    >
      <ul className="flex flex-col gap-2" aria-label="批改任务列表">
        {jobs.map((job) => (
          <JobRow key={job.job_id} job={job} onView={onView} onDismiss={onDismiss} />
        ))}
      </ul>
    </Card>
  );
}

export interface GradingRailBadgeProps {
  jobs: ReadonlyArray<TrackedJob>;
  onOpen: (job: TrackedJob) => void;
}

/** 左轨的迷你状态：离开练习页时也看得见「还在批改 / 有报告待看」。 */
export function GradingRailBadge({ jobs, onOpen }: GradingRailBadgeProps) {
  if (jobs.length === 0) return null;
  const running = jobs.filter((job) => job.status === 'queued' || job.status === 'running').length;
  const waiting = jobs.filter((job) => job.status === 'succeeded' && !job.viewed).length;
  const failed = jobs.filter((job) => job.status === 'failed' && !job.viewed).length;
  if (running === 0 && waiting === 0 && failed === 0) return null;

  return (
    <div className="flex flex-col gap-1.5 rounded-control border border-rule bg-paper-sunken px-2 py-2">
      <p className="font-code text-[11px] text-ink-muted" role="status" aria-live="polite">
        {running > 0 ? `批改中 ${running}` : failed > 0 && waiting === 0 ? '批改失败' : '待查看'}
      </p>
      {jobs
        .filter((job) => job.status !== 'succeeded' || !job.viewed)
        .slice(0, 3)
        .map((job) => (
          <button
            key={job.job_id}
            type="button"
            onClick={() => onOpen(job)}
            title={job.label}
            className={cx(
              'press flex items-center gap-1.5 rounded-control px-1.5 py-1 text-left text-xs',
              'hover:bg-paper-raised',
              job.status === 'failed' ? 'text-band-poor' : 'text-ink-secondary',
            )}
          >
            <span
              aria-hidden="true"
              className={cx(
                'h-1.5 w-1.5 shrink-0 rounded-full',
                job.status === 'succeeded'
                  ? 'bg-band-good'
                  : job.status === 'failed'
                    ? 'bg-band-poor'
                    : 'bg-accent animate-pulse',
              )}
            />
            <span className="min-w-0 truncate">{job.label}</span>
          </button>
        ))}
    </div>
  );
}
