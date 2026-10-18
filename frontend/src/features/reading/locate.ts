/**
 * 「定位」段落推断（FR-R2 / AC-R2）。
 *
 * 关键约束：题面响应**不含** `answer_paragraph`（契约 §2-R + §10.1，后端 `strip_answers`
 * 的 LEAK_KEYS 连 `answer_quote`/`answer_label` 一起剔除）。所以做题阶段的定位只能靠：
 * 1. `heading_match.paragraph_label`（题目自带，官方就是「为段落选标题」）；
 * 2. 其余题型用**题干自身的实词**在篇章里做一次唯一的关键词匹配（雅思 skim/scan 的定位法），
 *    命中不唯一就放弃（宁可禁用按钮，也不给一个可能错误的「官方定位」）。
 *
 * 讲评阶段另有 `item.answer_paragraph`（§3-OR 带回），那条路径直接用它，见 ReadingReview。
 */
import type { PassageParagraph, ReadingQuestionPublic } from '../../types/ielts';

/** 只用于「取实词」，不必穷尽；过小的词一律忽略（雅思定位靠低频实词）。 */
const STOPWORDS: ReadonlySet<string> = new Set([
  'the', 'and', 'for', 'are', 'was', 'were', 'that', 'this', 'these', 'those', 'with', 'from',
  'have', 'has', 'had', 'not', 'but', 'can', 'could', 'would', 'should', 'will', 'than', 'then',
  'them', 'they', 'their', 'there', 'here', 'what', 'when', 'where', 'which', 'who', 'whom',
  'whose', 'why', 'how', 'all', 'any', 'some', 'most', 'more', 'less', 'least', 'very', 'much',
  'many', 'such', 'also', 'into', 'onto', 'over', 'under', 'about', 'above', 'below', 'between',
  'within', 'without', 'because', 'although', 'though', 'while', 'however', 'therefore', 'thus',
  'does', 'did', 'do', 'done', 'being', 'been', 'before', 'after', 'often', 'always', 'never',
  'said', 'says', 'researchers', 'research', 'study', 'studies', 'people', 'acc', 'according',
  'passage', 'paragraph', 'correct', 'question', 'statement', 'following', 'choose', 'select',
  'main', 'point', 'writer', 'writers', 'true', 'false', 'given', 'notgiven', 'from', 'each',
]);

/** 题干里代表「空格」的下划线不是词。 */
const WORD_RE = /[a-z0-9][a-z0-9'’-]*/g;

export function significantTokens(text: string): string[] {
  const out: string[] = [];
  for (const matched of text.toLowerCase().matchAll(WORD_RE)) {
    const word = matched[0];
    if (word.length < 4) continue;
    if (STOPWORDS.has(word)) continue;
    out.push(word);
  }
  return out;
}

/** 题面文本：判断题用 statement，其余用 prompt；heading_match 不用 options（会把人带偏）。 */
export function questionStemText(question: ReadingQuestionPublic): string {
  const withStatement = question as { statement?: string };
  const withPrompt = question as { prompt?: string };
  if (typeof withStatement.statement === 'string' && withStatement.statement.trim()) {
    return withStatement.statement;
  }
  return typeof withPrompt.prompt === 'string' ? withPrompt.prompt : '';
}

function paragraphTokenSet(paragraphs: readonly PassageParagraph[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const p of paragraphs) {
    const set = new Set<string>();
    for (const matched of p.text.toLowerCase().matchAll(WORD_RE)) {
      if (matched[0].length >= 4) set.add(matched[0]);
    }
    map.set(p.label, set);
  }
  return map;
}

export interface LocateResult {
  /** 命中的段落 label；null = 无法唯一定位（按钮应禁用）。 */
  label: string | null;
  /** 定位依据，用于 tooltip 文案，避免用户误以为是官方答案位置。 */
  basis: 'paragraph_label' | 'keyword' | 'none';
  /** 关键词命中数（keyword 依据时有意义）。 */
  matched: number;
}

export function locateParagraph(
  question: ReadingQuestionPublic,
  paragraphs: readonly PassageParagraph[],
): LocateResult {
  // 1) heading_match 自带段落（§10.1 要求每题有 prompt + options_headings，段落标签是题面字段）
  const own = (question as { paragraph_label?: string }).paragraph_label;
  if (own && paragraphs.some((p) => p.label === own)) {
    return { label: own, basis: 'paragraph_label', matched: 0 };
  }

  // 2) 题干实词匹配
  const tokens = new Set(significantTokens(questionStemText(question)));
  if (tokens.size === 0) return { label: null, basis: 'none', matched: 0 };

  const sets = paragraphTokenSet(paragraphs);
  let best: PassageParagraph | null = null;
  let bestScore = 0;
  let tieWith = 0;
  for (const p of paragraphs) {
    const set = sets.get(p.label);
    if (!set) continue;
    let score = 0;
    for (const t of tokens) if (set.has(t)) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = p;
      tieWith = 1;
    } else if (score === bestScore && score > 0) {
      tieWith += 1;
    }
  }

  if (!best || bestScore < 2 || tieWith > 1) return { label: null, basis: 'none', matched: bestScore };
  return { label: best.label, basis: 'keyword', matched: bestScore };
}

/** 按钮 tooltip：明确区分「题目自带」与「关键词推测」，不冒充官方定位。 */
export function locateTitleZh(result: LocateResult): string {
  if (result.basis === 'paragraph_label') return '题目指定的段落';
  if (result.basis === 'keyword') return `按题干实词推测（命中 ${result.matched} 个词）`;
  return '无法唯一定位，请通读全文';
}
