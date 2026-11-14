"""题库生成的 schema 提示词（契约 §17；CONSTITUTION §2 的硬约束在这里）。

**唯一真源**：`backend/tools/gen_ielts_bank.py`（CLI）与 `app/services/content_gen.py`
（端点）都 import 本文件。两处各存一份的结局必然是漂移——CLI 生成的题过了更严的校验、
端点生成的题却过不了装载（或反过来），而用户只看到「生成失败」四个字。

纪律：
- 本模块**纯字符串**，不 import app.config / app.db —— CLI 在离线机器上 `--dry-run`
  也要能用，不能把整个 app 的依赖链拖进来。
- LEGAL 段是 CONSTITUTION §2 的运行时执行：只对齐格式/题型/字数/时限/难度，文字全原创，
  且明令禁止产出里出现来源标记。产出侧还有第二道闸（`sets_loader._copyright_scan`），
  提示词不是唯一防线，但它是**最便宜的那道**。
"""
from __future__ import annotations

LEGAL = (
    "LEGAL RULE: produce 100% original text. Do not copy, close-paraphrase or imitate any passage, "
    "audio script, question or task from Cambridge IELTS books, official practice papers or real exam "
    "material. Match only the FORMAT, question types, word limits, timing and difficulty. Never write "
    "the words 'Cambridge IELTS', 'Official IELTS', 'authentic' or 剑桥雅思/真题 anywhere in the output. "
    "All statistics/datasets must be invented and labelled as invented for practice.\n"
)

OUTPUT_RULES = (
    "OUTPUT RULES: reply with ONE JSON object only, no prose, no markdown fences. "
    "All keys exactly as in the schema. Every user-facing explanation must be Simplified Chinese in a "
    "key ending with _zh; question stems and passages in English. "
    "Numbers must be plain digits so text-to-speech can read them.\n"
)

COMMON_HEADER = (
    'Common header fields every set object must carry: "id", "module", "kind": "practice", '
    '"target_band" (one of 5.0/5.5/6.0/6.5/7.0/7.5/8.0/8.5/9.0), "title_zh", "topic" '
    "(lowercase ascii slug), and nothing that identifies a real source. "
    'Do NOT emit "source" or "generated_at"; the pipeline adds them.\n'
    "ID RULE (hard): the <topic> segment may contain ONLY lowercase letters, digits and "
    "underscores — NO hyphens, NO spaces. Examples: sp_p2_creative_hobby_01 is valid; "
    "sp_p2_neighbourhood-change_01 is INVALID. target_band must be a JSON number "
    "(6.5), not a string (\"6.5\").\n"
)

SPEAK_SCHEMA = (
    "Speaking set schema (spec-contracts.md 2-S). id rule: sp_p1_<topic>_<nn> for a Part 1 topic set, "
    "sp_p2_<topic>_<nn> for a Part 2 cue-card set.\n"
    'Part 1 set: {"id","module":"speaking","kind":"practice","part":1,"target_band","title_zh",'
    '"topic","part1":[{"id":"q1","question"},{"id":"q2",...},{"id":"q3",...}],'
    '"fallback_questions":["...","..."],"examiner_voice":"en-GB-SoniaNeural"} - exactly 3 Part 1 '
    "questions of real IELTS small-talk style about one everyday topic, plus 2 fallback questions.\n"
    'Part 2 set: {"id","module":"speaking","kind":"practice","part":2,"target_band","title_zh",'
    '"topic","part2":{"cue_card":{"prompt","bullets":[3 strings],"preparation_sec":60,'
    '"speaking_sec":120}},"part3":[{"id":"q1","question","depends_on_part2":true} x3],'
    '"fallback_questions":[3 strings],"examiner_voice":"en-GB-SoniaNeural"} - one cue card with 3 bullet '
    "prompts, 3 Part 3 discussion questions that grow out of the card topic, and 3 fallback Part 3 questions "
    "used when no AI is available.\n"
)

LISTEN_SCHEMA = (
    "Listening set schema (2-L). id rule: li_s<section>_<topic>_<nn>, section 1-4.\n"
    '{"id","module":"listening","kind":"practice","section":1-4,"target_band","title_zh","topic",'
    '"instruction_zh","audio_text","audio_voice","sentences":[{"idx":0,"text","anchor_sec":0.0},...],'
    '"questions":[20 items]}\n'
    "Hard requirements: audio_text is 550-700 words of natural spoken English (a two-speaker conversation for "
    "sections 1/3, a monologue for 2/4) built by joining sentences[] with a single space; sentences[] has 25-45 "
    "items with idx 0,1,2... and anchor_sec computed at ~150 words per minute so it strictly increases; the "
    "transcript must NOT contain speaker labels, brackets, asterisks, underscores or non-ASCII letters, and "
    "timings must be spelled the way they are spoken. Write the answer words exactly as spoken so they appear "
    "verbatim in audio_text.\n"
    "questions: exactly 20, \"number\" 1..20, \"id\" q1..q20, each with \"type\" in "
    "gap_fill|multiple_choice|matching|map_diagram_label, a stem in \"prompt\" and a Chinese "
    "\"explanation_zh\" that quotes the audio sentence inside single quotes. Mix the types: at least 8 gap_fill "
    '(each with integer "word_limit" 1-3 and at least one "accepted_alternatives" spelling/number variant), '
    'at least 4 multiple_choice ("options": 3-4 strings each starting "A. ", "B. " and "answer": the '
    "letter), at least 3 matching (\"options_list\": 4-6 lettered options reusable across questions), at least "
    '2 map_diagram_label ("labels":["A","B","C",...], and the prompt must itself describe what each '
    "letter is, because there is no picture). Distractors must be mentioned in audio_text and rejected in "
    "explanation_zh.\n"
)

