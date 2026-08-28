"""Lokalni webovy dashboard - fronta, pridavani promptu, nahledy vysledku."""

from __future__ import annotations

import datetime as dt
import re
import shutil
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from pydantic import BaseModel

from . import db
from .config import CFG

app = FastAPI(title="FlowBridge", docs_url=None, redoc_url=None)

# Stránka Flow posílá hotová média přímo sem, takže potřebuje povolený původ.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://labs.google"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def allow_private_network(request: Request, call_next):
    """Povolí veřejné stránce sáhnout na tenhle server na 127.0.0.1.

    Chrome takové spojení jinak zablokuje (Private Network Access) - preflight
    projde jen s touhle hlavičkou. Server poslouchá pouze na smyčce, takže
    zvenčí se sem nikdo nedostane.
    """
    response = await call_next(request)
    if request.method == "OPTIONS":
        response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response


class NewJob(BaseModel):
    prompt: str
    kind: str = "image"
    count: int = 4
    model: str | None = None
    aspect: str | None = None
    duration: int | None = None
    tag: str = "default"
    priority: int = 100
    refs: list[str] = []


class PauseBody(BaseModel):
    paused: bool


def _ts(v: float | None) -> str | None:
    return dt.datetime.fromtimestamp(v).strftime("%d.%m. %H:%M:%S") if v else None


@app.get("/api/state")
def api_state() -> JSONResponse:
    db.init()
    from . import state

    hb = db.get_state("worker_heartbeat")
    now = dt.datetime.now().timestamp()
    jobs = db.list_jobs(limit=120)
    for j in jobs:
        j["created_at_h"] = _ts(j["created_at"])
        j["finished_at_h"] = _ts(j.get("finished_at"))
        j["delivered"] = len(j.get("result_files") or [])
    return JSONResponse({
        "worker": {
            "running": bool(hb and now - hb < 30),
            "paused": state.paused(),
            "heartbeat": _ts(hb),
        },
        "counts": db.counts(),
        "credits": {
            "balance": db.get_state("credits_balance"),
            "spent": db.credits_spent_since(state.month_start_ts()),
            "budget": CFG.monthly_budget,
            "reserve": CFG.credit_reserve,
        },
        "project": CFG.project_url,
        "jobs": jobs,
        "events": [{**e, "ts_h": _ts(e["ts"])} for e in db.recent_events(40)],
        "models": db.get_state("model_catalog") or {},
        "ext": db.get_state("ext_status") or {},
    })


@app.post("/api/jobs")
def api_add(job: NewJob) -> dict[str, Any]:
    db.init()
    limit = 12 if job.kind == "image" else 8
    job_id = db.add_job(
        kind=job.kind, prompt=job.prompt, model=job.model,
        count=max(1, min(job.count, limit)), aspect=job.aspect,
        duration=job.duration, refs=job.refs, tag=job.tag,
        priority=job.priority, source="dashboard",
    )
    return {"ok": True, "job_id": job_id}


@app.post("/api/jobs/{job_id}/cancel")
def api_cancel(job_id: str) -> dict[str, Any]:
    db.init()
    return {"ok": db.cancel_job(job_id)}


@app.post("/api/jobs/{job_id}/retry")
def api_retry(job_id: str) -> dict[str, Any]:
    db.init()
    db.update_job(job_id, status=db.QUEUED, attempts=0, error=None,
                  not_before=None, finished_at=None)
    return {"ok": True}


@app.post("/api/pause")
def api_pause(body: PauseBody) -> dict[str, Any]:
    db.init()
    from . import state
    state.set_paused(body.paused)
    return {"ok": True, "paused": body.paused}


# ---------------------------------------------------------------------------
# můstek pro rozšíření v Chrome
#
# Rozšíření si sem chodí pro úlohy, které do fronty nasypali AI agenti přes MCP,
# a po dokončení hlásí zpět výsledek. Vlastní generování běží v prohlížeči.
# ---------------------------------------------------------------------------

