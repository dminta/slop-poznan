# Dominujący program kwartału — 2026-11-08

Kontynuacja [audytu zabudowy niemieszkalnej](non-residential-audit-2026-11-08.md), rekomendacje 2 i 4, oraz
[pierwszego wdrożenia profili](building-profiles-nonres-2026-11-08.md). `tools/poz-buildings.mjs` kodował tylko
program 1 (szpital) i 2 (uczelnia), więc centra handlowe, hale przemysłowe, zajezdnie, stadiony i elektrociepłownie
wracały do profilu dzielnicy (kamienice, osiedla z wielkiej płyty). Ten etap dodaje klasy 3–7, wybiera program po
powierzchni obrysów i podłącza go w `js/buildings.js` przed `OFFICE_SITES` i switchem dzielnic.

## Klasyfikacja i dominacja

`buildingUse` w `tools/poz-buildings.mjs` rozpoznaje teraz:

| Program | Znaczenie | Sygnały |
|---:|---|---|
| 1 | szpital / klinika | `building=hospital`, `amenity=hospital`, `healthcare=hospital`, nazwy Szpital/Klinika/Przychodnia/Ambulatorium |
| 2 | uczelnia / kampus | `building=university|college|dormitory`, `amenity=university|college`, `office=university`, nazwy Collegium/Uniwersytet/Politechnika/Instytut |
| 3 | retail / mall | `building=retail|supermarket|department_store|wholesale`, `shop=*`, nazwy Posnania/Avenida/Castorama/Makro/IKEA/Gigamarket itd. |
| 4 | industrial | `building=industrial|warehouse|factory|hangar|shed`, `landuse=industrial`, nazwy zakład/hala/warsztat/magazyn; `building=ruins` tylko dla ZNTK |
| 5 | rail / depot | `building=train_station|transportation|station|bus_station`, `railway=*`, nazwy Dworzec/Zajezdnia/Parowozownia/ZNTK |
| 6 | sport / stadion / arena | `building=stadium|sports_hall|arena|grandstand|ice_rink`, `leisure` sportowe, `sport=*`, `addr:street=Termalna`, nazwy Stadion/Arena/Lodowisko/Termy |
| 7 | utility | `power=plant|substation`, `historic:power`, `man_made=works|cooling_tower|chimney|storage_tank|water_tower`, nazwy Elektrociepłownia/Elektrownia/Przepompownia/Oczyszczalnia |

Kolejność ma znaczenie: elektrociepłownia nie jest halą przemysłową, a grandstand stadionu nie jest magazynem.
Program kwartału wybiera suma **powierzchni obrysów** (komórki rastra, a dla bardzo cienkich obrysów pole pierścienia),
nie liczba budynków. Próg dla klas 3–7 to **≥ 40 %** powierzchni obrysów w kwartale; kwartał musi mieć ≥ 0.4 ha i
≥ 150 m² danego użytku, żeby jeden sklep nie robił z osiedla mallu. Program 1/2 zachowuje dotychczasowe reguły
(dwa budynki publiczne albo samotny szpital na dużym, rzadkim kwartale); wygrywa tylko wtedy, gdy jego własna
powierzchnia jest większa od dominującego użytku 3–7. Dzięki temu Antoninek (#1124: 45 % hale, 33 % szpital) dostaje
program 4, a nie HOSPITAL na przemyśle.

Wynik na 2026-11-08: program 1 ma 11 kwartałów, 2 – 24, 3 – 16, 4 – 12, 5 – 5, 6 – 5, 7 – 1. Pozostałe 1 344 to
program 0.

## Sterowanie profilami

`blockProfile` sprawdza `srcBlock.program` przed `OFFICE_SITES` i switchem dzielnic:

- **1 HOSPITAL** — nowy gate `area >= 0.4 ha && built <= 0.55 && park <= 0.5`. #828 Szpital Kliniczny (4.7 ha,
  50 % built) i #991 Szpital Strusia/Szwajcarska (1.4 ha, 25 %) przestają być kamienicami. Kampusy uczelniane (2)
  zachowują `area >= 5 ha && built <= 0.4`, więc gęste #192, #769 i #814 dalej idą profilem dzielnicy.
- **3** — `MALL`, gdy średni obrys ≥ 9 000 m² albo kwartał ma ≥ 6 ha i ≥ 60 % built; inaczej `RETAIL_PARK`.
  Gęsty śródmiejski kwartał (built ≥ 30 %, mediana ≥ 3 kondygnacji, średni obrys < 9 000 m²) zostaje przy
  `OFFICE_SITES`/dzielnicy — Stary Browar Atrium i Galeria MM to nie park handlowy.
