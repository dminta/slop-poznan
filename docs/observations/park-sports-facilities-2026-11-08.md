# Obiekty sportowe w parkach — 2026-11-08

Zakres: hale widowiskowo-sportowe, stadiony, lodowiska i obiekty publiczne, które stoją na terenach zielonych
(`GEO.parks`) i były bezwzględnie czyszczone przez `parkFreeCells` w `js/city-config.js`. Celem było przywrócenie
im działek i kubatury bez zabudowywania parków, w których OSM nie mapuje żadnego budynku.

Materiał: `tools/data/poz_buildings.json` (OSM, 2026-10-28), `GEO.blocks` / `GEO.blockStats`, `tools/poz-blocks.mjs`,
`tools/poz-buildings.mjs`, `js/city-config.js`, `js/buildings.js`. Pomiar pokrycia: ten sam raster 2 m i harness
`tests/helpers/module.cjs`, co w `tests/buildings-density.test.cjs`.

## Problem

Audyt niemieszkalny (`non-residential-audit-2026-11-08.md`, §4 i §6) pokazał dwa obiekty sportowe z 0 % pokrycia:

| Obiekt | OSM | Kwartał | Obrys OSM | Pokrycie przed |
|---|---|---:|---:|---:|
| Hala Arena (Park Kasprowicza) | way 279682863 | 925 | 7 843 m² | 0 % |
| Enea Stadion (ul. Bułgarska) | relation 8512283 | 937 | 52 909 m² | 0 % |
| Lodowisko Chwiałka (POSiR) | way 183357024 | 937 | 3 389 m² | 4 % |

Przyczyna nie była brakiem danych: obrysy są w snapshocie, a kwartały #925 (11 % realnego built) i #937 (17 %)
istnieją. `parkFreeCells` dzielił każdy prostokąt działki na komórki 20 m i wyrzucał wszystkie, których środek lub
dwa narożniki leżały w parku. Arena i stadion stoją w parku i na `leisure=pitch`, więc zostawał po nich pusty
trawnik. `GEO.blockStats` nie przenosił też żadnego obrysu do runtime — były tylko liczby (udział, kondygnacje,
liczba budynków, program), bez współrzędnych.

## Rozwiązanie

1. **Dane** — `tools/poz-buildings.mjs` emituje nowy klucz `GEO.blockFootprints`:
   `{ block id: [[x0, x1, z0, z1, area], ...] }`. Zawiera wyłącznie obrysy obiektów sportowych, widowiskowych i
   publicznych (co najmniej 150 m²) w kwartałach z jakimkolwiek udziałem parku. Klasyfikacja: `leisure=stadium|`
   `sports_hall|sports_centre|arena|ice_rink|water_park|…`, `building=stadium|public|civic|museum|theatre|…`,
   `amenity` kulturalne, `sport=*`, nazwa (Stadion, Arena, Lodowisko, Pływalnia, Termy, Muzeum, Teatr, Targi…) oraz
   `addr:street=Termalna` (Termy Maltańskie). Piąta liczba to pole OSM, dzięki czemu runtime zwęża prostokąt do
   rzeczywistego obrysu (owalny stadion wypełnia ok. 76 % swojego bbox).
   Skala: **86 obrysów w 46 kwartałach, 3 KB** w `js/geodata.js`.
2. **Podział działek** — `js/city-config.js` czyta `BLOCK_FOOTPRINTS`, dokłada je do `BLOCKS[i].parkFootprints`,
   a `parkFreeCells(x0, x1, z0, z1, xf, parkFootprints)`:
   - zamienia obrys obiektu na działkę w lokalnej ramce kwartału (`facilityEnvelope` + `footprintInFrame`),
     obcina ją do prostokąta działki i oznacza `facility`;
   - odejmuje tę działkę od reszty kwartału (`subtractRect`), także gdy prostokąt działki leży poza parkiem —
     stadionowe ramki obejmują bowiem i murawę, i zwykłą ulicę;
   - resztę parku nadal dzieli na komórki 20 m i czyści do trawnika. Czysto niezamapowane parki pozostają puste.
3. **Zabudowa** — `js/buildings.js` przekazuje `facility` do `populateBlock`, który wybiera `facilityBlock`:
   jedna hala wypełnia obrys (wcięta 2–8 m), 3–5 kondygnacji z mediany `building:levels` kwartału (Wilda: 3) plus
   jedna dla działki powyżej 12 000 m², płaski dach z urządzeniami. Zamiast szeregu kamienic powstaje bryła
   o wysokości 12–16 m. `blockLots` (drzewa w `city-grid.js`) korzysta z tych samych działek, więc pnie nie wchodzą
   w obrys hali.

## Wyniki

Pomiar pokrycia obrysu OSM (komórki 2 m pod wygenerowanym budynkiem, nie landmarkiem):

