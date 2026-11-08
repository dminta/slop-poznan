# Audyt zabudowy niemieszkalnej — 2026-11-08

Zakres: centra handlowe i obiekty wielkopowierzchniowe, infrastruktura kolejowa i zajezdnie, przemysł i utilities,
obiekty wystawiennicze/sportowe/kulturalne oraz kampusy i szpitale. Pytanie brzmiało: gdzie w rzeczywistości stoją
budynki inne niż bloki, kamienice i domy, a symulacja ma tam pusto, zaniża zabudowę albo wkłada niewłaściwy profil.

Materiał: `tools/data/poz_buildings.json` (OSM, 2026-10-28), `GEO.blocks` / `GEO.blockStats` / `GEO.landmarks`,
`tools/poz-blocks.mjs`, `tools/poz-buildings.mjs`, `js/buildings.js`. Skrypt: `tools/audit-nonresidential.mjs`
(uruchamiany jak w [Odtworzenie](#odtworzenie)). Audyt nie zmienia kodu symulacji.

## Wnioski w skrócie

1. **Całych pustych kwartałów prawie nie ma.** Generator wypełnia każdy kwartał z działkami, więc „pusto” jest
   praktycznie tylko tam, gdzie kwartał nie powstał (tereny kolejowe) albo jest rezerwą landmarku. Dokładnie
   **2 kwartały** z realną zabudową niemieszkalną ≥ 1 500 m² mają 0 m² generacji: **#1254** (hala zajezdni
   Głogowska, 0,66 ha OSM, 0,12 ha kwartału, 0 działek) i **#575** (Collegium Maius — poprawnie pusty, bo stoi tam
   model landmarku). Prawdziwym problemem nie jest brak kwartału, tylko **podmiana obiektu na kamienice/osiedle**.
2. **Największa strata jest geograficzna, nie algorytmiczna.** Detail box (52.383–52.434 N, 16.880–17.000 E) i
   padded box (52.380–52.437 N, 16.875–17.005 E) nie obejmują skupisk wielkopowierzchniowych: Pestka, Makro,
   Poznań Plaza, Castorama (prawie cała), Karolin, King Cross, M1 Franowo, IKEA/Selgros (większość), Franowo
   (OBI, Homepark, Decathlon, Hala M, Centrum Franowo), VW Antoninek, UAM Morasko, stacje Starołęka/Dębiec.
   **34 obiekty ≥ 1 500 m² (29,8 ha obrysu) są poza detail box**; Poznań Plaza, King Cross, VW Antoninek,
   UAM Morasko i stacje Starołęka/Dębiec nie weszły nawet do snapshotu, bo leżą poza padded box.
3. **W boxie obiekt często „jest”, ale jako zła morfologia.** Duże hale i galerie dostają profil dzielnicy:
   Posnania (7,68 ha) → 31 działek i zabudowa h 23 m (45 % pokrycia vs 75 % realnego), Gigamarket/Miasto Wnętrz
   → kamienice h 23 m, Castorama → 11-kondygnacyjne osiedle h 31 m, ZNTK → kamienice h 27 m, Główna → mieszanka
   kamienic i hal. **211 obiektów ≥ 1 500 m² ma częściowe pokrycie; 74,0 ha ich obrysu nie pokrywa się z żadnym
   wygenerowanym budynkiem**, a 31 obiektów (9,3 ha) nie ma pokrycia w ogóle.
4. **Dwa obiekty sportowe są wycięte przez park.** Hala Arena leży w Parku Kasprowicza, a Enea Stadion w obrysie
   `pitch`; `parkFreeCells` usuwa ich działki, więc oba mają 0 % pokrycia mimo dużego kwartału.
5. **Tereny kolejowe są czyszczone zbyt agresywnie.** `landuse=railway` i korytarze torów usuwają cały obszar z
   rastra bloków. Hala zajezdni Głogowska zostawia po sobie 1 183 m² kwartału i 0 działek; Dworzec Garbary,
   Dworzec Letni i LCS Poznań Główny nie mają żadnego bloku.
6. **Brakuje profili obiektowych, nie danych.** `js/buildings.js` ma profile `FAIRGROUND` (MTP — jedyny dobrze
   trafiony obiekt wystawienniczy), `LOWRISE` (hale, ale wybierany tylko heurystyką dzielnicy), `HOSPITAL` i
   `UNIVERSITY`. Nie ma `MALL`, `RETAIL_PARK`, `INDUSTRIAL_HALL`, `DEPOT`, `STADIUM`, `ARENA` ani `UTILITY`.
   `blockStats` koduje tylko program 1/2 (szpital/uczelnia), więc centrum handlowe i hala przemysłowa są dla
   generatora nierozróżnialne od kwartału mieszkaniowego.

## Metryki i sposób liczenia

- **Obrys OSM** — pole pierścieni zewnętrznych budynku (bez odejmowania dziur), w m².
- **W boxie** — pole komórek 1 m wewnątrz detail box; różnica do obrysu to część obiektu poza boxem (przycięcie).
- **Pokrycie** — udział komórek 2 m obrysu, nad którymi stoi jakikolwiek wygenerowany przez `js/buildings.js`
  budynek (nie landmark). 0 % = obiekt fizycznie nieobecny; 50–100 % = obecny, ale może być inną bryłą.
