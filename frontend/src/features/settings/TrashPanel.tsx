/**
 * 「回收站」卡（契约 §14.4 / §14.8；Wave 7 的 7g）。
 *
 * §14.4 把删除改成了可逆，但可逆这件事如果用户找不到入口，实际后果和硬删没区别。
 * 三条实现口径：
 * - 行内容就是后端给的摘要（科目 / 题号 / band / 何时删的），够做「恢复还是清除」这个决定；
 *   **不提供**已删记录的报告入口 —— §14.4 定了软删后 `GET /attempts/{id}` 仍 404，要看报告先恢复。
 * - 条数用后端的 `total`，不是本页 `items.length`：默认只回 50 条，两者不等时必须说清「只列出最近 50 条」，
 *   不然用户会以为回收站里就只有这 50 条。
 * - 彻底删除前必须确认，而后端在没有快照时给的 409 中文（§14.4 那道门）要原样到达用户，
 *   不许改写成「删除失败」。
 */
import { useCallback, useState } from 'react';
import { Badge, Button, Card, Modal, Tile, Toast, formatBand } from '../../components/ui';
import { useApi } from '../../hooks/useApi';
import { describeActionError, purgeAttempt, restoreAttempt, trashAttempts } from '../../services/api';
import { MODULE_LABEL_ZH, type TrashItem } from '../../types/ielts';
import { formatDateTime } from '../report/format';

/** 与后端 `limit` 默认值对齐；超过就走「只列出最近 N 条」的说法。 */
const PAGE_SIZE = 50;

export interface TrashPanelProps {
  /** §14.6 联动：学习库处于只读降级时禁用恢复与清除。 */
  storageReadonly?: boolean;
}

export function TrashPanel({ storageReadonly = false }: TrashPanelProps) {
  const call = useApi((options) => trashAttempts({ limit: PAGE_SIZE }, options), []);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmRow, setConfirmRow] = useState<TrashItem | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    await call.refetch();
  }, [call]);

  const restore = async (id: string): Promise<void> => {
    setBusyId(id);
    setActionError(null);
    try {
      await restoreAttempt(id);
      setNotice('这条练习记录已经回到列表与统计里。');
      await reload();
    } catch (error) {
      setActionError(describeActionError(error, '恢复没有成功'));
    } finally {
      setBusyId(null);
    }
  };

  const purge = async (id: string): Promise<void> => {
    setBusyId(id);
    setActionError(null);
    try {
      await purgeAttempt(id);
      setNotice('已从本机彻底清除。');
      setConfirmRow(null);
      await reload();
    } catch (error) {
      // 409 的那句「请先备份」是后端写好的行动指引，原样留着才有用。
      setActionError(describeActionError(error, '清除没有成功'));
      setConfirmRow(null);
    } finally {
      setBusyId(null);
    }
  };

  const items = call.data?.items ?? [];
  const total = call.data?.total ?? items.length;
  const truncated = total > items.length;

  return (
    <Card
      title="回收站"
      subtitle="删除的练习记录先留在这里；恢复后才会重新计入进度与趋势"
      actions={
        <Button size="sm" variant="ghost" loading={call.loading} onClick={() => void reload()}>
          重新读取
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        {storageReadonly ? (
          <Toast tone="warn">学习库当前只能读，恢复与清除要等它恢复可写；下面的记录仍然可以查看。</Toast>
        ) : null}

        {actionError ? (
          <Toast tone="danger" onDismiss={() => setActionError(null)}>
            {actionError}
          </Toast>
        ) : null}

        {notice ? (
          <Toast tone="good" onDismiss={() => setNotice(null)}>
            {notice}
          </Toast>
        ) : null}

        {call.error && !call.data ? <Toast tone="danger">{call.error}</Toast> : null}

        <dl aria-label="回收站关键指标" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Tile metric="trash.count" label="待处理" value={call.data ? String(total) : '—'} unit="条" />
          <Tile
            metric="trash.since"
            label="最近一次删除"
            value={items[0] ? formatDateTime(items[0].deleted_at) : '—'}
            hint="按删除时间从新到旧排列"
          />
        </dl>

        {call.loading && !call.data ? (
          <p role="status" className="text-sm text-ink-muted">
            正在读取回收站…
          </p>
        ) : null}

        {call.data && items.length === 0 ? (
          <p className="text-sm text-ink-secondary">回收站是空的。删除练习记录后可以在这里找回。</p>
        ) : null}

        {call.data && items.length > 0 ? (
          <>
            {truncated ? (
              <p className="text-xs text-ink-muted">{`共 ${total} 条，只列出最近 ${PAGE_SIZE} 条。`}</p>
            ) : null}
            <ul aria-label="回收站里的练习记录" className="flex flex-col divide-y divide-rule">
              {items.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2">
                  <Badge tone="neutral">{MODULE_LABEL_ZH[row.module]}</Badge>
                  <span className="font-code text-xs text-ink">{row.task_ref}</span>
                  <span className="text-xs text-ink-muted">
                    {row.band_overall === null || row.band_overall === undefined
                      ? '未评分'
                      : `Band ${formatBand(Number(row.band_overall))}`}
                  </span>
                  <span className="text-xs text-ink-muted">{`删除于 ${formatDateTime(row.deleted_at)}`}</span>
                  <span className="ml-auto flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={storageReadonly || busyId !== null}
                      onClick={() => void restore(row.id)}
                    >
                      恢复
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={storageReadonly || busyId !== null}
                      onClick={() => setConfirmRow(row)}
                    >
                      彻底删除
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>

      <Modal
        open={confirmRow !== null}
        onClose={() => setConfirmRow(null)}
        title="彻底删除这条记录？"
        description={
          confirmRow
            ? `${MODULE_LABEL_ZH[confirmRow.module]} · ${confirmRow.task_ref} · 删除于 ${formatDateTime(confirmRow.deleted_at)}`
            : undefined
        }
        size="sm"
        footer={
          <>
            <Button variant="default" onClick={() => setConfirmRow(null)}>
              取消
            </Button>
            <Button
              variant="danger"
              loading={busyId === confirmRow?.id}
              onClick={() => {
                if (confirmRow) void purge(confirmRow.id);
              }}
            >
              确认清除
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed">
          清除后无法撤回，报告与逐项答案都会从本机消失。拿不准就选「取消」，先恢复回列表更稳。
        </p>
        <p className="mt-2 text-xs text-ink-secondary">
          本机一份快照都没有时，后端会拒绝这一步并提示先备份 —— 那是给你的退路，不是故障。
        </p>
      </Modal>
    </Card>
  );
}

export default TrashPanel;
