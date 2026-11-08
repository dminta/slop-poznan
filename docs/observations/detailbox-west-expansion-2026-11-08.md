# Rozszerzenie detail boxu na zachód — 2026-11-08

Zakres: analiza wykonalności przesunięcia zachodniej krawędzi `GEO.frame.detailBox` z `x = −3 675,4` do
King Cross Marcelin, Business Garden i portu lotniczego Poznań-Ławica. Punkt wyjścia: pozycja „Building density
follow-up” w [backlogu](../backlog.md) i wcześniejsze zapisy
[building-density-2026-11-07](building-density-2026-11-07.md) oraz
[non-residential-audit-2026-11-08](non-residential-audit-2026-11-08.md), które świadomie odłożyły tę zmianę.

> **Wdrożenie 2026-11-08:** Etap 1 (wariant A, `x_min = −5 250`) jest w `main`/`poznan`: dane scalone
> `tools/merge-extent.mjs`, King Cross jako kwartał 1475, Business Garden jako kwartał 1492 z programem 9, pełny
> zestaw testów 470/470. Pomiar i zmiany: [wdrożenie Etapu 1](detailbox-west-phase1-2026-11-08.md). **Etap 2 (Ławica,
> `x_min = −9 120`) wdrożony 2026-11-08:** nowy snapshot `aeroway`, wycięcie aerodromu z rastra bloków i
> `js/airport.js`; pomiar i zmiany: [wdrożenie Etapu 2](detailbox-west-phase2-2026-11-08.md).

## Wniosek

1. **King Cross i Business Garden da się włączyć tanio i bez nowego modułu renderującego**: wystarczy
   `x_min = −5 250` (wariant A). To +19 % komórek rastra bloków, +17 % linków grafu, +19 % colliderów budynków.
2. **Lotnisko jest osobnym problemem, nie kolejnym kawałkiem miasta.** Aby objąć cały aerodrom, trzeba zejść do
   `x_min = −9 120` (wariant B), czyli +67 % rastra, +41 % linków i +55 % colliderów. Bez dedykowanej warstwy
   lotniskowej sam raster bloków zamienia płytę lotniska w jeden kwartał o powierzchni **7,95 km²**, którego
   największa działka ma **2,83 × 1,36 km** — generator `buildings.js` postawiłby na niej osiedle willi.
3. **Rekomendacja: dwa etapy.** Etap 1 (A) wdraża King Cross i Business Garden. Etap 2 (B) dodaje lotnisko razem
   z nowym snapshotem `aeroway`, wyłączeniem aerodromu z rastra bloków i modułem `js/airport.js`. Jeżeli wszystko
   ma wejść w jednym wydaniu, to tylko w wariancie B *z* warstwą lotniskową — nigdy B bez niej.
4. **Nie odświeżać całego boxu bez potrzeby.** Nowy fetch całego obszaru (OSM base 2026-11-08) zmienia też rdzeń:
   w prototypie ubyło 40 kwartałów na wschód od starej krawędzi, a 32/456 testów `*.cjs` przestało przechodzić.
   Po scaleniu starych snapshotów z wyłącznie zachodnim wycinkiem (te same id OSM → stara wersja) rdzeń zostaje
   zamrożony, a nowe bloki dopisują się na końcu. Zmierzone przesunięcie id to wtedy **−2** dla większości
   katalogowych kwartałów, a nie dziesiątki–setki jak przy pełnym refreshu.

## Co leży za obecną krawędzią

Współrzędne świata: `x` wschód, `z` południe, origin Ratusz. Obecna krawędź zachodnia to `x = −3 675,4`
(`16.880 E`). Wszystkie trzy obiekty leżą w pasie `52.404–52.427 N`, więc zmiana `z` nie jest potrzebna.

