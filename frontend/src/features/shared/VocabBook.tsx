import { useMemo, useState } from 'react';
import { Badge, Button, Card, Field, Modal, Tile, Toast, cx } from '../../components/ui';
import { useApi } from '../../hooks/useApi';
import { useTTS } from '../../hooks/useTTS';
import { addVocab, removeVocab, vocabExportUrl, vocabList } from '../../services/api';
import {
  MODULE_LABEL_ZH,
  type Module,
  type VocabNote,
  type WordInfo,
} from '../../types/ielts';
import { localDateOf } from '../report/format';

/**
 * `GET /vocab` 会把 `phonetics_json` 摊平到条目上（`store._vocab_row`），
 * 所以列表行除了 `VocabNote` 还可能带音标/释义，这里显式建模，不做 `any`。
 */
export type VocabRow = VocabNote & Partial<Pick<WordInfo, 'phonetic' | 'zh' | 'difficulty' | 'examples' | 'source'>>;

type SortKey = 'recent' | 'oldest' | 'word';

const SORT_LABELS: Record<SortKey, string> = {
  recent: '最近加入',
  oldest: '最早加入',
  word: '词序 A–Z',
};

/** FR-V1 的两类标签；其他标签原样显示。 */
const TAG_LABEL_ZH: Record<string, string> = {
  collocation: '搭配',
  topic: '话题词',
};

export interface VocabBookProps {
  className?: string;
}

/**
 * 生词本（FR-V1 / AC-V1）。
 *
 * - 搜索、排序、标签筛选都在本地做（数据量小且要求离线可用，FR-G3）。
 * - `note_zh` 行内编辑 = 重新 `POST /vocab`（同 word 覆盖，契约 §1 行 35 的 upsert 语义），
 *   因此必须把 `context` / `source_module` / `source_ref` / `tags` 一并回传，否则会被清空。
 * - 每条都显示 `context` + `source_module` 芯片，让用户想起这个词是在哪科的哪句里遇到的（AC-V1）。
 * - 导出只给 `<a href>` 指向 `vocabExportUrl()`，不在组件里拼端口、不裸 `fetch`（AC-X4）。
 */
