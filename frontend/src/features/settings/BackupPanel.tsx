/**
 * 「数据与备份」卡（契约 §14.3 / §14.8；Wave 7 的 7g）。
 *
 * 立这块的唯一理由：§14.3 的快照保护从 7c 起就在跑，但用户在界面上一个都够不着 ——
 * 看不见备份的保护等于没有保护。所以这里的取舍是：
 * - 行内容用「本地时间 + 中文语义 + 大小」，不用文件名。`app.pre-upgrade.20261028T010203.sqlite`
 *   对人没有辨识度，而文件名本来就是给 `restore` 的 URL 参数用的（内部值不外露）。
 * - 恢复是全站唯一的破坏性写入，必须确认；确认文案点名「会被覆盖」与「先留恢复前副本」，
 *   因为 §14.3 那道 `pre-restore` 门只有用户知道才算存在。
 * - 本机路径全项目只在这里显示（§14.3），错误文案与弹窗里一律不许出现。
 * - 只读降级时写动作禁用（§14.6）：点了只会撞 503，而用户此刻需要的是看清退路还在不在。
 */
import { useCallback, useState } from 'react';
import { Badge, Button, Card, Modal, Tile, Toast } from '../../components/ui';
import { useApi } from '../../hooks/useApi';
import { backups, createBackup, describeActionError, restoreBackup } from '../../services/api';
import type { SnapshotRow } from '../../types/ielts';
import { formatDateTime } from '../report/format';

/** 后端 tag → 人话（§14.8：不许把机器名甩给用户）。 */
const TAG_LABEL_ZH: Record<string, string> = {
  manual: '手动备份',
  startup: '自动备份',
  'pre-upgrade': '升级前',
  'pre-restore': '恢复前',
};

const TAG_TONE: Record<string, 'good' | 'neutral' | 'accent'> = {
  manual: 'accent',
  startup: 'neutral',
  'pre-upgrade': 'good',
  'pre-restore': 'neutral',
};

function tagLabel(tag: string): string {
  return TAG_LABEL_ZH[tag] ?? '本机副本';
}

/** 快照至少几百 KB，用 MB 一位小数够判断「这份是不是空的」。 */
function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function formatAgeDays(days: number): string {
  if (days < 1) return '今天';
  return `${Math.floor(days)} 天`;
}

export interface BackupPanelProps {
  /** §14.6 联动：学习库处于只读降级时禁用全部写动作。 */
  storageReadonly?: boolean;
}