| Obiekt | OSM | Środek `x, z` | Zasięg `x` | Zasięg `z` | Odległość od starej krawędzi |
|---|---|---:|---:|---:|---:|
| King Cross Marcelin | way 341510638 | −4 928,7, −233,8 | −5 098,8 … −4 757,9 | −324,0 … −144,4 | 1 423 m (zachodni obrys) |
| Business Garden | landuse way 1156185020 | −4 630,4, +203,1 | −4 737,2 … −4 513,6 | −22,1 … +443,4 | 1 062 m (zachodni obrys) |
| Terminal pasażerski | way 224469236 | −7 171,3, −705,5 | −7 246,8 … −7 065,7 | −747,1 … −635,3 | 3 496 m |
| Aerodrom Ławica | way 342024881 | — | −9 088,6 … −5 401,0 | −2 092,4 … −575,1 | 5 413 m (zachodni obrys) |
| Pas startowy 10/28 | way 22969774 | — | −8 705 … −6 329 | −1 825 … −1 074 | 5 030 m (zachodni koniec) |

Pomiar OSM (Overpass, 2026-11-08): aerodrom ma **2,81 km²**, pas **2 492 × 50 m** (końce `−8 705,−1 825` →
`−6 329,−1 074`, azymut rzeczywisty ≈ 107,5°), 83 drogi kołowania, 22 płyty postojowe (9,3 ha), 7 terminali
(25 846 m² łącznie) i 30 stanowisk postojowych. To materiał na warstwę GIS, nie na zwykły kwartał.

### Wymagane `x_min`

| Zakres | Najdalej wysunięty obiekt | `x_min` z marginesem | Uwaga |
|---|---|---:|---|
| tylko Business Garden | −4 737,2 | −4 800 | nie obejmuje King Cross |
| King Cross + Business Garden (A) | −5 098,8 | **−5 250** | 150 m marginesu na obrys i padding |
| terminal + płyta (B1) | −7 246,8 | −7 300 | pas startowy urwany na zachodzie |
| cały aerodrom (B) | −9 088,6 | **−9 120** | 31 m marginesu; query padding do `16.795 E` |

## Warianty granicy

| | baseline | A: King Cross + Business Garden | B: + Ławica |
|---|---:|---:|---:|
| `DETAIL_LL.w` | 16.880 | **16.85686** | **16.800** |
| `x_min` | −3 675,4 | **−5 250,0** | **−9 119,5** |
| szerokość / pole | 8 166 m / 46,3 km² | 9 741 m / 55,3 km² (+19 %) | 13 610 m / 77,2 km² (+67 %) |
| kwartały (`GEO.blocks`) | 1 418 | **1 645** | **2 021** |
| linki grafu | 7 121 | **8 329** | **10 032** |
| drogi w grafie | 452,6 km | **547,2 km** | **700,4 km** |
| raster bloków 1 m | 8 168 × 5 677 | **9 743 × 5 677** | **13 612 × 5 677** |
| raster lądu runtime 2 m | 11,6 M komórek | **13,8 M** | **19,3 M** |
| collidery budynków (headless) | 33 251 | **39 717** (+19 %) | **51 672** (+55 %) |
| `js/geodata.js` | 2 648 KB | **3 001 KB** | **3 532 KB** |
| peak RSS builda | 1,36 GB | **1,53 GB** | **2,09 GB** |
| build (ta maszyna) | 49,2 s | **62,9 s** | **54,1–62,9 s** |

Czasy B wahają się między przebiegami (54,1 s na danych scalonych z wyłączonym aerodromem, 62,9 s na pełnym
refreshu); różnica A/B w outlines/lots/frames jest mała (46,7 s vs 50,9 s), bo koszt dominujący to nie liczba
komórek, lecz `blockFrames` i `lotRects` na dużych kwartałach. Wszystkie liczby pochodzą z jednej maszyny i tej
samej wersji Node (v26.13.0); dokumentacyjne 29 s/1,27 GB to wcześniejszy, szybszy przebieg.

### Co rośnie w danych wejściowych

