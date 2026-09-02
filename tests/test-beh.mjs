import { postavFlow, PNG_1PX } from "./flow-mock.mjs";

const RYCHLE = {
  batchSize: 4, maxBatches: 3,
  pauseMinSeconds: 0.05, pauseMaxSeconds: 0.1,
  wavePauseSeconds: 0, maxAttempts: 2,
  waitTimeoutSeconds: 20, maxCreditsPerJob: 60,
  bridgeUrl: "http://127.0.0.1:8765", bridgeEnabled: true,
  autopilot: true, collapsed: false, projectUrl: "",
};

const cekat = (ms) => new Promise((r) => setTimeout(r, ms));

async function dokud(podminka, limitMs, popis) {
  const konec = Date.now() + limitMs;
  while (Date.now() < konec) {
    if (podminka()) return true;
    await cekat(120);
  }
  throw new Error(`vypršel čas: ${popis}`);
}

function uloha(o) {
  return {
    id: "t" + Math.random().toString(36).slice(2, 8),
    bridgeId: "bridge-1",
    kind: "image", prompt: "neonová kočka na střeše",
    count: 12, model: null, aspect: "1:1", duration: null,
    tag: "zkouska", status: "queued", done: [], createdAt: Date.now(), ...o,
  };
}

let chyby = 0;
const ok = (jmeno, podm, detail = "") => {
  console.log(`${podm ? "  OK  " : "CHYBA "} ${jmeno}${detail ? "  -> " + detail : ""}`);
  if (!podm) chyby++;
};

// ---------------------------------------------------------------------------
console.log("\n=== 1) 12 obrázků: 3 dávky po 4, stažení, hlášení můstku ===");
{
  const f = postavFlow({ dobaGenerovani: 700 });
  f.nastavStav({ running: true, jobs: [uloha({})], log: [], settings: { ...RYCHLE } });
  f.spustContent();

  await dokud(() => f.stav.hlaseni.length > 0, 60000, "úloha se nedokončila");

  ok("odeslány 3 dávky", f.stav.odeslano.length === 3, `dávek: ${f.stav.odeslano.length}`);
  ok("každá dávka po 4 ks", f.stav.odeslano.every((o) => o.pocet === 4),
     JSON.stringify(f.stav.odeslano.map((o) => o.pocet)));
  ok("prompt dorazil celý",
     f.stav.odeslano.every((o) => o.prompt === "neonová kočka na střeše"),
     JSON.stringify(f.stav.odeslano[0]?.prompt));
  ok("poměr stran nastaven", f.stav.nastaveni.pomer === "1:1", f.stav.nastaveni.pomer);
  ok("staženo 12 souborů", f.stav.stazeno.length === 12, `staženo: ${f.stav.stazeno.length}`);
  ok("cesta má složku úlohy",
     /^FlowBridge\/zkouska\/neonova-kocka-na-strese-t\w+\/001\.png$/.test(f.stav.stazeno[0]),
     f.stav.stazeno[0]);
  ok("můstek dostal hlášení done",
     f.stav.hlaseni[0]?.status === "done" && f.stav.hlaseni[0]?.files.length === 12,
     JSON.stringify({ status: f.stav.hlaseni[0]?.status, souboru: f.stav.hlaseni[0]?.files.length }));
  ok("popover je po sobě zavřený", !f.stav.popoverOtevren);
  f.window.close();
}

// ---------------------------------------------------------------------------
console.log("\n=== 2) Video: 1 kus, kredity ze štítku, strop kreditů ===");
{
  const f = postavFlow({ dobaGenerovani: 600 });
  f.nastavStav({
    running: true, log: [], settings: { ...RYCHLE },
    jobs: [uloha({ kind: "video", count: 1, duration: 8, aspect: "16:9" })],
  });
  f.spustContent();
  await dokud(() => f.stav.hlaseni.length > 0, 60000, "video se nedokončilo");

  ok("odeslána 1 dávka", f.stav.odeslano.length === 1, `dávek: ${f.stav.odeslano.length}`);
  ok("typ přepnut na Video", f.stav.odeslano[0]?.typ === "Video", f.stav.odeslano[0]?.typ);
  ok("staženo jako mp4", f.stav.stazeno[0]?.endsWith(".mp4"), f.stav.stazeno[0]);
  ok("zaúčtováno 7 kreditů", f.stav.hlaseni[0]?.credits === 7, String(f.stav.hlaseni[0]?.credits));
  f.window.close();
}

