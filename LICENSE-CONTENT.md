# 内容许可（本仓库的非代码部分）

代码部分适用 [MIT License](LICENSE)（版权人 `kedamano`，见仓库头部的 LICENSE 徽章）。
本文件说明**不属于「软件」**的那部分东西能不能拿走、怎么用。

## 1. 题库与界面截图 —— CC BY-NC 4.0

**范围**

- `backend/app/data/ielts/**` —— 52 套题（speaking 22 / listening 4 / reading 4 / writing 12 / sparring 10）的 JSON，含篇章、题干、选项、音频文本、图表数据、范文与中文解析。
- `docs/assets/screenshots/**` —— README 里的 5 张界面截图。

**你可以**

- 自己备考时使用、打印、摘抄；
- 复制、分发、改编（做自己的练习清单、给学生用都可以）；
- 在明确署名的前提下引用其中的题目片段。

**你不可以**

- 用于商业目的：打包进付费 App / 会员站 / 收费课程售卖，把题库本身当商品转卖，或用整份题库训练并商用输出；
- 移除署名或暗示这是官方材料。

**署名格式**：`IELTS Insight by kedamano`，附本仓库链接即可。

完整条款见 [CC BY-NC 4.0 许可条文](https://creativecommons.org/licenses/by-nc/4.0/legalcode.zh-hans)，通俗版见 [许可证说明页](https://creativecommons.org/licenses/by-nc/4.0/deed.zh-hans)。

**一个边界**：题型、字数、时限、评分标准与官方格式对齐，但每套题的 `source` 字段都记录为 `hand`（本项目自写），篇章与题干不含剑桥真题、官方样题或教材原文。所以这份许可只覆盖我们自己的文字，不覆盖任何官方材料 —— 你拿去做商用时，需要单独授权的也只有这些文字。

## 2. 第三方组件保留各自许可

| 组件 | 用途 | 许可 |
| --- | --- | --- |
| Sora / Manrope 字体 | 界面显示字体，本地打包 | SIL OFL 1.1（见 [frontend/src/assets/fonts/LICENSE.md](frontend/src/assets/fonts/LICENSE.md)） |
| edge-tts | 听力音频合成 | LGPL-3.0 |
| PyInstaller | 后端冻结打包 | GPL-2.0 附带 booting exception（冻结产物不受 GPL 约束） |
| openai-whisper / torch | 口语录音转写 | MIT / BSD-3-Clause |
| ECDICT（skywind3000/ECDICT） | `dictionary.json` 的词表与释义来源（见 §3 与 docs/specs/dictionary-provenance.md） | MIT |
| 任意 OpenAI 兼容端点 | 可选的 AI 批改 | 由使用者自备凭据，与本仓库许可无关 |

## 3. `dictionary.json` —— 来源已查清：整理自 ECDICT（MIT）

`backend/app/data/dictionary.json`（392 词条，IPA 音标 + 中文释义 + 难度分级）此前标注为「来源未留档」。
Wave 8 做了逐条交叉核对，**结论：词表 99.7%（391/392）出现在 ECDICT 中，中文释义全部能在
ECDICT 的 `translation`/`definition` 字段里找到逐字或同义改写对应，音标是人工从 ECDICT 的
键盘式注音规范化成 IPA 的**。核对判据、复跑命令与逐项数字见
[docs/specs/dictionary-provenance.md](docs/specs/dictionary-provenance.md)，重建脚本在
`backend/tools/rebuild_dictionary.py`。

- 上游：**ECDICT**（github.com/skywind3000/ECDICT），**MIT 许可** —— 允许再分发与商用，保留版权声明即可。
- 因此本文件第 1 节的 CC BY-NC 范围**不覆盖** `dictionary.json`：它的许可由 ECDICT 的 MIT 决定，
  复用时请一并保留 ECDICT 的 MIT 署名；本仓库对「音标规范化 + 难度分档」这层加工不另主张权利。
- 一处脏数据如实记录：`fitlife` 不在 ECDICT、内容全空，是采集时混入的词条。

## 4. 想商用怎么办

开 issue 说明用途，单独谈授权。代码部分本来就可商用（MIT），需要额外授权的只有题库文字内容。
