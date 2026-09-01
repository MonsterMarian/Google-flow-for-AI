"""Prikazova radka FlowBridge."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path
from typing import Any

from . import db
from .config import CFG, ROOT

STATUS_MARK = {
    "queued": "..",
    "running": ">>",
    "done": "OK",
    "failed": "!!",
    "cancelled": "--",
}


# ---------------------------------------------------------------------------
# pomocne
# ---------------------------------------------------------------------------

def parse_when(value: str | None) -> float | None:
    """'2026-08-28 03:00', '+2h', '+30m' -> unix cas."""
    if not value:
        return None
    v = value.strip()
    if v.startswith("+"):
        num, unit = v[1:-1], v[-1].lower()
        mult = {"m": 60, "h": 3600, "d": 86400}.get(unit)
        if mult is None:
            raise SystemExit(f"Nerozumím času '{value}' (zkus +30m, +2h, +1d).")
        return dt.datetime.now().timestamp() + float(num) * mult
    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M", "%d.%m.%Y %H:%M", "%H:%M"):
        try:
            parsed = dt.datetime.strptime(v, fmt)
            if fmt == "%H:%M":
                today = dt.date.today()
                parsed = parsed.replace(year=today.year, month=today.month, day=today.day)
                if parsed < dt.datetime.now():
                    parsed += dt.timedelta(days=1)
            return parsed.timestamp()
        except ValueError:
            continue
    raise SystemExit(f"Nerozumím času '{value}'.")


def fmt_ts(ts: float | None) -> str:
    return dt.datetime.fromtimestamp(ts).strftime("%d.%m %H:%M") if ts else "-"


def print_jobs(jobs: list[dict[str, Any]]) -> None:
    if not jobs:
        print("Fronta je prázdná.")
        return
    # sloupec za KS je pocet predloh (+2p), jinak prazdny
    print(f"{'':2} {'ID':12} {'STAV':10} {'TYP':6} {'KS':>3}{'':5}{'TAG':12} "
          f"{'VYTVOŘENO':12} PROMPT")
    for j in jobs:
        mark = STATUS_MARK.get(j["status"], "  ")
        got = len(j.get("result_files") or [])
        ks = f"{got}/{j['count']}" if got else str(j["count"])
        predlohy = f" +{len(j['refs'])}p" if j.get("refs") else ""
        print(f"{mark} {j['id']:12} {j['status']:10} {j['kind']:6} {ks:>3}{predlohy:<5}"
              f"{j.get('tag', '')[:12]:12} {fmt_ts(j['created_at']):12} {j['prompt'][:58]}")


# ---------------------------------------------------------------------------
# prikazy
# ---------------------------------------------------------------------------

def resolve_refs(paths: list[str] | None) -> tuple[list[str], list[str]]:
    """Predlohy prevede na absolutni cesty; vrati (nalezene, chybejici).

    Bajty si z nich vezme az rozsireni pres mustek, takze soubor musi zustat
    na miste, dokud uloha nedobehne.
    """
    out: list[str] = []
    chybi: list[str] = []
    for raw in paths or []:
        path = Path(raw)
        if path.is_file():
            out.append(str(path.resolve()))
        else:
            chybi.append(str(raw))
    return out, chybi


def refs_or_die(paths: list[str] | None) -> list[str]:
    """Predlohy pro jednu ulohu - chybejici soubor beh rovnou ukonci."""
    out, chybi = resolve_refs(paths)
    if chybi:
        raise SystemExit(f"Předloha neexistuje: {chybi[0]}")
    return out


def default_count(args: argparse.Namespace) -> int:
    """Bez --count chceme u obrazku plnou davku, u videa jeden kus."""
    if args.count is not None:
        return args.count
    return 1 if args.kind == "video" else 4


def cmd_add(args: argparse.Namespace) -> None:
    db.init()
    refs = refs_or_die(args.ref)
    count = default_count(args)
    job_id = db.add_job(
        kind=args.kind,
        prompt=args.prompt,
        model=args.model,
        count=count,
        aspect=args.aspect,
        duration=args.duration,
        refs=refs,
        tag=args.tag,
        priority=args.priority,
        not_before=parse_when(args.at),
        source="cli",
    )
    when = f" (naplánováno na {fmt_ts(parse_when(args.at))})" if args.at else ""
    print(f"Přidáno: {job_id} - {args.kind} x{count}{when}")


def cmd_addfile(args: argparse.Namespace) -> None:
    """Hromadne pridani: .txt (prompt na radek) nebo .json/.jsonl (plne ulohy)."""
    db.init()
    path = Path(args.file)
    if not path.exists():
        raise SystemExit(f"Soubor {path} neexistuje.")

    added = 0
    spolecne_refs = refs_or_die(getattr(args, "ref", None))
    if path.suffix.lower() in (".json", ".jsonl"):
        raw = path.read_text(encoding="utf-8")
        items = ([json.loads(line) for line in raw.splitlines() if line.strip()]
                 if path.suffix.lower() == ".jsonl" else json.loads(raw))
        if isinstance(items, dict):
            items = [items]

        # Predlohy se overuji pro vsechny ulohy predem. Kdyby se kontrolovalo
        # az pri vkladani, pulka souboru uz je ve fronte a druha ne - a chyba
        # navic ukaze jen prvni spatnou cestu z mozna deseti.
        refs_pro: list[list[str]] = []
        potize: list[str] = []
        for item in items:
            nalezene, chybi = resolve_refs(item.get("refs"))
            refs_pro.append(nalezene or spolecne_refs)
            for c in chybi:
                potize.append(f"  {c}\n    (úloha: {str(item.get('prompt', ''))[:60]})")
        if potize:
            raise SystemExit(f"V {path.name} chybí {len(potize)} předloh, "
                             f"nepřidávám nic:\n" + "\n".join(potize))

        for item, refs in zip(items, refs_pro):
            db.add_job(
                kind=item.get("kind", args.kind),
                prompt=item["prompt"],
                model=item.get("model", args.model),
                count=int(item.get("count", default_count(args))),
                aspect=item.get("aspect", args.aspect),
                duration=item.get("duration"),
                refs=refs,
                tag=item.get("tag", args.tag),
                priority=int(item.get("priority", args.priority)),
                source="file",
            )
            added += 1
    else:
        prompts = [ln.strip() for ln in path.read_text(encoding="utf-8").splitlines()
                   if ln.strip() and not ln.strip().startswith("#")]
        per = args.per_prompt or default_count(args)
        max_batch = 12 if args.kind == "image" else 4
        for i, line in enumerate(prompts):
            # Jedna úloha unese nejvýš 12 obrázků (3 dávky po 4), takže větší
            # zakázku rozdělíme na několik úloh se stejným promptem.
            zbyva = per
            while zbyva > 0:
                kus = min(max_batch, zbyva)
                db.add_job(kind=args.kind, prompt=line, model=args.model,
                           count=kus, aspect=args.aspect, refs=spolecne_refs,
                           tag=args.tag, priority=args.priority + i, source="file")
                added += 1
                zbyva -= kus
    celkem = sum(j["count"] for j in db.list_jobs(status=db.QUEUED, tag=args.tag, limit=5000))
    print(f"Přidáno {added} úloh z {path.name} (ve frontě čeká {celkem} kusů pod tagem '{args.tag}')")


def cmd_list(args: argparse.Namespace) -> None:
    db.init()
    print_jobs(db.list_jobs(status=args.status, tag=args.tag, limit=args.limit))


def cmd_status(args: argparse.Namespace) -> None:
    db.init()
    counts = db.counts()
    from . import state

    hb = db.get_state("worker_heartbeat")
    alive = hb and (dt.datetime.now().timestamp() - hb) < 30
    balance = db.get_state("credits_balance")
    spent = db.credits_spent_since(state.month_start_ts())

    ext = db.get_state("ext_status") or {}

    print("FlowBridge")
    print(f"  rozšíření:  {'hlásí se' if alive else 'neozvalo se'}"
          f"{' (pozastavený)' if state.paused() else ''}"
          f"   poslední tep: {fmt_ts(hb)}")
    if alive:
        ladeni = ("chybí oprávnění debugger" if ext.get("umiLadit") is False
                  else (ext.get("chybaLadeni") or "ok"))
        print(f"  prohlížeč:  {'generuje' if ext.get('running') else 'čeká'}"
              f" | v projektu: {'ano' if ext.get('project') else 'NE'}"
              f" | odposlech: {'ok' if ext.get('odposlech') else 'NEBĚŽÍ'}"
              f" | ladění: {ladeni}")
        if ext.get("lastLog"):
            print(f"  naposled:   {str(ext['lastLog'])[:90]}")
    summary = ", ".join(f"{k}={v}" for k, v in sorted(counts.items())) or "prázdná"
    print(f"  fronta:     {summary}")
    print(f"  kredity:    zůstatek {balance if balance is not None else '?'}"
          f" | tento měsíc utraceno {spent}/{CFG.monthly_budget}")
    print(f"  projekt:    {state.project_url() or '(zatím žádný)'}")
    print(f"  výstupy:    {CFG.outputs_dir}")
    if args.events:
        print("\nPoslední události:")
        for e in db.recent_events(args.events):
            print(f"  {fmt_ts(e['ts'])} [{e['level']}] {e['message'][:100]}")


def cmd_project(args: argparse.Namespace) -> None:
    from . import state
    db.init()
    if args.url is None:
        print(state.project_url() or "(zatím žádný projekt)")
        return
    url = args.url.strip()
    if url and not url.startswith("https://labs.google/"):
        raise SystemExit("Čekám adresu projektu na labs.google.")
    state.set_project_url(url)
    print(f"Projekt nastaven: {url or '(žádný)'}")


def cmd_dump(args: argparse.Namespace) -> None:
    """Vypise posledni dump stranky Flow od rozsireni.

    Podle nej se opravuji selektory, kdyz Google zmeni popisky tlacitek.
    """
    folder = CFG.outputs_dir / "_diagnostika"
    files = sorted(folder.glob("dump-*.json"), reverse=True) if folder.exists() else []
    if not files:
        print("Zatím žádná diagnostika.")
        print("V panelu FlowBridge klikni na Diagnostika (nebo počkej, až úloha selže).")
        return
    if args.list:
        for f in files[:20]:
            print(f"{fmt_ts(f.stat().st_mtime)}  {f}")
        return
    path = files[min(args.index, len(files) - 1)]
    print(f"# {path}\n")
    print(path.read_text(encoding="utf-8")[: args.chars])


def cmd_cancel(args: argparse.Namespace) -> None:
    db.init()
    for job_id in args.ids:
        print(f"{job_id}: {'zrušeno' if db.cancel_job(job_id) else 'nelze zrušit'}")


def cmd_retry(args: argparse.Namespace) -> None:
    db.init()
    for job_id in args.ids:
        db.update_job(job_id, status=db.QUEUED, attempts=0, error=None,
                      not_before=None, finished_at=None)
        print(f"{job_id}: vráceno do fronty")



def cmd_pause(_: argparse.Namespace) -> None:
    from . import state
    db.init()
    state.set_paused(True)
    print("Pozastaveno - můstek přestane rozšíření vydávat další úlohy.")


def cmd_resume(_: argparse.Namespace) -> None:
    from . import state
    db.init()
    state.set_paused(False)
    print("Znovu spuštěno.")


def cmd_dashboard(args: argparse.Namespace) -> None:
    import uvicorn
    from .dashboard import app
    host, port = args.host or CFG.server_host, args.port or CFG.server_port
    print(f"Dashboard běží na http://{host}:{port}")
    uvicorn.run(app, host=host, port=port, log_level="warning")


def cmd_mcp(_: argparse.Namespace) -> None:
    from .mcp_server import run
    run()




def cmd_doctor(_: argparse.Namespace) -> None:
    """Zkontroluje jen to, co ma na starost Python - generovani dela rozsireni."""
    ok = True
    ext = ROOT / "extension" / "manifest.json"

    print("1) Python           ", sys.version.split()[0])

    for name in ("fastapi", "uvicorn", "mcp"):
        try:
            __import__(name)
            print(f"2) {name:18s} nainstalováno")
        except ImportError:
            ok = False
            print(f"2) {name:18s} CHYBÍ  ->  pip install -r requirements.txt")

    if ext.exists():
        print(f"3) Rozšíření         {ext.parent}")
    else:
        ok = False
        print("3) Rozšíření         CHYBÍ složka extension/")

    db.init()
    print(f"4) Databáze          {CFG.db_path}")
    print(f"5) Můstek            http://{CFG.server_host}:{CFG.server_port}")
    print("\n" + ("Všechno vypadá dobře." if ok else "Něco chybí - viz výše."))
    print("Generování běží v rozšíření: načti extension/ v chrome://extensions.")


# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="flowbridge",
        description=("Fronta promptů pro Google Flow. Generuje rozšíření v Chrome; "
                     "tenhle nástroj drží frontu a pouští MCP server pro AI agenty."),
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    def add_job_flags(sp: argparse.ArgumentParser) -> None:
        sp.add_argument("--kind", choices=["image", "video"], default="image")
        sp.add_argument("--model", default=None, help="např. 'Nano Banana 2' nebo 'Veo 3.1 Fast'")
        sp.add_argument("--count", type=int, default=None,
                        help="kolik kusů (obrázky až 12, výchozí 4; video výchozí 1)")
        sp.add_argument("--aspect", default=None, help="16:9 | 4:3 | 1:1 | 3:4 | 9:16")
        sp.add_argument("--tag", default="default", help="složka/projekt pro výstupy")
        sp.add_argument("--priority", type=int, default=100, help="nižší = dřív")

    sp = sub.add_parser("add", help="přidá úlohu do fronty")
    sp.add_argument("prompt")
    add_job_flags(sp)
    sp.add_argument("--duration", type=int, default=None, help="délka videa v sekundách")
    sp.add_argument("--ref", action="append", help="cesta k předloze (lze vícekrát)")
    sp.add_argument("--at", default=None, help="'+2h', '03:00', '2026-08-28 03:00'")
    sp.set_defaults(func=cmd_add)

    sp = sub.add_parser("addfile", help="hromadně přidá úlohy ze souboru (.txt/.json/.jsonl)")
    sp.add_argument("file")
    add_job_flags(sp)
    sp.add_argument("--per-prompt", type=int, default=None,
                    help="kolik kusů na každý prompt; větší číslo se rozdělí na úlohy po 12")
    sp.add_argument("--ref", action="append",
                    help="předloha pro všechny prompty ze souboru (lze vícekrát)")
    sp.set_defaults(func=cmd_addfile)

    sp = sub.add_parser("list", help="vypíše frontu")
    sp.add_argument("--status", choices=["queued", "running", "done", "failed", "cancelled"])
    sp.add_argument("--tag")
    sp.add_argument("--limit", type=int, default=50)
    sp.set_defaults(func=cmd_list)

    sp = sub.add_parser("status", help="přehled stavu fronty")
    sp.add_argument("--events", type=int, default=0, help="kolik posledních událostí vypsat")
    sp.set_defaults(func=cmd_status)

    sp = sub.add_parser("cancel", help="zruší úlohy")
    sp.add_argument("ids", nargs="+")
    sp.set_defaults(func=cmd_cancel)

    sp = sub.add_parser("retry", help="vrátí úlohy do fronty")
    sp.add_argument("ids", nargs="+")
    sp.set_defaults(func=cmd_retry)

    sp = sub.add_parser("project", help="ukáže nebo nastaví projekt ve Flow")
    sp.add_argument("url", nargs="?", default=None,
                    help="https://labs.google/fx/tools/flow/project/<id>")
    sp.set_defaults(func=cmd_project)

    sp = sub.add_parser("dump", help="vypíše poslední diagnostiku stránky Flow")
    sp.add_argument("--index", type=int, default=0, help="0 = nejnovější")
    sp.add_argument("--list", action="store_true", help="jen vypsat dostupné dumpy")
    sp.add_argument("--chars", type=int, default=20000, help="kolik znaků vypsat")
    sp.set_defaults(func=cmd_dump)

    sub.add_parser("pause", help="pozastaví vydávání úloh rozšíření").set_defaults(func=cmd_pause)
    sub.add_parser("resume", help="znovu povolí vydávání úloh").set_defaults(func=cmd_resume)

    sp = sub.add_parser("dashboard", help="spustí můstek + webový dashboard")
    sp.add_argument("--host", default=None)
    sp.add_argument("--port", type=int, default=None)
    sp.set_defaults(func=cmd_dashboard)

    sub.add_parser("mcp", help="spustí MCP server pro AI agenty").set_defaults(func=cmd_mcp)
    sub.add_parser("doctor", help="zkontroluje prostředí").set_defaults(func=cmd_doctor)

    return p


def main(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