Zachodni wycinek `16.800–16.875 E` (padded `16.795`) to **16 500 budynków** (cały nowy snapshot: 44 234 elementy,
wobec 24 569). Sam pas A `16.85686–16.875` to **4 045 budynków**. Dróg w pasie `−3 675 … −9 100` jest
**428,6 km** (A: 173,1 km), z czego 102,7 km to `highway=service` — dlatego graf rośnie wolniej niż długość OSM.

| plik | baseline | pełny nowy fetch | uwaga |
|---|---:|---:|---|
| `poz_buildings.json` | 19,8 MB | 32,5 MB | +16 500 way; 77 % z `building:levels` |
| `poz_roads.json` | 8,4 MB | 11,2 MB | +2 993 way po scaleniu |
| `poz_parks.json` | 13,3 MB | 15,3 MB | małe zieleńce tylko w padded box |
| `poz_signals.json` | 1,3 MB | 1,7 MB | +2 222 node po scaleniu |
| `poz_rail.json` | 2,4 MB | 2,7 MB | +109 way po scaleniu |
| `poz_industry.json` | 0,3 MB | 0,4 MB | +75 elementów po scaleniu |
| `poz_tram_routes.json` | 0,4 MB | 0,4 MB | bez zmian (brak tramwaju na zachodzie) |
| `poz_aeroway.json` | — | **0,2 MB** | nowy, tylko wariant B |

## Architektura zmian

### 1. Granica i snapshoty

Jedynym źródłem prawdy dla boxu jest `DETAIL_LL` w `tools/poz-base.mjs`; `DETAIL_BOX`, `inDetailBox`,
`GEO.frame.detailBox`, `CITY_BOUNDS` i raster lądu w `city-config.js` wyliczają się z niego. Nie ma drugiego
miejsca do zmiany.

```js
// tools/poz-base.mjs
// A: King Cross + Business Garden (x -5250)
const DETAIL_LL = { s: 52.383, n: 52.434, w: 16.85686, e: 17.000 };
// B: + Ławica (x -9120); wymaga warstwy lotniskowej i nowego snapshotu aeroway
// const DETAIL_LL = { s: 52.383, n: 52.434, w: 16.800, e: 17.000 };
```

Padded box w query jest o ~330 m szerszy od D3. Dla A wszystkie `q_poz_*.overpassql` zamieniają
`52.380,16.875,52.437,17.005` na `52.380,16.852,52.437,17.005`, a `q_poz_landmarks` swoje D3 na
`52.383,16.857,52.434,17.000`. Dla B: `52.377,16.795,52.437,17.005` i `52.383,16.800,52.434,17.000`
(prototyp używał dokładnie tych wartości). `q_poz_water` i `q_poz_admin` są miastowe i nie wymagają zmian.

**Nie robić pełnego refreshu całego boxu.** OSM między 2026-10-28 a 2026-11-08 zmienił rdzeń: pełny nowy
snapshot dał 1 378 kwartałów na wschód od starej krawędzi zamiast 1 418 i przesunął id o setki. Bezpieczna
ścieżka to jednorazowy merge:

```text
tools/merge-extent.mjs  (jednorazowo, wynik commitowany jako tools/data)
  dla każdego poz_*.json:
    zachowaj wszystkie elementy ze starego snapshotu
    dołóż z nowego tylko te, których id nie ma w starym i których max lon <= 16.883
```

W prototypie dało to: roads 2 993 nowe, buildings 18 775, signals 2 222, rail 109, parks 1 118,
industry 75, tram_routes 0. Elementy rdzenia pozostały semantycznie identyczne z commitem (JSON jest
przeserializowany), a pliki po `JSON.stringify` są mniejsze niż surowy Overpass (np. buildings 24,4 MB
zamiast 32,5 MB).

### 2. Kolejność i identyfikatory kwartałów

`poz-blocks.mjs` numeruje kwartały w kolejności skanowania rastra. Po powiększeniu boxu każdy nowy kwartał
na zachód od starej krawędzi przesuwa id wszystkich późniejszych. Prototyp z pełnym skanem dał przesunięcie
o dziesiątki–setki (np. Posnania 955 → 1300, Głogowska 1250 → 1748). To wymusza zmianę kilkunastu stałych
w testach i audytach.

