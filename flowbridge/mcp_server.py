"""MCP server - rozhrani pro AI agenty (Claude Code, Antigravity, ...).

Server sam do prohlizece nesaha. Jen zapisuje ulohy do fronty a cte jejich
stav; odesilani do Flow ma na starosti worker. Diky tomu muze bezet kolik
agentu chce a nic si nepolezou do zeli.
"""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path
from typing import Any

try:  # MCP SDK 2.x
    from mcp.server.mcpserver import MCPServer as _Server
except ImportError:  # starsi SDK 1.x
    from mcp.server.fastmcp import FastMCP as _Server  # type: ignore[attr-defined,no-redef,assignment]

from . import db
from .config import CFG

server = _Server(
    "flowbridge",
    instructions=(
        "Fronta promptů pro Google Flow. Úlohy se jen zařadí; odesílá je worker, "
        "který drží limity Flow (max 4 obrázky na dávku, 3 dávky současně) a hlídá "
        "rozpočet kreditů. Obrázky jsou zdarma, videa stojí kredity."
    ),
)

MAX_IMAGES_AT_ONCE = 12  # 3 davky po 4 = strop, ktery Flow spolehlive unese


def _ts(value: float | None) -> str | None:
    return dt.datetime.fromtimestamp(value).isoformat(timespec="seconds") if value else None


def _job_view(job: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": job["id"],
        "status": job["status"],
        "kind": job["kind"],
        "prompt": job["prompt"],
        "model": job.get("model"),
        "count": job["count"],
        "delivered": len(job.get("result_files") or []),
        "tag": job.get("tag"),
        "aspect": job.get("aspect"),
        "credits_spent": job.get("credits_spent"),
        "output_dir": job.get("output_dir"),
        "files": job.get("result_files") or [],
        "error": job.get("error"),
        "created_at": _ts(job.get("created_at")),
        "finished_at": _ts(job.get("finished_at")),
    }


def _parse_at(at: str | None) -> float | None:
    if not at:
        return None
    from .cli import parse_when
    return parse_when(at)


# ---------------------------------------------------------------------------
# zadavani
# ---------------------------------------------------------------------------

@server.tool()
def flow_enqueue_image(
    prompt: str,
    count: int = 4,
    model: str | None = None,
    aspect: str | None = None,
    refs: list[str] | None = None,
    tag: str = "default",
    priority: int = 100,
    at: str | None = None,
) -> dict[str, Any]:
    """Zaradi generovani obrazku ve Google Flow do fronty.

    Obrazky jsou v uzivatelove tarifu zdarma - kredity se neutraci.

    Args:
        prompt: Textovy popis obrazku.
        count: Kolik kusu vygenerovat, 1-12. Worker to sam rozdeli na davky po 4
            a posle je soucasne, takze 12 je nejrychlejsi volba.
        model: Napr. "Nano Banana 2", "Nano Banana Pro". Vychozi z konfigurace.
        aspect: "16:9", "4:3", "1:1", "3:4" nebo "9:16".
        refs: Absolutni cesty k referencnim obrazkum (predlohám) na disku.
        tag: Nazev projektu - urcuje podslozku ve vystupech.
        priority: Nizsi cislo = drivejsi zpracovani (vychozi 100).
        at: Kdy nejdriv odeslat - "+2h", "03:00", "2026-08-28 03:00".
    """
    db.init()
    count = max(1, min(int(count), MAX_IMAGES_AT_ONCE))
    bad = [r for r in (refs or []) if not Path(r).exists()]
    if bad:
        return {"ok": False, "error": f"Předloha neexistuje: {bad[0]}"}

    job_id = db.add_job(
        kind="image", prompt=prompt, model=model, count=count, aspect=aspect,
        refs=[str(Path(r).resolve()) for r in (refs or [])], tag=tag,
        priority=priority, not_before=_parse_at(at), source="mcp",
    )
    return {"ok": True, "job_id": job_id, "kind": "image", "count": count,
            "credits": 0, "note": "Obrázky jsou zdarma. Stav zjistíš přes flow_job."}


