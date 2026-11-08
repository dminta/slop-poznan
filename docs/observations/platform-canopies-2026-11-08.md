# Zadaszenia peronów, stacji i wiaty (building=roof) — 2026-11-08

Zakres: Zadanie 4 z audytu [zabudowy niemieszkalnej](non-residential-audit-2026-11-08.md) (§E i §9). Snapshot OSM
`poz_buildings.json` z 2026-10-28 ma **1 038** elementów `building=roof`: zadaszenia peronów Poznań Główny, Dworzec
Zachodni, Dworzec Letni, wiaty przystankowe, zadaszenia stacji paliw i myjni oraz zwykłe pergole i daszki. Generator
`tools/poz-buildings.mjs` celowo pomijał je w masie zabudowy (nie mają ścian), więc perony i stacje były „gołe”, a
wiarygodne dachy znikały razem z nimi.

## Co zmieniono

1. **Ekstrakcja** — nowy `tools/poz-canopies.mjs` czyta te same obrysy `building=roof`, ale nie wrzuca ich do
   `blockStats`. Dla każdego pierścienia zewnętrznego liczy pole i dopasowuje **zorientowany prostokąt o minimalnym
   polu**. Do `GEO.canopies` trafiają wpisy:
   `{ x0, x1, z0, z1, h, clearance, kind, cx, cz, w, d, ang, area, columns }`.
   `h` to wierzch płyty, `clearance` jej spód, a `columns` to gotowa siatka słupów w metrach świata.
2. **Filtrowanie** — minimum **60 m²** na pierścień, środek w detail boxie. Prostokąty, które rozdymają obrys ponad
   **2,4×**, są odrzucane, chyba że to peron, przystanek tramwajowy, stacja paliw albo hala targowa. Efekt: 828
   pierścieni poniżej 60 m², 11 zbyt nieregularnych, 1 bez czystego słupa i 41 poza boxem; zostaje **157 zadaszeń**.
3. **Klasyfikacja** — `kind` z tagów OSM i odległości od toru/przystanku: `platform` (12), `tram` (3), `fuel` (10),
   `market` (0), `shelter` (0), `roof` (132). Snapshot nie ma `building=roof` hali targowej — hale targowe są w nim
   zwykłymi budynkami ze ścianami — więc `market` nie ma rekordów. Wiaty przystankowe poniżej 60 m² też zostały poza
   zbiorem; obsługuje je istniejąca infrastruktura przystankowa.
4. **Wysokości i skrajnia** — spód płyty **4,5–5,6 m**, wierzch **4,8–6,2 m** (całość w zadanym paśmie 4,5–6,5 m).
   Perony kolejowe: spód 5,0 m / wierzch 5,4 m; tramwajowe 4,8 / 5,2; stacje paliw 4,6 / 5,0; pozostałe 4,6 / 5,0.
   Dach jest powyżej 4,3 m skrajni pociągu/tramwaju i 1,9 m pieszego.
5. **Słupy** — 0,4 m kwadratowe, w dwóch lub trzech rzędach wzdłuż długiego boku, rozstaw 6–8 m, 0,7 m od krawędzi.
   Kandydat w odległości **< 2,6 m** od osi dowolnego toru (`GEO.rail`, kolej i tramwaj) jest pomijany. Po zaokrągleniu
   danych najbliższy słup ma **2,57 m** od osi toru; przy połowie szerokości pociągu/tramwaju 1,5 m zostaje ponad 1 m
   wolnej przestrzeni. Zadaszenie, które nie zachowa żadnego słupa, nie jest emitowane (1 taki przypadek).
6. **Rendering** — nowy `js/canopies.js` buduje pod korzeniem `Canopies` cztery rodziny instancjonowane: płyty dachowe,
   słupy betonowe (perony), słupy stalowe (reszta) i dwie belki krawędziowe na zadaszenie. Płyta to pudełko
   `w × (h − clearance) × d` obrócone o `rotation.y = −ang`; słupy stoją od ziemi do `clearance`. Kolizje to tylko
   słupy (pełna wysokość) i płyta (od `clearance` w górę): samochody, tramwaje i piesi przechodzą pod spodem, a kamera
   lotnicza nie przenika dachu. Grupa wchodzi do `setupSceneCulling` razem z `CityGrid`, `CityBlocks` itd.