Prostszy, wystarczający remap: posortuj komponenty po ich pierwszej komórce **na wschód od starej krawędzi**
(stary porządek skanowania) i dopiero na końcu dopisz komponenty całkowicie zachodnie. Kwartał, który urósł
na zachód, zachowuje id; nowe kwartały nie przesuwają starych. W prototypie (dane scalone + ten remap)
prawie wszystkie id spadły o **2**, bo tylko dwa nowe kwartały przy krawędzi trafiły przed stare:

```js
// tools/poz-blocks.mjs, po etykietowaniu 4-spójnym i przed składaniem `blocks`
const OLD_WEST_X = -3675.4;
{
  const oldI = Math.max(0, Math.ceil((OLD_WEST_X - R.x0) / RES));
  const keyOf = (c) => {
    if (c.start % W >= oldI) return c.start;
    for (let j = c.j0; j <= c.j1; j++) {
      for (let i = Math.max(c.i0, oldI); i <= c.i1; i++) if (lab[j * W + i] === c.id) return j * W + i;
    }
    return Infinity;
  };
  const keyed = comps.map((c) => [keyOf(c), c]);
  keyed.sort((a, b) => a[0] - b[0] || a[1].start - b[1].start);
  comps.length = 0;
  for (const [, c] of keyed) comps.push(c);
}
```

To nie jest idealne (dwa nowe kwartały przy krawędzi nadal przesuwają id o 2), ale redukuje migrację z
kilkuset pozycji do kilkunastu. Alternatywa — stałe id oparte na współrzędnej zamiast kolejności — jest
czystsza na przyszłość, ale sama w sobie renumberuje cały obecny zbiór, więc nie jest darmowa.

### 3. King Cross: blok 1610 (B) / 700 (pełny refresh)

Po włączeniu do boxu OSM daje kwartał z `blockStats = [0.44, 2, 2, 3]`: 44 % zabudowy, 2 budynki,
program 3 (retail/mall) i anchor `[-5099, -4758, -324, -145, 46 748, 1, 2]`. `buildings.js` buduje go jako
`MALL` z anchoru, więc **sylwetka King Cross nie wymaga nowego kodu** — wystarczy usunąć wpis z
`SATELLITE_SITES`.

Dwie poprawki jakościowe:

- `blockAnchors` niesie `levels = 2`, a `fillAnchor` dla mallu wymusza minimum 3 piętra (≈ 10,2 m).
  Rzeczywista hala ma ~15 m. Warto dodać małą tabelę korekt po OSM id:
  `[[341510638, 4]]` (13,6 m) albo curated `h = 15`.
- Kwartał ma 35 % parku (OSM `landuse=grass` wokół parkingu). To nie przeszkadza, ale przy prof. 3 i
  `park > 0.6` generator zachowuje profil dzielnicy; tutaj 0,35 < 0,6, więc MALL wygrywa.

### 4. Business Garden: brakuje programu „office”

To najważniejsza luka jakościowa wariantu A. Business Garden ma 10 budynków `building=office`,
`building:levels=6`, 27 % zabudowy i **program 0**. `buildingUse` nie klasyfikuje `office` (poza
`office=university`), a `anchorUse` również nie, więc kwartał 1652 wpada w profil dzielnicy Ławica:
`L >= 4 → midKind()`, `built = 0.27 ≥ 0.2 → RES_KAMIENICE`. Efekt: zamiast kampusu biurowego powstanie
gęsty kwartał kamienic.

Minimalna zmiana w `tools/poz-buildings.mjs`:

```js
// po gałęzi university, przed sport/utility/retail
if (kind === 'office') return 9; // office campus (Business Garden, biura w Ławicy)
```

W `js/buildings.js` dołożyć profil i gałąź:

```js
const OFFICE_CAMPUS = {
  kind: 'offices', tower: [6, 6], mid: [4, 6], towerP: 0.25, coreFloors: [2, 4],
  inner: [['pavilion', 2], ['yard', 3], ['works', 1]]
};
// w blockProfile(), obok case 3-8:
case 9: return OFFICE_CAMPUS;
```

