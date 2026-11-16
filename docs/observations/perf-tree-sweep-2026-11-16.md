# Incremental tree level sweep (2026-11-16)

`update()` in `js/trees.js` used to walk all 117,964 trees whenever the camera moved 4 m (~0.5 ms on an Apple M5 Pro, more on
slow CPUs, every frame while flying or driving fast). It now visits only trees that can change level: **~4.5 k of 118 k per
update on High (3.5 k on Low), 0.50 → 0.05 ms median in Node, 0.6 → 0.3 ms in headless Chrome (100 µs timer clamp)**. `lod[]`,
the change lists and the WebGPU High renders are identical to the full sweep.

## Change

`createLevelSweep(profile, px, py, pz, tier, lod, groups, apply)` (exported, pure; `createTreeField` passes its 200 m cells):

- Each cell is split by draw-distance tier (mixed tiers would straddle 950–3000 m for most camera positions and be visited
  every time; the first version did and visited 24 k trees on the drone orbit). Per group: box of the tree positions
  (mid-crown), tree count per level (0, 1, 2, hidden), and the tier's `maxDist` for high and street (`min(maxDist, streetCutoff)`).
- Per update and group: if every tree holds one level B and the camera-to-box distance interval `[dmin, dmax]` lies inside B's band
  (B=0: `dmax < lodNear`; 1: `lodNear ≤ dmin`, `dmax < lodMid`; 2: `lodMid ≤ dmin`, `dmax < maxD`; hidden: `dmin ≥ max(lodMid, maxD)`,
  all with 0.01 m slack), then the rule returns exactly B for every tree, hysteresis cannot apply (it only acts when next ≠ current)
  and the group is skipped. Squared distances, no sqrt.
- `LOD_HYSTERESIS` margins are not needed for correctness (equal next and current level never changes); that is why `y = 40`
  needs no forced full sweep either: the limits are read per update, and a group at the old limits is revisited exactly when it
  stops satisfying the test. The test never relies on state older than the current call.
- Visited trees only compute `next`; changes are collected, heap-sorted in place (no allocation) and applied in ascending tree id
  like the old loop, because far-mesh swap-removes depend on the order (the slot order decides instance draw order, hence pixels).
  The 4 m early-out is unchanged. Per-frame allocations: none (scratch arrays are built once).

## Equivalence

`tests/tree-sweep.test.cjs` (synthetic 15 k field, both quality profiles, six recorded-style paths plus a boundary ring with
camera jumps) compares after every update the whole `lod[]` and the ordered `(id, prev, next)` change list with a verbatim copy
of the old loop. The 660-frame wp5 → Rynek flight, a 720-frame Centrum drone orbit (r 450 m, 230–410 m high), 4,000 m of street
driving sampled every 0.25 m (15 m/s at 60 fps), a 900-frame sweep across `y = 40` and 200 frames sitting on `y = 40 ± 0.001`
pass; `tools/bench-tree-sweep.mjs` repeats the check on the **real 117,964-tree field** (dumped from the browser) and reports `equal true`
on all ten profile × path combinations.

## Timings (Node 26, real field, median / p95 / max ms per `update` sweep, warm third repetition)

| Profile | Path | Updates | Full | Incremental | Trees visited mean / max |
|---|---|---|---|---|---|
| high | flight wp5 → Rynek | 660 | 0.496 / 0.513 / 0.621 | 0.049 / 0.060 / 1.477 | 4532 / 31072 |
| high | Centrum orbit | 642 | 0.507 / 0.530 / 0.558 | 0.050 / 0.060 / 0.081 | 5085 / 6683 |
| high | driving 15 m/s | 1032 | 0.486 / 0.507 / 0.682 | 0.045 / 0.055 / 0.079 | 3977 / 6607 |
| high | crossing y = 40 | 697 | 0.487 / 0.520 / 0.641 | 0.044 / 0.059 / 1.580 | 4374 / 32295 |
| high | sitting on y = 40 | 200 | 0.569 / 0.610 / 0.649 | 1.509 / 1.616 / 1.665 | 33176 / 36719 |
| low | flight | 660 | 0.496 / 0.517 / 0.559 | 0.042 / 0.057 / 0.974 | 3498 / 21418 |
| low | orbit | 642 | 0.498 / 0.519 / 0.648 | 0.045 / 0.059 / 0.091 | 3846 / 7174 |
| low | driving | 1032 | 0.491 / 0.510 / 0.601 | 0.038 / 0.048 / 0.071 | 2785 / 5361 |
| low | crossing | 697 | 0.499 / 0.523 / 0.740 | 0.045 / 0.063 / 1.065 | 4205 / 23003 |
| low | sitting on y = 40 | 200 | 0.543 / 0.573 / 0.629 | 0.980 / 1.027 / 1.065 | 21536 / 22896 |

