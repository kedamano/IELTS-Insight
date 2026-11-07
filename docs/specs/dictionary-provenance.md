# dictionary.json 来源核对记录（Wave 8）

> 起因：README「已知限制」与 `LICENSE-CONTENT.md §3` 一直写着「392 词条的来源未在本仓库留档，
> 无法确认是自写还是从公开词典整理而来」。本文件把这件事**查清了**，判据可复跑。

## 结论

`backend/app/data/dictionary.json` 的词表与释义**与 ECDICT 高度一致**，判定为
「从 ECDICT（MIT 许可）整理而来，音标做过人工 IPA 规范化」，**不是**无源数据，
也**不需要**再挂着「来源未查清」的免责声明。

## 判据（可复跑）

```powershell
# 1) 取 ECDICT（MIT）：完整词表 CSV，66,009,548 字节
#    sha256 = d1ecbdf9ee2b920afb6f430ca6b6bb9f559588cf0dff86e04bd255f9390843cc
curl -L -o ecdict.csv https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv

# 2) 交叉核对
cd backend
python tools/rebuild_dictionary.py <ecdict.csv 路径> --check
```

2026-11-07 实跑输出：

| 指标 | 数值 | 解读 |
| --- | --- | --- |
| 现有词条出现在 ECDICT 中 | **391 / 392（99.7%）** | 词表几乎逐字取自 ECDICT（缺的 `fitlife` 是爬虫脏数据，见下） |
| 有中文释义的词条 | 231 | 其余 161 条是「音标+释义全空」的占位行（脚本按词表全量生成、只填了 231 条） |
| 释义逐字命中 ECDICT `translation`/`definition` | 170 / 231 | 直接摘录 |
| 未逐字命中的 61 条 | 全部为**同义改写/异体字** | 例：`account`→「账户」对 ECDICT「帐目」（账/帐异体）；`bill`→「账单」对「帐单」；`are`→「是」取自 ECDICT 的 `be的现在时复数` 说明 |
| 音标直接吻合 ECDICT `phonetic` 字段 | 25 / 231 | ECDICT 用键盘式注音（`ә'baut`），现有文件是 IPA（`/əˈbaʊt/`）——**这一步是人工规范化**，也是唯一比 ECDICT 更「加工」的部分 |

`fitlife`：不在 ECDICT、不在任何正常词表，`dictionary.json` 里它的音标与释义都是空 ——
是采集时混进的脏词条，与来源问题无关。

## 许可影响

- ECDICT 是 **MIT**（github.com/skywind3000/ECDICT），允许再分发与商用，保留版权声明即可。
- 因此 `dictionary.json` 的整理结果**可以**随包分发；`LICENSE-CONTENT.md §3` 从
  「不声明版权主张、请自行核对」改为记录上面的核对结论与 ECDICT 的 MIT 署名要求。
- 复现路径：`tools/rebuild_dictionary.py --rebuild` 可以从 ECDICT 直接重建一份**全字段可指回
  来源列**的版本（音标保留 ECDICT 原形、难度按 collins 星数 + BNC/FRQ 词频分档）。
  默认输出到 `backend/build/`，**不覆盖**现有文件 —— 现有 231 条 IPA 是人工规范过的，
  覆盖会把这份加工丢掉；要用可追溯版需显式指定 `--out` 并跑全量测试。

## 没有做的事（如实）

- 没有把 `dictionary.json` 重新生成一遍：核对的结论是「来源清楚」，不是「内容要换」。
  161 条空占位词条是质量问题（词条在、内容是空的），要不要清是另一笔账。
- ECDICT CSV 不进仓库（66MB），只留下载方式与校验和。
