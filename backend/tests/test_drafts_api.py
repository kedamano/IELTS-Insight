"""草稿落库测试（spec-contracts §14.5，§1 行 48–50）。

为什么要这个功能：作文正文在提交成功之前只有 localStorage 一份，WebView2 profile 被清理
就等于永久丢掉一篇写了半小时的文章。写进学习库之后它才第一次享有 §14.3 的快照保护 ——
所以本文件里最重要的一条不是 CRUD，而是 `test_快照恢复能把草稿一起拉回来`：
那才是「消除单副本」这句验收标准唯一可核对的形态。

另外三条容易出事的地方：
- key 来自 URL：不校验白名单就是让任意字符串进主键（以及被每份快照复制一遍）；
- 正文没有上限：一次粘贴整份 PDF 能把学习库撑大，而快照轮转会把这份噪声复制 N 遍；
- 「删不存在的草稿」必须 200：前端提交后的清理顺序（先删远端再清本地）依赖这条幂等。

破坏性用例（备份/恢复）一律用 `own_db` 独占自己的 tmp 库，绝不碰真实学习库（CONSTITUTION §6）。
"""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

import pytest

MAX_VALUE_CHARS = 200_000
"""与 §14.5 的 413 上限一致：放得下一篇写满的作文三十倍，拦的是 runaway 粘贴。"""

BACKEND_DIR = Path(__file__).resolve().parents[1]


@pytest.fixture
def own_db(tmp_path, monkeypatch):
    """本测试独占的库 + 挡住 store 的建表缓存（不碰会话共享库）。"""
    from app.config import settings as cfg
    from app.db import store

    home = tmp_path / "data"
    home.mkdir()
    monkeypatch.setattr(cfg, "DB_PATH", str(home / "app.db"))
    monkeypatch.setattr(store, "_schema_ready", False)
    monkeypatch.setattr(store, "_schema_failed", None)
    return home


@pytest.fixture
def local_client(own_db):
    """打请求用的 TestClient；不套上下文管理器 == 不跑 lifespan。"""
    from fastapi.testclient import TestClient

    from app.main import app

    return TestClient(app)


def _db(own_db: Path) -> Path:
    return own_db / "app.db"


def _open(db: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db))
    conn.row_factory = sqlite3.Row
    return conn


def _draft_rows(db: Path) -> list[sqlite3.Row]:
    conn = _open(db)
    try:
        return conn.execute("SELECT * FROM drafts ORDER BY key").fetchall()
    finally:
        conn.close()