- **Realny built** — `blockStats[0]` (udział kwartału pod obrysami OSM).
- **Generacja** — suma komórek 2 m pod wygenerowanymi budynkami / pole kwartału.
- **Model landmarku** — obiekt pokryty ręcznym modelem z `js/landmarks-*.js` (nie liczy się jako brak).
- Progi tabel: obiekty ≥ 1 500 m²; kwartały ≥ 3 000 m² realnej zabudowy niemieszkalnej. Małe sklepy i kioski
  pomijam — są liczne, ale nie zmieniają sylwety.

## Podsumowanie ilościowe

| Kategoria | Obiekty ≥ 1,5 tys. m² | Poza boxem | Model landmarku | 0 % pokrycia (w boxie) | Częściowo (niepokryte) | Pokryte ≥ 50 % |
|---|---:|---:|---:|---:|---:|---:|
| Handel / wielkopowierzchniowe | 85 | 12 (12,2 ha) | 4 | 9 (2,6 ha) | 42 (16,3 ha) | 18 (8,7 ha) |
| Przemysł / utilities | 66 | 14 (14,8 ha) | 0 | 7 (2,0 ha) | 39 (23,7 ha) | 6 (2,8 ha) |
| Uczelnie / szpitale / publiczne | 144 | 7 (2,6 ha) | 5 | 8 (1,9 ha) | 103 (22,4 ha) | 21 (5,3 ha) |
| Sport / rekreacja / kultura | 14 | 0 | 0 | 2 (0,9 ha) | 12 (7,9 ha) | 0 |
| Biura (wydzielone) | 27 | 1 (0,2 ha) | 5 | 3 (0,8 ha) | 13 (3,2 ha) | 5 (1,2 ha) |
| Kolej / dworce / zajezdnie | 6 | 0 | 2 | 2 (1,1 ha) | 2 (0,5 ha) | 0 |
| **Razem** | **342** | **34 (29,8 ha)** | **16** | **31 (9,3 ha)** | **211 (74,0 ha)** | **50 (18,0 ha)** |

Cały zbiór niemieszkalny to 2 269 obrysów i 246,4 ha (w tym drobne sklepy, warsztaty i szkoły). Poza detail box
leży 308 obrysów (36,6 ha), z czego 34 duże (29,8 ha). 16 dużych obiektów jest modelowanych jako landmark
(≈ 10,2 ha) — to nie są braki.

**Bilans „utraconej” powierzchni**: 29,8 ha poza boxem + 9,3 ha w boxie bez pokrycia = **39,1 ha** obrysu, dla
którego symulacja nie ma żadnej bryły. Kolejne 74,0 ha obrysu jest pokryte tylko częściowo lub przez inne,
mniejsze budynki. Do tego dochodzą obiekty nieobecne w snapshotach (Poznań Plaza, King Cross, VW Antoninek,
UAM Morasko, stacje Starołęka/Dębiec) — dla nich nie da się podać pola z tego zbioru.

## Przyczyny, w kolejności ważności

### A. Zasięg danych (dominująca przyczyna)

- **Detail box** kończy się na 52.434 N / 52.383 N / 16.880 E / 17.000 E. Poza nim leżą całe klastry:
  - północ: **Galeria Pestka** (2,61 ha, 387 m za granicą), **Makro** (1,65 ha, 368 m), **Poznań Plaza**
    (~740 m, brak w snapshocie), **Karolin EC-II** (0,60 ha, 252 m), **Castorama** (1,19 ha, tylko 32 % w boxie);
  - południe/wschód: **M1 Poznań** (5,18 ha, 76 % poza), **IKEA** (1,90 ha, 60 % poza), **Selgros** (1,80 ha,
    94 % poza), **Franowo** (OBI, Homepark, Decathlon, Hala M, Centrum Franowo), **HCP**;
  - zachód: **King Cross Marcelin** (1,2 km, brak w snapshocie);
  - wschód: **VW Antoninek** (2,0 km, brak w snapshocie), hale Franowo (222–306 m).
- **Padded box** (52.380–52.437 N, 16.875–17.005 E) też nie sięga Pozań Plaza (52.4406 N), King Crossa
  (16.8616 E), VW (17.03 E) ani Starołęki/Dębca (52.37 N). Te obiekty w ogóle nie trafiają do `GEO.blockStats`.
- Skutek: nie są to błędy generatora, tylko brak danych. Nawet idealny profil nic nie zrobi, dopóki obiekt nie
  ma bloku i statystyk.

### B. Brak programów obiektowych w `blockStats`

`buildingUse` w `tools/poz-buildings.mjs` zwraca tylko 1 (szpital/klinika) i 2 (uczelnia). Cała reszta — mall,
hala, dworzec, stadion, elektrociepłownia — ma program 0. `blockProfile` wybiera wtedy profil z dzielnicy, a nie
z użytkowania. Przykłady:

| Kwartał | Dzielnica | Profil dzielnicy | Co powinno stać |
|---|---|---|---|
| #953 | Rataje | `PROJECTS`/`RES_KAMIENICE`, h 23 m | CH Posnania, hala 2–3 kondygnacji |
| #21 | Nowe Winogrady Południe | `ESTATE`, h 31 m | Castorama, hala 1–2 kondygnacji |
| #28 | Stare Winogrady | `RES_KAMIENICE`, h 23 m | Gigamarket / Miasto Wnętrz |
| #937 | Wilda | `RES_WILDA`, h 25 m | Enea Stadion, AWF, lodowisko |
| #847 | Wilda | `RES_WILDA`, h 27 m | ZNTK, hale naprawcze |
| #1310 | Wilda | `RES_WILDA`, h 25 m | Szpital HCP + zakłady HCP |
| #1121 | Antoninek | `HOSPITAL` (program 1!), h 22 m | hale przemysłowe + Szpital Strusia |
| #885 | Rataje | `PROJECTS`, h 25 m | hale MP Franowo |

