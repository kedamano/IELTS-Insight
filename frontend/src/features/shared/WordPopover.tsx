import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Toast, cx } from '../../components/ui';
import { useApi } from '../../hooks/useApi';
import { useTTS } from '../../hooks/useTTS';
import { addVocab, wordInfo } from '../../services/api';
import { MODULE_LABEL_ZH, type Module, type VocabNote, type WordInfo as WordDetail } from '../../types/ielts';

export interface WordPopoverProps {
  /** 用户在阅读/听力原文里选中的词或短语。 */
  word: string;
  /** 出处句子（AC-V1 的 `context`，由调用方传入而不是让浮层猜）。 */
  context: string;
  sourceModule: Module | string;
  /** 出处 set id / 题号，写进 `source_ref`。 */
  sourceRef?: string;
  onClose?: () => void;
  /** 加入成功回调（生词本据此刷新）。 */
  onAdded?: (note: VocabNote) => void;
  className?: string;
}

/**
 * 选词浮层（FR-V1 / FR-V3）。
 *
 * 只在原地展示 `GET /vocab?word=` 的词典详情，并把「选中处」原样带到 `POST /vocab`：
 * `context` = 调用方给的原句，`source_module` = 当前科，`source_ref` = set id。
 * 标签规则（FR-V1）：多词短语 → `collocation`；词典给出话题 → `topic`。
 */
export function WordPopover({
  word,
  context,
  sourceModule,
  sourceRef = '',
  onClose,
  onAdded,
  className,
}: WordPopoverProps) {
  const trimmed = word.trim();
  const detail = useApi((options) => wordInfo(trimmed, options), [trimmed], { enabled: trimmed.length > 0 });
  const tts = useTTS();
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // 选中外部时关闭：浮层不打断做题，点别处就该消失（键盘 Escape 同理）。
  useEffect(() => {
    if (!onClose) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [onClose]);

  const info = detail.data;

  const tagsFor = (phrase: string, source?: WordDetail | null): string[] => {
    const tags: string[] = [];
    if (phrase.split(/\s+/).length > 1 || (source?.collocations ?? []).includes(phrase)) tags.push('collocation');
    if (source?.topic) tags.push('topic');
    return tags;
  };

  const add = async (phrase: string): Promise<void> => {
    if (!phrase) return;
    setError(null);
    try {
      const note = await addVocab({
        word: phrase,
        context,
        source_module: sourceModule,
        source_ref: sourceRef,
        note_zh: phrase === trimmed ? (info?.zh ?? '') : '',
        tags: tagsFor(phrase, info),
      });
      setAdded(true);
      onAdded?.(note);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : '加入生词本失败');
    }
  };

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={`生词详情 ${trimmed}`}
      className={cx(
        'absolute z-40 w-72 rounded-card border border-rule bg-paper-raised shadow-elevated',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2 px-3 pt-2.5">
        <div className="min-w-0">
          <p className="truncate font-code text-base text-ink">{trimmed || '未选中内容'}</p>
          {info?.phonetic ? <p className="font-code text-xs text-ink-muted">{info.phonetic}</p> : null}
        </div>
        {onClose ? (
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="关闭生词详情">
            关闭
          </Button>
        ) : null}
      </div>

      <div className="px-3 pb-3 pt-1">
        {detail.error ? (
          <Toast tone="danger">{detail.error}</Toast>
        ) : info == null ? (
          <p className="text-sm text-ink-muted">{detail.loading ? '正在查词…' : '本地词典没有该词。'}</p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-ink">{info.zh || '词典未提供中文释义'}</p>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone="accent">{MODULE_LABEL_ZH[sourceModule as Module] ?? String(sourceModule)}</Badge>
              {info.topic ? <Badge>话题 {info.topic}</Badge> : null}
              {info.difficulty ? <Badge>难度 {info.difficulty}</Badge> : null}
            </div>
            {info.examples.length > 0 ? (
              <p className="text-xs text-ink-secondary">例：{info.examples[0]}</p>
            ) : null}
            {info.collocations && info.collocations.length > 0 ? (
              <div className="flex flex-col gap-1">
                <span className="text-xs text-ink-muted">搭配（点击加入生词本）</span>
                <ul className="flex flex-wrap gap-1">
                  {info.collocations.slice(0, 4).map((phrase) => (
                    <li key={phrase}>
                      <button
                        type="button"
                        onClick={() => void add(phrase)}
                        className="rounded-card border border-rule px-1.5 py-0.5 text-xs text-ink-secondary hover:bg-accent-soft hover:text-accent"
                      >
                        {phrase}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-1.5">
              <Button variant="primary" size="sm" onClick={() => void add(trimmed)} disabled={added}>
                {added ? '已加入' : '加入生词本'}
              </Button>
              <Button variant="outline" size="sm" onClick={() => void tts.play(trimmed)} aria-label={`播放 ${trimmed}`}>
                播放
              </Button>
            </div>
            {error ? <p className="text-xs" style={{ color: 'var(--band-poor)' }}>{error}</p> : null}
            {tts.error ? <p className="text-xs text-ink-muted">{tts.error}</p> : null}
            <p className="text-xs text-ink-muted">出处：{context ? `「${context}」` : '未提供原句'}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default WordPopover;