// ---------------------------------------------------------------------------
console.log("\n=== 3) Klik selže -> nahradní Enter (a žádné dvojité odeslání) ===");
{
  const f = postavFlow({ dobaGenerovani: 600 });
  // rozbijeme hit-test: tlacitko odeslat posuneme mimo obdelnik, ktery hlasi
  f.window.chrome.runtime.sendMessage = (function (puvodni) {
    return async function (msg) {
      if (msg.type === "trustedClick") return { ok: false, error: "test: klik zakázán" };
      return puvodni.call(this, msg);
    };
  })(f.window.chrome.runtime.sendMessage);

  f.nastavStav({ running: true, log: [], settings: { ...RYCHLE },
                 jobs: [uloha({ count: 4 })] });
  f.spustContent();
  await dokud(() => f.stav.hlaseni.length > 0, 60000, "nedokončilo se přes Enter");

  ok("odeslání proběhlo jednou", f.stav.odeslano.length === 1, `dávek: ${f.stav.odeslano.length}`);
  ok("staženy 4 soubory", f.stav.stazeno.length === 4, `staženo: ${f.stav.stazeno.length}`);
  f.window.close();
}

// ---------------------------------------------------------------------------
console.log("\n=== 4) Stahování zablokované -> uloží to můstek ===");
{
  const f = postavFlow({ dobaGenerovani: 600, stahovaniSelze: true });
  f.nastavStav({ running: true, log: [], settings: { ...RYCHLE },
                 jobs: [uloha({ count: 4 })] });
  f.spustContent();
  await dokud(() => f.stav.hlaseni.length > 0, 60000, "nedokončilo se přes můstek");

  ok("všechny 4 uloženy přes můstek",
     f.stav.stazeno.length === 4 && f.stav.stazeno.every((s) => s.startsWith("můstek:")),
     f.stav.stazeno[0]);
  f.window.close();
}

// ---------------------------------------------------------------------------
console.log("\n=== 5) Chybějící kusy -> zopakuje jen chybějící počet ===");
{
  const f = postavFlow({ dobaGenerovani: 600, chybejici: 2 }); // z každé dávky 4 vrátí jen 2
  f.nastavStav({ running: true, log: [], settings: { ...RYCHLE, maxAttempts: 3 },
                 jobs: [uloha({ count: 4 })] });
  f.spustContent();
  await dokud(() => f.stav.hlaseni.length > 0, 150000, "opakování nedoběhlo");

  ok("dopočet poslal jen chybějící 2 ks",
     f.stav.odeslano.length === 2 && f.stav.odeslano[1].pocet === 2,
     JSON.stringify(f.stav.odeslano.map((o) => o.pocet)));
  ok("nakonec všechny 4 kusy", f.stav.hlaseni[0]?.files?.length === 4,
     `${f.stav.hlaseni[0]?.status}, souborů ${f.stav.hlaseni[0]?.files?.length}`);
  f.window.close();
}

// ---------------------------------------------------------------------------
console.log("\n=== 6) Autopilot: úloha z můstku se spustí sama ===");
{
  const f = postavFlow({ dobaGenerovani: 600 });
  let vydano = false;
  const puvodni = f.window.chrome.runtime.sendMessage;
  f.window.chrome.runtime.sendMessage = async function (msg) {
    if (msg.type === "bridgePull" && !vydano) {
      vydano = true;
      return { ok: true, project_url: f.window.location.href,
               jobs: [{ id: "b1", kind: "image", prompt: "z můstku", count: 4, tag: "agent" }] };
    }
    return puvodni.call(this, msg);
  };
  // fronta prazdna a running=false - autopilot to musi rozjet sam
  f.nastavStav({ running: false, jobs: [], log: [], settings: { ...RYCHLE } });
  f.spustContent();

  await dokud(() => f.stav.hlaseni.length > 0, 60000, "autopilot nespustil úlohu");
  ok("úloha z můstku odeslána", f.stav.odeslano[0]?.prompt === "z můstku",
     f.stav.odeslano[0]?.prompt);
  ok("staženo do složky agenta", /agent\/z-mustku-/.test(f.stav.stazeno[0] || ""),
     f.stav.stazeno[0]);
  f.window.close();
}

