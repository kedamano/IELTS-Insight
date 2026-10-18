import { useState } from 'react';
import { Badge, Button, Card, Modal, Stat, Tabs, Toast, cx } from '../../components/ui';
import { useApi } from '../../hooks/useApi';
import { attempt, attempts, deleteAttempt } from '../../services/api';
import {
  MODULES,
  MODULE_LABEL_ZH,
  type AttemptSummary,
  type Module,
} from '../../types/ielts';
import { attemptBandLabel, AiMetaBadge, AttemptReport } from './AttemptReport';
import { formatDateTime, formatDurationSec, safeNumber } from './format';

/** 每页条数（契约 §1 行 23 的 `limit`，后端上限 200）。 */
const PAGE_SIZE = 10;

type ModuleFilter = Module | 'all';

const FILTERS: ReadonlyArray<{ id: ModuleFilter; label: string }> = [
  { id: 'all', label: '全部' },
  ...MODULES.map((module) => ({ id: module, label: MODULE_LABEL_ZH[module] })),
];

export interface AttemptsListProps {
  className?: string;
}

/**
 * 练习存档（FR-P4）：分页列表 → 详情（按类型守卫选报告变体）→ 删除（二次确认）。
 *
 * 列表用 `attempts({module,limit,offset})`，详情用 `attempt(id)`；删除后重新拉取，
 * 趋势由后端重算（契约 §1 行 25）。`ai_used` / `approximate` 一律如实标注（CONSTITUTION §3）。
 */
