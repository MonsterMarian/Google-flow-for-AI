---
name: static-ads
description: Generátor statických reklam (Meta/FB/IG) přes Google Flow - z názvu značky, webu a fotky produktu udělá sérii reklamních konceptů podle 37 ověřených šablon a pošle je do fronty FlowBridge. Spouštět jen na výslovné vyžádání (/static-ads).
disable-model-invocation: true
argument-hint: <značka> <url> [cesta k fotce produktu] [počet konceptů]
---

# static-ads

Workflow „značka + URL → desítky statických reklam" (Mike Futia, Claude Code + Nano Banana 2),
šablony z [krusemediallc/arcads-claude-code](https://github.com/krusemediallc/arcads-claude-code)
(MIT, commit 6dcf110, viz `LICENSE-arcads-claude-code`). Místo placeného Arcads/FAL API generuje
Google Flow přes MCP `flowbridge` - obrázky jsou zdarma.

Vstup: `$ARGUMENTS`

## Postup

1. **Vstupy.** Značka, URL, volitelně fotky produktu (absolutní cesty - jdou jako `refs`, drží
   věrnost obalu a loga), počet konceptů (výchozí 12). Chybí-li značka nebo URL, zeptej se.
2. **Průzkum značky.** WebFetch na URL (+ případně stránku produktu / recenze). Sepiš krátký brief:
   `{brand.name}`, `{brand.color_primary}` (hex), `{brand.product_description}` (jak produkt
   vypadá), `{brand.competitor_category}`, `{brand.tagline}`, cílovka, 3-5 hlavních benefitů,
   námitky zákazníků, skutečné citace z recenzí. Nevymýšlej čísla ani ocenění, která na webu nejsou.
3. **Výběr šablon.** Přečti `prompt-library.md` (ve složce tohoto skillu). Vyber různorodé šablony
   (mix: sociální důkaz, srovnání, benefit, lifestyle, UGC). Preferuj ty, kde je v `Model notes`
   **nano-banana** „clean"/„preferred"; šablony slabé na drobný text vynech nebo zjednoduš (méně řádků).
   `model` neposílej - jede výchozí Nano Banana. Přepnutí na `Nano Banana Pro` rozšíření
   (11/2026) nezvládne a vrátí starý obrázek z projektu místo nového.
4. **Vyplnění.** Doplň proměnné šablony z briefu. Text v reklamě v jazyce webu značky, pokud
   uživatel neřekne jinak. Na konec **každého** promptu přidej tři bloky z `safety-suffixes.md`
   (`[NO PLATFORM CHROME]`, `[EDGE-SAFE]`, `[TEXT FIDELITY]`) - doslova, ne parafrázovat.
5. **Poměr stran.** Flow umí jen `1:1`, `16:9`, `9:16`, `4:3`, `3:4`. Převod: `2:3`, `4:5` → `3:4`;
   `3:2`, `5:4` → `4:3`; `21:9` → `16:9`. Začátek promptu („2:3 portrait…") uprav na skutečný poměr.
6. **Fronta.** `flow_queue_status` - pokud worker neběží nebo prohlížeč nehlásí projekt, řekni to
   uživateli (spustit `python -m flowbridge dashboard`, otevřít projekt ve Flow). Pak
   `flow_enqueue_many` - jedno volání na každý poměr stran, `kind="image"`,
   `count=2` (2 varianty na koncept), `refs` = fotky produktu, `tag="ads-<znacka>"`.
   Videa nikdy - stojí kredity.
7. **Kontrola.** Průběžně `flow_job` na vrácená ID. Hotové obrázky si prohlédni (Read) a hlídej:
   rozsypaný drobný text, chybné prsty, posunuté logo, jiný počet prvků než v promptu.
   Vadný koncept jednou přegeneruj s opraveným promptem (max 2 pokusy).
8. **Výstup.** Krátká tabulka: koncept → šablona → soubory (cesty). Žádné nahrávání do Meta.
