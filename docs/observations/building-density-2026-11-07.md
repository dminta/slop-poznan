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
2. **Campus profile and layout.** `blockProfile` returns `HOSPITAL` or `UNIVERSITY` before the osiedle switch only
   for large, sparse campuses (`area >= 5 ha && built <= 0.4`, not a park block). Dense central blocks that OSM tags as
   campuses keep their district profile: the campus grid cannot spend their steep share on fragmented lots and would
   build less than before (see the gated blocks below). `steerProfile` gives the campus the block's real built share
   over its lot area, like the villas. `campusBlock` spends that budget on 2–5-storey institutional blocks along the street frontage
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

Dense central blocks with a campus tag are excluded by the `area >= 5 ha && built <= 0.4` gate, so the campus layout
cannot underfill them. Their generated share returns to the pre-change district result:

| block | district | area ha | real | before | with the gate | program |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 192 | Stare Winogrady | 2.3 | 33 % | 43.4 % | 43.4 % | 2 |
| 814 | Stare Miasto | 3.9 | 40 % | 26.4 % | 26.4 % | 2 |
| 769 | Stare Miasto | 12.0 | 50 % | 39.1 % | 39.1 % | 2 |
| 827 | Stare Miasto | 4.8 | 50 % | 41.8 % | 41.8 % | 1 |
| 579 | Stare Miasto | 3.0 | 49 % | 38.5 % | 38.5 % | 2 |
| 733 | Stare Miasto | 4.0 | 37 % | 42.9 % | 42.9 % | 2 |
| 582 | Stare Miasto | 2.5 | 27 % | 30.1 % | 30.1 % | 2 |
| 221 | Sołacz | 3.6 | 18 % | 18.8 % | 18.8 % | 2 |

The campus blocks also take balconies away from the kamienice they replace. The city-wide pool moved from about
16.5 k stacks / 48 k landings to 15.4 k / 45.3 k, still well inside the 2,400-stack and 256-near-landing runtime caps;
`tests/buildings-density.test.cjs` now records the lower expected range and guards the four gated blocks against a
regression below their pre-change share.

## Verification

- `node --test tests/buildings-density.test.cjs` — 8/8 pass. The district test now also asserts that blocks 666, 577,
  427 and 476 are `program = 1` and within ±20 % of their real built share, and that the gated blocks 192, 814, 769
  and 827 stay at or above their pre-change share.
- `node --test tests/*.cjs` — 420/420 pass at the time; 428/428 on the 2026-11-08 follow-up.
- `node --test tests/geodata.test.mjs` — pass; its `blockStats` shape check now destructures the fourth field and
  requires `program` to be 0, 1 or 2, with at least five hospital and five university blocks in the snapshot.