| Obiekt | Kwartał | Pokrycie przed | Pokrycie po | Wysokość generacji |
|---|---:|---:|---:|---:|
| Hala Arena | 925 | 0 % | **74,0 %** | 12,3 m |
| Enea Stadion | 937 | 0 % | **67,4 %** | 16,4 m |
| Lodowisko Chwiałka | 937 | 4 % | **65,2 %** | 12,3 m |

Kwartał #937 (Wilda) ma 42,2 ha. Generacja wzrosła z 7,8 % do 20,9 % (realny built 17,0 %); różnica to głównie
prostokąt stadionu (6,95 ha bbox vs 5,29 ha obrysu) oraz sąsiednie obrysy POSiR/AWF. Kwartał #925 wzrósł z 11,0 %
do 14,3 % (realny built 11,0 %) — przede wszystkim Arena i jej bezpośrednie otoczenie. Pozostałe parki z mapped
budynkami (Sołacz, Chartowo, parki osiedlowe) nie zmieniły profilu: `blockFootprints` zawiera tylko obiekty
sportowe/publiczne, a nie każdy budynek w parku. Testy dzielnic (Sołacz, Winiary, Ogrody, Grunwald Południe,
Warszawskie-Pomet-Maltańskie, Chartowo) nadal mieszczą się w ±20 % realnego built.

### Kolizje na #937

- Działki facility są obcinane do prostokątów własności kwartału (`b.rects` / `b.frames`), czyli do linii 4,6 m
  od krawężnika; hala wchodzi najwyżej do tej linii, nie na jezdnię.
- `parkFreeCells` odejmuje obrys od reszty kwartału (`subtractRect`), więc nie ma podwójnej generacji: ani hala na
  zwykłej działce, ani kamienice w hali.
- `blockLots` zwraca te same działki dla `city-grid.js`, więc parkowe drzewa i latarnie omijają obrys hali.
- Nowy test `park facility halls on 925/937 do not overlap each other or a roadway` bierze części o polu
  ≥ 2 000 m² (7 dużych części: 2 Arena, 3 Enea, 2 Chwiałka) i sprawdza SAT-em, że żadne dwie się nie nachodzą, a
  każdy narożnik ma `roadClearance >= 0`. Pomiar: 7 części, 0 par nachodzących, 0 narożników w jezdni.
- Test `park sports facilities keep their mapped OSM footprint` sprawdza pokrycie i wysokość (8–25 m).

## Testy

- `node --test tests/buildings-density.test.cjs` — 10/10, w tym test trzech obiektów, test kolizji hal i istniejące
  progi dzielnic oraz „unmapped park stays empty”.
- `node --test tests/geodata.test.mjs` — świeży build `tools/` musi być bajt w bajt równy `js/geodata.js`; test
  sprawdza też, że `GEO.blockFootprints` zawiera obrysy Hali Arena (7 843 m²) i Enea Stadion (52 909 m²).
- `node --test tests/` — **445/445**, 91,1 s (bez pominiętych i anulowanych).

## Sprawdzenie w przeglądarce

Chrome 157 (headless, macOS, `three@dev` z jsDelivr), serwer `python3 -m http.server 8000`, CDP z sondą
`navigator.gpu.requestAdapter` i `HTMLCanvasElement.getContext`. Domyślny adres i `?backend=webgl`:

| Backend | `requestAdapter` | Konteksty WebGL2 | `loading` | Canvas | FPS | Błędy / ostrzeżenia / wyjątki |
|---|---:|---:|---|---:|---:|---|
| WebGPU (domyślny) | tak, adapter obecny | 0 | usunięty | tak | 60 | 0 / 0 / 0 |
| WebGL2 (`?backend=webgl`) | nie | 1 | usunięty | tak | 52 | 0 / 0 / 0 |

Obie ścieżki zbudowały miasto (`[init] ... compile 1095/1816 ms, warmup 419/3554 ms`) i wyrenderowały pierwszą
klatkę. `[cityGrid] 301 benches, 2974 lampposts, 31944 park & plaza trees; 35357 player colliders` potwierdza, że
nowe hale weszły do koliderów. To sprawdzenie nie jest przeglądem wizualnym sylwety #937 z lotu ptaka; pokrycie
i kolizje mierzy harness 2 m opisany wyżej.

## Pliki

- `tools/poz-buildings.mjs` — klasyfikacja obiektów, `blockFootprints`, pole OSM.
- `tools/build-poznan.mjs` — nowy klucz `GEO`.
- `js/geodata.js` — przebudowany (3 KB nowego klucza).
- `js/city-config.js` — `BLOCK_FOOTPRINTS`, `facilityEnvelope`, `footprintInFrame`, `subtractRect`, `parkFreeCells`.
- `js/buildings.js` — przekazanie `parkFootprints`, `facilityBlock`.
- `tests/buildings-density.test.cjs`, `tests/geodata.test.mjs` — regresje.
- `docs/world.md`, `docs/geodata.md`, `docs/backlog.md` — opis i zamknięcie zadania.
