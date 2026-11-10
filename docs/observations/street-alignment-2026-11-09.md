# Street-aligned fallback lots and the pavement lawn — 2026-11-09

## Problem

Three visible regressions from the 2026-11-08/09 missing-object recovery and central frontage pass:

1. **Buildings off the street angle.** `GEO.blockObjects` min-area rectangles carry 1–3° of noise from stepped
   walls and bays, and every `blockFallbackLots` envelope was built with `xf = null` (world axes). In a block whose
   frontage frames are turned 19–43°, the new fallback kamienice therefore stood at 0° among street-aligned
   neighbours.
2. **A large lawn over the pavement.** `yardFitsBlock` accepted any slab whose probes stayed 0.5 m outside a roadway
   and inside the block outline. The 4.6 m band inside the curb is the pavement (`SIDEWALK` in
   `tools/poz-blocks.mjs`), so a courtyard could cover the sidewalk, and pedestrian corridors and tram tracks were not
   checked at all.
3. **Thin central frontages.** Rotating or reserving the wrong area around a mapped object opened holes between
   Strzelecka and Podgórna: Kupiec's L-plan left its cut Plac corner buildable, and a generic kamienica filled it 0.3 m
   from the Podgórna roadway.

## Fix

- `GEO.blockFallbackLots` gained a sixth value, the OSM minimum-area rectangle's long-axis angle. `buildings.js`
  turns each world envelope into the frontage frame it fronts: the nearest block frame within 12°, otherwise the
  building's own OSM turn when the block frames do not model that street (Ogrodowa runs at 0° through block 802's
  20° frames). Every part is re-checked in world space against `roadClearance`, `pedestrianClearance`, rail tracks
  and the curb polygon before it is built.
- Mapped objects snap to the nearest frame only when the OSM angle is within 3° (the noise band); a hall genuinely
  off every frame keeps its real turn, because swinging a 60–100 m wall by 10° lost 34 Strzelecka frontage stations.
  Kupiec's dedicated plan is built on the same snapped frame: the Strzelecka wall moved from v = 29.5 to 28.7 and the
  Podgórna wall from -28/-26.2/-25.5/-24.2 to -27.55/-25.75/-25.05/-23.75, keeping the 4.6 m pavement on the snapped
  2.7° turn. Its reserve now also covers the L-plan's cut Plac corner where the cells fall in the pavement band; safe
  corners stay buildable, so the Strzelecka frontage is not cut away.
- `yardFitsBlock` now requires every courtyard probe to stay 4.6 m clear of a roadway (behind the pavement), 0.5 m
  from a pedestrian street and 0.5 m from a rail/tram centreline, as well as inside the curb island. A world-frame
  detail reports `ry = 0` instead of leaving the field unset.

## Measurements

- Central framed blocks (Stare Miasto, Jeżyce, Wilda, Łazarz), headless build:
  - 5,003 block details; 4,871 (97.4 %) sit on a frontage frame within 2°.
  - 132 are mapped halls/churches/schools whose OSM wall is off every frame and keep their real turn.
  - Superseded after `42329c3` restored the 4d14df9 layout: 4,573 details, 4 off every frame (5–10°), the same at a
    4° or 5° snap, so `OBJECT_FRAME_SNAP` stays 3° and the follow-up is closed
    ([object-frame-snap record](object-frame-snap-2026-11-10.md)).
  - 0 details have no turn; 0 details stay at world 0° in a block whose every frame is turned more than 10°
    (the old fallback case was 0° everywhere).
- Courtyard slabs: 19,297 survive the stricter guard (19,885 before it, so 588 slabs that crossed the pavement,
  a pedestrian corridor or a track are gone). Every surviving slab clears the roadway by at least 4.6 m.
- Central frontage coverage is unchanged or better: Strzelecka west/east 66.3/61.9 %, Podgórna south/north
  83.1/100 %, Długa 80.2/82.2 %, Zielona 86.0 %, Ogrodowa north/south 62.2/83.8 %.
- Kupiec still covers ~4,230 m² in 10 parts, stays clear of the roadway and keeps at least 4.6 m to the block curb.

## Tests

- `tests/buildings-density.test.cjs` gains the framed-block orientation regression (no unset turns, no world 0° in
  fully turned blocks, >95 % on a frame, exceptions must be mapped plans) and the courtyard test now checks the
  4.6 m pavement band, pedestrian corridors and rail clearance.
- Tree counts, collider digests and species pins moved slightly because the aligned fallbacks change building
  colliders around their new footprints; `tests/street-tree-colliders.test.cjs` and
  `tests/tree-distribution.test.cjs` carry the new values.
