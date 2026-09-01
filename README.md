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
/cesta/k/tomuto/repu/Google-flow-for-AI/extension
```

Hotovo. Otevři <https://labs.google/fx/tools/flow>, jdi do projektu
a vpravo dole se objeví panel FlowBridge.

---

## Postup, na který je to stavěné

1. Ve Flow si založ **nový prázdný projekt** a nech ho otevřený.
2. Spusť můstek: `python -m flowbridge dashboard`
3. V panelu zkontroluj, že svítí **Můstek: zap** a **Autopilot: zap**
   (obojí je tak výchozí).
4. Od téhle chvíle stačí sypat prompty — ty nebo AI agent přes MCP.

Dál už nemusíš dělat nic. **Autopilot** (výchozí zap) rozjede frontu sám,
jakmile v ní něco přistane, a po vygenerování se všechno samo stáhne
a roztřídí. Panel si adresu projektu zapamatuje a pošle ji můstku, takže
dashboard i agenti vědí, kam se generuje — nikam ji neopisuješ.

## Jak se používá ručně

1. Do pole napiš prompty — **jeden na řádek**, klidně dvacet.
2. Vyber typ (obrázek/video), počet kusů, poměr stran, případně model.
3. **Přidat do fronty**. (Se zapnutým autopilotem se rozjede samo,
   jinak ještě **Spustit**.)

Panel pak jede sám: odesílá, čeká, stahuje. Můžeš ho sbalit šipkou v hlavičce
nebo přetáhnout jinam. Stav přežije i obnovení stránky.

Výsledky se ukládají do:

```
Stažené soubory / FlowBridge / <složka> / <prompt>-<id> / 001.png
```

---

## Obrázek do promptu (předlohy)

K promptu jde připojit až **6 obrázků jako předlohu** — pro udržení postavy,
produktu nebo stylu napříč sérií, a u videa jako výchozí snímek
(image-to-video).

**V panelu:** u pole *předlohy* vyber soubory. Zůstanou vybrané i po
*Přidat do fronty*, takže na jednu postavu můžeš navěsit prompty jeden
po druhém; křížkem u názvu je odebereš.

**Z příkazové řádky** (`--ref` lze opakovat):

```bash
python -m flowbridge add "ta samá postava, jak pije kafe" --ref C:/obrazky/postava.png
```

```bash
python -m flowbridge addfile scenar.txt --ref C:/obrazky/postava.png --tag film
```

**Z agenta** — `flow_enqueue_image`, `flow_enqueue_video` i `flow_enqueue_many`
berou `refs` jako seznam absolutních cest.

### Jak to Flow doopravdy bere

Změřeno na živé stránce (1. 9. 2026) — nic z toho není odhad:

1. **Otevřít výběr médií** (`Create` v ovládacím pruhu). Bez něj Flow nahraný
   obrázek nikde nevykreslí a nahrání vypadá, že selhalo.
2. **Nahrát soubor.** Zápis do `input.files` ze stránky Flow ignoruje —
   rozšíření proto použije ladicí rozhraní (`DOM.setFileInputFiles`), které
   soubory nastaví na úrovni prohlížeče. Flow dostane stejnou událost jako
   od člověka. Žádný systémový dialog se neotevírá.
3. **Z knihovny do promptu.** Nahraný obrázek je zatím jen v Uploads; předlohou
   se stane až tlačítkem **Add to Prompt** na jeho kartě (v seznamu médií je
   totéž schované pod `More`). Rozšíření zkouší obě cesty.
4. **Zavřít výběr médií** — jinak překrývá ovládací pruh a prompt by se
   neodeslal.

Náhled připojené předlohy má v pruhu adresu `media.getMediaUrlRedirect`.
Za připojenou se počítá jen ta, které pak v pruhu opravdu přibude náhled —
kliknutí do nabídky samo o sobě nic nedokazuje.

**Když se předlohu nepodaří připojit, dávka se neodešle.** Obrázek bez
předlohy je jiný obrázek a u videa navíc utracené kredity.

### Jak se obrázek dostane do prohlížeče

`DOM.setFileInputFiles` umí pracovat jen se souborem **na disku**, ne s bajty.
Proto:

- **úlohy od agentů a z příkazové řádky** nesou rovnou cestu k souboru; můstek
  ji posílá v `/ext/pull`. Soubor musí zůstat na místě, dokud úloha nedoběhne.
- **předlohy vybrané v panelu** má prohlížeč jen jako bajty (skutečnou cestu
  neprozradí), takže je nejdřív pošle můstku, ten je uloží do
  `outputs/_předlohy` a vrátí cestu. **Bez běžícího můstku proto předlohy
  z panelu nefungují** — u úloh od agentů to nevadí.

Bajty vybrané v panelu leží v `chrome.storage` mimo stav panelu, aby se
megabajty nepřepisovaly při každém řádku logu; uklidí se, jakmile úloha zmizí
z fronty.

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
| **Spuštění** | S autopilotem se fronta rozjede sama, jakmile v ní něco přistane — od tebe i od agenta. Nic se neklikne. |
| **Odesílání** | Důvěryhodný klik na šipku přes ladicí rozhraní (viz níže), Enter jen jako záloha. Nemusíš u toho být. |
| **Potvrzení** | Že Flow prompt vzal, se pozná ze zachyceného síťového volání — ne z odhadu podle tlačítka. Nic se neodešle dvakrát. |
| **Tempo** | Pauza mezi odesláními je náhodná v rozmezí, které nastavíš v panelu (výchozí 4–11 s). Mezi vlnami je delší, taky náhodná. |
| **Sledování** | Každá úloha si drží `hotovo/celkem`; panel to ukazuje živě, můstek zná stav zvenčí. |
| **Opakování** | Když se z dávky vrátí míň kusů, než se odeslalo, pustí stejný prompt znovu na chybějící počet — až třikrát, s rostoucím odstupem. |
| **Odmítnutí** | Pozná hlášky „unusual activity" i „violate our policies" a napíše je do logu jako důvod. |
| **Stahování** | Hotové kusy stáhne a roztřídí. Když prohlížeč stahování odmítne, stáhne je rozšíření samo a uloží přes můstek. |
| **Přerušení** | Zavřeš prohlížeč? Fronta i stav `běží` jsou v úložišti rozšíření. Po otevření projektu naváže tam, kde skončilo. |
| **Chyby** | Když nesedí selektor, uloží se dump stránky (viz Diagnostika) a úloha se označí jako chybná — nic dalšího se nerozbije. |

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

Můstek je v panelu zapnutý už z výroby (**Můstek: zap**). Rozšíření si chodí
pro úlohy na `http://127.0.0.1:8765`, po dokončení hlásí zpět, co vygenerovalo,
a každých 10 s posílá tep — z něj dashboard ví, jestli je v projektu, jestli
běží odposlech a co naposledy dělalo.

