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

  if (msg?.type === "refGet") {
    refGet(msg.bridgeUrl, msg.path).then(sendResponse);
    return true;
  }

  if (msg?.type === "refPut") {
    refPut(msg.bridgeUrl, msg.name, msg.base64).then(sendResponse);
    return true;
  }

  return false;
});

/* ---------------------------------------------------------------------------
 * Predlohy (obrazky, ktere jdou do promptu)
 *
 * Obsahovy skript na disk nevidi a mustek je na jine adrese, takze bajty vozi
 * service worker. Prenasi se base64 - zpravy mezi castmi rozsireni se
 * serializuji jako JSON, cimz by Blob ani ArrayBuffer neprosly.
 * ------------------------------------------------------------------------- */

/* String.fromCharCode(...pole) spadne na velkem obrazku (prekroci limit
   argumentu), proto po kouscich. */
function bytesToBase64(bytes) {
  let bin = "";
  const krok = 0x8000;
  for (let i = 0; i < bytes.length; i += krok) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + krok));
  }
  return btoa(bin);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function refGet(bridgeUrl, path) {
  if (!bridgeUrl) return { ok: false, error: "můstek není zapnutý" };
  try {
    const url = bridgeUrl.replace(/\/$/, "") + "/ext/ref?path=" + encodeURIComponent(path);
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) {
      let detail = "HTTP " + r.status;
      try {
        detail = (await r.json())?.detail || detail;
      } catch {
        /* odpoved bez JSON */
      }
      return { ok: false, error: detail };
    }
    const buf = new Uint8Array(await r.arrayBuffer());
    if (!buf.length) return { ok: false, error: "prázdná předloha" };
    return {
      ok: true,
      base64: bytesToBase64(buf),
      type: r.headers.get("content-type") || "image/png",
      name: path.split(/[\\/]/).pop() || "predloha.png",
      size: buf.length,
    };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

async function refPut(bridgeUrl, name, base64) {
  if (!bridgeUrl) return { ok: false, error: "můstek není zapnutý" };
  try {
    const url = bridgeUrl.replace(/\/$/, "") + "/ext/refs?name=" + encodeURIComponent(name || "predloha.png");
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: base64ToBytes(base64),
    });
    if (!r.ok) return { ok: false, error: "můstek HTTP " + r.status };
    return { ok: true, ...(await r.json()) };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

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
