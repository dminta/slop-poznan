# Building density investigation — 2026-11-08

Śledztwo w sprawie kwartałów, w których generowana zabudowa jest nadal zbyt rzadka względem rzeczywistych
footprintów OSM. Punktem wyjścia był ten sam headless raster co w
[building-density-2026-11-07](building-density-2026-11-07.md), [central-density-2026-11-08](central-density-2026-11-08.md)
i [office-courtyards-2026-11-08](office-courtyards-2026-11-08.md), rozszerzony o pomiar działek i rezerwatów.

## Metoda i definicje

Narzędzie: `tools/density-report.mjs` (`node tools/density-report.mjs --top 30 [--json out.json]`). Ładuje
`js/buildings.js` przez `tests/helpers/module.cjs` z tymi samymi stubami three.js/TSL co
`tests/buildings-density.test.cjs`, uruchamia `buildCityBlocks()`, a następnie rasteryzuje footprinty na siatce 2 m
w `CITY_BOUNDS`. Jedna komórka jest liczona raz, dla kwartału pod jej środkiem.

Kolumny:

- **OSM real** — `GEO.blockStats[i][0] * BLOCKS[i].area` (udział powierzchni wyspy pod footprintami OSM).
- **generated** — suma ground footprintów z `buildCityBlocks` na rastrze, podzielona przez `BLOCKS[i].area`.
- **rects** — surowe `BLOCKS[i].rects` / `frames` (po erozji chodnika 4,6 m w `tools/poz-blocks.mjs`), mierzone
  próbkowaniem 2 m wewnątrz poligonu kwartału.
- **reserve** — część `rects` pokryta rezerwatami landmarków z `js/buildings.js` (`LANDMARK_RESERVE`, AABB + 3 m).
- **lots** — efektywne kawałki z `city-config.blockLots()`: po `parkFreeCells`, `splitDeep` i filtrze `minLot`
  (12 m dla frontage frames, 15 m dla zwykłych rectów).
- **fill** — `generated / lots` (jak szczelnie zabudowane są działki, które generator w ogóle widzi).
- **target** w analizie TOP-30 — `OSM real / lots`, czyli wymagane wypełnienie działek, żeby osiągnąć realny
  udział całej wyspy.

Dwie korekty względem strict harnessu testowego:

1. `blockAt()` zwraca pierwszy kwartał w komórce siatki 64 m i nie zna dziur w poligonie. Kwartał 887 (85 ha,
   pierścień wokół 913) przejmował footprinty wewnętrznej wyspy 913. Raport przypisuje komórkę do **najmniejszego**
   poligonu, który ją zawiera. Różnica netto to tylko 3 028 m², ale 887 spada z 8,2% na 7,5% (69 808 →
   64 012 m²), a 913 dostaje swoje 5 796 m² zamiast 0.
2. `blockAt()` celowo pomija komórki pod `roadCut` / `tramCut`; poprawka włącza je, jeśli punkt jest wewnątrz
   poligonu kwartału. Dotyczy m.in. zajezdni 1250: 4 004 m² ground footprintu po korekcie zamiast 980 m² w strict
   rastrze (suma wszystkich parts to 6 541 m², część pokrywa się z sąsiednimi komórkami).

Zakres: 784 buildable kwartały (te same co w `districtShares` testu: bez `park > 0.6 && !buildings`, bez `median`,
z OSM built > 0), 3 687,5 ha. Pozostałe 634 z 1 418 kwartałów to parki bez zabudowy, pasy drogowe i szczątki.

## Wynik zbiorczy

| miara | wartość |
| --- | ---: |
| buildable kwartały | 784 |
| powierzchnia | 3 687,5 ha |
| OSM real | 18,1% |
| generated | 19,7% |
| generated / real | 1,087 |
| bilans netto | **+580 638 m²** (generator buduje więcej niż OSM) |
| kwartały poniżej OSM | **358** |
| suma dodatnich braków | **628 008 m²** |
| kwartały powyżej OSM | 425 |
| suma nadwyżek | 1 208 646 m² |
| TOP-10 braków | 250 732 m² |
| TOP-30 braków | **404 992 m²** (65% wszystkich braków) |

To nie jest więc ogólny niedobór miasta, tylko **zła alokacja**: 425 kwartałów jest przepełnionych (głównie wille
i kamienice), a 358 jest niedobudowanych. Największe deficyty są skupione: TOP-30 odpowiada za 65% brakujących m².

Dodatkowe twarde sufity:

- **52 kwartały** mają `OSM real > lots`; nawet 100% zabudowy działek nie osiągnie realu. Brakuje tam 80 028 m².
- **47 kwartałów** ma `lots = 0` przy realnej zabudowie (głównie drobne wyspy i 875); brakuje 34 246 m².
- **7 kwartałów** to rezerwaty landmarków (`reserve ≥ 25%`), łącznie 35 455 m² braku — budowane przez
  `landmarks*.js`, nie przez generator.

## Per dzielnica

Buildable kwartały, udziały liczone od powierzchni wysp.

| dzielnica | kwartały | area ha | OSM real | generated | gen/real | missing m² |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Stare Miasto | 133 | 306,6 | 31,7% | 29,4% | 0,928 | 70 141 |
| Antoninek-Zieliniec-Kobylepole | 6 | 186,4 | 7,0% | 5,4% | 0,774 | 29 581 |
| Nowe Winogrady Południe | 35 | 73,3 | 18,3% | 15,8% | 0,867 | 17 748 |
| Chartowo | 19 | 159,5 | 13,5% | 12,6% | 0,930 | 15 060 |
| Żegrze | 16 | 21,8 | 16,6% | 13,8% | 0,832 | 6 091 |
| Sołacz | 38 | 295,2 | 9,2% | 9,0% | 0,980 | 5 302 |
| Grunwald Południe | 13 | 45,2 | 13,2% | 12,2% | 0,920 | 4 753 |
| Stary Grunwald | 11 | 42,5 | 22,6% | 22,4% | 0,991 | 821 |
| Nowe Winogrady Wschód | 4 | 3,3 | 18,1% | 18,7% | 1,035 | −204 |
| Winiary | 23 | 94,5 | 17,0% | 17,2% | 1,012 | −1 890 |
| Grunwald Północ | 7 | 10,0 | 19,3% | 22,0% | 1,142 | −2 750 |
| Ogrody | 13 | 88,1 | 16,2% | 17,2% | 1,064 | −9 065 |
| Górczyn | 18 | 57,9 | 21,8% | 27,5% | 1,259 | −32 746 |
| Warszawskie-Pomet-Maltańskie | 64 | 376,1 | 12,6% | 13,5% | 1,073 | −34 648 |
| Ostrów Tumski-Śródka-Zawady-Komandoria | 41 | 183,8 | 12,7% | 15,4% | 1,208 | −48 550 |
| Wilda | 69 | 342,1 | 20,5% | 22,4% | 1,093 | −65 245 |
| Rataje | 54 | 421,9 | 14,8% | 16,3% | 1,107 | −66 752 |
| Główna | 29 | 288,5 | 18,7% | 21,4% | 1,141 | −75 971 |
| Jeżyce | 51 | 169,4 | 31,4% | 37,2% | 1,183 | −97 666 |
| Stare Winogrady | 46 | 213,5 | 16,6% | 22,6% | 1,362 | −128 129 |
| Łazarz | 94 | 308,0 | 27,5% | 32,9% | 1,197 | −166 519 |