// ---------------------------------------------------------------------------
console.log("\n=== 7) Rozbité Flow -> chyba + automatický dump ===");
{
  const f = postavFlow({ dobaGenerovani: 400 });
  // Google prejmenoval tlacitko odeslat -> selektor uz nesedi
  f.document.querySelector("button:last-of-type").textContent = "send Odeslat";
  f.window.chrome.runtime.sendMessage = (function (puvodni) {
    return async function (msg) {
      if (msg.type === "trustedClick" || msg.type === "trustedEnter") {
        return { ok: false, error: "test: nic neprojde" };
      }
      return puvodni.call(this, msg);
    };
  })(f.window.chrome.runtime.sendMessage);

  f.nastavStav({ running: true, log: [], settings: { ...RYCHLE, maxAttempts: 1 },
                 jobs: [uloha({ count: 4 })] });
  f.spustContent();

  await dokud(() => f.stav.dump, 180000, "dump nedorazil");
  ok("dump obsahuje popisky ovládacího pruhu",
     Array.isArray(f.stav.dump?.pruh) && f.stav.dump.pruh.length >= 3,
     `tlačítek: ${f.stav.dump?.pruh?.length}`);
  ok("dump obsahuje obsah popoveru",
     !!f.stav.dump?.popover?.tlacitka?.length,
     `voleb: ${f.stav.dump?.popover?.tlacitka?.length}`);
  ok("dump zná zachycená volání", Array.isArray(f.stav.dump?.volani));
  ok("můstek dostal hlášení o chybě",
     f.stav.hlaseni.some((h) => h.status === "failed"),
     JSON.stringify(f.stav.hlaseni.map((h) => h.status)));
  f.window.close();
}

// ---------------------------------------------------------------------------
console.log("\n=== 8) Předlohy z můstku: připojí se ke každé dávce ===");
{
  const f = postavFlow({ dobaGenerovani: 600 });
  f.nastavStav({
    running: true, log: [], settings: { ...RYCHLE },
    jobs: [uloha({ count: 12, refs: [
      { name: "postava.png", path: "C:/predlohy/postava.png" },
      { name: "pozadi.png", path: "C:/predlohy/pozadi.png" },
    ] })],
  });
  f.spustContent();
  await dokud(() => f.stav.hlaseni.length > 0, 60000, "úloha s předlohami nedoběhla");

  ok("do dialogu se podstrčily cesty z můstku",
     f.stav.podstrceneCesty.slice(0, 2).join("|")
       === "C:/predlohy/postava.png|C:/predlohy/pozadi.png",
     JSON.stringify(f.stav.podstrceneCesty.slice(0, 2)));
  ok("každá ze 3 dávek nesla obě předlohy",
     f.stav.odeslano.length === 3 && f.stav.odeslano.every((o) => o.predlohy === 2),
     JSON.stringify(f.stav.odeslano.map((o) => o.predlohy)));
  ok("Flow dostalo soubory se správnými jmény",
     f.stav.nahrano.length === 6
       && f.stav.nahrano[0].name === "postava.png"
       && f.stav.nahrano[1].name === "pozadi.png",
     JSON.stringify(f.stav.nahrano.slice(0, 2).map((p) => p.name)));
  ok("Flow dostalo cestu, ne bajty",
     f.stav.nahrano[0]?.path === "C:/predlohy/postava.png", f.stav.nahrano[0]?.path);
  ok("nahrané se z knihovny opravdu připojilo k promptu",
     f.stav.predlohy.length === 6,
     `připojeno: ${f.stav.predlohy.length} z ${f.stav.nahrano.length} nahraných`);
  ok("můstek nemusel nic ukládat (cesty už existují)",
     f.stav.ulozenePredlohy.length === 0, JSON.stringify(f.stav.ulozenePredlohy));
  ok("staženo 12 souborů", f.stav.stazeno.length === 12, `staženo: ${f.stav.stazeno.length}`);
  f.window.close();
}

