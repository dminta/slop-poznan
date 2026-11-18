# Balcony clearance around signal spans and raised signal elements — 2026-11-18

Balconies are generated geometry (`blk.balconies` records, rendered by `js/balconies.js`) and are not part of
`buildingColliders`, so the signal placement checks in `street-details.js` never saw them. This audit measures every
raised signal element against every balcony slab+railing volume in the full-collider headless fixture.

**Result:** all 30 span heads, 84 cantilever heads, 74 ground heads and the one bridge head are clear at a 0.3 m margin.
**One static boot-time pole and its S-1 head at Głogowska (junction 3045) come within 0.044 m of a first-floor balcony in
block 936** (0.096 m for the pole), so the pair eats 0.256 m of the margin. The user chose to drop the balcony, not move
the signal; the implemented guard and its measured result are in **Fix** below, and the audit now reports 0 rows.

## Method

`node tools/audit-balcony-spans.mjs [--margin 0.3] [--near 8] [--top N] [--json] [--before]` builds the same fixture
as `tools/audit-signal-spans.mjs`: `runAudit({ worldOnly: true })` from `tools/audit-tree-clearance.mjs` (landmarks, city
blocks, city grid, bridges) plus the rebuilt road network with the block and landmark ground colliders, pedestrian routes,
the real tram and railway layouts, and both `addRuntimeSignalHeads` calls (a left-reuse pass, then the placement pass
with supports and rail layout). It reads `world.blocks[].balconies` for the balconies.

Balcony volumes are the renderer's own numbers, from `js/balconies.js` and `js/buildings.js` `commit()` after
`placeInFrame` has turned the records into world coordinates (`ry` is the block frame, `facing` the front):

- one box per landing: local x ±width/2 (`w` clamped to 1.5–3 m, default 2.4 m), local z −0.55 (wall) … +0.45
  (street), so the slab is 1.0 m deep and sits 0.55 m out of the wall; y from the slab soffit (`record.y + i*storey −
  0.14`) to the railing top (`+ 1.0`). The stacked railing gaps between landings are therefore open, as rendered.
- the audit's `--self-check` verifies the transform: on 2,067 sampled volumes the wall plane lies on a building collider
  face (max 0.01 m) and, on the 95 whose host is an axis-aligned collider (its collider is its real footprint), the slab
  front 1.0 m off the wall is outside the host in every case.

Raised signal elements, at their real heights and sizes from `js/street-details.js`:

| Class | Heads | Elements | Geometry |
|---|---:|---:|---|
| span | 30 | 180 | two stay rods at `topY` (10 m, or 7.2 m on 12 traction anchors), radius 0.018 m; vertical drop to 5.35 m; two masts y 0.1…`topY`, radius 0.1 m (0.15 m traction); S-1 head at 5.3 m |
| cantilever | 84 | 252 | 6.2 m mast (new, or a 4.1–6.2 m sleeve on a reused pole), radius 0.1 m; arm at 5.55 m, radius 0.045 m; S-1 head at 5.3 m |
| ground | 74 | 148 | 4.2 m pole, radius 0.1 m (rendered shaft 0.055 m); S-1 head at 3.55 m |
| bridge | 1 | 3 | fascia arm at `yClearance`, vertical drop to 5.7 m, radius 0.045 m; head at 5.15 m |
| static | 1096 heads + 1915 pedestrian heads | 4926 | boot-time side poles per arm (4.2 m, radius 0.1 m), their S-1 heads at 3.55 m and one pedestrian head each at 2.45 m, plus the Dworzec refuge pole |

Static geometry is captured by instrumenting three exact push points in the `street-details.js` source loaded by the
audit (the per-arm `addSignalPole`, the refuge pole, the S-1 head record and the pedestrian-head position); the markers
are checked and the tool throws if they move. 52 captured records belong to plans that route pruning disabled, so they
are dropped exactly as `addRuntimeSignalHeads` compacts their meshes/colliders. `signalArmPoles` holds the same static
side poles; there is no static cantilever/arm geometry, so the class table above is complete.

