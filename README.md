# FlowBridge

Rozšíření do Chrome, které z Google Flow udělá frontu. Naházíš prompty,
ono je odesílá po dávkách, čeká na výsledky a stahuje je roztříděné.
K tomu volitelný lokální server, přes který můžou prompty do fronty
přidávat tví AI agenti (Claude Code, Antigravity).

Rozšíření běží **uvnitř stránky Flow**, takže používá tvoje přihlášení.
Žádný ladicí port, žádné druhé okno, žádné přihlašování navíc.

---

## Instalace rozšíření (jednou, cca minuta)

1. V Chrome otevři `chrome://extensions`
2. Vpravo nahoře zapni **Režim pro vývojáře**
3. Klikni **Načíst nerozbalené** a vyber složku:

```
C:\Users\mvystavel\Grav-Projekty\Google flow\extension
```

Hotovo. Otevři <https://labs.google/fx/tools/flow>, jdi do projektu
a vpravo dole se objeví panel FlowBridge.

---

## Jak se používá

1. Do pole napiš prompty — **jeden na řádek**, klidně dvacet.
2. Vyber typ (obrázek/video), počet kusů, poměr stran, případně model.
3. **Přidat do fronty** → **Spustit**.

Panel pak jede sám: odesílá, čeká, stahuje. Můžeš ho sbalit šipkou v hlavičce
nebo přetáhnout jinam. Stav přežije i obnovení stránky.

Výsledky se ukládají do:

```
Stažené soubory / FlowBridge / <složka> / <prompt>-<id> / 001.png
```

---

## Velká zakázka: 1000 obrázků z 50 promptů

```bash
python -m flowbridge addfile prompty.txt --per-prompt 20 --aspect 1:1 --tag kampan
```

`prompty.txt` = jeden prompt na řádek (prázdné řádky a `#` se ignorují).
`--per-prompt 20` udělá z každého promptu 20 kusů; protože jedna úloha unese
nejvýš 12 (3 dávky po 4), rozpadne se to samo na úlohy po 12 a 8.
50 promptů × 20 = **1000 kusů, 100 úloh**.

Pak stačí mít otevřený projekt ve Flow se zapnutým panelem a **Můstek: zap**.
Rozšíření si úlohy samo vyzvedne a odbaví je jednu po druhé.

Prompty ti napíše kterýkoli AI agent přes MCP (`flow_enqueue_many`), nebo je
prostě vysyp do textového souboru.

### Co dělá samo

| | |
|---|---|
| **Odesílání** | Enterem přes ladicí rozhraní (viz níže). Nemusíš u toho být. |
| **Tempo** | Pauza mezi odesláními je náhodná v rozmezí, které nastavíš v panelu (výchozí 4–9 s). Mezi vlnami je delší, taky náhodná. |
| **Sledování** | Každá úloha si drží `hotovo/celkem`; panel to ukazuje živě. |
| **Opakování** | Když se z dávky vrátí míň kusů, než se odeslalo, pustí stejný prompt znovu na chybějící počet — až třikrát, s rostoucím odstupem. |
| **Odmítnutí** | Pozná hlášky „unusual activity" i „violate our policies" a napíše je do logu jako důvod. |
| **Stahování** | Hotové kusy stáhne a roztřídí; `python tools/presun_na_plochu.py` je pak přesune, kam chceš. |
| **Přerušení** | Zavřeš prohlížeč? Fronta i stav `běží` jsou v úložišti rozšíření. Po otevření projektu naváže tam, kde skončilo. |

## Jak se obchází limit „4 obrázky naráz"

Flow umí odeslat max 4 obrázky na jedno kliknutí a spolehlivě zvládne
3 taková odeslání za sebou → **12 obrázků generujících se současně**.

FlowBridge to dělá automaticky: úloha s počtem 12 se rozpadne na 3 dávky po 4
a pošle je hned za sebou. Protože všech 12 patří jedné úloze, jde je uložit do
správné složky bez hádání, co k čemu patří.

**Chceš maximální průtok? Nastav počet na 12.**

