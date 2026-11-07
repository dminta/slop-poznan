# Building density and campus complexes — 2026-11-07

Follow-up to the backlog item on the visibly low density along Bukowska, Marcelińska and the hospital/university
grounds. The baseline and the change were measured headlessly with the `tests/buildings-density.test.cjs` raster
(2 m cells over `CITY_BOUNDS`, each footprint counted once for the block under its centre) against `GEO.blockStats`
(OSM footprints on the 1 m block raster).

## What the baseline showed

The block ids named in the backlog still line up with the current geodata, but the OSM use tags do not always match
the old label: block 666 is mostly a residential/outpatient block (one named `Wojskowa Specjalistyczna Przychodnia
Lekarska`), while blocks 577, 807, 827 and 1121 carry the hospital tags (Szpital Jonschera, Szpital Święcickiego,
Uniwersytecki Szpital Kliniczny, Szpital Strusia). The generator was the problem, not OSM completeness: large blocks
below 0.8 of the kamienica share got `noCore` and `inner = [['yard', 1]]`, so 100–150 m interiors were left as one
flat yard, and campuses in villa districts (Ogrody) fell into `RES_VILLAS`.

Measured before the change:

| block | area ha | OSM built | generated | generated / real | layout problem |
| ---: | ---: | ---: | ---: | ---: | --- |
| 666 | 16.2 | 21 % | 14.9 % | 0.71 | Łazarz kamienica, `q = 0.75`, `noCore` |
| 577 | 8.6 | 37 % | 47.7 % | 1.29 | Jeżyce kamienica, `q = 1.32`, dense infill |
| 427 | 9.9 | 22 % | 23.8 % | 1.08 | Ogrody villas, no campus use |
| 476 | 9.3 | 15 % | 15.4 % | 1.03 | Ogrody villas, park 31 %, no campus use |
| 807 | 15.8 | 21 % | 14.9 % | 0.71 | Stary Grunwald kamienica, `noCore` |
| 827 | 4.7 | 50 % | 41.8 % | 0.84 | Stare Miasto kamienica |
| 1121 | 33.9 | 18 % | 18.3 % | 1.02 | Rataje estate |
| 1144 | 28.8 | 12 % | 15.8 % | 1.32 | Chartowo estate |

## What changed

1. **Campus program from OSM.** `tools/poz-buildings.mjs` classifies each footprint from `building`, `amenity`,
   `healthcare`, `office` and names (Szpital, Klinika, Przychodnia, Collegium, Uniwersytet, Akademia, Instytut) and
   adds a fourth `blockStats` value, `program`: 0 none, 1 hospital/clinic, 2 university. A block needs two public
   buildings, or one hospital building on a 4–40 ha block with at most 25 % built. `js/city-config.js` exposes it as
   `BLOCKS[i].program`; the generated `js/geodata.js` was rebuilt.
2. **Campus profile and layout.** `blockProfile` returns `HOSPITAL` or `UNIVERSITY` before the osiedle switch, but
   not on park blocks (`park > 0.5`). `steerProfile` gives the campus the block's real built share over its lot area,
   like the villas. `campusBlock` spends that budget on 2–5-storey institutional blocks along the street frontage
   (60 %) and then on clinics/institutes in a 12–18 m alley grid inside the block; frontage-frame slivers get one
   small hall (`campusShed`) sized to the remaining budget. University buildings get a minority of pitched roofs and
   some balcony stacks (dormitories); hospitals stay flat-roofed with plant rooms.
3. **Graduated core for large blocks.** The blanket `noCore = q < 0.8` is now `noCore = q < 0.5`. A non-park block of
   at least 5 ha with at least 20 mapped buildings keeps its core between 0.5 and 0.8, with low pavilions, rear
   houses, a workshop and a quarter green. This is what lifts block 666 and 807 even where the OSM use tags are too
   sparse to call a campus.

## Measurements after the change

