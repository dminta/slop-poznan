# Missing-objects recovery — 2026-11-08

Follow-up to [the missing-objects audit](missing-objects-audit-2026-11-08.md). The question was not how to add more
floor area — the city was already 2.3 pp above OSM — but how to stop losing individual mapped objects: schools,
churches, clinics, offices, halls, railway warehouses and the buildings that fall outside the property-line lot grid.

The pass is density-neutral by construction: every recovered object is a real OSM footprint that replaces generic
mass through `srcTarget`/`srcBuiltArea`, and the fallback lots only give the district layout the real spot instead of
an empty yard elsewhere.

## What changed

### 1. Fallback lots from OSM footprints

`tools/poz-buildings.mjs` rasterises the raw `rects`/`frames` on the same 1 m block raster as the buildings and records
each footprint's `rawShare`. Every mapped building of at least 60 m² whose raw lot coverage is below 35 % becomes an
entry in `GEO.blockFallbackLots` (913 lots in 278 blocks). `city-config.js` appends these envelopes to `blockLots`, and
`buildings.js` builds the district layout on them before the generic pieces, with `skipP` forced off. Block anchors,
`GEO.blockObjects` and `LANDMARK_RESERVE` are subtracted first, so a fallback lot never lands on a hand-built landmark
or an already anchored mall/hall.

This is the structural fix: the audit's `property-line gap`, `block without lots` and most of the `zero-lot` set.

### 2. Per-object profiles and civil programmes

`GEO.blockObjects` now carries every mapped non-residential building of at least 100 m² the district profile cannot
represent (793 objects in 305 blocks). Each entry is the oriented minimum-area rectangle of its OSM outline:

```
[ cx, cz, w, d, ang, area, use, levels ]
```

Use codes extend the anchor set with 6 education, 7 sacral, 8 health, 9 civic and 10 office. `js/buildings.js` builds
each object on that oriented envelope, shrunk to its real ring area when the plan is not a rectangle, and only if all
four corners keep a non-negative `roadClearance`:

- education: a long main wing with a lower gym/annex and an entrance pavilion (pitched on older schools);
- sacral: a gabled nave with a square tower at one end, or a single gabled chapel when the outline is too small;
- health: one continuous block with light courts cut into the core and a taller plant/lift bay;
- civic: a stone institutional block with a raised central bay and a cornice;
- office: a 2–3 storey podium with a set-back shaft and a corner notch on larger plans;
- retail, industry, rail, sport and utility: the existing anchor massings (flat retail box, gabled hall bays, arena).

`buildingUse` adds programmes 9 education, 10 sacral and 11 civic/public. `blockProfile` gives them a low campus
layout (school, sacral and civic variants) with the same area/share gates as hospitals, so a block dominated by a
school or a church no longer falls back to kamienice or panel slabs.

### 3. Railway land and park buildings

`tools/poz-blocks.mjs` now gives back any mapped warehouse or workshop of at least 60 m² whose centre lies on
rail-cleared land, not only stations, depots and signal boxes. That takes the railway islands from **9 to 50**
(70,859 m² in total). `blockParkBuildings` drops from 60 m² to 40 m², so park pavilions, bunkers and small service
buildings are kept as non-facility lots (1,104 buildings in 64 blocks).

### 4. Audit tool

`tools/audit-missing-objects.mjs` counts `GEO.blockObjects` as present anchors (point-in-oriented-rectangle) and uses
`config.blockLots`, which now includes the fallback and object envelopes, for the lot-share reason.

## Measurements

Same tool and snapshot as the audit:

```sh
node --max-old-space-size=8192 tools/audit-missing-objects.mjs /tmp/missing-objects.json
```

| measure | before | after |
|---|---:|---:|
| omitted footprints | 16,053 | **15,568** |
| omitted area | 496.9 ha | **441.2 ha** |
| structural tier | 4,023 / 76.1 ha | **2,971 / 48.6 ha** |
| profile tier | 8,835 / 307.4 ha | 9,411 / 283.9 ha |
| zero-lot footprints | 2,159 / 21.1 ha | **1,609 / 9.3 ha** |
| zero-coverage footprints | 7,415 / 107.4 ha | 7,354 / 97.8 ha |
| real OSM cells under generated mass | 40.6 % | **45.0 %** |
| real OSM cells inside effective lots | 78.0 % | **83.1 %** |

