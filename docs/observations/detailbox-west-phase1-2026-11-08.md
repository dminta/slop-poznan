# Etap 1 rozszerzenia detailBoxu na zachód — wdrożenie, 2026-11-08

Zakres: wdrożenie wariantu A z [studium wykonalności](detailbox-west-expansion-2026-11-08.md) — zachodnia krawędź
`GEO.frame.detailBox` z `x = −3 675,4` (`16.880 E`) do `x = −5 250` (`16.85686 E`). W boxie są King Cross Marcelin
(way 341510638), Business Garden (landuse way 1156185020) oraz kwartały zachodniego Marcelina i Łazarza/Grunwaldu.
Lotnisko Ławica i wariant B (`−9 120`) zostają na Etap 2.

## Co weszło

| element | przed | po |
|---|---:|---:|
| `DETAIL_LL.w` (`tools/poz-base.mjs`) | 16.880 | **16.85686** |
| `detailBox` `x` | −3 675,4 … 4 490,7 | **−5 250,1 … 4 490,7** |
| szerokość / pole | 8,2 × 5,7 km / 46,3 km² | **9,7 × 5,7 km / 55,3 km²** |
| kwartały (`GEO.blocks`) | 1 418 | **1 647** |
| linki grafu | 7 121 | **8 342** |
| drogi w grafie | 452,6 km | **547,2 km** |
| raster bloków 1 m | 8 168 × 5 677 | **9 743 × 5 677** |
| collidery budynków (headless) | 33 251 | **39 711** |
| `js/geodata.js` | 2 647 113 B | **3 071 585 B** |
| peak RSS builda | 1,36 GB | **1,43 GB** |
| build (ta maszyna) | 49,2 s | **35,9–41,7 s** |

## Dane: merge zamiast pełnego refreshu

Nie pobierano całego miasta ponownie. Zachodni wycinek (OSM base 2026-11-08T17:54Z, padded `16.852–17.005 E`) został
scalony ze starymi snapshotami przez nowy `tools/merge-extent.mjs`: każdy element ze starego pliku zostaje, a z nowego
dochodzą tylko te, których `type/id` nie ma w starym, `max lon ≤ 16.883` i które sięgają nowego padded boxu
(`max lon ≥ 16.852`). Rdzeń jest więc zamrożony semantycznie; pliki są compact `JSON.stringify`, więc są mniejsze niż
surowy Overpass.

| plik | elementy po merge | dodane |
|---|---:|---:|
| `poz_buildings.json` | 30 316 | 5 747 |
| `poz_roads.json` | 10 988 | 1 271 |
| `poz_signals.json` | 7 165 | 990 |
| `poz_parks.json` | 7 954 | 727 |
| `poz_rail.json` | 1 591 | 40 |
| `poz_industry.json` | 440 | 39 |
| `poz_tram_routes.json` | 46 | 0 |

Zapytania `q_poz_*.overpassql` mają nowy padded box `52.380,16.852,52.437,17.005`; `q_poz_landmarks` ma D3
`52.383,16.857,52.434,17.000`. `q_poz_water.json` i `q_poz_admin.json` zostały miejskie i bez zmian.

## Id kwartałów i profile

`tools/poz-blocks.mjs` sortuje komponenty po pierwszej komórce na wschód od starej krawędzi, a kwartały całkowicie
zachodnie dopisuje na końcu. W praktyce większość starych id spadła o **2**, część o 3; `21` i `266` zostały bez zmian.
Nowe kwartały przy krawędzi to m.in. `0`, `291` i `393`, a stare testy dostały nowe stałe (np. Posnania 955 → 953,
ZNTK 848 → 846, Hala Arena 927 → 925, Termy 613 → 611, Kaponiera 693 → 691).

- **King Cross Marcelin**: kwartał **1475**, `blockStats = [0.44, 4, 2, 3]`, anchor
  `[-5099, -4758, -324, -145, 46 748, 1, 4]`. Wpis z `js/satellite-sites.js` usunięty; mall buduje `fillAnchor`.
  `tools/poz-buildings.mjs` ma tabelę `LEVEL_CORRECTIONS` (`way 341510638 → 4 piętra`), bo OSM ma 2 poziomy.
- **Business Garden**: kwartał **1492**, `blockStats = [0.27, 6, 17, 9]`; `building=office` daje teraz program **9**.
  `js/buildings.js` ma `OFFICE_CAMPUS` (6-piętrowe pawilony wokół dziedzińców, bez wież Ronda Kaponiera) i `case 9`.
  Program 9 dostały też istniejące kwartały biurowe 877 i 1153.
- Kampusy 1/2, retail 3, industrial 4, depot 5, sport 6, utility 7 i leisure 8 działają bez zmian. `blockAnchors`:
  75 wpisów w 43 kwartałach (było 61 w 35).

## Runtime i outskirts

- `js/outskirts.js`: pas suburbii zaczyna się teraz na `−5 250` (`luRect(-30000, -30000, -5250, 30000, SUBURB, 150)`),
  żeby pas `−5 600…−5 250` nie został bez flagi. Malowany aerodrom Ławicy zostaje (jest cały na zachód od `−5 250`).
- `js/satellite-sites.js`: usunięty `king-cross`; pozostałe satelity bez zmian. Test satelitów sprawdza teraz brak wpisu.
- `js/city-config.js` nie wymagał ręcznej zmiany: `CITY_BOUNDS`, `inDetailBox` i raster lądu liczą się z
  `GEO.frame.detailBox`. Etykiety King Cross i Business Garden nie były dodawane do mapy — to opcjonalny follow-up.

## Testy i weryfikacja

- `node --test tests/` → **470/470 pass** (2026-11-08).
- Nowe liczniki miejskie po rozszerzeniu: 4 115 zebr (było 3 310), 22 002 lampy (18 613), 22 044 drzewa uliczne
  (18 093), 190 wierszy audytu sygnałów (167), 306 odtworzonych słupów sygnalizacyjnych (276).
- `node tools/audit-tram-opposing-lanes.mjs`: 43 biegi / 41 pasów / 397 m (było 42/40/385); `--all` 57/53/597.
- Regression traffic flow na seedzie 4242: 11 kontaktów samochód–tramwaj w Jeżycach (było 9); to przesunięcie kolejności
  losowania/spawnu po dodaniu zachodniego grafu, nie nowa kolizja w rdzeniu.
- Determinizm: drugi build z committed `tools/data` jest bajtowo identyczny z `js/geodata.js` (`cmp`, 35,9 s).
- Najbliższa para drzew ulicznych spadła z 0,37 do **0,331 m** na ciasnym narożniku nowej ulicy; audyt nie zgłasza
  naruszeń landing/zebra/lane/island.

## Co zostaje na Etap 2

- Lotnisko Ławica: `x_min = −9 120`, nowy snapshot `aeroway`, wyczyszczenie aerodromu z rastra bloków i `js/airport.js`.
  Bez tego wariant B zamienia płytę lotniska w jeden 7,95 km² kwartał.
- Ewentualne etykiety `King Cross` i `Business Garden` w `city-map.js` / `LANDMARK_SITES`.
- Świadomy re-baseline całego miasta (pełny refresh OSM) dopiero, gdy będzie akceptacja migracji setek id kwartałów.
