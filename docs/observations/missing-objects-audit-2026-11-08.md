# Audyt brakujących obiektów i budynków — 2026-11-08

Pytanie wyjściowe: **czego nadal brakuje w grze względem OSM / BDOT10k**, bez odchudzania gęstości nadbudowy.
Poprzednie raporty patrzyły na bilans powierzchni kwartałów
([building-density-investigation](building-density-investigation-2026-11-08.md)) i na duże obiekty niemieszkalne
([non-residential-audit](non-residential-audit-2026-11-08.md)). Ten audyt schodzi o poziom niżej: bierze **każdy
obrys `building=*`** ze snapshotu, sprawdza, czy w ogóle trafił do kwartału i czy wygenerowane miasto go pokrywa,
a następnie grupuje braki po typie obiektu, przyczynie i lokalizacji.

Wniosek w jednym zdaniu: **gra nie tyle „nie dobudowuje”, ile „buduje masę zamiast konkretnych obiektów”.**
Generated city ma już więcej powierzchni zabudowy niż OSM (20,4 % vs 18,1 % wysp po zmianach 2026-11-08), ale tylko
**40,6 % komórek realnych obrysów** leży pod wygenerowanym budynkiem, a **7 415 obrysów (107,4 ha) nie ma żadnego
pokrycia**. Brakuje więc szkół, kościołów, szpitali, hal targowych, pawilonów MTP, magazynów i małej infrastruktury —
nie brakuje metrów kwadratowych jako takich.

## Metoda i definicje

Narzędzie: `tools/audit-missing-objects.mjs` (`node --max-old-space-size=8192 tools/audit-missing-objects.mjs out.json`).
Importuje dokładnie ten sam potok co build:

- `tools/poz-blocks.mjs` — 1 418 wysp krawężnikowych, `rects` i `frames`,
- `tools/poz-buildings.mjs` — przypisanie obrysu do kwartału i `GEO.blockStats`,
- `js/buildings.js` — `buildCityBlocks()` w harnessie `tests/helpers/module.cjs` z inertnym three.js/TSL.

Obrys jest **obecny**, gdy spełnia jeden z warunków:

- **landmark** — centroid leży w pierścieniu jednego z 36 modeli `GEO.landmarks` (lub nazwa wskazuje ten model),
- **anchor** — centroid leży w jednym z 104 `GEO.blockAnchors` (dedykowana bryła na obrysie OSM),
- **satellite** — obrys poza detail boxem leży w jednym z 14 stanowisk `SATELLITE_SITES` (15 dopasowanych obrysów),
- **generated** — co najmniej 50 % komórek obrysu na rastrze 2 m leży pod jakimkolwiek wygenerowanym budynkiem.

Reszta jest **pominięta**. Przyczyna jest przypisywana do etapu, który obrys zgubił:

| przyczyna | znaczenie |
|---|---|
| `in lots, unbuilt` | obrys ma działkę, ale profil dzielnicy/obiektu nie postawił na niej budynku (skipP, forecourt, brak profilu, inna morfologia) |
| `property-line gap (maskRects/frames)` | obrys nie leży w żadnym surowym prostokącie działki — `maskRects`/`fitRects` nie pokryły tej części property line |
| `splitDeep/minLot gap` | obrys jest w surowym prostokącie, ale wypadł przez `splitDeep` (pas 9 m) lub `minLot` (12/15 m) |
| `park carve` | `parkFreeCells` usunął komórki parku, a `blockFootprints`/`blockParkBuildings` nie oddały tego obrysu |
| `landmark reserve` | obrys leży w rezerwie landmarku (AABB pierścienia + 3 m), ale nie jest modelowanym landmarkiem |
| `no block (road/rail/water edge)` | w detail boxie, ale raster kwartałów nie ma etykiety (jezdnia, tor, woda, skraj placu) |
| `block without lots (maskRects)` | kwartał nie ma żadnego surowego prostokąta ≥ 8 m |
| `block lots lost (minLot)` | kwartał ma surowe prostokąty, ale wszystkie kawałki są < 12/15 m |
| `outside detail box (outskirts)` | centroid poza 52.383–52.434 N / 16.880–17.000 E; snapshot jest pobrany szerzej, do 52.380–52.437 N |

Pokrycie jest proxy tożsamości obiektu, nie pomiarem wizualnym: 50 % komórek pod generykiem nie znaczy „dobrze”,
a 49 % nie znaczy „źle”. Dlatego osobno podaję obrysy z **zerowym** pokryciem (7 415) i osobno przyczyny działkowe.

## Snapshot i lejek potoku

| etap | liczba | powierzchnia |
|---|---:|---:|
| elementy `building=*` w `poz_buildings.json` | 24 569 | — |
| w tym `building=roof` | 1 038 | — |
| w tym `building=no` | 0 | — |
| dodatkowe obrysy z `poz_industry.json` (chłodnie, kominy, silosy, zbiorniki) | 52 | — |
| obrysy liczone przez `poz-buildings.mjs` | 23 579 | — |
| centroid w detail box | **20 357** | **662,8 ha** |
| centroid poza detail box (padded snapshot) | 3 222 | — |
| dachy `building=roof` w detail box | 852 | 7,6 ha |
| przypisane do kwartału | 20 051 | — |
| bez kwartału | 259 | 3,1 ha |
| niemierzalne resztki (zdegenerowane pierścienie) | 47 | — |

