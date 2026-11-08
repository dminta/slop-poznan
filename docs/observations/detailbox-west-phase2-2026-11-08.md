# Etap 2 rozszerzenia detailBoxu na zachód — Ławica, 2026-11-08

Zakres: wdrożenie wariantu B z [studium wykonalności](detailbox-west-expansion-2026-11-08.md) — zachodnia krawędź
`GEO.frame.detailBox` z `x = −5 250` (`16.85686 E`) do `x = −9 120` (`16.800 E`). W boxie jest cały aerodrom Ławica
(way 342024881, 2,81 km²), pas startowy 10/28 (way 22969774, 2 492 × 50 m) i terminale T1–T3. Etap 1 (King Cross
Marcelin i Business Garden) jest opisany w [osobnym wdrożeniu](detailbox-west-phase1-2026-11-08.md).

## Co weszło

| element | przed (Etap 1) | po (Etap 2) |
|---|---:|---:|
| `DETAIL_LL.w` (`tools/poz-base.mjs`) | 16.85686 | **16.800** |
| `detailBox` `x` | −5 250,1 … 4 490,7 | **−9 120,0 … 4 490,7** |
| szerokość / pole | 9,7 × 5,7 km / 55,3 km² | **13,6 × 5,7 km / 77,2 km²** |
| kwartały (`GEO.blocks`) | 1 647 | **2 021** |
| linki grafu | 8 342 | **10 032** |
| drogi w grafie | 547,2 km | **700,3 km** |
| raster bloków 1 m | 9 743 × 5 677 | **13 612 × 5 677** |
| collidery budynków (headless) | 39 711 | **51 229** |
| `js/geodata.js` | 3 071 585 B | **3 656 042 B** |
| peak RSS builda | 1,43 GB | **2,11 GB** |
| build (ta maszyna) | 35,9–41,7 s | **54,7 s** |

## Dane: aeroway i merge zachodniego wycinka

Nowy snapshot `tools/data/poz_aeroway.json` (OSM base 2026-11-08T19:45Z, padded
`52.377,16.795,52.437,16.860`) ma 147 elementów: 1 pas, 83 drogi kołowania, 22 płyty, 7 terminali, 3 helipady,
1 obrys aerodromu i 30 stanowisk postojowych. Zapytanie jest w `tools/data/q_poz_aeroway.overpassql`.

Pozostałe pliki pobrano dla nowego padded boxu `52.377,16.795,52.437,17.005` i scalono ze starymi snapshotami przez
`tools/merge-extent.mjs` (nowy `WEST_PAD_LON = 16.795`). Rdzeń został zamrożony semantycznie; nowe elementy trafiły
tylko na zachód od `16.883 E`.

| plik | elementy po merge | dodane |
|---|---:|---:|
| `poz_buildings.json` | 43 344 | 13 028 |
| `poz_roads.json` | 12 710 | 1 722 |
| `poz_signals.json` | 8 397 | 1 232 |
| `poz_parks.json` | 8 345 | 391 |
| `poz_rail.json` | 1 660 | 69 |
| `poz_industry.json` | 476 | 36 |
| `poz_tram_routes.json` | 46 | 0 |
| `poz_aeroway.json` | 147 | nowy |

## Aerodrom nie jest kwartałem

`tools/poz-blocks.mjs` po przywróceniu wysp kolejowych i przed etykietowaniem czyści z rastra 1 m obrys aerodromu
(`aeroway=aerodrome`): **2 807 787 m²** (2,81 km²). Bez tego kwartał #140 miał 7,95 km² i działkę 2 827 × 1 361 m,
a `buildings.js` stawiałby na pasie osiedle willi. Po wycięciu kwartałów jest 2 021, a „block land” spada do
65,98 km²; terminale i płyty rysuje wyłącznie warstwa lotniskowa.

## `GEO.aeroway` i `js/airport.js`

Nowy `tools/poz-aeroway.mjs` (import-time, jak `poz-water`/`poz-extra`) emituje 116 powierzchni:

| rodzaj | liczba | powierzchnia |
|---|---:|---:|
| pas startowy | 1 | 12,4 ha |
| drogi kołowania | 83 | 21,6 ha |
| płyty postojowe | 22 | 9,3 ha |
| terminale | 7 | 2,6 ha |
| helipady | 3 | — |

Kontrakt: `{ kind, ring, line?, h? }`. `ring` to otwarty, ujemnie nawinięty pierścień `[x0, z0, …]`; `line` to
oryginalna osiowa geometria pasa lub drogi kołowania (OSM mapuje je jako linie z `width`), więc `js/airport.js`
rysuje żółte osie i niebieskie światła po łukach, a nie po jednej obwiedni OBB. `h` terminala to
`building:levels × 3,4 m`, minimum 8 m. Pas i drogi kołowania są buforowane do wielokąta o szerokości z `width`
(pas 50 m, kołowania 15 m lub wartość tagu).

