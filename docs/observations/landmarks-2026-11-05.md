# Poznań landmark survey and height measurements — 2026-11-05

Survey of 11 characteristic Poznań landmarks establishing measured heights, footprint bounds, and architectural
silhouettes from national survey elevation models (GUGiK ISOK LiDAR DSM − DTM WCS coverage) and verified OpenStreetMap
footprints.

## Survey methodology and source criteria

Each building was identified in the committed OpenStreetMap building data (`tools/data/poz_buildings.json`) and located
inside the simulation's detail box (8.2 × 5.7 km, origin at the Ratusz, true north at −z). The 11 elements were added
to `tools/data/poz_landmarks.json` directly from the 2026-10-28 `poz_buildings.json` snapshot (same geometry), rather than
refetched with the new query.
Dimensions and elevations were calibrated using:

**GUGiK Airborne LiDAR (ISOK KRON86-NH WCS services):**
- **DSM:** `DSM_PL-KRON86-NH` (Numeryczny Model Pokrycia Terenu — surface including roofs, spires, turrets),
  WCS 1.0.0 `https://mapy.geoportal.gov.pl/wss/service/PZGIK/NMPT/GRID1/WCS/DigitalSurfaceModel`, native CRS EPSG:2180 (PL-1992), format `image/x-aaigrid`, resolution 0.5 m.
- **DTM:** `DTM_PL-KRON86-NH` (Numeryczny Model Terenu — bare ground),
  WCS 1.0.0 `https://mapy.geoportal.gov.pl/wss/service/PZGIK/NMT/GRID1/WCS/DigitalTerrainModel`, EPSG:2180, format `image/x-aaigrid`, resolution 0.5 m.
- For each building outline, DSM and DTM grids were sampled inside the polygon using a point-in-polygon test.
  Local relative elevation $h = \text{DSM} - \text{DTM}$ determines ground elevation, eaves, ridge lines, and top features.
  Edge cells (within 1 m of footprint perimeter) were audited for tree/curb artifacts: for Biblioteka Raczyńskich, the 19.30 m
  cell is a boundary edge cell (adjacent tree canopy; interior roof top is ~18.6 m); for Kościół NMP na Ostrowie Tumskim, the
  30.29 m cell is an edge artifact (edge distance 0.1 m; the actual church ridge is 28.8 m).

## Sourced measurements table