`blockStats` program rośnie z 0–8 do 0–9; trzeba zaktualizować komentarz kontraktu w `build-poznan.mjs`,
`docs/geodata.md` i asercję zakresu w `tests/geodata.test.mjs`. `anchorUse` zostaje 0 — nie chcemy, żeby
jeden budynek zjadał cały kampus.

### 5. Lotnisko: nowy snapshot i warstwa, nie kwartał

**Bez tego kroku wariant B jest błędny.** W pełnym buildzie aerodrom tworzy kwartał #140: 7,95 km², 761
budynków w statsach (terminale, hangary i okoliczne zabudowania), 7 działek, z których pierwsza ma
`2 827 × 1 361 m`. `buildings.js` potraktowałby ją jak jedną działkę willową.

Proponowany kontrakt:

```js
// tools/data/q_poz_aeroway.overpassql — tylko wariant B
[out:json][timeout:180];
(
  way["aeroway"](52.377,16.795,52.437,16.860);
  relation["aeroway"](52.377,16.795,52.437,16.860);
);
out body geom;
```

Nowy `tools/poz-aeroway.mjs` (import-time, jak poz-water/poz-extra) czyta snapshot i emituje:

```js
// GEO.aeroway: [{ kind, ring, h? }]
// kind: 'runway' | 'taxiway' | 'apron' | 'terminal' | 'helipad'
// ring: flat [x0, z0, ...], negative winding, rdp 0.5 m
// h: tylko terminal (building:levels * 3.4, minimum 8 m)
```

W `build-poznan.mjs`: `import { aeroway } from './poz-aeroway.mjs';` i `aeroway` w `GEO` (z komentarzem
kontraktu). W `poz-blocks.mjs`, po przywróceniu wysp kolejowych, a przed etykietowaniem:

```js
// aerodrom nie jest kwartałem: pas, kołowania, płyty i terminale rysuje js/airport.js
{
  const surfaces = load('poz_aeroway.json').elements.filter((e) => (e.tags || {}).aeroway === 'aerodrome');
  const M = new Raster(R.x0, R.z0, R.x0 + (W - 1) * RES, R.z0 + (H - 1) * RES, RES);
  M.d = D;
  for (const e of surfaces) for (const ring of elemRings(e, toWorld)) if (ring.length > 3) M.fillRing(ring, 0);
}
```

Pomiar: wyczyszczenie aerodromu zabiera **2,81 km²** z „block land” (68,79 → 65,98 km²) i usuwa gigantyczną
działkę; liczba kwartałów nieznacznie rośnie (2 020 → 2 021), bo pierścień aerodromu rozcina sąsiednie
kwartały. Terminale przestają być kwartałami — rysuje je warstwa lotniskowa.

`js/airport.js` (nowy moduł, `buildAirport(scene)`):

- jedna zmergowana geometria asfaltu dla `runway` + `taxiway` + `apron`, podniesiona 3 cm nad deckiem lądu,
  materiał tarmacu (1 pipeline);
- pas: biała linia środkowa, progi i oznaczenia 10/28 jako instancjonowane cienkie quady (1–2 draw calle);
- terminale: bryły z `h` i prostym materiałem szklano-panelowym, bez wnętrz;
- brak colliderów dla płaskich nawierzchni; ściany terminali opcjonalnie jako `obb`;
- grupa `Airport` wchodzi w zwykły culling; `main.js` woła `buildAirport(scene)` po `buildCityGrid`, przed
  `buildOutskirts`.

Koszt: 1 nowy pipeline elewacji (można współdzielić z `tsl-materials`), 2–3 pipeline’y nawierzchni,
kilka draw calli. Nowy moduł wymaga `<link rel="modulepreload" href="./js/airport.js" />` w `index.html`
i bumpa licznika w `tests/boot.test.cjs`.

### 6. Outskirts i satelity

