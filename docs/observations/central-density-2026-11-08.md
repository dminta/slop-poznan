# Central density — 2026-11-08

Follow-up to the visible empty courtyards in the centre. The 190 central blocks of Stare Miasto, Jeżyce, Łazarz and
Wilda with at least 35% OSM built share (3.424 km² of land) generated only 40.3% built against 45.3% real; 49 of
them were below 75% of their OSM share. The same headless raster as
[building-density-2026-11-07](building-density-2026-11-07.md) was used: footprints on a 2 m grid over `CITY_BOUNDS`,
each cell counted once for the block under its centre, against `GEO.blockStats`.

## Baseline

| block | district | area ha | OSM built | generated | generated / real |
| ---: | --- | ---: | ---: | ---: | ---: |
| 708 | Stare Miasto | 3.57 | 68.0% | 35.4% | 0.52 |
| 688 | Stare Miasto | 3.19 | 61.0% | 37.3% | 0.61 |
| 801 | Stare Miasto | 0.62 | 70.0% | 35.8% | 0.51 |
| 868 | Stare Miasto | 1.84 | 57.0% | 34.7% | 0.61 |
| 836 | Stare Miasto | 2.04 | 58.0% | 42.1% | 0.73 |
| 1365 | Wilda | 2.72 | 77.0% | 40.0% | 0.52 |
| **190 blocks** | — | **342.4** | **45.3%** | **40.3%** | **0.890** |

The causes were in `js/buildings.js`:

1. `ROW_KINDS.kamienica.depth` capped every dense row at 34 m, so a 50–70 m frontage lot left 16–36 m behind the
   house empty.
2. The core threshold in `residentialBlock` was 16 m across, while `innerBuildings` only needs 8 m. The common
   45–55 m block therefore threw away its 8–15 m interior sliver.
3. A deep courtyard had no transverse oficyna; the L/U/ring plans closed only part of it.
4. The dense inner mix kept the suburban pavilion and a yard (`INNER_RES` = rear 5, works 2, pavilion 2, yard 1.5),
   and its rear rows stood on 11–14 m light courts.
5. `RES_STARE` still drew a low pavilion on 0.6. Its war-gap weight (`gap` 1) did not drive the measured blocks:
   `steerProfile` filters `gap` out of every `q >= 1` dense block, so only the `low` share reached them.

## What changed

1. **Deep dense rows.** A dense `kamienica` row now takes the whole frontage reach, up to `DENSE_REACH` 48 m; it also
   closes the 0–6 m slit that two back-to-back rows left through a 50–60 m block.
2. **Transverse oficyny.** For dense lots with `rear >= 22 m`, `kamienica()` adds a 6–8.5 m cross wing through the
   courtyard: it splits a long yard into two studnie on U/ring plans, or closes all but one light well on an L plan.
   It is placed clear of the side wings, the front house and the ring's rear bar, so every part stays a
   non-overlapping box.
3. **Dense cores.** `residentialBlock` counts a core from 8 m across in a dense profile (14 m elsewhere), and its inset
   uses `DENSE_REACH` 48 m for dense rows instead of `ROW_REACH` 36 m.
4. **Dense inner mix.** For `q >= 1.3`, `steerProfile` replaces the inner mix with `rear` 7, `works` 3 and the odd
   `pavilion` 0.5; `innerBuildings` spaces the rear rows on 7–9 m light wells instead of 11–14 m.
5. **Stare Miasto frontage.** `RES_STARE` draws `low` 0.38 instead of 0.6. Its `gap` weight also drops from 1 to
   0.18, but that part does not reach the measured set: `steerProfile` removes `gap` from every `q >= 1` dense block,
   and a control swap back to 1 leaves all 190 generated shares bit-identical (only 50 footprint parts outside the set
   change, and whole Stare Miasto by 0.11 pp: 28.64 → 28.53%). The frontage continuity measured here comes from
   `low` 0.38 and the filled cores, not from `gap`.

## Measurements after the change

The 190-block aggregate moves **40.3% → 43.2%** generated against 45.3% real (ratio 0.890 → 0.953); blocks below 75%
of their real share fall **49 → 46**.

Per district on the same 190-block subset:

| district | baseline | current | OSM real | current / real |
| --- | ---: | ---: | ---: | ---: |
| Stare Miasto | 37.6% | 39.5% | 48.4% | 0.815 |
| Jeżyce | 40.9% | 46.0% | 41.7% | 1.101 |
| Łazarz | 42.7% | 44.4% | 44.6% | 0.995 |
| Wilda | 42.5% | 46.3% | 43.7% | 1.059 |

Over whole districts (all buildable blocks, not only the >= 35% subset) the change is smaller: Stare Miasto 27.7 →
28.6% against 30.0% real, Jeżyce 34.4 → 36.6% against 30.8%, Łazarz 31.4 → 31.9% against 26.5%, Wilda 19.9 → 20.7%
against 19.9%. Jeżyce and Łazarz were already above their OSM share before this pass; filling their courtyards makes
that overbuild larger (1.19× / 1.20× over the whole district). **Decision 2026-11-10:** the user chose not to thin the
already-built central blocks; Jeżyce and Łazarz keep this overbuild, so do not open a thinning pass without a new
request.

The named blocks:

| block | OSM real | baseline | current |
| ---: | ---: | ---: | ---: |
| 708 | 68.0% | 35.4% | 39.7% |
| 688 | 61.0% | 37.3% | 39.9% |
| 801 | 70.0% | 35.8% | 35.8% |
| 868 | 57.0% | 34.7% | 33.4% |
| 836 | 58.0% | 42.1% | 44.8% |
| 1365 | 77.0% | 40.0% | 45.5% |

