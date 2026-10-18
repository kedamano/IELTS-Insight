/**
 * 「定位」段落推断的单测（AC-R2 的数据侧）。
 *
 * 核心不变量：题面没有 answer_paragraph（契约 §2-R + §10.1，后端 LEAK_KEYS 剔除），
 * 所以只允许两种依据 —— 题目自带的 paragraph_label，或题干实词的**唯一**命中；
 * 命中不唯一（并列）或命中太少时必须返回 null，让按钮禁用而不是猜。
 */
import { describe, expect, it } from 'vitest';
import type { PassageParagraph, ReadingQuestionPublic } from '../../types/ielts';
import { FIXTURE_READING_SET } from './testFixtures';
import { locateParagraph, locateTitleZh, questionStemText, significantTokens } from './locate';

const PARAGRAPHS = FIXTURE_READING_SET.passage.paragraphs;
const QUESTIONS = FIXTURE_READING_SET.questions;

function questionById(id: string): ReadingQuestionPublic {
  const found = QUESTIONS.find((item) => item.id === id);
  if (!found) throw new Error(`夹具缺少题目 ${id}`);
  return found;
}

describe('significantTokens / questionStemText', () => {
  it('丢掉停用词与短词，保留低频实词', () => {
    const tokens = significantTokens('The researchers study why birds sing over the tarmac');
    expect(tokens).toEqual(['birds', 'sing', 'tarmac']);
  });

  it('空格下划线不会被当成词', () => {
    expect(significantTokens('high notes ______ badly')).toEqual(['high', 'notes', 'badly']);
  });

  it('判断题取 statement，其余取 prompt', () => {
    expect(questionStemText(questionById('q1'))).toContain('traffic drone');
    expect(questionStemText(questionById('q10'))).toContain('hundred');
    // heading_match 的 prompt 在类型镜像里不存在（§10.1 缺口），运行时仍能读到
    expect(questionStemText(questionById('q6'))).toContain('paragraph B');
  });
});

describe('locateParagraph', () => {
  it('heading_match 用题目自带的 paragraph_label，不看文本', () => {
    for (const [id, label] of [['q6', 'B'], ['q7', 'C'], ['q8', 'E'], ['q9', 'D']] as const) {
      const result = locateParagraph(questionById(id), PARAGRAPHS);
      expect(result).toMatchObject({ label, basis: 'paragraph_label' });
    }
  });

  it('paragraph_label 指向不存在的段落时退回关键词匹配', () => {
    const q6 = questionById('q6') as Extract<ReadingQuestionPublic, { type: 'heading_match' }>;
    const orphan: ReadingQuestionPublic = { ...q6, paragraph_label: 'Z' };
    const result = locateParagraph(orphan, PARAGRAPHS);
    expect(result.label).not.toBe('Z');
    expect(result.basis).not.toBe('paragraph_label');
  });

  it('其余题型靠题干实词命中唯一段落（AC-R2 的定位数据）', () => {
    expect(locateParagraph(questionById('q1'), PARAGRAPHS)).toMatchObject({ label: 'A', basis: 'keyword' });
    expect(locateParagraph(questionById('q2'), PARAGRAPHS)).toMatchObject({ label: 'B', basis: 'keyword' });
    expect(locateParagraph(questionById('q5'), PARAGRAPHS)).toMatchObject({ label: 'D', basis: 'keyword' });
    expect(locateParagraph(questionById('q10'), PARAGRAPHS)).toMatchObject({ label: 'A', basis: 'keyword' });
  });

  it('题干没有原文实词时不猜（q4 的资金出处属于 NOT GIVEN 型题干）', () => {
    const result = locateParagraph(questionById('q4'), PARAGRAPHS);
    expect(result.label).toBeNull();
    expect(result.basis).toBe('none');
  });

  it('命中并列时返回 null，绝不给一个可能错的定位', () => {
    // 'higher' 与 'notes' 在 B、C 两段各出现一次 → 2:2 并列
    const ambiguous: ReadingQuestionPublic = {
      id: 'q_tie',
      type: 'gap_fill',
      number: 14,
      prompt: 'The higher notes.',
      word_limit: 1,
    };
    const result = locateParagraph(ambiguous, PARAGRAPHS);
    expect(result.label).toBeNull();
    expect(result.matched).toBe(2);
  });

  it('只命中 1 个词也不给定位（阈值 >=2）', () => {
    const weak: ReadingQuestionPublic = {
      id: 'q_weak',
      type: 'gap_fill',
      number: 15,
      prompt: 'urban',
      word_limit: 1,
    };
    expect(locateParagraph(weak, PARAGRAPHS).label).toBeNull();
  });

  it('空篇章不报错', () => {
    const empty: PassageParagraph[] = [];
    expect(locateParagraph(questionById('q1'), empty).label).toBeNull();
  });
});

describe('locateTitleZh', () => {
  it('三种依据各有一句人话，且不冒充官方定位', () => {
    expect(locateTitleZh({ label: 'B', basis: 'paragraph_label', matched: 0 })).toBe('题目指定的段落');
    expect(locateTitleZh({ label: 'A', basis: 'keyword', matched: 3 })).toContain('按题干实词推测');
    expect(locateTitleZh({ label: null, basis: 'none', matched: 0 })).toContain('无法唯一定位');
  });
});
