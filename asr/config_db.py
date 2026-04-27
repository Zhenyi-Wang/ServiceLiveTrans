"""SQLite 配置存储"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "data" / "config.db"


def _get_conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS config (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    """)
    conn.commit()
    return conn


def init_defaults(defaults: dict) -> None:
    """首次启动时，将 defaults 中尚未存在的 key 写入 SQLite"""
    conn = _get_conn()
    for key, value in defaults.items():
        conn.execute(
            "INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)",
            (key, json.dumps(value)),
        )
    conn.commit()
    conn.close()


def get(key: str, default=None):
    conn = _get_conn()
    row = conn.execute("SELECT value FROM config WHERE key = ?", (key,)).fetchone()
    conn.close()
    if row is None:
        return default
    return json.loads(row[0])


def get_all() -> dict:
    conn = _get_conn()
    rows = conn.execute("SELECT key, value FROM config").fetchall()
    conn.close()
    return {key: json.loads(value) for key, value in rows}


def set(key: str, value) -> None:
    conn = _get_conn()
    conn.execute(
        "INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)",
        (key, json.dumps(value)),
    )
    conn.commit()
    conn.close()


def set_many(pairs: dict) -> None:
    conn = _get_conn()
    conn.executemany(
        "INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)",
        [(k, json.dumps(v)) for k, v in pairs.items()],
    )
    conn.commit()
    conn.close()