- **`js/satellite-sites.js`**: usunąć wpis `king-cross` (3 części, 46 860 m²). Reszta zostaje; żaden inny
  satelita nie leży w nowym boxie. Zaktualizować nagłówek (lista obiektów) i
  `tests/outskirts-satellites.test.cjs` (usunąć `king-cross` z listy i asercję 3 części).
- **`js/outskirts.js`**, wariant A: przesunąć początek pasa suburbii
  `luRect(-30000, -30000, -5600, 30000, SUBURB, 150)` na `-5250`, żeby pas `−5 600…−5 250` nie pozostał
  bez flagi. Malowany aerodrom (`luEllipseLL(16.826, …)`) zostaje — leży cały na zachód od `−5 250`.
- **`js/outskirts.js`**, wariant B: usunąć malowany aerodrom (linie z `luEllipseLL(16.826, 52.421, …)`,
  `luStripLL(16.826, …)` i `luEllipseLL(16.832, 52.426, …)`), bo jest teraz w boxie i rysuje go
  `js/airport.js`. `luRect` suburbii może zostać na `−5600` (wszystko na zachód od `−9 120` jest już
  zamalowane), ale komentarz trzeba poprawić.
- **`OUTSKIRTS`** generuje się automatycznie jako miasto minus nowy box; liczba pierścieni rośnie 9 → 13
  w wariancie B (land 25,2 → 56,2 km² po stronie zachodniej), a generyczne budynki z zachodu znikają.
  To jest właściwy „outskirts re-check”: po zmianie nie ma już generycznych szop w pasie, który stał się
  szczegółowy.
- **`city-map.js`**: bez zmian kodu; „Fit all” dopasuje się do nowego boxu. Warto dodać etykiety
  `King Cross`, `Business Garden`, `Port Lotniczy Poznań-Ławica` do `labels`/`LANDMARK_SITES`, jeśli mają
  być widoczne na mapie.

### 7. Ruch, piesi i culling

- `NUM_CARS = 200` i `NUM_PEDS = 340` są stałe; gęstość w promieniu 350 m (`VEHICLE_DENSITY`) nie rośnie
  od samego powiększenia. Rośnie natomiast graf tras i liczba kandydatów do spawnu — koszt pamięci i
  czasu budowy, nie FPS w centrum.
- Liczba pieszych tras rośnie z liczbą chodników; w prototypie testy tras wydłużyły się o dziesiątki sekund.
  To głównie koszt startu, nie klatki.
- `scene-culling.js` dzieli instancje po 500/1000 m; nowy obszar to 2–4 dodatkowe komórki na rodzinę
  propów. Draw calls rosną o kilkanaście–kilkadziesiąt, nie proporcjonalnie do +67 % terenu.
- Collidery budynków: +19 % (A) / +55 % (B), mierzone headless przez `loadBuildingColliders()`
  (33 251 → 39 717 → 51 672; 3,0 → 3,4 → 5,7 s). To najlepszy dostępny wskaźnik wzrostu geometrii miasta.

## Plan migracji krok po kroku

### Etap 0 — decyzja

1. Wybrać A (rekomendowane na teraz) albo A+B (jeśli lotnisko ma być szczegółowe w tym wydaniu).
2. Przy B zaakceptować, że gracz dojedzie do terminala (krawędź `−9 120`), więc terminale muszą wyglądać
   z poziomu ulicy; przy A lotnisko pozostaje 150 m za krawędzią i wystarcza obecna sylwetka outskirts.

### Etap 1 — dane (bez zmian w `js/geodata.js`)

3. Zmienić `DETAIL_LL.w` w `tools/poz-base.mjs`.
4. Zmienić padded bbox we wszystkich `q_poz_*.overpassql` (A: `16.852`; B: `16.795`) i D3 w
   `q_poz_landmarks.overpassql`.
5. Dla B dodać `q_poz_aeroway.overpassql`.
6. Pobrać **tylko zachodni wycinek** (`bash tools/overpass.sh ...`, po jednym pliku), a następnie scalić ze
   starymi snapshotami przez `tools/merge-extent.mjs`; commitować wynik merge, nie surowy pełny fetch.
