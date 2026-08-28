"""Sdileny stav mezi procesy - pauza a zuctovaci mesic."""

from __future__ import annotations

import datetime as dt

from . import db
from .config import CFG

PAUSE_KEY = "paused"
HEARTBEAT_KEY = "worker_heartbeat"


def paused() -> bool:
    return bool(db.get_state(PAUSE_KEY, False))


def set_paused(value: bool) -> None:
    db.set_state(PAUSE_KEY, bool(value))


def month_start_ts() -> float:
    """Zacatek aktualniho zuctovaciho mesice podle config.credits.reset_day."""
    now = dt.datetime.now()
    day = min(CFG.reset_day, 28)
    start = now.replace(day=day, hour=0, minute=0, second=0, microsecond=0)
    if now < start:
        start = (start - dt.timedelta(days=31)).replace(day=day)
    return start.timestamp()
