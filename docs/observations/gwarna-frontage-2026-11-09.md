# Gwarna frontage — 2026-11-09

Zgłoszenie „na Gwarnej zniknęła część kamienic” dotyczyło zachodniej pierzei (numery nieparzyste 3–13A, block 648)
oraz wschodniej strony przy Gwarnej 6/8 (block 687). Pomiar headless (`buildCityBlocks` przez
`tests/helpers/module.cjs`) pokazał przed poprawką:

- zachodnia pierzeja: **33,6 %** pokrycia pasa 10–30 m od osi, a na odcinku z 20–95 **0 %**; ocalały tylko budynki
  przy z ≈ 96–139,
- wschodnia pierzeja: **43,2 %**, z luką przy Gwarnej 6/8 (z ≈ 52–86).

## Przyczyny

1. **Rezerwat obiektów OSM czytany jak AABB.** `minusReserves()` w `js/buildings.js` robiło
   `srcAnchors.concat(srcObjects).map(inFrameRect)`. Zakotwiczenia (`blockAnchors`) mają układ
   `[x0, x1, z0, z1, ...]`, ale obiekty (`blockObjects`) mają `[cx, cz, w, d, ang, ...]`. Dla obiektu 648
   (szkoła, 78,8 × 44,8 m przy `-949,2, 95,8`) pierwsze cztery wartości odczytane jako prostokąt dały rezerwat
   `x -948,9…+84,5`, `z -143,0…83,3` w ramce pierzei. Wyciął on całą zachodnią linię zabudowy od z 24 do 83.
   Poprawka: obiekty przechodzą przez `objectBounds(o)` przed `inFrameRect`.
2. **Fallback odrzucany po surowym bboxie.** `tools/poz-buildings.mjs` sprawdzał `fallbackOffStreets(b.inBoxBox)`.
   Budynek Gwarenna 6/8 (537 m²) ma raster bbox 27 × 34 m, którego zachodnia krawędź wchodzi w 10,5 m korytarz
   jezdni, choć po zmniejszeniu do rzeczywistej powierzchni (`fallbackEnvelope`, 20,7 × 26 m) stoi już 4,5 m od osi
   poza jezdnią. Fallback był więc odrzucany, a generyczne działki block 687 zaczynały się ~15 m od linii zabudowy.
   Poprawka: test czystości drogowej używa tego samego zmniejszonego prostokąta, który buduje runtime. Test
   `tests/geodata.test.mjs` sprawdza ten sam zmniejszony prostokąt wobec ulic pieszych.

## Wynik

Po obu poprawkach (`node tools/build-poznan.mjs`, 2026-11-09):

| pierzeja | przed | po |
| --- | ---: | ---: |
| zachód, cała Gwarna (10–30 m) | 33,6 % | **78,8 %** |
| zachód, z 20–95 | 0 % | **85,7 %** |
| wschód, cała Gwarna | 43,2 % | **52,7 %** |
| wschód, z 50–120 | — | **70,4 %** |

Wygenerowane budynki w promieniu testowym zachowują `roadClearance ≥ 2,54 m` i `pedestrianClearance ≥ 0`; Gwarna
nie ma torowiska (`GEO.rail` nie ma tam odcinka tramwajowego), więc dodatkowy warunek szynowy nie jest potrzebny.
`GEO.blockFallbackLots` wzrosło z 1 064 działek w 284 kwartałach do **1 236 w 325** (334 odrzucone), bo 172 rzeczywiste
budynki, których bbox dotykał krawędzi jezdni, przeszły test po zmniejszeniu. Zmiana ruszyła collidery drzew:
34 478 → 34 498 drzew ulicznych i 25 566 → 25 824 mapowanych drzew parkowych; piny w
`tests/street-tree-colliders.test.cjs` i `tests/tree-distribution.test.cjs` zostały zaktualizowane.

## Testy

- `tests/buildings-density.test.cjs` — nowy test „Gwarna keeps a dense frontage on both sides and no building reaches
  its roadway” mierzy pokrycie pasa po obu stronach, próg dla zachodu z 20–95 i brak wejścia w jezdnię/ulicę pieszą.
- `node --test tests/buildings-density.test.cjs` — 16/16.
- `node --test tests/geodata.test.mjs` — 1/1 (przebudowa odtwarza `js/geodata.js` bajt w bajt).
- `node --test tests/*.cjs` — 464/464 po aktualizacji pinów drzew.
