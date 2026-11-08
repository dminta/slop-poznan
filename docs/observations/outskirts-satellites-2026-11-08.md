# Sylwety wielkich obiektów na obrzeżach — 2026-11-08

Zakres: 14 zgrupowań wielkopowierzchniowych i przemysłowych tuż za detail boxem (52.383–52.434 N,
16.880–17.000 E), dla których [audyt niemieszkalny](non-residential-audit-2026-11-08.md) wykazał 34 obiekty
(29,8 ha obrysu) poza rastrem geodaty. Celem było dodanie lekkich, instancjonowanych sylwetek o rzeczywistych
wymiarach i pozycjach z OSM, widocznych z drona, helikoptera i wysokich punktów widokowych, bez powiększania
rastra geodaty o 45 % (szacunkowo +0,6 GB pamięci i +16 s builda).

## Rozwiązanie

- **`js/satellite-sites.js`** — dane `SATELLITE_SITES`: 14 stanowisk, 27 prostokątnych części (obrysy z OSM,
  duże rzuty podzielone na 2–6 części), 2 chłodnie kominowe i komin 204 m. Współrzędne w metrach świata
  (`x` wschód, `z` południe, origin Ratusz); `angle` to długi bok obrysu w stopniach od wschodu ku południu
  (czyli `atan2(dz, dx)`), zgodnie z konwencją kątów stref w `outskirts.js`.
- **`js/outskirts.js`** — `buildSatelliteSiteBuildings()` dokłada 27 brył + 52 małe bryły HVAC na dachach do
  wspólnej listy budynków outskirts. Wszystkie idą przez istniejący `BOX_GEO`, `buildBuildingChunks` i
  `createBoroughBuildingMaterial` (style 4 — panele handlowe, 2 — blacha, 1 — szkło), więc nie dochodzi nowy
  pipeline elewacji. `satelliteClearance()` blokuje generyczne szopy wchodzące w obrys stanowiska.
- **`buildSatelliteStructures()`** — jedna instancja `LatheGeometry` na 2 chłodnie (65 i 75 m) i jedna
  instancja `CylinderGeometry` na komin 204 m (pasy czerwono-białe w `colorNode`). Dwa meshe, dwa materiały,
  dwa draw calle; oba poza cieniami, jak reszta outskirts.
- **`js/main.js`** — bez zmian; grupa `Outskirts` nadal jest jednym korzeniem cullingu.

## Stanowiska

Pola to suma prostokątów części, nie obrys OSM; dla obiektów o skomplikowanym rzucie są one celowo nieco
większe (M1 +0 %, King Cross +0,2 %, Pestka +25 %, VW +29 %), żeby sylwetka czytała się z lotu ptaka.

| Stanowisko | OSM | Części | Pole brył | h | Materiał |
|---|---|---:|---:|---:|---|
| Galeria Pestka | 121267696 | 2 | 32 760 m² | 15 m | panele |
| Makro | 46994640 | 1 | 18 582 m² | 11 m | blacha |
| Poznań Plaza | way 24440480 | 1 | 21 630 m² | 18 m | panele |
| King Cross Marcelin | way 341510638 | 3 | 46 860 m² | 15 m | panele |
| M1 Poznań | 31567787 | 2 | 51 400 m² | 15 m | panele + szkło |
| IKEA Franowo | 31767317 | 1 | 21 392 m² | 15 m | panele (niebieski tint) |
| Selgros | 176242403 | 1 | 18 150 m² | 10 m | blacha |
| Homepark Franowo | 229139205 | 2 | 17 100 m² | 10 m | blacha |
| OBI Franowo | 161412082 | 1 | 10 689 m² | 9 m | blacha |
| Centrum Franowo | 14194965 | 1 | 10 556 m² | 12 m | panele |
| Decathlon Franowo | 119909655 | 1 | 4 914 m² | 9 m | blacha |
| Hala M Franowo | 40701475 | 1 | 4 454 m² | 9 m | blacha |
| VW Antoninek | 6 hal | 6 | 200 306 m² | 15–22 m | blacha |
| Karolin EC-II | 300835893 i sąsiednie | 4 | 20 081 m² | 18–32 m | blacha |
| **Razem** | | **27** | **478 874 m²** | | |

Karolin dostaje dodatkowo dwie chłodnie (r = 16 i 22 m, h = 65 i 75 m) oraz komin 204 m — jedyne bryły
nieprostokątne. Komin i chłodnie stoją w rzeczywistych centroidach OSM (16.9868 E, 52.4363 N).

## Weryfikacja

- `node --test tests/outskirts-satellites.test.cjs` — 4 testy: lista stanowisk, wymiary i centra poza detail
  boxem, chłodnie i komin Karolina, `satelliteClearance`.
- `node --test tests/` — **447/447 pass** (271,5 s). `tests/boot.test.cjs` pilnuje nowego preloadu
  `js/satellite-sites.js` (44 moduły).
- WebGPU (Chrome headless, Apple M5 Pro, `metal-3`): scena wstała bez błędów konsoli; log
  `[outskirts] 47296 buildings (1341 panel blocks, 79 satellite boxes)`. Sprawdzone z lotu ptaka nad M1,
  Franowem, Pestką, Makro, Plazą, King Crossem, VW i Karolinem: bryły stoją na ziemi, dachy mają HVAC, komin
  i chłodnie są widoczne z 250–300 m. Dron nad centrum: 34–40 fps.
- WebGL2 (Chrome headless z `--disable-features=WebGPU`): ten sam log `79 satellite boxes`, brak błędów
  shaderów i konsoli.

## Koszt

- 79 dodatkowych instancji w istniejących chunkach `OutskirtsBuildings` (11 kluczy chunków 1,2 km; w większości
  te same komórki, w których generyczne outskirts już budowały), czyli co najwyżej 11 dodatkowych draw calli.
- 2 nowe meshe struktur = dokładnie 2 draw calle i 2 pipeline'y (beton chłodni, komin w pasy).
- Brak zmian w `GEO`, rastrach, `BLOCKS`, colliderach i ruchu; gracz nigdy nie opuszcza detail boxu na ziemi.
- Determinizm: jeden `mulberry32(20261108)` na HVAC; bez `Math.random`.

## Ograniczenia

- To sylwety, nie modele: brak parkingów, doków, ramp, instalacji i detali dachowych poza HVAC. Zbliżenie
  na poziomie ulicy nie jest celem — obiekty są 200–2100 m za detail boxem.
- M1, IKEA i Selgros zachodzą kilkadziesiąt–kilkaset metrów w detail box; generyczne budynki w tym pasie
  pozostają i są zasłonięte przez wyższą bryłę satelitarną. Nie zmieniano generatora `buildings.js`.
- Prostokąty są dopasowane do głównych skrzydeł, nie do każdego załamania obrysu; przy 300+ m różnica jest
  mniejsza niż piksel elewacji.