Dzielnice z największym **bezwzględnym** brakiem to Stare Miasto (−70,1 tys. m²), Antoninek (−29,6 tys., głównie
park 875) i Nowe Winogrady Południe (−17,7 tys.). Jednocześnie Stare Winogrady, Łazarz i Jeżyce są mocno
przepełnione, co maskuje ich własne niedobudowane kwartały (np. 98 w Starych Winogradach).

## TOP-30 kwartałów z największym bezwzględnym deficytem

`rects`, `reserve`, `lots`, `fill` jak w metodzie; `target` = wymagane wypełnienie działek (`real / lots`), wartości
> 100% oznaczają, że realna zabudowa stoi częściowo poza działkami (park, landmark, plac).

| # | id | dzielnica | typ | area ha | OSM | gen | gen/real | missing m² | rects | reserve | lots | fill | target | przyczyna |
| ---: | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | 887 | Rataje | kamienice/średniowysokie | 85,00 | 15,0% | 7,5% | 0,502 | 63 494 | 51,4% | 0% | 36,9% | 20,4% | 40,6% | E+K |
| 2 | 968 | Rataje | park | 55,79 | 9,0% | 4,1% | 0,456 | 27 305 | 62,9% | 0% | 24,7% | 16,6% | 36,4% | P+E |
| 3 | 875 | Antoninek | park | 16,01 | 17,0% | 0,0% | 0,000 | 27 215 | 86,2% | 0% | 0,0% | 0,0% | — | P+F |
| 4 | 817 | Stare Miasto | handel/mall | 10,91 | 37,0% | 14,8% | 0,399 | 24 267 | 59,6% | 18,2% | 32,0% | 46,2% | 115,6% | L+P |
| 5 | 266 | Ostrów Tumski | infrastruktura | 48,87 | 7,0% | 2,2% | 0,312 | 23 531 | 77,0% | 0% | 62,8% | 3,5% | 11,1% | N |
| 6 | 417 | Stare Miasto | przemysł/hale | 14,03 | 21,0% | 6,9% | 0,328 | 19 791 | 79,4% | 0,8% | 67,7% | 10,2% | 31,0% | N |
| 7 | 939 | Wilda | sport/stadion | 42,39 | 17,0% | 12,6% | 0,744 | 18 478 | 89,2% | 0% | 63,2% | 20,0% | 26,9% | S |
| 8 | 770 | Łazarz | handel/mall | 29,79 | 49,0% | 43,1% | 0,880 | 17 548 | 72,5% | 1,3% | 69,0% | 62,4% | 71,0% | M |
| 9 | 1166 | Rataje | kamienice/średniowysokie | 50,76 | 9,0% | 5,9% | 0,661 | 15 500 | 74,3% | 0% | 41,0% | 14,5% | 22,0% | P+E |
| 10 | 1271 | Chartowo | park | 17,30 | 15,0% | 7,1% | 0,476 | 13 604 | 76,4% | 0% | 32,8% | 21,8% | 45,7% | P+E |
| 11 | 328 | Warszawskie | wille/niskie | 94,30 | 20,0% | 18,6% | 0,930 | 13 141 | 65,0% | 0% | 51,1% | 36,4% | 39,1% | X |
| 12 | 1305 | Chartowo | handel/mall | 14,76 | 9,0% | 0,5% | 0,051 | 12 602 | 83,3% | 0% | 61,2% | 0,8% | 14,7% | R+N |
| 13 | 585 | Stare Miasto | wille/niskie | 2,98 | 43,0% | 2,2% | 0,052 | 12 144 | 75,7% | 36,3% | 73,1% | 3,0% | 58,8% | L |
| 14 | 98 | Stare Winogrady | kamienice/średniowysokie | 44,93 | 9,0% | 6,6% | 0,732 | 10 837 | 60,4% | 0% | 37,1% | 17,8% | 24,3% | E |
| 15 | 886 | Łazarz | kamienice/średniowysokie | 9,05 | 19,0% | 7,6% | 0,398 | 10 351 | 76,3% | 0% | 29,6% | 25,6% | 64,2% | P+K |
| 16 | 708 | Stare Miasto | kamienice/średniowysokie | 3,57 | 68,0% | 39,7% | 0,584 | 10 106 | 76,6% | 0% | 74,0% | 53,6% | 91,9% | K |
| 17 | 23 | Nowe Winogrady Południe | wielka płyta | 12,75 | 17,0% | 9,9% | 0,583 | 9 042 | 66,7% | 0% | 39,1% | 25,4% | 43,5% | E |
| 18 | 58 | Nowe Winogrady Południe | handel/mall | 3,28 | 24,0% | 1,7% | 0,072 | 7 314 | 63,4% | 0% | 62,9% | 2,8% | 38,2% | R+N |
| 19 | 626 | Stare Miasto | kamienice/średniowysokie | 2,62 | 32,0% | 5,3% | 0,165 | 7 012 | 62,6% | 36,8% | 35,7% | 14,8% | 89,6% | L+P |
| 20 | 771 | Stare Miasto | kamienice/średniowysokie | 4,37 | 37,0% | 21,0% | 0,568 | 6 989 | 63,0% | 4,5% | 33,0% | 63,8% | 112,1% | L+P |
| 21 | 828 | Stare Miasto | szpital/kampus | 4,75 | 50,0% | 35,7% | 0,715 | 6 775 | 76,5% | 0% | 74,9% | 47,7% | 66,8% | C |
| 22 | 688 | Stare Miasto | kamienice/średniowysokie | 3,19 | 61,0% | 39,9% | 0,653 | 6 743 | 70,8% | 0% | 67,5% | 59,0% | 90,4% | K |
| 23 | 78 | Główna | przemysł/hale | 35,83 | 22,0% | 20,2% | 0,917 | 6 568 | 78,7% | 0% | 73,5% | 27,5% | 29,9% | N |
| 24 | 880 | Wilda | kolej/zajezdnia | 0,84 | 76,0% | 0,0% | 0,000 | 6 382 | 63,4% | 63,4% | 58,8% | 0,0% | 129,3% | L |
| 25 | 565 | Ostrów Tumski | kampus uniwersytecki | 18,90 | 13,0% | 10,1% | 0,777 | 5 485 | 73,4% | 0% | 61,6% | 16,4% | 21,1% | C |
| 26 | 338 | Jeżyce | kamienice/średniowysokie | 36,13 | 25,0% | 23,6% | 0,946 | 4 919 | 80,1% | 0% | 71,0% | 33,3% | 35,2% | X |
| 27 | 575 | Stare Miasto | wille/niskie | 0,91 | 50,0% | 0,0% | 0,000 | 4 570 | 69,3% | 68,8% | 69,3% | 0,0% | 72,2% | L |
| 28 | 1020 | Chartowo | wille/niskie | 17,38 | 21,0% | 18,4% | 0,877 | 4 476 | 53,7% | 0% | 45,7% | 40,3% | 45,9% | X |
| 29 | 200 | Główna | wille/niskie | 34,13 | 17,0% | 15,7% | 0,924 | 4 407 | 74,0% | 0% | 49,1% | 32,0% | 34,6% | X |
| 30 | 405 | Stare Miasto | park | 8,35 | 18,0% | 12,7% | 0,707 | 4 396 | 79,7% | 0% | 20,6% | 61,7% | 87,4% | P |

