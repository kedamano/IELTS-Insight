/**
 * FollowupList —— Part 3 追问（FR-S6 / AC-S6）。
 *
 * AI 动态追问可用时展示 `followups()` 返回的问题；
 * `ai_used === false` 时展示该套题的 `fallback_questions`（题库预置追问），
 * 并挂同一个降级徽章（CONSTITUTION §3），流程照走完，不阻塞练习。
 */
import { Badge, Card } from '../../components/ui';
import type { DegradedReason } from '../../types/ielts';
import { degradedLabelZh } from '../../types/ielts';

export type FollowupListProps = {
  /** `followups().questions` */
  questions: string[];
  aiUsed: boolean;
  degradedReason?: DegradedReason;
  /** 契约 §2-S：预置追问（ai_used=false 时使用，AC-S6） */
  fallbackQuestions: string[];
  /** 当前进行到的追问序号（可选，用于高亮） */
  activeIndex?: number | null;
  onSelect?: (index: number) => void;
};

export default function FollowupList({
  questions,
  aiUsed,
  degradedReason = null,
  fallbackQuestions,
  activeIndex = null,
  onSelect,
}: FollowupListProps) {
  const useFallback = !aiUsed;
  const list = useFallback && fallbackQuestions.length ? fallbackQuestions : questions;

  return (
    <Card
      title="Part 3 考官追问"
      subtitle={useFallback ? '使用题库预置追问，流程照常进行' : '基于你的 Part 2 回答动态生成'}
      actions={
        useFallback ? (
          <Badge tone="mid" dot>
            降级 · {degradedLabelZh({ ai_used: false, approximate: true, degraded_reason: degradedReason })}
          </Badge>
        ) : (
          <Badge tone="good" dot>
            AI 追问
          </Badge>
        )
      }
    >
      {list.length ? (
        <ol className="flex flex-col gap-2">
          {list.map((question, index) => (
            <li key={`${index}-${question}`}>
              <button
                type="button"
                onClick={() => onSelect?.(index)}
                className={
                  activeIndex === index
                    ? 'flex w-full gap-2 rounded-card border border-accent bg-accent-soft px-3 py-2 text-left text-sm text-ink'
                    : 'flex w-full gap-2 rounded-card border border-rule bg-paper px-3 py-2 text-left text-sm text-ink-secondary hover:bg-paper-sunken hover:text-ink'
                }
              >
                <span className="font-code text-xs text-ink-muted">{index + 1}.</span>
                <span>{question}</span>
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-ink-muted">
          暂无追问问题：AI 不可用且该套题未提供预置追问，可直接进入 Part 2 回答的评分。
        </p>
      )}
    </Card>
  );
}
