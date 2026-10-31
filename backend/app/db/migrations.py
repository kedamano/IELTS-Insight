"""结构变更的有序迁移表（spec-contracts §14.2）。

为什么必须有这张表：`schema.sql` 全是 `CREATE TABLE IF NOT EXISTS`，对**新库**够用，
对**老库**什么都做不了 —— 老库里表早就存在，`IF NOT EXISTS` 直接跳过，新列永远加不上；
反过来往 `schema.sql` 里塞 `ALTER`，新库会因重复列报错。所以定死分工：

- 新库建表只认 `schema.sql`（**永远描述当前结构**，改结构时同步加列）；
- 老库增量只认本模块的 `MIGRATIONS`，库内版本存在 `PRAGMA user_version`。

两者因此有重叠：`schema.sql` 已经带上的列，迁移步骤对老库才需要真加。所以**每个 DDL 步骤
都要先查后改**（§14.4），否则新库首次升级必然撞 `duplicate column name`。

写新步骤的规则（照着 §14.2）：
1. `version` 是「这一步跑完后库所处的版本」，必须从 1 开始**连续**，顶到 `store.SCHEMA_VERSION`；
   把常量抬高一格却忘了加步骤 == 假装升级完成，`validate_chain` 会直接拒绝启动。
2. 步骤由 `apply_steps()` 放在**自己的事务**里执行（`BEGIN IMMEDIATE` … `COMMIT`），
   所以步骤内的 DDL 失败会整步回滚，`user_version` 保持原值。
   代价：步骤内**不许**用 `conn.executescript()` —— 它会先隐式 COMMIT，把事务撕开。
3. 步骤一旦上线就永远不能再改：已经跑过它的库里版本号已经写上了，重放不会发生，
   改了也没用。要修结构就再加一步。
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from typing import Callable, Sequence

DETAIL_FAILED = "学习库的结构升级没有完成，已回滚到升级前的状态，现有记录未受影响。请更新到最新版本后重试。"
DETAIL_NEWER = "本机学习库的结构版本比当前程序更新，无法按旧结构安全写入。请改用升级它的那个版本。"


class SchemaUpgradeError(RuntimeError):
    """「结构未就绪」：库版本与程序不匹配，或某一步迁移失败。

    `detail` 是给用户看的中文（契约 §14.2：不含文件路径、SQL 片段或异常 repr），
    `reason` 只进日志，供定位是哪一步炸的 —— 两者分开才不会把 SQL 漏到 API 响应里。
    """

    def __init__(self, detail: str, *, reason: str = "") -> None:
        super().__init__(detail)
        self.detail = detail
        self.reason = reason


@dataclass(frozen=True)
class Step:
    """一步结构变更。`apply` 只接收连接，不碰任何全局状态。"""

    version: int
    name: str
    apply: Callable[[sqlite3.Connection], None]


def _baseline(_: sqlite3.Connection) -> None:
    """v1 == `schema.sql` 建出来的结构本身，没有增量动作。

    存在的理由：版本化之前问世的库 `user_version` 是 0，而它的结构就是 v1。
    给它一个真步骤，老库和新库才能走同一条代码路径 —— 否则「特殊分支」迟早和迁移表走岔。
    """
    return None


def has_column(conn: sqlite3.Connection, table: str, column: str) -> bool:
    return any(row[1] == column for row in conn.execute(f"PRAGMA table_info({table})").fetchall())  # noqa: S608 - 表名来自本模块常量


def _add_attempt_deleted_at(conn: sqlite3.Connection) -> None:
    """v2：练习记录改为软删（§14.4）—— 删除只打标记，回收站要能把行认回来。

    先查列再 ALTER：`schema.sql` 里 `attempts` 已带 `deleted_at`，新库跑到这一步时列已经在了。
    """
    if not has_column(conn, "attempts", "deleted_at"):
        conn.execute("ALTER TABLE attempts ADD COLUMN deleted_at TEXT")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_attempts_deleted ON attempts(deleted_at)")


def _add_drafts_table(conn: sqlite3.Connection) -> None:
    """v3：草稿落库（§14.5）—— 作文正文从「只有一份 localStorage」变成学习库里有快照保护的一行。

    `IF NOT EXISTS` 不是抄风格：`schema.sql` 对新库已经建好这张表，而新库的 `user_version`
    从 0 起、整条链都要跑一遍，裸 `CREATE TABLE` 会正好撞在自己刚建出来的库上
    （§14.7 里 7d 那条索引教训的同一件事）。
    """
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS drafts(
          key TEXT PRIMARY KEY,
          module TEXT NOT NULL,
          ref TEXT,
          payload_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
        """
    )


MIGRATIONS: list[Step] = [
    Step(1, "基线：schema.sql 的当前结构", _baseline),
    Step(2, "练习记录软删：attempts.deleted_at + 索引", _add_attempt_deleted_at),
    Step(3, "草稿副本：drafts 表", _add_drafts_table),
]


def validate_chain(target: int) -> list[Step]:
    """校验迁移表与目标版本一致，返回按序排列的步骤。

    这里只校验不改库：结构对不上时宁可拒绝启动，也不要跑到一半发现缺步骤。
    """
    steps = list(MIGRATIONS)
    if not steps:
        raise SchemaUpgradeError(DETAIL_FAILED, reason="迁移表为空")
    expected = 1
    for step in steps:
        if step.version != expected:
            if expected == 1 and step.version > 1:
                reason = f"迁移表必须从版本 1 开始，实际第一步是 {step.version}"
            else:
                reason = f"迁移表在版本 {expected} 处跳号或乱序（遇到 {step.version}）"
            raise SchemaUpgradeError(DETAIL_FAILED, reason=reason)
        expected += 1
    top = steps[-1].version
    if top != target:
        reason = f"迁移表最高版本 {top}，但 SCHEMA_VERSION={target}"
        raise SchemaUpgradeError(DETAIL_FAILED, reason=reason)
    return steps


def pending_steps(current: int, target: int) -> Sequence[Step]:
    """返回库里还缺的步骤（`current` 为 0 表示版本化之前问世的库，即整条链都要跑）。"""
    steps = validate_chain(target)
    if current > target:
        return []
    return [step for step in steps if step.version > current]


def apply_steps(conn: sqlite3.Connection, steps: Sequence[Step]) -> list[int]:
    """按序执行步骤，每步一个事务，版本号与 DDL 同生共死。

    `conn.isolation_level = None` 是前提：默认（legacy）模式下 Python 不会为 DDL 开事务，
    `ALTER TABLE` 会当场提交，失败后库里就多出半截结构而版本号仍是旧值 —— §14.2 明令禁止的形态。
    """
    applied: list[int] = []
    for step in steps:
        conn.execute("BEGIN IMMEDIATE")
        try:
            step.apply(conn)
            conn.execute(f"PRAGMA user_version = {step.version}")  # noqa: S608 - 整数来自已校验的迁移表
        except BaseException as exc:  # noqa: BLE001 - 回滚后必须原样上抛，才能判定为「结构未就绪」
            conn.execute("ROLLBACK")
            raise SchemaUpgradeError(
                DETAIL_FAILED, reason=f"v{step.version}「{step.name}」失败：{type(exc).__name__}"
            ) from exc
        conn.execute("COMMIT")
        applied.append(step.version)
    return applied


def read_version(conn: sqlite3.Connection) -> int:
    return int(conn.execute("PRAGMA user_version").fetchone()[0])


def write_version(conn: sqlite3.Connection, version: int) -> None:
    conn.execute(f"PRAGMA user_version = {int(version)}")  # noqa: S608 - 整数来自已校验的迁移表