| block | generated / real | before | note |
| ---: | ---: | ---: | --- |
| 666 | 20.6 / 21 % (0.98) | 14.9 / 21 % | campus + graduated core |
| 577 | 36.4 / 37 % (0.98) | 47.7 / 37 % | hospital campus |
| 427 | 22.5 / 22 % (1.02) | 23.8 / 22 % | hospital campus replaces villas |
| 476 | 14.5 / 15 % (0.97) | 15.4 / 15 % | hospital campus, park kept out |
| 807 | 19.7 / 21 % (0.94) | 14.9 / 21 % | hospital campus |
| 827 | 35.7 / 50 % (0.71) | 41.8 / 50 % | dense central hospital; layout still short of 50 % |
| 1121 | 16.7 / 18 % (0.93) | 18.3 / 18 % | hospital campus |
| 1144 | 11.1 / 12 % (0.93) | 15.8 / 12 % | hospital campus |

District totals on the same raster (generated / real): Łazarz 31.3 / 26.5 %, Jeżyce 34.4 / 30.8 %, Stary Grunwald
22.3 / 22.5 %, Grunwald Północ 22.0 / 19.3 %, Ogrody 16.9 / 15.9 %, Górczyn 27.2 / 21.7 %. These districts were already
above their OSM share before the change (Łazarz 30.9, Jeżyce 34.5, Ogrody 17.3); the campus work moves the named
blocks to their own real share without adding a district-wide jump.

The campus blocks also take balconies away from the kamienice they replace. The city-wide pool moved from about
16.5 k stacks / 48 k landings to 15.2 k / 44.6 k, still well inside the 2,400-stack and 256-near-landing runtime caps;
`tests/buildings-density.test.cjs` now records the lower expected range.

## Verification

- `node --test tests/buildings-density.test.cjs` — 8/8 pass. The district test now also asserts that blocks 666, 577,
  427 and 476 are `program = 1` and within ±20 % of their real built share.
- `node --test tests/*.cjs` — 420/420 pass.
- `node --test tests/` also includes the geodata rebuild test; the new `blockStats` fourth field was rebuilt and is
  covered by the existing shape checks.
- No browser check was performed. The campus layout, roof/balcony mix and the view along Bukowska/Marcelińska still
  need a WebGPU/WebGL2 look.

## Remaining causes from the backlog

1. **Unnamed service cuts.** The global rule still drops 4,484 unnamed `highway=service` pieces, because stamping all
   of them cut 1,154 blocks against 802 and mostly produced courtyard slivers (258 blocks under 300 m² against 193).
   The campus layout now supplies the missing interior structure with its alleys, but a named/major-service rule
   inside blocks over 5 ha is still untried and would need a block-raster rebuild and a block-id review.
2. **`maskRects` cap.** The 8-rect lot cap remains. The campus profile builds on the existing lots; how much of an
   irregular campus interior the cap still leaves uncovered was not measured after the profile change. Raising the
   cap for blocks over 5 ha would change the generated lot rectangles (and some block-based clearance tests) and needs
   its own measurement.
3. **Detail box west edge.** `detailBox` still ends at x = −3,675.4, so King Cross, Business Garden and Ławica stay in
   the coarse outskirts. Moving it would require new Overpass snapshots, a rebuild of every layer and a re-check of the
   outskirts zones; not started.
4. **OSM vs BDOT10k.** The 2026-11-04 audit of the 36 large sparse blocks
   ([sparse-blocks-2026-11-04](sparse-blocks-2026-11-04.md)) found no OSM omission: BDOT10k exceeded OSM by at most
   0.08 percentage points in any block, and BDOT's building count was lower almost everywhere. The Bukowska campuses
   are not sparse blocks, so this item is closed as "no data supplement needed" until a new snapshot says otherwise.

Files changed: `tools/poz-buildings.mjs`, `tools/build-poznan.mjs` (contract comment), `js/geodata.js` (regenerated),
`js/city-config.js`, `js/buildings.js`, `tests/buildings-density.test.cjs`, `docs/world.md`, `docs/geodata.md`,
`docs/backlog.md` and this record.