Mezi odesláními je pauza s náhodným rozptylem, aby to drželo lidské tempo.
Změníš ji v `content.js` (`pauseSeconds`).

---

## Napojení AI agentů (volitelné)

Bez tohohle kroku rozšíření funguje samo. Tohle přidá jen možnost, aby prompty
do fronty házeli agenti.

```bash
pip install -r requirements.txt
```

```bash
python -m flowbridge dashboard
```

Pak v panelu FlowBridge klikni na **Můstek: vyp** → přepne se na **zap**.
Rozšíření si od té chvíle chodí pro úlohy na `http://127.0.0.1:8765`
a po dokončení hlásí zpět, co vygenerovalo.

Dashboard na <http://127.0.0.1:8765> ukazuje frontu, historii a útratu kreditů.

### MCP pro agenty

`.mcp.json` je v repu, takže **Claude Code** si server načte sám, jakmile v téhle
složce spustíš relaci. Pro jiného klienta zaregistruj:

```json
{
  "command": "python",
  "args": ["C:\\Users\\mvystavel\\Grav-Projekty\\Google flow\\mcp_launch.py"]
}
```

| Nástroj | K čemu |
|---|---|
| `flow_enqueue_image` | zařadí obrázky (1–12 ks) |
| `flow_enqueue_video` | zařadí video |
| `flow_enqueue_many` | celý storyboard / série variant naráz |
| `flow_job` | stav úlohy + soubory |
| `flow_list_jobs` | výpis fronty s filtry |
| `flow_queue_status` | souhrn: fronta, kredity |
| `flow_models` | modely a jejich cena v kreditech |
| `flow_cancel` | zruší úlohu |
| `flow_set_paused` | pozastaví / spustí vydávání úloh |

### Fronta z příkazové řádky

```bash
python -m flowbridge add "neonová kočka na střeše, filmové světlo" --count 12 --tag kocky
```

```bash
python -m flowbridge addfile prompty.txt --count 12 --tag kampan
```

Dál: `list`, `status --events 20`, `cancel <id>`, `retry <id>`, `pause`, `resume`.

---

## Kredity

Obrázky jsou v tvém tarifu zdarma — Flow to potvrzuje přímo v datech
(`creditMapping.cost: 0` pro Nano Banana 2). Videa stojí kredity, zhruba:

| varianta | kredity |
|---|---|
| Omni Flash 4 s / 360p | 4 |
| Omni Flash 4 s | 7 |
| Omni Flash 8 s | 12 |
| Omni Flash 10 s | 15 |
| úpravy videa | 20+ |

