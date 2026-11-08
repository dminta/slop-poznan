# Kotwice budynków `GEO.blockAnchors` — 2026-11-08

Zakres: zadanie 1.3 z [backlogu](../backlog.md) i rekomendacja 3 z
[audytu niemieszkalnego](non-residential-audit-2026-11-08.md). Generator dostaje realne obrysy największych
obiektów niemieszkalnych z OSM, żeby centra handlowe, hale, zajezdnie i areny stały na swoich działkach, a nie
jako rzędy kamienic albo kilka przesuniętych brył.

Materiał: `tools/data/poz_buildings.json` (OSM 2026-10-28), `tools/poz-buildings.mjs`, `tools/build-poznan.mjs`,
`js/city-config.js`, `js/buildings.js`. Pomiar: `tools/audit-nonresidential.mjs` (2 m raster generacji).

## Selekcja kotwic

`tools/poz-buildings.mjs` klasyfikuje każdy obrys po tagach i nazwach:

| `use` | Klasa | Przykłady |
|---:|---|---|
| 1 | handel / mall / big-box | Posnania, Castorama, Gigamarket, M1, IKEA, Selgros |
| 2 | przemysł / magazyn | ZNTK, Hale Główna, hale MP Franowo |
| 3 | kolej / zajezdnia | Dworzec Zachodni, zajezdnia Głogowska, Madalińskiego |
| 4 | sport / rekreacja | Hala Arena, Enea Stadion, Chwiałka, Termy |
| 5 | utility | EC Garbary i obiekty `power=*`/`man_made=cooling_tower|chimney|…` |

Obrysy szpitali, uczelni i szkół (w tym AWF) są `use = 0`: mają własny profil kampusowy i nie mogą zostać
wycięte z kwartału jako „hala przemysłowa”. Kolejność klas jest istotna — „Szpital HCP” nie może trafić do
przemysłu przez „HCP”, a dworcowa galeria handlowa pozostaje dworcem.

Dla każdego kwartału wybierane jest 1–3 największych obrysów, ale tylko gdy:

- efektywne pole obrysu (mniejsze z OSM area i liczby komórek rastra w kwartale) wynosi ≥ 600 m²; kwartał bez
  takiego obrysu zachowuje największy, jeśli ma ≥ 250 m²;
- obrysy niemieszkalne dominują masę budowlaną kwartału: ≥ 30 % komórek OSM budynków;
- suma kotwic pokrywa ≥ 10 % pola kwartału (albo w kwartale jest obiekt parkowy `facility`);
- kwartał nie zawiera budynku kampusowego ≥ 1 000 m² (szpital, uczelnia, AWF, biblioteka naukowa). Bez tej bramki
  zakotwiczenie pawilonów MTP w kwartale 770 obniżyło UAM Szamarzewo z 33 % do 27 %, a kwartał 939 stracił AWF.

Kotwica to `[x0, x1, z0, z1, area, use, levels]`, zaokrąglona do 0,1 m. `x0…z1` jest obwiednią **własnych
komórek obrysu w tym kwartale**, nie pełnym bboxem OSM: obiekt przycięty krawędzią detail boxu (M1, Selgros) nie
zamienia się w budynek na całą wyspę. Nakładające się obwiednie (hala i jej parking) są odrzucane, gdy
przecinają się w ponad połowie mniejszej.

Wynik na snapshocie 2026-10-28: **61 kotwic w 35 kwartałach, 2 KB** w `js/geodata.js`
(`js/geodata.js` rośnie z 2 595 576 B do 2 597 820 B).

## Wykorzystanie w `js/buildings.js`

`BLOCKS[i].anchors` (z `city-config.js`) trafia do `srcAnchors` kwartału. Kolejność w kwartale:

1. **Kotwice są budowane pierwsze.** `populateAnchor` przecina obwiednię kotwicy z własnymi prostokątami
   działek kwartału w każdej ramie elewacyjnej (`srcBlock.frames`), więc bryła nie wychodzi na ulicę, do
   sąsiedniego kwartału ani na parkową wysepkę. To naprawia dwa przypadki, w których sam AABB kłamał: L-kształt
   Posnanii i przycięty bbox IKEA (kilkadziesiąt metrów kwadratowych w parkowym kwartale 1033/1363).
2. **Bryła wypełnia wyłącznie własne części.** Mall/big-box to jedna niska bryła (3–5 kondygnacji z `levels`,
   szkło powyżej 8 000 m²), hala przemysłowa i zajezdnia dzielą się na 18–30 m przęsła z płytkimi dachami
   dwuspadowymi, arena to jedna hala (bez podestu nad tym samym planem), utility — dwie bryły techniczne.
   Wysokość bierze `levels` z OSM, gdy ≥ 2; inaczej profilową normę (magazyn 2–3, mall 3–4, arena 4–6 kondygnacji).
