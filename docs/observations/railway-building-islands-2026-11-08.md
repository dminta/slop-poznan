# Wyspy budynków kolejowych — 2026-11-08

Zakres: przywrócenie kwartałów pod zamapowanymi budynkami kolejowymi, stacyjnymi i zajezdniami, które wcześniej
zniknęły razem z `landuse=railway` i korytarzami torów. Punkt wyjścia: §1 i §5 audytu
[non-residential-audit-2026-11-08](non-residential-audit-2026-11-08.md).

## Wniosek

`tools/poz-blocks.mjs` po wycięciu terenów kolejowych przywraca teraz komórki pod obrysami budynków kolejowych,
powiększone o `SIDEWALK`. Na snapshocie 2026-10-28 daje to **9 wysp i 19 098 m²** kwartałów. Hala zajezdni Głogowska
przestała być skrawkiem bez działek, a LCS Poznań Główny i Dworzec Letni po raz pierwszy mają własne kwartały.

| Obiekt | Kwartał przed | Kwartał po | Pole | Działki | Generacja | Pokrycie obrysu | h |
|---|---|---:|---:|---:|---:|---:|---:|
| Hala zajezdni Głogowska | #1254 | **#1250** | 1 176 → **8 196 m²** | 0 → **13** | 0 → **820 m²** | **0 → 50 %** | 23 m |
| LCS Poznań Główny PoA | brak | **#1003** | **2 152 m²** | **4** | **284 m²** | **0 → 13 %** | 23 m |
| Dworzec Letni | brak | **#804** | **416 m²** | 0 | 0 | 0 % | — |
| Dworzec kolejowy Poznań Garbary | brak wg centroidy | #361 (istniejący) | 25 574 m² | 28 | 3 520 m² | 0 % | 23 m |
| Stary Dworzec Główny | brak | **#880** | **8 325 m²** | 10 | 0 (rezerwa landmarku) | 0 % | — |
| Dworzec Poznań Główny | #847 | #848 | 476 043 → 479 510 m² | 50 | 110 824 m² | 0 % (landmark) | 20 m |

Audyt po zmianie ma **2 puste kwartały ≥ 1 500 m²** zamiast 3: #880 (Stary Dworzec, poprawnie pusty jako landmark) i
#575 (Collegium Maius, również landmark). Zniknął #1254. Obiektów ≥ 800 m² bez żadnego kwartału jest **4** zamiast 6
(Andersia Tower, Andersia Business Centre, Poznańskie Centrum Finansowe i Społem); LCS i Stary Dworzec są już
przypisane. 67 obrysów w boxie nie ma wygenerowanego budynku nad sobą (było 68), 344 są pokryte częściowo (było 343),
49 jest zastąpionych całą bryłą (bez zmian).

## Implementacja

W `tools/poz-blocks.mjs` importowane są obrysy z `tools/data/poz_buildings.json` (`load`, `elemRings`, `toWorld`).
Kolejność:

1. **Klasyfikacja.** Kandydatem jest budynek z `building=train_station|transportation|station|railway_station|
   bus_station|engine_shed`, dowolnym tagiem `railway=*` (np. `railway=signal_box` LCS) albo nazwą zawierającą
   `dworzec|zajezdni|parowozownia|lokomotywownia|pkp|kolejow|zntk|bocznica|nastawni|signal box|centrum sterowania`.
   `building=roof` i `building=no` są pomijane, tak jak w `poz-buildings.mjs`.
2. **Tylko komórki wycięte przez kolej.** Przed stemplowaniem `landuse=railway` i korytarzy torów powstaje kopia
   rastra. Po stemplowaniu zostają w niej wyłącznie komórki, które były budowalne i zostały wycięte właśnie przez
   kolej. Dzięki temu przywrócenie budynku nie otwiera komórki drogi, wody ani innej wcześniejszej przeszkody.
3. **Obrys + `SIDEWALK`.** Obrys jest rasteryzowany lokalnie (zewnętrzne pierścienie minus dziury) i rozszerzany o
   `SIDEWALK` 4,6 m przez EDT, jak dziury placów. Wyspa dostaje więc linię własności 4,6 m od ściany.
4. **Bufor od torów.** Korytarz torów jest stemplowany osobno: pół szerokości z `railCorridors.lines` plus 1 m, czyli
   3,5 m od osi toru kolejowego i 3,0 m od osi toru tramwajowego. Bufor ogranicza tylko margines `SIDEWALK`; sam
   obrys budynku wraca w całości, bo hala zajezdni przykrywa tory na swojej posesji.
5. **Wyspa, nie most.** Komórka marginesu, która dotykałaby istniejącego kwartału, nie jest przywracana (jednokomórkowa
   przerwa). Tylko obrys budynku może połączyć się z istniejącym kwartałem, gdy stacja stoi przy samej ulicy. Bez tego
   kolejowe „łaty” sklejały dwa kwartały przez wąski pas terenu kolejowego i zmieniały ich udział parku.