export function AttemptsList({ className }: AttemptsListProps) {
  const [filter, setFilter] = useState<ModuleFilter>('all');
  const [page, setPage] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AttemptSummary | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const list = useApi(
    (options) =>
      attempts(
        {
          module: filter === 'all' ? undefined : filter,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        },
        options,
      ),
    [filter, page, refreshKey],
  );

  const detail = useApi((options) => attempt(selectedId ?? '', options), [selectedId], {
    enabled: selectedId != null,
  });

  const items = list.data?.items ?? [];
  const total = safeNumber(list.data?.total, items.length);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const confirmDelete = async (): Promise<void> => {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAttempt(pendingDelete.id);
      if (selectedId === pendingDelete.id) setSelectedId(null);
      setPendingDelete(null);
      setRefreshKey((key) => key + 1);
    } catch (caught: unknown) {
      setDeleteError(caught instanceof Error ? caught.message : '删除失败，请重试');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className={cx('flex flex-col gap-3', className)}>
      <Card
        title="练习存档"
        subtitle={`共 ${total} 条记录 · 每页 ${PAGE_SIZE} 条`}
        actions={
          <Button variant="ghost" size="sm" onClick={() => setRefreshKey((key) => key + 1)} loading={list.loading}>
            刷新
          </Button>
        }
      >
        <Tabs
          ariaLabel="按模块筛选练习记录"
          items={FILTERS.map((item) => ({ id: item.id, label: item.label }))}
          value={filter}
          onChange={(next) => {
            setFilter(next as ModuleFilter);
            setPage(0);
          }}
          size="sm"
        />

        {list.error ? (
          <Toast className="mt-3" tone="danger">
            {list.error}
          </Toast>
        ) : null}

        {items.length === 0 && !list.loading ? (
          <p role="status" className="mt-3 text-sm text-ink-muted">
            {filter === 'all' ? '尚无练习记录：完成一次模块练习后这里会出现存档。' : `尚无${MODULE_LABEL_ZH[filter]}练习记录。`}
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">练习记录存档列表</caption>
              <thead>
                <tr className="border-b border-rule text-left text-xs text-ink-muted">
                  <th scope="col" className="py-1.5 pr-3 font-normal">
                    时间
                  </th>
                  <th scope="col" className="py-1.5 pr-3 font-normal">
                    模块
                  </th>
                  <th scope="col" className="py-1.5 pr-3 font-normal">
                    内容
                  </th>
                  <th scope="col" className="py-1.5 pr-3 font-normal">
                    Band
                  </th>
                  <th scope="col" className="py-1.5 pr-3 font-normal">
                    用时
                  </th>
                  <th scope="col" className="py-1.5 pr-3 font-normal">
                    评分方式
                  </th>
                  <th scope="col" className="py-1.5 font-normal">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id} className="border-b border-rule last:border-b-0">
                    <td className="py-2 pr-3 font-code text-xs text-ink-secondary">{formatDateTime(row.created_at)}</td>
                    <td className="py-2 pr-3">
                      <Badge tone="neutral">{MODULE_LABEL_ZH[row.module]}</Badge>
                    </td>
                    <td className="py-2 pr-3">
                      <span className="text-ink">{row.title_zh || row.task_ref}</span>
                      {row.raw_total ? (
                        <span className="ml-2 font-code text-xs text-ink-muted">
                          {safeNumber(row.raw_correct)}/{safeNumber(row.raw_total)}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 font-code text-ink">{attemptBandLabel(row.band_overall)}</td>
                    <td className="py-2 pr-3 font-code text-xs text-ink-secondary">{formatDurationSec(row.duration_sec)}</td>
                    <td className="py-2 pr-3">
                      <AiMetaBadge meta={row} />
                    </td>
                    <td className="py-2">
                      <div className="flex items-center gap-1.5">
                        <Button variant="outline" size="sm" onClick={() => setSelectedId(row.id)}>
                          详情
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => {
                            setDeleteError(null);
                            setPendingDelete(row);
                          }}
                        >
                          删除
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-3 flex items-center justify-between gap-3">
          <Button variant="ghost" size="sm" disabled={page <= 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>
            上一页
          </Button>
          <Stat label="页码" value={`${page + 1} / ${pageCount}`} size="sm" />
          <Button
            variant="ghost"
            size="sm"
            disabled={(page + 1) * PAGE_SIZE >= total}
            onClick={() => setPage((current) => current + 1)}
          >
            下一页
          </Button>
        </div>
      </Card>

      <Modal
        open={selectedId != null}
        onClose={() => setSelectedId(null)}
        size="lg"
        title={
          detail.data
            ? `${MODULE_LABEL_ZH[detail.data.attempt.module]}报告 · ${formatDateTime(detail.data.attempt.created_at)}`
            : '练习报告'
        }
        description={
          detail.data
            ? `内容 ${detail.data.attempt.title_zh || detail.data.attempt.task_ref} · 用时 ${formatDurationSec(
                detail.data.attempt.duration_sec,
              )}`
            : undefined
        }
      >
        {detail.error ? (
          <Toast tone="danger">{detail.error}</Toast>
        ) : detail.data == null ? (
          <p role="status" className="text-sm text-ink-muted">
            {detail.loading ? '正在读取报告…' : '报告内容为空。'}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <AiMetaBadge meta={detail.data.payload} />
              <span className="font-code text-xs text-ink-muted">{detail.data.attempt.id}</span>
            </div>
            <AttemptReport report={detail.data.payload} />
          </div>
        )}
      </Modal>

      <Modal
        open={pendingDelete != null}
        onClose={() => (deleting ? undefined : setPendingDelete(null))}
        size="sm"
        title="删除这条练习记录？"
        description="删除后趋势与统计会立即重算，且无法恢复。"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingDelete(null)} disabled={deleting}>
              取消
            </Button>
            <Button variant="danger" onClick={() => void confirmDelete()} loading={deleting}>
              确认删除
            </Button>
          </>
        }
      >
        {pendingDelete ? (
          <p className="text-sm text-ink">
            {MODULE_LABEL_ZH[pendingDelete.module]} · {formatDateTime(pendingDelete.created_at)} ·{' '}
            {pendingDelete.title_zh || pendingDelete.task_ref}
          </p>
        ) : null}
        {deleteError ? (
          <Toast className="mt-2" tone="danger">
            {deleteError}
          </Toast>
        ) : null}
      </Modal>
    </div>
  );
}

export default AttemptsList;
