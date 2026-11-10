"""连接复用行为（第 ④ 项优化）：线程级复用 + 归还语义。

要守住三条不变量：
1. 同线程内反复 connect() 拿到的是同一条连接（复用真的发生了）；
2. 调用方的 conn.close() 不会把连接关掉（否则下一个请求拿到死连接）；
3. 不同线程拿到不同连接（sqlite 连接不能跨线程）。
"""

from __future__ import annotations

import sqlite3
import threading

import pytest

from app.db import store


@pytest.fixture(autouse=True)
def _reset_pool():
    """每个用例前后都清空池：复用状态不能跨用例泄漏。"""
    yield
    store.release()


def test_同线程复用同一条连接():
    a = store.connect()
    b = store.connect()
    assert a is b, "同线程内 connect() 应复用同一条连接"


def test_close不真关连接():
    a = store.connect()
    a.close()
    # close 是「归还」语义：连接仍归池所有，下一个请求拿到的必须可用
    b = store.connect()
    assert b.execute("SELECT 1").fetchone()[0] == 1
    # 归还是守恒的：池里那条连接被 close 两次（用例前 + 这里）后才真正关闭
    assert b is a, "close 后应复用同一条连接（而不是重建）"


def test_连接确实还活着():
    a = store.connect()
    a.close()
    # 复用路径上连接必须仍可执行
    b = store.connect()
    assert b.execute("SELECT 1").fetchone()[0] == 1


def test_不同线程拿到不同连接():
    conns: list[sqlite3.Connection] = []
    barrier = threading.Barrier(3)

    def worker():
        barrier.wait()
        conns.append(store.connect())

    threads = [threading.Thread(target=worker) for _ in range(2)]
    for t in threads:
        t.start()
    barrier.wait()
    for t in threads:
        t.join()

    # 主线程 + 2 个子线程各自一条
    main_conn = store.connect()
    all_conns = conns + [main_conn]
    ids = {id(c) for c in all_conns}
    assert len(ids) == 3, "三个线程应各持一条连接"


def test_死连接会被重建(monkeypatch):
    a = store.connect()
    # 模拟连接已死：直接关掉底层连接对象
    sqlite3.Connection.close(a)
    # 下一次 connect 应探测到死亡并重建，而不是把坏连接交出去
    b = store.connect()
    assert b.execute("SELECT 1").fetchone()[0] == 1


def test_路径切换后丢弃旧连接(monkeypatch, tmp_path):
    """`IELTS_DB_PATH` 变了必须重建连接。

    这条守的是实测踩到的回归：常驻的批改 worker 线程跨用例存活，
    复用后它一直读写旧库，新任务永远停在 queued。
    """
    a = store.connect()
    old_path = a.db_path
    new_db = str(tmp_path / "switched.db")
    monkeypatch.setattr(store._cfg, "DB_PATH", new_db)
    b = store.connect()
    assert b is not a, "路径切换后不该复用旧连接"
    assert b.db_path == new_db
    assert b.execute("SELECT 1").fetchone()[0] == 1
    # 旧连接没被漏在池里
    assert getattr(store._local, "conn", None) is not a
    assert old_path != new_db


def test_release清空池但不误杀在用的连接():
    a = store.connect()          # 池 1 + 调用方 1 = 2
    store.release()              # 归还池那份 → 1（调用方仍在用，连接还活着）
    assert a.execute("SELECT 1").fetchone()[0] == 1
    # 池已清空：下一次 connect 必须给一条**新**连接，而不是把旧连接又发出来
    b = store.connect()
    assert b is not a, "release 之后池不该再发旧连接"