Sweep only (the `apply` callback is a hash, not `farAdd`). The incremental code is evaluated in this realm: inside the test's vm
context every `Math.*` goes through the context's global proxy and the same code measures ~3× slower. Max values are the
frames where a whole ring of cells changes level at once (one 5–7 k-tree burst; at `y = 40` ± the whole city flips between `maxDist`
and `streetCutoff`). The adversarial "sitting on y = 40" path (camera toggling across the switch every 6 m) is slower than the full
sweep because tens of thousands of trees really change level every update and the ordered apply sorts them; a single crossing costs
the one ~1.5 ms burst, and real flight/driving across 40 m shows it only as the max column.

### Browser (headless Chrome, Metal, 1280 × 720, Złota godzina clock frozen; flight wp5 → Rynek, 658 updates, medians of 3 boots, `update()` incl. rebuild)

| Config | Median | p95 | Max | Mean | Trees visited |
|---|---|---|---|---|---|
| WebGPU High base | 0.60 | 0.80 | 3.10 | 0.61 | 117,964 |
| WebGPU High incremental | 0.30 | 0.50 | 4.20 | 0.31 | 4,561 |
| WebGPU Low base | 0.50 | 0.70 | 1.90 | 0.51 | 117,964 |
| WebGPU Low incremental | 0.20 | 0.40 | 2.70 | 0.22 | 3,523 |

The page timer is clamped to 0.1 ms, and this number includes `rebuild()` (repacks and far-mesh flushes, ~0.2–0.3 ms), which the
change does not touch; so the 0.3 ms saved matches the Node sweep difference and the rest is the unchanged level-change work.
The max (3.1 → 4.2 ms, 1.9 → 2.7 on Low) is a single frame in each run (not attributed; the Node max column shows ring bursts
of about 1.5 ms), noise-sized against a frame. Retained JS heap after GC, median of 3 boots: 953.9 → 956.0 MiB High, 899.0 →
900.9 Low (+2 MiB: tier-split group lists, ids, boxes, counts).

## Pixel checks

Frozen page (loop gated, `dt` 1/60, `performance.now`/`Date.now`, `elapsed`, TSL node time and frame id fixed, `Math.random`
seeded, traffic/pedestrians/trams/hits hidden, HUD hidden, 20 frames per view, hold 12 frames per flight pose). Base =
`git archive poznan` on port 8201, candidate on 8200; harness is a scratch patched server + CDP driver (`/tmp/cc-tree-sweep/h`,
not in the repo). Two renders of the same build still differ in a few pixels at Centrum (4–35 px, max 11–82/255 in the
drone view: temporal effects that depend on the boot's frame count), so diffs are quoted against that noise.

| Run | wp5 | Centrum | Rynek | Flight poses (11) |
|---|---|---|---|---|
| WebGPU High, 3 boots vs base | 0 / 0 / 0 | 18 / 8 / 18 (same build vs itself: 16–18) | 0 | 0 except pose 02: 1 px, pose 03: 3 px (same as base vs itself) |
| WebGPU Low, 3 boots vs base | 0–6 | 31–35 (itself: 26) | 0 | 0 except pose 00: 6 px |
| WebGL2 High vs base | 0 | 16 | 0 | 0 except pose 03: 1 px |
| WebGL2 Low vs base, batch 1 | 0 | 30 | 297 | up to 2,220 px (pose 09), 120–360 on 06–10 |
| WebGL2 Low vs base, batch 2 | 0 | 26 (itself: 34) | 0 | pose 00: 8 (itself: 8) |

The first WebGL2 Low batch showed up to 2,220 differing pixels (pose 09) and 297 at Rynek; the repeat batch, run later with the
same code, was at the noise level (base vs a second base: Centrum 34, pose 00 8 px; candidate vs base: 26 and 8). The sweep keeps
the far-mesh swap-remove order of the full loop and the tests prove `lod[]` and change order equal, so I read the first batch as
WebGL2 frame noise rather than the change (not reproduced, not fully explained). Screenshots: `/tmp/cc-tree-sweep/final/runs/{base,cand}-{high,low}-{1,2,3,gl}/`
(first batch) and `.../runs2/` (second batch, same names plus `base-low-gl-b`), each with 14 PNGs and `result-*.json`
(console: no warnings or errors in any of the 32 boots); real tree positions: `/tmp/cc-tree-sweep/shots/cand-high/trees.json`.

## Not done

- Levels 0/1 still repack their 200 m cell per change (see [perf-tree-vistas](perf-tree-vistas-2026-11-15.md)).
- A hierarchy above the 1,944 × tier groups would cut the 0.05 ms further but the per-group test is already ~0.04 ms.
- The adversarial y = 40 toggling could be softened by a counting sort instead of the heap sort; no real path shows it.