### Objaśnienia TOP-30

Kody: **P** park carve, **E** osiedle/estate, **K** kamienice/core, **N** non-res `skipP`, **R** retail min footprint,
**L** landmark/plac, **C** kampus, **S** sport/facility, **M** forecourt/aisle, **F** brak działek, **X** długi ogon
blisko celu.

1. **887 Rataje, 85 ha** — największa wyspa w mieście (donut wokół 913). `park 33%` obniża `rects` do 51,4%, a
   `lots` do 36,9%. Przy `levels = 5` kod `steerProfile` zamienia `PROJECTS` na `RES_KAMIENICE` (`L < 7`), więc
   powstają kamienice obwodowe z `q ≈ 0,54`, `noCore` i lukami. Wypełnienie działek 20,4% przy wymaganych 40,6%.
2. **968 Rataje, park 63%** — `parkFreeCells` wycina większość rectów: 62,9% → 24,7% działek. Ocalałe kawałki to
   głównie niskie osiedle (`levels = 1`), którego `projectsBlock` wypełnia 16,6% przy wymaganych 36,4%. Budynki OSM
   stojące w parku (130 obiektów) nie są zachowane, bo nie są „facility” ≥ 150 m².
3. **875 Antoninek, park 78%** — `parkFreeCells` nie zostawia **żadnego** kawałka ≥ 12 m, mimo 14 budynków OSM
   (17% wyspy). Cały realny stock stoi na terenie parkowym i jest kasowany do trawnika.
4. **817 Stare Miasto, Stary Browar** — 37% parku i 18,2% rectów w rezerwacie landmarku. Efektywne działki to 32%
   wyspy, a realny udział 37% wymaga 116% wypełnienia działek. Generowane 46,2% to głównie biura wokół; reszta to
   Stary Browar i zabudowa parkowa, których generator nie posiada.
5. **266 Ostrów Tumski, EC/utility** — `program 7`, `T = 7%`, `KIND_SHARE.utility = 45%`, więc
   `skipP = 1 − 0,07/0,45 ≈ 0,84`. Losowo odrzucane są całe kawałki, a wiele ocalałych to komórki 20 × 20 m z
   parku, za małe dla `utilityBlock`. Wypełnienie działek 3,5% przy wymaganych 11,1%.
6. **417 Stare Miasto, hale** — `program 4`, `T = 21%`, `KIND_SHARE.industrial = 55%`, `skipP ≈ 0,62`. Hale
   powstają tylko na 18 z 51 kawałków, a ich rozkład nie odpowiada równomiernie zabudowanemu terenowi OSM.
   10,2% wypełnienia działek przy 31,0% wymaganych.
7. **939 Wilda, stadion/AWF** — `program 6` daje `STADIUM` (mapped > 30 tys. m²), ale 8 parkowych envelope'ów
   facility (łącznie ok. 69 tys. m²) i duże działki sportowe są zabudowane tylko częściowo: 20,0% działek przy
   26,9% wymaganych. Trybuny zajmują cztery boki, resztę zostawiają jako concourse.
8. **770 Łazarz, MTP/hale** — `program 3`, ale gate dla gęstego mixed-use (`built ≥ 30%`, `levels ≥ 3`,
   `avg < 9000`) przepuszcza blok do profilu okolicznego; ostatecznie buduje hale. 62,4% wypełnienia działek przy
   71,0% wymaganych — brakuje ok. 8,6 pp przez forecourt i alejki.
9. **1166 Rataje, 50,8 ha** — park 47% ścina `rects 74,3% → lots 41,0%`. `levels = 5` daje kamienice z `q ≈ 0,32`
   (`noCore`, luki), a nie gęste osiedle. 14,5% wypełnienia działek przy 22,0%.
10. **1271 Chartowo, park 71%** — `rects 76,4% → lots 32,8%` przez park. `ESTATE` (`levels = 5`) wypełnia 21,8%
    działek przy 45,7% wymaganych; `projectsBlock` ma zbyt duże odstępy między rzędami i segmentami.
11. **328 Warszawskie-Pomet, 94,3 ha** — niska zabudowa o realnym 20%; `lots` 51,1%, `fill` 36,4% przy 39,1%.
    Kwartał jest blisko celu, ale ogromna powierzchnia daje 13,1 tys. m² braku bezwzględnego.
12. **1305 Chartowo, retail** — `program 3`, `T = 9%`, `q = 0,15`, `skipP ≈ 0,85`. Z 69 działek losowo
    wybieranych jest ok. 10, ale większość to komórki 20 × 20 m; `retailParkBlock` po 22 m forecourt ma w nich
    tylko 8 m głębokości i zwraca `return`. Efekt: 684 m² na 9,0 ha działek (0,8%).
13. **585 Stare Miasto, Zamek Królewski/Muzeum Narodowe** — 36,3% rectów w rezerwacie landmarków, 13% parku.
    Generator buduje 664 m²; resztę 12,1 tys. m² stawiają `landmarks*.js`. To nie jest błąd gęstości generatora.