Dashboard na <http://127.0.0.1:8765> ukazuje frontu, historii a útratu kreditů.

### MCP pro agenty

`.mcp.json` je v repu, takže **Claude Code** si server načte sám, jakmile v téhle
složce spustíš relaci. Pro jiného klienta zaregistruj:

```json
{
  "command": "python",
  "args": ["mcp_launch.py"]
}
```

| Nástroj | K čemu |
|---|---|
| `flow_enqueue_image` | zařadí obrázky (1–12 ks), volitelně s předlohami |
| `flow_enqueue_video` | zařadí video, volitelně z výchozího obrázku |
| `flow_enqueue_many` | celý storyboard / série variant naráz (i se stejnými předlohami) |
| `flow_job` | stav úlohy + soubory |
| `flow_list_jobs` | výpis fronty s filtry |
| `flow_queue_status` | souhrn: fronta, kredity |
| `flow_models` | modely a jejich cena v kreditech |
| `flow_cancel` | zruší úlohu |
| `flow_set_paused` | pozastaví / spustí vydávání úloh |
| `flow_set_project` | určí projekt ve Flow, do kterého se generuje |
| `flow_diagnostics` | dump stránky — podle něj se opravují selektory |

### Fronta z příkazové řádky

```bash
python -m flowbridge add "neonová kočka na střeše, filmové světlo" --count 12 --tag kocky
```

