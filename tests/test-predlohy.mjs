/*
 * Predlohy - obrazky pripojene k promptu.
 *
 * Jadro veci: po vlozeni se obrazek chvili NAHRAVA. Kdyz se odesle driv,
 * vygeneruje se to bez nej. Napodoba proto drzi odeslat vypnute, dokud
 * nahravani nedobehne, a hlida, jestli se do te doby nekdo nepokusil odeslat.
 */

import { postavFlow } from "./flow-mock.mjs";

const RYCHLE = {
  batchSize: 4, maxBatches: 3,
  pauseMinSeconds: 0.05, pauseMaxSeconds: 0.1,
  wavePauseSeconds: 0, maxAttempts: 2,
  waitTimeoutSeconds: 20, refWaitSeconds: 30, refSettleSeconds: 1,
  maxCreditsPerJob: 60,
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
    id: "p" + Math.random().toString(36).slice(2, 8),
    bridgeId: "bridge-p",
    kind: "image", prompt: "kočka podle předlohy",
    count: 4, model: null, aspect: null, duration: null,
    tag: "predlohy", status: "queued", done: [], createdAt: Date.now(), ...o,
  };
}

let chyby = 0;
const ok = (jmeno, podm, detail = "") => {
  console.log(`${podm ? "  OK  " : "CHYBA "} ${jmeno}${detail ? "  -> " + detail : ""}`);
  if (!podm) chyby++;
};

// ---------------------------------------------------------------------------
console.log("\n=== 1) Jedna předloha: počká na nahrání, teprve pak odešle ===");
{
  const f = postavFlow({ dobaGenerovani: 600, dobaNahravani: 4000 });
  f.nastavStav({ running: true, log: [], settings: { ...RYCHLE },
                 jobs: [uloha({ refs: ["C:/predlohy/kocka.png"] })] });
  f.spustContent();
  await dokud(() => f.stav.hlaseni.length > 0, 90000, "úloha s předlohou nedoběhla");

  ok("odeslání proběhlo jednou", f.stav.odeslano.length === 1,
     `dávek: ${f.stav.odeslano.length}`);
  ok("v okamžiku odeslání byla předloha nahraná",
     f.stav.odeslano[0]?.predlohy === 1, `předloh: ${f.stav.odeslano[0]?.predlohy}`);
  ok("nikdy se neodesílalo během nahrávání",
     f.stav.odeslanoBehemNahravani === 0, `pokusů: ${f.stav.odeslanoBehemNahravani}`);
  ok("staženy 4 soubory", f.stav.stazeno.length === 4, `staženo: ${f.stav.stazeno.length}`);
  f.window.close();
}

// ---------------------------------------------------------------------------
console.log("\n=== 2) Víc předloh naráz ===");
{
  const f = postavFlow({ dobaGenerovani: 600, dobaNahravani: 2000 });
  f.nastavStav({ running: true, log: [], settings: { ...RYCHLE },
                 jobs: [uloha({ refs: ["C:/predlohy/a.png", "C:/predlohy/b.png",
                                       "C:/predlohy/c.png"] })] });
  f.spustContent();
  await dokud(() => f.stav.hlaseni.length > 0, 90000, "úloha se třemi předlohami nedoběhla");

  ok("odeslalo se se všemi třemi předlohami",
     f.stav.odeslano[0]?.predlohy === 3, `předloh: ${f.stav.odeslano[0]?.predlohy}`);
  ok("úloha hotová", f.stav.hlaseni[0]?.status === "done", f.stav.hlaseni[0]?.status);
  f.window.close();
}