Status obecności (23 579 obrysów):

| status | obrysy | uwaga |
|---|---:|---|
| landmark | 37 | 36 modeli + powtórzenia relacji |
| anchor | 104 | 104 kotwice w 36 kwartałach |
| generated ≥ 50 % | 7 365 | 36,3 % obrysów w boxie |
| satellite | 15 | obiekty poza boxem |
| **pominięte** | **16 058** | **502,4 ha** |

Pominięte dzielą się na trzy warstwy:

| warstwa | obrysy | powierzchnia | co to znaczy |
|---|---:|---:|---|
| strukturalna (`in box`, nie `in lots`) | 4 023 | 76,1 ha | obiekt nie ma działki albo nie ma kwartału |
| profilowa (`in lots, unbuilt`) | 8 835 | 307,4 ha | działka jest, ale generator postawił coś innego |
| poza detail boxem | 3 200 | 118,9 ha | renderuje to generyczne outskirts, nie konkretny obiekt |

Kontrola jakości: 2 159 obrysów w boxie **nie ma żadnej działki** (21,1 ha), a 7 415 obrysów ma **zerowe pokrycie**
(107,4 ha). To najlepsze miary „twardych” braków, niezależne od 50-procentowego progu.

## Kwartały i działki

| miara | wartość |
|---|---:|
| kwartały `BLOCKS` | 1 418 |
| kwartały z efektywnymi działkami (`blockLots`) | 754 |
| kwartały bez efektywnych działek | 664 |
| w tym bez surowych `rects` | 567 |
| w tym mediany tramwajowe (< 9 m) | 65 |
| mediany z jakimkolwiek budynkiem OSM | **0** |
| działki (`blockLots`) | 12 765 |
| powierzchnia działek | 2 073 ha (52,0 % z 3 989 ha) |
| powierzchnia surowych `rects`/`frames` | 2 843 ha (71,3 %) |
| komórki obrysów OSM w działkach | 78,0 % |
| komórki obrysów OSM w parku | 1,8 % |

Czyli **surowa siatka pokrywa 71,3 % ziemi kwartałów, ale skuteczne działki tylko 52,0 %**, a 22 % komórek realnych
obrysów leży poza skutecznymi działkami. To nie jest już głównie park (1,8 %) ani rezerwa landmarku; to
`maskRects`/`frames` oraz `splitDeep`/`minLot`.

## Pominięte obiekty po kategorii

Kolumna „in-box ha” to pominięta powierzchnia obrysów z centroidem w detail boxie; „omitted ha” zawiera też obrysy
poza boxem. Kategorie są heurystyczne, po tagach `building`, `amenity`, `shop`, `leisure`, `historic` i nazwie.

| kategoria | obrysy | pominięte | % | in-box ha | strukturalne ha | profilowe ha |
|---|---:|---:|---:|---:|---:|---:|
| residential | 19 368 | 12 872 | 66,5 % | 265,5 | 59,4 | 206,0 |
| education | 292 | 222 | 76,0 % | 31,7 | 1,7 | 30,0 |
| industrial | 679 | 547 | 80,6 % | 10,7 | 1,5 | 9,1 |
| retail | 679 | 479 | 70,5 % | 18,5 | 2,8 | 15,7 |
| health | 96 | 74 | 77,1 % | 10,3 | 0,1 | 10,2 |
| office | 224 | 153 | 68,3 % | 9,3 | 0,8 | 8,4 |
| military | 64 | 59 | 92,2 % | 4,7 | 2,8 | 1,9 |
| garage | 1 071 | 832 | 77,7 % | 6,4 | 1,7 | 4,7 |
| civic | 118 | 64 | 54,2 % | 6,3 | 1,2 | 5,2 |
| construction | 69 | 45 | 65,2 % | 5,1 | 0,7 | 4,4 |
| sacral | 138 | 92 | 66,7 % | 4,6 | 0,8 | 3,8 |
| leisure | 43 | 31 | 72,1 % | 3,5 | 0,4 | 3,1 |
| ruins | 53 | 35 | 66,0 % | 3,4 | 0,7 | 2,7 |
| outbuilding | 596 | 492 | 82,6 % | 2,4 | 0,6 | 1,8 |
| rail | 28 | 19 | 67,9 % | 0,7 | 0,6 | 0,1 |
| other | 61 | 42 | 68,9 % | 0,5 | 0,1 | 0,3 |

Największe „systemowe” klasy to **education (31,7 ha w boxie)**, **retail (18,5 ha)**, **industrial (10,7 ha)**,
**health (10,3 ha)**, **office (9,3 ha)**, **garage (6,4 ha)**, **civic (6,3 ha)** i **sacral (4,6 ha)**. Residential
ma najwięcej obrysów, ale to głównie tło (generyk stoi gdzie indziej); nie jest to osobna klasa do modelowania.

## Przyczyny pominięć