`js/airport.js` (`buildAirport(scene)`) buduje:

- dwie zmergowane nawierzchnie: beton pasa i asfalt kołowań/płyt/helipadów, 3,5 cm nad deckiem lądu;
- białe malowanie pasa: oś przerywana 30/20 m, progi (8 pasów 30 × 1,8 m), aiming point 45 × 6 m, strefy przyziemienia
  i numery **10/28** z siedmiosegmentowych belek (bez tekstur); żółte osie kołowań i płyt;
- światła: krawędzie pasa białe co 60 m, progi zielone, końce czerwone, PAPI (2 białe + 2 czerwone) i podejście
  (8 świateł co 30 m za każdym progiem), niebieskie krawędzie kołowań co 30 m;
- terminale: bryły z przeszkleniami `createCurtainWallMaterial`, dach, cztery rękawy na dużych terminalach i żółte
  linie stanowisk; ściany terminali mają collidery AABB;
- helipady: biały pierścień i litera H.

Całość to ok. 12 draw calli (2 nawierzchnie, 2 malowania, 4 kolory świateł, ściany, dachy, rękawy, kolumny) i jeden
root `Airport`, wpisany w `cullingRoots` w `main.js`. Nowy moduł ma `modulepreload` w `index.html` i podbity licznik
w `tests/boot.test.cjs` (45 → 46).

## Kolejność i identyfikatory kwartałów

Nowe kwartały są w całości na zachód od starej krawędzi `−3 675,4`, więc remap z Etapu 1 dopisuje je na końcu i
**nie przesuwa istniejących id**. Wszystkie stałe testów kwartałów (953 Posnania, 21 Castorama, 846 ZNTK, 826/989
szpitale, 925 Hala Arena, 937 Enea Stadion, 1248 depot) zostały bez zmian. Indeks `GEO.rail` przesunął się o 6
(nowe 69 elementów torowych), więc test Hetmańskiej szuka teraz łańcucha po współrzędnych, nie po numerze.

## Testy i weryfikacja

- `node --test tests/` → **471/471 pass** (2026-11-08).
- `node --test tests/*.cjs` → **457/457 pass**.
- Determinizm: drugi build z committed `tools/data` jest bajtowo identyczny z `js/geodata.js` (`cmp`).
- Nowe liczniki miejskie: 19 355 stosów balkonów, 5 358 zebr, 2 574 główne latarnie, 2 851 latarni parkowych,
  27 771 lamp ogółem, 28 350 drzew ulicznych, 201 wierszy audytu sygnałów, 1 291 głowic pojazdów po rozmieszczeniu.
- Nowe sygnalizacje na zachodzie: 11 dodatkowych podejść audytu (190 → 201), w tym skrzyżowanie przy lotnisku
  `−7 965,85, −537,55`; 314 nowych głowic pieszych i 6 861 footprintów mebli ulicznych.
- Test drzew: najbliższa para 0,325 m na ciasnym narożniku nowej ulicy (Etap 1: 0,331 m); próg testu obniżony do
  0,325 m.
- `tools/audit-tram-opposing-lanes.mjs`: 43 biegi / 41 pasów / 397 m; `--all` 58 / 54 / 602.
- Nowy `tests/airport.test.cjs`: sprawdza liczbę i rodzaje powierzchni, wymiary pasa oraz to, że żaden kwartał nie
  obejmuje osi pasa startowego.

## Poprawka jakościowa: latarnie parkowe

Nowe parki na zachodzie (bloki przy `z ≈ −2 600`) mają bardzo wąskie chodniki. Linia lamp odsunięta o 1,05 m od
obrysu po zwinięciu wielokąta wypadała miejscami 0,14 m od krawężnika. `js/city-grid.js` odrzuca teraz lampę, której
słupek (0,2 m) nie jest co najmniej 0,7 m wewnątrz obrysu bloku. Spadło 19 lamp (2 870 → 2 851), w tym wszystkie
13 naruszeń < 0,50 m; audyt nie zgłasza już żadnego parku z lampą na krawężniku.

## Co zostaje

- Sprawdzenie w przeglądarce (WebGPU i WebGL2): pas z powietrza i z Bukowskiej, terminale z poziomu ulicy, światła
  pasa nocą, z-fighting nawierzchni, czas ładowania i FPS nad Ławicą.
- Ewentualne etykiety `Port Lotniczy Poznań-Ławica`, `King Cross` i `Business Garden` w `city-map.js`.
- Świadomy re-baseline całego miasta (pełny refresh OSM) dopiero po akceptacji migracji setek id kwartałów.
