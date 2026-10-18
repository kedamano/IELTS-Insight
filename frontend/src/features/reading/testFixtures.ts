/**
 * 阅读测试夹具（仅测试用；真实题库在 `backend/app/data/ielts/reading/*.json`）。
 *
 * 形状严格照 `spec-contracts.md §2-R` + `§10.1`：
 * - 题面（GET 响应）**不含** `answer` / `accepted_alternatives` / `explanation_zh` /
 *   `answer_quote` / `answer_paragraph` / `answer_label`（后端 `strip_answers` 的 LEAK_KEYS 集合），
 *   所以夹具也不含 —— 「定位」只能用 `heading_match.paragraph_label` 或题干文本本身。
 * - attempt 响应（§3-OR）才带回答案与解析。
 *
 * 篇章段落刻意各含一个低频词（noise/spectrogram/kilohertz… 分布唯一），
 * 让「关键词定位」在测试里是确定性的。
 */
import type {
  ObjectiveReportItem,
  PassageParagraph,
  ReadingObjectiveReport,
  ReadingQuestionPublic,
  ReadingSet,
  ReadingSetMeta,
} from '../../types/ielts';
import type { ReadingSetView } from './readingDraft';

const PARAGRAPHS: PassageParagraph[] = [
  {
    label: 'A',
    text: 'Traffic hum is the most persistent form of urban noise. Unlike a single horn or siren, it never stops, and it is thickest at the low end of the sound spectrum, exactly where many small birds sing. Acoustic engineers call this blanket the traffic drone, and it masks song over distances of several hundred metres.',
  },
  {
    label: 'B',
    text: 'To measure the effect, researchers display each recording as a spectrogram, where pitch rises up the page and time runs across it. On these plots a town bird often sings at a higher kilohertz value than its countryside relative, an adjustment that costs energy because high notes carry badly.',
  },
  {
    label: 'C',
    text: 'Singing higher is not free. A male defending a territory must be heard by rivals, and low notes travel further, so the deepest singer usually wins the contest. Males that sacrifice depth for clarity lose territory and attract fewer mates.',
  },
  {
    label: 'D',
    text: 'Artificial illumination complicates the picture. Streetlight extends the hours in which a bird can forage, but it also confuses nocturnal migrants such as moth species that navigate by moonlight, and researchers are only beginning to separate the two effects.',
  },
  {
    label: 'E',
    text: 'Practical mitigation is possible. Covering old tarmac with a rubberised surface lowers tyre noise by two decibels, and planting a green corridor between road and park gives singers a quiet pocket. Neither measure replaces fewer cars, but both are cheap.',
  },
];

/**
 * §10.1 要求 `heading_match` 每题带 `prompt`（渲染前提），但 `types/ielts.ts` 的
 * `HeadingMatchQuestion` 镜像里没有这个字段（类型文件不归我改）。
 * 夹具用交叉类型承载，运行时读题干统一走 `questionStemText()`，不新增字段名。
 */
type HeadingQuestionWithPrompt = ReadingSet['questions'][number] & { prompt: string };