STALE_AFTER_SECONDS = 45 * 60


def _requeue_stale() -> int:
    """Vrati do fronty ulohy, ktere si rozsireni vzalo a uz se neozvalo.

    Stane se to, kdyz uzivatel zavre prohlizec uprostred davky - bez tohohle
    by takova uloha zustala navzdy ve stavu running a fronta by se zasekla.
    """
    cutoff = dt.datetime.now().timestamp() - STALE_AFTER_SECONDS
    with db.db() as conn:
        cur = conn.execute(
            "UPDATE jobs SET status = ?, started_at = NULL "
            "WHERE status = ? AND (started_at IS NULL OR started_at < ?)",
            (db.QUEUED, db.RUNNING, cutoff),
        )
    return cur.rowcount


@app.get("/ext/pull")
def ext_pull(limit: int = 3) -> dict[str, Any]:
    db.init()
    from . import state
    if state.paused():
        return {"jobs": [], "paused": True}

    stale = _requeue_stale()
    if stale:
        db.log(f"vrátil jsem do fronty {stale} zaseknutých úloh")

    out: list[dict[str, Any]] = []
    for _ in range(max(1, min(limit, 50))):
        job = db.claim_next()
        if job is None:
            break
        out.append({
            "id": job["id"],
            "kind": job["kind"],
            "prompt": job["prompt"],
            "count": job["count"],
            "model": job.get("model"),
            "aspect": job.get("aspect"),
            "duration": job.get("duration"),
            "tag": job.get("tag"),
        })
    if out:
        db.log(f"můstek vydal {len(out)} úloh rozšíření")
    return {"jobs": out, "paused": False}


class ExtReport(BaseModel):
    id: str
    status: str = "done"
    files: list[str] = []
    credits: int = 0
    error: str | None = None


def _relocate(paths: list[str], job_id: str) -> list[str]:
    """Presune stazene soubory z Downloads do cilove slozky.

    Chrome umi stahovat jen do slozky Stazene soubory, takze konecne misto
    (napr. Plocha na OneDrive) resime az tady. Zachovava se podstrom
    za slozkou FlowBridge, aby vysledky zustaly roztridene.
    """
    target_root = CFG.outputs_dir
    moved: list[str] = []
    for raw in paths:
        src = Path(raw)
        if not src.is_absolute() or not src.exists():
            moved.append(raw)  # nemame co presouvat
            continue
        parts = src.parts
        try:
            i = [p.lower() for p in parts].index("flowbridge")
            rel = Path(*parts[i + 1:])
        except ValueError:
            rel = Path(src.name)
        dest = target_root / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.exists():
            dest = dest.with_name(f"{dest.stem}-{job_id[:6]}{dest.suffix}")
        try:
            shutil.move(str(src), str(dest))
            moved.append(str(dest))
        except OSError as exc:
            db.log(f"přesun {src.name} selhal: {exc}", job_id=job_id, level="warn")
            moved.append(str(src))
    return moved


@app.post("/ext/report")
def ext_report(body: ExtReport) -> dict[str, Any]:
    db.init()
    if body.status == "done":
        files = _relocate(body.files, body.id)
        db.finish_job(body.id, files=files, credits_spent=body.credits)
        if body.credits:
            db.record_credits(body.credits, job_id=body.id, note="rozšíření")
        db.log(f"hotovo, {len(files)} souborů -> {CFG.outputs_dir}", job_id=body.id)
    else:
        db.fail_job(body.id, body.error or "rozšíření nahlásilo chybu")
    return {"ok": True}


SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]+")