14. **98 Stare Winogrady, 44,9 ha** — park 35%, `lots` 37,1%. `levels = 5` + Rataje-like ścieżka zamienia
    `PROJECTS` w kamienice z `q ≈ 0,32`; 17,8% wypełnienia działek przy 24,3%.
15. **886 Łazarz, park 56%** — `rects 76,3% → lots 29,6%`. Dodatkowo `q = 0,19/0,28 ≈ 0,68 < 0,8`, więc
    `noCore` i luki. Wypełnienie 25,6% przy wymaganych 64,2% — park + zbyt rzadki profil.
16. **708 Stare Miasto, 68% real** — `lots` 74%, `fill` 53,6% przy 91,9% wymaganych. To gęsta starówka: nawet
    po przebudowie kwartałów 2026-11-08 generator zabudowuje tylko połowę działek; brakuje pełnego wypełnienia
    podwórzy/oficyn.
17. **23 Nowe Winogrady Południe, 12,75 ha** — `ESTATE` (`levels = 7`). `projectsBlock` ma rzędy 10,5–12,5 m
    głębokie z odstępami ≥ 18 m i segmenty 18–30 m; maksymalne wypełnienie to ok. 25–33% działek. 25,4% przy
    43,5% wymaganych.
18. **58 Nowe Winogrady Południe, retail** — `q = 0,24/0,6 = 0,4`, `skipP = 0,6`; z 26 działek wybrano 11, ale
    tylko jedna duża przeszła minimalne wymiary `retailParkBlock`. 568 m² na 2,06 ha działek.
19. **626 Stare Miasto, Zamek Cesarski** — 36,8% rectów w rezerwacie, 29% parku; `lots` 35,7%, `fill` 14,8%.
    Realne 32% to głównie landmark i zabudowa placu/parku, nie stock generyczny.
20. **771 Stare Miasto, Fara/plac** — `lots` 33,0% (park 37% + plac), `fill` już 63,8%, ale real 37% wymaga
    112% działek. Zabudowa OSM stoi częściowo na placu/parku, poza `lots`.
21. **828 Stare Miasto, szpital** — `program 1`, `lots` 74,9%, `fill` 47,7% przy 66,8% wymaganych. `campusBlock`
    nie wydaje całego budżetu: rozproszone kawałki i alejki 12–18 m nie mieszczą zaplanowanej powierzchni.
22. **688 Stare Miasto, 61% real** — `lots` 67,5%, `fill` 59,0% przy 90,4%. Ten sam problem co 708: gęsta
    kamienica, ale rdzeń i tylne skrzydła nie domykają kwartału.
23. **78 Główna, hale 35,8 ha** — `program 4`, `lots` 73,5%, `fill` 27,5% przy 29,9%. Blisko celu; brak wynika
    z `skipP` i dużych działek, nie z morfologii.
24. **880 Wilda, Stary Dworzec** — 63,4% rectów w rezerwacie `Stary Dworzec`; `program 5` i anchor kolejowy są
    filtrowane przez rezerwat. 0 m² generyczne; całość to landmark.
25. **565 Ostrów Tumski, kampus** — `program 2`, `lots` 61,6%, `fill` 16,4% przy 21,1%. Kampus uniwersytecki
    nie wykorzystuje reszty budżetu na pawilony w głębi.
26. **338 Jeżyce, 36,1 ha** — `lots` 71,0%, `fill` 33,3% przy 35,2%; kwartał prawie na celu, długi ogon
    bezwzględny przez powierzchnię.
27. **575 Stare Miasto, Collegium Maius** — 68,8% rectów w rezerwacie; 0 m² generyczne. Landmark.
28. **1020 Chartowo, niska zabudowa** — `lots` 45,7%, `fill` 40,3% przy 45,9%; blisko celu.
29. **200 Główna, niska zabudowa** — `lots` 49,1%, `fill` 32,0% przy 34,6%; blisko celu.
30. **405 Stare Miasto, park 62%** — `lots` 20,6%, `fill` 61,7% przy 87,4%. Park carve usuwa większość działek;
    część realnych budynków stoi na terenie parkowym.

## Analiza z podziałem na typy morfologiczne

Etykiety są heurystyczne: `program` z `GEO.blockStats` (1 szpital, 2 kampus, 3 handel, 4 przemysł, 5 kolej,
6 sport, 7 infrastruktura, 8 rekreacja), a dla `program = 0` — odległość od `OFFICE_SITES`, `park` i mediany
`levels`.

| typ | kwartały | area ha | OSM real | generated | gen/real | < 80% real | < 50% real | suma braków < 80% m² |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| park | 27 | 415,7 | 5,5% | 4,0% | 0,733 | 12 | 8 | 78 787 |
| bez poziomów OSM | 48 | 15,1 | 16,4% | 17,3% | 1,060 | 35 | 33 | 6 977 |
| wille/niska zabudowa | 291 | 1 141,0 | 16,6% | 20,6% | 1,240 | 50 | 34 | 48 373 |
| kampus uniwersytecki | 23 | 279,5 | 17,1% | 16,2% | 0,950 | 2 | 0 | 8 824 |
| kamienice/średniowysokie | 313 | 1 037,2 | 23,5% | 26,4% | 1,126 | 55 | 11 | 181 339 |
| handel/mall | 18 | 115,0 | 34,0% | 30,0% | 0,884 | 9 | 7 | 53 366 |
| wielka płyta | 20 | 58,6 | 16,8% | 19,1% | 1,140 | 5 | 0 | 15 914 |
| infrastruktura | 3 | 62,9 | 9,4% | 6,4% | 0,681 | 2 | 2 | 23 860 |
| przemysł/hale | 12 | 236,7 | 25,3% | 24,8% | 0,980 | 2 | 2 | 20 059 |
| szpital/kampus | 11 | 118,2 | 20,4% | 19,1% | 0,940 | 1 | 0 | 6 775 |
| sport/stadion | 4 | 92,1 | 12,5% | 10,7% | 0,855 | 1 | 0 | 18 478 |
| kolej/zajezdnia | 5 | 7,6 | 32,1% | 19,5% | 0,608 | 3 | 2 | 9 765 |
| biura | 8 | 11,8 | 40,9% | 42,3% | 1,035 | 3 | 3 | 256 |
| rekreacja | 1 | 96,2 | 4,0% | 4,2% | 1,048 | 0 | 0 | 0 |

Wnioski z typów:

- **Kamienice** są jako grupa przepełnione (+307 tys. m² netto), ale 55 kwartałów jest poniżej 80% realu i brakuje
  im 181 tys. m². To niemal wyłącznie kwartały z dużym parkiem/rezerwatem (887, 886, 626, 771) albo bardzo gęste
  starówki (708, 688). Nie należy globalnie zagęszczać kamienic — trzeba celować w `q` i `lotCover` per kwartał.