```bash
python -m flowbridge addfile prompty.txt --count 12 --tag kampan
```

Dál: `list`, `status --events 20`, `cancel <id>`, `retry <id>`, `pause`, `resume`,
`project [url]`, `dump [--list]`.

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

### Jednorázový krok, který za tebe nikdo neudělá

Rozšíření potřebuje oprávnění **`debugger`** (jinak neodešle — viz níže).
Chrome u takového oprávnění vždycky čeká na potvrzení od člověka:

1. otevři `chrome://extensions`
2. na kartě **FlowBridge** klikni na **↻** (znovu načíst) a nech ho **zapnuté**

Je to bezpečnostní hranice prohlížeče — nedá se obejít skriptem ani jiným
rozšířením. Po tomhle jednom kliknutí už FlowBridge jede bez dozoru.

Poznáš to podle lišty **„FlowBridge ladí tento prohlížeč"** nad stránkou.
Ta lišta musí zůstat; když ji zavřeš, odesílání přestane fungovat.

### Jak se odesílá

Content script vyrábí netrusted události a Flow je na odeslání ignoruje.
Odesílá se proto přes `chrome.debugger` (`Input.dispatchMouseEvent`), což je
vstup na stejné úrovni jako klávesnice — odtud ta lišta o ladění.

Pořadí je stejné jako u člověka: **důvěryhodný klik na šipku**, a teprve když
se do pár vteřin nic nestane, **důvěryhodný Enter**. Mezi tím se čeká na
potvrzení, aby se prompt neposlal dvakrát.

## Odposlech síťových odpovědí

`inject.js` běží v hlavním světě stránky a čte odpovědi z `/fx/api/trpc`.
Řeší tři věci, na které DOM nestačí:

| | |
|---|---|
| **Plné adresy médií** | Seznam ve Flow je virtualizovaný a v `<img>` je zmenšený náhled. V odpovědi je rovnou plná adresa. |
| **Důkaz o odeslání** | Zachycené volání na generování je jistota, ne odhad podle vzhledu tlačítka. |
| **Zůstatek kreditů** | Vyčte se z odpovědi a pošle můstku, takže ho vidí i dashboard. |

Nic se nemění, jen se čte, a ven jde `postMessage` na vlastní origin.
Kdyby odposlech nefungoval, panel spadne zpátky na čtení z DOM a napíše to
do logu — jen je to méně přesné.

## Když Google změní vzhled: diagnostika

Selektory se hledají **podle textu tlačítek** — stabilní CSS třídy ani testid
ve Flow nejsou. Každé přejmenování je proto rozbije a zvenčí prohlížeče to
nikdo neuvidí. Na to je tlačítko **Diagnostika** v panelu.

Uloží dump stránky do `outputs/_diagnostika/dump-<čas>.json`: popisky
ovládacího pruhu, obsah popoveru s nastavením, názvy zachycených volání, stav
ladicího rozhraní a posledních pár řádků logu. **Po chybě typu „Nenašel jsem
tlačítko" se pošle sám.**

```bash
python -m flowbridge dump
```

Agentovi ho podá nástroj `flow_diagnostics` — může tedy selektor opravit,
aniž by kdy viděl tvou obrazovku.

## Co je ověřené a co ne

**Ověřeno proti živému Flow** (přečteno z běžící stránky):

- celá cesta předlohy: výběr médií → `DOM.setFileInputFiles` → knihovna →
  „Add to Prompt" → náhled v ovládacím pruhu,
- interní API Flow — přihlášení, zůstatek kreditů, katalog modelů s cenami,
- struktura ovládacího panelu: prompt je `contenteditable`, popover s volbami
  Image/Video, poměry 16:9 / 4:3 / 1:1 / 3:4 / 9:16, výběr modelu, počty x1–x4
  a řádek s cenou v kreditech.

**Ověřeno testy proti napodobě stránky** (`tests/`, viz níže) — motor fronty,
dávkování, dopočet chybějících kusů, stahování včetně náhradní cesty, autopilot,
automatická diagnostika a celá cesta předlohy od můstku až k odeslanému promptu.

**Zatím neověřeno živým během:**

