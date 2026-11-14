#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""复验仓库题库目录，剔除结构不合格的 set（bulk-gen.sh 归集后调用）。

为什么单独一个脚本：bulk-gen 把 generated 根的产物拷进仓库题库目录后，
必须再跑一次与 `validate_ielts_data.py` 完全相同的规则 —— 模型偶发输出
`target_band` 字符串 / id 带连字符，拷进仓库前拦住，否则污染 manifest
（manifest 只索引「能通过校验」的 id）。

用法：BULK_MODULE=speaking python _prune_bad_sets.py
环境：自动定位仓库根（本文件在 <repo>/scripts/e2e/ 下）。
"""
from __future__ import annotations

import json
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(_HERE))
BACKEND = os.path.join(REPO, "backend")
sys.path.insert(0, os.path.join(BACKEND, "tools"))
import validate_ielts_data as V  # noqa: E402

_CHECKERS = {
    "speaking": V.check_speaking,
    "listening": V.check_listening,
    "reading": V.check_reading,
    "writing": V.check_writing,
    "sparring": V.check_sparring,
}


def main() -> int:
    module = os.environ.get("BULK_MODULE", "speaking")
    module_dir = os.path.join(BACKEND, "app", "data", "ielts", module)
    checker = _CHECKERS[module]
    if not os.path.isdir(module_dir):
        print(f"复验跳过：目录不存在 {module_dir}")
        return 0

    removed = 0
    kept = 0
    for name in sorted(os.listdir(module_dir)):
        if not name.endswith(".json"):
            continue
        path = os.path.join(module_dir, name)
        try:
            obj = json.loads(open(path, "rb").read().decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            print(f"  剔除：{name} — 不是合法 UTF-8 JSON")
            os.remove(path)
            removed += 1
            continue
        rep = V.Report()
        where, _ = V.check_common(module, path, obj, rep)
        if not rep.errors:
            try:
                checker(where, obj, rep)
            except Exception:  # 结构异常本身就该被剔
                pass
        if rep.errors:
            print(f"  剔除：{name} — {rep.errors[0]}")
            os.remove(path)
            removed += 1
        else:
            kept += 1
    print(f"复验完成：保留 {kept}，剔除 {removed}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