- **Wille/niska zabudowa** mają +456 tys. m² nadwyżki netto, ale 50 kwartałów poniżej 80% ma 48 tys. m² braku.
  Część to drobne wyspy z `lots = 0` (brak rectów), część to parcele z realnym udziałem 50–90% i pojedynczym
  budynkiem. To problem skali działki, nie profilu willowego.
- **Wielka płyta** netto +13,8 tys. m², ale 5 kwartałów poniżej 80% ma 15,9 tys. m² braku. Dwa różne zjawiska:
  `projectsBlock` nie umie dojść do 40–45% wypełnienia działek w gęstych osiedlach, a część bloków jest
  rozrzucona po parkach.
- **Park** ma najniższe `lots` (13,8% wyspy) i 78,8 tys. m² braków w 12 kwartałach poniżej 80%. To głównie
  `parkFreeCells`, nie brak miejsca.
- **Handel/mall** ma 9 kwartałów poniżej 80% i 53,4 tys. m² braku; trzy skrajne przypadki (1305, 58, 1084) dają
  prawie zero mimo 49–73% działek. To błąd `skipP` + minimalnych wymiarów, nie brak działek.
- **Przemysł/infrastruktura** ma tylko 2 kwartały poniżej 80%, ale są duże: 417 i 266/78. Ten sam mechanizm
  `skipP`.
- **Kampusy i szpitale** są blisko realu (0,94–0,95), ale pojedyncze duże kampusy (828, 565) nie wydają budżetu.
- **Sport** ma jeden duży niedobudowany kwartał (939, 18,5 tys. m²).

## Przyczyny techniczne

### Przyczyna 1 — morfologia `js/buildings.js`

**1a. Udział `T = b.built` jest używany jak udział działek, a nie wyspy.** `steerProfile()` liczy
`q = T / KIND_SHARE[kind]` (`js/buildings.js`, ok. linii 2678) i dla `RES_KINDS` decyduje o `dense`, `noCore`,
lukach i rdzeniu, a dla profili non-res ustawia `skipP = 1 − q` (linia 2725). Tymczasem `T` to udział **całej wyspy**,
a efektywne działki zajmują średnio tylko 56% wyspy (lokalnie 20–75%). Poprawny cel to `T / lotCover`. Tylko wille
i kampusy dzielą przez `srcLotArea` (linie 2667, 2673), a biura mają osobny budżet `srcTarget/srcPieceBudget`
(linie 3306–3325). Skutek: każdy blok z `lotCover < 100%` jest systematycznie niedobudowany, a im mniej działek,
tym większy błąd. Przykłady: 417 `fill 10,2%` vs `target 31,0%`, 266 `3,5%` vs `11,1%`, 417/1305/58.

**1b. `skipP` odrzuca całe kawałki losowo (Bernoulli), zamiast dzielić budżet.** Dla non-res `q < 1` oznacza
`skipP = 1 − q`; każdy kawałek jest niezależnie pomijany. Przy 69 kawałkach i `skipP = 0,85` (1305) wybieranych
jest ok. 10, a jeśli trafią na komórki 20 × 20 m, `retailParkBlock` je odrzuca i wynik spada do 0,8%. 1084 ma
33 kawałki, `skipP ≈ 0,92` i 0 m². 58 ma 26 kawałków, `skipP = 0,6` i 568 m². To wyjaśnia skrajne 0–3% bez
żadnego problemu z pokryciem działek (63–83% rectów).

**1c. Minimalne wymiary i forecourt w `retailParkBlock` / `mallBlock`.** `retailParkBlock` wymaga
`Math.min(cw, cd) >= 12` po odjęciu `forecourt` (do 22 m) i 4 m z tyłu (linie 1983–1991). Komórka parkowa
20 × 20 m daje po forecourcie 8 m głębokości i jest odrzucana. `mallBlock` wymaga `min(W, D) >= 20` i `C >= 14`
(linie 1934–1939). To dotyka 1305, 58 i 1084, gdzie `lots` to 4,9–9,0 ha, a generowane jest 0–0,7 tys. m².

**1d. `projectsBlock` ma zbyt rzadkie osiedla.** Rzędy mają 10,5–12,5 m głębokości, odstępy `max(18, floors *
2,8 * 0,9)` (linia 1731), a segmenty w rzędzie są rozdzielane lukami 18–30 m (linia 1728). Daje to ok. 25–33%
wypełnienia działek. Gęste osiedla potrzebują 36–46% (23: 43,5%, 1271: 45,7%, 887: 40,6%). Dodatkowo
`steerProfile` zamienia `PROJECTS` na `RES_KAMIENICE`, gdy `L < 7` (linia 2677), więc 5-kondygnacyjne osiedla
Rataje i Starych Winograd (887, 1166, 98) dostają kamienice obwodowe z `q < 0,8`, `noCore` i lukami, zamiast
gęstego osiedla.

**1e. Gęste kamienice nadal nie domykają kwartałów.** Po przebudowie 2026-11-08 (`ROW_REACH 36`, `DENSE_REACH 48`,
rdzeń od 8 m, `inner` rear/works) 708 ma `fill 53,6%` przy 91,9%, 688 59,0% przy 90,4%. To nie jest problem
działek (74,0% i 67,5%), tylko brak pełnego wypełnienia podwórzy i oficyn. Jednocześnie grupa kamienic jest
przepełniona o 307 tys. m², więc zmiana musi być warunkowana celem kwartału, nie globalna.

**1f. `parkFreeCells` kasuje zabudowę parkową.** Funkcja (`js/city-config.js`, linie 697–739) dzieli park na
komórki 20 m i zostawia tylko te poza parkiem. `blockFootprints` (`tools/poz-buildings.mjs`) zachowuje wyłącznie
obiekty „facility” ≥ 150 m² (stadiony, hale, muzea), a nie zwykłe budynki w parkach, ogrodach działkowych,
cmentarzach i na skrajach osiedli. Skutki: 875 `rects 86,2% → lots 0%`, 968 `62,9% → 24,7%`, 1271 `76,4% → 32,8%`,
886 `76,3% → 29,6%`, 1166 `74,3% → 41,0%`, 405 `79,7% → 20,6%`. W całym mieście park carve usuwa **518 ha**
(14,0 pp wyspy) — to największa pojedyncza strata powierzchni działek.