// ---------------------------------------------------------------------------
console.log("\n=== 9) Ladicí rozhraní nedá předlohu -> video se neodešle ===");
{
  const f = postavFlow({ dobaGenerovani: 400, ladeniSelze: true });
  f.nastavStav({
    running: true, log: [], settings: { ...RYCHLE, maxAttempts: 1 },
    jobs: [uloha({ kind: "video", count: 1, duration: 8,
                   refs: [{ name: "start.png", path: "C:/predlohy/start.png" }] })],
  });
  f.spustContent();
  await dokud(() => f.stav.hlaseni.length > 0, 90000, "úloha neskončila");

  ok("prompt se vůbec neodeslal", f.stav.odeslano.length === 0,
     `dávek: ${f.stav.odeslano.length}`);
  ok("úloha spadla", f.stav.hlaseni.some((h) => h.status === "failed"),
     JSON.stringify(f.stav.hlaseni.map((h) => h.status)));
  ok("nic se nezaúčtovalo", (f.stav.hlaseni[0]?.credits || 0) === 0,
     String(f.stav.hlaseni[0]?.credits));
  f.window.close();
}

// ---------------------------------------------------------------------------
console.log("\n=== 10) Flow zrušilo vstup pro soubory -> nic se neodešle ===");
{
  const f = postavFlow({ dobaGenerovani: 400, bezVstupuSouboru: true });
  f.nastavStav({
    running: true, log: [], settings: { ...RYCHLE, maxAttempts: 1 },
    jobs: [uloha({ count: 4, refs: [{ name: "predloha.png", path: "C:/predlohy/x.png" }] })],
  });
  f.spustContent();
  await dokud(() => f.stav.hlaseni.length > 0, 90000, "úloha neskončila");

  ok("prompt se neodeslal", f.stav.odeslano.length === 0,
     `dávek: ${f.stav.odeslano.length}`);
  ok("úloha spadla se srozumitelnou chybou",
     /vstup pro soubory/i.test(f.stav.hlaseni.find((h) => h.status === "failed")?.error || ""),
     f.stav.hlaseni.find((h) => h.status === "failed")?.error);
  f.window.close();
}

// ---------------------------------------------------------------------------
console.log("\n=== 11) Předlohy z panelu: přežijí obnovení a pak se uklidí ===");
{
  const f = postavFlow({ dobaGenerovani: 600 });
  f.nastavStav({ running: false, jobs: [], log: [], settings: { ...RYCHLE, autopilot: false } });
  f.spustContent();
  await dokud(() => f.document.querySelector("#fb-files"), 10000, "panel nenaběhl");

  // uzivatel vybere obrazek a prida dva prompty
  await f.vyberPredlohy([{ name: "postava.png", dataUrl: PNG_1PX }]);
  ok("chip s názvem předlohy je vidět",
     /postava\.png/.test(f.document.querySelector("#fb-reflist")?.innerHTML || ""),
     f.document.querySelector("#fb-reflist")?.textContent);

  f.document.querySelector("#fb-prompt").value = "kočka\npes";
  f.document.querySelector("#fb-count").value = "4";
  await f.klikni("#fb-add");
  await dokud(() => f.ulozene()?.jobs?.length === 2, 10000, "úlohy se nepřidaly");

  const jobs = f.ulozene().jobs;
  ok("obě úlohy nesou odkaz na předlohu",
     jobs.every((j) => j.refs?.[0]?.url?.startsWith("local:")),
     JSON.stringify(jobs.map((j) => j.refs?.[0]?.url)));
  ok("bajty leží mimo stav úloh", !JSON.stringify(jobs).includes("base64"));
  ok("obě úlohy sdílí jedny bajty",
     Object.keys(f.ulozenePredlohy()).length === 1,
     `uloženo předloh: ${Object.keys(f.ulozenePredlohy()).length}`);
  ok("předlohy zůstaly vybrané pro další prompty", f.document
     .querySelector("#fb-reflist").children.length === 1);

  // po obnoveni stranky se ulohy nactou ze storage a predloha se ma pripojit
  f.window.close();
  const g = postavFlow({ dobaGenerovani: 600, uloziste: f.uloziste });
  g.nastavStav({ ...f.ulozene(), running: true, settings: { ...RYCHLE } });
  g.spustContent();
  // úloha z panelu nemá bridgeId, takže se můstku nehlásí - čekáme na stažení
  await dokud(() => g.stav.stazeno.length >= 4, 60000, "po obnovení se nedogenerovalo");

  ok("předloha se připojila i po obnovení stránky",
     g.stav.predlohy.length >= 1 && g.stav.predlohy[0].name === "postava.png",
     JSON.stringify(g.stav.predlohy.map((p) => p.name)));
  ok("bajty z panelu uložil na disk můstek",
     g.stav.ulozenePredlohy.length === 1
       && g.stav.ulozenePredlohy[0].endsWith("postava.png"),
     JSON.stringify(g.stav.ulozenePredlohy));
  ok("do dialogu šla ta uložená cesta",
     g.stav.podstrceneCesty[0] === g.stav.ulozenePredlohy[0],
     JSON.stringify(g.stav.podstrceneCesty));
  g.window.close();

  // uklid: kdyz uloha z fronty zmizi, nesmi po ni v ulozisti zustat megabajty
  const h = postavFlow({ uloziste: f.uloziste });
  h.nastavStav({ running: false, jobs: [], log: [], settings: { ...RYCHLE } });
  h.spustContent();
  await dokud(() => Object.keys(h.ulozenePredlohy()).length === 0, 10000,
              "předlohy po smazaných úlohách zůstaly v úložišti");
  ok("po smazání úloh se předlohy uklidily", true);
  h.window.close();
}

