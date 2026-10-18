# CONTENT NOTES — 雅思题库内容说明（T3 `content`）

配套 `spec-contracts.md §2`（内容 schema）、`spec-product.md`（FR-S1 / FR-L / FR-R / FR-W）、
`CONSTITUTION.md §2`（内容合法性）。本文件只记录**内容侧的取舍与自查方式**，不重复契约字段定义。

- 题库根目录：`backend/app/data/ielts/`（四个模块子目录 + 一个 `manifest.json` 索引）
- 工具：`backend/tools/validate_ielts_data.py`（独立校验器，仅标准库）、
  `backend/tools/gen_ielts_bank.py`（后续增量生成器，本批内容**未调用任何外部 AI**）
- 本轮全部条目 `"source": "hand"`、`"generated_at": "2026-10-17T12:00:00Z"`（人工撰写的时间戳，非脚本运行时间）

## 1. 首轮交付量（下限即测试断言值，见 `validate_ielts_data.py` 的 `FLOORS`）

| 模块 | 文件数 | 明细 | 下限 |
|---|---|---|---|
| speaking | 18 | Part 1 话题 set 12（每 set 3 问）· Part 2 题卡 set 6（每张 3 bullets + 60s/120s + 3 追问 + 3 兜底） | 12 / 6 |
| listening | 2 | 每 set 20 题（gap_fill 9+8、MC 5+6、matching 3+3、map 3+3），audio_text 691 / 607 词 | 2 set × 20 题 |
| reading | 2 | 每 set 1 篇原创篇章（877 / 896 词，6 / 7 段 A–F/G）+ 13 题（TFNG 5 + heading 4 + 完成句子 3 + 选择 1） | 2 set × 13 题 |
| writing | 10 | Task 1 共 5（line / bar / pie / table / dynamic_chart 各 1）· Task 2 共 5（5 种 question_type 各 1） | 3 + 3 |
| 合计 | 32 | `manifest.json` 按模块列出全部 set id | – |

口语 `target_band` 覆盖：Part 1 为 5.5×4 / 6.5×4 / 7.5×4，Part 2 为 5.5×2 / 6.5×2 / 7.5×2
（校验器硬性要求 5.5、6.5、7.5 三档都出现，避免全部堆在同一档）。

## 2. 原创性（CONSTITUTION §2）怎么保证的

1. **只对齐"形式"，不复用"文本"**：题型、题量、字数上限、时限、段落编号方式全部照官方（Part 1/2/3、
   2 section × 10 题、13 题 800–950 词、Task 1 150 词 / Task 2 250 词），但篇章、录音脚本、题干、选项
   全部由本 agent 现写。主题刻意选官方教材里不常见的组合：城市噪音与鸟鸣、垂直农业、休闲中心报名 +
   河畔公园改造、海岸考察 + 城市蜜蜂讲座、欧洲电源结构、场馆人次、通勤构成、学部注册占比、五地区人口。
2. **人物与机构一律虚构**：`Hana Novak / Baltic Field Laboratory`、`Rita Shah / city parks team`、
   `Emma Whitfield / Dan / Port Kestrel / Riverside Leisure Centre` 都是为篇章服务而编的名字与地点，
   篇章里的数字（2 千赫、12 个公园、95% 回用、10–12 kWh/kg）是为练习构造的数据，
   因此**不可被当作事实引用**——写作 Task 1 的每张图表都带 `"source_note": "Data invented for practice…"`。
   对不确定的科学结论一律用 hedge（`suggested`、`the most plausible cost is…`、`seems to`）。
3. **机器可查的来源守卫**：校验器对全部题库文本扫描禁用词
   `cambridge ielts / official ielts / ielts authentic / cambridge grammar / real exam material / 剑桥雅思 /
   官方真题 / 真题还原`，命中即报错退出非 0；出现 `cambridge / 剑桥` 单独一词时给警告要求人工确认它只是地名。
   `gen_ielts_bank.py` 在写盘**之前**对模型输出跑同一套守卫，命中直接拒绝入库。