**1g. Drobne wyspy bez rectów.** 47 kwartałów ma `lots = 0` przy realnej zabudowie. `maskRects()` w
`tools/poz-blocks.mjs` ma `minSide = 8`, `maxRects = 8`, próg 2% i przerwanie po 93% pokrycia; po erozji
`SIDEWALK = 4.6` wąskie wyspy (0,05–0,2 ha) nie dają żadnego prostokąta ≥ 8 m. Przykłady: 1365 (0,18 ha, 90%
real, 0 rectów), 855 (0,12 ha, 67%), 428, 274. Brak łącznie 34,2 tys. m², ale poza 875 są to małe wartości
(0,1–2,5 tys. m²).

### Przyczyna 2 — działki `BLOCKS.rects` w geodata

Bilans powierzchni dla 784 buildable kwartałów (sumy analityczne `rects` / `splitDeep` / `parkFreeCells`):

| etap | udział wyspy | powierzchnia |
| --- | ---: | ---: |
| wyspa (curb island) | 100% | 36 874 705 m² |
| surowe rects | 76,5% | 28 205 601 m² |
| rezerwaty landmarków w rectach | 0,4% | 149 004 m² |
| efektywne działki (`lots`) | 56,0% | 20 653 652 m² |
| generated | 19,7% | 7 255 880 m² |

Uwaga: wiersz „surowe rects” jest z próbkowania poligonu (76,5%); suma analityczna tych samych rectów daje 71,3%,
bo prostokąty frame miejscami wystają poza poligon. Straty `splitDeep` i parku liczone są z sum analitycznych:
71,3% → 68,2% (splitDeep) → 54,2% (park) → 54,1% (minLot) wyspy.

Straty między etapami:

- **`splitDeep` (pas 9 m między stripami > 95 m): 114 ha (3,1 pp).** To celowe cięcie superbloków; nie jest
  błędem `maskRects`, ale obniża `lots` w dużych kwartałach (887, 968, 1166).
- **park carve: 518 ha (14,0 pp).** Dominująca strata. `parkFreeCells` nie zna footprintów OSM poza
  `blockFootprints` (facility).
- **filtr `minLot`: 3,7 ha (0,1 pp).** Nieistotny poza drobnymi wyspami.
- **rezerwaty landmarków: 15 ha (0,4 pp)** — mało sumarycznie, ale skoncentrowane w 7 kwartałach (575, 585,
  626, 817, 880 i in.).
- **`SIDEWALK = 4,6 m`**: przybliżona powierzchnia property line to ok. 90% wyspy (33,2 tys. ha vs 36,9 tys. ha).
  Surowe rects pokrywają więc ok. **85% property line** (nie 76,5% wyspy). To zbliża się do 90,6–93,4% mierzonych
  w raporcie campusowym dla dużych kwartałów. `maskRects`/`fitRects` gubi więc ok. 10–15% property line, a nie
  większość powierzchni.
- **`STRIP = 10 m`** nad Wartą i szerokie pasy zieleni są w `BLOCKS.area`; nie są głównym źródłem strat, ale
  powiększają wyspy o tereny, których generator nie zabuduje.
- **Nienazwane `highway=service` nie są stemplowane** (4 484 kawałki wg komentarza w `tools/poz-blocks.mjs`).
  To tworzy superbloki 85 ha (887), 55,8 ha (968), 50,8 ha (1166), 48,9 ha (266). Wewnątrz nich udział
  zabudowy jest niski, a `blockAt` i tak przypisuje całość do jednego kwartału. Stemplowanie wszystkich
  service'ów zostało wcześniej odrzucone (1 154 nowe kwartały, głównie slivers < 2 000 m²), więc nie jest to
  pierwszy wybór; alternatywą jest wewnętrzny podział morfologiczny dużych wysp bez zmiany rastra dróg.
- **52 kwartały mają `real > lots`** (80 028 m² braku), a **47 ma `lots = 0`** (34 246 m²). Dla nich poprawa
  `maskRects` nie wystarczy — potrzebne są footprinty OSM (park/landmark/plac) albo fallback działki z obrysu
  budynku.

Odpowiedź na pytanie „czy `fitRects` gubi powierzchnię”: **nie w dominującym stopniu**. `maskRects` traci
ok. 10–15% property line na rzecz erozji, progów i sliverów; podniesienie capów 12/10 → 18/16 dawało wcześniej
−0,65 do +1,14 pp w 7 z 27 kampusów (raport 2026-11-08), więc nie jest to główna dźwignia. Główna strata to
**park carve 14 pp** i **superbloki + splitDeep 3,1 pp**, a nie bufory drogowe czy cap `maskRects`.

### Przyczyna 3 — profile i programy

- **Szpitale (program 1): 11/11 przechodzi gate** `park ≤ 0,5`, `area ≥ 4000`, `built ≤ 0,55`. Problemem nie jest
  klasyfikacja, tylko `campusBlock`: 828 ma 50% realu, ale 47,7% wypełnienia działek przy 66,8% wymaganych.
- **Uczelnie (program 2): 13/23 przechodzi gate** `area ≥ 5 ha && built ≤ 0,4`. 10 odrzuconych to w większości
  świadome przypadki: gęste centrum (192, 221, 579, 582, 733, 769, 815, 929 — zachowują profil dzielnicy) oraz
  parki (7, 87). 815 nadal ma 80,1% realu przez biurowy rdzeń, nie kampus.
- **Programy 3–8: 44/44 przechodzą gate parkowy** `park ≤ 0,6`. Cztery parki (50, 251, 613, 904) świadomie
  zachowują profil dzielnicy. Niedobory 1305/58/1084 nie wynikają z profilu (wszystkie dostają `RETAIL_PARK`),
  tylko z 1b/1c.
- **Biura:** 8 kwartałów w promieniu 240 m od Bałtyk/Andersia/AND2/PFC/Collegium Altum ma łącznie 42,3% generated
  vs 40,9% real (1,035). Trzy małe bloki są poniżej 80%, ale suma braku to tylko 256 m². 817 nie jest problemem
  biurowym — to landmark/park.
- **Rataje/Stare Winogrady — realny błąd profilu.** `blockProfile()` dla Rataje robi
  `chance(0,7) ? PROJECTS : RES_KAMIENICE` (linia 2828), a `steerProfile()` dla `L < 7` zamienia PROJECTS na
  `RES_KAMIENICE` (linia 2677). W efekcie 5-kondygnacyjne osiedla panelowe (887, 1166, 98) są budowane jak
  kamienice. To nie jest tylko „za rzadki layout” — to zła morfologia dla całego kwartału. Chartowo ma osobny
  warunek (`lv <= 3 ? lowKind() : ESTATE`), dlatego 1271 dostaje ESTATE, ale i tak za rzadkie.