| przyczyna | obrysy | ha | kategorie (liczba obrysów) |
|---|---:|---:|---|
| `in lots, unbuilt` | 8 835 | 307,4 | residential:7 029, garage:522, outbuilding:276, industrial:238, retail:206, education:190, office:97, health:61, sacral:59, civic:46 |
| `outside detail box (outskirts)` | 3 200 | 118,9 | residential:2 620, outbuilding:139, industrial:124, retail:100, garage:99 |
| `property-line gap (maskRects/frames)` | 2 829 | 53,9 | residential:2 257, garage:167, retail:134, industrial:123, outbuilding:60 |
| `splitDeep/minLot gap` | 585 | 9,8 | residential:493, garage:38, industrial:22, outbuilding:11, retail:9 |
| `park carve` | 219 | 4,5 | residential:146, industrial:29, military:14, ruins:7 |
| `landmark reserve` | 59 | 4,2 | residential:44, civic:6, sacral:4 |
| `no block (road/rail/water edge)` | 255 | 3,1 | residential:216, retail:25, industrial:10 |
| `block without lots (maskRects)` | 65 | 0,5 | residential:58, rail:3 |
| `block lots lost (minLot)` | 11 | 0,1 | residential:9, industrial:1 |

## Które klasy są systematycznie filtrowane

| klasa / tag | wszystkie | pominięte | % | ha pominięte | gdzie ginie |
|---|---:|---:|---:|---:|---|
| `building=yes` | 15 020 | 10 218 | 68,0 % | 240,2 | głównie profil dzielnicy; część to szkoły/kościoły bez tagu |
| `building=apartments` | 2 038 | 1 044 | 51,2 % | 69,2 | generyk kamienic/osiedli |
| `building=residential` | 875 | 556 | 63,5 % | 32,1 | generyk |
| `building=industrial` | 187 | 134 | 71,7 % | 25,7 | hale → LOWRISE/kamienice, skipP |
| `building=retail` | 385 | 264 | 68,6 % | 18,0 | MALL/RETAIL_PARK tylko w 18 kwartałach |
| `building=school` | 113 | 92 | **81,4 %** | 15,1 | brak profilu szkoły; `building=school` nie jest civic w `anchorUse` |
| `building=university` | 88 | 64 | 72,7 % | 12,6 | campus tylko ≥ 5 ha i ≤ 40 % built; pojedyncze wydziały → generyk |
| `building=house` | 1 486 | 1 122 | 75,5 % | 12,3 | generyk willi |
| `building=hospital` | 79 | 61 | 77,2 % | 11,0 | HOSPITAL tylko 11 kwartałów; skrzydła szpitali → generyk |
| `building=commercial` | 116 | 74 | 63,8 % | 9,2 | często galerie/pawilony bez profilu |
| `building=office` | 212 | 144 | 67,9 % | 9,1 | OFFICES tylko w promieniu 240 m od 5 wież |
| `building=construction` | 71 | 47 | 66,2 % | 5,5 | plac budowy traktowany jak zwykła działka |
| `building=garages` | 283 | 223 | 78,8 % | 5,0 | brak profilu garaży; tylko tło |
| `building=ruins` | 54 | 36 | 66,7 % | 3,5 | forty/bunkry → park lub generyk |
| `building=warehouse` | 30 | 28 | 93,3 % | 3,1 | hale magazynowe → generyk |
| `building=outbuilding` | 506 | 429 | 84,8 % | 3,1 | brak profilu; często < 60 m² |
| `building=bunker` | 55 | 51 | 92,7 % | 3,0 | park carve / brak profilu militarnego |
| `building=garage` | 785 | 608 | 77,5 % | 2,7 | brak profilu |
| `building=church` | 52 | 31 | 59,6 % | 2,6 | tylko 5 kościołów ma model landmarku |
| `building=dormitory` | 33 | 19 | 57,6 % | 2,5 | akademiki → generyk |
| `building=public` | 40 | 25 | 62,5 % | 2,4 | urzędy → generyk |
| `building=kindergarten` | 43 | 36 | **83,7 %** | 1,8 | brak profilu przedszkola |

Dodatkowo:

- **`building=roof`** — 1 038 elementów, 852 w boxie (7,6 ha). Nie wchodzi do masy zabudowy (brak ścian) i jest
  poprawnie kierowany do `GEO.canopies`. Ale tylko 157 dachów ma canopy (5,5 ha); 12 dużych dachów ≥ 60 m²
  (0,63 ha) i 683 małe (1,95 ha) nie mają odpowiednika. To wiaty, zadaszenia peronów, stacji paliw i targowisk.
- **`building=no`** — 0 w snapshocie.
- **`building=construction`** — jest liczone jako masa (celowo), ale nie dostaje profilu placu budowy; 47/71
  pominiętych, 5,5 ha.
- **`man_made=*` / `power=*`** — 401 elementów w `poz_industry.json`, 52 obrysy wchodzą do masy; resztę widzi tylko
  runtime jako kominy/chłodnie. To nie „brakujące budynki”, ale brakuje im often pełnego kontekstu (kotłownie,
  komory fermentacyjne, stacje 110 kV).

## Co już działa (nie otwierać ponownie)

