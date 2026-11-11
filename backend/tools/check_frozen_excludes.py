"""核对冻结产物：excludes 的包**没被收集**、随包数据**在**（读 PyInstaller Analysis TOC）。

判据形态是这条脚本存在的全部理由。第一版用 `re.search(pkg, line)` 数「出现次数」，
结果 tkinter/PIL/matplotlib 各命中 1 次 —— 差点报成「excludes 没生效」。
那 1 次命中其实是 spec 里 `excludes=[...]` 列表自身被序列化进了 TOC 的 analysis 参数。
**被收集的模块条目**长这样：`('matplotlib.pyplot', 'D:\\...\\pyplot.py', 'SOURCE')`；
excludes 列表里的裸字符串不是收集。所以本脚本只认带路径的二元组形态，并顺手核对
sparring 数据文件确实在 datas 里。

用法：cd backend && python tools/check_frozen_excludes.py
退出码 0 = 全部符合预期；非 0 = 有 exclude 包被收集或有数据没随包。
"""
from __future__ import annotations

import pathlib
import re
import sys

EXCLUDED = (
    "tkinter",
    "PIL",
    "matplotlib",
    "PyQt5",
    "IPython",
    "pytest",
    # torch 可选依赖，实测零 import。**llvmlite 不在此列** ——
    # torch 运行时动态加载它做 JIT，排掉会让冻结包 STT 直接 503（实测踩过）。
    "scipy",
    "sklearn",
    "transformers",
)
EXPECTED_DATA = ("app/data/ielts/sparring", "app/data/dictionary.json", "app/db/schema.sql")

COLLECTED = re.compile(r"\(\s*['\"]([\w.]+)['\"]\s*,\s*['\"]([^'\"]+)['\"]\s*,\s*['\"]\w+['\"]\s*\)")


def main() -> int:
    cands = sorted(pathlib.Path("build").rglob("Analysis-*.toc"))
    if not cands:
        print("找不到 Analysis TOC（先跑 scripts/build.ps1）", file=sys.stderr)
        return 2
    toc = max(cands, key=lambda p: p.stat().st_mtime)
    text = toc.read_text(encoding="utf-8", errors="replace")
    print(f"TOC: {toc}")

    failures = 0
    collected = COLLECTED.findall(text)
    top_names = {name.split(".")[0] for name, _ in collected}
    for pkg in EXCLUDED:
        hits = sorted(n for n in top_names if n.lower() == pkg.lower())
        if hits:
            print(f"FAIL {pkg} 被收集进产物（excludes 失效）")
            failures += 1
        else:
            print(f"ok   {pkg} 未被收集（excludes 生效；TOC 里出现的裸名字只是 excludes 参数本身）")

    # datas 条目在 TOC 里是 ('src', 'dest') 形态；sparring 目录随包靠的是递归 datas
    datas_blob = text.replace("\\", "/")
    for needle in EXPECTED_DATA:
        # schema.sql 的 datas 目标是 'app/db'；数据文件按源路径或目标路径匹配都算在
        if needle in datas_blob or needle.split("/")[-1] in datas_blob:
            print(f"ok   随包数据可见：{needle}")
        else:
            print(f"FAIL 数据未随包：{needle}")
            failures += 1

    print("检查通过" if not failures else f"{failures} 项不符")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