@server.tool()
def flow_enqueue_video(
    prompt: str,
    duration: int = 8,
    model: str | None = None,
    aspect: str | None = None,
    refs: list[str] | None = None,
    count: int = 1,
    tag: str = "default",
    priority: int = 100,
    at: str | None = None,
) -> dict[str, Any]:
    """Zaradi generovani videa ve Google Flow do fronty.

    Pozor - videa stoji kredity. Worker pred kazdym odeslanim precte skutecnou
    cenu primo z Flow a odmitne ji, pokud by prekrocila rozpocet nebo rezervu.

    Args:
        prompt: Popis videa.
        duration: Delka v sekundach (obvykle 4, 6, 8 nebo 10).
        model: Napr. "Veo 3.1 Fast", "Omni Flash". Vychozi z konfigurace.
        aspect: "16:9" nebo "9:16".
        refs: Absolutni cesty k vychozim obrazkum (image-to-video).
        count: Kolik videi vygenerovat.
        tag: Nazev projektu - urcuje podslozku ve vystupech.
        priority: Nizsi cislo = drivejsi zpracovani.
        at: Kdy nejdriv odeslat - "+2h", "03:00", "2026-08-28 03:00".
    """
    db.init()
    bad = [r for r in (refs or []) if not Path(r).exists()]
    if bad:
        return {"ok": False, "error": f"Předloha neexistuje: {bad[0]}"}

    job_id = db.add_job(
        kind="video", prompt=prompt, model=model, count=max(1, int(count)),
        aspect=aspect, duration=int(duration),
        refs=[str(Path(r).resolve()) for r in (refs or [])], tag=tag,
        priority=priority, not_before=_parse_at(at), source="mcp",
    )
    balance = db.get_state("credits_balance")
    return {"ok": True, "job_id": job_id, "kind": "video", "duration": duration,
            "credit_balance": balance,
            "note": "Přesnou cenu ověří worker před odesláním."}


@server.tool()
def flow_enqueue_many(
    prompts: list[str],
    kind: str = "image",
    count: int = 4,
    model: str | None = None,
    aspect: str | None = None,
    tag: str = "default",
    priority: int = 100,
) -> dict[str, Any]:
    """Zaradi vic promptu najednou - typicky cely storyboard nebo serii variant.

    Args:
        prompts: Seznam textovych promptu.
        kind: "image" nebo "video".
        count: Kolik kusu na jeden prompt.
        model: Nazev modelu; vychozi z konfigurace.
        aspect: Pomer stran.
        tag: Nazev projektu - urcuje podslozku ve vystupech.
        priority: Nizsi cislo = drivejsi zpracovani.
    """
    db.init()
    if kind not in ("image", "video"):
        return {"ok": False, "error": "kind musí být 'image' nebo 'video'"}
    limit = MAX_IMAGES_AT_ONCE if kind == "image" else 8
    ids = [
        db.add_job(kind=kind, prompt=p, model=model, count=max(1, min(int(count), limit)),
                   aspect=aspect, tag=tag, priority=priority, source="mcp")
        for p in prompts if p.strip()
    ]
    return {"ok": True, "job_ids": ids, "queued": len(ids)}


# ---------------------------------------------------------------------------
# cteni stavu
# ---------------------------------------------------------------------------

@server.tool()
def flow_job(job_id: str) -> dict[str, Any]:
    """Vrati stav jedne ulohy vcetne cest k hotovym souborum.

    Args:
        job_id: ID vracene pri zarazeni do fronty.
    """
    db.init()
    job = db.get_job(job_id)
    if job is None:
        return {"ok": False, "error": f"Úloha {job_id} neexistuje."}
    return {"ok": True, "job": _job_view(job)}


@server.tool()
def flow_list_jobs(status: str | None = None, tag: str | None = None,
                   limit: int = 30) -> dict[str, Any]:
    """Vypise ulohy ve fronte.

    Args:
        status: Filtr - "queued", "running", "done", "failed", "cancelled".
        tag: Filtr podle nazvu projektu.
        limit: Maximalni pocet vracenych uloh.
    """
    db.init()
    jobs = db.list_jobs(status=status, tag=tag, limit=min(int(limit), 200))
    return {"ok": True, "jobs": [_job_view(j) for j in jobs]}


@server.tool()
def flow_queue_status() -> dict[str, Any]:
    """Souhrn: kolik uloh ceka, jestli bezi worker a jak je na tom rozpocet kreditu."""
    db.init()
    from . import state

    hb = db.get_state("worker_heartbeat")
    now = dt.datetime.now().timestamp()
    ext = db.get_state("ext_status") or {}
    return {
        "ok": True,
        "worker_running": bool(hb and now - hb < 30),
        "worker_paused": state.paused(),
        "last_heartbeat": _ts(hb),
        # Co hlasi rozsireni v prohlizeci - bez toho neni poznat, proc fronta stoji.
        "browser": {
            "generuje": ext.get("running"),
            "autopilot": ext.get("autopilot"),
            "v_projektu": ext.get("project"),
            "odposlech_site": ext.get("odposlech"),
            "ladici_rozhrani": "chybí oprávnění debugger" if ext.get("umiLadit") is False
                               else (ext.get("chybaLadeni") or "ok"),
            "posledni_hlaska": ext.get("lastLog"),
        },
        "queue": db.counts(),
        "credits": {
            "balance": db.get_state("credits_balance"),
            "spent_this_month": db.credits_spent_since(state.month_start_ts()),
            "monthly_budget": CFG.monthly_budget,
            "reserve": CFG.credit_reserve,
        },
        "flow_project": state.project_url(),
        "outputs_dir": str(CFG.outputs_dir),
    }