| Landmark | OSM element & site coordinates | Ground a.s.l. | Measured LiDAR (DSM − DTM) | Silhouette & orientation notes | Modelled height & sub-heights |
|---|---|:---:|---|---|---|
| **Biblioteka Raczyńskich** | `way/169874406`<br>x: −365.0, z: +13.3<br>39.6 × 16.0 m, ang −7.7° | 69.3 m | p50: **15.5 m** (eaves)<br>p95: **17.3 m** (attic)<br>interior max: **18.6 m** (ridge; 19.3 m edge cell is a tree) | Classical 24-column Corinthian colonnade facing south (+z) onto Plac Wolności | Top: **18.6 m**<br>Colonnade eaves: 14.5 m<br>Attic balustrade: 15.7 m |
| **Pałac Działyńskich** | `way/366976799`<br>x: −118.7, z: +5.5<br>49.0 × 19.7 m, ang −11.0° | 60.2 m | p50: **15.8 m** (main eaves)<br>p80: **16.9 m** (mansard)<br>p95: **17.8 m** (attic parapet)<br>max: **22.25 m** (pelican apex at east end) | East facade (+x) faces Stary Rynek with pediment (ridge 'x') and gilded pelican at east end | Top: **22.25 m**<br>Main eaves: 15.8 m<br>Attic parapet: 17.8 m<br>Pelican sculpture: 22.25 m |
| **Hotel Bazar** | `way/363880964`<br>x: −265.0, z: +102.3<br>71.1 × 38.6 m, ang −3.9° | 65.8 m | p50: **18.3 m** (mansard base)<br>p95: **21.3 m** (mansard ridge)<br>max: **24.43 m** (corner rotunda dome) | L-shaped wings along Paderewskiego and Marcinkowskiego; prominent copper rotunda dome at northeast (+x, −z) | Top: **24.4 m**<br>Cornice: 18.3 m<br>Mansard ridge: 21.3 m<br>Corner dome: 24.4 m |
| **Muzeum Narodowe** (Gmach Główny) | `way/35276947`<br>x: −275.5, z: −4.1<br>63.4 × 143.9 m, ang −2.1° | 67.9 m | p50: **15.9 m** (cornice)<br>p80: **18.3 m** (avant-corps)<br>p95: **20.9 m** (roof)<br>max: **25.98 m** (attic apex at south end) | Historic main building stands at the south end (+z, Paderewskiego) with pediment (ridge 'z') facing south | Top: **26.0 m**<br>Arcade base: 5.5 m<br>Main cornice: 16.0 m<br>South attic: 26.0 m |
| **Teatr Polski** | `way/104781039`<br>x: −700.9, z: −4.6<br>27.3 × 40.1 m, ang −6.7° | 75.9 m | p50: **17.2 m** (foyer)<br>p80: **19.5 m** (portico)<br>p95: **21.4 m** (auditorium)<br>max: **23.81 m** (fly tower in north strip) | Hexastyle portico with pediment (ridge 'z') facing south (+z) onto 27 Grudnia; stage fly tower in north strip (−z) | Top: **23.9 m**<br>Portico eaves/pediment: 12.7 / 16.5 m<br>Foyer roof: 17.2 m<br>Fly tower: 23.9 m |
| **Collegium Maius** | `relation/1021065`<br>x: −1012.5, z: −138.0<br>90.4 × 69.2 m, ang −19.6° | 74.0 m | p50: **22.7 m** (wing eaves)<br>p80: **25.5 m** (roof)<br>p95: **29.2 m** (portico drum)<br>max: **36.38 m** (dome lantern in south part) | Monumental central avant-corps, Ionic portico (ridge 'z'), and lantern dome at south (+z) on Fredry; side wings extend north | Top: **36.4 m**<br>Wing eaves/ridge: 16.5 / 23.0 m<br>Portico pediment: 27.5 m<br>Dome lantern: 36.4 m |
| **Kościół św. Franciszka Serafickiego** (Bernardyni) | `way/439910263`<br>x: +239.6, z: +565.1<br>79.8 × 40.9 m, ang −32.4° | 57.0 m | p50: **26.2 m** (nave)<br>p80: **30.9 m** (nave ridge)<br>p95: **35.1 m** (facade pediment)<br>max: **44.68 m** (twin tower helms at west end) | Nave runs E–W along site's long axis (x); twin 44.7 m Baroque towers at west end (−x) on Garbary; south monastery wing | Top: **44.7 m**<br>Nave eaves/ridge: 19.0 / 30.9 m<br>Facade pediment: 35.1 m<br>Twin towers: 44.7 m |
| **Kościół św. Antoniego Padewskiego** (Franciszkanie) | `way/104781037`<br>x: −206.0, z: +30.1<br>50.1 × 43.3 m, ang −8.5° | 66.6 m | p50: **19.1 m** (aisle eaves)<br>p80: **23.1 m** (nave ridge)<br>p95: **25.6 m** (gable crest)<br>max: **32.58 m** (twin spires east of centre) | Nave on east side (+x); twin octagonal copper spires 16 m apart east of centre (x = 4 and 20); convent building on west (−x) | Top: **32.6 m**<br>Nave eaves/ridge: 16.5 / 24.5 m<br>North facade: 26.0 m<br>Twin spires: 32.6 m |
| **Kościół Najświętszej Marii Panny** (in Summo) | `way/238040916`<br>x: +890.9, z: −283.0<br>23.0 × 17.3 m, ang +23.3° | 57.3 m | p50: **19.7 m** (aisle)<br>p80: **25.0 m** (roof)<br>p95: **28.1 m** (gable)<br>ridge max: **28.8 m** (30.3 m is edge tree artifact) | Gothic brick hall church (Hanusz Prusz, 1431–1448) on Ostrów Tumski; nave runs E–W along x, stepped tracery gables at east and west ends | Top: **28.8 m**<br>Nave eaves: 14.5 m<br>Nave ridge: 28.8 m<br>Stepped gables: 28.8 m |
| **Kościół św. Wojciecha** (Skałka Poznańska) | `way/129682752`<br>x: −103.8, z: −562.0<br>35.2 × 25.9 m, ang +7.6° | 72.6 m | p50: **14.7 m** (nave eaves)<br>p80: **19.9 m** (roof ridge)<br>p95: **22.7 m** (gable)<br>max: **23.90 m** (west gable apex) | Nave runs E–W along local x; Renaissance volute gable at west front (−x) reaching 23.9 m; wooden belfry in churchyard | Top: **23.9 m**<br>Nave eaves/ridge: 12.0 / 19.5 m<br>West gable: 23.9 m<br>Wooden belfry: 12.0 m |
| **Kościół Bożego Ciała** | `way/106179574`<br>x: −66.0, z: +879.3<br>62.1 × 39.3 m, ang +8.2° | 57.1 m | p50: **21.8 m** (aisles)<br>p80: **28.5 m** (nave ridge)<br>p95: **31.7 m** (gable screen)<br>max: **39.54 m** (ridge flèche mid-length) | Soaring Gothic basilica; nave runs E–W along x; 7-tier stepped pinnacle gable on west facade (−x); copper flèche at mid-length reaches 39.5 m | Top: **39.5 m**<br>Aisle eaves: 11.5 m<br>Nave eaves/ridge: 19.0 / 31.0 m<br>West gable: 34.0 m<br>Ridge flèche: 39.5 m |