const QUESTIONS: (ReadingQuestionPublic | HeadingQuestionWithPrompt)[] = [
  {
    id: 'q1',
    type: 'true_false_notgiven',
    number: 1,
    statement: 'Urban traffic drone is strongest at the low end of the sound spectrum.',
  },
  {
    id: 'q2',
    type: 'true_false_notgiven',
    number: 2,
    statement: 'On a spectrogram, pitch is plotted vertically while time runs horizontally.',
  },
  {
    id: 'q3',
    type: 'true_false_notgiven',
    number: 3,
    statement: 'Town birds sing at a lower kilohertz value than countryside birds.',
  },
  {
    id: 'q4',
    type: 'true_false_notgiven',
    number: 4,
    statement: 'The researchers were paid for by a national research council.',
  },
  {
    id: 'q5',
    type: 'true_false_notgiven',
    number: 5,
    statement: 'Streetlight helps nocturnal migrants such as moth species to navigate.',
  },
  {
    id: 'q6',
    type: 'heading_match',
    number: 6,
    paragraph_label: 'B',
    prompt: 'Choose the correct heading for paragraph B from the list of headings below.',
    options_headings: [
      { i: 'i', text: 'Why the deepest singer wins' },
      { i: 'ii', text: 'Measuring the change in pitch' },
      { i: 'iii', text: 'Cheap ways to reduce noise' },
      { i: 'iv', text: 'Light as well as sound' },
    ],
  },
  {
    id: 'q7',
    type: 'heading_match',
    number: 7,
    paragraph_label: 'C',
    prompt: 'Choose the correct heading for paragraph C from the list of headings below.',
    options_headings: [
      { i: 'i', text: 'Why the deepest singer wins' },
      { i: 'ii', text: 'Measuring the change in pitch' },
      { i: 'iii', text: 'Cheap ways to reduce noise' },
      { i: 'iv', text: 'Light as well as sound' },
    ],
  },
  {
    id: 'q8',
    type: 'heading_match',
    number: 8,
    paragraph_label: 'E',
    prompt: 'Choose the correct heading for paragraph E from the list of headings below.',
    options_headings: [
      { i: 'i', text: 'Why the deepest singer wins' },
      { i: 'ii', text: 'Measuring the change in pitch' },
      { i: 'iii', text: 'Cheap ways to reduce noise' },
      { i: 'iv', text: 'Light as well as sound' },
    ],
  },
  {
    id: 'q9',
    type: 'heading_match',
    number: 9,
    paragraph_label: 'D',
    prompt: 'Choose the correct heading for paragraph D from the list of headings below.',
    options_headings: [
      { i: 'i', text: 'Why the deepest singer wins' },
      { i: 'ii', text: 'Measuring the change in pitch' },
      { i: 'iii', text: 'Cheap ways to reduce noise' },
      { i: 'iv', text: 'Light as well as sound' },
    ],
  },
  {
    id: 'q10',
    type: 'sentence_completion',
    number: 10,
    prompt: 'The traffic drone masks birdsong over distances of several hundred ______.',
    word_limit: 2,
  },
  {
    id: 'q11',
    type: 'sentence_completion',
    number: 11,
    prompt: 'Covering old road tarmac with a ______ surface reduces tyre noise.',
    word_limit: 2,
  },
  {
    id: 'q12',
    type: 'gap_fill',
    number: 12,
    prompt: 'The adjustment described in paragraph B costs energy because high notes ______ badly.',
    word_limit: 1,
  },
  {
    id: 'q13',
    type: 'multiple_choice',
    number: 13,
    prompt: 'What is the writer’s main point about mitigation measures?',
    options: [
      'A. They must replace private cars to work.',
      'B. They are inexpensive but limited.',
      'C. They should be banned.',
    ],
  },
];

/** 题面数组（喂给 `ReadingSet.questions`；heading 的 `prompt` 在类型上收敛掉）。 */
const FIXTURE_QUESTIONS: ReadingQuestionPublic[] = QUESTIONS.map(
  (question) => question as ReadingQuestionPublic,
);

/** `instruction_zh`（§10.1 的可选字段）由 `ReadingSetView` 承载；缺省时界面不显示。 */
export const FIXTURE_READING_SET: ReadingSetView = {
  id: 're_p_birdsong_01',
  module: 'reading',
  kind: 'practice',
  level: 'upper-intermediate',
  target_band: 6.5,
  title: 'Singing Louder: How City Noise Is Reshaping Birdsong',
  title_zh: '唱得更响：城市噪音如何改变鸟鸣',
  topic: 'environment',
  source: 'ai:test',
  generated_at: '2026-10-17T00:00:00Z',
  time_limit_sec: 1200,
  word_count: 300,
  instruction_zh: '阅读篇章，完成 1–13 题。第 1–5 题判断信息：TRUE 表示原文正面支持，FALSE 表示原文反驳，NOT GIVEN 表示原文未提及。',
  passage: { paragraphs: PARAGRAPHS },
  questions: FIXTURE_QUESTIONS,
};