7. **Dokumentacja i testy** — `docs/geodata.md`, `docs/world.md`, `docs/backlog.md`; testy w `tests/geodata.test.mjs`
   (obecność, geometria, wysokości, peron Głównego, paliwa) i nowy `tests/canopies.test.cjs` (skrajnia słupów względem
   `GEO.rail`, liczba instancji i kolizji).

## Wynik ilościowy (2026-10-28)

| Grupa | Szt. | Pole obrysu | Uwagi |
|---|---:|---:|---|
| `platform` | 12 | 1,34 ha | Główny: 5 zadaszeń do 364 m długości; Dworzec Letni; Garbary |
| `tram` | 3 | 0,42 ha | m.in. dwie duże wiaty zajezdni Franowo |
| `fuel` | 10 | 0,15 ha | stacje paliw i myjnie |
| `roof` | 132 | 3,56 ha | pergole, pawilony zoo, dachy magazynowe i inne otwarte daszki |
| **Razem** | **157** | **5,47 ha** | 1 935 słupów |

Największe zadaszenia peronowe (środek `cx, cz`, długość × szerokość):

| Obiekt | x, z | w × d | Spód / wierzch |
|---|---|---:|---:|
| Poznań Główny, peron | −1580,5 / 800,3 | 364,1 × 9,9 m | 5,0 / 5,4 m |
| Poznań Główny, peron | −1603,7 / 826,7 | 243,8 × 9,8 m | 5,0 / 5,4 m |
| Poznań Główny, peron | −1612,1 / 1060,4 | 207,9 × 6,4 m | 5,0 / 5,4 m |
| Poznań Główny, peron | −1555,4 / 774,6 | 157,0 × 10,1 m | 5,0 / 5,4 m |
| Poznań Główny, peron | −1627,9 / 851,9 | 113,0 × 17,8 m | 5,0 / 5,4 m |
| Dworzec Letni | −1479,1 / 392,0 | 90,6 × 9,7 m | 5,0 / 5,4 m |
| Garbary | 228,3 / −860,0 | 84,8 × 7,2 m | 5,0 / 5,4 m |

## Weryfikacja

```bash
node --max-old-space-size=8192 tools/build-poznan.mjs
node --test tests/*.cjs
node --test tests/geodata.test.mjs
```

- Build: `canopies: 157 canopies / 5.47 ha, 1935 columns`; `GEO.canopies` zajmuje 50 KB z 2,65 MB pliku.
- `tests/canopies.test.cjs`: minimalna odległość słupa od osi toru **2,57 m**, 1 935 słupów, 1 935 kolizji słupów +
  157 kolizji płyt, brak wyjątków.
- `tests/geodata.test.mjs`: świeży build jest bajt w bajt równy commitowanemu `js/geodata.js`; obecne są 12 zadaszeń
  peronowych i 10 paliwowych, w tym długi peron Głównego.
- Pełny `node --test tests/*.cjs` przechodzi (wynik w commicie).

## Ograniczenia

- To nadal **prostokąty**, nie dokładne wielokąty OSM. 149 z 210 dużych obrysów mieści się w 15 % pola prostokąta;
  nieliczne nieregularne perony/stacje paliw są aproksymowane prostokątem, a zwykłe nieregularne pergole odrzucone.
- Słupy są rozmieszczane na siatce, a nie na rzeczywistych fundamentach z OSM. Kryterium 2,6 m od osi toru jest
  konserwatywne, ale nie odwzorowuje projektowego skrajni danego peronu.
- `building=roof` poza detail boxem (41 pierścieni) nie jest renderowane; dotyczy to m.in. części peryferyjnych stacji.
  Pętla PST **Os. Sobieskiego** leży poza detail boxem (52.383–52.434 N) i poza padded boxem snapshotu
  (52.380–52.437 N), więc nie ma jej w `poz_buildings.json`; to ograniczenie zasięgu danych, nie filtr generatora.
- Dach jest płaski; `roof:shape=skillion` i inne kształty nie są odwzorowane.
- **Brak weryfikacji w przeglądarce.** Nie sprawdzono cieni, z-fightingu belek z płytą, kolizji gracza przy słupach ani
  przejazdu tramwaju/pociągu pod dachem na WebGPU i WebGL2. To pozostaje w [backlogu](../backlog.md).