7. Sprawdzić logi `[geodata]`: liczba elementów, `land`, `outskirts`, `blocks`, `road graph`, `parks`,
   `industry`, KB per key.

### Etap 2 — narzędzia

8. `poz-blocks.mjs`: remap id (sekcja 2) i, dla B, wyczyszczenie aerodromu (sekcja 5).
9. `poz-buildings.mjs`: program 9 dla `building=office`; korekta poziomów King Cross (OSM id 341510638 → 4).
10. `poz-aeroway.mjs` + `GEO.aeroway` (tylko B).
11. `build-poznan.mjs`: import/emit `aeroway`, komentarz kontraktu, zakres programów 0–9.
12. Rebuild do `/tmp/geodata-west.js`; `cmp` z commitem tylko dla kontroli, że rdzeń się nie zmienił
    (przy merge powinien być identyczny poza nowymi kluczami i id). Dopiero potem podmienić
    `js/geodata.js`.

### Etap 3 — runtime

13. Usunąć King Cross z `js/satellite-sites.js`; zaktualizować test satelitów.
14. `js/buildings.js`: `OFFICE_CAMPUS` i `case 9`.
15. Dla B: `js/airport.js`, `main.js`, `index.html` (modulepreload), `tests/boot.test.cjs`.
16. `js/outskirts.js`: `luRect` (A) lub usunięcie malowanego aerodromu (B); komentarze.
17. Opcjonalnie teleporty `kingcross` i `lawica` w `city-config.js` (punkt na osi jezdni, test
    `tests/teleports.test.cjs`).

### Etap 4 — testy i dokumentacja

18. Zaktualizować stałe kwartałów (tabela niżej), liczniki miastowe i progi.
19. `node --test tests/*.cjs`; potem `node --test tests/geodata.test.mjs tests/overpass.test.mjs`.
20. `node --max-old-space-size=8192 tools/build-poznan.mjs` drugi raz i `cmp` — determinizm.
21. Zaktualizować `docs/geodata.md` (box, snapshoty, liczby), `docs/world.md` (liczby), `docs/backlog.md`
    (zamknąć punkt o zachodniej krawędzi), `README.md` jeśli zmienia się opis zasięgu.
22. Browser check (WebGPU + WebGL2): konsola, load time, FPS w centrum i nad King Cross/Business Garden;
    przy B lot nad Ławicą i przejazd Bukowską do terminala.

## Testy

**Stan wyjściowy (bez zmian):** `node --test tests/*.cjs` → **456/456 pass**, ≈ 71–74 s (2026-11-08, ta gałąź).

**Prototyp (scalony snapshot + pełny zachód + wyłączony aerodrom, stare testy i dokumentacja):**
**425/456 pass, 31 fail**. To nie są regresje funkcjonalne w rdzeniu — po merge rdzeń jest zamrożony —
lecz głównie konsekwencje przesunięcia id i nowych liczników. Podział:

| Grupa | Przykłady | Działanie |
|---|---|---|
| id kwartałów −2 | `666→664`, `848→846`, `927→925`, `939→937`, `613→611`, `693→691` | podmienić stałe; lepiej szukać kwartału po nazwie/współrzędnej |
| id w `geodata.test` | `955→953`, `828→826`, `991→989`, `1250→1248` | jak wyżej; `21` i `266` bez zmian |
| liczniki miasta | balustrady 19 458, zebry 5 358, latarnie 2 059, plantery 138, 41 parków | przeliczyć baseline po zmianie |
| raporty w docs | `docs/geodata.md` P-22 | wygenerować nowy raport i wkleić |
| satelity | brak `king-cross` | usunąć z testu razem z wpisem |
| do zbadania | (1) trasa kończy się w ślepym chodniku `−1964,−391`; (2) przejazd Bałtycka wschód; (3) minimalny dystans drzew | sprawdzić, czy to nowa geometria zachodu, czy tylko indeksy |

