/*
 * Napodoba stranky Google Flow pro test content.js.
 *
 * Chova se podle vseho, co je o Flow zjisteno naostro:
 *   - prompt jde zapsat jen udalosti beforeinput,
 *   - odeslat se vypina pres aria-disabled,
 *   - popover s nastavenim v DOM neexistuje, dokud se neotevre,
 *   - popisky tlacitek nesou i nazev ikony ("arrow_forward Create"),
 *   - generovani spusti jen duveryhodna udalost (u nas: zprava trustedClick),
 *   - hotova media prijdou odposlechem site, ne z DOM.
 */

import { JSDOM } from "jsdom";
import { readFileSync } from "fs";

export const CESTA_CONTENT = new URL("../extension/content.js", import.meta.url);

// 1x1 pruhledny PNG - staci, obsah nikdo nekontroluje
const MALY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

export function postavFlow(opts = {}) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://labs.google/fx/tools/flow/project/test-1234",
    pretendToBeVisual: true,
    runScripts: "outside-only",
  });
  const { window } = dom;
  const { document } = window;

  // jsdom neumi innerText - selektory Flow na nem stoji
  Object.defineProperty(window.HTMLElement.prototype, "innerText", {
    get() { return this.textContent; },
    configurable: true,
  });
  if (!window.PointerEvent) window.PointerEvent = window.MouseEvent;
  // Chrome je ma, jsdom ne
  if (!window.structuredClone) window.structuredClone = (o) => JSON.parse(JSON.stringify(o));
  // jsdom prijme jen skutecny FileList; v prohlizeci ho DataTransfer vyrobi
  Object.defineProperty(window.HTMLInputElement.prototype, "files", {
    get() { return this._fbFiles || []; },
    set(v) { this._fbFiles = [...v]; },
    configurable: true,
  });
  if (!window.DataTransfer) {
    window.DataTransfer = class {
      constructor() { this._f = []; this.items = { add: (f) => this._f.push(f) }; }
      get files() { return this._f; }
    };
  }
  if (!window.DragEvent) {
    window.DragEvent = class extends window.Event {
      constructor(typ, init = {}) { super(typ, init); this.dataTransfer = init.dataTransfer; }
    };
  }

  // jsdom nema layout, takze si obdelniky rozdame sami
  const rects = new WeakMap();
  let dalsiY = 100;
  const dejRect = (el, w = 120, h = 40) => {
    const r = { left: 50, top: dalsiY, width: w, height: h, right: 50 + w, bottom: dalsiY + h };
    dalsiY += 50;
    rects.set(el, r);
    return r;
  };
  window.Element.prototype.getBoundingClientRect = function () {
    return rects.get(this) || { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
  };

  const stav = {
    generuje: false,
    odeslano: [],          // {prompt, pocet, typ}
    nastaveni: { typ: "Image", pocet: 4, pomer: null, model: "Nano Banana 2" },
    stazeno: [],
    hlaseni: [],
    popoverOtevren: false,
    mediaCitac: 0,
    predlohy: 0,
    predlohCitac: 0,
    odeslanoBehemNahravani: 0,
    nahranePredlohy: [],
  };

  // --- ovladaci pruh -------------------------------------------------------
  const pruh = document.createElement("div");
  const editor = document.createElement("div");
  editor.setAttribute("role", "textbox");
  editor.setAttribute("contenteditable", "true");
  dejRect(editor, 600, 60);

  const btnNastaveni = document.createElement("button");
  const btnPomocne = document.createElement("button");
  btnPomocne.textContent = "attach_file";
  const btnOdeslat = document.createElement("button");
  btnOdeslat.textContent = "arrow_forward Create";
  btnOdeslat.setAttribute("aria-disabled", "true");
  [btnNastaveni, btnPomocne, btnOdeslat].forEach((b) => dejRect(b, 44, 44));

  const obnovNastaveni = () => {
    btnNastaveni.textContent = `tune x${stav.nastaveni.pocet}`;
  };
  obnovNastaveni();

  // Flow bere predlohy skrytym vstupnim polem; nahledy se objevi az po nahrani
  const vstupSouboru = document.createElement("input");
  vstupSouboru.type = "file";
  vstupSouboru.accept = "image/*";
  vstupSouboru.multiple = true;
  const nahledy = document.createElement("div");

  pruh.append(editor, btnNastaveni, btnPomocne, btnOdeslat, vstupSouboru);
  const obal = document.createElement("div");   // nahledy sedi vedle pruhu
  obal.append(pruh, nahledy);
  document.body.appendChild(obal);

  // --- prompt jde zapsat jen pres beforeinput ------------------------------
  let text = "";
  let nahrava = 0;   // kolik predloh se prave nahrava
  const prekresli = () => {
    editor.textContent = text;
    // dokud se nahrava predloha, Flow odeslat nepusti
    btnOdeslat.setAttribute("aria-disabled", text.trim() && !nahrava ? "false" : "true");
  };

  // --- predlohy: po vlozeni se chvili nahravaji ----------------------------
  function zacniNahravat(files) {
    if (!files || !files.length) return;
    nahrava = files.length;
    prekresli();
    posliNet({ kind: "call", name: "media.upload", method: "POST",
               status: 200, ok: true, ts: Date.now() });
    if (opts.nahravaniNikdyNedobehne) return;   // zaseknute nahravani
    setTimeout(() => {
      for (let i = 0; i < files.length; i++) {
        const obalek = document.createElement("div");
        const img = document.createElement("img");
        img.src = `https://lh3.googleusercontent.com/predloha${++stav.predlohCitac}=s128`;
        const x = document.createElement("button");
        x.setAttribute("aria-label", "Remove reference");
        dejRect(x, 16, 16);
        x.addEventListener("pointerdown", () => { obalek.remove(); stav.predlohy--; });
        obalek.append(img, x);
        nahledy.appendChild(obalek);
        stav.predlohy++;
      }
      nahrava = 0;
      prekresli();
    }, opts.dobaNahravani ?? 2500);
  }
  vstupSouboru.addEventListener("change", () => zacniNahravat([...vstupSouboru.files]));
  editor.addEventListener("drop", (e) => zacniNahravat([...(e.dataTransfer?.files || [])]));
  editor.addEventListener("beforeinput", (e) => {
    if (e.inputType === "insertText") text += e.data ?? "";
    else if (e.inputType === "deleteContentBackward") text = text.slice(0, -1);
    prekresli();
  });

  // --- popover s nastavenim -----------------------------------------------
  let popover = null;
  const zavriPopover = () => {
    if (popover) { popover.remove(); popover = null; }
    stav.popoverOtevren = false;
  };
  const otevriPopover = () => {
    if (popover) return;
    stav.popoverOtevren = true;
    popover = document.createElement("div");
    const hlavicka = document.createElement("span");
    const prepocti = () => {
      const cena = stav.nastaveni.typ === "Video" ? stav.nastaveni.pocet * 7 : 0;
      hlavicka.textContent = `Generating will use ${cena} credits`;
    };
    prepocti();
    popover.appendChild(hlavicka);

    const volby = [
      ["image Image", () => (stav.nastaveni.typ = "Image")],
      ["videocam Video", () => (stav.nastaveni.typ = "Video")],
      ["crop_square 1:1", () => (stav.nastaveni.pomer = "1:1")],
      ["crop_16_9 16:9", () => (stav.nastaveni.pomer = "16:9")],
      ["x1", () => (stav.nastaveni.pocet = 1)],
      ["x2", () => (stav.nastaveni.pocet = 2)],
      ["x3", () => (stav.nastaveni.pocet = 3)],
      ["x4", () => (stav.nastaveni.pocet = 4)],
      ["Nano Banana 2", () => {}],
    ];
    for (const [popisek, akce] of volby) {
      const b = document.createElement("button");
      b.textContent = popisek;
      dejRect(b, 90, 30);
      b.addEventListener("pointerdown", () => { akce(); obnovNastaveni(); prepocti(); });
      popover.appendChild(b);
    }
    document.body.appendChild(popover);
  };
  btnNastaveni.addEventListener("pointerdown", () =>
    (popover ? zavriPopover() : otevriPopover()));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") zavriPopover(); });

  // --- generovani ----------------------------------------------------------
  let progress = null;
  function spustGenerovani() {
    if (nahrava) { stav.odeslanoBehemNahravani++; return false; }  // tlacitko je vypnute
    if (!text.trim()) return false;
    const pocet = stav.nastaveni.typ === "Video" ? 1 : stav.nastaveni.pocet;
    stav.odeslano.push({ prompt: text, pocet, typ: stav.nastaveni.typ,
                         predlohy: stav.predlohy });
    text = "";
    prekresli();
    stav.generuje = true;
    progress = document.createElement("div");
    progress.setAttribute("role", "progressbar");
    document.body.appendChild(progress);

    // Flow posle volani na server - odposlech ho vidi
    posliNet({ kind: "call", name: "project.generateMedia", method: "POST", status: 200, ok: true, ts: Date.now() });

    setTimeout(() => {
      const items = [];
      // chybejici kusy simulujeme jen u prvni davky, aby melo dopocitani
      // co vratit - jinak by se uloha jen dokola opakovala
      const chybi = stav.odeslano.length === 1 ? (opts.chybejici || 0) : 0;
      for (let i = 0; i < pocet - chybi; i++) {
        stav.mediaCitac++;
        items.push(stav.nastaveni.typ === "Video"
          ? { url: `https://storage.googleapis.com/flow/v${stav.mediaCitac}.mp4`, isVideo: true }
          : { url: `https://lh3.googleusercontent.com/img${stav.mediaCitac}=s512`, isVideo: false });
      }
      posliNet({ kind: "media", name: "project.listMedia", items });
      stav.generuje = false;
      progress?.remove();
      progress = null;
    }, opts.dobaGenerovani ?? 1200);
    return true;
  }

  // jsdom u postMessage nevyplnuje source ani origin (Chrome ano), takze
  // udalost sestavime rucne - jinak by ji content.js spravne zahodil.
  const posliNet = (payload) => {
    const ev = new window.MessageEvent("message", {
      data: { __fbNet: payload },
      origin: window.location.origin,
    });
    Object.defineProperty(ev, "source", { value: window });
    Object.defineProperty(ev, "origin", { value: window.location.origin });
    window.dispatchEvent(ev);
  };
  window.__posliNet = posliNet;

  // --- chrome API ----------------------------------------------------------
  const uloziste = {};
  const posluchaci = [];
  window.chrome = {
    runtime: {
      getManifest: () => ({ version: "test" }),
      onMessage: { addListener: (f) => posluchaci.push(f) },
      async sendMessage(msg) {
        switch (msg.type) {
          case "trustedClick": {
            // hit-test podle nasich obdelniku
            const cil = [...document.querySelectorAll("button")].find((b) => {
              const r = rects.get(b);
              return r && msg.x >= r.left && msg.x <= r.right && msg.y >= r.top && msg.y <= r.bottom;
            });
            if (cil === btnOdeslat) { spustGenerovani(); return { ok: true }; }
            return { ok: true }; // klik prosel, jen na neco jineho
          }
          case "trustedEnter":
            if (opts.enterNefunguje) return { ok: false, error: "test: Enter zakázán" };
            spustGenerovani();
            return { ok: true };
          case "download": {
            if (opts.stahovaniSelze) return { ok: false, error: "test: stahování zablokováno" };
            stav.stazeno.push(msg.filename);
            return { ok: true, path: "C:/Downloads/" + msg.filename };
          }
          case "uploadToBridge":
            stav.stazeno.push("můstek:" + msg.tag + "/" + msg.name);
            return { ok: true, path: "C:/outputs/" + msg.tag + "/" + msg.name };
          case "refGet":
            if (opts.predlohaChybi) return { ok: false, error: "test: předloha nenalezena" };
            return { ok: true, base64: MALY_PNG, type: "image/png",
                     name: String(msg.path).split(/[\/]/).pop(), size: 68 };
          case "refPut":
            stav.nahranePredlohy.push(msg.name);
            return { ok: true, path: "C:/outputs/_predlohy/" + msg.name };
          case "diag":
            return { ok: true, umiLadit: true, pripojeno: [1], posledniChyba: "" };
          case "bridgePull":
            return { ok: true, jobs: [], project_url: window.location.href };
          case "bridgePush":
            stav.hlaseni.push(msg.payload);
            return { ok: true };
          case "bridgeDump":
            stav.dump = msg.payload;
            return { ok: true, path: "C:/outputs/_diagnostika/dump-test.json" };
          default:
            return { ok: true };
        }
      },
    },
    storage: {
      local: {
        async get(k) { return uloziste[k] ? { [k]: uloziste[k] } : {}; },
        async set(o) { Object.assign(uloziste, o); },
      },
    },
  };

  const nastavStav = (s) => { uloziste.flowbridge = s; };

  const spustContent = () => {
    const kod = readFileSync(CESTA_CONTENT, "utf8");
    window.eval(kod);
  };

  const dejLog = async () => {
    const got = await window.chrome.storage.local.get("flowbridge");
    return (got.flowbridge?.log || []).map((e) => e.msg);
  };

  return { dom, window, document, stav, nastavStav, spustContent, posliNet, dejLog };
}