/** 短集（2 题，10 分钟）：草稿恢复 + 手动提交路径。 */
export const FIXTURE_SHORT_SET: ReadingSetView = {
  ...FIXTURE_READING_SET,
  id: 're_p_shorttest_09',
  title_zh: '短集（草稿与提交）',
  time_limit_sec: 600,
  questions: [FIXTURE_QUESTIONS[0], FIXTURE_QUESTIONS[9]],
};

/** 到点自动提交集（AC-R3）：1 秒即过期，2 题只答 1 题，未答题按空串原样发送。 */
export const FIXTURE_TIMEOUT_SET: ReadingSetView = {
  ...FIXTURE_SHORT_SET,
  id: 're_p_timeouttest_08',
  title_zh: '到点自动提交集',
  time_limit_sec: 1,
};

export const FIXTURE_SET_METAS: ReadingSetMeta[] = [
  {
    id: FIXTURE_READING_SET.id,
    module: 'reading',
    kind: 'practice',
    level: FIXTURE_READING_SET.level,
    target_band: 6.5,
    title_zh: FIXTURE_READING_SET.title_zh,
    topic: 'environment',
    time_limit_sec: 1200,
    word_count: 300,
    question_count: 13,
  },
  {
    id: FIXTURE_SHORT_SET.id,
    module: 'reading',
    kind: 'practice',
    level: 'intermediate',
    target_band: 6,
    title_zh: FIXTURE_SHORT_SET.title_zh,
    topic: 'environment',
    time_limit_sec: FIXTURE_SHORT_SET.time_limit_sec,
    question_count: 2,
  },
  {
    id: FIXTURE_TIMEOUT_SET.id,
    module: 'reading',
    kind: 'practice',
    level: 'intermediate',
    target_band: 6,
    title_zh: FIXTURE_TIMEOUT_SET.title_zh,
    topic: 'environment',
    time_limit_sec: FIXTURE_TIMEOUT_SET.time_limit_sec,
    question_count: FIXTURE_TIMEOUT_SET.questions.length,
  },
];