| obiekt | status | pokrycie |
|---|---|---:|
| CH Posnania | anchor | 93,9 % |
| CH Avenida | landmark | model |
| Stary Browar | landmark | model |
| Kupiec Poznański | generated | 57,1 % |
| IKEA Franowo | anchor | 77,2 % |
| Selgros | satellite | 16,3 % (poza boxem) |
| Castorama | anchor | 83,9 % |
| Enea Stadion | generated | 71,8 % |
| Hala Arena | anchor | 96,7 % |
| Termy Maltańskie | anchor | 20,4 % (bryła kotwicy, nie cały obrys) |
| Zajezdnia Głogowska | anchor | 60,4 % |
| Poznań Główny | landmark | model |
| MTP Pawilon 5 / 6 / 8 / 12 | **brak** | 34 % / 48 % / 43 % / 41 % |
| Galeria MM | **brak** | 42,7 % |
| Szpital HCP / USK | **brak** | 22,2 % / 20,2 % |

To potwierdza, że kotwice i landmarki z 2026-11-08 zadziałały dla największych obiektów. Problemem są teraz
**obiekty średnie i liczne**, a nie topowe centra handlowe.

## Konkretne znane obiekty do sprawdzenia w grze

Pełna lista 515 nazwanych obrysów jest w JSON. Poniżej 30 największych pominiętych obiektów w detail boxie
(`x` wschód, `z` południe, origin Ratusz; `cov` = pokrycie generykiem):

| obiekt | kategoria | m² | kwartał | x / z | przyczyna | cov |
|---|---|---:|---:|---|---|---:|
| Fort IV | military | 20 110 | 95 | 3651,9 / −2344,3 | park carve | 14 % |
| Fort IIa | military | 16 456 | 1271 | 3378,7 / 2599,1 | in lots, unbuilt | 21 % |
| Pawilon 5 (MTP) | retail | 15 333 | 770 | −1786,1 / 384 | in lots, unbuilt | 34 % |
| Collegium Heliodori Święcicki | education | 10 838 | 770 | −1959,6 / 281,5 | in lots, unbuilt | 37 % |
| Szpital HCP | health | 9 085 | 1306 | −1503,3 / 2820,1 | in lots, unbuilt | 22 % |
| Poznań Congress Center | civic | 8 488 | 770 | −1950,8 / 776,8 | in lots, unbuilt | 37 % |
| Rogal | residential | 6 863 | 12 | −1684,2 / −2785,9 | in lots, unbuilt | 15 % |
| PREMA SA Oddział Poznań | retail | 6 306 | 328 | 3134,5 / −1155,8 | in lots, unbuilt | 15 % |
| Collegium Pharmaceuticum | education | 5 725 | 757 | −2861,2 / 256,5 | in lots, unbuilt | 23 % |
| Biblioteka Techniczna | education | 5 692 | 800 | 1029,5 / 560,6 | in lots, unbuilt | 24 % |
| Centrum Stomatologii UM | education | 5 413 | 622 | −2993,4 / −10,4 | in lots, unbuilt | 28 % |
| Maraton | retail | 5 248 | 939 | −184,3 / 1058 | in lots, unbuilt | 0 % |
| Collegium im. H. Cegielskiego | education | 5 066 | 1306 | −1505,5 / 2711,1 | in lots, unbuilt | 39 % |
| Collegium Da Vinci | education | 5 002 | 374 | −161,4 / −805,7 | in lots, unbuilt | 24 % |
| CITYZEN | leisure | 4 931 | 939 | −101,5 / 1492,5 | in lots, unbuilt | 0 % |
| Wydział Architektury PP | education | 4 909 | 565 | 1223,1 / 252,5 | in lots, unbuilt | 21 % |
| Centrum Dydaktyczne Wydz. Technologii Chemicznej | education | 4 901 | 565 | 1129,3 / 400 | in lots, unbuilt | 13 % |
| Pawilon 12 (Pałac Targowy) | retail | 4 794 | 770 | −1770,8 / 616,9 | landmark reserve | 41 % |
| Urząd Miasta Poznania | civic | 4 734 | 771 | 91,9 / 281,3 | landmark reserve | 28 % |
| Centrum Biologii Medycznej UM | education | 4 517 | 622 | −2929,9 / 121,1 | in lots, unbuilt | 40 % |
| Galeria MM | retail | 4 417 | 708 | −422,6 / 233,4 | in lots, unbuilt | 43 % |
| Dworzec autobusowy | rail | 4 349 | 848 | −1357 / 665,8 | landmark reserve | 0 % |
| Centrum Wykładowe | education | 4 340 | 800 | 1066,7 / 494,2 | in lots, unbuilt | 48 % |
| Student Depot Poznań | education | 4 266 | 393 | −479,5 / −704,9 | in lots, unbuilt | 36 % |
| Wydział Inżynierii Środowiska PP | education | 4 227 | 14 | −1167,6 / −2414,4 | in lots, unbuilt | 5 % |
| Oddział Zakaźny Szpitala Strusia | health | 4 176 | 1124 | 4333 / 1893,8 | in lots, unbuilt | 22 % |
| Uniwersytecki Szpital Kliniczny | health | 4 119 | 828 | 129 / 608,9 | in lots, unbuilt | 20 % |
| Odcinkowy magazyn amunicyjny A.M.M. IV | military | 3 892 | 1288 | −1990,6 / 2582,2 | park carve | 0 % |
| Centrum Kongresowo-Dydaktyczne UM | education | 3 770 | 622 | −3046,4 / 138 | in lots, unbuilt | 14 % |
| Centrum Mechatroniki, Biomechaniki i Nanoinżynierii | education | 3 720 | 829 | 1331,6 / 679,4 | in lots, unbuilt | 11 % |