### C. Wyczyszczenie parków i terenów kolejowych

- **`parkFreeCells`** usuwa z działek komórki parku. Hala Arena stoi w **Parku Kasprowicza**, a Enea Stadion
  w obrysie `pitch` — oba mają 0 % pokrycia, mimo że kwartały #925 i #937 generują odpowiednio 11 % i 8 %.
  W OSM budynek jest „w parku”, ale w mieście stoi na własnej działce.
- **`landuse=railway` + korytarze torów** są stemplowane na zero. Hala zajezdni Głogowska (0,66 ha) zostawia
  kwartał #1254 o polu 1 183 m², bez działek. Dworce Garbary/Letni i LCS nie mają bloku. To nie „pusty kwartał”,
  to brak kwartału.

### D. Rezerwy landmarków są niepełne

`LANDMARK_RESERVE` w `buildings.js` zawiera 37 nazw. Poza nim zostają m.in. **Posnania**, **MTP** (poza Iglicą),
**Kupiec**, **Galeria MM**, **Stary Browar Atrium** (Pasaż jest landmarkiem, Atrium nie), **Hala Arena**,
**Enea Stadion**, **Termy Maltańskie**, **EC Garbary**, **zajezdnia Głogowska**, **HCP**. Część z nich dostaje
generyczną zabudowę zamiast modelu; część nie dostaje nic.

### E. Przycięcie i raster

- 8 obiektów ma mniej niż 50 % obrysu w rastrze 1 m: M1 (24 %), Selgros (6 %), IKEA (40 %), Castorama (32 %),
  Antoninek 3,61 ha (43 %), #391598745 (40 %).
- 574 z 1 422 kwartałów nie mają żadnych prostokątów działkowych. Prawie wszystkie to parki, skwery i szczeliny,
  ale **#1254** jest jedynym dużym kwartałem z realną zabudową i bez działek.
- `building=roof` (1 038 elementów, w tym duże wiaty i zadaszenia peronów) jest świadomie pomijany — to poprawne
  dla masy zabudowy, ale zadaszenia stadionów i wiaty magazynowe nie mają potem żadnego odpowiednika.

### F. Luki w zapytaniu OSM

`q_poz_buildings.overpassql` bierze tylko `building=*`. Nie ma w nim:
- `man_made=cooling_tower|chimney|silo|storage_tank|water_tower|works`, `power=plant|substation` — dlatego
  Elektrociepłownia Garbary ma w snapshocie tylko dwie małe hale (0,41 i 0,47 ha) i żadnej chłodni/komina;
- wielkich, bezimiennych `building=yes` (np. **Termy Maltańskie**, 1,43 ha) — nie da się ich sklasyfikować po
  samym tagu, więc wpadają do tła;
- `building=ruins` (ZNTK: 2,74 + 2,03 + 1,02 ha) — są liczone do `blockStats`, ale nie mają kategorii, więc
  audyt ich nie widzi, a generator traktuje jak zwykły kwartał.

## Tabele szczegółowe

Legenda: „pokrycie” = udział obrysu pod wygenerowanymi budynkami; „gen/real” = generacja kwartału vs realny
built; „h” = najwyższy wygenerowany budynek w kwartale. ID obiektu = OSM way/relation.

### 1. Handel i obiekty wielkopowierzchniowe