Largest area-weighted gains (percentage points of the block): 436 Jeżyce 5.38 ha 41.8 → 51.1%, 1077 Wilda 5.52 ha
32.8 → 41.9%, 532 Jeżyce 2.70 ha 44.9 → 62.9%, 465 Jeżyce 2.99 ha 37.3 → 53.4%, 499 Jeżyce 3.58 ha 38.0 → 51.1%,
948 Wilda 3.44 ha 36.5 → 45.9%, 984 Łazarz 1.94 ha 38.9 → 55.1%, 1219 Wilda 3.24 ha 37.5 → 46.1%, 827 Stare Miasto
4.75 ha 41.8 → 47.3% and 934 Łazarz 2.30 ha 41.6 → 52.1%. The largest regressions are random-stream shifts of the
same layouts: 1243 Wilda 47.4 → 44.4%, 672 Stare Miasto 58.1 → 55.4%, 868 34.7 → 33.4%, 455 Jeżyce 43.8 → 42.6% and
954 Łazarz 47.8 → 47.1%.

801 and 868 do not follow the row changes:

- 801 is a 0.62 ha fragmented island: its `BLOCKS[801].rects` cover 2,873 m² of the 6,182 m² island (46.5%), so even
  100% coverage of the rects caps the generated share at 46.5%. The current 2,213 m² is 35.8% of the island and 77%
  of the rects; this is a property of the lot-rect coverage, not of deeper rows. The raster attributes all of its
  footprint cells to block 801 (`street = 0`, `other = 0`), so the earlier explanation that they were assigned to
  neighbouring blocks was wrong.
- 868's eastern and southern rects are classified as `OFFICES` (within 240 m of the Andersia/PFC cluster). `officeBlock`
  builds office slabs along the main frontage only and has no interior core, so the dense `kamienica` changes do not
  reach them. The same is true of the office-classified parts of block 816 (10.9 ha, 13.6% generated against 37% real,
  also carrying the Stary Browar reserve and 37% park).
- Block 575 (0.91 ha, 0% generated) is almost entirely the Collegium Maius landmark reserve; its real buildings are the
  landmark, not generic stock. It is excluded from what the generator can add.

## Verification

- `node --test tests/buildings-density.test.cjs` — 8/8 pass. The villa districts, Chartowo, campuses 666/577/427/476 and
  the gated dense blocks 192/814/769/827 are unchanged and still within their limits.
- `node --test tests/*.cjs` — 429/429 pass.
- `node --test tests/` — 443/443 pass (including the geodata rebuild and the `.mjs` tools).
- Two output pins moved with the legitimate footprint change:
  - `tests/park-paving.test.cjs`: the 41 park blocks' ground footprint union is 239,736 m² (was 238,791), and granite /
    lawn missing outside footprints rose to 142 / 136 m²; the tolerance is now 160 m².
  - `tests/tree-distribution.test.cjs`: one street-tree site (species 0) falls inside the new clearance and the site
    list / collider hashes moved (`18695 → 18694` trees before species assignment, mesh-type counts unchanged).
- Browser checks: Chrome 157.0.8103.39 headless loaded the full scene on WebGPU (adapter Apple `metal-3`) and on the
  WebGL2 fallback (`?backend=webgl`, `WebGL2RenderingContext` confirmed). Views inspected:
  - the automatic drone over the centre (140 m),
  - the helicopter first-person camera at 35, 80 and 140 m over Ratajczaka / Św. Marcin (blocks 688 and 708),
  - street level at Św. Marcin / Piekary.

  The new oficyny read as low flat-roofed wings behind the front houses, the courtyards are visibly smaller and no
  block-sized hole remains in the named area. No curb or sidewalk overlap, floating part, missing facade or z-fighting
  was seen on either backend, and neither run logged a console or shader error. Gate passages were not changed by this
  pass; they remain the existing facade openings and were only inspected from the street frontages.

## Remaining causes

1. **Office blocks have no core fill.** `officeBlock` lays office slabs along the main frontage (16–24 m deep) and stops;
   inner lots only use `OFFICES.inner` when a rect has no front at all. Blocks 816 and 868 are the visible result. A
   follow-up could add the same dense core/transverse-wing treatment to the office layout, but it needs its own share
   steering because offices are deliberately large-footprint and plaza-fronted.
   **Resolved 2026-11-08** by the [office-courtyards follow-up](office-courtyards-2026-11-08.md): 868 33.4 → 48.2%,
   814 26.4 → 32.0%, 769 40.2 → 47.8% and 752 47.7 → 53.1%; 816 is capped by its 37% park and Stary Browar landmark.
2. **Landmark reserves.** 575 (Collegium Maius) and the landmark-covered parts of 816 and the Old Town are built by
   `landmarks*.js`, not by the generic raster, so their per-block generated share undercounts the scene on purpose.
3. **Already-overbuilt districts.** Jeżyce and Łazarz now exceed their whole-district OSM share. Kept as built by the
   user's 2026-11-10 decision not to thin the central blocks; a future densifying pass should still steer by the
   block's own real share there instead of densifying every `dense` block.

Files changed: `js/buildings.js`, `tests/park-paving.test.cjs`, `tests/tree-distribution.test.cjs`, `docs/world.md`,
`docs/backlog.md` and this record.