- **Wille/niska zabudowa:** profil jest poprawny dla realnych willi (Sołacz/Winiary dzielnice 0,98–1,01), ale
  heurystyka `levels <= 3 -> RES_VILLAS` trafia też na drobne wyspy przemysłowe i pojedyncze budynki, gdzie
  `lots = 0`. To problem działek (1g), nie profilu.
- **`OFFICE_SITES`** obejmuje tylko 5 landmarków; 770 (MTP) nie jest biurem i słusznie nie łapie się na biura.
  Jego 17,5 tys. m² braku to forecourt/alejki hali, nie zły profil.

## Rekomendowane punkty wejścia i szacowany zysk

Kolejność według stosunku zysku do ryzyka. Zyski to **górne oszacowanie** z sumy dodatnich braków; nie każdy
kwartał da się doprowadzić do 100% realu bez overbuildingu. Szacunki z różnych wierszy częściowo się nakładają
(np. 887 występuje w 1 i 4, 968 w 3 i 4), więc nie należy ich sumować.

| # | punkt wejścia | zmiana | szacowany zysk | ryzyko |
| ---: | --- | --- | ---: | --- |
| 1 | `js/buildings.js: steerProfile()` | liczyć `lotShare = T / (srcLotArea / b.area)` i używać go w `q` oraz `skipP`; nie tylko wille/kampusy | do **300–400 tys. m²** z 628 tys. braków; TOP-30 405 tys. | wysokie: bez równoczesnego thinning przepełnionych kwartałów miasto urośnie ponad OSM |
| 2 | `js/buildings.js: industrialBlock / retailParkBlock / mallBlock / utilityBlock` | zamiast `skipP` rozdzielać `srcPieceBudget` na wszystkie kawałki; min. 1 hall na kawałek ≥ 18 m | **+78–129 tys. m²**; 417 +19,8 tys., 266 +23,5 tys., 1305 +12,6 tys., 58 +7,3 tys., 1084 +3,4 tys. | średnie: hale mogą wejść w park/forecourt, potrzebny test geometrii |
| 3 | `tools/poz-buildings.mjs` + `js/city-config.js: parkFreeCells()` | emitować `blockParkBuildings` dla **wszystkich** budynków OSM w parkach ≥ 60–80 m² (nie tylko facility ≥ 150 m²) i zachować ich komórki jako działki | **+58 tys. netto / +98 tys. dodatnich**; 875 +27,2 tys., 968 +27,3 tys., 1271 +13,6 tys., 886 +10,4 tys., 405 +4,4 tys. | średnie: przywrócenie zbyt wielu szop może przelać Chartowo; gate po `built` kwartału i tylko footprint, nie bbox |
| 4 | `js/buildings.js: projectsBlock()` + `steerProfile()` | gęsty wariant osiedla przy `T/lotCover > 0,25`: rzędy 12–14 m, odstępy 12–15 m, segmenty 8–12 m, pawilony/garages w lukach; nie zamieniać 5-kondygnacyjnych PROJECTS na kamienice w Rataje/Starych Winogradach | **+100–150 tys. m²**; 887 +63,5 tys., 1166 +15,5 tys., 98 +10,8 tys., 23 +9,0 tys., 1271/968 częściowo | wysokie: zmiana sylwetki osiedli; potrzebny browser check i test balconies |
| 5 | `js/buildings.js: campusBlock()` | wydawać resztę `cfg.share` na pawilony w głębi i `campusShed` w kawałkach; zmniejszyć alejki 12–18 m przy wysokim `share` | **+8,8 tys. < 80% / +45 tys. dodatnich**; 828 +6,8 tys., 565 +5,5 tys., 11 +3,8 tys. | niskie: kampusy już mają budżet |
| 6 | `js/buildings.js: retailParkBlock / mallBlock` | dla kawałków 12–22 m zmniejszyć forecourt i dopuścić hall 8–10 m głęboki zamiast `return` | **+23 tys. m²** (1305 +12,6, 58 +7,3, 1084 +3,4) | niskie: tylko małe kawałki |
| 7 | `tools/poz-blocks.mjs: maskRects / lotRects` | fallback: dla wyspy < 0,5 ha z `rects = []` i budynkiem OSM utwórz działkę z obrysu budynku lub całego property line; `minSide` 8 → 5 tylko tam | **+3 tys. m²** i 47 mniej zerowych outlierów | niskie: małe wyspy, ale uwaga na kolidacje z chodnikiem |
| 8 | `js/buildings.js: residentialBlock/kamienica` | tylko dla kwartałów `fill < target` i małym `reserveRect`: domykać podwórza i oficyny; równolegle thinning `q ≥ 1,3` w przepełnionych (wille +456 tys., kamienice +307 tys.) | **+30–60 tys. m²** w 708/688/886 (bez 626/771, które są landmarkiem/parkiem) | wysokie: bez thinningu pogorszy i tak dodatni bilans miasta |
| 9 | raportowanie, nie kod | oznaczyć 7 kwartałów landmarków (508, 575, 582, 585, 626, 674, 880) jako „built by landmarks” i nie wliczać ich do celu generatora; 817 raportować osobno jako park + 18% rezerwatu | usuwa **35,5 tys. m²** fałszywych braków | brak |

Priorytet praktyczny: **1 + 2 + 3** adresują większość TOP-30 (887 przez 1/4, 968/875/1271/886 przez 3, 266/417/1305/58
przez 2). **4** jest konieczne dla 887/1166/98/23, ale wymaga osobnego browser checku.

## Wdrożenie 2026-11-08

Wdrożone zostały punkty 1–4 i 6 z tabeli powyżej, w wersji ograniczonej do kwartałów, w których deficyt wynika
z niskiego pokrycia działek lub zbyt agresywnego `skipP`:

- **`steerProfile` (1a)** — `lotTarget = b.built · b.area / srcLotArea` zastępuje udział wyspy w `q` dla kamienic,
  gdy działki pokrywają mniej niż 50 % wyspy (887, 886, 405, 98, 1166). Dla profili `retail`/`mall`/`industrial`/
  `utility`/`depot` ten sam cel steruje `skipP`, więc zachowany udział kawałków odpowiada realnej powierzchni
  zabudowy, a nie udziałowi wyspy.
