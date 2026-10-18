import { useState } from 'react';
import { Badge, Button, Card, Field, Modal, Stat, Toast, cx } from '../../components/ui';
import { useApi } from '../../hooks/useApi';
import { deleteReview, resolveReview, reviewErrors } from '../../services/api';
import {
  MODULES,
  MODULE_LABEL_ZH,
  QUESTION_TYPE_LABEL_ZH,
  WRITING_ERROR_TYPES,
  type Module,
  type QuestionType,
  type ReviewItem,
  type ReviewStatus,
} from '../../types/ielts';
import { errorTypeLabel } from './errorTypes';
import { formatDateTime } from '../report/format';

/**
 * 后端 `GET /review/errors` 的 `status` 允许 `open|resolved|all`
 * （`backend/app/api/review.py` 的 `_STATUSES`），但 `ReviewQuery.status` 的类型镜像只写了
 * 前两个值。这里保留本地三档，提交时用 `toStatusParam` 显式转换并在报告里登记待办：
 * Wave 3 应把 `'all'` 补进 `types/ielts.ts`（契约 §10.2 的镜像修正）。
 */
type StatusFilter = ReviewStatus | 'all';

/** 提交给后端的 status（`'all'` 只在运行时存在，类型镜像暂未收录）。 */
function toStatusParam(status: StatusFilter): ReviewStatus {
  return status as ReviewStatus;
}

const STATUS_LABEL_ZH: Record<StatusFilter, string> = {
  open: '未掌握',
  resolved: '已掌握',
  all: '全部',
};

type ModuleFilter = Module | 'all';

export interface ReviewBookProps {
  className?: string;
}

/**
 * 错题本（FR-V2 / AC-V2）：听力阅读错题、写作错误句、口语低分句统一在 `review_items`。
 *
 * - 默认只看未掌握（`status=open`），与后端默认一致（AC-V2）。
 * - 「已掌握」是**手动**动作（`POST /review/{id}/resolve`），不做旧版「连续 3 次 80 分自动掌握」的推断。
 * - 按科目分组，每条给出原句 + 中文解析 + 出现次数与最近出现时间（跨 attempt 累加由后端做）。
 */