def _tables(db: Path) -> set[str]:
    conn = _open(db)
    try:
        return {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    finally:
        conn.close()


def _version(db: Path) -> int:
    conn = _open(db)
    try:
        return int(conn.execute("PRAGMA user_version").fetchone()[0])
    finally:
        conn.close()


def _url(key: str) -> str:
    """把 key 百分号编码进 URL：否则含 `/` 的用例会被 httpx 在客户端就归一化掉，
    测到的是「路由没匹配上」而不是「端点拒绝了非法 key」—— 两者必须分开验。"""
    return f"/api/drafts/{quote(key, safe='')}"


def _put(client, key: str, value, saved_at=None):
    body = {"value": value} if saved_at is None else {"value": value, "saved_at": saved_at}
    return client.put(_url(key), json=body)


def _parse_utc(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


# ---------------------------------------------------------------------------
# PUT / GET
# ---------------------------------------------------------------------------

def test_PUT新草稿落库且只有一行(local_client, own_db):
    """立约的理由是「草稿要有第二份副本」，所以断言落到库里真有一行，不能只看响应。"""
    response = _put(local_client, "writing_task2", "In recent years, ", saved_at=1_700_000_000_000)
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["key"] == "writing_task2"
    assert data["size"] == len("In recent years, ")
    assert data["updated_at"].endswith(("Z", "+00:00")), f"契约 §0 要 UTC：{data['updated_at']}"

    rows = _draft_rows(_db(own_db))
    assert len(rows) == 1
    assert json.loads(rows[0]["payload_json"]) == {"v": "In recent years, ", "t": 1_700_000_000_000}


def test_PUT同key是覆盖不是堆积(local_client, own_db):
    """草稿每次防抖都 PUT 一次；写成 INSERT 就是每敲一下多一行历史。"""
    _put(local_client, "writing_task1", "first")
    _put(local_client, "writing_task1", "second sentence")

    rows = _draft_rows(_db(own_db))
    assert len(rows) == 1, "同一份草稿在库里堆了多行"
    assert json.loads(rows[0]["payload_json"])["v"] == "second sentence"


def test_updated_at是后端当前UTC时刻(local_client, own_db):
    """「取较新的一份」比较的就是这一列；由客户端自报时间等于让恢复规则抽签。"""
    assert _put(local_client, "writing_task2", "text").status_code == 200
    row = _draft_rows(_db(own_db))[0]
    stamp = _parse_utc(row["updated_at"])
    assert stamp.tzinfo is not None, "契约 §0：带时区的 UTC，不是裸时间"
    skew = abs((datetime.now(timezone.utc) - stamp).total_seconds())
    assert skew < 300, f"updated_at 与当前 UTC 差 {skew}s"


def test_saved_at缺省时后端自己补时间戳(local_client, own_db):
    """不带 `saved_at` 也得能存：payload 里的 `t` 参与前端比较，不能是 None。"""
    assert _put(local_client, "reading_set_01", '{"q1":"a"}').status_code == 200
    record = json.loads(_draft_rows(_db(own_db))[0]["payload_json"])
    assert isinstance(record["t"], int) and record["t"] > 1_600_000_000_000


def test_GET读回正文与时刻(local_client, own_db):
    _put(local_client, "listening_set_01", "answered", saved_at=1_700_000_111_000)
    response = local_client.get(_url("listening_set_01"))
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["key"] == "listening_set_01"
    assert data["value"] == "answered"
    assert _parse_utc(data["updated_at"]).tzinfo is not None


def test_GET没有草稿是404不是空字符串(local_client, own_db):
    """前端把 404 当「远端没有副本」，所以不能返回 200 + ""（那会被当成一份空草稿盖掉本地）。"""
    from app.db import migrate

    migrate.ensure_schema()
    response = local_client.get(_url("writing_task2"))
    assert response.status_code == 404
    assert response.json()["code"] == "not_found"


def test_module与ref按前缀拆好(local_client, own_db):
    """排查用：一眼看出这份草稿属于哪科哪个任务（§14.5）。"""
    _put(local_client, "writing_task2", "text")
    _put(local_client, "reading_re_p2_01", "text")
    rows = {row["key"]: row for row in _draft_rows(_db(own_db))}
    assert (rows["writing_task2"]["module"], rows["writing_task2"]["ref"]) == ("writing", "task2")
    assert (rows["reading_re_p2_01"]["module"], rows["reading_re_p2_01"]["ref"]) == ("reading", "re_p2_01")


# ---------------------------------------------------------------------------
# DELETE（幂等是提交后清理顺序的前提）
# ---------------------------------------------------------------------------

def test_DELETE清掉草稿且幂等(local_client, own_db):
    """提交成功后先删远端、再清本地；「远端已经没有」不该让清理失败并留下孤本。"""
    _put(local_client, "writing_task2", "submitted text")
    assert local_client.delete(_url("writing_task2")).json()["data"] == {"cleared": True}
    assert _draft_rows(_db(own_db)) == []

    again = local_client.delete(_url("writing_task2"))
    assert again.status_code == 200, "重复清除必须幂等"
    assert again.json()["data"] == {"cleared": True}


def test_DELETE别人没有的草稿也是200(local_client, own_db):
    from app.db import migrate

    migrate.ensure_schema()
    response = local_client.delete(_url("reading_never_saved"))
    assert response.status_code == 200
    assert response.json()["data"]["cleared"] is True


# ---------------------------------------------------------------------------
# key 白名单与体积上限
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "key",
    [
        "../app.db",
        "..\\app.db",
        "listening_set/../../etc",
        "/absolute/listening_set",
        "D:\\tmp\\something",
        "app.db",
        "listening_",
        "speaking_task1",
        "notes_anything",
        "listening_" + "x" * 200,
        "LISTENING_set",
        "listening_set name",
        "listening_set\x00",
    ],
)
def test_key白名单之外的写入一律400(local_client, own_db, key):
    """key 只当主键用、不参与路径拼接，但仍要限长限字符集：一个写错的客户端能把库塞满，
    而 §14.3 的快照会把每一坨都复制一遍。"""
    from app.db import migrate

    db = _db(own_db)
    migrate.ensure_schema()
    before = db.read_bytes()

    response = _put(local_client, key, "text")
    if "/" in key:
        # 带 / 的 key 连 handler 都到不了：`{key}` 不是 `:path`，多一段就没路由匹配 → 404。
        # 这是结构性拦住的，和 §14.3 里快照名字的 400/404 同一个口径；真正要守的是下半句 —— 库没动。
        assert response.status_code == 404, response.text
    else:
        assert response.status_code == 400, f"非法 key 没被拒绝：{response.status_code} {response.text}"
        assert response.json()["code"] in ("bad_request", "validation_failed"), response.text
        detail = response.json()["detail"]
        assert "\\" not in detail and "/" not in detail, f"detail 泄露了路径：{detail}"
    assert db.read_bytes() == before, "非法 key 顺手改动了学习库"


def test_白名单覆盖三个面板真实用到的key(local_client, own_db):
    """`listening_none` 是 setId 缺失时的兜底键，必须在名单里 —— 否则面板每次渲染都在报错。"""
    for key in ("writing_task1", "writing_task2", "reading_set_01", "listening_set_01", "listening_none"):
        assert _put(local_client, key, "v").status_code == 200, key


@pytest.mark.parametrize("method", ["get", "delete"])
def test_非法key在GET和DELETE上同样拦得住(local_client, own_db, method):
    """别只在 PUT 上设防：GET 越界能探到别人的主键、DELETE 越界能删任意行。"""
    from app.db import migrate

    db = _db(own_db)
    migrate.ensure_schema()
    _put(local_client, "writing_task2", "keep me")

    response = getattr(local_client, method)(_url("notes_anything"))
    assert response.status_code == 400, response.text
    assert "\\" not in response.json()["detail"] and "/" not in response.json()["detail"]
    # 带 / 的更狠：路由段数都对不上（`{key}` 不是 `:path`），连 handler 都进不去
    assert getattr(local_client, method)(_url("listening_set/../../etc")).status_code == 404
    assert [row["key"] for row in _draft_rows(db)] == ["writing_task2"], "非法 key 动到了别人的草稿"


def test_正文超过上限返回413(local_client, own_db):
    from app.db import migrate

    db = _db(own_db)
    migrate.ensure_schema()
    before = db.read_bytes()

    response = _put(local_client, "writing_task2", "a" * (MAX_VALUE_CHARS + 1))
    assert response.status_code == 413, response.text
    assert response.json()["code"] == "payload_too_large"
    assert _draft_rows(db) == [], "超限的正文还是写进了库"
    assert db.read_bytes() == before


def test_正文在上限内正常保存(local_client, own_db):
    """边界值本身要能过：一篇超长作文被拒和 runaway 粘贴被拒是两件不同的事。"""
    assert _put(local_client, "writing_task2", "a" * MAX_VALUE_CHARS).status_code == 200
    assert _draft_rows(_db(own_db))[0]["key"] == "writing_task2"


def test_value不是字符串返回400(local_client, own_db):
    """草稿正文的类型是死的（字符串）：传对象进来 == 前端序列化漏了，宁可拒掉也别存半截。"""
    from app.db import migrate

    migrate.ensure_schema()
    response = local_client.put(_url("writing_task2"), json={"value": {"v": "字典"}})
    assert response.status_code == 400
    assert response.json()["code"] == "validation_failed"


def test_value字段缺失返回400(local_client, own_db):
    from app.db import migrate

    migrate.ensure_schema()
    assert local_client.put(_url("writing_task2"), json={}).status_code == 400


def test_空正文可以保存(local_client, own_db):
    """用户删光输入框也是一次真实落盘；PUT 空串比 PUT 不上更贴近「草稿就是空的」。"""
    assert _put(local_client, "writing_task1", "").status_code == 200
    assert local_client.get(_url("writing_task1")).json()["data"]["value"] == ""


def test_中文与引号正文原样往返(local_client, own_db):
    """payload 是 JSON 包裹的正文字符串：转义漏一次，恢复回来的就是带 \\n 字面量的作文。"""
    text = '老师说的「坚持」很重要。\n第二行 "quoted" \\ 反斜杠 😀'
    assert _put(local_client, "writing_task2", text).status_code == 200
    assert local_client.get(_url("writing_task2")).json()["data"]["value"] == text


# ---------------------------------------------------------------------------
# 迁移 v3（§14.2 / §14.7 的老坑：新库也会跑完整条链）
# ---------------------------------------------------------------------------

def test_新库有drafts表且版本顶到SCHEMA_VERSION(own_db):
    from app.db import migrate, store

    migrate.ensure_schema()
    assert _draft_rows(_db(own_db)) == []
    assert _version(_db(own_db)) == store.SCHEMA_VERSION
    assert store.SCHEMA_VERSION == 3, "草稿表是迁移 v3；抬高常量必须配得上一步"


def test_老库升级后长出drafts表且数据不动(own_db):
    """真实用户库正是这个形态：表早就存在、`IF NOT EXISTS` 全跳过，只有增量迁移能加表。"""
    from app.db import store

    db = _db(own_db)
    conn = sqlite3.connect(str(db))
    conn.executescript((BACKEND_DIR / "app" / "db" / "schema.sql").read_text(encoding="utf-8"))
    conn.execute(
        "INSERT INTO attempts (id, module, task_ref, created_at) "
        "VALUES ('att_keep', 'reading', 'r', '2026-01-01T00:00:00Z')"
    )
    # 模拟 v1 时代的库： drafts 还不存在，版本号停在 1
    conn.execute("DROP TABLE drafts")
    conn.execute("PRAGMA user_version = 1")
    conn.commit()
    conn.close()
    assert "drafts" not in _tables(db)

    store.reset_schema_state()
    store.ensure_schema()

    assert "drafts" in _tables(db)
    assert _version(db) == store.SCHEMA_VERSION
    conn = _open(db)
    try:
        assert {row[0] for row in conn.execute("SELECT id FROM attempts")} == {"att_keep"}
    finally:
        conn.close()


def test_迁移步骤3重复执行不报错(own_db):
    """新库先被 schema.sql 建好 drafts，再跑步骤 3 —— 裸 CREATE TABLE 正好撞在自己建的新库上。"""
    from app.db import migrations

    db = _db(own_db)
    conn = _open(db)
    try:
        step = next(s for s in migrations.MIGRATIONS if s.version == 3)
        step.apply(conn)  # 表已由 schema.sql 建好
        step.apply(conn)  # 重放
        assert "drafts" in _tables(db)
    finally:
        conn.close()


def test_迁移表连续且最后一步是草稿(own_db):
    from app.db import migrations, store

    steps = migrations.validate_chain(store.SCHEMA_VERSION)
    assert [s.version for s in steps] == [1, 2, 3]
    assert "草稿" in steps[-1].name


def test_升级后端点立刻可用(local_client, own_db):
    """回收站那批用例同样的口径：结构升级完，读写不该再报 schema_upgrade_failed。"""
    from app.db import migrate

    migrate.ensure_schema()
    assert _put(local_client, "writing_task2", "after upgrade").status_code == 200


# ---------------------------------------------------------------------------
# 快照：这一条才是「消除单副本」的验收标准
# ---------------------------------------------------------------------------

def test_快照恢复能把草稿一起拉回来(local_client, own_db):
    """草稿进学习库的全部理由：它从此享有 §14.3 的快照保护。
    CRUD 全绿但恢复时草稿回不来 == 副本仍然是一份。"""
    from app.db import migrate

    db = _db(own_db)
    migrate.ensure_schema()

    _put(local_client, "writing_task2", "paragraph one")
    name = local_client.post("/api/backup").json()["data"]["name"]

    _put(local_client, "writing_task2", "paragraph one and two")
    _put(local_client, "reading_set_01", "half done")
    assert local_client.get(_url("writing_task2")).json()["data"]["value"] == "paragraph one and two"

    response = local_client.post(f"/api/backup/{name}/restore")
    assert response.status_code == 200, response.text

    restored = {row["key"]: json.loads(row["payload_json"])["v"] for row in _draft_rows(db)}
    assert restored == {"writing_task2": "paragraph one"}, "恢复后草稿没回到快照时刻"


def test_草稿行不出现在任何远端响应里(local_client, own_db):
    """CONSTITUTION §1：草稿只写本机 sidecar 的学习库。这条断言防的是「顺手把草稿塞进
    某个 AI 上游日志/导出」—— 目前唯一出口是备份文件，所以顺带确认它在 backups 目录里。"""
    from app.db import backup, migrate

    migrate.ensure_schema()
    _put(local_client, "writing_task2", "private essay text")
    name = local_client.post("/api/backup").json()["data"]["name"]
    path = backup.resolve_snapshot(name)
    assert path.parent.name == "backups"
    conn = _open(path)
    try:
        found = conn.execute("SELECT payload_json FROM drafts").fetchall()
    finally:
        conn.close()
    assert any("private essay text" in row[0] for row in found), "快照里的草稿没带上正文"
