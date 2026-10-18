/**
 * SetPicker —— 口语选题（FR-S1 / AC-G1）。
 *
 * - 难度档 `target_band ∈ {5.5, 6.5, 7.5}`（FR-S1）+ Part 1/2/3 选择（FR-S2）；
 * - 引擎未就绪时整块禁用，并显示可读状态（AC-G1），不出现「点了没反应」；
 * - 一文件一 part（契约 §10.1），所以 Part 切换要过滤 set 列表。
 */
import { Badge, Button, Card, Tabs, cx } from '../../components/ui';
import type { Band, SpeakingPart, SpeakingSetMeta } from '../../types/ielts';
import { formatBand } from '../../types/ielts';
import { SPEAKING_PARTS, SPEAKING_TARGET_BANDS, partsOfSetMeta } from './speakingSets';

export type SetPickerProps = {
  ready: boolean;
  sets: SpeakingSetMeta[];
  loading: boolean;
  error: string | null;
  targetBand: Band;
  part: SpeakingPart;
  onTargetBandChange: (band: Band) => void;
  onPartChange: (part: SpeakingPart) => void;
  onStart: (setId: string, part: SpeakingPart) => void;
  /** 就绪前给外壳复用的进度/失败文案（AC-G1 要求可见过程） */
  readyMessage?: string;
  onRetry?: () => void;
};

export default function SetPicker({
  ready,
  sets,
  loading,
  error,
  targetBand,
  part,
  onTargetBandChange,
  onPartChange,
  onStart,
  readyMessage,
  onRetry,
}: SetPickerProps) {
  const partTabs = SPEAKING_PARTS.map((item) => ({
    id: String(item.id),
    label: item.label,
    disabled: !ready,
  }));
  const filtered = sets.filter((meta) => partsOfSetMeta(meta).includes(part));
  const activePart = SPEAKING_PARTS.find((item) => item.id === part);

  return (
    <Card
      title="选择口语套题"
      subtitle={activePart ? `${activePart.label} · ${activePart.note}` : undefined}
      actions={
        <Badge tone={ready ? 'good' : 'mid'} dot>
          {ready ? '引擎已就绪' : '引擎启动中'}
        </Badge>
      }
    >
      <div className="flex flex-col gap-4">
        {!ready ? (
          <div role="status" aria-live="polite" className="flex flex-col gap-2">
            <p className="text-sm text-ink-secondary">{readyMessage ?? '正在启动本地引擎…'}</p>
            {onRetry ? (
              <div>
                <Button size="sm" onClick={onRetry}>
                  重试
                </Button>
              </div>
            ) : null}
            <p className="text-xs text-ink-muted">就绪前不能进入口语练习（AC-G1）。</p>
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-ink-secondary">目标 Band（难度分层）</span>
          <div className="flex flex-wrap gap-2" role="group" aria-label="目标 band">
            {SPEAKING_TARGET_BANDS.map((band) => {
              const selected = band === targetBand;
              return (
                <Button
                  key={band}
                  size="sm"
                  variant={selected ? 'primary' : 'default'}
                  disabled={!ready}
                  aria-pressed={selected}
                  onClick={() => onTargetBandChange(band)}
                >
                  {formatBand(band)}
                </Button>
              );
            })}
          </div>
        </div>

        <Tabs
          ariaLabel="口语 Part"
          items={partTabs}
          value={String(part)}
          onChange={(id) => onPartChange(Number(id) as SpeakingPart)}
          size="sm"
        />

        {error ? (
          <div role="alert" className="text-sm" style={{ color: 'var(--band-poor)' }}>
            {error}
          </div>
        ) : null}

        {ready && loading ? <p className="text-sm text-ink-muted">加载套题列表…</p> : null}

        {ready && !loading && !error ? (
          filtered.length ? (
            <ul className="flex flex-col gap-2">
              {filtered.map((meta) => (
                <li key={meta.id}>
                  <div
                    className={cx(
                      'flex items-center justify-between gap-3 rounded-control bg-paper-sunken px-3 py-2',
                    )}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm text-ink">{meta.title_zh}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                        <span className="font-code">{meta.id}</span>
                        <Badge>目标 {formatBand(meta.target_band)}</Badge>
                        {meta.topic ? <Badge variant="outline">{meta.topic}</Badge> : null}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onStart(meta.id, part)}
                      aria-label={`开始 ${meta.title_zh} 的 Part ${part}`}
                    >
                      开始
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-muted">
              当前难度档（{formatBand(targetBand)}）下没有支持 Part {part} 的套题，可切换目标 band 或 Part。
            </p>
          )
        ) : null}
      </div>
    </Card>
  );
}