6. **Etykietowanie i działki.** Przywrócone komórki wchodzą do zwykłego 4-spójnego etykietowania, konturu, erozji
   `SIDEWALK`, `lotRects` i `blockFrames`. Nie powstał żaden nowy format `GEO`; `blockStats` liczy je tak samo jak
   każde inne kwartały.

## Wynik szczegółowy

### Hala zajezdni Głogowska

- Przed: kwartał #1254, 1 176 m², 0 działek, 0 m² generacji, obrys 0,66 ha w OSM i 68 % realnego built.
- Po: kwartał #1250, 8 196 m², 13 działek, 820 m² generacji, 23 m wysokości, 50 % obrysu pod wygenerowanymi
  budynkami. To nadal profil dzielnicy (Łazarz), nie `DEPOT` — ten pozostaje w [backlogu](../backlog.md).
- Tory wewnątrz hali są przywracane razem z obrysem; margines `SIDEWALK` zatrzymuje się 3,5 m od osi toru.

### LCS, Letni i Garbary

- **LCS Poznań Główny PoA** (way 187916018, `railway=signal_box`) to nowa wyspa #1003: 2 152 m², 4 działki, 284 m²
  generacji. Wcześniej obiekt nie miał kwartału.
- **Dworzec Letni** (way 263320508, 162 m² obrysu) ma teraz kwartał #804 (416 m²), ale **0 działek**: po erozji
  `SIDEWALK` z 14 × 17 m obrysu zostaje pas węższy niż 8 m minimalnego boku działki. To ograniczenie skali obiektu,
  nie brak kwartału. Jest to jedyny z nazwanych dworców bez generacji.
- **Poznań Garbary** (way 680343992) leżał przy istniejącym kwartale #361 i po przywróceniu jest do niego przypisany
  (28 działek, 3 520 m² generacji w kwartale), ale sam obrys stacji ma 198 m² i nie dostaje własnej działki. Kwartał
  istnieje i generuje; pokrycie samego budynku stacji pozostaje 0 %.
- **Stary Dworzec Główny** ma własną wyspę #880 (8 325 m², 10 działek), ale generacja jest poprawnie zerowa: to
  rezerwa modelu landmarku.

### Dworzec Główny i Zachodni

- Dworzec Główny był już w kwartale #847; przywrócenie obrysu powiększyło go o 3 467 m² do #848 (479 510 m²).
  Generacja i pokrycie bez zmian (23,1 % kwartału; budynek stacji jest landmarkiem).
- Dworzec Zachodni nie wymagał zmiany: miał kwartał #838/#839 i 69 % pokrycia obrysu.

## Weryfikacja

- `node --test tests/*.cjs`: **429/429 pass**.
- `node --test tests/geodata.test.mjs`: **pass** (przebudowa odtwarza `js/geodata.js` co do bajtu).
- `node tools/audit-nonresidential.mjs`: 2 puste kwartały ≥ 1 500 m² (oba landmarki), 4 obiekty ≥ 800 m² bez
  kwartału; hala Głogowska ma 50 % pokrycia i 820 m² generacji.
- `js/geodata.js`: 2 592 307 B, 1 418 kwartałów i tyle samo `blockStats` (przed zmianą 1 422). Spadek liczby o 4
  wynika z połączeń wysp z istniejącymi kwartałami; 9 nowych wysp nie wszystkie są osobnymi komponentami.

## Skutki dla testów i ID

Przywrócenie komórek zmieniło kolejność etykiet componentów, więc część numerycznych ID przesunęła się o 1–5.
Zaktualizowane zostały stałe w testach (mapowanie po geometrii, nie po samym numerze):

| Stare ID | Nowe ID | Miejsce |
|---:|---:|---|
| 814 | 815 | gęsty kwartał kampusowy |
| 827 | 828 | Szpital Kliniczny |
| 1101 | 1104 | park Rataje |
| 1299 | 1295 | park |
| 1304 | 1300 | Chartowo / Krzywoustego |
| 1356 | 1352 | park |
| 1370 | 1366 | park |
| 1273 | 1270 | park przy Skromnej |
| 885 | 887 | Tysiąclecia |
| 966 | 968 | Park Nad Wartą / Wioślarska |

Zmieniły się też liczniki zależne od kwartałów: street trees 18 101 → **18 092**, lampy side LED
12 512 → **12 507**, wszystkie lampy 18 618 → **18 613**, rozkład gatunków drzew i skróty geometrii
(`siteHash`, `propColliders`, `details.colliders`) — wszystkie piny zaktualizowane w testach.

## Ograniczenia

- To nie jest profil `DEPOT`: hala Głogowska dostaje morfologię Łazarza (23 m, kamienice/osiedle), nie halę zajezdni.
  Wyspa zapewnia działki i generację, ale nie właściwą bryłę.
- Dworzec Letni i obrys Garbarów są za małe na działkę przy `SIDEWALK` 4,6 m; nie zmniejszano globalnego progu
  8 m, żeby nie tworzyć drobnych działek w innych kwartałach.
- Tereny `landuse=railway` poza obrysami budynków nadal nie mają kwartałów — to zamierzone.
- Nie sprawdzano wyglądu w przeglądarce; zmiana dotyczy wyłącznie geodaty i generowanych kwartałów.
