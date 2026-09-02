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

/* Nejmensi platny PNG - staci na to, aby z nej slo postavit File. */
export const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAA" +
  "DUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

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

  // Predlohy stoji na trech vecech, ktere jsdom nema - bez nich by se testoval
  // jen prazdny prostor.
  if (!window.DataTransfer) {
    window.DataTransfer = class {
      constructor() {
        const soubory = [];
        this.items = { add: (f) => soubory.push(f) };
        this.files = soubory;
      }
    };
  }
  if (!window.DragEvent) {
    window.DragEvent = class extends window.MouseEvent {
      constructor(typ, init = {}) {
        super(typ, init);
        this.dataTransfer = init.dataTransfer || null;
      }
    };
  }
  // Chrome umi input.files priradit, jsdom ma jen getter
  const puvodniFiles = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, "files");
  Object.defineProperty(window.HTMLInputElement.prototype, "files", {
    configurable: true,
    get() { return this.__files || puvodniFiles?.get?.call(this) || null; },
    set(v) { this.__files = v; },
  });

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
    nahrano: [],           // co pristalo v knihovne projektu
    predlohy: [],          // co se z knihovny opravdu pripojilo k promptu
    stazenoZ: [],          // adresy, ze kterych se stahovalo
    podstrceneCesty: [],   // cesty, ktere rozsireni dodalo do dialogu
    ulozenePredlohy: [],   // co si nechal na disk ulozit mustek (predlohy z panelu)
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
  pruh.append(editor, btnNastaveni, btnPomocne, btnOdeslat);
  document.body.appendChild(pruh);

  // --- predlohy ------------------------------------------------------------
  // Odmereno na zive strance Flow (1. 9.):
  //   - do vstupu na soubory se ze stranky zapsat neda: ten, na ktery sahá
  //     "Upload media", vznika az pri kliknuti a hned se zahazuje,
  //   - soubor se dostane dovnitr jen dialogem na vyber souboru, ktery
  //     rozsireni zachytava ladicim rozhranim,
  //   - nahrany obrazek pristane v knihovne projektu, NE v promptu,
  //   - k promptu ho pripoji az "More" -> "Add to prompt" na jeho karte,
  //   - nahledy maji adresu media.getMediaUrlRedirect, ne blob:.
  const knihovna = document.createElement("div");
  const nahledy = document.createElement("div");
  pruh.appendChild(nahledy);
  document.body.appendChild(knihovna);

  let mediaId = 0;
  /* Nahrana media se do DOM vykresli az s otevrenym vyberem medii - naostro
     to bez nej vypada, ze nahrani selhalo. */
  const nahrajDoKnihovny = (soubory) => {
    if (!vyberOtevren) return;
    for (const f of soubory || []) {
      stav.nahrano.push(typeof f === "string" ? { path: f, name: f.split(/[\\/]/).pop() } : f);
      const karta = document.createElement("div");
      karta.className = "sc-karta";
      const obal = document.createElement("div");
      const im = document.createElement("img");
      im.src = `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=m${++mediaId}`;
      im.dataset.jmeno = String(f).split(/[\\/]/).pop();
      obal.appendChild(im);

      const pripoj = () => {
        stav.predlohy.push({ name: im.dataset.jmeno });
        const n = document.createElement("img");
        n.src = im.src;
        nahledy.appendChild(n);
      };

      /* Ve vyberu medii ma karta tlacitko rovnou (a jinou velikost pismen
         nez nabidka pod "More") - naostro je to presne takhle. */
      const primo = document.createElement("button");
      primo.textContent = "Add to Prompt";
      dejRect(primo, 90, 24);
      primo.addEventListener("pointerdown", pripoj);

      const more = document.createElement("button");
      more.textContent = "more_vert More";
      dejRect(more, 24, 24);
      // nabidka se rozbali az po najeti mysi na kartu
      let najeto = false;
      karta.addEventListener("mouseover", () => { najeto = true; });
      more.addEventListener("pointerdown", () => {
        if (!najeto) return;                  // bez hoveru se nabidka neotevre
        const menu = document.createElement("div");
        menu.className = "sc-menu";
        for (const popisek of ["favorite Favorite", "add Add to prompt",
                               "delete Move to trash"]) {
          const b = document.createElement("button");
          b.textContent = popisek;
          dejRect(b, 120, 26);
          b.addEventListener("pointerdown", () => {
            if (/Add to prompt/i.test(popisek)) pripoj();
            menu.remove();
          });
          menu.appendChild(b);
        }
        document.body.appendChild(menu);
      });
      karta.append(obal, ...(opts.jenNabidkaMore ? [more] : [primo, more]));
      knihovna.appendChild(karta);
    }
  };

  /* Vyber medii: "Create" ho otevre a teprve v nem je "Upload media".
     Klik na nej otevre dialog na vyber souboru - ten u nas predstavuje
     zprava attachFiles, kterou obslouzi napodoba service workeru niz. */
  let vyberOtevren = false;
  const btnCreate = document.createElement("button");
  btnCreate.textContent = "add_2 Create";
  dejRect(btnCreate, 60, 30);
  pruh.insertBefore(btnCreate, btnNastaveni);

  const btnUpload = document.createElement("button");
  btnUpload.textContent = "upload Upload media";
  dejRect(btnUpload, 120, 30);

  const zavriVyber = () => {
    vyberOtevren = false;
    btnUpload.remove();
  };
  btnCreate.addEventListener("pointerdown", () => {
    if (opts.bezVyberuMedii) return;
    if (vyberOtevren) { zavriVyber(); return; }   // druhy klik ho zavre
    vyberOtevren = true;
    document.body.appendChild(btnUpload);
  });
  // vyber medii zavira i Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && vyberOtevren) zavriVyber();
  });
  if (opts.vyberRovnou && !opts.bezVyberuMedii) {
    vyberOtevren = true;
    document.body.appendChild(btnUpload);
  }

  /* Vstup, na kterem visi React - jen ten je ten pravy. Zapisem ze stranky
     s nim nehne nic (naostro taky ne), soubory na nej dostane az ladici
     rozhrani, ktere si ho najde podle znacky data-flowbridge-cil. */
  if (!opts.bezVstupuSouboru) {
    const vstup = document.createElement("input");
    vstup.type = "file";
    vstup.accept = "image/*";
    vstup.multiple = true;
    vstup.__reactProps$test = { onChange: () => {} };
    document.body.appendChild(vstup);
  }

  /* Soubory nastavi ladici rozhrani primo na vstup - zadny dialog se
     neotevira. Nahrani chvili trva, stejne jako naostro. */
  const nahrajPozdeji = (paths) =>
    setTimeout(() => nahrajDoKnihovny(paths), opts.dobaNahrani ?? 200);

  // --- prompt jde zapsat jen pres beforeinput ------------------------------
  let text = "";
  const prekresli = () => {
    editor.textContent = text;
    btnOdeslat.setAttribute("aria-disabled", text.trim() ? "false" : "true");
  };
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
    if (!text.trim()) return false;
    const pocet = stav.nastaveni.typ === "Video" ? 1 : stav.nastaveni.pocet;
    stav.odeslano.push({ prompt: text, pocet, typ: stav.nastaveni.typ,
                         predlohy: nahledy.children.length });
    text = "";
    prekresli();
    // Flow po odeslani predlohy zahodi - dalsi davka si je musi pripojit znovu
    nahledy.innerHTML = "";
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
  const uloziste = opts.uloziste || {};   // prezije 'obnoveni stranky'
  const posluchaci = [];
  window.chrome = {
    runtime: {
      // podle nej content.js pozna, ze rozsireni nebylo mezitim nacteno znovu
      id: "flowbridge-test",
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
            stav.stazenoZ.push(msg.url);      // odkud - at je poznat predloha
            return { ok: true, path: "C:/Downloads/" + msg.filename };
          }
          case "uploadToBridge":
            stav.stazeno.push("můstek:" + msg.tag + "/" + msg.name);
            return { ok: true, path: "C:/outputs/" + msg.tag + "/" + msg.name };
          case "attachFiles": {
            if (opts.ladeniSelze) return { ok: false, error: "test: ladicí rozhraní zakázáno" };
            // ladici rozhrani si vstup najde podle znacky od content.js
            const cil = document.querySelector('input[data-flowbridge-cil]');
            if (!cil) {
              return { ok: false, error: "označený vstup pro soubory se v DOM nenašel" };
            }
            stav.podstrceneCesty.push(...msg.paths);
            nahrajPozdeji(msg.paths);
            return { ok: true, files: msg.paths.length };
          }
          case "refToDisk": {
            if (opts.predlohaSelze) return { ok: false, error: "test: můstek neuložil" };
            const cesta = "C:/outputs/_predlohy/" + msg.name;
            stav.ulozenePredlohy.push(cesta);
            return { ok: true, path: cesta, bytes: 70 };
          }
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

  // --- ovladani panelu (na to, co dela uzivatel mysi) -----------------------

  const klikni = async (sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error("v panelu není " + sel);
    el.click();
    await new Promise((r) => setTimeout(r, 50));
  };

  /* Dialog na vyber souboru otevrit nejde, takze soubory podstrcime rovnou -
     panel pak jede stejnou cestou jako po skutecnem vyberu. */
  const vyberPredlohy = async (items) => {
    const inp = document.querySelector("#fb-files");
    if (!inp) throw new Error("panel nemá pole na předlohy");
    inp.files = items.map((it) => {
      const [hlava, b64] = it.dataUrl.split(",");
      const bin = window.atob(b64);
      const bajty = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bajty[i] = bin.charCodeAt(i);
      return new window.File([bajty], it.name,
        { type: /:(.*?);/.exec(hlava)?.[1] || "image/png" });
    });
    inp.dispatchEvent(new window.Event("change", { bubbles: true }));
    // panel soubory cte pres FileReader - musime pockat, az dobehne
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 50));
      if (document.querySelector("#fb-reflist")?.children.length === items.length) return;
    }
    throw new Error("panel předlohy nepřevzal");
  };

  const ulozene = () => uloziste.flowbridge;
  const ulozenePredlohy = () => uloziste.flowbridgeRefs || {};

  return { dom, window, document, stav, nastavStav, spustContent, posliNet,
           uloziste, ulozene, ulozenePredlohy, klikni, vyberPredlohy };
}
