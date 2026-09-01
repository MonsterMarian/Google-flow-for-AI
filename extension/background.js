/*
 * Service worker.
 *
 * Dela tri veci, ktere obsah stranky sam nezvladne:
 *   1. dostane panel i do zalozek, ktere byly otevrene uz pred instalaci,
 *   2. stahuje hotova media (chrome.downloads obchazi CORS),
 *   3. mluvi s lokalnim mustkem na 127.0.0.1, aby mohli prompty do fronty
 *      pridavat i AI agenti pres MCP.
 */

const FLOW_MATCH = "https://labs.google/fx/tools/flow*";

/* Content script se sam vlozi jen do stranek nactenych po instalaci.
   Do uz otevrenych zalozek ho musime dostat rucne. */
async function ensureInjected(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "ping" });
    return true;
  } catch {
    try {
      // Odposlech site musi do hlavniho sveta stranky, panel do izolovaneho.
      // Do uz nactene stranky prijde pozde, takze zachyti jen dalsi volani -
      // proto se stejny soubor vklada i deklarativne na document_start.
      await chrome.scripting.executeScript({
        target: { tabId }, files: ["inject.js"], world: "MAIN",
      });
      await chrome.scripting.insertCSS({ target: { tabId }, files: ["panel.css"] });
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
      return true;
    } catch {
      return false;
    }
  }
}

async function injectEverywhere() {
  try {
    const tabs = await chrome.tabs.query({ url: FLOW_MATCH });
    for (const t of tabs) await ensureInjected(t.id);
  } catch {
    /* zadne zalozky s Flow - nic k reseni */
  }
}

chrome.runtime.onInstalled.addListener(injectEverywhere);
chrome.runtime.onStartup.addListener(injectEverywhere);

chrome.action.onClicked.addListener(async (tab) => {
  if (tab?.url?.includes("labs.google/fx/tools/flow")) {
    const ok = await ensureInjected(tab.id);
    if (!ok) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "togglePanel" });
    } catch {
      /* panel se prave vlozil a je videt - nic dalsiho netreba */
    }
  } else {
    chrome.tabs.create({ url: "https://labs.google/fx/tools/flow" });
  }
});

/* ---------------------------------------------------------------------------
 * Duveryhodne odeslani
 *
 * Flow spusti generovani jen na skutecnou udalost od uzivatele - syntetický
 * klik ani syntetický Enter ze stranky neprojdou. Jedina cesta, kterou ma
 * rozsireni k dispozici, je ladici rozhrani prohlizece: Input.dispatchKeyEvent
 * posila vstup na stejne urovni jako klavesnice.
 *
 * Proto ta lista "FlowBridge ladi tento prohlizec" - bez ni to nejde.
 * ------------------------------------------------------------------------- */

const attached = new Set();
let lastAttachError = "";

/* Kdyz Chrome opravneni "debugger" jeste nepovolil, je chrome.debugger
   undefined. Bez teto pojistky by na tom spadl cely service worker uz pri
   nacteni - a s nim i stahovani a mustek. */
const umiLadit = () => typeof chrome.debugger !== "undefined";

async function ensureDebugger(tabId) {
  if (!umiLadit()) {
    lastAttachError =
      "rozšíření nemá oprávnění debugger - v chrome://extensions ho zapni a načti znovu";
    return false;
  }
  if (attached.has(tabId)) return true;
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    attached.add(tabId);
    return true;
  } catch (e) {
    const msg = String(e?.message || e);
    // Chrome pusti na jednu kartu jen jednoho ladicího klienta. Kdyz je
    // pripojeny nekdo jiny (otevrene DevTools, jiny nastroj), musime to rict
    // nahlas - jinak by odesilani tise selhavalo.
    lastAttachError = msg.includes("Another debugger") || msg.includes("already attached")
      ? "na této kartě už je připojený jiný ladicí nástroj (zavři DevTools) "
      : msg;
    return false;
  }
}


async function trustedEnter(tabId) {
  if (!(await ensureDebugger(tabId))) {
    return { ok: false, error: lastAttachError || "nepodařilo se připojit ladicí rozhraní" };
  }
  const key = {
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
  };
  try {
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent",
      { type: "keyDown", ...key, text: "\r" });
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent",
      { type: "char", ...key, text: "\r" });
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent",
      { type: "keyUp", ...key });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