### Szkoły i przedszkola

92/113 budynków `building=school` i 36/43 `building=kindergarten` jest pominiętych. Przykłady:

| obiekt | m² | kwartał | przyczyna | cov |
|---|---:|---:|---|---:|
| POSM I i II st. — budynek muzyczny | 2 074 | 425 | in lots, unbuilt | 0 % |
| POSM I i II st. — budynek ogólnokształcący | 1 567 | 425 | in lots, unbuilt | 0 % |
| XXXII Liceum Ogólnokształcące | 1 443 | 496 | in lots, unbuilt | 49 % |
| Szkoła Podstawowa nr 69 (Szkoła Mistrzostwa Sportowego) | 1 380 | 1211 | in lots, unbuilt | 6 % |
| Ogólnokształcąca Szkoła Baletowa | 1 259 | 753 | landmark reserve | 38 % |
| Szkoła Podstawowa nr 71 | 852 | 496 | in lots, unbuilt | 38 % |
| Przedszkole nr 117 im. Czecha | 1 048 | 968 | in lots, unbuilt | 28 % |
| Przedszkole nr 90 im. Jana Brzechwy | 847 | 1211 | in lots, unbuilt | 24 % |

### Kościoły i obiekty sakralne

31/52 `building=church` jest pominiętych; tylko 5 kościołów ma ręczny model (Bernardynów, Franciszkanów, NMP,
św. Wojciecha, Bożego Ciała). Największe braki:

| obiekt | m² | kwartał | przyczyna | cov |
|---|---:|---:|---|---:|
| Kościół pw. Nawiedzenia NMP | 2 364 | 1166 | in lots, unbuilt | 18 % |
| Kościół św. Wawrzyńca i św. Wincentego Pallottiego | 1 533 | 609 | in lots, unbuilt | 34 % |
| Kościół NSPJ i św. Floriana | 1 356 | 338 | in lots, unbuilt | 2 % |
| Kościół pw. Zmartwychwstania Pańskiego | 1 201 | 1280 | in lots, unbuilt | 43 % |
| Bazylika św. Józefa Oblubieńca NMP | 1 196 | 405 | splitDeep/minLot | 23 % |
| Kościół św. Krzyża | 1 146 | 1355 | in lots, unbuilt | 19 % |
| Kościół NMP Królowej Różańca Świętego | 1 067 | 505 | in lots, unbuilt | 5 % |

### Szpitale i ochrona zdrowia

| obiekt | m² | kwartał | przyczyna | cov |
|---|---:|---:|---|---:|
| Szpital HCP | 9 085 | 1306 | in lots, unbuilt | 22 % |
| Oddział Zakaźny Szpitala Strusia | 4 176 | 1124 | in lots, unbuilt | 22 % |
| Uniwersytecki Szpital Kliniczny | 4 119 | 828 | in lots, unbuilt | 20 % |
| SOR (Szpital Kliniczny) | 2 344 | 808 | in lots, unbuilt | 32 % |
| M1 / M2 / M3 / M5 (pawilony szpitalne) | 1 466–1 789 | 808 | in lots, unbuilt | 15–47 % |
| NZOZ Medicur | 1 691 | 911 | in lots, unbuilt | 15 % |

### Handel, MTP i pawilony

| obiekt | m² | kwartał | przyczyna | cov |
|---|---:|---:|---|---:|
| Pawilon 5 (MTP) | 15 333 | 770 | in lots, unbuilt | 34 % |
| Pawilon 12 (Pałac Targowy) | 4 794 | 770 | landmark reserve | 41 % |
| Galeria MM | 4 417 | 708 | in lots, unbuilt | 43 % |
| Pawilon 6 (MTP) | 3 139 | 770 | in lots, unbuilt | 48 % |
| Pawilon 8 (MTP) | 2 811 | 770 | in lots, unbuilt | 43 % |
| Maraton | 5 248 | 939 | in lots, unbuilt | 0 % |
| Lidl (dwa obiekty) | 2 332 / 2 257 | 293 / 1084 | in lots, unbuilt | 0 % |

### Sport, kultura i administracja

| obiekt | m² | kwartał | przyczyna | cov |
|---|---:|---:|---|---:|
| Poznań Congress Center | 8 488 | 770 | in lots, unbuilt | 37 % |
| CITYZEN | 4 931 | 939 | in lots, unbuilt | 0 % |
| Hala Sportowa im. W. Weissa | 3 610 | 800 | in lots, unbuilt | 42 % |
| Pływalnia Miejska Grunwald | 2 520 | 878 | in lots, unbuilt | 16 % |
| Hala sportowa AWF | 2 125 | 939 | in lots, unbuilt | 0 % |
| Hala B / Hala C (AWF) | 1 567 / 1 566 | 939 | in lots, unbuilt | 0 % |
| Kryte Lodowisko Malta | 852 | 613 | park carve | 0 % |
| Urząd Miasta Poznania | 4 734 | 771 | landmark reserve | 28 % |
| Urząd Marszałkowski | 2 914 | 414 | in lots, unbuilt | 50 % |
| Wielkopolski Urząd Wojewódzki | 2 133 | 505 | landmark reserve | 36 % |
| Sąd Apelacyjny | 1 940 | 425 | in lots, unbuilt | 5 % |
| Teatr Nowy | 1 854 | 473 | in lots, unbuilt | 44 % |
| Biblioteka Uniwersytecka | 1 472 | 708 | in lots, unbuilt | 39 % |