4. Band descriptors 只在 `band_descriptors_ref` 里以 `task1/task2` 引用维度名，未搬运官方 PDF 原文。

## 3. 听力时间轴（`anchor_sec`）的口径

- `sentences[]` 是**唯一真源**：`audio_text` 就是各句文本用单个空格连接的结果（校验器逐句检查每句都是
  `audio_text` 的子串，避免两者漂移）。
- `anchor_sec = 该句之前累计词数 ÷ 150 wpm × 60`，即**估算值**，不是真实音频时长（音频由 edge-tts 在运行期
  合成，句间静音、语速 `tts_speed` 都会改变实际时刻）。校验器只要求 `idx` 连续、`anchor_sec` **严格单调递增**。
- **UI 应按 `sentences[].idx` 逐句重听**（FR-L4），把 `anchor_sec` 只当"大约在第几秒"的辅助/进度条粗定位；
  不要用它做精确 seek，否则倍速或换嗓音后就会错位。
- TTS 可读性约定：不写说话人标签（`Dan:` 这类会被读出来）、不用括号/星号/下划线/省略号、
  非 ASCII 变音符号（`café` 写成 `cafe`）；时间用口语写法（`a quarter past seven`），
  需要填数字的答案用**可朗读的数字**写法（`65 pounds`、`45 metres`、`until 9 in the evening`）。

## 4. 判分相关的约定（给 T8 评分引擎 / T1 测试）

- **填空答案的可接受性方向**：每条 gap_fill 保证「`answer` 或至少一个 `accepted_alternatives` 变体」
  在 `audio_text` 中出现（校验器按此规则检查，因为原文可能写口语形式而答案写数字形式，
  例：原文 `a quarter past eight` → 答案 `8.15`，变体含 `a quarter past eight`）。
  反向不成立：变体允许是原文里没有的同义拼写（`bare soil`、`colors` 的英美拼写）。
- `word_limit` 是**每题**的硬上限（听力 8 或 9 个 gap_fill 每题都有；阅读 sentence_completion 同样带
  `word_limit` + `accepted_alternatives`），超出即 `over_word_limit`。
- 阅读每题都带 `answer_paragraph` + `answer_quote`，且 `answer_quote` 是所指段落文本的**逐字子串**
  （大小写敏感，校验器强约束）。因此 `answer_quote` 可直接用于 AC-R4 的"定位 + 原文引用"高亮，
  不需要再做模糊匹配。
- 阅读 `answer` 与 `answer_label` 的映射固定为 TRUE→A、FALSE→B、NOTGIVEN→C（校验器双向检查）。
- NOTGIVEN 条目刻意写成"文中确实没提"（如研究经费来源、那本书的销量），而不是"文中反驳"，
  这是 FR-R4 要求区分的两类。
- `matching` / `map_diagram_label` 的选项在**同组内可重复使用**（FR-R4/AC-L2），
  所以每题各自携带完整的 `options_list` / `labels`（见下节关于无图说明）。
- 题面接口必须剔除 `answer` / `accepted_alternatives` / `explanation_zh`（§2-L），这三类字段在文件里齐全，
  剔除是后端责任，内容侧不会另存"干净版"。

## 5. 契约里含糊/无法照字面满足的地方（内容侧的选择，建议主控定稿）

1. **口语 set 的粒度**：§2-S 示例把 `part1` + `part2` + `part3` 放在同一个对象里，而 FR-S1 的下限按
   "Part 1 40 话题 / Part 2 20 题卡"分别计数，`CONTENT_FLOORS` 也无法用"一个 set 含两部分"来表达 12+6。
   本批按**一类一文件**交付，并额外加了契约里没有的整数字段 **`part: 1|2`** 用于分组
   （Part 1 文件只有 `part1` + `fallback_questions`；Part 2 文件有 `part2.cue_card` + `part3` +
   `fallback_questions`，不含 `part1`）。请把它写进 §2-S，否则 loader 与 TS 类型各猜一份。
