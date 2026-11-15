# Jeżyce car–tram overlap investigation (2026-11-15)

Measurements use the benchmark world (`tools/audit-tram-overlaps.mjs --minutes 5 --fps 15 --seed <s>` and `tools/bench-traffic.mjs --minutes 5 --seed <s>`), seeds `1, 2, 3, 5, 7, 11, 99, 4242`, all seven districts, 20 s warmup. Limitations of the headless benchmark world and pooled pair IDs match [testing](../testing.md#cartram-body-overlap-audit).

## Baseline (8 seeds × 7 districts)

Baseline overlap audit: **32 pairs** (10 moving, 22 stopped):
- `jezyce`: **19** (5 moving, 14 stopped, 1,765 pair-frames) — seeds: `1`: 4, `2`: 4, `3`: 3, `5`: 3, `7`: 1, `11`: 3, `99`: 1, `4242`: 0
- `kaponiera`: **6** (3 moving, 3 stopped, 1,589 frames) — seeds: `5`: 1, `7`: 2, `11`: 2, `99`: 1
- `centrum`: **3** (1 moving, 2 stopped, 237 frames) — seeds: `2`: 1, `99`: 1, `4242`: 1
- `stare`: **2** (1 moving, 1 stopped, 196 frames) — seeds: `3`: 1, `11`: 1
- `rataje`: **2** (0 moving, 2 stopped, 107 frames) — seeds: `1`: 1, `4242`: 1
- `lazarz`, `wilda`: **0**

### All 19 Jeżyce pairs by mechanism

1. **10 m stub `4660` cannot store a car clear of the turning tram sweep (10 pairs, all stopped):**
   - `1` `210:21` (88.8 s, `4660` s=3.57, bus, `wait='tram'`), `2` `19:21` (121.6 s, `4660` s=7.77, `wait='tram'`), `2` `53:20` (212.0 s, `4660` s=7.28, `leader=tramProxy:20`), `3` `211:21` (94.6 s, `4660` s=0.63, bus, `wait='tram'`), `3` `43:20` (158.27 s, `4660` s=7.77, `wait='tram'`), `3` `17:1` (267.6 s, `4660` s=7.28, `leader=tramProxy:1`), `5` `44:21` (118.87 s, `4660` s=7.66, `wait='tram'`), `5` `6:2` (226.27 s, `4660` s=5.29, `leader=tramProxy:2`), `7` `46:23` (139.27 s, `4660` s=7.58, `wait='tram'`), `11` `210:21` (80.6 s, `4660` s=3.57, bus, `wait='tram'`).
   - Known geometry ([car-tram-sweep-2026-11-12.md](car-tram-sweep-2026-11-12.md)): `4660` needs 24.75 m retreat on a 10 m edge; left unchanged.

2. **Left-turner lateral shift (`targetDl < 0`) into oncoming tram track on Dąbrowskiego (4 pairs, all stopped):**
   - `1` `6:16` (213.13 s, `8947 -> 1105` L, s=15.86, `dl=-0.84`, `wait='tram'`), `1` `200:16` (226.73 s, `6237 -> 1118` L, s=25.01, bus, `dl=-0.32`, `wait='tram'`), `2` `12:13` (153.47 s, `8947 -> 1105` L, s=16.08, `dl=-0.85`, `wait='tram'`), `11` `201:13` (154.0 s, `8947 -> 1105` L, s=9.26, bus, `dl=-0.62`, `wait='tram'`).
   - Exact rule: `drive()` in `js/traffic.js` sets `targetDl = -Math.min(0.85, Math.max(0, v.edge.lanes[0] - v.halfWidth - 0.12))` for left-turners on 1-lane edges with `e.opposite`, assuming only the road centreline is to the left. On `8947` (`lane0 = 3.25 m`, westbound track `te 55` at `2.69–3.06 m` left) and `6237` (`lane0 = 1.78 m`, `te 55` at `2.82–2.91 m` left), shifting left pushes the stopped vehicle's front-left corner into `te 55`'s 1.2 m body sweep while `tram.drive()` ignores oncoming cars (`dot < -0.5`).

3. **Bus-width clearance on connector `8947 -> 4659` (3 pairs, all moving ~6.1 m/s):**
   - `5` `205:13` (161.07 s, `cs=-7.64`, `6.02 m/s`), `11` `205:3` (183.53 s, `cs=-0.56`, `6.14 m/s`), `99` `205:13` (159.73 s, `cs=-2.92`, `6.16 m/s`).
   - `8947 -> 4659` passes 2.45 m from `te 55`; cars (`0.92 + 1.2 = 2.12 m`) clear it, while buses (`1.30 + 1.2 = 2.50 m`) do not, and `mapTramsToRoads` uses `gap - 0.1 = 2.2 m`.

4. **Connector entries (2 pairs, moving):**
   - `1` `3:12` (163.67 s, `2595 -> 6864` L, `cs=-2.13`, `1.73 m/s`, `hitSecs=[2]`: enters right after `cHeld` clears and grazes rear section 2).
   - `2` `41:1` (234.33 s, `9014 -> 4693` L, `cs=6.97`, `5.69 m/s`, `heldByTram=true`, `tramWait='tram'`: already committed before `cHeld`).

## Rejected candidate: `BUS_OVERLAP = 2.6` (`busOnly` conflicts)

Adding `busOnly` conflicts in `mapTramsToRoads` for curves between 2.2 m and 2.6 m from a track (combined with `_tramLeftGap`) cut overlaps 32 → 24 (Jeżyce 19 → 11, 0 moving; Centrum 3 → 0; Stare 2 → 0), but raised Kaponiera overlaps 6 → 11 and caused **4 deadlocks** in Jeżyce (`held > 60 s` 23 → 89, `> 120 s` 0 → 1, `boxStuck` 2 → 8, mean `14.61 → 13.95 km/h`) as `busOnly` holds at `(-2069, -470)` held buses in the box. Reverted from `js/trams.js`.

## Retained fix: `_tramLeftGap` left-turner clearance (`js/traffic.js`)

`setTrams` precomputes `e._tramLeftGap` (minimum distance from the last 30 m of a 1-lane edge's lane centre to any tram track strictly to its left, ignoring same-lane tracks directly under the car). `drive()` clamps `targetDl` by `Math.max(0, v.edge._tramLeftGap - v.halfWidth - 1.3)` (`1.2 m` tram half-width + `0.1 m` margin).

### Before → after (8 seeds × 7 districts)

**Car–tram overlap audit:** **32 (10M/22S) → 27 (10M/17S)**
- `jezyce`: **19 (5M/14S, 1,765f) → 15 (5M/10S, 1,476f)** (all 4 Group 2 pairs removed; seed `7` gained 1 downstream `4660` connector pair `51:16` at 285.47 s)
- `stare`: **2 (1M/1S, 196f) → 1 (1M/0S, 20f)**
- `lazarz`, `centrum`, `kaponiera`, `rataje`, `wilda`: unchanged (`0, 3, 6, 2, 0`).

**Traffic flow benchmark (8-seed means / maxima / sums):**
- `jezyce`: mean `14.612 → 14.525 km/h`, stopped `33.425 → 33.638%`, worst hold `118 → 118 s`, `>60 s` `23 → 23`, `>120 s` `0 → 0`, deadlocks `0 → 0`, `boxStuck` `2 → 2`. Seeds `1, 2, 3, 5, 11, 99, 4242` are bit-identical; only seed `7` shifted (`15.2 → 14.5 km/h`, `32.0 → 33.7%`, with higher throughput at the top 5 junctions and `maxWait 85 → 84 s`).
- `lazarz`, `centrum`, `kaponiera`, `stare`, `rataje`, `wilda`: **100% bit-identical** on every seed and metric.

## Verification

- `node --test tests/`: **624/624** pass (including new `left-turner lateral shift stays clear of a tram track on its left` in `tests/traffic.test.cjs`).

## Coordinator check

Removed two leftover `c.busOnly` guards in `heldByTram` / `tramStandsAt` from the rejected `BUS_OVERLAP` variant; nothing
sets `busOnly`. Rerun on the cleaned branch: the 8-seed overlap audit gives 27 pairs (Jeżyce 15, Kaponiera 6, Centrum 3,
Rataje 2, Stare Miasto 1). The full `node --test tests/` passes 624/624.
