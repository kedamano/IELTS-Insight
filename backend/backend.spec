# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the IELTS Insight backend sidecar.

设计要点（T6）：
- 不逐个列举业务模块：用 collect_submodules('app') 把整个 `app` 包（config / main / api.* /
  services.* / models.* / db.* / prompts.*）全部收进 hiddenimports。这样 T2 把路由从
  services/__init__.py 拆到 app/api/*.py 之后【无需改本 spec】——新模块自动被打包。
- 数据：('app/data', 'app/data') 递归带上 `app/data/ielts/**` 题库与 `dictionary.json`，
  冻结后落在 `_MEIPASS/app/data`，与 pyinstaller_entry._data_root() 的约定一致。
- 产出 `backend.exe`；由 scripts/build.ps1 复制成 Tauri 需要的
  `binaries/backend-x86_64-pc-windows-msvc.exe`（文件名里的 target triple 交给脚本处理，
  不把架构写死进 spec）。
- excludes 只列经 grep 确认【全仓零 import】的重型可选依赖，降低体积；未对打包后运行做实测。
"""
import os
from PyInstaller.utils.hooks import collect_all, collect_submodules

# ---- 随包数据（递归含 app/data/ielts/**、dictionary.json）----
# app/db/schema.sql 必须单独列：建表 SQL 不是 .py，PyInstaller 不会随模块收集，
# 冻结后 `store.SCHEMA_PATH`（= _MEIPASS/app/db/schema.sql）会 FileNotFoundError 导致启动失败。
datas = [("app/data", "app/data"), ("app/db/schema.sql", "app/db")]
binaries = []

# ---- 隐藏依赖 ----
hiddenimports = [
    "uvicorn.logging",
    "uvicorn.loops.auto",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan.on",
    "fastapi",
    "pydantic",
    "pydantic_settings",
    "edge_tts",
    "openai",
    "whisper",
    "av",
    "python_multipart",
    "multipart",
]


def _scan_app_modules(root="app"):
    """把 app 包下每个 .py（含子包）转成点分模块名，全部塞进 hiddenimports。

    这样【不依赖 import 能否成功，也不依赖是否有 __init__.py】：
    - collect_submodules('app') 需要成功 import 每个子模块才列得全，且会在分析期
      触发 stt_service 之类的重依赖（whisper/torch）与副作用；
    - 路由正被拆分到 app/api/*.py（可能暂时缺 __init__.py）。
    因此改用纯文件系统扫描，稳定且廉价。__init__.py 记为包名本身。
    """
    mods = set()
    for dirpath, _dirs, files in os.walk(root):
        # 跳过 __pycache__ 与非法目录名
        if "__pycache__" in dirpath:
            continue
        for fn in files:
            if not fn.endswith(".py"):
                continue
            rel = os.path.join(dirpath, fn)
            parts = os.path.normpath(rel).split(os.sep)
            if parts[-1] == "__init__.py":
                parts = parts[:-1]
            else:
                parts[-1] = parts[-1][:-3]  # 去掉 .py
            if parts and parts[0] == root:
                mods.add(".".join(parts))
    return sorted(mods)


# 整个 app 包（含拆分后的 app.api.*）——用文件系统扫描兜底，保证路由拆分后无需改本 spec。
hiddenimports += _scan_app_modules("app")
try:
    hiddenimports += collect_submodules("app")
except Exception:
    pass

# ---- 需要额外收集数据/二进制/子模块的重型三方库 ----
for _pkg in ("av", "edge_tts", "whisper", "tiktoken"):
    try:
        _d, _b, _h = collect_all(_pkg)
        datas += _d
        binaries += _b
        hiddenimports += _h
    except Exception:
        pass

# whisper 运行时资源（mel 滤波器 / BPE 词表 / 文本归一化），缺失会导致打包后转录报错。
try:
    import whisper

    _whisper_dir = os.path.dirname(whisper.__file__)
    for _sub in ("assets", "normalizers"):
        _src = os.path.join(_whisper_dir, _sub)
        if os.path.isdir(_src):
            _dst = os.path.join("whisper", _sub)
            if (_src, _dst) not in datas:
                datas.append((_src, _dst))
except Exception:
    pass

# 去重 hiddenimports
hiddenimports = sorted(set(hiddenimports))

a = Analysis(
    ["pyinstaller_entry.py"],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    # 全仓 grep 确认这些库没有任何 import：
    excludes=[
        "tkinter",
        "matplotlib",
        "PIL",
        "PyQt5",
        "PySide2",
        "IPython",
        "notebook",
        "pytest",
    ],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