async function trustedClick(tabId, x, y) {
  if (!(await ensureDebugger(tabId))) {
    return { ok: false, error: lastAttachError || "nepodařilo se připojit ladicí rozhraní" };
  }
  const base = { x, y, button: "left", clickCount: 1, pointerType: "mouse" };
  try {
    // React vetsinou reaguje uz na pointerdown, ale nektera tlacitka cekaji na
    // cely cyklus. Posilame proto pohyb -> stisk -> uvolneni, jako mys.
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent",
      { type: "mouseMoved", x, y, buttons: 0, pointerType: "mouse" });
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent",
      { type: "mousePressed", ...base, buttons: 1 });
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent",
      { type: "mouseReleased", ...base, buttons: 0 });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/* ---------------------------------------------------------------------------
 * Predlohy: podstrceni souboru do dialogu na vyber souboru
 *
 * Ze stranky se do nahravaciho vstupu Flow zapsat neda - zmereno naostro:
 * prirazeni .files nahravani nespusti. DOM.setFileInputFiles ale nastavi
 * soubory na urovni prohlizece, takze Flow dostane duveryhodnou udalost,
 * uplne stejnou jako kdyz soubor vybere clovek. Zadny dialog se neotevre.
 *
 * Vstup existuje jen dokud je otevreny vyber medii ("Create" v ovladacim
 * pruhu) - o to se stara content.js.
 *
 * DOM.setFileInputFiles bere cesty na disku, ne bajty - proto predlohy
 * musi lezet v souboru.
 * ------------------------------------------------------------------------- */

/* Ktery z vstupu na strance je ten pravy, pozna jen obsahovy skript - ridi se
   tim, ze na nem visi React (a ze neni nas vlastni). Ladici rozhrani na
   vlastnosti JS nedosahne, takze si ho content.js oznaci timhle atributem
   a my ho najdeme podle nej. */
const CIL_ATRIBUT = "data-flowbridge-cil";

async function attachFiles(tabId, paths) {
  if (!Array.isArray(paths) || !paths.length) {
    return { ok: false, error: "žádné cesty k předlohám" };
  }
  if (!(await ensureDebugger(tabId))) {
    return { ok: false, error: lastAttachError || "nepodařilo se připojit ladicí rozhraní" };
  }

  try {
    await chrome.debugger.sendCommand({ tabId }, "DOM.enable");
    const { root } = await chrome.debugger.sendCommand({ tabId }, "DOM.getDocument",
      { depth: 0 });
    const { nodeId } = await chrome.debugger.sendCommand({ tabId }, "DOM.querySelector",
      { nodeId: root.nodeId, selector: `input[${CIL_ATRIBUT}]` });

    if (!nodeId) return { ok: false, error: "označený vstup pro soubory se v DOM nenašel" };

    // Tohle nastavi soubory na urovni prohlizece, takze Flow dostane
    // duveryhodnou udalost - stejnou, jako kdyz soubor vybere clovek.
    // Zapis .files ze stranky Flow ignoruje, tohle ne.
    await chrome.debugger.sendCommand({ tabId }, "DOM.setFileInputFiles",
      { nodeId, files: paths });
    return { ok: true, files: paths.length };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

function releaseDebugger(tabId) {
  if (!attached.has(tabId)) return;
  attached.delete(tabId);
  chrome.debugger.detach({ tabId }).catch(() => {});
}

if (umiLadit()) {
  chrome.debugger.onDetach.addListener((source) => {
    if (source.tabId != null) attached.delete(source.tabId);
  });
}

chrome.tabs.onRemoved.addListener((tabId) => attached.delete(tabId));

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "trustedEnter") {
    trustedEnter(sender.tab.id).then(sendResponse);
    return true;
  }

  if (msg?.type === "trustedClick") {
    trustedClick(sender.tab.id, msg.x, msg.y).then(sendResponse);
    return true;
  }

  if (msg?.type === "diag") {
    sendResponse({
      ok: true,
      umiLadit: umiLadit(),
      pripojeno: [...attached],
      posledniChyba: lastAttachError,
    });
    return true;
  }

  if (msg?.type === "releaseDebugger") {
    releaseDebugger(sender.tab.id);
    sendResponse({ ok: true });
    return true;
  }

  if (msg?.type === "download") {
    downloadAndWait(msg.url, msg.filename).then(sendResponse);
    return true; // odpoved prijde asynchronne
  }

  if (msg?.type === "bridgePull") {
    bridgeGet(msg.url, "/ext/pull").then(sendResponse);
    return true;
  }

  if (msg?.type === "bridgePush") {
    bridgePost(msg.url, "/ext/report", msg.payload).then(sendResponse);
    return true;
  }

  if (msg?.type === "bridgeLog") {
    bridgePost(msg.url, "/ext/log", msg.payload || {}).then(sendResponse);
    return true;
  }

  if (msg?.type === "bridgeBeat") {
    bridgePost(msg.url, "/ext/heartbeat", msg.payload || {}).then(sendResponse);
    return true;
  }

  if (msg?.type === "bridgeDump") {
    bridgePost(msg.url, "/ext/dump", msg.payload || {}).then(sendResponse);
    return true;
  }

  if (msg?.type === "uploadToBridge") {
    fetchAndUpload(msg.bridgeUrl, msg.url, msg.tag, msg.name).then(sendResponse);
    return true;
  }

  if (msg?.type === "attachFiles") {
    attachFiles(sender.tab.id, msg.paths).then(sendResponse);
    return true;
  }

  if (msg?.type === "refToDisk") {
    refToDisk(msg.bridgeUrl, msg.dataUrl, msg.name).then(sendResponse);
    return true;
  }

  return false;
});

/* Stahne soubor a POCKA, az je opravdu na disku.
   Vraci absolutni cestu, aby ho mustek mohl rovnou presunout jinam. */