export function VocabBook({ className }: VocabBookProps) {
  const [keyword, setKeyword] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ word: string; value: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<VocabRow | null>(null);
  const [busyError, setBusyError] = useState<string | null>(null);
  const tts = useTTS();

  const list = useApi((options) => vocabList(options), []);
  const rows = (list.data ?? []) as VocabRow[];

  const visible = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    const filtered = rows.filter((row) => {
      if (tagFilter && !(row.tags ?? []).includes(tagFilter)) return false;
      if (!needle) return true;
      const haystack = [row.word, row.context, row.note_zh, row.zh, ...(row.tags ?? [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
    const direction = sort === 'oldest' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sort === 'word') return a.word.localeCompare(b.word);
      return direction * String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''));
    });
  }, [rows, keyword, sort, tagFilter]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const row of rows) for (const tag of row.tags ?? []) set.add(tag);
    return [...set].sort();
  }, [rows]);

  // 磁贴条（契约 §8.3）只吃这份已拉回的 rows：不许为填一块磁贴多加一次请求。
  const recentCutoff = Date.now() - 7 * 86400_000;
  const recentCount = rows.filter((item) => {
    const stamp = item.created_at ? Date.parse(item.created_at) : Number.NaN;
    return Number.isFinite(stamp) && stamp >= recentCutoff;
  }).length;
  const noNoteCount = rows.filter((item) => !(item.note_zh ?? '').trim()).length;

  const saveNote = async (): Promise<void> => {
    if (!editing) return;
    const row = rows.find((item) => item.word === editing.word);
    if (!row) return;
    setSaving(true);
    setBusyError(null);
    try {
      await addVocab({
        word: row.word,
        context: row.context ?? '',
        source_module: row.source_module ?? '',
        source_ref: row.source_ref ?? '',
        note_zh: editing.value,
        tags: row.tags ?? [],
      });
      setEditing(null);
      await list.refetch();
    } catch (caught: unknown) {
      setBusyError(caught instanceof Error ? caught.message : '备注保存失败');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async (): Promise<void> => {
    if (!pendingDelete) return;
    setSaving(true);
    setBusyError(null);
    try {
      await removeVocab(pendingDelete.word);
      setPendingDelete(null);
      await list.refetch();
    } catch (caught: unknown) {
      setBusyError(caught instanceof Error ? caught.message : '删除失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={cx('flex flex-col gap-3', className)}>
      <Card
        title="生词本"
        subtitle={`${rows.length} 个词条 · 显示 ${visible.length} 条`}
        actions={
          <div className="flex items-center gap-2">
            <a
              href={vocabExportUrl('csv')}
              download="ielts-vocab.csv"
              className="rounded-card border border-rule px-2 py-1 text-xs text-accent hover:bg-accent-soft"
            >
              导出 CSV
            </a>
            <a
              href={vocabExportUrl('anki')}
              download="ielts-vocab.anki.tsv"
              className="rounded-card border border-rule px-2 py-1 text-xs text-accent hover:bg-accent-soft"
            >
              导出 Anki
            </a>
            <Button variant="ghost" size="sm" onClick={() => void list.refetch()} loading={list.loading}>
              刷新
            </Button>
          </div>
        }
      >
        {list.error ? <Toast tone="danger">{list.error}</Toast> : null}
        {busyError ? <Toast tone="danger">{busyError}</Toast> : null}

        <div className="flex flex-wrap items-end gap-3">
          <Field label="搜索" htmlFor="vocab-search" className="min-w-52 flex-1">
            <input
              id="vocab-search"
              type="search"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="单词、出处句子或中文备注"
              className="h-9 w-full rounded-card border border-rule bg-paper px-2.5 text-sm"
            />
          </Field>
          <Field label="排序" htmlFor="vocab-sort">
            <select
              id="vocab-sort"
              value={sort}
              onChange={(event) => setSort(event.target.value as SortKey)}
              className="h-9 rounded-card border border-rule bg-paper px-2 text-sm"
            >
              {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                <option key={key} value={key}>
                  {SORT_LABELS[key]}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {allTags.length > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-ink-muted">标签</span>
            <button
              type="button"
              onClick={() => setTagFilter(null)}
              aria-pressed={tagFilter === null}
              className={cx(
                'rounded-card border px-2 py-0.5 text-xs',
                tagFilter === null ? 'border-accent bg-accent-soft text-accent' : 'border-rule text-ink-secondary',
              )}
            >
              全部
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
                aria-pressed={tagFilter === tag}
                className={cx(
                  'rounded-card border px-2 py-0.5 text-xs',
                  tagFilter === tag ? 'border-accent bg-accent-soft text-accent' : 'border-rule text-ink-secondary',
                )}
              >
                {TAG_LABEL_ZH[tag] ?? tag}
              </button>
            ))}
          </div>
        ) : null}
      </Card>

      {/* 磁贴条（契约 §8.3）：暖面只给「尚无备注」这个待处理信号，其余 plain。
          「近 7 天新增」即便为 0 也保留——「没加新词」本身是信息（本条契约给的唯一例外）。 */}
      {rows.length > 0 ? (
        <dl aria-label="生词本关键指标" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Tile
            metric="vocab.total"
            label="词条总数"
            value={String(rows.length)}
            hint={`当前显示 ${visible.length} 条`}
          />
          <Tile
            metric="vocab.recent"
            label="近 7 天新增"
            value={String(recentCount)}
            hint={recentCount > 0 ? undefined : '最近 7 天没有新增'}
          />
          {noNoteCount > 0 ? (
            <Tile
              metric="vocab.no-note"
              surface="warm"
              label="尚无备注"
              value={String(noNoteCount)}
              hint="选中单词后可补中文备注"
            />
          ) : null}
        </dl>
      ) : null}

      {visible.length === 0 ? (
        <Card>
          <p role="status" className="text-sm text-ink-secondary">
            {rows.length === 0
              ? '生词本还是空的：在阅读/听力里选中一个词即可加入。'
              : '没有符合条件的生词，换个关键词或清除标签筛选。'}
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {visible.map((row) => {
            const isEditing = editing?.word === row.word;
            return (
              <li key={row.word}>
                <Card>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="font-code text-lg text-ink">{row.word}</span>
                        {row.phonetic ? <span className="font-code text-xs text-ink-muted">{row.phonetic}</span> : null}
                        {row.zh ? <span className="text-sm text-ink-secondary">{row.zh}</span> : null}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void tts.play(row.word)}
                          loading={tts.preparing && tts.playing}
                          aria-label={`播放 ${row.word} 的发音`}
                        >
                          播放
                        </Button>
                      </div>

                      {row.context ? (
                        <p className="mt-1.5 border-l-2 border-rule pl-2 text-sm text-ink-secondary">
                          出处：{row.context}
                        </p>
                      ) : (
                        <p className="mt-1.5 text-xs text-ink-muted">未记录出处句子</p>
                      )}

                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {row.source_module ? (
                          <Badge tone="accent">{MODULE_LABEL_ZH[row.source_module as Module]}</Badge>
                        ) : (
                          <Badge>无来源科目</Badge>
                        )}
                        {row.source_ref ? <span className="font-code text-xs text-ink-muted">{row.source_ref}</span> : null}
                        {(row.tags ?? []).map((tag) => (
                          <Badge key={tag}>{TAG_LABEL_ZH[tag] ?? tag}</Badge>
                        ))}
                        {row.created_at ? (
                          <span className="font-code text-xs text-ink-muted">{localDateOf(row.created_at)}</span>
                        ) : null}
                      </div>

                      <div className="mt-2 flex items-start gap-2">
                        {isEditing ? (
                          <>
                            <textarea
                              value={editing.value}
                              onChange={(event) => setEditing({ word: row.word, value: event.target.value })}
                              rows={2}
                              aria-label={`${row.word} 的中文备注`}
                              className="min-w-0 flex-1 rounded-card border border-accent bg-paper px-2 py-1 text-sm"
                            />
                            <Button variant="primary" size="sm" onClick={() => void saveNote()} loading={saving}>
                              保存
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                              取消
                            </Button>
                          </>
                        ) : (
                          <>
                            <p className="min-w-0 flex-1 text-sm text-ink">
                              {row.note_zh ? row.note_zh : <span className="text-ink-muted">尚无备注</span>}
                            </p>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setEditing({ word: row.word, value: row.note_zh ?? '' })}
                            >
                              编辑备注
                            </Button>
                          </>
                        )}
                      </div>
                    </div>

                    <Button variant="danger" size="sm" onClick={() => setPendingDelete(row)} aria-label={`删除 ${row.word}`}>
                      删除
                    </Button>
                  </div>
                  {tts.error && tts.audioUnavailable ? (
                    <p className="mt-2 text-xs text-ink-muted">{tts.error}</p>
                  ) : null}
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <Modal
        open={pendingDelete != null}
        onClose={() => (saving ? undefined : setPendingDelete(null))}
        size="sm"
        title="删除这个生词？"
        description="删除后该词不再出现在导出文件里。"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingDelete(null)} disabled={saving}>
              取消
            </Button>
            <Button variant="danger" onClick={() => void confirmDelete()} loading={saving}>
              确认删除
            </Button>
          </>
        }
      >
        {pendingDelete ? <p className="font-code text-sm text-ink">{pendingDelete.word}</p> : null}
      </Modal>
    </div>
  );
}

export default VocabBook;