### Przemysł, magazyny, kolej i wojsko

| obiekt | m² | kwartał | przyczyna | cov |
|---|---:|---:|---|---:|
| ZNTK — magazyn techniczny | 2 726 | 887 | property-line gap | 11 % |
| ZNTK — magazyn wyrobów gotowych | 2 570 | 887 | in lots, unbuilt | 13 % |
| ZNTK — magazyn wyrobów gotowych | 2 159 | 887 | in lots, unbuilt | 27 % |
| ZNTK — magazyn surowców | 1 882 | 887 | in lots, unbuilt | 17 % |
| Unilever Polska | 619 | 35 | in lots, unbuilt | 0 % |
| Kotłownia (ZNTK) | 465 | 887 | property-line gap | 0 % |
| Komora fermentacyjna (oczyszczalnia) | 398 | 29 | in lots, unbuilt | 0 % |
| Dworzec autobusowy | 4 349 | 848 | landmark reserve | 0 % |
| Dworzec PKP Poznań Wschód | 334 | 295 | in lots, unbuilt | 0 % |
| Fort IV | 20 110 | 95 | park carve | 14 % |
| Fort IIa | 16 456 | 1271 | in lots, unbuilt | 21 % |
| Odcinkowy magazyn amunicyjny A.M.M. IV | 3 892 | 1288 | park carve | 0 % |

## Pięć głównych dziur

### 1. Profil dzielnicowy zamiast konkretnego obiektu — 8 835 obrysów / 307,4 ha

To największa dziura i jednocześnie odpowiedź na „mam wrażenie, że obiekty są pomijane”. Generator nie stawia
obrysu OSM; stawia morfologię kwartału. W 1 340 z 1 418 kwartałów `GEO.blockStats` ma `program = 0`, więc szkoła,
kościół, szpital czy hala dostają profil dzielnicy (kamienice, osiedle, wille). Tylko 78 kwartałów ma program
(11 szpital, 23 uczelnia, 18 handel, 13 przemysł, 5 kolej, 4 sport, 3 utility, 1 rekreacja). Skutek: 8 835 obrysów
ma działkę, ale < 50 % pokrycia; 7 415 obrysów w boxie ma pokrycie **zerowe**.

### 2. Siatka działek nie sięga obrysów — 2 829 + 585 obrysów / 63,7 ha, 2 159 bez działki

Surowa siatka pokrywa 71,3 % ziemi kwartałów, skuteczne działki 52,0 %, a 22 % komórek obrysów leży poza
działkami. Główne mechanizmy:

- `maskRects()` w `tools/poz-blocks.mjs`: `maxRects = 8`, próg 2 % powierzchni, zatrzymanie po 93 % pokrycia,
  `minSide = 8` — dlatego duże i nieregularne kwartały (887, 328, 968) mają dziury przy obrysach.
- `blockFrames()`: 12 prostokątów w pierwszym przejściu + 10 w drugim, `minSide = 12` — wąskie skrzydła i tylne
  oficyny wypadają.
- `splitDeep()`: pas 9 m co ~64 m; przecina budynki stojące w środku superbloku.
- `minLot` 12/15 m i erozja `SIDEWALK = 4.6 m`.
- 664 kwartały nie mają skutecznych działek (567 bez surowych `rects`, 65 median); 2 159 obrysów nie ma żadnej
  działki (21,1 ha). Mediany są niewinne: **0 median ma budynek OSM**.

### 3. Brak programów i profili dla klas cywilnych — education 31,7 ha, health 10,3 ha, sacral 4,6 ha

`buildingUse` w `tools/poz-buildings.mjs` zwraca tylko 1 (szpital/klinika) i 2 (uczelnia); reszta dużych klas ma
program 0. `anchorUse` ma tylko 5 użyć (retail, industrial, rail, sport, utility) i **celowo zwraca 0 dla civic**,
żeby nie wycinać kampusów. Efekt: `building=school` nie jest civic (bo `isCivicBuilding` nie sprawdza
`building=school`), kościoły i przedszkola nie mają anchoru, a pojedyncze szpitale/uczelnie poniżej progów
(5 ha, 40 % built) dostają generyk. 138 kwartałów bez programu ma ≥ 500 m² pominiętej niemieszkalnej zabudowy;
największe to 887 (23,5 tys. m²), 328 (20,2 tys.), 345 (19,9 tys.), 1166 (14,4 tys.), 1238 (10,9 tys.).

### 4. Poza kwartałami i poza detail boxem — 255 + 65 + 3 200 obrysów

