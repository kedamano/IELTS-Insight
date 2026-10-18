# 内容许可（本仓库的非代码部分）

代码部分适用 [MIT License](LICENSE)（版权人 `kedamano`，见仓库头部的 LICENSE 徽章）。
本文件说明**不属于「软件」**的那部分东西能不能拿走、怎么用。

## 1. 题库与界面截图 —— CC BY-NC 4.0

**范围**

- `backend/app/data/ielts/**` —— 36 套题（speaking 18 / listening 4 / reading 4 / writing 10）的 JSON，含篇章、题干、选项、音频文本、图表数据、范文与中文解析。
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
| 任意 OpenAI 兼容端点 | 可选的 AI 批改 | 由使用者自备凭据，与本仓库许可无关 |

## 3. 一处尚未查清、所以不假装已解决

`backend/app/data/dictionary.json`（392 词条，IPA 音标 + 中文释义 + 难度分级）的**来源没有在本仓库留档**，无法确认是自写还是从公开词典整理而来。因此本文件**不声明对它的任何版权主张**，也不把它纳入上面的 CC BY-NC 范围。若你复用到发布包里，请先自行核对该词典数据的原始许可。

## 4. 想商用怎么办

开 issue 说明用途，单独谈授权。代码部分本来就可商用（MIT），需要额外授权的只有题库文字内容。
