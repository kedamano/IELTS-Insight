# 字体许可

本目录下的两个 woff2 子集随应用一起分发（离线可用，配合 CSP `font-src 'self' data:`）：

| 文件 | 字族 | 许可 | 来源 |
| --- | --- | --- | --- |
| `sora-latin.woff2` | Sora（`--font-display`：标题、数字） | SIL Open Font License 1.1 | Google Fonts |
| `manrope-latin.woff2` | Manrope（`--font-text`：正文） | SIL Open Font License 1.1 | Google Fonts |

两个子集只含拉丁字符与常用标点（见 `src/index.css` 里的 `unicode-range`），中文走系统字体
（`Segoe UI Variable` / `Microsoft YaHei`），不额外下载。

OFL 要求随字体分发许可原文且不得改名。再分发（含打包安装器）前，请从 Google Fonts 的对应字族页面
取上游 `OFL.txt` 放进本目录一并分发。