3. **Reszta kwartału nie dostaje kamienic.** Po kotwicach `srcBuiltArea` jest już obciążone ich stopami, a
   pozostałe działki dostają `ancillaryBlock`: jedną niską (1–2 kondygnacje) pawilonową bryłę do wysokości
   pozostałego budżetu realnego `built`, resztę jako plac/parking. Dzięki temu wskaźnik built pozostaje realny,
   a nie rośnie przez dogęszczenie kwartału mieszkaniówką.

Wyjątki: kwartały parkowe (`park > 0.6`) zachowują dotychczasowy `blockFootprints`/`facilityBlock`; kotwica
schowana pod rezerwą landmarku (Stary Browar, Avenida) jest pomijana; kotwica mniejsza niż 3 % pola kwartału po
odrzuceniu rezerwy landmarków wraca do profilu dzielnicy (kwartał 817: jedna hala 700 m² po Starym Browarze nie
zamienia 37 % zabudowy biurowej w plac).

## Pokrycie po zmianie

`node --max-old-space-size=8192 tools/audit-nonresidential.mjs /tmp/nonres-after.json`:

| Obiekt | Kwartał | Przed | Po | Wysokość po |
|---|---:|---:|---:|---:|
| CH Posnania | 955 | 68 % | **94 %** | 12 m |
| Castorama | 21 | 22 % | **84 %** | 12 m |
| ZNTK Robocza | 848 | 21 % | **74 %** | 11 m |
| Hala Arena | 927 | 83 % | **97 %** | 18 m |
| Zajezdnia Głogowska | 1250 | 15 % | **60 %** | 8 m |
| Hale Główna 6,57 ha | 36 | 80 % | **98 %** | 15 m |
| Hale Główna 4,46 ha | 95 | 30 % | **84 %** | 8 m |
| Hale Główna 1,73 ha | 78 | 81 % | **96 %** | 8 m |
| Warsztaty Główna 1,27 ha | 78 | 84 % | **97 %** | 8 m |
| Enea Stadion | 939 | 72 % | 72 % | 23 m (układ trybun bez zmian) |
| AWF / UAM Szamarzewo / Szpital HCP / MTP | 939 / 770 / 1306 / 770 | 17 / 33 / 22 / 52 % | bez zmian | — |

Bilans audytu: kwartały z zerową generacją przy realnej zabudowie ≥ 1 500 m² **3 → 2** (zostają #880 i #575),
kwartały niedobudowane **5 → 4**, obiekty częściowo pokryte **329 → 309**, obiekty nieobecne **65 → 66**
(drobne hale w kwartałach 78/95; 7 innych wróciło), obiekty pokryte w ≥ 50 % **62 → 83**. Wzrost „replaced”
oznacza obiekty realnie pokryte własną bryłą, nie podmienione na kamienice.

## Regresje i testy

- `node --test tests/*.cjs`: **442/442**.
- `node --test tests/geodata.test.mjs`: przebudowa bajt w bajt z committed `js/geodata.js`; nowe asercje
  `blockAnchors` (≥ 30 kwartałów, Posnania 955, Castorama 21, ZNTK 848, Arena 927, Głogowska 1250, poprawny
  format i `use` 1–5).
- `node --test tests/buildings-density.test.cjs`: szkoły, wille, osiedla, kampusy i biura w swoich pasmach;
  balony 14–18 tys. i limit 2 400 bez zmian.
- Piny `tests/tree-distribution.test.cjs` przesunięte o 30 miejsc drzew (18630 → 18600) i dwa digesty colliderów:
  nowe bryły zajmują część dotychczasowych miejsc pieszych i przesuwają drzewa; liczba siatek i pozostałe
  digesty bez zmian.
- Kwartały parkowe (41) zachowują sumę pokrycia powierzchni parkowych i triangulację; `AWF`, `UAM Szamarzewo`,
  `Szpital HCP` i `MTP` wróciły do wartości sprzed kotwic po bramce kampusowej.

## Ograniczenia

- To pomiar danych i generatora, nie przegląd wizualny. Nie sprawdzono w WebGPU/WebGL2 sylwetek Posnanii,
  Castoramy, ZNTK, Areny, hal Głównej ani styków z parkingami i elewacjami sąsiednich kamienic.
- Obwiednia kotwicy jest prostokątem w układzie świata; `populateAnchor` przycina ją do działek kwartału, ale
  skośny lub łukowy obrys (arena, stadion) nadal przybliża prostokątami. Stadion (≥ 2 ha) celowo zostaje przy
  układzie czterech trybun, żeby nie zabetonować murawy.
- Kotwice nie są emitowane w kwartałach z dużym budynkiem kampusowym; takie obiekty nadal korzystają z profilu
  `HOSPITAL`/`UNIVERSITY` i `blockStats.program`, a nie z pojedynczej bryły.

## Odtworzenie

```bash
node --max-old-space-size=8192 tools/build-poznan.mjs
node --test tests/*.cjs
node --test tests/geodata.test.mjs
node --test tests/buildings-density.test.cjs
node --max-old-space-size=8192 tools/audit-nonresidential.mjs /tmp/nonres-after.json
```