| Obiekt | OSM ID | Kwartał | x, z | OSM | W boxie | Pokrycie | Gen/real | h | Przyczyna |
|---|---|---:|---|---:|---:|---:|---|---:|---|
| CH Posnania | 390832753 | 953 | 1480,3 / 1342,5 | 7,68 ha | 7,68 ha | 44 % | 45 % / 75 % | 23 m | brak profilu MALL; 31 działek, kamienice/osiedle |
| CH Avenida | 368791550, 368791540 | 847 | −1400,3 / 895,7 | 4,49 ha | 4,49 ha | 0 % | 24 % / 29 % | 27 m | landmark Avenida — obecny jako model; resztę kwartału wypełnia Wilda |
| Stary Browar (Pasaż) | 181129696 | 816 | −581,3 / 690,3 | 1,35 ha | 1,35 ha | 0 % | 15 % / 37 % | 61 m | landmark — obecny |
| Stary Browar (Atrium) | 199048095 | 816 | −417 / 781 | 0,82 ha | 0,82 ha | 24 % | 15 % / 37 % | 35,2 m | Atrium nie jest landmarkiem; biurowce zamiast galerii |
| Kupiec Poznański | 35277661 | 791 | −129,1 / 368 | 0,49 ha | 0,49 ha | 57 % | 39 % / 41 % | 26,6 m | brak modelu; profil OFFICES/RES_CENTRUM |
| Galeria MM | 427983275 | 708 | −425,4 / 234,8 | 0,44 ha | 0,44 ha | 43 % | 40 % / 68 % | 26,6 m | brak modelu; Stare Miasto |
| Galeria Polskie Meble | 437244497 | 21 | 31,1 / −2899,1 | 0,70 ha | 0,00 ha | 0 % | 19 % / 29 % | 31 m | 68 m za północną krawędzią, w boxie 21 m² |
| IKEA Franowo | 31767317 | 1375 | 3626,9 / 2841,8 | 1,90 ha | 0,75 ha | 59 % | 35 % / 33 % | 7,6 m | profil LOWRISE trafiony; 60 % obrysu poza boxem |
| Selgros | 176242403 | 1383 | 818,3 / 2904,2 | 1,80 ha | 0,10 ha | 49 % | 37 % / 16 % | 19 m | 94 % poza boxem; w boxie tylko skrawek |
| Gigamarket | 105143399 | 28 | 1152,0 / −2701,2 | 2,17 ha | 2,17 ha | 23 % | 31 % / 33 % | 23 m | kamienice zamiast hali |
| Miasto Wnętrz | 39350395 | 28 | 996,8 / −2664,7 | 1,46 ha | 1,47 ha | 26 % | 31 % / 33 % | 23 m | kamienice zamiast hali |
| Castorama | 34157790 | 21 | 155,9 / −2824,3 | 1,19 ha | 0,81 ha | 18 % | 19 % / 29 % | 30,8 m | ESTATE + 68 % poza północną krawędzią |
| M1 Poznań | 31567787 | 1309 | 4107,5 / 2871,8 | 5,18 ha | 1,26 ha | 0 % | 5 % / 9 % | 15 m | 76 % poza boxem; w boxie zero pokrycia |
| Galeria Pestka | 121267696 | — | −1059,3 / −3218,5 | 2,61 ha | 0 | — | — | — | 387 m za północną krawędzią |
| Makro | 46994640 | — | −1371,4 / −3199,1 | 1,65 ha | 0 | — | — | — | 368 m za północną krawędzią |
| Panorama | 28196090 | — | −2592,9 / 3059,1 | 1,50 ha | 0 | — | — | — | 215 m za południową krawędzią |
| Homepark Franowo | 229139205 | — | 3738,9 / 3081,7 | 1,44 ha | 0 | — | — | — | 238 m za południowo-wschodnią krawędzią |
| OBI Franowo | 161412082 | — | 3197,6 / 3185,7 | 1,05 ha | 0 | — | — | — | 342 m za południową krawędzią |
| Centrum Franowo | 14194965 | — | 3384,4 / 3195,2 | 1,02 ha | 0 | — | — | — | 351 m za południową krawędzią |
| Decathlon Franowo | 119909655 | — | 3437,8 / 2979,9 | 0,48 ha | 0 | — | — | — | 136 m za południową krawędzią |
| Hala M Franowo | 40701475 | — | 3528,8 / 3181,4 | 0,44 ha | 0 | — | — | — | 337 m za południową krawędzią |
| Poznań Plaza | brak w snapshocie | — | ≈ −1005 / −3570 | ~70 tys. m² całk. (dane właściciela) | — | — | — | — | 52.4406 N, poza padded box |
| King Cross Marcelin | brak w snapshocie | — | ≈ −4921 / −235 | ~118 tys. m² całk. (dane właściciela) | — | — | — | — | 16.8616 E, poza padded box |

### 2. Kolej, dworce, zajezdnie, zaplecze

| Obiekt | OSM ID | Kwartał | x, z | OSM | W boxie | Pokrycie | Gen/real | h | Przyczyna |
|---|---|---:|---|---:|---:|---:|---|---:|---|
| Dworzec Poznań Główny | 423143872 | 847 | −1444,1 / 643,4 | 0,31 ha | 0,31 ha | 0 % | 24 % / 29 % | 27 m | landmark — obecny |
| Stary Dworzec Główny | 6294130 | — | −1534,4 / 793,8 | 0,67 ha | 0,63 ha | 0 % | — | — | landmark + teren kolejowy bez bloku |
| Dworzec Zachodni | 260850132 | 838 | −1622,6 / 747,7 | 0,12 ha | 0,12 ha | 69 % | 23 % / 17 % | 26,6 m | brak modelu; wysoki budynek zamiast dworca |
| Dworzec Letni | 263320508 | — | −1469,2 / 393 | 0,02 ha | 0,02 ha | 0 % | — | — | teren kolejowy bez bloku |
| Poznań Wschód | 380394260 | 295 | 2722,9 / −1196,1 | 0,03 ha | 0,03 ha | 0 % | 34 % / 23 % | 23 m | brak modelu; kwartał generyczny |
| Poznań Garbary | 680343992 | — | 317,2 / −864,6 | 0,02 ha | 0,02 ha | 0 % | — | — | teren kolejowy bez bloku |
| Poznań Górczyn | 451352751 | — | −3707,5 / 3107,4 | 0,02 ha | 0 | — | — | — | 263 m za południową krawędzią |
| Zajezdnia Głogowska | 331761791 | 1254 | −2719 / 2317,7 | 0,66 ha | 0,66 ha | 0 % | 0 % / 68 % | — | kwartał 0,12 ha bez działek po wyczyszczeniu torów |
| Historyczna hala zajezdni | 319194285 | 599 | −1863,6 / −103,1 | 0,49 ha | 0,49 ha | 35 % | 42 % / 36 % | 23 m | kamienice zamiast hali |
| Zajezdnia Madalińskiego | 314752108 | 1278 | −1355,7 / 2477,6 | 0,17 ha | 0,17 ha | 15 % | 43 % / 39 % | 26 m | kamienice zamiast hali |
| ZNTK Robocza | 187916107, 188100057, 188099827 | 847 | −1445,8 / 1528,5 | 5,81 ha | 5,81 ha | 26 % | 24 % / 29 % | 27 m | `building=ruins`; brak kategorii i modelu |
| Zajezdnia Franowo | 411668410 | — | 4718,6 / 2787,8 | 1,97 ha | 0 | — | — | — | 228 m za wschodnią krawędzią |
| Dworzec Starołęka / Dębiec | brak w snapshocie | — | — | — | — | — | — | — | poza padded box (52.37 N) |