The S-1 box is the housing, visors and 0.3 m bracket (local z −0.30…+0.27), 0.3 m wide and 0.86 m tall, plus the
0.54 × 1.1 m backplate on big heads (`w >= 14.5 m` or 3+ lanes), centred 0.18 m in front of the pole/target. A
pedestrian head is 0.3 × 0.6 m from local z −0.27…+0.22. The head box is convex; its 12 edges are sampled every 2 cm,
so the true OBB minimum differs by under a centimetre, far below the 0.3 m threshold.

Clearance is the exact distance from each stay/drop/mast/arm/pole segment to each oriented balcony box (the squared
distance to a convex box is convex along a line, so a ternary search on the segment parameter gives the minimum). The
margin is **0.3 m**; a gap below it is reported with its eaten margin (0.3 − gap), which is not necessarily a physical
penetration. A 16 m bucket grid keeps the 60k-volume test at about 14 s including the world build. `--near 8` only
widens the query so the reported nearest gaps are exact below 8 m; it cannot change the hit count.

## Result

Fixture: 189 runtime heads (30 span, 84 cantilever, 74 ground, 1 bridge) and 4,926 live static elements, against 19,426
balcony stacks and 59,939 slab+railing volumes.

| Class | Elements | Intersecting elements at 0.3 m | Nearest gap |
|---|---:|---:|---:|
| span | 180 | 0 | 1.010 m (mast, edge 5039) |
| cantilever | 252 | 0 | 3.180 m (mast, edge 2628) |
| ground | 148 | 0 | 3.160 m (pole, edge 2228) |
| bridge | 3 | 0 | none within the 8 m query |
| static | 4926 | 2 | **0.044 m (head, junction 3045)** |

By element kind the nearest clearances are: stay 1.691 m (span 10, edge 5039), mast 1.010 m (span 10, edge 5039),
drop 6.728 m (span 29, edge 10461), arm 3.559 m (cantilever edge 4563), pole 0.096 m (static, junction 3045), head
0.044 m (static, junction 3045), pedestrian head 0.978 m (static, block 172). Only one balcony volume is involved, at
one stack.

### Intersection cases (0.3 m margin)

Both rows are the same physical static side pole at Głogowska, junction 3045, side 1, against landing 0 of one balcony
stack in block 936 (`Łazarz_-1910_1071`). The pole is at (−1972.709, 1022.348); the head centre is 0.18 m in front of
it at (−1972.839, 1022.473). The balcony stack is at (−1972.085, 1022.645), `ry` 0.7643, `facing` π, `w` 2.861 m,
storey 3.8 m, 3 landings; landing 0 spans y 3.76…4.90 (slab soffit 3.76, slab top 3.90, railing to 4.90).

| Element | Gap | Margin eaten | Vertical overlap with the balcony | Coordinates |
|---|---:|---:|---|---|
| static S-1 head | **0.044 m** | 0.256 m | head y 3.12…3.98 overlaps 3.76…3.98 | (−1972.8385, 3.55, 1022.4734) |
| static pole | **0.096 m** | 0.204 m | pole y 0.1…4.30 overlaps 3.76…4.30 | (−1972.709, 0.1–4.30, 1022.348) |

The nearest real building collider is an oriented generic block collider (minY 0, maxY 15.2) whose true wall is
**1.196 m** from the pole; the balcony projects 1.0 m from that wall, so the pole stands roughly 0.20 m from its street
face and the head box (0.15 m half-width, 0.18 m in front of the pole) reaches within 0.044 m. This is a real narrow
gap in the generated frontage, not an AABB artefact: the world AABB reports 0 m, but the OBB frame gives 1.196 m.
The user chose to drop the balcony rather than move the signal (see **Fix** below).

## Fix (2026-11-18)

The rule is implemented on the balcony side, as a general guard: after the static poles/heads (`buildStreetDetails`)
and both runtime head passes (`addRuntimeSignalHeads`), `main.js` calls `streetDetails.pruneBalconies(allBlocks)`.
Balconies are cosmetic and have no collider, so this cannot change traffic, pedestrians or player collision.

- `js/street-details.js` holds the audit's exact geometry as a top-level pure block: the slab+railing volume
  (`w` clamped 1.5–3 m, local z −0.55…0.45, slab soffit −0.14 m to railing top +1.0 m, turned by `ry + facing`), the
  ternary-search segment distance (80 steps, radius subtracted) and the head box sampled along its 12 edges every 2 cm.
  `pruneBalconyClashes(blocks, obstacles)` buckets the ~5k signal elements in the audit's 16 m cells, tests each stack,
  and returns `{ stacks, trimmed, dropped, landingsRemoved }`.