- **255 obrysów / 3,1 ha** nie ma kwartału (jezdnia, tor, woda, skraj placu). Największe: Andersia Business Centre
  (3 105 m², plac), Społem przy Wiatracznej (904 m²).
- **65 obrysów / 0,5 ha** leży w kwartałach bez surowych działek.
- **3 200 obrysów / 118,9 ha** leży poza detail boxem, w padded snapshot. Renderuje je generyczne `outskirts.js`
  (47 tys. budynków), ale tylko 14 stanowisk `SATELLITE_SITES` (15 obrysów) ma konkretne sylwetki. Poza boxem zostają m.in.
  M1, Galeria Polskie Meble, Panorama, Pasaż Rondo, Bricomarché, Parowozownia Wąskotorowa, Franowo PF2/3.
- Tereny kolejowe: `poz-blocks.mjs` oddaje tylko **9 wysp budynków kolejowych (19 098 m²)** i tylko dla
  `RAIL_BUILDING`/nazw typu dworzec/zajezdnia. Zwykłe magazyny i warsztaty w `landuse=railway` zostają wycięte.

### 5. Rezerwy landmarków, park i dachy — 59 + 219 + 852 obrysów

- **landmark reserve: 59 obrysów / 4,2 ha.** Rezerwa to AABB pierścienia + 3 m, więc wycina też sąsiednie
  budynki. W rezerwie bez modelu zostają: Urząd Miasta (4 734 m²), Urząd Wojewódzki (2 133 m²), Dworzec
  autobusowy (4 349 m²), Pawilon 12 (4 794 m²), Dom Prowincjalny Franciszkanów (1 241 m²).
- **park carve: 219 obrysów / 4,5 ha.** To już tylko resztka po zmianach 2026-11-08 (wcześniej park usuwał 518 ha
  działek), ale wciąż giną Fort IV (20 110 m²), Lodowisko Malta (852 m²), bunkry i schrony.
- **dachy: 852 w boxie / 7,6 ha, tylko 157 canopy / 5,5 ha.** 12 dużych dachów ≥ 60 m² (0,63 ha) i 683 małe
  (1,95 ha) nie mają odpowiednika. To najbardziej „widoczny z ulicy” brak po tramwajach, stacjach i targowiskach.

## Rekomendacje architektoniczne

Zasada nadrzędna: **dodawać obiekty, nie zwiększać sumarycznej masy**. `js/buildings.js` już liczy
`srcTarget = min(srcLotArea, b.built * b.area)` i odejmuje `srcBuiltArea` po kotwicach; jeśli nowe kotwice/działki
wejdą przed generykiem, zastąpią jego metry, a nie dobudują kolejne. Nie należy globalnie zagęszczać ani
odchudzać — miasto jest już o ok. 2,3 pp powyżej OSM.

| # | zmiana | gdzie | zysk (górna granica) | ryzyko |
|---:|---|---|---:|---|
| 1 | **Kotwice dla wszystkich obiektów ≥ 200 m²** (nie tylko 1–3 największe na kwartał), z nowymi użyciami: 6 education, 7 sacral, 8 civic/health, 9 office | `tools/poz-buildings.mjs` `blockAnchors`, `js/buildings.js` `anchorProfile` | edukacja 30,0 ha, zdrowie 10,2, sakral 3,8, handel 15,7, przemysł 9,1, civic 5,2 — do ~74 ha pominiętych obrysów w boxie | średnie: trzeba capować `anchorArea` do realnego `b.built × b.area`, inaczej powstanie overbuild |
| 2 | **Programy 9 education, 10 sacral, 11 civic/health** w `buildingUse` + `blockStats`; `building=school` i `place_of_worship` jako civic w `anchorUse` | `tools/poz-buildings.mjs`, `js/buildings.js` `blockProfile` | 138 kwartałów bez programu z ≥ 500 m² non-res; 222 szkoły, 92 sakralne, 74 zdrowotne obrysy | niskie: program wybierany po 40 % obrysu, więc nie zmieni gęstych kwartałów bez wyraźnej dominacji |
| 3 | **Fallback działki z obrysu OSM** dla każdego budynku ≥ 60 m², który nie leży w żadnej działce; dodać jako non-facility do `blockFootprints` (analogicznie do `blockParkBuildings`) | `tools/poz-buildings.mjs`, `js/city-config.js` `blockLots` | 2 159 obrysów bez działki (21,1 ha) + 2 829 property-line gap (53,9 ha); maks. 75 ha, realnie mniej | niskie: `srcTarget` nadal capuje do realnego built; trzeba usuwać kolizje z anchorami i rezerwami |
| 4 | **Podnieść capy `maskRects`/`frames`**: 8→16, 2 %→1 %, 93 %→97 %, `minSide` 8→5; frames 12+10→16+14, `minSide` 12→8 | `tools/poz-blocks.mjs` | część z 53,9 ha property-line gap | średnie: więcej sliverów; poprzedni test 12/10→18/16 dał −0,65…+1,14 pp tylko w 7/27 kampusów, więc to nie pierwsza dźwignia |
| 5 | **Oddać wszystkie budynki w `landuse=railway`** ≥ 60 m², nie tylko dworce/zajezdnie | `tools/poz-blocks.mjs` sekcja „Railway buildings” | 9 wysp → potencjalnie kilkadziesiąt; magazyny ZNTK/Górczyn | niskie: nadal poza korytarzem torów, z `SIDEWALK` |
| 6 | **Rozszerzyć `blockParkBuildings`** z park > 0,4 na park > 0 i próg 60→40 m², z gate'em po `b.built` | `tools/poz-buildings.mjs`, `js/city-config.js` | 219 obrysów / 4,5 ha (Fort IV, Lodowisko Malta, bunkry) | średnie: więcej szop w parkach; gate po realnym built |
| 7 | **Rezerwa landmarku po pierścieniu, nie po AABB**, +1–2 m zamiast +3 m; dodać modele dla Urzędu Miasta, Urzędu Wojewódzkiego, Dworca autobusowego, Pawilonu 12, klasztoru | `js/buildings.js` `LANDMARK_RESERVE` | 59 obrysów / 4,2 ha | niskie: mniejsza rezerwa może postawić generyk bliżej modelu; test wizualny |
| 8 | **Canopy od 30 m²** i dla `building=carport`; dodać 12 dużych dachów bez canopy | `tools/poz-canopies.mjs`, `js/canopies.js` | 0,63 ha dużych + część 1,95 ha małych; głównie widoczność | niskie: więcej instancji, bez nowych materiałów |
| 9 | **Satelity dla brakujących obiektów poza boxem**: Galeria Polskie Meble, Panorama, Pasaż Rondo, Bricomarché, Parowozownia, Franowo PF2/3 | `js/satellite-sites.js` | 3 200 obrysów / 118,9 ha poza boxem; tylko nazwane, duże | niskie: kilka brył, bez rastrów; resztę pokrywa outskirts |
| 10 | **Test regresyjny listy znanych obiektów**: Posnania, Avenida, Stary Browar, IKEA, Castorama, Enea, Arena, Termy, Zajezdnia Głogowska + nowe kotwice szkół/kościołów | `tests/buildings-density.test.cjs` lub nowy `tests/missing-objects.test.cjs` | — | brak; chroni przed cofnięciem |