- že popisky tlačítek a tvar odpovědí ve Flow odpovídají tomu, co selektory
  a odposlech čekají,
- nic zásadního. Předlohy jsou proti živému Flow proměřené krok po kroku
  (viz „Jak to Flow doopravdy bere"); diagnostika hlásí každou fázi zvlášť:
  jestli se našel reactový vstup, jestli je otevřený výběr médií, kolik je
  médií v knihovně a kolik náhledů v pruhu.

První běh proto pusť s dohledem — obrázky jsou zdarma, takže test nic nestojí.
Zadej jeden prompt, počet 4, a koukni do logu dole v panelu. Když se některý
ovládací prvek nenajde, napíše to tam, úloha se označí jako chybná a **sama
uloží diagnostiku**; nic se nerozbije.

## Testy

Motor fronty jede proti napodobě stránky Flow, která se chová podle všeho, co
je o něm zjištěno naostro (prompt jen přes `beforeinput`, `aria-disabled` na
tlačítku, popover, důvěryhodné odeslání, skrytý vstup na soubory). Nepotřebuje
prohlížeč ani přihlášení.

```bash
cd tests && npm install && npm test
```

Dvanáct scénářů: dávkování na 3×4, video a kredity, náhradní Enter,
zablokované stahování, dopočet chybějících kusů, autopilot, rozbité Flow
s diagnostikou — a pět na předlohy: že je nese každá dávka, že se bez nich nic
neodešle, že se cesty berou z můstku, že ty z panelu přežijí obnovení stránky
a pak se z úložiště uklidí, a že se předloha připojí i tou druhou cestou
(nabídkou `More`).

---

## Když něco nefunguje

| Problém | Řešení |
|---|---|
| panel se neobjevil | jsi na `labs.google/fx/tools/flow`? Obnov stránku (F5) |
| „Nenašel jsem pole pro prompt" | otevři konkrétní **projekt**, ne úvodní přehled |
| „Panel s nastavením se neotevřel" | Google změnil vzhled → klikni **Diagnostika** a podle dumpu uprav `popover()` v `content.js` |
| „odposlech sítě neběží" | načti rozšíření znovu v `chrome://extensions` a obnov stránku — `inject.js` se musí spustit před stránkou |
| nestahuje se | zkontroluj v Chrome oprávnění ke stahování; se zapnutým můstkem se to zkusí i druhou cestou (uloží to server) |
| můstek nefunguje | běží `python -m flowbridge dashboard`? Je můstek v panelu na „zap"? |
| nic se nespustí | `python -m flowbridge status` řekne, jestli se prohlížeč hlásí, je v projektu a co naposled dělal |
| „Flow na odeslání nezareagoval" | důvěryhodný klik prošel, ale Flow negeneruje. Zkontroluj, že v Chrome nahoře svítí lišta o ladění (bez ní odesílání nefunguje) a že na kartě nejsou otevřené DevTools. Týká se to i úloh bez předloh — s nimi to nesouvisí. |
| předloha se nepřipojila | v dumpu (`python -m flowbridge dump`) je sekce `predlohy`: jestli se našel reactový vstup, jestli je otevřený výběr médií, kolik je médií v knihovně a kolik náhledů v pruhu |

Selektory hledají prvky **podle textu**, ne podle CSS tříd, takže drobná změna
vzhledu Flow je nerozbije. Když Google přejmenuje tlačítka, vezmi si dump
(`python -m flowbridge dump`) a uprav `content.js` — všechno podstatné je
v sekci „ovladani Flow".

---

## Struktura

```
extension/
    manifest.json   oprávnění a kde se rozšíření spouští
    inject.js       odposlech odpovědí Flow (hlavní svět stránky)
    content.js      panel + motor fronty + ovládání Flow + diagnostika
    background.js   důvěryhodné odeslání, stahování, komunikace s můstkem
    panel.css       vzhled panelu

flowbridge/         volitelná část pro AI agenty
    db.py           SQLite fronta
    dashboard.py    web + můstek /ext/*
    mcp_server.py   rozhraní pro agenty
    cli.py          příkazová řádka
    config.py, state.py

tests/              napodoba stránky Flow + test motoru fronty (Node + jsdom)
```