function downloadAndWait(url, filename) {
  return new Promise((resolve) => {
    chrome.downloads.download(
      { url, filename, conflictAction: "uniquify", saveAs: false },
      (id) => {
        if (chrome.runtime.lastError || id == null) {
          resolve({
            ok: false,
            error: chrome.runtime.lastError?.message || "stahování se nespustilo",
          });
          return;
        }

        const finish = (result) => {
          chrome.downloads.onChanged.removeListener(onChanged);
          clearTimeout(timer);
          resolve(result);
        };

        const onChanged = (delta) => {
          if (delta.id !== id) return;
          const st = delta.state?.current;
          if (st === "complete") {
            chrome.downloads.search({ id }, (items) => {
              finish({ ok: true, downloadId: id, path: items?.[0]?.filename || null });
            });
          } else if (st === "interrupted") {
            finish({ ok: false, error: "stahování přerušeno" });
          }
        };

        chrome.downloads.onChanged.addListener(onChanged);

        // pojistka, kdyby udalost nedorazila
        const timer = setTimeout(() => {
          chrome.downloads.search({ id }, (items) => {
            const it = items?.[0];
            finish(
              it?.state === "complete"
                ? { ok: true, downloadId: id, path: it.filename }
                : { ok: false, error: "vypršel čas stahování" }
            );
          });
        }, 180000);
      }
    );
  });
}

async function bridgeGet(baseUrl, path) {
  try {
    const r = await fetch(baseUrl.replace(/\/$/, "") + path, { cache: "no-store" });
    if (!r.ok) return { ok: false, error: "HTTP " + r.status };
    return { ok: true, ...(await r.json()) };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

/* Nahradni cesta ke stazeni.
 *
 * chrome.downloads umi ulozit jen do slozky Stazene soubory a obcas ho zastavi
 * nastaveni prohlizece (napr. "vzdy se ptat, kam ukladat"). Kdyz selze, stahne
 * soubor rovnou service worker a posle bajty mustku, ktery je ulozi do cilove
 * slozky. Rozsireni ma na obe domeny opravneni, takze ho CORS nebrzdi. */
async function fetchAndUpload(bridgeUrl, url, tag, name) {
  if (!bridgeUrl) return { ok: false, error: "můstek není zapnutý" };
  try {
    const r = await fetch(url, { credentials: "include", cache: "no-store" });
    if (!r.ok) return { ok: false, error: "zdroj HTTP " + r.status };
    const blob = await r.blob();
    if (!blob.size) return { ok: false, error: "prázdný soubor" };
    const dest =
      bridgeUrl.replace(/\/$/, "") +
      "/ext/upload?tag=" + encodeURIComponent(tag || "default") +
      "&name=" + encodeURIComponent(name || "soubor");
    const up = await fetch(dest, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: blob,
    });
    if (!up.ok) return { ok: false, error: "můstek HTTP " + up.status };
    return { ok: true, ...(await up.json()) };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/* Predloha z panelu na disk.
 *
 * DOM.setFileInputFiles umi podstrcit jen soubor, ktery na disku existuje.
 * Predlohu vybranou v panelu ma ale prohlizec jen jako bajty - skutecnou
 * cestu k ni prohlizec z bezpecnostnich duvodu nerekne. Posleme ji proto
 * mustku, ktery ji ulozi a vrati cestu, na kterou uz ladici rozhrani dosahne.
 *
 * Bez beziciho mustku tudiz predlohy z panelu nejdou pouzit - u uloh od
 * agentu to nevadi, tam cesta na disku uz existuje. */

const MAX_REF_BYTES = 24 * 1024 * 1024;

async function refToDisk(bridgeUrl, dataUrl, name) {
  if (!bridgeUrl) return { ok: false, error: "můstek není zapnutý" };
  if (!dataUrl) return { ok: false, error: "předloha nemá obsah" };
  try {
    const blob = await (await fetch(dataUrl)).blob();
    if (!blob.size) return { ok: false, error: "předloha je prázdná" };
    if (blob.size > MAX_REF_BYTES) {
      return { ok: false, error: `předloha má ${Math.round(blob.size / 1048576)} MB `
                                 + `(strop je ${MAX_REF_BYTES / 1048576} MB)` };
    }
    const dest = bridgeUrl.replace(/\/$/, "")
      + "/ext/upload?tag=" + encodeURIComponent("_predlohy")
      + "&name=" + encodeURIComponent(name || "predloha.png");
    const up = await fetch(dest, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: blob,
    });
    if (!up.ok) return { ok: false, error: "můstek HTTP " + up.status };
    const data = await up.json();
    if (!data?.path) return { ok: false, error: "můstek nevrátil cestu" };
    return { ok: true, path: data.path, bytes: blob.size };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

async function bridgePost(baseUrl, path, payload) {
  try {
    const r = await fetch(baseUrl.replace(/\/$/, "") + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });
    if (!r.ok) return { ok: false, error: "HTTP " + r.status };
    return { ok: true, ...(await r.json()) };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}