- **`projectsBlock` (1d/4)** — 5-kondygnacyjne osiedla Rataje i Starych Winogradów pozostają `PROJECTS` zamiast
  zamieniać się w kamienice; `estateP = clamp((lotTarget − 0,15) / 0,20)` interpoluje rzędy 10,5–14 m, odstępy
  8–30 m i segmenty 30–110 m. Kawałki zbyt małe na rząd (1166, 968) dostają rząd garaży/pawilonów o powierzchni
  `srcPieceBudget`. Panele mają też balkony od strony ulicy mimo cofnięcia 8–12 m (`slabBalconies`).
- **`retailParkBlock` (1c/6)** — kawałki 12–18 m dostają 2–4 m forecourt i pojedynczą halę 7–10 m głęboką zamiast
  `return`; 1305 i 58 przestają zwracać 0 m².
- **`parkFreeCells` + `GEO.blockParkBuildings` (1f/3)** — zwykłe budynki OSM ≥ 60 m² w kwartałach z parkiem > 40 %
  zachowują własne działki (1 151 budynków w 66 kwartałach); nie są już kasowane do trawnika. 875 Antoninek ma
  wreszcie zabudowę (17 % realu), a 968/1166/1271/886 zyskują działki.
- **Budżet kwartału** — `srcTarget` to teraz rzeczywista powierzchnia OSM (`min(srcLotArea, b.built · b.area)`),
  a nie parkowo skorygowany `T`; dzięki temu pawilony nie wydają 2,5× realnego stocku w kwartałach parkowych.

Wynik po zmianach (`node tools/density-report.mjs --top 30`):

| miara | przed | po |
| --- | ---: | ---: |
| generated | 19,7 % | 20,4 % |
| bilans netto | +580 638 m² | +835 506 m² |
| kwartały poniżej OSM | 358 | 334 |
| suma dodatnich braków | 628 008 m² | 384 677 m² |
| TOP-10 braków | 250 732 m² | 125 060 m² |
| TOP-30 braków | 404 992 m² | 211 239 m² |

Najważniejsze kwartały (brak w m², przed → po):

| id | przed | po | gen/real po | uwaga |
| ---: | ---: | ---: | ---: | --- |
| 887 | 63 494 | 3 418 | 0,973 | kamienice + gęste osiedle na obrzeżach parku |
| 968 | 27 305 | 6 865 | 0,863 | działki budynków parkowych + pawilony |
| 875 | 27 215 | 807 | 0,970 | wszystkie 10 budynków OSM jako działki |
| 1166 | 15 500 | 676 | 0,985 | pawilony na 200 małych kawałkach |
| 1271 | 13 604 | 3 708 | 0,857 | gęste ESTATE + działki parkowe |
| 417 | 19 791 | −6 089 | 1,207 | hale przekroczyły cel po `lotTarget` |
| 266 | 23 531 | 1 599 | 0,953 | `utility` bez `skipP` |
| 1305 | 12 602 | 9 482 | 0,286 | małe hale działają, duże kawałki nadal rzadkie |
| 58 | 7 314 | 1 982 | 0,749 | małe hale z krótkim forecourtem |
| 886 | 10 351 | 2 203 | 0,872 | działki parkowe + `lotTarget` |
| 98 | −10 837 | −15 307 | 1,379 | gęste osiedle przepełniło kwartał |

Bilans miasta rośnie o ok. 255 tys. m² nadwyżki: to cena za podniesienie 334 kwartałów bez równoległego thinning
przepełnionych willi i kamienic (rekomendacja 8, świadomie poza tym zakresem). 98 i 417 przeszły z deficytu w
nadwyżkę (98 to osiedle, 417 to hale); jeśli thinning wejdzie później, powinien objąć właśnie takie kwartały.
1305 pozostaje największym deficytem handlowym, bo duże kawałki nadal wypadają losowo — docelowo trzeba je
rozdzielać budżetem, nie `skipP`.

## Weryfikacja

- `node --test tests/buildings-density.test.cjs` — 13/13 pass (2026-11-08, po wdrożeniu).
- `node --test tests/*.cjs` — **453/453 pass** po aktualizacji pinów `tests/park-paving.test.cjs` (footprint union
  305 226 m²) i `tests/tree-distribution.test.cjs` (liczby drzew, hash siedzib i colliderów); piny zmieniły się, bo
  nowe budynki parkowe i gęstsze osiedla zmieniają collidery i miejsca drzew.
- `node --test tests/geodata.test.mjs` — 1/1 pass; przebudowa z `tools/` odtwarza `js/geodata.js` bajt w bajt.
- `node tools/density-report.mjs --top 30` — ok. 6 s `buildCityBlocks` + 5 s raster 2 m po zmianach (M-series);
  wynik powtarzalny (ten sam seed).
- Strict harness testowy daje 887 69 808 m², a korekta „najmniejszy poligon” 64 012 m²; po zmianach raport pokazuje
  odpowiednio 125 196 / 127 506 m² (generated / real). Testy nadal używają strict `generatedByBlock`.

## Reprodukcja

```sh
node tools/density-report.mjs --top 30
node tools/density-report.mjs --top 100 --json density.json
node --test tests/buildings-density.test.cjs
node --test tests/*.cjs
node --test tests/geodata.test.mjs
```

Plik `density.json` (opcjonalny) zawiera wszystkie 1 418 kwartałów z polami `real`, `generated`, `generatedAll`,
`missing`, `rectCover`, `reserveCover`, `reserveRectCover`, `lotCover`, `fill`, `kind`, `program`, `levels`, `park`
i `buildings`, więc tabelę TOP-N i cięcia po dzielnicach można przeliczyć bez ponownego uruchamiania generatora.

## Pliki zmienione

- `tools/density-report.mjs` — nowe narzędzie analityczne (nie wymaga zmian w `js/geodata.js`).
- `tools/poz-buildings.mjs` — `blockParkBuildings` (zwykłe budynki OSM ≥ 60 m² w kwartałach z parkiem > 40 %).
- `tools/build-poznan.mjs` — nowy klucz `GEO.blockParkBuildings`.
- `js/geodata.js` — przebudowany z `tools/` (nie edytowany ręcznie).
- `js/city-config.js` — `BLOCKS[i].parkFootprints` z flagą facility/non-facility i `parkFreeCells` dla obu typów.
- `js/buildings.js` — `lotTarget`, `estateP`, małe hale retail, pawilony na małych kawałkach, balkony paneli,
  budżet `srcTarget` z realnej powierzchni.
- `tests/park-paving.test.cjs`, `tests/tree-distribution.test.cjs` — zaktualizowane piny po nowych colliderach.
- `docs/observations/building-density-investigation-2026-11-08.md` — ten raport (sekcja „Wdrożenie 2026-11-08”).
- `docs/backlog.md`, `docs/geodata.md`, `docs/world.md` — opis nowego klucza i wyniku.