2. **`module_abbr` 与示例 id 冲突**：§2 规则说 abbr ∈ {sp, li, re, wr}，但同一节的示例是
   `w1_line_energy_04`、阅读示例 `re_h_urban_02` 的 `h` 无定义。内容侧按**规则**而非示例命名：
   `wr_t1_energy_01` / `wr_t2_remotework_01`、阅读 `re_p_birdsong_01`（`p` = 1 篇 + 13 题的 practice）。
   若测试用 `^w1_` 正则，请改成 `^wr_`（校验器的正则在 `ID_RES` 里，可同步）。
3. **听力 `section` 与 20 题**：§2-L 的 `"section": 2` 暗示一个 set 就是一节（10 题），
   而 §3-B 的 band 换算锚点是 20 题制（AC-L5：16/20→7.0）。本批每个 set 装 **2 节 × 10 题 = 20 题**
   （题号连续 1–20），顶层 `section` 取该 set 的主导节型（`li_s1_leisure_01` 第 1 节对话 + 第 2 节独白，
   `li_s3_fieldtrip_02` 第 3 节讨论 + 第 4 节讲座）。建议 §2-L 增加可选 `sections_covered: [1,2]` 或直接允许
   `section` 为数组，避免"20 题却只有一个 section 号"的语义别扭。
4. **无图听力（`map_diagram_label`）**：音频来自 TTS、图表不入库（CONSTITUTION §8 禁外部图片 URL），
   所以平面图**图例写进每题的 `prompt`**（`On the park plan, A is the old boathouse, B is the north lawn…`），
   录音只用语言描述方位与地标。这是"读图标注"的可行替代，但它不能训练视觉定位；
   若将来要真图，需另立 `diagram` 字段 + 本地 SVG，不能靠外链。
5. **`heading_match` 需要题干**：§2-R 示例里 heading_match 只有 `paragraph_label`，但"每题必须有可渲染的题干"
   是所有题型共同的渲染前提，因此每题补了
   `prompt: "Choose the correct heading for paragraph B from the list of headings below."`。
6. **额外字段**（契约未列、内容侧新增，均为可选、additive）：口语 `part`；听力 `audio_voice`
   （建议的 edge-tts 嗓音，端点 15 的 `?accent=` 仍可覆盖）；阅读 `instruction_zh`（与听力同名的中文作答说明）；
   写作 `chart.labels` 与 `chart.years` 同时给出（AC-W1 列了 series/labels/unit/years 四项，
   饼图/柱状图的 `years` 用单元素/双元素列表表达"数据年份"；bar 的两个 series 各代表一个年份，
   dynamic_chart 的 labels/years 是动画时间轴）。
   如果 loader 用 `additionalProperties: false` 之类严格校验，请把这六项写进 §2 或放宽。
7. **`manifest.json` 不是 set**：它位于 `data/ielts/` 根目录（模块子目录之外），带
   `"schema": "ielts-manifest/1"` 与 `"note"`。`sets_loader` 应按 `<module>/*.json` 装载并**跳过根目录文件**，
   否则会因为缺少 `id`/`module` 头而报错。重建命令：
   `python tools/validate_ielts_data.py --write-manifest`（manifest 的 `generated_at` 是**工具运行时刻**，
   与 set 文件里的内容撰写时刻无关，重建会随之变化）。

## 6. 自查方式（可复跑）

```bash
cd backend
python tools/validate_ielts_data.py            # 32 个 set，0 错误 0 警告
python tools/validate_ielts_data.py --data-dir <tmp>   # 测试可指向临时副本
```