@app.post("/ext/upload")
async def ext_upload(request: Request, tag: str = "default", name: str = "soubor") -> dict[str, Any]:
    """Prijme hotove medium primo ze stranky Flow a ulozi ho do cilove slozky.

    Média Flow servíruje ze stejné domény, takže je stránka umí stáhnout
    s přihlášením a poslat sem - odpadá tím obcházení přes Stažené soubory.
    """
    data = await request.body()
    if not data:
        raise HTTPException(status_code=400, detail="prázdné tělo požadavku")

    folder = CFG.outputs_dir / SAFE_NAME.sub("-", tag).strip("-")
    folder.mkdir(parents=True, exist_ok=True)
    dest = folder / SAFE_NAME.sub("-", name).strip("-")
    if dest.exists():
        dest = dest.with_name(f"{dest.stem}-{int(dt.datetime.now().timestamp())}{dest.suffix}")
    dest.write_bytes(data)
    db.log(f"uloženo {dest.name} ({len(data) // 1024} kB) -> {folder}")
    return {"ok": True, "path": str(dest), "bytes": len(data)}


class ExtLog(BaseModel):
    message: str
    level: str = "info"


@app.post("/ext/log")
def ext_log(body: ExtLog) -> dict[str, Any]:
    """Prevezme radek z logu rozsireni, at je videt i mimo prohlizec."""
    db.init()
    db.log(f"[rozšíření] {body.message[:300]}", level=body.level)
    return {"ok": True}


@app.post("/ext/heartbeat")
async def ext_heartbeat(request: Request) -> dict[str, Any]:
    """Rozsireni se hlasi kazdych ~10 s a rovnou rekne, co prave dela."""
    db.init()
    db.set_state("worker_heartbeat", dt.datetime.now().timestamp())
    try:
        payload = await request.json()
    except Exception:  # noqa: BLE001 - tep bez tela je taky platny
        payload = {}
    if isinstance(payload, dict) and payload:
        db.set_state("ext_status", payload)
    return {"ok": True}


@app.get("/file")
def api_file(path: str) -> FileResponse:
    """Servíruje vysledny soubor - jen zevnitr slozky s vystupy."""
    target = Path(path).resolve()
    outputs = CFG.outputs_dir.resolve()
    if not target.is_file() or outputs not in target.parents:
        raise HTTPException(status_code=404, detail="Soubor mimo výstupní složku.")
    return FileResponse(target)


@app.get("/", response_class=HTMLResponse)
def index() -> str:
    return PAGE