Před každým odesláním si rozšíření přečte skutečný odhad z panelu Flow
(„Generating will use N credits"). Když je vyšší než strop na úlohu
(`maxCreditsPerJob`, výchozí 60), úlohu odmítne a nespustí ji.

---

## Co jsme o Flow zjistili naostro

Zjištěno při prvním ostrém běhu (27. 8. 2026). Bez těchhle věcí automatizace
nefunguje a nejsou nikde zdokumentované:

| Věc | Jak to je |
|---|---|
| **Vložení promptu** | Flow čte **jen událost `beforeinput`**. `execCommand("insertText")` ani zápis do DOM neregistruje — tlačítko odeslat zůstane vypnuté. Mazání: opakovaný `deleteContentBackward` (výběr textu Flow ignoruje). |
| **Stav tlačítka odeslat** | Vypíná se přes `aria-disabled="true"`, ne přes `disabled`. Je to zároveň spolehlivý test, že Flow prompt přijal. |
| **Otevírání nabídek** | React reaguje už na `pointerdown`. Holé `el.click()` nic neudělá — je potřeba celá sekvence pointer/mouse událostí. |
| **Odeslání** | Vyžaduje **důvěryhodnou událost**. Syntetický klik nabídku otevře, ale generování nespustí. Rozšíření samo tohle nedokáže (viz omezení níže). |
| **Popisky tlačítek** | Obsahují i názvy ikon: `crop_square 1:1`, `videocam Video`, `arrow_forward Create`. Shodu hledej na *konci* textu. |
| **Kde jsou výsledky** | Na `labs.google/fx/api/trpc?name=…`, tedy stejná doména — ne na googleusercontent. |
| **Spojení na localhost** | CSP stránky Google ho **zakazuje**. Stránka nemůže poslat data na `127.0.0.1`; musí přes rozšíření. |
| **Hromadné stahování** | Chrome ho stránce po pár souborech zablokuje. `chrome.downloads` z rozšíření tomu nepodléhá — proto ta cesta. |
| **Tempo** | Při rychlém sypání dávek Flow jednu generaci odmítl s „We noticed unusual activity". Drž pauzy mezi odesláními. |
| **Přímý odkaz na projekt** | Když Chrome nastartuje rovnou na `…/project/<id>`, Flow často spadne na „Application error" — stránka se načte, ale ovládací pruh chybí. Rozšíření to pozná a stránku obnoví (až 3×). |
| **Ladicí kanál** | Na jednu kartu pustí Chrome jen jednoho ladicího klienta. Když je připojený jiný nástroj (otevřené DevTools), `chrome.debugger.attach` se nevrátí vůbec — odesílání proto má časový limit a napíše to do logu. |

### Zásadní omezení

**Rozšíření samo neumí zmáčknout odeslat.** Content script produkuje netrusted
události a Flow je na odeslání ignoruje. Panel proto zvládne všechno ostatní
(fronta, nastavení, čekání, stahování, třídění), ale vlastní odeslání musí
spustit buď člověk, nebo nástroj s přístupem k CDP. Řešení do budoucna je
`chrome.debugger` v manifestu — Chrome pak povolí posílat důvěryhodné vstupy
(za cenu lišty „FlowBridge ladí tento prohlížeč").

## Co je ověřené a co ne

**Ověřeno proti živému Flow** (přečteno z běžící stránky):

- interní API Flow — přihlášení, zůstatek kreditů, katalog modelů s cenami,
- struktura ovládacího panelu: prompt je `contenteditable`, popover s volbami
  Image/Video, poměry 16:9 / 4:3 / 1:1 / 3:4 / 9:16, výběr modelu, počty x1–x4
  a řádek s cenou v kreditech,
- syntaxe rozšíření, můstek `/ext/pull` a `/ext/report`, MCP server (9 nástrojů).

**Zatím neověřeno živým během:**

- vlastní odeslání promptu a stažení výsledku rozšířením.

První běh proto pusť s dohledem — obrázky jsou zdarma, takže test nic nestojí.
Zadej jeden prompt, počet 4, a koukni do logu dole v panelu. Když se některý
ovládací prvek nenajde, napíše to tam a úloha se označí jako chybná; nic se
nerozbije.

---

## Když něco nefunguje

| Problém | Řešení |
|---|---|
| panel se neobjevil | jsi na `labs.google/fx/tools/flow`? Obnov stránku (F5) |
| „Nenašel jsem pole pro prompt" | otevři konkrétní **projekt**, ne úvodní přehled |
| „Panel s nastavením se neotevřel" | Google změnil vzhled → uprav `popover()` v `content.js` |
| nestahuje se | zkontroluj v Chrome oprávnění ke stahování pro rozšíření |
| můstek nefunguje | běží `python -m flowbridge dashboard`? Je můstek v panelu na „zap"? |

Selektory hledají prvky **podle textu**, ne podle CSS tříd, takže drobná změna
vzhledu Flow je nerozbije. Když Google přejmenuje tlačítka, uprav
`content.js` — všechno podstatné je v sekci „ovladani Flow".

---

## Struktura

```
extension/
    manifest.json   oprávnění a kde se rozšíření spouští
    content.js      panel + motor fronty + ovládání Flow
    background.js   stahování a komunikace s můstkem
    panel.css       vzhled panelu

flowbridge/         volitelná část pro AI agenty
    db.py           SQLite fronta
    dashboard.py    web + můstek /ext/*
    mcp_server.py   rozhraní pro agenty
    cli.py          příkazová řádka
    config.py, state.py
```