### 3. Przemysł, elektrociepłownie, magazyny

| Obiekt | OSM ID | Kwartał | x, z | OSM | W boxie | Pokrycie | Gen/real | h | Przyczyna |
|---|---|---:|---|---:|---:|---:|---|---:|---|
| EC Garbary | 441964024, 81124883 | 266 | 691,2 / −902,1 | 0,88 ha | 0,88 ha | 0 % | 5 % / 7 % | 21 m | działka elektrowni bez prostokątów; brak chłodni/kominów w snapshocie |
| EC Karolin EC-II | 300835893 | — | 3595,6 / −3083,1 | 0,60 ha | 0 | — | — | — | 252 m za północną krawędzią |
| Hale Główna (6,57 ha) | 110347208 | 36 | 4232,3 / −2753,2 | 6,57 ha | 5,27 ha | 31 % | 41 % / 36 % | 23 m | profil mieszany LOWRISE/RES_STARE; kamienice w hali |
| Hale Główna (4,46 ha) | 111841911 | 95 | 3849,6 / −2158,8 | 4,46 ha | 4,45 ha | 17 % | 12 % / 19 % | 19 m | LOWRISE częściowo, resztę wycina raster |
| Hale Główna (1,73 ha) | 165737905 | 78 | 2405,4 / −2326,8 | 1,73 ha | 1,73 ha | 44 % | 34 % / 22 % | 23 m | kamienice na terenie hali |
| Warsztaty Główna (1,27 ha) | 417087405 | 78 | 2568,2 / −2304,1 | 1,27 ha | 1,27 ha | 50 % | 34 % / 22 % | 23 m | jak wyżej |
| Antoninek hale (3,61 ha) | 358311425 | 1121 | 4484,2 / 2462,4 | 3,61 ha | 1,56 ha | 21 % | 17 % / 18 % | 22 m | kwartał ma program 1 (szpital) → HOSPITAL na przemyśle |
| HCP Cegielski | 23823500, 435785426 | — | ≈ −1676 / 2888; −1441 / 3099 | landuse (brak hal) | — | — | — | — | poza boxem; OSM ma głównie `landuse=industrial`, nie budynki |
| VW Antoninek | brak w snapshocie | — | ≈ 6524 / 507 | — | — | — | — | — | 2,0 km za wschodnią krawędzią, poza padded box |
| Magazyny Franowo | 391598754, 435785424, 358311460 | — | 4718–4797 / 2460–3220 | 3,91 + 3,62 + 1,53 ha | 0 | — | — | — | 222–306 m za wschodnią krawędzią |

### 4. Wystawy, sport, rekreacja, kultura

| Obiekt | OSM ID | Kwartał | x, z | OSM | W boxie | Pokrycie | Gen/real | h | Przyczyna |
|---|---|---:|---|---:|---:|---:|---|---:|---|
| MTP (pawilony 1–13) | 16 way | 770 | −1753,4 / 747,2 | 8,53 ha | 8,53 ha | 52 % | 46 % / 49 % | 19 m | profil FAIRGROUND trafiony; układ hal generyczny, nie na realnych obrysach |
| Enea Stadion | 8512283 | 937 | −312 / 1373,3 | 5,29 ha | 3,49 ha | 0 % | 8 % / 17 % | 25 m | obrys w `pitch`; park wycina działkę |
| Hala Arena | 279682863 | 925 | −2857,1 / 1206,3 | 0,78 ha | 0,79 ha | 0 % | 11 % / 11 % | 22 m | obrys w Parku Kasprowicza; program 1 (szpital) |
| Termy Maltańskie | 158699450 | 613 | 2696,5 / 372,8 | 1,43 ha | 1,43 ha | 11 % | 4 % / 4 % | 11 m | bezimienny `building=yes`; brak klasyfikacji |
| Lodowisko Chwiałka | 183357024 | 937 | −343 / 1784 | 0,34 ha | 0,34 ha | 4 % | 8 % / 17 % | 25 m | kwartał Wilda, brak profilu sportowego |
| Kryte Lodowisko Malta | 188919088 | 613 | 1417,1 / 386,9 | 0,09 ha | 0,09 ha | 0 % | 4 % / 4 % | 11 m | brak profilu; niska generacja kwartału |
| Tor Regatowy Malta | — | — | — | — | — | — | — | — | woda; brak budynku do modelowania |

### 5. Kampusy, szpitale, obiekty publiczne