@server.tool()
def flow_diagnostics(index: int = 0) -> dict[str, Any]:
    """Vrati posledni dump stranky Flow, ktery poslalo rozsireni.

    Rozsireni ovlada Flow pres popisky tlacitek - stabilni CSS tridy tam nejsou.
    Kdyz Google neco prejmenuje, prestane sedet selektor a z venku to neni videt.
    Dump obsahuje popisky ovladaciho pruhu, obsah popoveru s nastavenim, nazvy
    sitovych volani a stav ladiciho rozhrani - tedy vsechno, co je k oprave
    potreba. Vznika sam po chybe typu "Nenasel jsem tlacitko" nebo na tlacitko
    Diagnostika v panelu.

    Args:
        index: 0 = nejnovejsi dump, 1 = predchozi, atd.
    """
    db.init()
    folder = CFG.outputs_dir / "_diagnostika"
    files = sorted(folder.glob("dump-*.json"), reverse=True) if folder.exists() else []
    if not files:
        return {"ok": False, "error": "Zatím žádný dump. V panelu FlowBridge klikni "
                                      "na Diagnostika (nebo počkej, až úloha selže)."}
    if index >= len(files):
        return {"ok": False, "error": f"Mám jen {len(files)} dumpů.", "available": len(files)}

    path = files[index]
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return {"ok": False, "error": f"Dump {path.name} se nepodařilo přečíst: {exc}"}

    # Cely text stranky by odpoved zbytecne nafoukl; k opravě selektoru staci kus.
    if isinstance(data, dict) and isinstance(data.get("text"), str):
        data["text"] = data["text"][:1200]
    return {"ok": True, "file": str(path), "available": len(files), "dump": data}


@server.tool()
def flow_set_project(url: str) -> dict[str, Any]:
    """Nastavi projekt ve Flow, do ktereho se ma generovat.

    Rozsireni hlasi otevreny projekt samo, takze tohle je potreba jen kdyz ho
    chces urcit dopredu - napr. hned po zalozeni prazdneho projektu.

    Args:
        url: Cela adresa, napr. https://labs.google/fx/tools/flow/project/<id>
    """
    db.init()
    from . import state
    url = url.strip()
    if url and not url.startswith("https://labs.google/"):
        return {"ok": False, "error": "Čekám adresu projektu na labs.google."}
    state.set_project_url(url)
    db.log(f"projekt nastaven přes MCP: {url or '(žádný)'}")
    return {"ok": True, "project": url}


@server.tool()
def flow_models() -> dict[str, Any]:
    """Seznam modelu Flow vcetne ceny v kreditech.

    Katalog nacita worker pri startu. Kdyz je prazdny, spust workera
    (python -m flowbridge run) nebo `python -m flowbridge models`.
    """
    db.init()
    catalog = db.get_state("model_catalog")
    if not catalog:
        return {"ok": False, "error": "Katalog zatím nenačten - spusť workera."}
    return {"ok": True, "models": catalog,
            "updated_at": _ts(db.get_state("model_catalog_ts"))}


# ---------------------------------------------------------------------------
# rizeni
# ---------------------------------------------------------------------------

@server.tool()
def flow_cancel(job_id: str) -> dict[str, Any]:
    """Zrusi ulohu ve fronte.

    Args:
        job_id: ID ulohy ke zruseni.
    """
    db.init()
    return {"ok": db.cancel_job(job_id), "job_id": job_id}


@server.tool()
def flow_set_paused(paused: bool) -> dict[str, Any]:
    """Pozastavi nebo znovu spusti odesilani do Flow.

    Args:
        paused: True = pozastavit, False = pokracovat.
    """
    db.init()
    from . import state
    state.set_paused(paused)
    return {"ok": True, "paused": paused}


def run() -> None:
    db.init()
    server.run()


if __name__ == "__main__":
    run()
