/**
 * PronunciationDetail —— FR-V3：发音能力降级为「折叠区」。
 *
 * AC-V3：发音是次级信息，绝不能当主视觉 headline —— 所以默认 `<details>` 收起，
 * 主分数仍是 0–9 band（AC-G5）；`score_0_100` 只作为辅助小字出现。
 */
import { Badge, Card } from '../../components/ui';
import type { PronunciationDetail as PronunciationDetailData } from '../../types/ielts';

export type PronunciationDetailProps = {
  detail: PronunciationDetailData | null | undefined;
  /** FR-S4：无音频时由转写推断，低置信 */
  confidence?: 'high' | 'low' | null;
};

export default function PronunciationDetail({ detail, confidence }: PronunciationDetailProps) {
  if (!detail) return null;
  const problemWords = detail.problem_words ?? [];

  return (
    <details className="rounded-card border border-rule bg-paper-raised">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-ink-secondary">
        发音细节（次级信息 · 不作为总分依据）
      </summary>
      <div className="px-3 pb-3">
        <Card title="逐词发音" subtitle="来自转写与参考文本的对齐，仅供改进练习用" padded={false}>
          <div className="flex flex-col gap-3 px-4 py-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="neutral" title="词错误率（Word Error Rate），0–1">
                WER {(detail.wer * 100).toFixed(1)}%
              </Badge>
              {/* AC-G5：0–100 只能作辅助小字 */}
              <span className="font-code text-xs text-ink-muted">辅助分 {detail.score_0_100}/100</span>
              {confidence === 'low' ? <Badge tone="mid">低置信（无音频，按转写推断）</Badge> : null}
            </div>

            {problemWords.length ? (
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">问题单词列表</caption>
                <thead>
                  <tr className="border-b border-rule text-left text-xs text-ink-muted">
                    <th scope="col" className="py-1 pr-2 font-medium">
                      单词
                    </th>
                    <th scope="col" className="py-1 pr-2 font-medium">
                      期望音
                    </th>
                    <th scope="col" className="py-1 font-medium">
                      实际音
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {problemWords.map((word) => (
                    <tr key={`${word.word}-${word.expected}`} className="border-b border-rule last:border-b-0">
                      <td className="py-1 pr-2 text-ink">{word.word}</td>
                      <td className="py-1 pr-2 font-code text-ink-secondary">{word.expected}</td>
                      <td className="py-1 font-code" style={{ color: 'var(--band-poor)' }}>
                        {word.actual}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-ink-muted">本次没有检出明显的逐词发音问题。</p>
            )}
          </div>
        </Card>
      </div>
    </details>
  );
}
