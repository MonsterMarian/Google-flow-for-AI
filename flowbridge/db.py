"""SQLite fronta uloh.

Do stejne databaze sahaji tri procesy - worker, dashboard a MCP server -
proto WAL rezim a kratke transakce.
"""

from __future__ import annotations

import json
import sqlite3
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

from .config import CFG

SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
    id                TEXT PRIMARY KEY,
    kind              TEXT NOT NULL,              -- image | video
    prompt            TEXT NOT NULL,
    model             TEXT,
    count             INTEGER NOT NULL DEFAULT 1,
    aspect            TEXT,
    duration          INTEGER,                    -- jen video, v sekundach
    refs              TEXT NOT NULL DEFAULT '[]', -- JSON pole lokalnich cest k predloham
    tag               TEXT NOT NULL DEFAULT 'default',
    priority          INTEGER NOT NULL DEFAULT 100,
    not_before        REAL,                       -- unix cas; uloha se neodesle driv
    status            TEXT NOT NULL DEFAULT 'queued',
    attempts          INTEGER NOT NULL DEFAULT 0,
    credits_estimated INTEGER,
    credits_spent     INTEGER,
    flow_project_url  TEXT,
    output_dir        TEXT,
    result_files      TEXT NOT NULL DEFAULT '[]',
    error             TEXT,
    source            TEXT NOT NULL DEFAULT 'cli',
    created_at        REAL NOT NULL,
    started_at        REAL,
    finished_at       REAL
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, priority, created_at);

CREATE TABLE IF NOT EXISTS events (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    ts      REAL NOT NULL,
    job_id  TEXT,
    level   TEXT NOT NULL DEFAULT 'info',
    message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts DESC);

CREATE TABLE IF NOT EXISTS credit_ledger (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    ts      REAL NOT NULL,
    job_id  TEXT,
    amount  INTEGER NOT NULL,
    balance INTEGER,
    note    TEXT
);

CREATE TABLE IF NOT EXISTS state (
    key   TEXT PRIMARY KEY,
    value TEXT
);
"""

QUEUED = "queued"
RUNNING = "running"
DONE = "done"
FAILED = "failed"
CANCELLED = "cancelled"


def _connect() -> sqlite3.Connection:
    path: Path = CFG.db_path
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=30, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=30000")
    return conn


@contextmanager
def db() -> Iterator[sqlite3.Connection]:
    conn = _connect()
    try:
        yield conn
    finally:
        conn.close()


def init() -> None:
    with db() as conn:
        conn.executescript(SCHEMA)


def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    for key in ("refs", "result_files"):
        if key in d and isinstance(d[key], str):
            try:
                d[key] = json.loads(d[key])
            except json.JSONDecodeError:
                d[key] = []
    return d


# ---------------------------------------------------------------------------
# ulohy
# ---------------------------------------------------------------------------

def add_job(
    *,
    kind: str,
    prompt: str,
    model: str | None = None,
    count: int = 1,
    aspect: str | None = None,
    duration: int | None = None,
    refs: list[str] | None = None,
    tag: str = "default",
    priority: int = 100,
    not_before: float | None = None,
    flow_project_url: str | None = None,
    source: str = "cli",
) -> str:
    job_id = uuid.uuid4().hex[:12]
    with db() as conn:
        conn.execute(
            """INSERT INTO jobs (id, kind, prompt, model, count, aspect, duration, refs,
                                 tag, priority, not_before, flow_project_url, source, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (job_id, kind, prompt, model, count, aspect, duration,
             json.dumps(refs or []), tag, priority, not_before,
             flow_project_url, source, time.time()),
        )
    log(f"uloha pridana ({kind}, x{count}): {prompt[:70]}", job_id=job_id)
    return job_id


def get_job(job_id: str) -> dict[str, Any] | None:
    with db() as conn:
        row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    return _row_to_dict(row) if row else None


def list_jobs(status: str | None = None, tag: str | None = None,
              limit: int = 200) -> list[dict[str, Any]]:
    q = "SELECT * FROM jobs"
    where: list[str] = []
    args: list[Any] = []
    if status:
        where.append("status = ?")
        args.append(status)
    if tag:
        where.append("tag = ?")
        args.append(tag)
    if where:
        q += " WHERE " + " AND ".join(where)
    q += (" ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END,"
          " priority, created_at DESC LIMIT ?")
    args.append(limit)
    with db() as conn:
        return [_row_to_dict(r) for r in conn.execute(q, args)]