// ---------------------------------------------------------------------------
console.log("\n=== 12) Bez přímého tlačítka -> předlohu připojí nabídka „More“ ===");
{
  const f = postavFlow({ dobaGenerovani: 600, jenNabidkaMore: true });
  f.nastavStav({
    running: true, log: [], settings: { ...RYCHLE },
    jobs: [uloha({ count: 4, refs: [{ name: "p.png", path: "C:/predlohy/p.png" }] })],
  });
  f.spustContent();
  await dokud(() => f.stav.hlaseni.length > 0, 60000, "úloha přes nabídku nedoběhla");

  ok("předloha se připojila i bez přímého tlačítka",
     f.stav.predlohy.length === 1 && f.stav.predlohy[0].name === "p.png",
     JSON.stringify(f.stav.predlohy.map((p) => p.name)));
  ok("dávka se odeslala i s ní",
     f.stav.odeslano.length === 1 && f.stav.odeslano[0].predlohy === 1,
     JSON.stringify(f.stav.odeslano.map((o) => o.predlohy)));
  f.window.close();
}

// ---------------------------------------------------------------------------
console.log("\n=== 13) Nahraná předloha se nesmí vrátit mezi výsledky ===");
{
  // jeden kus, aby se predloha a vysledek praly o jedine misto ve vysledcich
  const f = postavFlow({ dobaGenerovani: 2500 });
  f.nastavStav({
    running: true, log: [], settings: { ...RYCHLE },
    jobs: [uloha({ count: 1, refs: [{ name: "predloha.png", path: "C:/p/predloha.png" }] })],
  });
  f.spustContent();
  await dokud(() => f.stav.hlaseni.length > 0, 90000, "úloha nedoběhla");

  ok("stáhl se jeden soubor", f.stav.stazeno.length === 1,
     `staženo: ${f.stav.stazeno.length}`);
  ok("nestáhla se předloha z knihovny",
     f.stav.stazenoZ.every((u) => !/getMediaUrlRedirect/.test(u || "")),
     JSON.stringify(f.stav.stazenoZ));
  ok("stáhl se vygenerovaný obrázek",
     f.stav.stazenoZ.every((u) => /googleusercontent|storage\.googleapis/.test(u || "")),
     JSON.stringify(f.stav.stazenoZ));
  f.window.close();
}

console.log(`\n${chyby ? `SELHALO: ${chyby} kontrol` : "Všechny kontroly prošly."}`);
process.exit(chyby ? 1 : 0);