- **4** — `INDUSTRIAL_HALL`; **5** — `DEPOT`; **6** — `STADIUM`, gdy kwartał ma ≥ 30 000 m² obrysu i < 60 % parku,
  inaczej `ARENA`; **7** — `UTILITY`.
- Kwartały z parkiem > 60 % zachowują zieleń i profil dzielnicy: ich zamapowane hale i stadiony mają już własne
  działki przez `GEO.blockFootprints`, a profil całego kwartału zbudowałby park.
- `SPECIAL_SITES` kurczy się do wyjątków, których OSM nie taguje wystarczająco: EC Garbary (dwa `building=yes`
  bez nazwy) i zajezdnia Madalińskiego (poniżej 40 %). `bigBoxKind` zostaje jako fallback dla bezimiennych
  wielkogabarytowych obrysów, ale program ma pierwszeństwo.

## Pomiar audytu

`node --max-old-space-size=8192 tools/audit-nonresidential.mjs /tmp/nonres-final.json` (2 m raster, 2026-11-08).
ID przesunęły się o +2 po przywróceniu wysp kolejowych (`c9b8f9f`), dlatego audytowe #953/#847/#827/#989 to teraz
#955/#848/#828/#991.

| Obiekt | Kwartał (audyt → dziś) | Program | Pokrycie obrysu | Generacja kwartału | Max h |
|---|---|---:|---:|---:|---:|
| CH Posnania | 953 → 955 | 3 | 68.0 % | 59.8 % | 16 m |
| Castorama | 21 | 3 | 22.1 % | 22.9 % | 8 m |
| ZNTK Robocza | 847 → 848 | 4 | 21.3 % | 24.5 % | 11 m |
| EC Garbary | 266 | 0 (SPECIAL_SITES) | 31.2 % | 8.2 % | 27 m |
| Szpital Kliniczny | 827 → 828 | 1 | 20.2 % (obiekt) | 35.7 % | 21 m |
| Szpital Strusia/Szwajcarska | 989 → 991 | 1 | — | 25.0 % | 18 m |
| Antoninek (hale + Strusia) | 1121 → 1124 | 4 | — | 18.0 % | 11 m |
| Gigamarket | 28 | 3 | 34.5 % | 23.9 % | 8 m |
| Enea Stadion | 939 | 6 | 71.8 % | 12.7 % | 15 m |
| Hala Arena | 927 | 6 | 82.8 % | 4.8 % | 11 m |
| Zajezdnia Głogowska | 1254 → 1250 | 5 | 50 % (obrys) | 1.8 % | 8 m |

EC Garbary pozostaje programem 0, bo w snapshocie ma dwa nieotagowane `building=yes` (0.88 ha) w 48.9-ha kwartale;
jego 31.2 % pokrycia i 27 m daje kotwica `SPECIAL_SITES`. Głogowska dostała `DEPOT`, ale jej wąskie działki
przy torach dają tylko 144 m² zabudowy (1.8 %); to osobny follow-up layoutu, nie klasyfikacji.

## Pozostałe luki

- Cztery kwartały z ≥ 1 500 m² realnej zabudowy niemieszkalnej mają 0 m² generacji: #880 (Stary Dworzec — rezerwa
  landmarku), #575 (Collegium Maius — rezerwa landmarku), #1323 (jeden obrys hali przemysłowej) i #1084 (Lidl,
  5 % built). Dwa ostatnie mają właściwy program 4/3, ale `steerProfile` losowo pomija cały kawałek kwartału
  (skip 60 % / 92 %); późniejszy pass powinien zagwarantować jedną halę, gdy kwartał ma zamapowany obrys
  niemieszkalny.
- Dane OSM nadal nie mają chłodni i komina EC Garbary ani hal HCP; `blockStats` ich nie zobaczy do rozszerzenia
  snapshotu (backlog, dane wejściowe).

## Testy i odtworzenie

```bash
node tools/build-poznan.mjs
node --test tests/*.cjs
node --test tests/geodata.test.mjs
node --max-old-space-size=8192 tools/audit-nonresidential.mjs /tmp/nonres-final.json
```

`tests/geodata.test.mjs` sprawdza zakres programów 0–7, obecność klas 3–7 oraz programy #955 (3), #21 (3), #848 (4),
#828 (1) i #991 (1). `tests/buildings-density.test.cjs` przenosi #828 z listy „gated campus” do szpitali i pilnuje,
że #828/#991 budują odpowiednio ≥ 35 %/24 % kwartału. `tests/park-paving.test.cjs` przechodzi po dodaniu bramki
`park > 0.6` (parkowe kwartały wracają do profili dzielnicowych; suma obrysów w parkach znów mieści się w pinezce).

Nie wykonano przeglądu wizualnego w przeglądarce; ten etap weryfikuje geodatę, raster generacji i testy headless.