PAGE = """<!doctype html>
<html lang="cs"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>FlowBridge</title>
<style>
  :root{--bg:#0b0b0d;--card:#151518;--line:#26262b;--fg:#e8e8ea;--dim:#8b8b93;
        --ok:#4ade80;--run:#60a5fa;--warn:#fbbf24;--err:#f87171;--acc:#a78bfa}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);
       font:14px/1.5 "Segoe UI",system-ui,sans-serif}
  header{display:flex;align-items:center;gap:18px;flex-wrap:wrap;
         padding:14px 20px;border-bottom:1px solid var(--line);position:sticky;top:0;
         background:var(--bg);z-index:5}
  h1{font-size:16px;margin:0;letter-spacing:.5px}
  .pill{padding:3px 10px;border-radius:999px;background:var(--card);
        border:1px solid var(--line);font-size:12px;color:var(--dim)}
  .pill b{color:var(--fg);font-weight:600}
  main{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:18px;padding:18px 20px}
  @media(max-width:900px){main{grid-template-columns:1fr}}
  .card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px}
  .card h2{font-size:12px;text-transform:uppercase;letter-spacing:1px;color:var(--dim);
           margin:0 0 12px}
  table{width:100%;border-collapse:collapse}
  th,td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line);
        font-size:13px;vertical-align:top}
  th{color:var(--dim);font-weight:500;font-size:11px;text-transform:uppercase}
  td.prompt{max-width:340px}
  .s{font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid currentColor}
  .s.queued{color:var(--dim)} .s.running{color:var(--run)} .s.done{color:var(--ok)}
  .s.failed{color:var(--err)} .s.cancelled{color:var(--dim);opacity:.6}
  button{background:var(--acc);color:#12121a;border:0;border-radius:7px;padding:8px 14px;
         font:inherit;font-weight:600;cursor:pointer}
  button.ghost{background:transparent;color:var(--dim);border:1px solid var(--line);
               font-weight:400;padding:4px 10px;font-size:12px}
  button:hover{filter:brightness(1.12)}
  input,select,textarea{width:100%;background:#0e0e11;color:var(--fg);
        border:1px solid var(--line);border-radius:7px;padding:8px 10px;font:inherit}
  textarea{resize:vertical;min-height:78px}
  label{display:block;font-size:11px;color:var(--dim);margin:10px 0 4px;
        text-transform:uppercase;letter-spacing:.5px}
  .row{display:flex;gap:8px}.row>*{flex:1}
  .thumbs{display:flex;gap:5px;flex-wrap:wrap;margin-top:6px}
  .thumbs img,.thumbs video{width:54px;height:54px;object-fit:cover;border-radius:5px;
        border:1px solid var(--line)}
  .ev{font-size:11.5px;color:var(--dim);padding:4px 0;border-bottom:1px solid #1c1c20}
  .ev.warn{color:var(--warn)} .ev.error{color:var(--err)}
  .bar{height:5px;background:#1e1e24;border-radius:3px;overflow:hidden;margin-top:6px}
  .bar>i{display:block;height:100%;background:var(--acc)}
</style></head><body>

<header>
  <h1>FlowBridge</h1>
  <span class="pill" id="p-worker">worker …</span>
  <span class="pill" id="p-queue">fronta …</span>
  <span class="pill" id="p-credits">kredity …</span>
  <button class="ghost" id="btn-pause">pozastavit</button>
  <a class="pill" id="p-project" href="#" target="_blank">projekt ve Flow</a>
</header>

<main>
  <div>
    <div class="card">
      <h2>Fronta</h2>
      <table><thead><tr>
        <th>stav</th><th>typ</th><th>ks</th><th>prompt</th><th>tag</th><th>vytvořeno</th><th></th>
      </tr></thead><tbody id="jobs"></tbody></table>
    </div>
  </div>

  <div>
    <div class="card">
      <h2>Nový prompt</h2>
      <textarea id="f-prompt" placeholder="Co se má vygenerovat…"></textarea>
      <div class="row">
        <div><label>typ</label>
          <select id="f-kind"><option value="image">obrázek</option>
                              <option value="video">video</option></select></div>
        <div><label>kusů</label><input id="f-count" type="number" value="12" min="1" max="12"></div>
      </div>
      <div class="row">
        <div><label>poměr</label>
          <select id="f-aspect"><option value="">výchozí</option>
            <option>16:9</option><option>4:3</option><option>1:1</option>
            <option>3:4</option><option>9:16</option></select></div>
        <div><label>délka videa (s)</label>
          <select id="f-duration"><option value="">–</option>
            <option>4</option><option>6</option><option>8</option><option>10</option></select></div>
      </div>
      <label>model (prázdné = výchozí)</label><input id="f-model" list="models" placeholder="Nano Banana 2">
      <datalist id="models"></datalist>
      <label>tag / projekt</label><input id="f-tag" value="default">
      <label>předlohy – cesty k souborům, po jedné na řádek</label>
      <textarea id="f-refs" style="min-height:52px"></textarea>
      <div style="margin-top:12px"><button id="btn-add">Přidat do fronty</button></div>
    </div>

    <div class="card" style="margin-top:16px">
      <h2>Události</h2><div id="events"></div>
    </div>
  </div>
</main>

<script>
const $ = s => document.querySelector(s);
let paused = false;

async function refresh(){
  const st = await (await fetch('/api/state')).json();
  paused = st.worker.paused;

  $('#p-worker').innerHTML = 'worker <b>' +
    (st.worker.paused ? 'pozastavený' : st.worker.running ? 'běží' : 'neběží') + '</b>';
  $('#btn-pause').textContent = paused ? 'spustit' : 'pozastavit';
  const c = st.counts;
  $('#p-queue').innerHTML = 'fronta <b>' + (c.queued||0) + '</b> · běží <b>' +
    (c.running||0) + '</b> · hotovo <b>' + (c.done||0) + '</b>' +
    (c.failed ? ' · chyby <b>' + c.failed + '</b>' : '');
  const cr = st.credits;
  $('#p-credits').innerHTML = 'kredity <b>' + (cr.balance ?? '?') + '</b> · měsíc <b>' +
    cr.spent + '/' + cr.budget + '</b>';
  if (st.project) $('#p-project').href = st.project;

  const names = new Set();
  for (const k of Object.keys(st.models||{}))
    for (const m of st.models[k]) names.add(m.family);
  $('#models').innerHTML = [...names].map(n => '<option value="'+n+'">').join('');

  $('#jobs').innerHTML = st.jobs.map(j => {
    const files = (j.result_files||[]).slice(0,8).map(f =>
      (j.kind === 'video'
        ? '<video src="/file?path=' + encodeURIComponent(f) + '" muted></video>'
        : '<img loading="lazy" src="/file?path=' + encodeURIComponent(f) + '">')).join('');
    const pct = j.count ? Math.round(100 * j.delivered / j.count) : 0;
    const act = (j.status === 'queued' || j.status === 'running')
      ? '<button class="ghost" onclick="act(\\''+j.id+'\\',\\'cancel\\')">zrušit</button>'
      : (j.status === 'failed'
        ? '<button class="ghost" onclick="act(\\''+j.id+'\\',\\'retry\\')">znovu</button>' : '');
    return '<tr><td><span class="s '+j.status+'">'+j.status+'</span></td>' +
      '<td>'+(j.kind==='video'?'video':'obr.')+'</td>' +
      '<td>'+j.delivered+'/'+j.count+'</td>' +
      '<td class="prompt">'+esc(j.prompt) +
        (j.error ? '<div style="color:#f87171;font-size:11px">'+esc(j.error)+'</div>' : '') +
        (j.status==='running' ? '<div class="bar"><i style="width:'+pct+'%"></i></div>' : '') +
        (files ? '<div class="thumbs">'+files+'</div>' : '') + '</td>' +
      '<td>'+esc(j.tag||'')+'</td><td style="color:#8b8b93">'+(j.created_at_h||'')+'</td>' +
      '<td>'+act+'</td></tr>';
  }).join('') || '<tr><td colspan="7" style="color:#8b8b93">Fronta je prázdná.</td></tr>';

  $('#events').innerHTML = st.events.map(e =>
    '<div class="ev '+e.level+'">'+(e.ts_h||'')+' — '+esc(e.message)+'</div>').join('');
}

function esc(s){ return (s||'').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c])); }

async function act(id, what){
  await fetch('/api/jobs/'+id+'/'+what, {method:'POST'});
  refresh();
}

$('#btn-pause').onclick = async () => {
  await fetch('/api/pause', {method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({paused: !paused})});
  refresh();
};

$('#btn-add').onclick = async () => {
  const prompt = $('#f-prompt').value.trim();
  if (!prompt) return;
  const refs = $('#f-refs').value.split('\\n').map(s=>s.trim()).filter(Boolean);
  const dur = $('#f-duration').value;
  await fetch('/api/jobs', {method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({
      prompt, kind: $('#f-kind').value, count: +$('#f-count').value,
      model: $('#f-model').value || null, aspect: $('#f-aspect').value || null,
      duration: dur ? +dur : null, tag: $('#f-tag').value || 'default', refs })});
  $('#f-prompt').value = '';
  refresh();
};

refresh();
setInterval(refresh, 3000);
</script></body></html>
"""