export function ReviewBook({ className }: ReviewBookProps) {
  const [moduleFilter, setModuleFilter] = useState<ModuleFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('open');
  const [errorType, setErrorType] = useState<string>('');
  const [pending, setPending] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ReviewItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  const list = useApi(
    (options) =>
      reviewErrors(
        {
          module: moduleFilter === 'all' ? undefined : moduleFilter,
          status: toStatusParam(status),
          error_type: errorType || undefined,
        },
        options,
      ),
    [moduleFilter, status, errorType],
  );

  const items = list.data ?? [];
  const errorTypes = [...new Set([...WRITING_ERROR_TYPES, ...items.map((item) => item.error_type)])];

  const grouped = MODULES.map((module) => ({
    module,
    rows: items.filter((item) => item.module === module),
  })).filter((group) => group.rows.length > 0);
  const unclassified = items.filter((item) => !(MODULES as readonly string[]).includes(String(item.module)));

  const runAction = async (action: () => Promise<unknown>): Promise<void> => {
    setError(null);
    try {
      await action();
      await list.refetch();
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : '操作失败，请重试');
    } finally {
      setPending(null);
      setPendingDelete(null);
    }
  };

  return (
    <div className={cx('flex flex-col gap-3', className)}>
      <Card
        title="错题本"
        subtitle={`${items.length} 条记录 · 默认只显示未掌握`}
        actions={
          <Button variant="ghost" size="sm" onClick={() => void list.refetch()} loading={list.loading}>
            刷新
          </Button>
        }
      >
        {list.error ? <Toast tone="danger">{list.error}</Toast> : null}
        {error ? <Toast tone="danger">{error}</Toast> : null}

        <div className="flex flex-wrap items-end gap-3">
          <Field label="科目" htmlFor="review-module">
            <select
              id="review-module"
              value={moduleFilter}
              onChange={(event) => setModuleFilter(event.target.value as ModuleFilter)}
              className="h-9 rounded-card border border-rule bg-paper px-2 text-sm"
            >
              <option value="all">全部</option>
              {MODULES.map((module) => (
                <option key={module} value={module}>
                  {MODULE_LABEL_ZH[module]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="状态" htmlFor="review-status" hint="「已掌握」只由你手动标记">
            <select
              id="review-status"
              value={status}
              onChange={(event) => setStatus(event.target.value as StatusFilter)}
              className="h-9 rounded-card border border-rule bg-paper px-2 text-sm"
            >
              {(Object.keys(STATUS_LABEL_ZH) as StatusFilter[]).map((key) => (
                <option key={key} value={key}>
                  {STATUS_LABEL_ZH[key]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="错误类型" htmlFor="review-error-type">
            <select
              id="review-error-type"
              value={errorType}
              onChange={(event) => setErrorType(event.target.value)}
              className="h-9 rounded-card border border-rule bg-paper px-2 text-sm"
            >
              <option value="">全部类型</option>
              {errorTypes.map((type) => (
                <option key={type} value={type}>
                  {errorTypeLabel(type)}（{type}）
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="mt-3 flex items-center gap-6">
          <Stat label="未掌握" size="sm" value={String(items.filter((item) => item.status === 'open').length)} />
          <Stat label="已掌握" size="sm" value={String(items.filter((item) => item.status === 'resolved').length)} />
        </div>
      </Card>

      {items.length === 0 && !list.loading ? (
        <Card>
          <p role="status" className="text-sm text-ink-secondary">
            {status === 'open'
              ? '没有未掌握的错题：做错的题会自动进入这里，标为已掌握后从默认视图移出。'
              : '当前筛选条件下没有记录。'}
          </p>
        </Card>
      ) : null}

      {grouped.map((group) => (
        <section key={group.module} className="flex flex-col gap-2" aria-label={`${MODULE_LABEL_ZH[group.module]}错题`}>
          <h3 className="font-serif text-sm text-ink">
            {MODULE_LABEL_ZH[group.module]}
            <span className="ml-1.5 font-code text-xs text-ink-muted">{group.rows.length}</span>
          </h3>
          <ul className="flex flex-col gap-2">
            {group.rows.map((item) => (
              <ReviewRow
                key={item.id}
                item={item}
                busy={pending === item.id}
                onResolve={() => {
                  setPending(item.id);
                  void runAction(() => resolveReview(item.id));
                }}
                onAskDelete={() => {
                  setError(null);
                  setPendingDelete(item);
                }}
              />
            ))}
          </ul>
        </section>
      ))}

      {unclassified.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h3 className="font-serif text-sm text-ink">未分类</h3>
          <ul className="flex flex-col gap-2">
            {unclassified.map((item) => (
              <ReviewRow
                key={item.id}
                item={item}
                busy={pending === item.id}
                onResolve={() => {
                  setPending(item.id);
                  void runAction(() => resolveReview(item.id));
                }}
                onAskDelete={() => setPendingDelete(item)}
              />
            ))}
          </ul>
        </section>
      ) : null}

      <Modal
        open={pendingDelete != null}
        onClose={() => setPendingDelete(null)}
        size="sm"
        title="删除这条错题？"
        description="只从错题本移除该条记录，不影响对应的练习存档。"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              取消
            </Button>
            <Button variant="danger" onClick={() => void runAction(() => deleteReview(pendingDelete?.id ?? ''))}>
              确认删除
            </Button>
          </>
        }
      >
        {pendingDelete ? (
          <p className="text-sm text-ink">
            {MODULE_LABEL_ZH[pendingDelete.module]} · {errorTypeLabel(pendingDelete.error_type)}：{pendingDelete.quote}
          </p>
        ) : null}
      </Modal>
    </div>
  );
}

function ReviewRow({
  item,
  busy,
  onResolve,
  onAskDelete,
}: {
  item: ReviewItem;
  busy: boolean;
  onResolve: () => void;
  onAskDelete: () => void;
}) {
  return (
    <li>
      <Card className={item.status === 'resolved' ? 'opacity-80' : undefined}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone={item.status === 'resolved' ? 'good' : 'mid'}>
                {item.status === 'resolved' ? '已掌握' : '未掌握'}
              </Badge>
              <Badge tone="poor" variant="outline">
                {errorTypeLabel(item.error_type)}
              </Badge>
              {item.question_type ? (
                <span className="text-xs text-ink-secondary">
                  {QUESTION_TYPE_LABEL_ZH[item.question_type as QuestionType] ?? item.question_type}
                </span>
              ) : null}
              {item.seen_count > 1 ? (
                <span className="font-code text-xs text-ink-muted">出现 {item.seen_count} 次</span>
              ) : null}
            </div>
            <blockquote className="mt-1.5 border-l-2 border-rule pl-2 text-sm text-ink">{item.quote}</blockquote>
            {item.detail_zh ? <p className="mt-1 text-sm text-ink-secondary">{item.detail_zh}</p> : null}
            <p className="mt-1 font-code text-xs text-ink-muted">
              最近出现 {formatDateTime(item.last_seen_at)}
              {item.item_ref ? ` · ${item.item_ref}` : ''}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {item.status === 'open' ? (
              <Button variant="outline" size="sm" onClick={onResolve} loading={busy}>
                已掌握
              </Button>
            ) : null}
            <Button variant="danger" size="sm" onClick={onAskDelete} aria-label="删除该错题">
              删除
            </Button>
          </div>
        </div>
      </Card>
    </li>
  );
}

export default ReviewBook;
