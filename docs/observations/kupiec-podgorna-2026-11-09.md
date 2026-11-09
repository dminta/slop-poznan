# Kupiec Poznański and the Podgórna pavement, 2026-11-09

## Problem

Two mapped objects on Podgórna stood inside the pavement:

| Object | OSM way | Before, nearest lane-centre clearance |
| --- | --- | --- |
| Corner house on block 770 | 365954909 | 1.13 m at (-147.1, 313.8) |
| Kupiec Poznański, block 792 | 35277661 | 1.54 m at (-144.9, 331.5) |

`populateObject` accepted a mapped object's face 0.5 m outside the lane corridor. The generic frontage lots already
stand `SIDEWALK` 4.6 m in from the curb, so only these two mapped objects reached into Podgórna.

Kupiec's 4,899 m² OSM outline is an L-plan with a cut corner and an atrium, but `GEO.blockObjects[792]` carries its
101 × 63.7 m oriented minimum-area rectangle. The generic retail branch shrank the rectangle to the OSM area, insetted
it another 11 m to clear the roadway, and built a flat 3-storey (11.4 m) diagonal box: the "random block" visible in
the game.

## Fix

- `buildings.js` `OBJECT_CURB_CLEAR` 2.5 m. `populateObject` first tries to inset the OSM envelope until every sampled
  perimeter point clears 2.5 m; narrow objects that cannot do that at both ends retry with the old 0.5 m rule rather
  than vanish. Five narrow objects outside Podgórna use the fallback (blocks 562, 798, 887, 1644 and 1817); every
  other mapped object reaches 2.5 m with a symmetric inset.
- Block 792's retail object gets `kupiecBlock`: six storeys (6 × 4.4 = 26.4 m sandstone, 6 × 4.1 = 24.6 m glass),
  sandstone wings, a glazed west end and a four-tread cut corner where the min rectangle crosses Podgórna and Plac
  Wiosny Ludów. The west/north edges are pulled 16.5 m and 3.85 m into the rectangle; the treads keep 2.8–3.4 m from
  the roadway. The whole plan is 10 parts and 4,454 m², against the 4,899 m² OSM outline (the rest is the cut corner
  and the 2 m step at the front wing).

## Measurements

- After: Podgórna mapped objects clear the lane corridor by 3.25 m (block 770) and 2.77 m (Kupiec's nearest tread);
  the smallest clearance of any footprint in the sampled Podgórna zone (-190..-80, 295..370) is 2.77 m.
- Kupiec: 10 parts, 4,454 m², heights 24.6 / 26.4 m, 2.77 m minimum roadway clearance.
- Block 770's corner house still generates (10.6 × 10.3 m footprint, 11.4 m tall) instead of being dropped.
- `node --test tests/*.cjs`: 475/475 pass. `tests/buildings-density.test.cjs` gains the Podgórna 2.5 m and Kupiec
  six-storey/clearance regressions. Tree snapshot pins moved by +1/+13/+2/+0 sites in the four district groups and
  +2 surveyed OSM trees (changed building colliders near the two objects).
- `node tests/geodata.test.mjs`: rebuilds `js/geodata.js` byte for byte.

## Browser check

- Served the worktree with `python3 -m http.server` and loaded it in headless Google Chrome (WebGL2 via
  `?backend=webgl`): spawn, an elevated north-west view and a street-level view from Plac Wiosny Ludów.
- Kupiec reads as a six-storey modern block: sandstone wings, dark glass curtain wall on the west end, storefront
  glazing at ground level, and a visible stepped cut at the Plac corner. No missing facade, z-fighting, console error
  or loader failure was seen. The street view is close to the glass wall; a future scenic camera preset would show
  the whole mass better.
- The temporary inspection camera preset and buttons were removed before the commit.

## Follow-up: street lawn and Strzelecka pavement, 2026-11-09

The first Kupiec mass kept two leftovers from the raw OSM envelope:

- `objectBlock` pushed `blk.yards.push(insetAll(R, 0.5))` before its Kupiec branch, so the full 101 × 63.7 m
  minimum-area rectangle became a park-lawn slab. It reached 6.8 m into Plac Wiosny Ludów / Podgórna
  (`roadClearance` −6.79 m), covering the tram tracks and the pavement.
- The south wall used `sZ = cz + 31.5`, which left only 2.7–3.2 m between the building and the block's curb outline.
  The generated frontage lots keep the `SIDEWALK` 4.6 m band, so Kupiec stood on the Strzelecka pavement.
- `objectReserveBoxes` shrank the retail envelope to its OSM area (88 × 55.6 m) while `kupiecBlock` built the full
  101 × 63.7 m frame. A kamienica therefore generated through Kupiec's south-east wing (57 m² overlap).

Fixes:

- `kupiecParts` is now the single source of the L-plan/glazed-corner geometry, shared by `kupiecBlock` and
  `objectReserveBoxes`. The reserve reserves only the real parts, so the walls and the reserve cannot drift.
- The Strzelecka wall moved to `v = 29.5` and the north-west treads step back from the raw rectangle, keeping at least
  4.6 m to the block curb on every side. The plan covers 4,248 m² against the 4,899 m² OSM outline.
- `objectBlock` builds no yard for Kupiec. A new `yardFitsBlock` guard samples every courtyard slab (perimeter every
  ~2 m plus a 3×3 inner grid) and drops any slab that leaves the source block's curb outline or comes within 0.5 m of
  a roadway. 61 of the 19,946 slabs city-wide failed (29 reached a roadway, 33 left their block); 19,885 remain.

After the fix Kupiec keeps 4.52 m from the nearest roadway and 4.79 m from the nearest block curb, and no other
building on block 792 overlaps it. `tests/buildings-density.test.cjs` now checks the whole-block yard guard, Kupiec's
containment and 4.6 m pavement band, its empty yard list and zero overlap with the neighbouring kamienice.
`node --test tests/*.cjs` passes 476/476 and `node tests/geodata.test.mjs` rebuilds the geodata byte for byte.