| Obiekt | OSM ID | Kwartał | x, z | OSM | W boxie | Pokrycie | Gen/real | h | Przyczyna |
|---|---|---:|---|---:|---:|---:|---|---:|---|
| Politechnika Piotrowo | 6 way | 828, 565, 1049 | 1177,8 / 730,3 | 1,56 ha | 1,56 ha | 20 % | 26/27, 10/13, 29/22 % | 18–19 m | program 2 na 828/565 trafiony; 1049 (Rektorat, 1,25 ha) poniżej progu 5 ha → profil dzielnicy |
| AWF | 30646033 + 2 | 937 | −68,7 / 1063,8 | 0,64 ha | 0,64 ha | 17 % | 8 % / 17 % | 25 m | kwartał 937 bez programu (stadion + AWF + POSiR) |
| UAM Szamarzewo | 4 way | 770, 757, 622 | −1961,4 / 273,3 | 2,17 ha | 1,78 ha | 33 % | 46/49, 30/31, 20/21 % | 18–19 m | program 2; profil kampusowy trafiony |
| UPP Wojska Polskiego | 5 way | 11, 221, 14 | −2096,3 / −2146 | 1,11 ha | 1,05 ha | 21 % | 15/16, 19/18, 15/16 % | 15–18 m | program 2; kampus trafiony |
| Szpital HCP | 13224258 | 1310 | −1508,7 / 2834,2 | 0,91 ha | 0,57 ha | 52 % | 36 % / 34 % | 25 m | program 0: jeden szpital + hale HCP w kwartale |
| Uniwersytecki Szpital Kliniczny | 438294844 | 827 | 125,7 / 606,8 | 0,41 ha | 0,41 ha | 35 % | 47 % / 50 % | 27 m | program 1, ale gate (area < 5 ha, built > 40 %) wyłącza kampus |
| Szpital Strusia | 5336445 | 1121 | 4196,8 / 2121,1 | 1,13 ha | 0,94 ha | 13 % | 17 % / 18 % | 22 m | program 1 na 34-ha kwartale zmieszanym z przemysłem |
| UAM Morasko | brak w snapshocie | — | ≈ −1088 / −5724 | — | — | — | — | — | 2,9 km za północną krawędzią |

**Kampusy w liczbach:** `blockStats` ma program > 0 na 37 z 1 422 kwartałów. Z tego **14** jest wyłączonych
z profilu kampusowego przez warunek `area ≥ 5 ha && built ≤ 0,4 && park ≤ 0,5`: #7, #87, #192, #221, #412,
#579, #582, #733, #769, #770, #814, #827, #927, #989. Część wyłączeń jest świadoma (gęste kwartały śródmieścia
mają zostać kamienicami — patrz testy `buildings-density.test.cjs`), ale #827 (Szpital Kliniczny) i #989
(program 1) to szpitale, które tracą profil bez zamiennika.

## Kwartały z zerową generacją (a)

Wszystkie kwartały z `generated = 0` i realną zabudową niemieszkalną ≥ 1 500 m²:

| Kwartał | Dzielnica | Pole | Realny built | Niemieszkalne | Działki | Generacja | Przyczyna |
|---:|---|---:|---:|---:|---:|---:|---|
| 1254 | Łazarz | 0,12 ha | 68 % | 0,66 ha | 0 | 0 m² | hala zajezdni Głogowska; `landuse=railway` + korytarz torów wycinają cały kwartał, zostaje 1 183 m² bez działek |
| 575 | Stare Miasto | 0,91 ha | 50 % | 0,45 ha | 8 | 0 m² | Collegium Maius — rezerwa landmarku; kwartał **poprawnie** pusty, obiekt jest modelem |

Poza tym 697 kwartałów ma 0 m² generacji, ale 685 z nich nie ma żadnej realnej zabudowy niemieszkalnej
(parki, skwery, pasy drogowe, szczeliny i tereny kolejowe). Pozostałe 10 to drobne skrawki (łącznie 0,2 ha
niemieszkalnych). To nie są braki.

## Obiekty bez przypisania do kwartału (b)

347 obrysów (38,5 ha OSM) nie ma kwartału, ale tylko 6 ma ≥ 800 m² w boxie i realne znaczenie:

| Obiekt | Kategoria | W boxie | Przyczyna |
|---|---|---:|---|
| Stary Dworzec Główny | rail | 6 312 m² | landmark + teren kolejowy |
| Andersia Tower | office | 3 270 m² | landmark; plac miejski, nie kwartał |
| Andersia Business Centre | office | 3 100 m² | brak landmarku i bloku (plac) |
| Poznańskie Centrum Finansowe | office | 2 281 m² | landmark; plac |
| LCS Poznań Główny PoA | rail | 1 218 m² | teren kolejowy |
| Społem (ul. Wiatraczna) | retail | 905 m² | kwartał wycięty przez tory/drogi |

Wniosek: kategoria (b) z briefu jest ilościowo mała. Największym realnym przypadkiem jest **zajezdnia
Głogowska**, która formalnie ma kwartał, ale szczątkowy. Dworce Garbary/Letni i LCS nie mają kwartałów wcale.

## Kwartały zaniżone i zawyżone względem realnego built

Kwartały z realną zabudową niemieszkalną ≥ 3 000 m², gdzie generacja < 60 % realnego built:

| Kwartał | Dzielnica | Pole | Nonres | Real built | Generacja | h | Uwaga |
|---:|---|---:|---:|---:|---:|---:|---|
| 953 | Rataje | 10,3 ha | 7,68 ha | 75 % | 45 % | 23 m | Posnania; profil mieszkaniowy nie sięga 75 % |
| 937 | Wilda | 42,2 ha | 6,47 ha | 17 % | 8 % | 25 m | stadion + AWF + POSiR; park wycina |
| 885 | Rataje | 83,5 ha | 4,16 ha | 15 % | 8 % | 25 m | Franowo/MP; osiedle zamiast hal |
| 816 | Stare Miasto | 10,1 ha | 2,88 ha | 37 % | 15 % | 61 m | Stary Browar; rezerwy landmarków |
| 1365 | Wilda | 2,7 ha | 2,24 ha | 77 % | 45 % | 23 m | gęste hale magazynowe |
| 878 | Wilda | 4,3 ha | 1,45 ha | 34 % | 20 % | 27 m | — |
| 1309 | Chartowo | 14,8 ha | 1,40 ha | 9 % | 5 % | 15 m | M1; większość poza boxem |
| 966 | Rataje | 54,9 ha | 1,35 ha | 9 % | 4 % | 23 m | park 0,63 |
| 585 | Stare Miasto | 3,0 ha | 0,88 ha | 43 % | 20 % | 22 m | Muzeum Narodowe (landmark) |
| 708 | Stare Miasto | 3,6 ha | 0,74 ha | 68 % | 40 % | 27 m | Galeria MM |