/** 逐题报告（§3-OR）：覆盖 unanswered / over_word_limit / NOTGIVEN vs FALSE 三种展示分支。 */
const FIXTURE_ITEMS: ObjectiveReportItem[] = [
  {
    id: 'q1',
    number: 1,
    type: 'true_false_notgiven',
    your_answer: 'TRUE',
    expected: 'TRUE',
    correct: true,
    explanation_zh: '原文 A 段说明交通噪音在低频最厚。',
    answer_quote: 'it is thickest at the low end of the sound spectrum',
    answer_paragraph: 'A',
  },
  {
    id: 'q2',
    number: 2,
    type: 'true_false_notgiven',
    your_answer: 'TRUE',
    expected: 'TRUE',
    correct: true,
    explanation_zh: 'B 段 spectrogram 描述纵轴为音高、横轴为时间。',
    answer_quote: 'pitch rises up the page and time runs across it',
    answer_paragraph: 'B',
  },
  {
    id: 'q3',
    number: 3,
    type: 'true_false_notgiven',
    your_answer: 'NOTGIVEN',
    expected: 'FALSE',
    correct: false,
    reason: 'wrong',
    explanation_zh: '原文说城镇鸟类的 kilohertz 更高，因此该说法被原文反驳，而不是未提及。',
    answer_quote: 'sings at a higher kilohertz value than its countryside relative',
    answer_paragraph: 'B',
  },
  {
    id: 'q4',
    number: 4,
    type: 'true_false_notgiven',
    your_answer: 'FALSE',
    expected: 'NOTGIVEN',
    correct: false,
    reason: 'wrong',
    explanation_zh: '资金出处原文完全没有提到，只能选 NOT GIVEN；选 FALSE 是把它当成了原文反驳。',
    answer_quote: '',
    answer_paragraph: 'B',
  },
  {
    id: 'q5',
    number: 5,
    type: 'true_false_notgiven',
    your_answer: '',
    expected: 'FALSE',
    correct: false,
    reason: 'unanswered',
    explanation_zh: '路灯会误导夜行迁徙鸟类，原文反驳了「有帮助」。',
    answer_quote: 'it also confuses nocturnal migrants',
    answer_paragraph: 'D',
  },
  {
    id: 'q6',
    number: 6,
    type: 'heading_match',
    your_answer: 'ii',
    expected: 'ii',
    correct: true,
    explanation_zh: 'B 段讲用 spectrogram 测量音高变化。',
    answer_paragraph: 'B',
  },
  {
    id: 'q7',
    number: 7,
    type: 'heading_match',
    your_answer: 'i',
    expected: 'i',
    correct: true,
    explanation_zh: 'C 段讲最低音者赢得领地争夺。',
    answer_paragraph: 'C',
  },
  {
    id: 'q8',
    number: 8,
    type: 'heading_match',
    your_answer: 'iii',
    expected: 'iii',
    correct: true,
    explanation_zh: 'E 段讲廉价的降噪措施。',
    answer_paragraph: 'E',
  },
  {
    id: 'q9',
    number: 9,
    type: 'heading_match',
    your_answer: 'iv',
    expected: 'iv',
    correct: true,
    explanation_zh: 'D 段讲人造光的影响。',
    answer_paragraph: 'D',
  },
  {
    id: 'q10',
    number: 10,
    type: 'sentence_completion',
    your_answer: 'hundreds of metres extra',
    expected: 'metres',
    accepted_alternatives: [],
    correct: false,
    reason: 'over_word_limit',
    explanation_zh: '限 TWO WORDS AND/OR A NUMBER，答案超出字数上限。',
    answer_quote: 'over distances of several hundred metres',
    answer_paragraph: 'A',
  },
  {
    id: 'q11',
    number: 11,
    type: 'sentence_completion',
    your_answer: 'rubber',
    expected: 'rubberised',
    accepted_alternatives: ['a rubberised'],
    correct: false,
    reason: 'spelling_variant_rejected',
    explanation_zh: '原文用 rubberised，rubber 被判为变体不接受。',
    answer_quote: 'covering old tarmac with a rubberised surface',
    answer_paragraph: 'E',
  },
  {
    id: 'q12',
    number: 12,
    type: 'gap_fill',
    your_answer: 'carry',
    expected: 'carry',
    correct: true,
    explanation_zh: '高音传不远。',
    answer_paragraph: 'B',
  },
  {
    id: 'q13',
    number: 13,
    type: 'multiple_choice',
    your_answer: 'B',
    expected: 'B',
    correct: true,
    explanation_zh: '末段说两项措施都便宜但不能替代减少汽车。',
    answer_paragraph: 'E',
  },
];

export const FIXTURE_REPORT: ReadingObjectiveReport = {
  attempt_id: 'att_test_reading_01',
  module: 'reading',
  raw_correct: 8,
  raw_total: 13,
  band: 6,
  band_scale: 'reading_13q',
  ai_used: false,
  approximate: false,
  items: FIXTURE_ITEMS,
  by_question_type: {
    true_false_notgiven: { correct: 2, total: 5 },
    heading_match: { correct: 4, total: 4 },
    sentence_completion: { correct: 0, total: 2 },
    gap_fill: { correct: 1, total: 1 },
    multiple_choice: { correct: 1, total: 1 },
  },
  accuracy: 8 / 13,
  timed_out: false,
};
