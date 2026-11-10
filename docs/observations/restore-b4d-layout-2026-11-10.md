# Restoring the 4d14df9 layout in the dense perimeter districts (2026-11-10)

The user's reference for the dense districts is the generator at 4d14df9: kamienice rows with oficyny round
courtyards. The later passes (programme 3–12 profiles, block anchors, mapped objects, fallback lots, the lot-aware
density steering and the Stare Miasto continuous-frontage rule) cut those street walls into fragments and turned
central campuses (829, 877, 768) into institutional layouts. `js/buildings.js` now gates those blocks back to the
4d14df9 rules (`srcLegacy`). No geodata or tools change was needed: 1,367 of the 1,422 4d14df9 blocks are byte
identical in `GEO.blocks` (only their ids moved), and the kamienica layout functions did not change since.

## Decisions

- `LEGACY_LAYOUT_DISTRICTS`: Stare Miasto, Jeżyce, Łazarz, Wilda, Stare Winogrady. Główna keeps the current path.
- Industrial superblocks (≥ 10 ha, programme 4/5/7, mapped halls averaging ≥ 600 m²: ZNTK, Cegielski) keep the
  anchored hall layout. Park facility lots (`parkFootprints`) stay, so Hala Arena and the halls on 925/937 remain.
- Mapped objects inside the gate: only the explicit `LEGACY_OBJECTS` list (matched by object centre ± 2 m), each
  reserved with its oriented `objectReserveBoxes` rows: Kupiec Poznański, Biurowiec Maraton and AWF on Królowej
  Jadwigi (9aa2dba), and the five-storey Podgórna corner house on block 770 (way 365954909).
- The ≥ 90 % curb-alignment target of the street-fabric round is dropped; the 4d14df9 frames measure 68.8 %.

## Fixes on top of the gate

- **Courtyard clipping** (`clipYard`): a yard failing `yardFitsBlock` (curb island, 4.6 m pavement band,
  pedestrian corridors, tracks) is clipped to its largest clear rectangle on a 1.25 m grid, both sides ≥ 4 m,
  re-checked with the 2 m probes, instead of being dropped. Yard slabs city-wide: 19,011 → 19,594.
- **Legacy buildings off the street** (`trimOffStreets` in `commit()`): a 4d14df9 frame on a bend can cross the
  kerb (a kamienica stood on the Strzelecka carriageway at (122.8, 855.2)). The building's sides move in 0.5 m at a
  time until every probe clears roadways and pedestrian corridors (≥ 0 m) and tracks (≥ 0.5 m); the lot line moves
  with them, a part narrowed below 4 m is dropped, and a building below 3 m leaves its lot void. Footprints reaching
  a roadway or pedestrian street in the legacy districts: 62 → 0 (the other districts are unchanged).

## Acceptance (`.street-audit/accept.sh probe5`)

| metric | 4d14df9 | fb091f6 | now |
|---|---:|---:|---:|
| interior angles per quarter (dense) | 1.71 | 1.96 | 1.76 |
| interior area off the dominant angle % | 24.8 | – | 24.3 |
| standalone buildings < 60 m² (centre) | 155 | – | 153 |
| lot median m² (centre) | 534 | – | 529 |
| overlaps at different angles | 0 | 9 | 0 |
| touching building pairs (centre) | 2,355 | – | 2,335 (99 %) |
| ground parts with a side < 4 m (centre) | 84 | – | 89 |
| street band 0–16 m built % (centre) | 32.3 | 26.8 | 32.1 |
| lawn in the street band % (centre) | 1.4 | 2.7 | 1.2 |
| block 416 generated / real | – | – | 1.13 |
| dense blocks > 1.5× real by ≥ 2,000 m² | 28 | – | 29 |
| curb ≤ 2° % (city, informational) | 68.8 | 71.2 | 71.1 |
| curb > 5° % (city, informational) | 6.7 | – | 6.8 |

The five extra narrow parts are the Kupiec cut-corner treads (≤ 4 m by design) and object parts.

## Maps

Rendered by `.street-audit/analyst/render.cjs` (`maps-out/<region>-probe5.png` against `maps-ref/<region>-b4d.png` in
the citywide-street-fabric worktree; the three extra windows in the session scratchpad `maps/`):

- r-768, r-w1, r-416, r-ziel: identical to 4d14df9 apart from single trimmed parts and clipped yards.
- r-strz: identical except Kupiec Poznański on block 792 (intended) and no lawn under it.
- Łazarz −2600…−2300 × 1500…1800: the two large courtyards dropped by the yard guard are back; the houses on the
  Głogowska bend that 4d14df9 put up to 4 m into the carriageway are trimmed or gone.
- Królowej Jadwigi −260…20 × 1000…1120: Maraton and AWF instead of the 4d14df9 kamienice rows on park block 939.
- Podgórna −220…−60 × 260…380: the block 770 corner house replaces two corner kamienice; the rest of the row stays.

## Pins moved

- `park-paving`: footprint union 366.4k → 363.7k m² and 894 → 720 surface meshes (the legacy park blocks build
  without mapped objects and fallback lots, so fewer footprint holes; coverage and triangulation checks unchanged).
- `street-tree-colliders`: 34,503 → 34,493 street trees and 25,771 → 25,461 surveyed park trees.
- `tree-distribution`: species counts, site hash, collider digests and 33,073 → 32,742 surveyed OSM sites.
