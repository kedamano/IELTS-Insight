/**
 * SparringTopicPicker —— 陪练话题选择（契约 §16.2 / AC-S7.1、AC-S7.2）。
 *
 * - 按难度分三档（a2 → b1 → b2），每档清单一句话说明这一档「能聊到什么程度」；
 * - 每张话题卡都写清**场景**（用户要知道自己在扮演什么人）；
 * - 引擎未就绪时整块禁用并给可点的重试（AC-G1 同口径），不出现「点了没反应」。
 */
import { Badge, Button, Card, cx } from '../../components/ui';
import type { SparringLevel, SparringTopicMeta } from '../../types/ielts';
import { SPARRING_LEVEL_LABEL, formatBand } from '../../types/ielts';
import { groupByLevel } from './sparringSets';

export type SparringTopicPickerProps = {
  ready: boolean;
  topics: readonly SparringTopicMeta[];
  loading: boolean;
  error: string | null;
  onStart: (topicId: string) => void;
  readyMessage?: string;
  onRetry?: () => void;
};

export default function SparringTopicPicker({
  ready,
  topics,
  loading,
  error,
  onStart,
  readyMessage,
  onRetry,
}: SparringTopicPickerProps) {
  const groups = groupByLevel(topics);

  return (
    <Card
      title="1 对 1 口语陪练 · 选一个场景"
      subtitle="AI 陪练官开口，你答一句、它顺着你的话追问一句；练完给四维评分"
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
            <p className="text-xs text-ink-muted">就绪前不能进入陪练（AC-G1）。</p>
          </div>
        ) : null}

        {error ? (
          <div role="alert" className="text-sm">
            <span className="text-band-poor">{error}</span>
          </div>
        ) : null}

        {ready && loading ? <p className="text-sm text-ink-muted">加载陪练话题…</p> : null}

        {ready && !loading && !error
          ? groups.map((group) => (
              <LevelGroup key={group.level} level={group.level} items={group.items} onStart={onStart} />
            ))
          : null}

        {ready && !loading && !error && groups.length === 0 ? (
          <p className="text-sm text-ink-muted">
            还没有陪练话题：题库在 `backend/app/data/ielts/sparring/` 下，放一个符合 §16.1 的 JSON 即可。
          </p>
        ) : null}
      </div>
    </Card>
  );
}

function LevelGroup({
  level,
  items,
  onStart,
}: {
  level: SparringLevel;
  items: readonly SparringTopicMeta[];
  onStart: (topicId: string) => void;
}) {
  return (
    <section aria-label={SPARRING_LEVEL_LABEL[level]} className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <span className="font-code text-xs text-accent">{level.toUpperCase()}</span>
        <span className="text-xs text-ink-muted">{SPARRING_LEVEL_LABEL[level]}</span>
      </div>
      <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
        {items.map((topic) => (
          <li key={topic.id}>
            <div className={cx('flex h-full flex-col gap-1.5 rounded-card border border-rule bg-paper-sunken px-3 py-2.5')}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-ink">{topic.title_zh}</span>
                <Badge variant="outline">目标 {formatBand(topic.target_band)}</Badge>
                <Badge tone="neutral">{topic.turns} 轮</Badge>
              </div>
              <p className="text-xs leading-relaxed text-ink-secondary">{topic.scenario_zh}</p>
              <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                <span className="text-[11px] text-ink-muted">预置追问 {topic.preset_count} 条（离线也能练）</span>
                <Button size="sm" variant="outline" onClick={() => onStart(topic.id)} aria-label={`开始陪练 ${topic.title_zh}`}>
                  开始
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
