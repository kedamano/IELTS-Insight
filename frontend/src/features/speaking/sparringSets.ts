/**
 * sparringSets —— 陪练话题与对话的只读辅助（契约 §16）。
 *
 * 为什么单独一个文件：话题列表来自后端 `GET /sparring/topics`，但界面还需要
 * 「这个 level 有什么话题」「这句追问是不是离线回落」「还剩几轮」这类**派生读数**。
 * 这层不声明新数据形状（真源是 `types/ielts.ts`），只做防御性读取与纯函数派生，
 * 任何情况下都不抛 —— 与 `speakingSets.ts` 同一条纪律。
 */
import type {
  SparringLevel,
  SparringMessage,
  SparringPartnerSource,
  SparringTopicMeta,
  SparringTurnResult,
} from '../../types/ielts';

type Loose = Record<string, unknown>;

function asRecord(value: unknown): Loose | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Loose) : null;
}

/** 陪练官消息的来源徽标文案（AC-S7.6a：离线逐条标注，而不只在页脚说明）。 */
export function partnerSourceLabel(source: SparringPartnerSource | undefined): string {
  if (source === 'opening') return '开场白';
  if (source === 'ai') return 'AI 追问';
  return '预置追问';
}

export function isFallbackMessage(message: SparringMessage): boolean {
  return message.role === 'partner' && message.source === 'fallback';
}

/** 已答轮次 / 上限（磁贴 `sparring.turns`）。 */
export function turnsUsed(messages: readonly SparringMessage[]): number {
  return messages.filter((item) => item.role === 'user').length;
}

/** 剩余轮次（磁贴 `sparring.remaining`），下限 0。 */
export function turnsRemaining(maxTurns: number, messages: readonly SparringMessage[]): number {
  const total = Number.isFinite(maxTurns) && maxTurns > 0 ? Math.floor(maxTurns) : 0;
  return Math.max(0, total - turnsUsed(messages));
}

/**
 * 离线回落条数（本屏磁贴的暖面读数，契约 §16.5）。
 * 只数「预置追问」，不数开场白：开场白本来就是预置的，把它算进降级指标会让每一场都是暖面。
 */
export function fallbackCount(messages: readonly SparringMessage[]): number {
  return messages.filter(isFallbackMessage).length;
}

export function levelOfMeta(meta: SparringTopicMeta): SparringLevel | null {
  const rec = asRecord(meta);
  const value = rec?.level;
  return value === 'a2' || value === 'b1' || value === 'b2' ? value : null;
}

/** 按难度分组（选择器用）：顺序恒为 a2 → b1 → b2，缺档不渲染空组。 */
export function groupByLevel(
  items: readonly SparringTopicMeta[],
): { level: SparringLevel; items: SparringTopicMeta[] }[] {
  const out: { level: SparringLevel; items: SparringTopicMeta[] }[] = [];
  for (const level of ['a2', 'b1', 'b2'] as const) {
    const bucket = items.filter((item) => levelOfMeta(item) === level);
    if (bucket.length) out.push({ level, items: bucket });
  }
  return out;
}

/** 一轮作答之后对话流里新增的两条（我的 + 陪练官的），用服务端返回的真值而不是本地拼。 */
export function messagesFromTurn(
  previous: readonly SparringMessage[],
  result: SparringTurnResult,
): SparringMessage[] {
  const mine: SparringMessage = {
    seq: result.seq,
    role: 'user',
    text: result.transcript,
    confidence: result.confidence,
    duration_sec: null,
  };
  return [...previous, mine, result.partner];
}

/** 「已到轮次上限」的可读原因（AC-S7.6b：禁用发送时必须给出原因）。 */
export const LIMIT_REACHED_TEXT = '已到这个话题的轮次上限，先结束并评分；想继续练可以开一个新会话。';

/** 未录音时的麦克风失败提示与 AC-S3b 同源：文本输入永远可用。 */
export const SPARRING_TEXT_FALLBACK_LABEL = '直接输入这句英文（麦克风不可用时练习不中断）';

// ============================================================
// 会话接回（契约 §16.3 第 6 条）
// ============================================================

/**
 * 未结束会话的本地凭据。与 `ielts.grading-jobs`（§10.6）并列：Tauri webview 会刷新/重启，
 * 后端会话还在库里，但前端若忘掉 `session_id`，用户看到的是「我刚聊的那场没了」。
 * 题库口语没有这个键（它按题序推进，重进就当重练），陪练是**一段不断变长的对话**，
 * 丢掉比重练可惜得多。
 */
export const SPARRING_SESSION_STORAGE_KEY = 'ielts.sparring-session';

export function rememberSession(sessionId: string): void {
  if (typeof localStorage === 'undefined' || !sessionId) return;
  try {
    localStorage.setItem(SPARRING_SESSION_STORAGE_KEY, sessionId);
  } catch {
    // 隐私模式/配额写不进去：内存态照旧，只是刷新后接不回。
  }
}

export function forgetSession(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(SPARRING_SESSION_STORAGE_KEY);
  } catch {
    // 删不掉也就算了：下一次读到 404 会静默丢弃。
  }
}

export function rememberedSession(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const value = localStorage.getItem(SPARRING_SESSION_STORAGE_KEY);
    return value && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}