Konkretne pliki do przejrzenia: `tests/buildings-density.test.cjs` (666, 577, 427, 476, 848, 927, 939,
613, 693), `tests/geodata.test.mjs` (955, 21, 848, 828, 991, 927, 939, 1250; zakres programów 0–9),
`tests/kaponiera-clearance.test.cjs` (693), `tests/hetmanska-clearance.test.cjs`, `tests/park-paving.test.cjs`
(41 parków, plantery), `tests/park-road-clearance.test.cjs` (park 77/1104 — lepiej po nazwie),
`tests/partial-park-road-clearance.test.cjs`, `tests/partial-service-road-clearance.test.cjs`,
`tests/streetlight-curb-clearance.test.cjs`, `tests/tree-distribution.test.cjs`,
`tests/street-tree-colliders.test.cjs`, `tests/road-network.test.cjs`, `tests/rail-crossings.test.cjs`,
`tests/signal-audit.test.cjs`, `tests/signal-placement.test.cjs`, `tests/pedestrian-routes*.test.cjs`,
`tests/zebra-visibility.test.cjs` (raport P-22 w docs).

## Ryzyka i ograniczenia

- **Aerodrom w rastrze bloków to błąd, nie kompromis** — bez wyczyszczenia i warstwy `aeroway` nie wolno
  włączać B.
- **Pełny refresh OSM zmienia rdzeń** (40 kwartałów, liczniki, testy). Merge jest bezpieczniejszy, ale
  trzeba go commitować jako dane wejściowe i powtarzać przy każdym przyszłym rozszerzeniu, dopóki nie
  zdecydujemy się na świadomy re-baseline całego miasta.
- **King Cross i terminale mają zaniżoną wysokość** z `building:levels` (2 piętra). Bez korekty mall ma
  ~10 m zamiast 15 m, a terminal ~7–10 m. To korekta danych, nie generatora.
- **Business Garden bez programu 9** wyjdzie jako kamienice — to najbardziej widoczna wada wariantu A.
- **Pamięć builda**: 2,09 GB peak przy B jest bezpieczne w 8 GB heap, ale `js/geodata.js` + runtime +
  przeglądarka na jednej maszynie wymagają sprawdzenia w przeglądarce; w headless nie ma tekstur ani GPU.
- **Czas startu**: raster lądu rośnie o 19 %/67 %, collidery o 19 %/55 %, trasy pieszych o kilkadziesiąt
  procent. To trzeba zmierzyć w przeglądarce (`markInit`), nie tylko w Node.
- **Determinizm**: merge musi być deterministyczny (sortowanie po `type/id`); inaczej `tests/geodata.test.mjs`
  nie odtworzy pliku bajtowo.

## Odtworzenie pomiarów

```bash
# katalogi dbwest/ i dbwest/data-merged/ to tymczasowe kopie z sesji pomiarowej (tools/ + pobrany wycinek)
# baseline (committed tools/data)
node --max-old-space-size=8192 tools/build-poznan.mjs /tmp/geodata-baseline.js

# wariant A (pełny nowy fetch, box -5250)
GEO_DATA=/path/to/dbwest/data node --max-old-space-size=8192 tools/build-poznan.mjs /tmp/geodata-westA.js

# wariant B (scalony snapshot + wyczyszczony aerodrom, box -9120)
GEO_DATA=/path/to/dbwest/data-merged node --max-old-space-size=8192 tools/build-poznan.mjs /tmp/geodata-westfull-airport.js

# collidery budynków (proxy runtime)
node --input-type=module -e "const {loadBuildingColliders}=await import('./tools/bench-world.mjs'); console.log(loadBuildingColliders().length)"

# testy
node --test tests/*.cjs
```

Pliki zmienione w prototypie (poza tym dokumentem): brak w drzewie roboczym — pomiary wykonano w kopiach
`tools/` i `tools/data/` pod `/private/var/folders/.../opencode/dbwest*`. `js/geodata.js` w repo pozostaje
nietknięty.