READING_SCHEMA = (
    "Reading set schema (2-R). id rule: re_p_<topic>_<nn> (p = one academic passage, 13 questions).\n"
    '{"id","module":"reading","kind":"practice","level":"upper-intermediate"|"advanced",'
    '"target_band","title","title_zh","topic","time_limit_sec":1200,"word_count","instruction_zh",'
    '"passage":{"paragraphs":[{"label":"A","text"},...5 to 8 paragraphs]},"questions":[13 items]}\n'
    "The passage is ONE original expository text of 800-950 words (word_count must equal the real count of "
    "whitespace-separated words over all paragraphs), IELTS Academic style: a topic in science, cities, "
    "history, technology or the environment, with invented researcher names and institutions, hedged claims, "
    'numbers and definitions. "word_count": integer, must be exact.\n'
    "questions: exactly 13, number 1..13, id q1..q13, each with a \"prompt\" or \"statement\", \"answer\", "
    '"answer_paragraph" (a paragraph label) and "answer_quote" that is a VERBATIM substring (exact case) of '
    'that paragraph\'s text, plus Chinese "explanation_zh". Mix: 5 true_false_notgiven ("statement", '
    '"answer": TRUE|FALSE|NOTGIVEN, "answer_label": A for TRUE, B for FALSE, C for NOTGIVEN - NOT GIVEN must '
    "be genuinely absent, not contradicted), 4 heading_match (\"paragraph_label\", \"options_headings\": 7 items "
    '{"i":"i","text":...} with 3 unused distractors, "answer": the roman numeral), 3 sentence_completion '
    '("word_limit" 1-3, "answer" must appear verbatim in the passage, "accepted_alternatives" list), '
    '1 multiple_choice (4 "options" starting "A. " .. "D. ", "answer": the letter).\n'
)

WRITING_SCHEMA = (
    "Writing task schema (2-W). id rule: wr_t1_<topic>_<nn> or wr_t2_<topic>_<nn>.\n"
    'Task 1: {"id","module":"writing","kind":"practice","task":"task1","target_band","title_zh",'
    '"topic","time_recommend_sec":1200,"min_words":150,"prompt","chart":{"type":"line"|"bar"|"pie"'
    '|"table"|"dynamic_chart","unit","labels":[...],"years":[ints],"series":[{"name","values"'
    ":[numbers of the same length as labels]}],\"source_note\"},\"band_descriptors_ref\":\"task1\"}. The prompt "
    "is the official-style English task wording ('The chart below shows ... Summarise the information by "
    "selecting and reporting the main features, and make comparisons where relevant.'). Invent realistic data "
    "(energy mix, migration, household spending, university enrolment, visitor numbers, commuting shares): "
    "for pie the values must sum to 100, for table labels are the columns and series are the rows, and "
    "source_note must say the data is invented for practice.\n"
    'Task 2: {"id","module":"writing","kind":"practice","task":"task2","target_band","title_zh",'
    '"topic","time_recommend_sec":2400,"min_words":250,"question_type","prompt","outline_hint"'
    ":[4-5 strings],\"band_descriptors_ref\":\"task2\"} with question_type in agree_disagree|discuss_both_views|"
    "advantages_disadvantages|problem_solution|two_part_question and an official-style English prompt of 25-60 "
    "words on a topic that no real exam has used in the same wording.\n"
)

SPARRING_SCHEMA = (
    "Sparring topic schema (spec-contracts.md 16.1). id rule: sb_<topic>_<nn>.\n"
    '{"id","module":"sparring","kind":"practice","target_band","title_zh","topic",'
    '"level":"a2"|"b1"|"b2","scenario_zh","opening","preset_questions":[8 strings],'
    '"max_turns":10,"partner_voice":"en-GB-SoniaNeural"}\n'
    'scenario_zh is one or two Simplified-Chinese sentences telling the learner who they play and where. '
    "opening is the partner's first English line: 10-35 words, it must end with a question mark and invite "
    "the learner to speak (never a narration). preset_questions are 6-10 standalone English follow-up "
    "questions the partner can fall back on offline; EACH must end with '?' and they must not repeat each "
    "other; they should move the scene forward (order -> clarify -> react -> wrap up). max_turns is an "
    "integer 8-12. Keep the register of a real stranger in that scene, not a teacher.\n"
)

SCHEMAS = {
    "speaking": SPEAK_SCHEMA,
    "listening": LISTEN_SCHEMA,
    "reading": READING_SCHEMA,
    "writing": WRITING_SCHEMA,
    "sparring": SPARRING_SCHEMA,
}

BANDS = (5.5, 6.5, 7.5)


def build_prompt(module: str, band: float, topic_hint, part=None, task=None) -> str:
    """组装一次生成请求的完整 user prompt（CLI 与端点共用，§17 防漂移）。"""
    topic = (
        "Topic area: %s. " % topic_hint
        if topic_hint
        else "Choose a topic that no other set in this bank uses; vary the subject field.\n"
    )
    extra = ""
    if module == "speaking":
        extra = "Generate a Part %s set. " % (part or 2)
    if module == "writing":
        extra = "Generate a Task %s. " % (task or "1")
    return (
        LEGAL + OUTPUT_RULES + COMMON_HEADER + SCHEMAS[module] + "\n"
        "TASK: %sTarget band %s (make the difficulty match that band; 7.5 sets need denser "
        "distractors and less signposted vocabulary). %sEmit only the JSON object."
        % (extra, band, topic)
    )