- The obstacle set is the audit's: static side poles and the Dworzec refuge, live static and left-reuse S-1 heads,
  static pedestrian heads, and every runtime span (stays, drop, masts), cantilever (mast, arm), ground pole and bridge
  fascia arm/drop, with the same heights, radii and big-head boxes. Disabled signal plans are read after
  `addRuntimeSignalHeads` compacts them.
- A clashing bottom landing is trimmed from the bottom (`y += storey`, `landings -= 1`, `h -= storey`, which keeps the
  far box correct); a clash above that prefix drops the whole stack. A 1-landing stack renders correctly (`balconies.js`
  loops `landings` and sizes the far box from `h`), so one landing may remain.
- The audit calls the production method on its own fixture before reading `world.blocks[].balconies`, so it measures
  the filtered records; `--before` (the `HEAD` street-details) has no method and keeps reproducing the pre-fix rows.

**Measured 2026-11-18:** `node tools/audit-balcony-spans.mjs --json` → **0 rows at 0.3 m**, 19,426 stacks and 59,938
volumes (one less than the pre-fix 59,939); `balconyFilter` trimmed **one** stack by **one landing** (the Głogowska
block 936 landing 0) and dropped no stack. `--before` still reports the two rows at 0.044 m (head) and 0.096 m (pole).
The filter cost **23.1 ms** median in `bench-boot-headless` (3 interleaved pairs against `poznan` 26c1110); that run's
only changed hash is `blocks.allBlocks`, and inside it only `blk.balconies` records (trimmed `y`/`landings`/`h`).

## Boot order and the rejected signal-placement guard

Balconies are known before any of this geometry is placed: `main.js` runs `buildCityBlocks` (`:199`, returns `allBlocks`
with `blk.balconies` in world coordinates), `buildCityGrid`, then `buildStreetDetails` (`:224`) and
`addRuntimeSignalHeads` (`:242`). The static signal poles are built inside `buildStreetDetails` after that first point,
so both the static and runtime placements can see the records.

The first proposal was the opposite direction: pass the flat balcony list into `buildStreetDetails`, index the
slab+railing boxes and add a 0.3 m test to `spot()`/`signalPoleSpot`, `footBuildingClear`, `footWireClear`/`stayClear`
and `headClear`, so an intersecting candidate is skipped and the existing search takes the next one. It was rejected:
the user's rule is to drop the balcony, not move the signal, because the signal geometry is traffic-critical while the
balcony is decorative.

## Limits

- Headless full-collider fixture, not the browser. It omits airport, canopy, outskirts and city-grid colliders and the
  bridge/landmark split `main.js` passes to `buildStreetDetails`, exactly like `tools/audit-signal-spans.mjs`; extra
  colliders can only remove foot candidates, so a rare re-pick is not covered. No rendered check was made (the
  coordinator takes browser screenshots).
- Static records are captured only at the three source markers above; a future rename or a new static signal builder
  outside them would be missed, and the tool throws if the markers disappear. Disabled plans are dropped exactly as the
  renderer compacts them.
- `--near 8` makes the reported nearest gaps exact only below 8 m; the intersection test itself is unaffected. The
  bridge class has no volume within 8 m.
- The pole radius is the 0.1 m footprint/collider, above the rendered 0.055 m shaft; the 0.096 m static pole gap would
  still be 0.141 m with the rendered shaft, below the margin either way.
- The head box is sampled along its edges at 2 cm; the exact OBB-OBB distance could differ by under 1 cm, far below the
  0.3 m threshold.

Reproduce: `node tools/audit-balcony-spans.mjs --json` (about 14 s) or without `--json` for the worst rows as text; it
runs the production pruner and reports 0 rows on the current tree. `--before` loads `js/street-details.js` from `HEAD`
(pre-fix, no `pruneBalconies`) and reports the two Głogowska rows above. `tests/balcony-clearance.test.cjs` checks the
same volume/segment/head geometry against the recorded 0.096 m and 0.044 m gaps and the trim/drop rule.
