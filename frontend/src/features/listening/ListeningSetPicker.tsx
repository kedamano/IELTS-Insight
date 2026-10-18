/**
 * ListeningSetPicker —— 听力选题（FR-L1 口音 / FR-L2 kind + AC-G1 就绪门）。
 *
 * 过滤维度来自契约 §1 #13 的查询参数：`accent`（英音/美音）与 `kind`（短练/模拟卷）；
 * 引擎未就绪时列表与按钮全部禁用，并显示可读状态与「重试」，不允许出现「点了没反应」。
 */
import { Badge, Button, Card, Tabs } from '../../components/ui';
import type { Accent, ListeningSetMeta, SetKind } from '../../types/ielts';
import { formatBand } from '../../types/ielts';
import { LISTENING_ACCENTS, LISTENING_KINDS, accentOfMeta, sectionOf } from './listeningSets';

export type ListeningSetPickerProps = {
  ready: boolean;
  sets: ListeningSetMeta[];
  loading: boolean;
  error: string | null;
  accent: Accent;
  kind: SetKind;
  onAccentChange: (accent: Accent) => void;
  onKindChange: (kind: SetKind) => void;
  onStart: (setId: string) => void;
  readyMessage?: string;
  onRetry?: () => void;
};

export default function ListeningSetPicker({
  ready,
  sets,
  loading,
  error,
  accent,
  kind,
  onAccentChange,
  onKindChange,
  onStart,
  readyMessage,
  onRetry,
}: ListeningSetPickerProps) {
  const activeKind = LISTENING_KINDS.find((item) => item.id === kind);

  return (
    <Card
      title="选择听力套题"
      subtitle={activeKind ? `${activeKind.label} · ${activeKind.note}` : undefined}
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
                <Button size="sm" onClick={onRetry}>重试</Button>
              </div>
            ) : null}
            <p className="text-xs text-ink-muted">就绪前不能进入听力练习（AC-G1）。</p>
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-ink-secondary">口音（edge-tts 音色，FR-L1）</span>
          <div className="flex flex-wrap gap-2" role="group" aria-label="口音">
            {LISTENING_ACCENTS.map((option) => (
              <Button
                key={option.id}
                size="sm"
                variant={option.id === accent ? 'primary' : 'default'}
                aria-pressed={option.id === accent}
                disabled={!ready}
                onClick={() => onAccentChange(option.id)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>

        <Tabs
          ariaLabel="套题类型"
          size="sm"
          value={kind}
          items={LISTENING_KINDS.map((item) => ({ id: item.id, label: item.label, disabled: !ready }))}
          onChange={(id) => onKindChange(id as SetKind)}
        />

        {error ? (
          <div role="alert" className="text-sm" style={{ color: 'var(--band-poor)' }}>
            {error}
          </div>
        ) : null}

        {ready && loading ? <p className="text-sm text-ink-muted">加载套题列表…</p> : null}

        {ready && !loading && !error ? (
          sets.length ? (
            <ul className="flex flex-col gap-2">
              {sets.map((meta) => {
                const section = sectionOf(meta);
                const count = typeof meta.question_count === 'number' ? meta.question_count : 0;
                const metaAccent = accentOfMeta(meta);
                return (
                  <li key={meta.id}>
                    <div className="flex items-center justify-between gap-3 rounded-control px-3 py-2 transition-colors duration-[var(--motion-fast)] hover:bg-paper-sunken">
                      <div className="min-w-0">
                        <div className="truncate text-sm text-ink">{meta.title_zh}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                          <span className="font-code">{meta.id}</span>
                          {section ? <Badge variant="outline">Section {section}</Badge> : null}
                          {count ? <Badge>{count} 题</Badge> : null}
                          <Badge>目标 {formatBand(meta.target_band)}</Badge>
                          {metaAccent ? <Badge variant="outline">{metaAccent}</Badge> : null}
                          {meta.topic ? <Badge variant="outline">{meta.topic}</Badge> : null}
                        </div>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => onStart(meta.id)} aria-label={`开始 ${meta.title_zh}`}>
                        开始
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-ink-muted">该口音与类型下暂无套题，可切换口音或改成「短练」。</p>
          )
        ) : null}
      </div>
    </Card>
  );
}
