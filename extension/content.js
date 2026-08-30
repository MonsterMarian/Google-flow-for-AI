/*
 * FlowBridge - bezi primo ve strance Google Flow.
 *
 * Proc takhle: rozsireni je soucasti stranky, takze pouziva tvoje prihlaseni.
 * Zadny ladici port, zadne kopirovani profilu, zadne druhe okno.
 *
 * Limit Flow "4 obrazky na jedno odeslani" se obchazi tim, ze se posilaji
 * 3 davky hned za sebou -> 12 obrazku generuje soucasne. Vsech 12 patri jedne
 * uloze, takze se daji ulozit do spravne slozky bez hadani.
 */

(() => {
  if (window.__flowbridgeLoaded) return;
  window.__flowbridgeLoaded = true;

  const DEFAULTS = {
    running: false,
    jobs: [],
    log: [],
    settings: {
      batchSize: 4,
      maxBatches: 3,
      pauseMinSeconds: 4,
      pauseMaxSeconds: 11,
      wavePauseSeconds: 6,
      maxAttempts: 3,
      waitTimeoutSeconds: 900,
      maxCreditsPerJob: 60,
      bridgeUrl: "http://127.0.0.1:8765",
      bridgeEnabled: true,
      autopilot: true,
      collapsed: false,
      projectUrl: "",
    },
  };

  let state = structuredClone(DEFAULTS);
  let busy = false;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const nowId = () => Math.random().toString(36).slice(2, 10);

  /* Kdyz service worker uspal nebo neodpovi, sendMessage muze viset navzdy.
     Vsude, kde se na odpoved ceka uprostred davky, jde o zaseknuty beh. */
  function withTimeout(promise, ms, fallback) {
    return Promise.race([
      Promise.resolve(promise).catch((e) => ({ ok: false, error: String(e?.message || e) })),
      sleep(ms).then(() => fallback),
    ]);
  }

  // -------------------------------------------------------------------------
  // co videl odposlech site (inject.js bezi v hlavnim svete stranky)
  //
  // Z DOM se hotova media ctou spatne - seznam je virtualizovany a v <img> je
  // zmenseny nahled. Odpoved z /fx/api/trpc ma plne adresy a navic je jedinym
  // spolehlivym dukazem, ze Flow odeslani prijal.
  // -------------------------------------------------------------------------

  const netMedia = [];       // {url, isVideo, ts}
  const netMediaSeen = new Set();
  const netCalls = [];       // {name, method, status, ts} - nejnovejsi prvni
  let netReady = false;
  let lastGenerateTs = 0;  // volani, ktere urcite spustilo generovani
  let lastPostTs = 0;      // jakykoliv zapis do Flow - slabsi, ale nekdy jediny
  let creditBalance = null;

  /* Nazvy volani, ktera znamenaji "generovani zacalo". Zamerne siroke - kdyz
     Google neco prejmenuje, poznas to z diagnostiky (netCalls) a doplnis sem. */
  const GENERATE_CALL = /generate|createMedia|runWorkflow|submitWorkflow|textToImage|textToVideo|imageFx|videoFx|createScene|expandPrompt/i;

  window.addEventListener("message", (ev) => {
    if (ev.source !== window || ev.origin !== location.origin) return;
    const p = ev.data && ev.data.__fbNet;
    if (!p) return;

    netReady = true; // cokoliv od odposlechu = bezi
    if (p.kind === "ready") {
      /* jen ohlaseni */
    } else if (p.kind === "media") {
      const ts = Date.now();
      for (const it of p.items || []) {
        if (netMediaSeen.has(it.url)) continue;
        netMediaSeen.add(it.url);
        netMedia.push({ url: it.url, isVideo: !!it.isVideo, ts });
      }
      if (netMedia.length > 4000) netMedia.splice(0, netMedia.length - 4000);
    } else if (p.kind === "call") {
      netCalls.unshift({ name: p.name, method: p.method, status: p.status, ts: p.ts });
      if (netCalls.length > 80) netCalls.length = 80;
      if (p.method === "POST" && p.ok) {
        lastPostTs = p.ts || Date.now();
        if (GENERATE_CALL.test(p.name || "")) lastGenerateTs = lastPostTs;
      }
    } else if (p.kind === "credits") {
      creditBalance = p.value;
    }
  });

  /* Media, ktera odposlech zachytil od daneho okamziku.
     U videa se prednostne berou skutecna videa - Flow k nim posila i nahledovy
     obrazek. Kdyz se ale zadne video nerozpozna (treba proto, ze adresa je
     podepsana a nekonci na .mp4), vratime radeji vsechno nez nic. */
  function mediaSince(ts, wantVideo) {
    const vse = netMedia.filter((m) => m.ts >= ts);
    const videa = wantVideo ? vse.filter((m) => m.isVideo) : null;
    return (videa && videa.length ? videa : vse).map((m) => m.url);
  }

  // -------------------------------------------------------------------------
  // stav
  // -------------------------------------------------------------------------

  async function load() {
    const got = await chrome.storage.local.get("flowbridge");
    if (got.flowbridge) {
      state = { ...structuredClone(DEFAULTS), ...got.flowbridge };
      state.settings = { ...DEFAULTS.settings, ...(got.flowbridge.settings || {}) };
    }
    // ulohy, ktere zustaly viset po zavreni panelu, vratime do fronty
    for (const j of state.jobs) if (j.status === "running") j.status = "queued";
  }

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      chrome.storage.local.set({ flowbridge: state });
    }, 150);
  }

  function log(msg, level = "info") {
    state.log.unshift({ ts: Date.now(), msg: String(msg), level });
    if (state.log.length > 120) state.log.length = 120;
    save();
    renderLog();
    // Kdyz bezi mustek, posilame log i tam - jinak neni z venku videt,
    // co se v prohlizeci deje.
    if (state.settings.bridgeEnabled) {
      try {
        chrome.runtime.sendMessage({
          type: "bridgeLog",
          url: state.settings.bridgeUrl,
          payload: { message: String(msg), level },
        });
      } catch {
        /* na logovani nikdy nepadame */
      }
    }
  }

  // -------------------------------------------------------------------------
  // ovladani Flow
  // -------------------------------------------------------------------------

  function editor() {
    const eds = document.querySelectorAll('div[role="textbox"][contenteditable="true"]');
    return eds[eds.length - 1] || null;
  }

  function bar() {
    let el = editor();
    for (let i = 0; i < 8 && el; i++) {
      if (el.querySelectorAll("button").length >= 3) return el;
      el = el.parentElement;
    }
    return null;
  }

  /* Popover s nastavenim: nejmensi blok, ktery mluvi o kreditech a ma tlacitka. */
  function popover() {
    let best = null;
    for (const el of document.querySelectorAll("div")) {
      const t = el.innerText || "";
      if (!t || t.length > 900) continue;
      if (!/credit/i.test(t)) continue;
      if (el.querySelectorAll("button").length < 3) continue;
      if (!best || t.length < (best.innerText || "").length) best = el;
    }
    return best;
  }

  const CLICKABLE =
    'button,[role="button"],[role="tab"],[role="radio"],[role="menuitem"],[role="option"],[role="menuitemradio"]';

  /* Flow je React a menu otevira uz na pointerdown.
     Holé el.click() posle jen 'click', takze se nic nestane - musime poslat
     celou sekvenci ukazatele, jako kdyz klikne clovek. */
  function realClick(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const base = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2,
      button: 0,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
    };
    el.dispatchEvent(new PointerEvent("pointerover", { ...base, buttons: 0 }));
    el.dispatchEvent(new PointerEvent("pointerenter", { ...base, buttons: 0 }));
    el.dispatchEvent(new MouseEvent("mousemove", { ...base, buttons: 0 }));
    el.dispatchEvent(new PointerEvent("pointerdown", { ...base, buttons: 1 }));
    el.dispatchEvent(new MouseEvent("mousedown", { ...base, buttons: 1 }));
    el.dispatchEvent(new PointerEvent("pointerup", { ...base, buttons: 0 }));
    el.dispatchEvent(new MouseEvent("mouseup", { ...base, buttons: 0 }));
    el.dispatchEvent(new MouseEvent("click", { ...base, buttons: 0 }));
    return true;
  }

  const norm = (el) => (el.innerText || "").replace(/\s+/g, " ").trim();

  /* Tlacitka Flow nesou i nazev ikony: "crop_square 1:1", "videocam Video".
     Popisek proto porovnavame se *koncem* textu, ne s celym retezcem. */
  function labelMatches(text, wanted) {
    const t = text.trim();
    if (t === wanted) return true;
    const esc = wanted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp("(^|\\s)" + esc + "$").test(t);
  }

  /* Klikne na prvek podle jeho textu - Flow nema stabilni CSS tridy ani testid. */
  function clickIn(root, label, exact = true) {
    if (!root) return false;
    const wanted = String(label);
    const hits = [];
    for (const el of root.querySelectorAll(CLICKABLE + ",span,div,p")) {
      const t = norm(el);
      if (!t) continue;
      const match = exact
        ? labelMatches(t, wanted)
        : t.toLowerCase().includes(wanted.toLowerCase());
      if (match) hits.push(el);
    }
    if (!hits.length) return false;
    hits.sort((a, b) => norm(a).length - norm(b).length);
    return realClick(hits[0].closest(CLICKABLE) || hits[0]);
  }

  function submitButton() {
    const b = bar();
    if (!b) return null;
    const bs = [...b.querySelectorAll("button")];
    return bs.reverse().find((x) => /arrow_forward/.test(x.innerText || "")) || bs[0];
  }

  function submitReady() {
    const s = submitButton();
    return !!s && s.getAttribute("aria-disabled") !== "true" && !s.disabled;
  }

  const editorText = (ed) =>
    (ed.innerText || ed.textContent || "").replace(/​/g, "").trim();

  /* Bez kurzoru na konci by mazani po znaku zacalo uprostred textu. */
  function caretToEnd(ed) {
    try {
      const r = document.createRange();
      r.selectNodeContents(ed);
      r.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    } catch {
      /* nevadi, jen pojistka */
    }
  }

  async function setPrompt(text) {
    const ed = editor();
    if (!ed) throw new Error("Nenašel jsem pole pro prompt. Jsi na stránce projektu Flow?");
    // Flow cte jen udalost beforeinput; execCommand ani zapis do DOM neregistruje.
    for (let pokus = 1; pokus <= 4; pokus++) {
      ed.focus();
      caretToEnd(ed);
      // Vyber textu Flow ignoruje, takze se maze po znaku. Pocet se ridi tim,
      // co v poli opravdu je - 900 udalosti nasucho zbytecne brzdilo stranku.
      const kolik = Math.min(4000, editorText(ed).length + 40);
      for (let i = 0; i < kolik; i++) {
        ed.dispatchEvent(new InputEvent("beforeinput", {
          inputType: "deleteContentBackward", bubbles: true, cancelable: true, composed: true }));
      }
      await sleep(200);
      ed.dispatchEvent(new InputEvent("beforeinput", {
        inputType: "insertText", data: text, bubbles: true, cancelable: true, composed: true }));
      await sleep(550);
      if (submitReady()) {
        const got = editorText(ed);
        if (got && !got.includes(text.slice(0, 20))) {
          log("v poli je něco jiného, než jsem psal - posílám to tak, jak to Flow vzalo", "warn");
        }
        return;
      }
    }
    throw new Error("Flow prompt nepřijal (odeslat zůstalo neaktivní).");
  }

  async function openSettings() {
    const b = bar();
    if (!b) throw new Error("Nenašel jsem ovládací pruh Flow.");
    const btns = [...b.querySelectorAll("button")];
    const setBtn =
      btns.find((x) => /x\d/.test(x.innerText || "")) || btns[btns.length - 2];
    if (!setBtn) throw new Error("Nenašel jsem tlačítko s nastavením.");
    realClick(setBtn);
    for (let i = 0; i < 24; i++) {
      await sleep(150);
      const p = popover();
      if (p) return p;
    }
    throw new Error("Panel s nastavením se neotevřel.");
  }

  async function closeSettings() {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await sleep(250);
    if (popover()) {
      const b = bar();
      const btns = b ? [...b.querySelectorAll("button")] : [];
      const setBtn = btns.find((x) => /x\d/.test(x.innerText || ""));
      if (setBtn) realClick(setBtn);
      await sleep(250);
    }
  }

  function creditEstimate(pop) {
    if (!pop) return null;
    const m = /([\d,.]+)\s*credit/i.exec(pop.innerText || "");
    if (!m) return null;
    const n = parseInt(m[1].replace(/[,.]/g, ""), 10);
    return Number.isNaN(n) ? null : n;
  }

  /* Rozbali seznam modelu kliknutim na aktualne vybrany model. */
  function openModelList(pop) {
    const re = /^(🍌\s*)?(Nano Banana|Veo|Omni|Imagen)/i;
    const hits = [];
    for (const el of pop.querySelectorAll(CLICKABLE + ",span,div")) {
      const t = (el.innerText || "").trim();
      if (t && re.test(t) && t.length < 40) hits.push(el);
    }
    if (!hits.length) return false;
    hits.sort((a, b) => (a.innerText || "").length - (b.innerText || "").length);
    return realClick(hits[0].closest(CLICKABLE) || hits[0]);
  }

  async function selectModel(pop, name) {
    if (!name) return;
    if ((pop.innerText || "").toLowerCase().includes(name.toLowerCase())) return;
    if (!openModelList(pop)) return; // seznam se nenasel - nechavame vychozi model
    await sleep(450);
    const menu = popover() || document.body;
    if (!clickIn(menu, name, false)) {
      log(`model "${name}" se v nabídce nenašel, nechávám výchozí`, "warn");
    }
    await sleep(350);
  }

  async function configure(job, count) {
    let pop = await openSettings();
    clickIn(pop, job.kind === "video" ? "Video" : "Image");
    await sleep(350);

    pop = popover() || pop;
    if (job.aspect) {
      clickIn(pop, job.aspect);
      await sleep(250);
      pop = popover() || pop;
    }
    if (job.model) {
      await selectModel(pop, job.model);
      pop = popover() || pop;
    }
    if (job.kind === "video" && job.duration) {
      clickIn(pop, job.duration + "s");
      await sleep(250);
      pop = popover() || pop;
    }

    // Počet se musí nastavit VŽDY, i u videa. Popover si drží, co bylo vybrané
    // naposledy - kdyby po obrázkové úloze s x4 přišlo video, Flow by udělalo
    // čtyři videa místo jednoho a strhlo čtyřnásobek kreditů.
    if (!clickIn(pop, "x" + count) && job.kind !== "video") {
      log(`nešlo nastavit počet x${count}`, "warn");
    }
    await sleep(250);
    pop = popover() || pop;

    const est = creditEstimate(pop);
    await closeSettings();
    return est;
  }

  /* Flow spusti generovani jen na skutecnou udalost od uzivatele.
     Syntetický klik ani syntetický Enter neprojdou - proto to jde pres
     ladici rozhrani prohlizece (viz background.js).

     Kdyz je na karte pripojeny jiny ladici nastroj, attach se nevrati vubec -
     bez limitu by smycka visela navzdy. */
  const LADENI_NEODPOVEDELO = {
    ok: false,
    error: "ladicí rozhraní neodpovědělo - je na kartě otevřený jiný ladicí nástroj?",
  };

  /* Vraci, cim se odeslani potvrdilo, nebo null. Poradi podle spolehlivosti:
     zachycene volani na generovani > vyprazdnene pole > ukazatel prubehu >
     jakykoliv zapis do Flow.

     Posledni signal je zamerne mekky. Kdyz Google prejmenuje volani, prestane
     sedet GENERATE_CALL a bez teto pojistky by se prompt poslal podruhe -
     u videa je to utracene kredity. Falesne potvrzeni je levnejsi: dávka jen
     nic nevrati a zopakuje se. */
  async function odeslaniPotvrzeno(od, limitMs) {
    const konec = Date.now() + limitMs;
    while (Date.now() < konec) {
      await sleep(300);
      if (lastGenerateTs >= od) return "síť";
      if (!submitReady()) return "pole se vyprázdnilo";
      if (document.querySelector('[role="progressbar"]')) return "průběh";
      if (lastPostTs >= od + 500) return "zápis do Flow";
    }
    return null;
  }

  async function submit() {
    const btn = submitButton();
    if (!btn) throw new Error("Nenašel jsem tlačítko odeslat.");
    if (!submitReady()) throw new Error("Flow prompt nepřevzal (odeslat je neaktivní).");

    const od = Date.now();
    const ed = editor();
    if (ed) ed.focus();

    // 1) duveryhodny klik presne na sipku - to same, co dela clovek
    const r = btn.getBoundingClientRect();
    if (r.width && r.height) {
      const res = await withTimeout(
        chrome.runtime.sendMessage({
          type: "trustedClick",
          x: Math.round(r.left + r.width / 2),
          y: Math.round(r.top + r.height / 2),
        }),
        8000,
        LADENI_NEODPOVEDELO
      );
      if (!res?.ok) {
        log(`klik na odeslat neprošel: ${res?.error}`, "warn");
      } else {
        // Kdyz bezi odposlech, mame tvrdy dukaz a staci kratke okno. Bez nej
        // se hada podle vzhledu - pak radeji kratce, at nasleduje Enter.
        const jak = await odeslaniPotvrzeno(od, netReady ? 7000 : 4000);
        if (jak) return jak;
      }
    }

    // 2) nahradni cesta - duveryhodny Enter v poli s promptem
    if (!submitReady()) return "pole se vyprázdnilo";
    if (ed) ed.focus();
    const res = await withTimeout(
      chrome.runtime.sendMessage({ type: "trustedEnter" }), 8000, LADENI_NEODPOVEDELO
    );
    if (!res?.ok) throw new Error(res?.error || "odeslání selhalo");

    const jak = await odeslaniPotvrzeno(od, 12000);
    if (jak) return jak;
    throw new Error("Flow na odeslání nezareagoval");
  }

  /* Vsechna media, ktera ted stranka zna. Avatary vyhazujeme. */
  function mediaSnapshot() {
    const out = new Set();
    for (const el of document.querySelectorAll("img, video")) {
      const src = el.currentSrc || el.src || el.getAttribute("poster") || "";
      if (!src || src.startsWith("blob:") || src.startsWith("data:")) continue;
      if (src.includes("googleusercontent.com/a/")) continue;
      const jeMedium = /googleusercontent\.com|storage\.googleapis\.com/.test(src)
        || (src.includes("/fx/api/trpc") && src.includes("name="));
      if (!jeMedium) continue;
      out.add(src);
    }
    return out;
  }

  function isBusy() {
    if (document.querySelectorAll('[role="progressbar"]').length) return true;
    return /Generating|Generuji/i.test(document.body.innerText || "");
  }

  /* od       = cas tesne pred odeslanim (media starsi nas nezajimaji)
     beforeDom = co bylo videt ve strance pred odeslanim (zaloha, kdyz
                 odposlech nic nechyti - treba po zmene struktury odpovedi) */
  async function waitForNewMedia(od, beforeDom, expected, wantVideo, onTick) {
    const timeout = state.settings.waitTimeoutSeconds * 1000;
    const started = Date.now();
    let lastChange = started;
    const found = [];

    const add = (url) => {
      if (found.includes(url)) return;
      found.push(url);
      lastChange = Date.now();
    };
    const zeSite = () => mediaSince(od, wantVideo);

    while (Date.now() - started < timeout) {
      await sleep(2000);
      if (!state.running) break;

      for (const url of zeSite()) add(url);
      // Odposlech je presnejsi, ale kdyz mlci, bereme aspon to, co je videt.
      if (!netReady || !found.length) {
        for (const url of mediaSnapshot()) if (!beforeDom.has(url)) add(url);
      }

      if (onTick) onTick(found.length);
      if (found.length >= expected) {
        await sleep(1500);
        for (const url of zeSite()) add(url); // dober, co dorazilo tesne potom
        return found;
      }
      if (!isBusy() && Date.now() - lastChange > 25000 && found.length) return found;
      // nic se negeneruje a minutu nic nepřibylo -> dávka propadla, nečekáme dál
      if (!isBusy() && !found.length && Date.now() - started > 60000) break;
    }
    if (found.length) return found;
    throw new Error("Vypršel čas a nepřibylo žádné médium.");
  }

  // -------------------------------------------------------------------------
  // stahovani
  // -------------------------------------------------------------------------

  function fullSize(url) {
    if (!url.includes("googleusercontent.com")) return url;
    return url.split("=")[0] + "=d";
  }

  function slug(text, max = 40) {
    return (
      (text || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^\w\s-]/g, "")
        .trim()
        .replace(/[\s_]+/g, "-")
        .slice(0, max)
        .replace(/^-+|-+$/g, "") || "bez-nazvu"
    );
  }

  function safe(part) {
    return String(part).replace(/[<>:"/\\|?*\x00-\x1f]/g, "-");
  }

  const jobFolder = (job) =>
    `${safe(job.tag || "default")}/${safe(slug(job.prompt))}-${job.id}`;

  async function downloadOne(url, filename, job) {
    const res = await withTimeout(
      chrome.runtime.sendMessage({ type: "download", url: fullSize(url), filename }),
      200000,
      { ok: false, error: "stahování neodpovědělo" }
    );
    // absolutni cesta, aby mustek mohl soubor presunout na Plochu
    if (res?.ok) return res.path || filename;

    // Nahradni cesta: kdyz chrome.downloads odmitne (blokovane hromadne
    // stahovani, "vzdy se ptat kam ukladat"), stahne bajty samo rozsireni
    // a posle je mustku, ktery je ulozi rovnou do cilove slozky.
    if (state.settings.bridgeEnabled) {
      const up = await withTimeout(
        chrome.runtime.sendMessage({
          type: "uploadToBridge",
          bridgeUrl: state.settings.bridgeUrl,
          url: fullSize(url),
          tag: jobFolder(job),
          name: filename.split("/").pop(),
        }),
        120000,
        { ok: false, error: "můstek neodpověděl" }
      );
      if (up?.ok && up.path) {
        log("prohlížeč stahování odmítl, uložil to můstek", "warn");
        return up.path;
      }
      throw new Error(`${res?.error || "stažení selhalo"} / můstek: ${up?.error || "?"}`);
    }
    throw new Error(res?.error || "stažení selhalo");
  }

  async function downloadAll(job, urls) {
    const dir = `FlowBridge/${jobFolder(job)}`;
    const ext = job.kind === "video" ? "mp4" : "png";
    for (const url of urls) {
      const n = String(job.done.length + 1).padStart(3, "0");
      try {
        const name = await downloadOne(url, `${dir}/${n}.${ext}`, job);
        job.done.push(name);
      } catch (e) {
        log(`stažení selhalo: ${e.message}`, "warn");
      }
      save();
      render();
    }
  }

  // -------------------------------------------------------------------------
  // motor fronty
  // -------------------------------------------------------------------------

  function nextJob() {
    return state.jobs.find(
      (j) => j.status === "queued" && (!j.notBefore || Date.now() >= j.notBefore)
    );
  }

  function planWave(remaining, per, maxBatches) {
    const wave = [];
    let left = remaining;
    for (let i = 0; i < maxBatches && left > 0; i++) {
      const size = Math.min(per, left);
      wave.push(size);
      left -= size;
    }
    return wave;
  }

  /* Flow oznaci neuspesnou generaci dlazdici s textem - poznáme to a
     stejny prompt pustime znovu. */
  function refusalNote() {
    const t = document.body.innerText || "";
    if (/unusual activity/i.test(t)) return "Flow hlásí neobvyklou aktivitu";
    if (/violate our policies/i.test(t)) return "prompt neprošel kontrolou obsahu";
    return null;
  }

  const randomPause = () => {
    const { pauseMinSeconds: a, pauseMaxSeconds: b } = state.settings;
    return (a + Math.random() * Math.max(0, b - a)) * 1000;
  };

  async function processJob(job) {
    job.status = "running";
    job.done = job.done || [];
    job.error = null;
    job.attempts = job.attempts || 0;
    save();
    render();

    const per = job.kind === "video" ? 1 : state.settings.batchSize;
    const maxB = job.kind === "video" ? 1 : state.settings.maxBatches;
    log(`start: ${job.kind} x${job.count} - ${job.prompt.slice(0, 60)}`);

    let prazdnychVln = 0;

    while (job.done.length < job.count && state.running) {
      const remaining = job.count - job.done.length;
      const wave = planWave(remaining, per, maxB);
      const beforeDom = mediaSnapshot();
      const od = Date.now();
      let submitted = 0;

      for (const size of wave) {
        if (!state.running) break;
        try {
          await setPrompt(job.prompt);
          const est = await configure(job, size);
          if (job.kind === "video" && est != null && est > state.settings.maxCreditsPerJob) {
            throw new Error(`odhad ${est} kr. překračuje strop ${state.settings.maxCreditsPerJob} kr.`);
          }
          const jak = await submit();
          submitted += size;
          if (est) job.credits = (job.credits || 0) + est;
          log(`odesláno ${size} ks${est != null ? ` (${est} kr.)` : ""} · potvrzeno: ${jak}`);
        } catch (e) {
          // jedna davka neprosla - zbytek vlny jede dal, chybejici kusy
          // se dopočítají v dalším kole
          log(`dávka neprošla: ${e.message || e}`, "warn");
        }
        render();
        await sleep(randomPause());
      }

      if (!submitted) {
        prazdnychVln++;
        if (prazdnychVln >= 3) throw new Error("třikrát po sobě se nepodařilo odeslat");
        await sleep(20000 * prazdnychVln);
        continue;
      }

      log(`čekám na ${submitted} výsledků...`);
      let urls = [];
      try {
        urls = await waitForNewMedia(od, beforeDom, submitted, job.kind === "video", (n) => {
          job.progress = n;
          render();
        });
      } catch (e) {
        log(`čekání skončilo bez výsledku: ${e.message || e}`, "warn");
      }
      job.progress = 0;

      if (urls.length) {
        prazdnychVln = 0;
        await downloadAll(job, urls.slice(0, submitted));
        log(`uloženo ${job.done.length}/${job.count}`);
      } else {
        prazdnychVln++;
      }

      // Flow zamitl generaci - stejny prompt zkusime znovu, ale s odstupem
      const note = refusalNote();
      if (urls.length < submitted) {
        job.attempts++;
        const chybi = submitted - urls.length;
        if (job.attempts > state.settings.maxAttempts) {
          throw new Error(`po ${job.attempts} pokusech chybí ${job.count - job.done.length} ks`
            + (note ? ` (${note})` : ""));
        }
        const odstup = 15000 * job.attempts + Math.random() * 10000;
        log(`chybí ${chybi} ks${note ? " - " + note : ""}, opakuji za `
          + `${Math.round(odstup / 1000)} s (pokus ${job.attempts}/${state.settings.maxAttempts})`, "warn");
        await sleep(odstup);
      }

      await sleep(state.settings.wavePauseSeconds * 1000 + Math.random() * 6000);
    }

    if (job.done.length >= job.count) {
      job.status = "done";
      job.finishedAt = Date.now();
      log(`hotovo: ${job.done.length} souborů`);
      pushToBridge(job);
    } else {
      job.status = "queued";
    }
  }

  const naProjektu = () => location.pathname.includes("/fx/tools/flow/project/");

  /* Bez otevreneho projektu neni kam psat prompt. Kdyz si projekt pamatujeme,
     prejdeme do nej sami - jinak by beh bez dozoru skoncil hned na zacatku. */
  /* Flow po prime navigaci na URL projektu obcas spadne na "Application error".
     Stranka se nacte, ale ovladaci pruh chybi. Pomuze obnoveni. */
  function strankaSpadla() {
    return /Application error|client-side exception/i.test(document.body.innerText || "");
  }

  let nacteno = false; // uz jsme pockali na prvni prival dat po nacteni?

  /* Pocitadlo obnoveni musi prezit reload, takze zije ve stavu, ne v promenne. */
  async function zajistiProjekt() {
    if (naProjektu()) {
      if (state.settings.projectUrl !== location.href) {
        state.settings.projectUrl = location.href;
        save();
      }

      // Flow vykresluje ovladaci pruh az par vterin po nacteni - pockame si.
      for (let i = 0; i < 30; i++) {
        if (editor()) {
          if (state.recovery) {
            state.recovery = 0;
            save();
          }
          // Po nacteni si Flow stahne seznam vseho, co uz v projektu je.
          // Kdybychom zaroven odeslali prompt, spletli bychom si starsi media
          // s cerstvymi - proto se necha tenhle prvni prival dobehnout.
          if (!nacteno) {
            nacteno = true;
            await sleep(5000);
          }
          return true;
        }
        if (i === 0 && strankaSpadla()) break;  // spadlou stranku nema smysl cekat
        await sleep(1000);
      }

      state.recovery = (state.recovery || 0) + 1;
      save();
      if (state.recovery <= 3) {
        log(`Flow nenaběhl${strankaSpadla() ? " (spadl na chybě)" : ""}, `
          + `obnovuji stránku (${state.recovery}/3)`, "warn");
        setTimeout(() => location.reload(), 2000);
      } else {
        log("Flow se nepodařilo rozběhnout ani po třech obnoveních - zastavuji", "error");
        state.running = false;
        save();
        render();
      }
      return false;
    }

    if (state.settings.projectUrl) {
      log("nejsem v projektu, přecházím do zapamatovaného");
      location.href = state.settings.projectUrl;
      return false;
    }
    log("otevři projekt ve Flow - nemám kam psát prompt", "warn");
    return false;
  }

  async function loop() {
    if (busy) return;
    busy = true;
    try {
      while (state.running) {
        if (!(await zajistiProjekt())) {
          await sleep(8000);
          continue;
        }
        const job = nextJob();
        if (!job) {
          await bridgeTick();
          await sleep(3000);
          continue;
        }
        try {
          await processJob(job);
        } catch (e) {
          job.status = "failed";
          job.error = String(e.message || e);
          log(`úloha selhala: ${job.error}`, "error");
          pushToBridge(job);
          // Chyby typu "nenasel jsem tlacitko" znamenaji, ze Flow zmenil vzhled.
          // Bez dumpu stranky se to zvenku nedá opravit, tak ho posleme rovnou.
          if (POTREBA_DIAGNOSTIKA.test(job.error)) {
            posliDump(`po chybě úlohy: ${job.error}`).catch(() => {});
          }
        }
        save();
        render();
      }
    } finally {
      busy = false;
      render();
    }
  }

  function start() {
    if (state.running) return;
    state.running = true;
    save();
    render();
    log("spuštěno");
    loop();
  }

  function stop() {
    state.running = false;
    save();
    render();
    log("zastaveno (rozdělaná dávka se ještě dokončí)");
  }

  // -------------------------------------------------------------------------
  // mustek na lokalni server (aby mohli prompty pridavat AI agenti)
  // -------------------------------------------------------------------------

  let lastBridge = 0;

  /* Vraci: "off" | "skip" | "down" | "empty" | "N uloh".
     Bezi na vlastnim casovaci, takze mustek funguje i kdyz fronta nejede. */
  async function bridgeTick(force = false) {
    if (!state.settings.bridgeEnabled) return "off";
    if (!force && Date.now() - lastBridge < 10000) return "skip";
    lastBridge = Date.now();
    try {
      // v tepu posilame i to, co panel prave dela - jde tak sledovat zvenci
      const diag = await chrome.runtime.sendMessage({ type: "diag" }).catch(() => null);
      chrome.runtime.sendMessage({
        type: "bridgeBeat",
        url: state.settings.bridgeUrl,
        payload: {
          umiLadit: diag?.umiLadit ?? null,
          chybaLadeni: diag?.posledniChyba || "",
          odposlech: netReady,
          running: state.running,
          autopilot: !!state.settings.autopilot,
          busy,
          queued: state.jobs.filter((j) => j.status === "queued").length,
          done: state.jobs.filter((j) => j.status === "done").length,
          failed: state.jobs.filter((j) => j.status === "failed").length,
          lastLog: state.log[0]?.msg || "",
          project: naProjektu(),
          // Adresu projektu si mustek zapamatuje, aby ji znal dashboard i agenti.
          projectUrl: naProjektu() ? location.href : null,
          credits: creditBalance,
          // Ulohy, ktere prave drzime - mustek jim posune casovac, aby si je
          // po 45 minutach nevzal zpatky jako zaseknute.
          held: state.jobs
            .filter((j) => j.bridgeId && j.status !== "done" && j.status !== "failed")
            .map((j) => j.bridgeId),
        },
      });
      const res = await chrome.runtime.sendMessage({
        type: "bridgePull",
        url: state.settings.bridgeUrl,
      });
      if (!res?.ok) return "down";
      // Kdyz mustek zna adresu projektu a my v zadnem nejsme, prejdeme do nej.
      if (res.project_url && !state.settings.projectUrl) {
        state.settings.projectUrl = res.project_url;
        save();
      }
      if (!Array.isArray(res.jobs) || !res.jobs.length) return "empty";
      let added = 0;
      for (const j of res.jobs) {
        if (state.jobs.some((x) => x.bridgeId === j.id)) continue;
        state.jobs.push({
          id: nowId(),
          bridgeId: j.id,
          kind: j.kind || "image",
          prompt: j.prompt,
          count: j.count || 4,
          model: j.model || null,
          aspect: j.aspect || null,
          duration: j.duration || null,
          tag: j.tag || "agent",
          status: "queued",
          done: [],
          createdAt: Date.now(),
        });
        added++;
      }
      if (added) {
        save();
        render();
        // Autopilot: prompty od agentů se maji odbavit samy, i kdyz u toho
        // nikdo nesedi. To je cely smysl mustku.
        if (state.settings.autopilot && !state.running) {
          log(`z můstku přibylo ${added} úloh od agentů - spouštím`);
          start();
        } else {
          log(
            `z můstku přibylo ${added} úloh od agentů` +
              (state.running ? "" : " - klikni Spustit")
          );
        }
      }
      return added ? `${added} úloh` : "empty";
    } catch {
      return "down"; // mustek nebezi - to je v poradku
    }
  }

  async function pushToBridge(job) {
    if (!state.settings.bridgeEnabled || !job.bridgeId) return;
    try {
      await chrome.runtime.sendMessage({
        type: "bridgePush",
        url: state.settings.bridgeUrl,
        payload: {
          id: job.bridgeId,
          status: job.status,
          files: job.done,
          credits: job.credits || 0,
          error: job.error || null,
        },
      });
    } catch {
      /* nevadi */
    }
  }

  // -------------------------------------------------------------------------
  // diagnostika (dump stranky)
  //
  // Flow nema stabilni CSS tridy ani testid, takze se vsechno hleda podle
  // textu. Kdyz Google neco prejmenuje, prestane sedet jediny selektor a
  // zvenci to nikdo neuvidi. Tenhle dump vytahne presne to, co je k oprave
  // potreba - popisky tlacitek, obsah popoveru a nazvy sitovych volani -
  // a posle ho mustku, ktery ho ulozi do souboru.
  // -------------------------------------------------------------------------

  const POTREBA_DIAGNOSTIKA =
    /Nenašel jsem|neotevřel|nepřijal|nepřevzal|nezareagoval|nepodařilo|nepřibylo/i;

  let dumpBezi = false;

  function popisPrvku(el) {
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role") || null,
      text: norm(el).slice(0, 120),
      aria: el.getAttribute("aria-label") || null,
      disabled: el.getAttribute("aria-disabled") === "true" || !!el.disabled,
      rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
    };
  }

  async function sbirejDump(duvod) {
    const ed = editor();
    const b = bar();
    const sb = submitButton();
    const dump = {
      duvod: duvod || "ruční",
      cas: new Date().toISOString(),
      url: location.href,
      titulek: document.title,
      verze: chrome.runtime.getManifest().version,
      naProjektu: naProjektu(),
      spadlo: strankaSpadla(),
      generuje: isBusy(),
      odmitnuti: refusalNote(),
      odposlech: {
        bezi: netReady,
        medii: netMedia.length,
        posledniGenerovani: lastGenerateTs || null,
      },
      kredity: creditBalance,
      editor: ed ? popisPrvku(ed) : null,
      editorText: ed ? editorText(ed).slice(0, 200) : null,
      pruh: b ? [...b.querySelectorAll("button")].map(popisPrvku) : null,
      odeslat: sb ? { ...popisPrvku(sb), pripraveno: submitReady() } : null,
      popover: null,
      volani: netCalls.slice(0, 40),
      posledniMedia: netMedia.slice(-6).map((m) => ({
        url: m.url.slice(0, 200), video: m.isVideo,
      })),
      log: state.log.slice(0, 25),
      // Vlastni panel z textu stranky vynechavame - jinak by dump obsahoval
      // hlavne svuj vlastni log a to podstatne by se v nem ztratilo.
      text: [...document.body.children]
        .filter((el) => el.id !== "flowbridge-panel")
        .map((el) => el.innerText || "")
        .join("\n")
        .slice(0, 3000),
    };

    // Popover se musi otevrit, jinak jeho obsah v DOM vubec neni.
    try {
      const pop = await openSettings();
      dump.popover = {
        text: (pop.innerText || "").slice(0, 1500),
        tlacitka: [...pop.querySelectorAll(CLICKABLE)].map(popisPrvku).slice(0, 60),
        odhadKreditu: creditEstimate(pop),
      };
      await closeSettings();
    } catch (e) {
      dump.popover = { chyba: String(e.message || e) };
    }

    dump.ladeni = await withTimeout(
      chrome.runtime.sendMessage({ type: "diag" }), 4000,
      { chyba: "service worker neodpověděl" }
    );
    return dump;
  }

  async function posliDump(duvod) {
    if (dumpBezi) return null;
    dumpBezi = true;
    try {
      const dump = await sbirejDump(duvod);
      console.log("[FlowBridge] dump stránky", dump); // pojistka, kdyz mustek nebezi
      if (!state.settings.bridgeEnabled) {
        log("diagnostika je v konzoli (F12) – můstek je vypnutý", "warn");
        return dump;
      }
      const res = await withTimeout(
        chrome.runtime.sendMessage({
          type: "bridgeDump", url: state.settings.bridgeUrl, payload: dump,
        }),
        10000,
        { ok: false, error: "můstek neodpověděl" }
      );
      if (res?.ok) log(`diagnostika uložena: ${res.path || "můstek"}`);
      else log(`diagnostiku se nepodařilo odeslat: ${res?.error} – je v konzoli (F12)`, "warn");
      return dump;
    } finally {
      dumpBezi = false;
    }
  }

  // -------------------------------------------------------------------------
  // panel
  // -------------------------------------------------------------------------

  let panel = null;

  function buildPanel() {
    panel = document.createElement("div");
    panel.id = "flowbridge-panel";
    panel.innerHTML = `
      <div class="fb-head">
        <span class="fb-dot" id="fb-dot"></span>
        <span class="fb-title">FlowBridge</span>
        <button class="fb-x" id="fb-collapse" title="sbalit">–</button>
      </div>
      <div class="fb-body">
        <label>prompty (jeden na řádek)</label>
        <textarea id="fb-prompt" placeholder="neonová kočka na střeše, filmové světlo"></textarea>
        <div class="fb-row">
          <div>
            <label>typ</label>
            <select id="fb-kind">
              <option value="image">obrázek</option>
              <option value="video">video</option>
            </select>
          </div>
          <div>
            <label>kusů</label>
            <select id="fb-count">
              <option>1</option><option>2</option><option>3</option><option>4</option>
              <option>8</option><option selected>12</option>
            </select>
          </div>
        </div>
        <div class="fb-row">
          <div>
            <label>poměr</label>
            <select id="fb-aspect">
              <option value="">výchozí</option>
              <option>16:9</option><option>4:3</option><option>1:1</option>
              <option>3:4</option><option>9:16</option>
            </select>
          </div>
          <div>
            <label>délka videa</label>
            <select id="fb-duration">
              <option value="">–</option>
              <option>4</option><option>6</option><option>8</option><option>10</option>
            </select>
          </div>
        </div>
        <label>model (prázdné = co je zrovna nastavené)</label>
        <input id="fb-model" placeholder="Nano Banana 2">
        <label>složka pro výstupy</label>
        <input id="fb-tag" value="default">
        <div class="fb-row">
          <div>
            <label>pauza min (s)</label>
            <input id="fb-pmin" type="number" min="1" max="120" step="1">
          </div>
          <div>
            <label>pauza max (s)</label>
            <input id="fb-pmax" type="number" min="1" max="300" step="1">
          </div>
        </div>
        <div class="fb-row" style="margin-top:12px">
          <button id="fb-add">Přidat do fronty</button>
          <button id="fb-run" class="fb-ghost">Spustit</button>
        </div>
        <div class="fb-hint">Stahuje se do <b>Stažené soubory / FlowBridge</b>.</div>
        <div id="fb-jobs"></div>
        <div class="fb-row" style="margin-top:10px">
          <button class="fb-ghost" id="fb-clear">Uklidit hotové</button>
          <button class="fb-ghost" id="fb-bridge">Můstek: vyp</button>
        </div>
        <div class="fb-row" style="margin-top:6px">
          <button class="fb-ghost" id="fb-auto" title="sám spustí frontu, jakmile přibude úloha">Autopilot: zap</button>
          <button class="fb-ghost" id="fb-dump" title="uloží stav stránky pro opravu selektorů">Diagnostika</button>
        </div>
        <div class="fb-log" id="fb-log"></div>
      </div>`;
    document.body.appendChild(panel);

    panel.querySelector("#fb-collapse").onclick = () => {
      state.settings.collapsed = !state.settings.collapsed;
      panel.classList.toggle("fb-collapsed", state.settings.collapsed);
      panel.querySelector("#fb-collapse").textContent = state.settings.collapsed ? "+" : "–";
      save();
    };
    const pmin = panel.querySelector("#fb-pmin");
    const pmax = panel.querySelector("#fb-pmax");
    pmin.value = state.settings.pauseMinSeconds;
    pmax.value = state.settings.pauseMaxSeconds;
    // pauzy mezi odeslanimi jsou nahodne v tomhle rozmezi
    pmin.onchange = () => { state.settings.pauseMinSeconds = Math.max(1, +pmin.value || 4); save(); };
    pmax.onchange = () => { state.settings.pauseMaxSeconds = Math.max(+pmin.value || 4, +pmax.value || 11); save(); };

    panel.querySelector("#fb-add").onclick = addFromForm;
    panel.querySelector("#fb-run").onclick = () => (state.running ? stop() : start());
    panel.querySelector("#fb-clear").onclick = () => {
      state.jobs = state.jobs.filter((j) => j.status !== "done" && j.status !== "failed");
      save();
      render();
    };
    panel.querySelector("#fb-auto").onclick = () => {
      state.settings.autopilot = !state.settings.autopilot;
      save();
      render();
      log(state.settings.autopilot
        ? "autopilot zapnut - nové úlohy se spustí samy"
        : "autopilot vypnut - frontu spouštíš ručně");
      if (state.settings.autopilot && !state.running && nextJob()) start();
    };

    panel.querySelector("#fb-dump").onclick = async () => {
      log("sbírám diagnostiku...");
      await posliDump("ruční");
    };

    panel.querySelector("#fb-bridge").onclick = async () => {
      state.settings.bridgeEnabled = !state.settings.bridgeEnabled;
      save();
      render();
      if (!state.settings.bridgeEnabled) {
        log("můstek vypnut");
        return;
      }
      log(`můstek zapnut, zkouším ${state.settings.bridgeUrl} ...`);
      const res = await bridgeTick(true);
      if (res === "down") {
        log("můstek neodpovídá - spusť: python -m flowbridge dashboard", "warn");
      } else if (res === "empty") {
        log("můstek připojen, ve frontě od agentů zatím nic");
      }
    };

    makeDraggable(panel, panel.querySelector(".fb-head"));
    panel.classList.toggle("fb-collapsed", !!state.settings.collapsed);
  }

  function addFromForm() {
    const raw = panel.querySelector("#fb-prompt").value;
    const prompts = raw.split("\n").map((s) => s.trim()).filter(Boolean);
    if (!prompts.length) return;
    const kind = panel.querySelector("#fb-kind").value;
    const count = parseInt(panel.querySelector("#fb-count").value, 10);
    const aspect = panel.querySelector("#fb-aspect").value || null;
    const duration = parseInt(panel.querySelector("#fb-duration").value, 10) || null;
    const model = panel.querySelector("#fb-model").value.trim() || null;
    const tag = panel.querySelector("#fb-tag").value.trim() || "default";

    for (const prompt of prompts) {
      state.jobs.push({
        id: nowId(),
        kind,
        prompt,
        count: kind === "video" ? Math.min(count, 4) : count,
        model,
        aspect,
        duration,
        tag,
        status: "queued",
        done: [],
        createdAt: Date.now(),
      });
    }
    panel.querySelector("#fb-prompt").value = "";
    log(`přidáno ${prompts.length} úloh`);
    save();
    render();
    if (state.settings.autopilot && !state.running) start();
  }

  function makeDraggable(el, handle) {
    let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
    handle.addEventListener("mousedown", (e) => {
      if (e.target.closest("button")) return;
      dragging = true;
      const r = el.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
      e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      el.style.left = ox + e.clientX - sx + "px";
      el.style.top = oy + e.clientY - sy + "px";
      el.style.right = "auto";
      el.style.bottom = "auto";
    });
    window.addEventListener("mouseup", () => (dragging = false));
  }

  function esc(s) {
    return String(s || "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
  }

  function render() {
    if (!panel) return;
    const dot = panel.querySelector("#fb-dot");
    dot.className = "fb-dot" + (busy ? " busy" : state.running ? " on" : "");
    panel.querySelector("#fb-run").textContent = state.running ? "Zastavit" : "Spustit";
    panel.querySelector("#fb-bridge").textContent =
      "Můstek: " + (state.settings.bridgeEnabled ? "zap" : "vyp");
    panel.querySelector("#fb-auto").textContent =
      "Autopilot: " + (state.settings.autopilot ? "zap" : "vyp");

    const jobs = [...state.jobs].sort((a, b) => {
      const order = { running: 0, queued: 1, failed: 2, done: 3 };
      return (order[a.status] - order[b.status]) || (b.createdAt - a.createdAt);
    });

    panel.querySelector("#fb-jobs").innerHTML = jobs
      .slice(0, 40)
      .map((j) => {
        const got = (j.done || []).length + (j.progress ? ` +${j.progress}` : "");
        return `<div class="fb-job">
          <div class="fb-job-top">
            <span class="fb-badge ${j.status}">${j.status}</span>
            <span class="fb-prompt" title="${esc(j.prompt)}">${esc(j.prompt)}</span>
            <button class="fb-x" data-del="${j.id}" title="odebrat">×</button>
          </div>
          <div class="fb-meta">${j.kind === "video" ? "video" : "obrázky"} ·
            ${got}/${j.count} · ${esc(j.tag)}${j.credits ? " · " + j.credits + " kr." : ""}</div>
          ${j.error ? `<div class="fb-err">${esc(j.error)}</div>` : ""}
        </div>`;
      })
      .join("");

    panel.querySelectorAll("[data-del]").forEach((b) => {
      b.onclick = () => {
        state.jobs = state.jobs.filter((x) => x.id !== b.dataset.del);
        save();
        render();
      };
    });

    renderLog();
  }

  function renderLog() {
    if (!panel) return;
    const box = panel.querySelector("#fb-log");
    if (!box) return;
    box.innerHTML = state.log
      .slice(0, 30)
      .map((e) => {
        const t = new Date(e.ts).toLocaleTimeString("cs-CZ");
        return `<div class="${e.level}">${t} — ${esc(e.msg)}</div>`;
      })
      .join("");
  }

  // -------------------------------------------------------------------------

  /* Most pro stránku: Flow bezi na https, takze na localhost nedosahne (CSP)
     a hromadne stahovani mu Chrome zablokuje. Rozsireni ale stahovaci API
     pouzivat smi, takze mu stranka posle URL a ono je ulozi. */
  window.addEventListener("message", async (ev) => {
    if (ev.source !== window || ev.data?.__fbCmd !== "download") return;
    const { urls = [], tag = "default", prefix = "flow", ext = "png", id } = ev.data;
    const results = [];
    for (let i = 0; i < urls.length; i++) {
      const name = `FlowBridge/${safe(tag)}/${safe(prefix)}-${String(i + 1).padStart(3, "0")}.${ext}`;
      try {
        const res = await chrome.runtime.sendMessage({ type: "download", url: urls[i], filename: name });
        results.push(res?.ok ? (res.path || name) : "chyba: " + (res?.error || "?"));
      } catch (e) {
        results.push("chyba: " + (e.message || e));
      }
    }
    log(`na žádost stránky uloženo ${results.filter((r) => !r.startsWith("chyba")).length}/${urls.length}`);
    window.postMessage({ __fbResult: "download", id, results }, "*");
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === "ping") {
      sendResponse({ ok: true });
      return true;
    }
    if (msg?.type === "togglePanel" && panel) {
      panel.style.display = panel.style.display === "none" ? "flex" : "none";
    }
    if (msg?.type === "bridgeTick") bridgeTick(true);
    return false;
  });

  (async function init() {
    await load();
    // inject.js bezi uz od document_start, takze jeho ohlaseni jsme nemohli
    // slyset - znacku v DOM ale ano.
    if (document.documentElement.getAttribute("data-fb-net") === "1") netReady = true;

    buildPanel();
    render();
    if (naProjektu()) {
      state.settings.projectUrl = location.href;
      save();
    }
    log(`panel připraven${netReady ? "" : " (odposlech sítě neběží - načti rozšíření znovu)"}`);

    // mustek se pta na ulohy nezavisle na tom, jestli fronta zrovna bezi
    setInterval(() => {
      if (state.settings.bridgeEnabled) bridgeTick();
    }, 10000);
    if (state.settings.bridgeEnabled) bridgeTick(true);

    // Beh prezije obnoveni stranky i zavreni prohlizece. S autopilotem staci,
    // ze ve fronte neco ceka - proto se nic nemusi klikat.
    if (state.running || (state.settings.autopilot && nextJob())) {
      state.running = true;
      save();
      render();
      loop();
    }
  })();
})();