Kwartały zawyżone (generacja > 150 % realnego built) to głównie Główna i tereny przemysłowe, gdzie LOWRISE
dobudowuje więcej niż realne hale: #78 34 % / 22 %, #345 23 % / 14 %, #400 34 % / 21 %, #1292 27 % / 12 %,
#374 32 % / 15 %, #414 45 % / 29 %. To odwrotność problemu „pusto”, ale również błąd profilu: zamiast jednej
hali powstaje kilkadziesiąt mniejszych budynków.

## Rekomendacje architektoniczne

### 1. Nowe profile w `js/buildings.js`

Dodać co najmniej sześć profili i sterować nimi z `blockStats`, nie z dzielnicy:

| Profil | Kształt | Wysokość | Pokrycie działki | Zastosowanie |
|---|---|---|---:|---|
| `MALL` | 1–2 głębokie boksy, atrium, parking na dachu/przy boku | 14–20 m | 60–80 % | Posnania, Avenida, Pestka, Plaza, Kupiec, MM |
| `RETAIL_PARK` | rząd 1–2-kondygnacyjnych hal z podcieniami | 8–13 m | 65–85 % | Castorama, Makro, OBI, IKEA, Selgros, Gigamarket |
| `INDUSTRIAL_HALL` | hala z dachem shed/north-light, plac manewrowy | 8–15 m | 55–75 % | Główna, ZNTK, HCP, Franowo |
| `DEPOT` | długa hala + otwarte tory, warsztat | 8–14 m | 35–55 % | Głogowska, Madalińskiego, Franowo |
| `STADIUM` | cztery trybuny + murawa; `ARENA` — jedna hala | 25–45 m (trybuny), 18–30 m (arena) | 25–40 % | Enea, Arena |
| `UTILITY` | turbinownia + kotłownia + komin/chłodnia jako props | 20–40 m | 40–60 % | EC Garbary, Karolin |

`KIND_SHARE` uzupełnić: `mall 0.75`, `retail 0.6`, `industrial 0.55`, `depot 0.5`, `stadium 0.25`,
`arena 0.6`, `utility 0.45` — inaczej `steerProfile` nadal będzie ścinał Posnanię do 28–45 %.

### 2. Rozszerzyć `blockStats` o dominujące użytkowanie

W `tools/poz-buildings.mjs` `buildingUse` powinno zwracać więcej klas: 3 retail, 4 industrial, 5 rail/depot,
6 stadium/arena, 7 utility, 8 leisure/water park. Program kwartału wybierać po **dominującej powierzchni
obrysu**, nie po liczbie budynków (jeden mall 7,68 ha ma przeważyć 30 kamienic). Próg: udział ≥ 40 % liczonego
obrysu. To rozszerza kontrakt `GEO.blockStats` — zaktualizować komentarz przy literale `GEO` w
`tools/build-poznan.mjs`, `docs/geodata.md` oraz `tests/geodata.test.mjs`.

### 3. Dać generatorowi „kotwice” z OSM

Największa pojedyncza poprawka jakości: `poz-buildings.mjs` już liczy każdy obrys. Warto emitować per kwartał
1–3 największe obrysy niemieszkalne jako `GEO.blockAnchors`: `{ x, z, w, d, ang, levels, use }` (ten sam
format co `GEO.landmarks`). `buildings.js` stawiałby wtedy jeden obiekt na kotwicy (MALL/INDUSTRIAL/STADIUM),
a resztę działek uzupełniał parkingiem, placem lub niską zabudową. Koszt: ~2 000 wpisów po ~40 B; brak nowych
pipeline'ów. To rozwiązuje jednocześnie „złą morfologię” i „przesunięcie względem realnego obrysu”.

### 4. Priorytet programu nad dzielnicą

W `blockProfile` sprawdzać `srcBlock.program` **przed** `OFFICE_SITES` i przed `switch (district)`, dla
programów 3–7 bez progu 5 ha. Kampusy zachować z obecnym gate'em (żeby nie psuć gęstych kwartałów #192,
#769, #814, #827), ale wydzielić z niego **szpitale** — dla programu 1 dopuścić `built ≤ 0,55` i obszar
≥ 0,4 ha, bo #827 i #989 to realne szpitale, nie kamienice.

### 5. Tereny kolejowe: wyspy budynków zamiast czyszczenia

- W `poz-blocks.mjs` po stemplowaniu `landuse=railway` i korytarzy torów **przywrócić** komórki pod obrysami
  budynków (analogicznie do dziur placów), powiększone o `SIDEWALK`. Dworzec Garbary, Letni, LCS i hala
  Głogowska dostaną wtedy własne kwartały.
- Dodać profil `DEPOT` i rezerwę dla zajezdni; nie traktować ich jak zwykłej Wildy/Łazarza.

### 6. Parki: nie wycinać zamapowanych budynków

`parkFreeCells` powinien odejmować od parku obrysy budynków (stadium, arena, lodowisko, hala) przed
dzieleniem na działki — tak jak `city-grid.js` robi to dla nawierzchni parkowych. Wtedy Enea i Arena dostaną
działkę, a nie znikną. To tania zmiana w `js/buildings.js` (lista `building footprints` już jest dostępna
przez `GEO`/`blockStats`; trzeba ją przekazać do `parkFreeCells`).