- The 2026-11-08 follow-up performed the browser check on WebGPU and WebGL2 and measured the `maskRects` cap and the
  service-road question; see [below](#follow-up-2026-11-08-visual-review-lot-cap-and-service-alleys).

## Follow-up 2026-11-08: visual review, lot cap and service alleys

### Visual review

Chrome 157 (headless, 1440 × 757) loaded the full scene on WebGPU (Apple `metal-3`) and on the WebGL2 fallback through
`?backend=webgl`; the canvas context confirmed `webgl2` on the second run. The five named blocks were inspected from a
free aerial camera 280–330 m up looking down at 45–55°, from street level along Bukowska, Marcelińska, Grodziska and
Szpitalna (chase and low-angle cameras), and on the full street map at 50 m scale. University block 622 was added for
the pitched-roof/balcony comparison.

- The interior pavilion rows and their 9–16 m clear alleys are visible in all five named blocks; 577 (37 % built) is
  the densest, while 666/807 (21 %) and 476 (15 %) keep the expected lawns between the rows. The map view shows the
  same grid of footprints and alleys, not one flat yard.
- Hospital blocks keep mostly flat roofs with small plant rooms (the dark boxes on the roofs) and only a minority of
  pitched roofs; university block 622 mixes pitched roofs and balcony stacks.
- No building crossed a curb or sidewalk: the frontage blocks stay behind the 4.6 m lot inset, and the walking views
  showed clear sidewalks and crossings. No floating parts, z-fighting or missing facades were seen on either backend,
  and neither run logged a console or shader error.
- The open lawns are not a missing-lot artefact. The named blocks build 15–37 % of their area and the rest is lawn,
  alley and parking; the frame rects cover 90.6–93.4 % of the property-line area inside those blocks.

### `maskRects` cap (8 lot rects)

Measured on the same 1 m property-line raster as `maskRects`, at the current caps and with the lot/frame caps raised to
16/18/16 and 24/24/22:

| block | area ha | program | frame rects | lot rects | frame coverage | largest gap m² |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 427 | 9.9 | 1 | 19 | 4 | 91.5 % | 272 |
| 476 | 9.3 | 1 | 2 | 6 | 93.4 % | 125 |
| 577 | 8.6 | 1 | 6 | 7 | 90.6 % | 252 |
| 666 | 16.2 | 1 | 35 | 4 | 91.5 % | 352 |
| 807 | 15.8 | 1 | 27 | 6 | 93.0 % | 240 |

The largest gap is the largest axis-aligned rectangle of uncovered property-line cells, not a missing buildable lot.
All 27 `program > 0` blocks of at least 5 ha are irregular and use frontage frames, so the 8-lot cap is not on their
path; the frame path's own caps are 12/10. Raising the frame caps from 12/10 to 18/16 changes the rect sets of 8 of the
27 blocks and the coverage by -0.65 to +1.14 pp (7 +0.44, 11 +0.68, 14 +0.79, 568 +1.14, 769 +0.49, 900 +0.03,
1121 -0.65, 1187 0.00); 18/16 and 24/22 give identical rects, so 18/16 is the saturation point and the gain is small
sliver lots at the top of the range. Keep 12/10 and the 8-lot cap. (The 27-block average is 85.6 %, range 71.5–93.4 %;
the low end is park-heavy or very large blocks such as 568 20 % park, 1144 42 % and 209 45 %.) Filling more would
require the 18/16 caps or lowering the 2 % threshold/93 % guard, adding sliver lots and changing the block-based
clearance tests for no measured benefit.

### Unnamed service roads

The global rule still drops 4,484 unnamed `highway=service` pieces. Stamping all of them cut 1,154 blocks against 802,
mostly courtyard slivers (258 blocks under 300 m² against 193; 300–2,000 m² 289 against 143). Named service roads
(167 pieces) remain stamped. The review shows `campusBlock` supplies the interior structure with its frontage blocks,
pavilion rows and alleys, and `campusShed` fills the frontage slivers; no campus needed a service-road cut to reach its
interior and no block was split into unnamed-service slivers. No change to the road-stamping rule.

## Remaining causes from the backlog

1. **Unnamed service cuts — closed 2026-11-08.** The global rule still drops the 4,484 unnamed `highway=service` pieces,
   but the campus review shows the alley grid and `campusShed` supply the interior structure and no service cut is
   needed inside these blocks. A named/major-service rule remains untried and would need a block-raster rebuild; it is
   not required for the Bukowska/Ogrody campuses.
2. **`maskRects` cap — closed 2026-11-08.** The 8-rect cap is not binding: all campus blocks of at least 5 ha use
   frontage frames, and raising the lot/frame caps changes neither the rects nor the coverage. Keep the cap at 8.
3. **Detail box west edge.** `detailBox` still ends at x = −3,675.4, so King Cross, Business Garden and Ławica stay in
   the coarse outskirts. Moving it would require new Overpass snapshots, a rebuild of every layer and a re-check of the
   outskirts zones; not started.
4. **OSM vs BDOT10k.** The 2026-11-04 audit of the 36 large sparse blocks
   ([sparse-blocks-2026-11-04](sparse-blocks-2026-11-04.md)) found no OSM omission: BDOT10k exceeded OSM by at most
   0.08 percentage points in any block, and BDOT's building count was lower almost everywhere. The Bukowska campuses
   are not sparse blocks, so this item is closed as "no data supplement needed" until a new snapshot says otherwise.

Follow-up verification: `node --test tests/buildings-density.test.cjs` 8/8 and `node --test tests/*.cjs` 428/428.
The 2026-11-08 review changed documentation and one comment in `js/buildings.js`; no generator or layout behavior
changed.

Files changed: `tools/poz-buildings.mjs`, `tools/build-poznan.mjs` (contract comment), `js/geodata.js` (regenerated),
`js/city-config.js`, `js/buildings.js`, `tests/buildings-density.test.cjs`, `docs/world.md`, `docs/geodata.md`,
`docs/backlog.md` and this record.