### Kolejność wdrożenia

1. **Punkt 3 (fallback działek)** — najbezpieczniejszy, density-neutralny, od razu odzyskuje 2 159 obrysów bez
   działki i większość property-line gap. To najlepszy stosunek zysku do ryzyka.
2. **Punkt 1 + 2 (kotwice i programy)** — odpowiada na „konkretne obiekty”: szkoły, kościoły, szpitale, MTP,
   magazyny. Wymaga rozszerzenia kontraktu `GEO.blockAnchors`/`blockStats` i testów.
3. **Punkt 5 + 6 (kolej i park)** — małe, lokalne, łatwe do zweryfikowania.
4. **Punkt 7 + 8 + 9** — kosmetyka widoczności (rezerwy, canopy, satelity).
5. **Punkt 4** — tylko jeśli 3 nie wystarczy; podnoszenie capów `maskRects` generuje slivery i wymaga osobnego
   przeglądu kampusów.

## Weryfikacja

```sh
node --max-old-space-size=8192 tools/audit-missing-objects.mjs /tmp/missing-objects.json
node --test tests/*.cjs
```

Wynik 2026-11-08:

- audyt: 23 579 obrysów, 20 357 w detail box, 16 058 pominiętych (502,4 ha), w tym 4 023 strukturalne (76,1 ha),
  8 835 profilowych (307,4 ha), 3 200 poza boxem (118,9 ha);
- `node --test tests/*.cjs` — **456/456 pass** (74 s). Audyt jest narzędziem w `tools/`, nie zmienia runtime'u ani
  `js/geodata.js`, więc nie wpływa na testy.

## Ograniczenia

- To audyt danych i generatora, nie przegląd wizualny. 50 % pokrycia nie znaczy „dobrze wygląda”; landmarki i
  kotwice są oceniane po obecności, nie po jakości modelu.
- Snapshot OSM jest z 2026-10-28. Poznań Plaza, King Cross, VW Antoninek, UAM Morasko i stacje Starołęka/Dębiec
  są poza padded boxem; ich brak wynika z zasięgu danych, nie z generatora.
- „In lots, unbuilt” nie zawsze oznacza zły profil: część obrysów to tylne oficyny i szopy, które generyk słusznie
  zastępuje podwórzem. Dlatego raport podaje osobno 7 415 obrysów z zerowym pokryciem i 2 159 bez działki.
- 47 obrysów ma zdegenerowaną geometrię i nie wchodzi do pomiaru pokrycia.
- Kotwica (`anchor`) oznacza dedykowaną bryłę na obrysie, ale nie gwarantuje 100 % pokrycia (np. Termy 20,4 %,
  bo kotwica jest mniejsza od całego kompleksu).

## Pliki

- `tools/audit-missing-objects.mjs` — nowe narzędzie audytowe (nie wymaga zmian w `js/geodata.js`).
- `docs/observations/missing-objects-audit-2026-11-08.md` — ten raport.
- Opcjonalny JSON: `node tools/audit-missing-objects.mjs /tmp/missing-objects.json` (≈ 600 KB; zawiera wszystkie
  obrysy, kategorie, przyczyny, współrzędne, `topBlocks`, `missedPrograms` i `curated`).