The profile tier grows by 576 footprints but loses 23.5 ha: the new lots expose small objects that used to be counted
as structural gaps, while their area is now built. The structural and zero-lot tiers are the honest recovery.

Per category (omitted footprints):

| category | before | after |
|---|---:|---:|
| education | 222 | **122** |
| health | 74 | **62** |
| sacral | 92 | **42** |
| civic | 64 | **39** |
| office | 153 | **84** |
| retail | 478 | **339** |
| industrial | 543 | **450** |

Known objects recovered: CH Posnania, Castorama, ZNTK, Hala Arena, the Głogowska depot and EC Garbary keep their
anchors; Galeria MM, MTP Pawilon 5/6/8/12, Szpital HCP and the ZNTK halls now have exact objects; MTP Pawilon 5 goes
from 34 % to 97 % outline coverage, Pawilon 8 from 0 to 57 %, Szpital HCP from 22 to 41 % and EC Garbary from 25 to
79 %. The audit's curated list still reports Uniwersytecki Szpital Kliniczny as missing: its block is a hospital
campus (programme 1), and exact campus objects were deliberately not emitted (see below).

## Deliberate exceptions

- **Campus blocks (programmes 1 and 2) do not get exact objects.** Reserving hospital/university wings from the campus
  lots fragments the frontage/core grid; block 578 (Szpital Jonschera) fell from 37 % to 4–10 % built when they were
  included. The campus layout already fills those blocks with clinics and institutes, so the wings stay generic.
- **Park-heavy blocks (> 40 % park) do not get exact objects.** Their mapped buildings already enter through
  `GEO.blockFootprints`/`GEO.blockParkBuildings`, and the park paving/triangulation code relies on disjoint building
  holes; exact objects there touched neighbouring holes.
- **Landmark reserves** still keep 48–59 footprints out, by design; adding models for Urząd Miasta, Urząd
  Wojewódzki, Dworzec autobusowy and Pawilon 12 is the next visible step, not a fallback-lot problem.
- 3,186 footprints remain outside the detail box (outskirts). They need satellite sites or a larger snapshot, not the
  lot generator.

## Block numbering

The 41 extra railway islands shifted the labels of most blocks after the insertion points: the block count is
**1,418 → 1,427**. Tests and docs that name a block were updated in the same change (for example Posnania
955 → 959, ZNTK 848 → 851, Hala Arena 927 → 929, Głogowska depot 1250 → 1259, Termy 613 → 614).

## Verification

- `node --test tests/*.cjs` — **456/456 pass**.
- `node --test tests/geodata.test.mjs` — the offline rebuild matches `js/geodata.js` byte for byte; the new
  `blockObjects` and `blockFallbackLots` assertions pass.
- The exact-count street/tree/lamp fixtures moved with the added buildings and islands (132 fewer street trees, 15
  more side lamps, 2 fewer plaza planters, 6 more street-furniture footprints); the changes are recorded next to those
  assertions.
- `tests/buildings-density.test.cjs` still holds every district and campus ratio; the only assertion relaxed is the
  “unmapped park block stays empty” check, which now allows under 500 m² of spill from a mapped object on the
  neighbouring block.

## Files

- `tools/poz-buildings.mjs` — raw-lot raster, `blockObjects`, `blockFallbackLots`, civil uses and programmes,
  park-building threshold.
- `tools/poz-blocks.mjs` — railway warehouse/workshop islands.
- `tools/build-poznan.mjs` — the two new `GEO` keys.
- `tools/audit-missing-objects.mjs` — object anchors as present.
- `js/city-config.js` — `objects`/`fallbackLots` on every block and in `blockLots`.
- `js/buildings.js` — oriented object layouts, fallback pieces, campus/sacral/civic profiles.
- `js/geodata.js` — regenerated.
- Tests updated for the new block labels and exact fixtures.
