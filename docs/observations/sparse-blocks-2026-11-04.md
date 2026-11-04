# Sparse OSM blocks audit — 2026-11-04

Re-audit of the "Sparse OSM blocks" item from `docs/backlog.md` (Phase 14.3) over the current 8.2 × 5.7 km
detail box. The original audit found nine large blocks under 5 % OSM building coverage covering 0.69 km²; this
run asks whether any of the current sparse blocks is a real mapping omission that needs a BDOT10k supplement.

## Scope and threshold

- **OSM input:** the committed `tools/data/poz_buildings.json` snapshot (OSM base 2026-10-28) and
  `GEO.blockStats` from the same build.
- **Detail box:** 52.383–52.434 N, 16.880–17.000 E; x −3,675…4,491, z −2,831…2,844; 46 km².
- **Large block:** curb-island area **≥ 20,000 m² (2 ha)**. Sparse: `GEO.blockStats` built share **< 5 %**.
- Of 1,422 blocks, **36** meet both conditions, covering **7.96 km²**. The threshold is deliberately inclusive;
  the original nine blocks averaged 7.7 ha, so they are inside it. The count is larger now because the enlarged
  box adds large parks, forests, cemeteries and allotments at its edges, not because new built-up blocks appeared.

## Sources and licence

**BDOT10k buildings (`OT_BUBD_A`, class BUBD):**

- Package: `https://opendata.geoportal.gov.pl/bdot10k/schemat2021/SHP/30/3064_SHP.zip` (powiat Poznań, TERYT
  3064), SHP, 32 MB, downloaded 2026-11-04. Only `OT_BUBD_A` was read.
- The layer's DBF carries per-record `WERSJA` / `POCZ_WERSJ` and `ZRO_DANYCH = EGiB` (first record
  `WERSJA = 2024-11-06`); the package's other layers run up to 2026-04. Buildings therefore come from the
  national EGiB cadastre, not from a rendering.
