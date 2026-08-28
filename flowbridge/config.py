"""Nacitani konfigurace a cesty projektu."""

from __future__ import annotations

import os
import random
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = Path(os.environ.get("FLOWBRIDGE_CONFIG", ROOT / "config.yaml"))


@dataclass
class Config:
    raw: dict[str, Any] = field(default_factory=dict)

    # -- chrome ---------------------------------------------------------
    @property
    def debug_port(self) -> int:
        return int(self.raw.get("chrome", {}).get("debug_port", 9222))

    @property
    def chrome_profile(self) -> str:
        return self.raw.get("chrome", {}).get("profile", "real")

    # -- flow -----------------------------------------------------------
    @property
    def project_url(self) -> str:
        return self.raw.get("flow", {}).get("project_url", "") or ""

    @property
    def default_image_model(self) -> str:
        return self.raw.get("flow", {}).get("default_image_model", "Nano Banana 2")

    @property
    def default_video_model(self) -> str:
        return self.raw.get("flow", {}).get("default_video_model", "Veo 3.1 Fast")

    @property
    def default_aspect(self) -> str:
        return self.raw.get("flow", {}).get("default_aspect", "16:9")

    # -- limity ---------------------------------------------------------
    @property
    def max_images_per_batch(self) -> int:
        return int(self.raw.get("limits", {}).get("max_images_per_batch", 4))

    @property
    def max_concurrent_batches(self) -> int:
        return int(self.raw.get("limits", {}).get("max_concurrent_batches", 3))

    @property
    def max_concurrent_videos(self) -> int:
        return int(self.raw.get("limits", {}).get("max_concurrent_videos", 2))

    @property
    def min_seconds_between_submits(self) -> float:
        return float(self.raw.get("limits", {}).get("min_seconds_between_submits", 8))

    @property
    def batch_timeout_seconds(self) -> float:
        return float(self.raw.get("limits", {}).get("batch_timeout_seconds", 900))

    @property
    def max_attempts(self) -> int:
        return int(self.raw.get("limits", {}).get("max_attempts", 3))

    def jitter(self) -> float:
        lo, hi = self.raw.get("limits", {}).get("jitter_seconds", [2, 7])
        return random.uniform(float(lo), float(hi))

    # -- kredity --------------------------------------------------------
    @property
    def monthly_budget(self) -> int:
        return int(self.raw.get("credits", {}).get("monthly_budget", 1050))

    @property
    def credit_reserve(self) -> int:
        return int(self.raw.get("credits", {}).get("reserve", 50))

    @property
    def max_credits_per_job(self) -> int:
        return int(self.raw.get("credits", {}).get("max_per_job", 60))

    @property
    def reset_day(self) -> int:
        return int(self.raw.get("credits", {}).get("reset_day", 1))

    # -- cesty ----------------------------------------------------------
    @property
    def outputs_dir(self) -> Path:
        p = Path(self.raw.get("paths", {}).get("outputs", "outputs"))
        return p if p.is_absolute() else ROOT / p

    @property
    def db_path(self) -> Path:
        p = Path(self.raw.get("paths", {}).get("db", "flowbridge.db"))
        return p if p.is_absolute() else ROOT / p

    # -- server ---------------------------------------------------------
    @property
    def server_host(self) -> str:
        return self.raw.get("server", {}).get("host", "127.0.0.1")

    @property
    def server_port(self) -> int:
        return int(self.raw.get("server", {}).get("port", 8765))

    # -- zapis ----------------------------------------------------------
    def set_project_url(self, url: str) -> None:
        self.raw.setdefault("flow", {})["project_url"] = url
        save(self)


def load() -> Config:
    if CONFIG_PATH.exists():
        with CONFIG_PATH.open("r", encoding="utf-8") as fh:
            return Config(yaml.safe_load(fh) or {})
    return Config({})


def save(cfg: Config) -> None:
    with CONFIG_PATH.open("w", encoding="utf-8") as fh:
        yaml.safe_dump(cfg.raw, fh, allow_unicode=True, sort_keys=False)


CFG = load()