export function BackupPanel({ storageReadonly = false }: BackupPanelProps) {
  const call = useApi((options) => backups(options), []);
  const [busy, setBusy] = useState<'create' | 'restore' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmRow, setConfirmRow] = useState<SnapshotRow | null>(null);
  const [copied, setCopied] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    await call.refetch();
  }, [call]);

  const snapshotBackup = async (): Promise<void> => {
    setBusy('create');
    setActionError(null);
    try {
      await createBackup();
      setNotice('已在本机多存了一份副本。');
      await reload();
    } catch (error) {
      setActionError(describeActionError(error, '备份没有成功'));
    } finally {
      setBusy(null);
    }
  };

  const runRestore = async (row: SnapshotRow): Promise<void> => {
    setBusy('restore');
    setActionError(null);
    try {
      await restoreBackup(row.name);
      // 不说「一切照常」：结构可能随快照回到旧版本号，其它屏手上的数据已经是旧的。
      setNotice(`已恢复到 ${formatDateTime(row.created_at)} 那一份。其它页面的数据请重新读取，或重启应用。`);
      setConfirmRow(null);
      await reload();
    } catch (error) {
      setActionError(describeActionError(error, '恢复没有成功'));
      setConfirmRow(null);
    } finally {
      setBusy(null);
    }
  };

  const copyDirectory = async (directory: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(directory);
      setCopied(true);
    } catch {
      setActionError('复制没成功，可以在路径上手动选中复制。');
    }
  };

  const list = call.data?.items ?? [];
  const staleDays = call.data?.days_since_last ?? null;
  const maxAge = call.data?.max_age_days ?? 7;
  const isStale = staleDays !== null && staleDays > maxAge;

  return (
    <Card
      title="数据与备份"
      subtitle="副本只存在本机；每一轮练习记录都可以回到下面任意一份的样子"
      actions={
        <Button
          size="sm"
          variant="outline"
          loading={busy === 'create'}
          disabled={storageReadonly || busy !== null}
          onClick={() => void snapshotBackup()}
        >
          立即备份一份
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        {storageReadonly ? (
          <Toast tone="warn">学习库当前只能读，备份与恢复要等它恢复可写；下面的副本仍然可以查看。</Toast>
        ) : null}

        {isStale ? (
          <Toast tone="warn">
            {`已经 ${formatAgeDays(staleDays ?? 0)}没有备份了。练习记录多的时候建议先点「立即备份一份」。`}
          </Toast>
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

        <dl aria-label="备份关键指标" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Tile metric="backup.count" label="本机副本" value={call.data ? String(list.length) : '—'} unit="份" />
          <Tile
            metric="backup.last"
            label="上次备份"
            value={staleDays === null ? '尚无' : formatAgeDays(staleDays)}
            hint={staleDays === null ? '本机还没有任何快照' : isStale ? `超过 ${maxAge} 天的建议间隔` : '在建议间隔内'}
          />
          <Tile
            metric="backup.keep"
            label="轮转上限"
            value={call.data ? String(call.data.keep) : '—'}
            unit="份"
            hint="超出后自动冲掉最旧的一份，当前学习库永不删除"
          />
        </dl>

        {call.loading && !call.data ? (
          <p role="status" className="text-sm text-ink-muted">
            正在读取本机副本…
          </p>
        ) : null}

        {call.data && list.length === 0 ? (
          <p className="text-sm text-ink-secondary">
            本机还没有副本。练习记录已经写进了学习库，但学习库本身目前没有第二份 ——
            点上面的「立即备份一份」就有了。
          </p>
        ) : null}

        {call.data && list.length > 0 ? (
          <ol aria-label="本机快照" className="flex flex-col divide-y divide-rule">
            {list.map((row) => (
              <li key={row.name} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2">
                <span className="font-mono text-sm text-ink">{formatDateTime(row.created_at)}</span>
                <Badge tone={TAG_TONE[row.tag] ?? 'neutral'}>{tagLabel(row.tag)}</Badge>
                <span className="text-xs text-ink-muted">{formatSize(row.size_bytes)}</span>
                <span className="ml-auto">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={storageReadonly || busy !== null}
                    onClick={() => setConfirmRow(row)}
                  >
                    恢复到这一份
                  </Button>
                </span>
              </li>
            ))}
          </ol>
        ) : null}

        {call.data ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
            <span>副本目录</span>
            <code className="font-code break-all">{call.data.directory}</code>
            <Button size="sm" variant="ghost" onClick={() => void copyDirectory(call.data?.directory ?? '')}>
              {copied ? '已复制' : '复制路径'}
            </Button>
          </div>
        ) : null}
      </div>

      <Modal
        open={confirmRow !== null}
        onClose={() => setConfirmRow(null)}
        title="恢复到这一份副本？"
        description={
          confirmRow
            ? `${formatDateTime(confirmRow.created_at)} · ${tagLabel(confirmRow.tag)} · ${formatSize(confirmRow.size_bytes)}`
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
              loading={busy === 'restore'}
              onClick={() => {
                if (confirmRow) void runRestore(confirmRow);
              }}
            >
              确认恢复
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed">
          当前进度会被覆盖成这份副本的样子。恢复之前，系统会先把<strong className="font-medium">现在</strong>
          的状态存成一份「恢复前」副本，所以这一步也能撤回。
        </p>
        <p className="mt-2 text-xs text-ink-secondary">
          完成后其它页面的数据要重新读取（或重启应用），因为结构也可能跟着回到旧版本。
        </p>
      </Modal>
    </Card>
  );
}

export default BackupPanel;