def claim_next(kind: str | None = None) -> dict[str, Any] | None:
    """Atomicky si vezme dalsi ulohu z fronty a oznaci ji jako bezici."""
    now = time.time()
    q = "SELECT * FROM jobs WHERE status = ? AND (not_before IS NULL OR not_before <= ?)"
    args: list[Any] = [QUEUED, now]
    if kind:
        q += " AND kind = ?"
        args.append(kind)
    q += " ORDER BY priority, created_at LIMIT 1"

    with db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            row = conn.execute(q, args).fetchone()
            if row is None:
                conn.execute("COMMIT")
                return None
            conn.execute(
                "UPDATE jobs SET status = ?, started_at = ?, attempts = attempts + 1 WHERE id = ?",
                (RUNNING, now, row["id"]),
            )
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise
    return _row_to_dict(row)


def update_job(job_id: str, **fields: Any) -> None:
    if not fields:
        return
    for key in ("refs", "result_files"):
        if key in fields and not isinstance(fields[key], str):
            fields[key] = json.dumps(fields[key])
    sets = ", ".join(f"{k} = ?" for k in fields)
    with db() as conn:
        conn.execute(f"UPDATE jobs SET {sets} WHERE id = ?", (*fields.values(), job_id))


def finish_job(job_id: str, *, files: list[str], credits_spent: int = 0,
               output_dir: str | None = None) -> None:
    update_job(job_id, status=DONE, finished_at=time.time(), result_files=files,
               credits_spent=credits_spent, output_dir=output_dir, error=None)


def fail_job(job_id: str, error: str, *, retry: bool = True) -> None:
    from .config import CFG as _cfg
    job = get_job(job_id)
    attempts = (job or {}).get("attempts", 0)
    if retry and attempts < _cfg.max_attempts:
        # zpet do fronty s odkladem, ktery roste s poctem pokusu
        update_job(job_id, status=QUEUED, error=error,
                   not_before=time.time() + 30 * attempts)
        log(f"chyba (pokus {attempts}/{_cfg.max_attempts}), vracim do fronty: {error}",
            job_id=job_id, level="warn")
    else:
        update_job(job_id, status=FAILED, error=error, finished_at=time.time())
        log(f"uloha selhala definitivne: {error}", job_id=job_id, level="error")


def cancel_job(job_id: str) -> bool:
    with db() as conn:
        cur = conn.execute(
            "UPDATE jobs SET status = ?, finished_at = ? WHERE id = ? AND status IN (?, ?)",
            (CANCELLED, time.time(), job_id, QUEUED, RUNNING),
        )
    return cur.rowcount > 0


def requeue_stale_running() -> int:
    """Po padu workeru zustanou ulohy viset ve stavu running - vratime je do fronty."""
    with db() as conn:
        cur = conn.execute(
            "UPDATE jobs SET status = ?, started_at = NULL WHERE status = ?",
            (QUEUED, RUNNING),
        )
    return cur.rowcount


def counts() -> dict[str, int]:
    with db() as conn:
        rows = conn.execute("SELECT status, COUNT(*) c FROM jobs GROUP BY status")
        return {r["status"]: r["c"] for r in rows}


# ---------------------------------------------------------------------------
# log a kredity
# ---------------------------------------------------------------------------

def log(message: str, *, job_id: str | None = None, level: str = "info") -> None:
    with db() as conn:
        conn.execute("INSERT INTO events (ts, job_id, level, message) VALUES (?,?,?,?)",
                     (time.time(), job_id, level, message))


def recent_events(limit: int = 80) -> list[dict[str, Any]]:
    with db() as conn:
        return [dict(r) for r in conn.execute(
            "SELECT * FROM events ORDER BY id DESC LIMIT ?", (limit,))]


def record_credits(amount: int, *, job_id: str | None = None,
                   balance: int | None = None, note: str = "") -> None:
    with db() as conn:
        conn.execute(
            "INSERT INTO credit_ledger (ts, job_id, amount, balance, note) VALUES (?,?,?,?,?)",
            (time.time(), job_id, amount, balance, note),
        )


def credits_spent_since(ts: float) -> int:
    with db() as conn:
        row = conn.execute(
            "SELECT COALESCE(SUM(amount), 0) s FROM credit_ledger WHERE ts >= ?", (ts,)
        ).fetchone()
    return int(row["s"])


def set_state(key: str, value: Any) -> None:
    with db() as conn:
        conn.execute("INSERT INTO state (key, value) VALUES (?,?) "
                     "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                     (key, json.dumps(value)))


def get_state(key: str, default: Any = None) -> Any:
    with db() as conn:
        row = conn.execute("SELECT value FROM state WHERE key = ?", (key,)).fetchone()
    if row is None:
        return default
    try:
        return json.loads(row["value"])
    except (json.JSONDecodeError, TypeError):
        return default
