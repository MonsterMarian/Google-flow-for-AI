/*
 * FlowBridge - odposlech sitovych odpovedi Flow.
 *
 * Bezi v HLAVNIM svete stranky (manifest: "world": "MAIN"). Obsahovy skript ma
 * vlastni kopii window, takze na fetch aplikace nedosahne - proto tenhle druhy
 * soubor.
 *
 * Proc to vubec je:
 *   1. Hotova media se z DOM ctou spatne - Flow seznam virtualizuje, nacita ho
 *      opozdene a v <img> ma zmenseny nahled. V odpovedi z /fx/api/trpc je ale
 *      rovnou plna adresa.
 *   2. Je to jediny spolehlivy dukaz, ze Flow odeslani opravdu prijal. Bez nej
 *      se hada podle vzhledu tlacitka a hrozi, ze se prompt posle dvakrat.
 *   3. Kdyz neco nesedi, jsou nazvy volani jediny podklad pro opravu selektoru.
 *
 * Ven jde jen postMessage na vlastni origin. Nic se nemeni, jen cte.
 */

(() => {
  if (window.__fbNetHooked) return;
  window.__fbNetHooked = true;

  const TRPC = /\/fx\/api\/trpc/;
  const MAX_BODY = 6 * 1024 * 1024; // vetsi odpoved nema smysl rozebirat
  const MAX_NODES = 40000;          // pojistka proti obrimu JSON

  const send = (payload) => {
    try {
      window.postMessage({ __fbNet: payload }, location.origin);
    } catch {
      /* odposlech nesmi nikdy shodit stranku */
    }
  };

  /* Nazev tRPC volani je v query (?name=...) nebo aspon v ceste. */
  function callName(url) {
    try {
      const u = new URL(url, location.origin);
      const n = u.searchParams.get("name") || u.searchParams.get("batch");
      if (n) return n;
      return u.pathname.split("/").filter(Boolean).slice(-1)[0] || u.pathname;
    } catch {
      return String(url).slice(0, 120);
    }
  }

  const AVATAR = /googleusercontent\.com\/a[\/-]/;

  function isMediaUrl(s) {
    if (typeof s !== "string" || s.length < 16 || s.length > 3000) return false;
    if (!s.startsWith("http")) return false;
    if (AVATAR.test(s)) return false;
    return (
      /googleusercontent\.com/.test(s) ||
      /storage\.(googleapis|mtls\.cloud\.google)\.com/.test(s) ||
      /\.(mp4|webm|png|jpe?g|webp)(\?|#|$)/i.test(s)
    );
  }

  const VIDEO_KEY = /video|movie|clip/i;

  function looksVideo(url, key) {
    return /\.(mp4|webm)(\?|#|$)/i.test(url) || VIDEO_KEY.test(key || "");
  }

  const CREDIT_KEY = /^(credit|credits|creditBalance|creditsRemaining|numCredits|remainingCredits|balance)$/i;

  /* Projde odpoved a vytahne z ni adresy medii, zustatek kreditu a nazvy modelu.
     Struktura tRPC se mezi verzemi meni, takze se nehleda konkretni cesta -
     projde se cely strom a bere se, co vypada jako adresa. */
  function harvest(root, name) {
    const media = [];
    const seen = new Set();
    let credits = null;
    let nodes = 0;

    const walk = (node, key) => {
      if (nodes++ > MAX_NODES || node == null) return;
      if (typeof node === "string") {
        if (isMediaUrl(node) && !seen.has(node)) {
          seen.add(node);
          media.push({ url: node, isVideo: looksVideo(node, key) });
        }
        return;
      }
      if (typeof node === "number") {
        if (credits == null && CREDIT_KEY.test(key || "") && node >= 0 && node < 1e7) {
          credits = Math.round(node);
        }
        return;
      }
      if (Array.isArray(node)) {
        for (const v of node) walk(v, key);
        return;
      }
      if (typeof node === "object") {
        for (const k of Object.keys(node)) walk(node[k], k);
      }
    };

    walk(root, "");
    if (media.length) send({ kind: "media", name, items: media });
    if (credits != null) send({ kind: "credits", value: credits });
  }

  function note(url, method, status, ok) {
    send({
      kind: "call",
      name: callName(url),
      method: String(method || "GET").toUpperCase(),
      status: status ?? 0,
      ok: !!ok,
      ts: Date.now(),
    });
  }

  function parseAndHarvest(text, name) {
    if (!text || text.length > MAX_BODY) return;
    // tRPC umi vratit i vic radku (streamovana davka) - zkusime kazdy zvlast
    const chunks = text.startsWith("[") || text.startsWith("{")
      ? [text]
      : text.split("\n").filter((l) => l.trim().startsWith("{") || l.trim().startsWith("["));
    for (const chunk of chunks) {
      try {
        harvest(JSON.parse(chunk), name);
      } catch {
        /* neni JSON - nevadi */
      }
    }
  }

  // -------------------------------------------------------------------------
  // fetch
  // -------------------------------------------------------------------------

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    let url = "";
    let method = "GET";
    try {
      url = typeof input === "string" ? input : input?.url || "";
      method = init?.method || (typeof input === "object" && input?.method) || "GET";
    } catch {
      /* nic */
    }
    const promise = origFetch.apply(this, arguments);
    if (!TRPC.test(url)) return promise;

    const name = callName(url);
    return promise.then(
      (res) => {
        note(url, method, res.status, res.ok);
        try {
          const len = Number(res.headers.get("content-length") || 0);
          if (len <= MAX_BODY) {
            res.clone().text().then((t) => parseAndHarvest(t, name)).catch(() => {});
          }
        } catch {
          /* klonovani selhalo - stranku to netrapi */
        }
        return res;
      },
      (err) => {
        note(url, method, 0, false);
        throw err;
      }
    );
  };

  // -------------------------------------------------------------------------
  // XMLHttpRequest (nekterá volani Flow jedou jeste pres nej)
  // -------------------------------------------------------------------------

  const XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    const open = XHR.prototype.open;
    const sendFn = XHR.prototype.send;

    XHR.prototype.open = function (method, url) {
      this.__fbUrl = url;
      this.__fbMethod = method;
      return open.apply(this, arguments);
    };

    XHR.prototype.send = function () {
      const url = this.__fbUrl || "";
      if (TRPC.test(url)) {
        this.addEventListener("load", () => {
          note(url, this.__fbMethod, this.status, this.status < 400);
          try {
            if (typeof this.responseText === "string") {
              parseAndHarvest(this.responseText, callName(url));
            }
          } catch {
            /* responseType != text */
          }
        });
        this.addEventListener("error", () => note(url, this.__fbMethod, 0, false));
      }
      return sendFn.apply(this, arguments);
    };
  }

  /* Znacka v DOM, ne jen zprava: obsahovy skript se pripojuje az na
     document_idle, takze postMessage odeslany ted uz nikdo neslysi. */
  try {
    document.documentElement.setAttribute("data-fb-net", "1");
  } catch {
    /* documentElement jeste nemusi existovat - zpravy pak stací */
  }
  send({ kind: "ready", ts: Date.now() });
})();