校验项（任一不满足即非 0 退出并打印中文原因）：JSON 可解析、UTF-8、LF、2 空格缩进、文件名 = id、
公共头 8 字段与 id 正则、题型/level/chart.type/question_type 枚举、band 取值 0.5 步长、
题号连续且题目 id 组内唯一、`answer` 非空、听力 audio_text 550–700 词且逐句单调锚点、
gap_fill 有 `word_limit` 与 ≥1 个变体且答案（或变体）出现在 audio_text 中、
阅读篇章 800–950 词且 `word_count` 与实际词数（按空白分词，连字符词算 1 个词）完全一致、
`answer_quote` 是所指段落的逐字子串、图表 series 与 labels 等长且 values 全为数字、
pie 合计 100、Task1/Task2 的 `min_words`/`time_recommend_sec`、以及上面第 2 节的来源守卫与首轮下限。

**校验器本身经过反向验证**（往临时副本注入 15 类缺陷：word_count 造假、answer_quote 非原文、
答案不在录音里、`word_limit` 为 null、题目 id 重复、anchor 不单调、speaking_sec 改成 90、
pie 合计 90、question_type 非法、min_words 200、删除一个 Part 1 话题、manifest 失配等），
全部被逐条报出并以 exit=1 结束；未出现"改坏了却仍绿"的情况。

`gen_ielts_bank.py` 同样跑过离线自证（不联网、不需要 key）：
`--dry-run` 只打印提示词；`--mock <file>` 用文件冒充模型输出，走同一条
「校验 → 不合格拒绝写盘 / 合格才写盘 → 刷新 manifest」链路；
对 `source: "hand"` 的同 id 文件即使加 `--force` 也拒绝覆盖；`source: "ai:*"` 的同 id 文件可幂等重写。
API key 只从 `OPENAI_API_KEY` 读取，异常文本经 `mask()` 脱敏，日志与返回值都不含 key。

## 7. 距目标量的欠账（"只增不减"的补货清单）

| 项目 | 目标（FR-S1 / tasks.md T3） | 已交 | 欠账 | 备注 |
|---|---|---|---|---|
| Part 1 话题 | 40 | 12 | 28 | 建议补：music, films, gardening, neighbours, birds/pets, birthday, fishing, photography, flowers/plants, museums, history of your area, weekend, reading, coffee/tea, maps/directions, humour, handwriting, jokes, queues, rainy days, public gardens, libraries, bicycles, handwriting… 每档 band 再均分 |
| Part 2 题卡 | 20 | 6 | 14 | 缺"物体 + 地点 + 人物 + 经历 + 媒体"五类的均衡覆盖；建议再加：a rule you dislike, a law/policy change, an online course, a skill you teach others, a trip by public transport, a building you like, a traditional product, a time you were late, a decision you made, a bookshop, a museum visit, an old person you admire, a photo you took, a garden/field |
| 听力 set | 6 | 2 | 4 | 目标配比：section 1 对话 ×2、section 2 独白 ×2、section 3 讨论 ×1、section 4 讲座 ×1；每 set 仍需 550–700 词、20 题、四题型齐全；accent 交替 en-GB / en-US |
| 阅读 set | 6 | 2 | 4 | 需要 1–2 篇偏"社科/历史"、1 篇偏"实验说明"、1 篇偏"技术评估"；每篇仍要 800–950 词 + 13 题 + 逐字 quote |
| 写作 Task 1 | 10 | 5 | 5 | 五种 chart.type 已各 1，补齐时**轮换数据形态**（多系列 line、堆叠 bar、双饼、含百分比的 table、双流 dynamic_chart），避免同一形状刷 10 张 |
| 写作 Task 2 | 10 | 5 | 5 | 5 种 question_type 已各 1，补齐时同型别再来 1 题（共 2 题/型），话题避开本批 5 个 |

补齐建议：用 `gen_ielts_bank.py --module <m> --count <n>`（需 key）批量出候选，
再由人工按本文件 §2 的规则校准后把 `source` 从 `ai:<model>` 改成 `hand`；
每次补货后跑 `python tools/validate_ielts_data.py --write-manifest` 保持索引与内容一致。
`CONTENT_FLOORS` 只允许上调，任何一次补货都不应把已交条目删掉。