## Architectural notes & modeling implementation

1. **Biblioteka Raczyńskich:**
   Rusticated sandstone ground floor ($y = 0 \dots 4.0$ m), monumental 24-column Corinthian colonnade ($y = 4.0 \dots 14.5$ m) facing south (+z) onto Plac Wolności, entablature beam, attic balustrade screen ($14.5 \dots 15.7$ m), and low zinc hipped roof reaching interior top 18.6 m.
2. **Pałac Działyńskich:**
   Classical palace running E–W along the lot. Ground floor base ($0 \dots 4.0$ m) and upper storeys ($4.0 \dots 15.8$ m). East facade (+x) facing Stary Rynek features central avant-corps, triangular pediment (ridge 'x'), and decorative attic crowned by the gilded pelican sculpture at 22.25 m.
3. **Hotel Bazar:**
   L-shaped footprint with north wing along Paderewskiego ($71 \times 14$ m) and south wing along Marcinkowskiego ($36 \times 24$ m). Prominent corner rotunda and Baroque copper dome at northeast (+x, −z) reaching 24.4 m.
4. **Muzeum Narodowe (Gmach Główny):**
   High historic building ($63.4 \times 42$ m) stands at the south end (+z, Paderewskiego) with rusticated arcade base ($0 \dots 5.5$ m), piano nobile with Ionic order, and central avant-corps with pediment facing south (ridge 'z') reaching 26.0 m. North exhibition halls extend northward ($50 \times 102$ m).
5. **Teatr Polski:**
   Foyer block and hexastyle portico with triangular pediment (ridge 'z') face south (+z) onto ul. 27 Grudnia ($0 \dots 16.5$ m). Higher auditorium and stage fly tower block in the north strip (−z) reach 23.9 m.
6. **Collegium Maius:**
   Large neo-Renaissance palace ($90.4 \times 69.2$ m). Main 3-storey south wing along Fredry (+z) holds the central avant-corps, Ionic portico (pediment ridge 'z'), and octagonal drum with lantern dome reaching 36.4 m. Side wings extend north around the courtyard (−z).
7. **Kościół św. Franciszka Serafickiego (Bernardyni):**
   Nave runs E–W along the site's long axis ($76 \times 18$ m, ridge 30.9 m). Multi-tier Baroque facade screen and twin Baroque towers with copper helms at the west end (−x) on Garbary reach 44.7 m. South monastery wing ($36 \times 20$ m).
8. **Kościół św. Antoniego Padewskiego (Franciszkanie):**
   Nave ($42 \times 22$ m) runs along the east side (+x). Twin octagonal openwork copper spires (32.6 m) stand 16 m apart east of centre at the north front. Convent wing on the west slope (−x).
9. **Kościół Najświętszej Marii Panny (in Summo):**
   Gothic brick hall church (Hanusz Prusz, 1431–1448) on Ostrów Tumski. Nave runs E–W along local x ($23 \times 15$ m), steep red tile gable roof along x reaching 28.8 m, with stepped Gothic traceried gables at east (+x) and west (−x) ends.
10. **Kościół św. Wojciecha (Skałka Poznańska):**
    Nave runs E–W along local x ($32 \times 15$ m) with Renaissance volute gable at the west front (−x) reaching 23.9 m. Freestanding wooden belfry in the churchyard.
11. **Kościół Bożego Ciała:**
    Massive Gothic basilica with nave running E–W along local x ($58 \times 26$ m). West facade (−x) features 7-tier stepped pinnacle gable (34.0 m). Central copper flèche at mid-length ridge reaches 39.5 m.