### 7. Rozszerzyć rezerwy landmarków

Dodać do `LANDMARK_RESERVE` (lub ręcznie wymodelować): **Posnania**, **MTP** (pawilony poza Iglicą),
**Kupiec**, **Galeria MM**, **Stary Browar Atrium**, **Hala Arena**, **Enea Stadion**, **Termy Maltańskie**,
**EC Garbary**, **zajezdnia Głogowska**, **HCP**, **ZNTK**. Dla obiektów, których nie chcemy modelować
ręcznie, wystarczy rezerwa + kotwica z punktu 3 i profil z punktu 1.

### 8. Zasięg danych

Dwie opcje, w kolejności kosztu:

1. **Tanie (rekomendowane)**: nie powiększać detail box. Dodać `SATELLITE_SITES` w `js/outskirts.js` — kilka
   ręcznie umieszczonych, rzeczywistych obrysów (Pestka, Makro, Plaza, King Cross, M1, Franowo, Karolin, VW)
   jako modele/instancje w pasie outskirts, z prawdziwymi wymiarami z OSM. Koszt: kilkanaście brył, bez
   rastrów i bez zmiany `GEO.blocks`.
2. **Pełne**: powiększyć detail box do ≈ 52.376–52.441 N, 16.858–17.010 E. To +45 % komórek rastra; czas
   budowy geodaty rośnie z ~29 s do ~45 s, pamięć z ~1,27 GB do ~1,9 GB. Wymaga też ponownego fetchu
   wszystkich snapshotów i przejrzenia progów testów.

### 9. Uzupełnić dane wejściowe

- Nowy snapshot `poz_industry.json`: `man_made=cooling_tower|chimney|silo|storage_tank|water_tower|works`,
  `power=plant|substation`, `landuse=industrial|railway` z nazwami. Bez tego EC Garbary i Karolin nigdy nie
  będą miały chłodni i kominów.
- W `q_poz_buildings.overpassql` zostawić `building=*`, ale w `poz-buildings.mjs` dodać klasyfikację
  `ruins` (ZNTK) i bezimiennych `building=yes` po adresie/landuse (Termy: `addr:street=Termalna`).
- Nie włączać `building=roof` do masy zabudowy, ale rozważyć osobny zestaw „canopy” dla zadaszeń peronów
  i wiat — inaczej stadion i magazyny tracą charakterystyczne dachy.

### 10. Testy regresyjne

- Rozszerzyć `tests/buildings-density.test.cjs` o tabelę kotwic: dla #953 Posnania max h ≤ 20 m i ≥ 60 %
   pokrycia obrysu; #937 Enea/Arena ≥ 30 %; #1254 hala Głogowska > 0 m²; #1310 HCP jako szpital, nie kamienice.
- Dodać test listy „poza boxem”: 34 obiekty ≥ 1 500 m² i ich odległości do krawędzi — nowy obiekt w tym
  zestawie ma failować, dopóki nie ma świadomej decyzji.
- Utrzymać istniejące progi dzielnic (Sołacz, Winiary, Ogrody itd.), żeby nowe profile nie podniosły
  przypadkiem zabudowy mieszkaniowej.

## Odtworzenie

```bash
node --max-old-space-size=8192 tools/audit-nonresidential.mjs /tmp/nonres.json
```

Skrypt:
1. importuje `tools/poz-blocks.mjs` i `tools/poz-buildings.mjs` (ta sama assignacja obrysu do kwartału co
   `GEO.blockStats`),
2. klasyfikuje obrysy po tagach OSM (`retail`, `rail`, `industrial`, `leisure`, `civic`, `office`),
3. uruchamia `js/buildings.js` w harnessie testowym z inertnym three.js/TSL
   (`tests/helpers/module.cjs`), rasteryzuje generację na siatce 2 m,
4. liczy pokrycie każdego obrysu, wysokość generacji, kwartał, dzielnicę i program,
5. zapisuje JSON z tabelami `targets`, `blockRows`, `absent`, `partial`, `replaced`, `noCells`, `clipped`.

Czas: ~35 s (24 s to raster bloków, resztę budowa miasta i audyt). Wynik z 2026-11-08: 2 269 obrysów
niemieszkalnych, 342 duże, 2 puste kwartały, 34 duże obiekty poza boxem.

## Ograniczenia

- To audyt danych i generatora, nie przegląd wizualny. Nie sprawdza, czy istniejące modele landmarków są
  widoczne lub poprawnie osadzone — zakłada, że są (zgodnie z `docs/world.md`).
- „Pokrycie” liczy dowolny wygenerowany budynek, także kamienicę; 50 % pokrycia nie znaczy „dobrze”.
  Dlatego osobno podaję wysokość i liczbę działek.
- Obrysy relacji wielokątnych liczone są bez odejmowania dziur (jak w `poz-buildings.mjs`); dla stadionu
  i MTP zawyża to pole o kilka procent.
- Snapshot OSM jest z 2026-10-28. Poznań Plaza i King Cross są poza padded box, więc ich pól nie znamy
  z tego zbioru; podane wartości całkowite pochodzą z danych właścicieli i służą tylko orientacji.
- Tereny `landuse=industrial` bez budynków (HCP) są niewidoczne dla `blockStats`; audyt pokazuje je jako
  „brak obrysu”, nie jako „pusty kwartał”.
