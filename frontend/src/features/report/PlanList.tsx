import { useState } from 'react';
import { Badge, Toast, cx } from '../../components/ui';
import { MODULE_LABEL_ZH, type PlanTask } from '../../types/ielts';
import { markPlanDone } from '../../services/api';
import { formatDateTime } from './format';

export interface PlanListProps {
  /** `planToday()` 的 `items`（FR-P2：差距大的科权重高）。 */
  tasks: ReadonlyArray<PlanTask>;
  /**
   * 勾选变更成功后回调 —— Dashboard 用它重新拉今日计划。
   * 组件自身只保留乐观态，不假装持久化。
   */
  onChanged?: (task: PlanTask, done: boolean) => void;
  /** 生成时间（`planToday()` 的 `generated_at`），仅作辅助小字。 */
  generatedAt?: string | null;
}

/**
 * 今日任务清单（FR-P1 / FR-P2）。
 *
 * 勾选框直接打 `POST /plan/{task_id}/done`（契约 §1 行 30，body `{done}`），
 * 失败必须可见（CONSTITUTION §3）：显示中文 Toast 并回滚乐观态。
 * 「已掌握」类的自动判定一律不做，这里只有手动勾选（FR-V2 同理）。
 */
export function PlanList({ tasks, onChanged, generatedAt }: PlanListProps) {
  /** 在途请求的 task id → 期望值，用于乐观显示与禁用重复点击。 */
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const toggle = async (task: PlanTask, nextDone: boolean): Promise<void> => {
    setPending((prev) => ({ ...prev, [task.id]: nextDone }));
    setError(null);
    try {
      await markPlanDone(task.id, nextDone);
      onChanged?.(task, nextDone);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : '任务状态保存失败，请重试');
    } finally {
      setPending((prev) => {
        const next = { ...prev };
        delete next[task.id];
        return next;
      });
    }
  };

  if (tasks.length === 0) {
    return (
      <p role="status" className="text-sm text-ink-muted">
        今日暂无任务：完成一次练习后计划引擎会自动补齐。
      </p>
    );
  }

  const doneCount = tasks.filter((task) => pending[task.id] ?? task.done).length;

  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <Toast tone="danger" onDismiss={() => setError(null)}>
          {error}
        </Toast>
      ) : null}

      <p className="text-xs text-ink-muted">
        已完成 {doneCount}/{tasks.length}
        {generatedAt ? ` · 生成于 ${formatDateTime(generatedAt)}` : ''}
      </p>

      <ul className="flex flex-col gap-1.5">
        {tasks.map((task) => {
          const optimistic = pending[task.id];
          const checked = optimistic ?? task.done;
          const inFlight = optimistic !== undefined;
          const inputId = `plan-task-${task.id}`;
          return (
            <li
              key={task.id}
              className={cx(
                'flex items-start gap-2.5 rounded-control px-2.5 py-2 transition-colors',
                'duration-[var(--motion-fast)] hover:bg-paper-sunken',
                checked && 'bg-paper-sunken',
              )}
            >
              <input
                id={inputId}
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
                checked={checked}
                disabled={inFlight}
                onChange={(event) => void toggle(task, event.target.checked)}
              />
              <label htmlFor={inputId} className="min-w-0 flex-1 cursor-pointer text-sm">
                <span className="flex flex-wrap items-center gap-1.5">
                  <Badge tone="accent">{MODULE_LABEL_ZH[task.module]}</Badge>
                  {checked ? <span className="text-xs text-ink-muted">已完成</span> : null}
                  {inFlight ? <span className="font-code text-xs text-ink-muted">保存中…</span> : null}
                </span>
                <span className={checked ? 'mt-0.5 block text-ink-muted' : 'mt-0.5 block text-ink'}>
                  {task.reason_zh}
                </span>
                <span className="mt-0.5 block font-code text-xs text-ink-muted">{task.set_ref}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default PlanList;