// ---------------------------------------------------------------------------
console.log("\n=== 3) 12 kusů: předlohy se mezi dávkami nevkládají znovu ===");
{
  const f = postavFlow({ dobaGenerovani: 600, dobaNahravani: 1500 });
  f.nastavStav({ running: true, log: [], settings: { ...RYCHLE },
                 jobs: [uloha({ count: 12, refs: ["C:/predlohy/kocka.png"] })] });
  f.spustContent();
  await dokud(() => f.stav.hlaseni.length > 0, 120000, "velká úloha s předlohou nedoběhla");

  ok("odeslány 3 dávky", f.stav.odeslano.length === 3, `dávek: ${f.stav.odeslano.length}`);
  ok("všechny dávky měly předlohu",
     f.stav.odeslano.every((o) => o.predlohy === 1),
     JSON.stringify(f.stav.odeslano.map((o) => o.predlohy)));
  ok("předloha se vložila jen jednou", f.stav.predlohy === 1,
     `náhledů: ${f.stav.predlohy}`);
  ok("staženo 12 souborů", f.stav.stazeno.length === 12, `staženo: ${f.stav.stazeno.length}`);
  f.window.close();
}

// ---------------------------------------------------------------------------
console.log("\n=== 4) Předloha se nenahraje -> úloha selže, nic se negeneruje ===");
{
  // nahravani se zasekne a uz nikdy nedobehne
  const f = postavFlow({ dobaGenerovani: 400, nahravaniNikdyNedobehne: true });
  f.nastavStav({ running: true, log: [],
                 settings: { ...RYCHLE, refWaitSeconds: 4, maxAttempts: 1 },
                 jobs: [uloha({ refs: ["C:/predlohy/kocka.png"] })] });
  f.spustContent();
  await dokud(() => f.stav.hlaseni.length > 0, 200000, "selhání nedorazilo");

  ok("nic se nevygenerovalo", f.stav.odeslano.length === 0,
     `dávek: ${f.stav.odeslano.length}`);
  ok("můstek ví o chybě", f.stav.hlaseni[0]?.status === "failed",
     f.stav.hlaseni[0]?.error);
  const log = await f.dejLog();
  ok("log říká, že se předlohy nenahrály",
     log.some((m) => /předlohy se nenahrály/.test(m)),
     log.find((m) => /předloh/.test(m)) || "(nic o předlohách)");
  f.window.close();
}

// ---------------------------------------------------------------------------
console.log("\n=== 5) Můstek předlohu nevydá -> úloha selže, nic se negeneruje ===");
{
  const f = postavFlow({ dobaGenerovani: 400, predlohaChybi: true });
  f.nastavStav({ running: true, log: [],
                 settings: { ...RYCHLE, maxAttempts: 1 },
                 jobs: [uloha({ refs: ["C:/predlohy/neexistuje.png"] })] });
  f.spustContent();
  await dokud(() => f.stav.hlaseni.length > 0, 120000, "selhání nedorazilo");

  ok("nic se nevygenerovalo", f.stav.odeslano.length === 0,
     `dávek: ${f.stav.odeslano.length}`);
  ok("chyba zmiňuje předlohu", /předlohu/.test(f.stav.hlaseni[0]?.error || ""),
     f.stav.hlaseni[0]?.error);
  f.window.close();
}

// ---------------------------------------------------------------------------
console.log("\n=== 6) Úloha bez předloh po úloze s předlohou je uklidí ===");
{
  const f = postavFlow({ dobaGenerovani: 500, dobaNahravani: 1200 });
  f.nastavStav({ running: true, log: [], settings: { ...RYCHLE },
                 jobs: [
                   uloha({ id: "p-s", refs: ["C:/predlohy/kocka.png"], prompt: "s předlohou" }),
                   uloha({ id: "p-bez", refs: [], prompt: "bez předlohy" }),
                 ] });
  f.spustContent();
  await dokud(() => f.stav.odeslano.length >= 2, 150000, "druhá úloha nedoběhla");

  const sPredlohou = f.stav.odeslano.find((o) => o.prompt === "s předlohou");
  const bezPredlohy = f.stav.odeslano.find((o) => o.prompt === "bez předlohy");
  ok("první úloha měla předlohu", sPredlohou?.predlohy === 1,
     `předloh: ${sPredlohou?.predlohy}`);
  ok("druhá úloha už žádnou neměla", bezPredlohy?.predlohy === 0,
     `předloh: ${bezPredlohy?.predlohy}`);
  f.window.close();
}

console.log(`\n${chyby ? `SELHALO: ${chyby} kontrol` : "Všechny kontroly prošly."}`);
process.exit(chyby ? 1 : 0);