- Licence wording on the geoportal page
  ([BDOT10k](https://www.geoportal.gov.pl/pl/dane/baza-danych-obiektow-topograficznych-bdot10k/), accessed
  2026-11-04), quoted exactly:
  - "Baza BDOT10k jest dostępna bezpłatnie i możliwa do dowolnego wykorzystania."
  - "Wprowadzone od 31 lipca 2020 r. uwolnienie danych BDOT10k powoduje, że dzisiaj każdy może w łatwy sposób
    wykorzystywać te dane do dowolnych celów."
- **ODbL compatibility:** the terms grant use for any purpose without a share-alike or attribution condition, so
  BDOT10k may be combined with ODbL OSM data and the combined database distributed under ODbL. OSM attribution
  remains required for the OSM part. No supplement was added, so `README.md` and the `js/geodata.js` header keep
  their existing OSM-only attribution. If data were added later, the GUGiK source would need to be named there
  as well.

**Orthophoto sanity check:** GUGiK WMS `.../PZGIK/ORTO/WMS/HighResolution`, layer `Raster`, CRS:84, 512 px
GetMap images per candidate block (same free-for-any-use GUGiK terms). Images were inspected visually and kept
outside the repository.

Raw downloads live in a temporary folder outside the repo and are not committed.

## Method

1. Read `OT_BUBD_A` polygon records directly from the SHP (outer rings minus holes, area from the signed ring
   sum). Converted EPSG:2180 (PL-1992, GRS80, lon₀ 19°, k 0.9993, FE 500000, FN −5,300,000) to lon/lat with the
   inverse Transverse Mercator, then to the sim frame with `GEO.frame.ll`.
2. Assigned each BDOT footprint to a block by its area centroid (the same rule `poz-buildings.mjs` uses for OSM),
   with a block-bbox prefilter. Summed footprint area per block and divided by the block area.
3. Compared OSM `blockStats` built share and building count with the BDOT area/count for all 36 blocks.
4. Pulled an orthophoto for every non-obvious block to separate "genuinely empty" from "buildings missing from
   both datasets".

## Results

Coverage is OSM / BDOT; buildings are OSM / BDOT counts. The OSM built column is the committed
`GEO.blockStats` raster share (rounded to 0.01), so `0.0 %` is a share below 0.5 %. For the delta test below I
also recomputed OSM footprint area with the same centroid rule used for BDOT, which avoids that rounding.

| id | centre (lat, lon) | area ha | OSM built | BDOT built | buildings | landuse / classification |
|---:|---|---:|---:|---:|---:|---|
| 614 | 52.39781, 16.99317 | 134.1 | 3.0% | 2.33% | 138 / 97 | park + allotments + forest (Polana Harcerza) |
| 613 | 52.40349, 16.96993 | 96.2 | 4.0% | 4.39% | 105 / 76 | park (Park Tysiąclecia) |
| 151 | 52.42233, 16.95616 | 72.9 | 0.0% | 0.38% | 16 / 12 | meadow, Warta floodplain |
| 946 | 52.39126, 16.93755 | 62.9 | 3.0% | 2.48% | 54 / 38 | allotments (ROD Bielniki) + meadow |
| 256 | 52.42034, 16.99074 | 50.1 | 1.0% | 0.73% | 33 / 40 | cemetery (Miłostowo) + allotments |
| 251 | 52.42042, 16.93416 | 47.3 | 0.0% | 0.25% | 14 / 2 | park (Park Cytadela) |
| 0 | 52.42621, 16.88459 | 45.9 | 3.0% | 2.92% | 38 / 68 | forest/meadow (Las Golęciński) |
| 1164 | 52.38745, 16.92597 | 40.9 | 1.0% | 0.30% | 94 / 5 | park (Park Jana Pawła II) + allotments |
| 262 | 52.42091, 16.90126 | 29.3 | 3.0% | 2.12% | 66 / 60 | park (Park Sołacki) |
| 32 | 52.43067, 16.96714 | 29.1 | 1.0% | 0.35% | 9 / 4 | forest |
| 347 | 52.41619, 16.99379 | 25.9 | 0.0% | 0.15% | 9 / 3 | cemetery (Miłostowo) + allotments |
| 31 | 52.43106, 16.96398 | 17.1 | 0.0% | 0.00% | 0 / 0 | meadow, Warta floodplain |
| 257 | 52.42221, 16.99680 | 15.0 | 0.0% | 0.00% | 2 / 0 | cemetery (Miłostowo) |
| 1240 | 52.38620, 16.90034 | 12.8 | 2.0% | 1.68% | 40 / 40 | brownfield (former ROD) + scrub |
| 1056 | 52.39158, 16.88291 | 12.3 | 0.0% | 0.14% | 3 / 2 | allotments (ROD Chociszewskiego) |
| 305 | 52.41878, 16.92662 | 9.1 | 1.0% | 0.68% | 6 / 3 | park (Skwer Sybiraków) |
| 217 | 52.42438, 16.99665 | 8.8 | 0.0% | 0.00% | 1 / 0 | cemetery (Miłostowo) + railway |
| 1197 | 52.38856, 16.90235 | 8.1 | 0.0% | 0.24% | 2 / 2 | allotments (ROD Kopczyńskiego) |
| 296 | 52.41999, 16.94050 | 7.4 | 0.0% | 0.11% | 1 / 1 | park (Park Cytadela) |
| 272 | 52.42243, 16.93960 | 7.4 | 2.0% | 1.45% | 6 / 3 | park (Park Cytadela) |
| 1215 | 52.38632, 16.99111 | 7.2 | 0.0% | 0.00% | 0 / 0 | meadow / green slope |
| 1046 | 52.39391, 16.93504 | 7.1 | 2.0% | 1.74% | 6 / 5 | park/green (Cytadela edge) |
| 780 | 52.40517, 16.98186 | 5.5 | 0.0% | 0.00% | 0 / 0 | railway buffer / green |
| 817 | 52.40279, 16.91975 | 4.9 | 0.0% | 0.13% | 1 / 1 | park (Park Marcinkowskiego) |
| 902 | 52.40035, 16.92318 | 4.8 | 4.0% | 3.73% | 5 / 4 | park (Park Drwęskich) |
| 212 | 52.42257, 16.92080 | 4.3 | 0.0% | 0.00% | 0 / 0 | park/green (Cytadela) |
| 411 | 52.41362, 16.88797 | 4.3 | 4.0% | 4.06% | 17 / 16 | allotments (ROD Jutrzenka) |
| 871 | 52.40087, 16.91721 | 3.8 | 0.0% | 0.00% | 1 / 0 | car park / paved yard |
| 588 | 52.40925, 16.99661 | 3.6 | 0.0% | 0.00% | 0 / 0 | park/green + railway |
| 787 | 52.40439, 16.91762 | 3.4 | 0.0% | 0.36% | 1 / 1 | park (Park Marcinkowskiego) |
| 15 | 52.43011, 16.91986 | 2.7 | 0.0% | 0.00% | 0 / 0 | park/green |
| 254 | 52.42397, 16.93193 | 2.6 | 0.0% | 0.00% | 0 / 0 | park (Park Cytadela) |
| 361 | 52.41695, 16.93606 | 2.5 | 1.0% | 0.00% | 7 / 0 | forest / railway edge |
| 598 | 52.40862, 16.91671 | 2.5 | 0.0% | 0.00% | 1 / 0 | park (Park Mickiewicza) |
| 304 | 52.42082, 16.93645 | 2.3 | 0.0% | 0.00% | 0 / 0 | park (Park Cytadela) |
| 243 | 52.42471, 16.93094 | 2.1 | 0.0% | 0.00% | 0 / 0 | park (Park Cytadela) |

### Findings

- **No real omission was confirmed.** With both datasets assigned by footprint centroid, BDOT coverage exceeds
  OSM by at most **0.08 percentage points** in any block (block 256, 0.73 % vs 0.65 %). The only other positive
  gaps are 613 (+0.04 pp), 1240 (+0.04 pp), 902 (+0.02 pp) and 787 (+0.01 pp). OSM is ahead in several blocks,
  most visibly 1164 (−0.86 pp), 361 (−0.76 pp) and 257 (−0.40 pp). BDOT's building count is also lower than
  OSM's in almost every block. The largest BDOT count excess is block 0 (68 vs 38), but its area is still lower
  (2.92 % vs 2.96 %): those are small structures, not a missing building cluster.
- **25 of the 36 blocks are parks, cemeteries or forest**, mostly Park Cytadela, Miłostowo, Sołacz, Park
  Tysiąclecia and the western forest edge.
- **The remaining 11 are genuinely empty for a non-building reason:** Warta meadow/floodplain (151, 31),
  allotment gardens with their small sheds (946, 1056, 1197, 411), former allotments now scrub/brownfield
  (1240), green slope (1215), railway buffer (780), forest/railway edge (361), and a car park/paved yard (871).
  The orthophoto for 871 shows parked cars and buses but no building.
- **Nothing was added.** `js/geodata.js`, `tools/data/` and the runtime are unchanged. There is no supplement
  file to test, so no test was added.

The original 0.69 km² / nine-block set cannot be reconstructed one-to-one: block outlines changed after the
2026-10-28 tram-strip and curb-island changes, and the enlarged box added the large green blocks above. The
comparison against BDOT10k gives the same answer for the current box: OSM's sparse blocks are sparse in reality,
not because of missing building data.
