# Centrum pedestrian longest-pair ablation, 2026-11-14

Traced and ablated on `agy-ped-marcin` from the `ped-taczaka-clusters` baseline.

## Per-second traces (Centrum, seed 77)

1. **24 s at Poznańskie Krzyże (`-1139.8, 107.4`, crosswalk `-1136,127` side 2):** two walkers crossed with `dir = -1`, reached `t = 0` with `nextRoute = null`, and reversed to `dir = +1` at `t = 0`. `KERB = 1.6 m` only holds three bodies in single file at `QUEUE_GAP = 0.62 m` (`1.60`, `0.98`, `0.36`), so the fourth walker clamped at `t = 0.00` (`0.36 m` behind the third) in `curbQueue`.
2. **19 s at Święty Marcin sidewalk (`-713.5, 249.6`):** a walker hit `PED_STUCK_TIME` (`20 s`) and `spawnPed` placed it on `way:142:-1:1.7` at `t = 3.41`, `0.44 m` behind a stopped walker (`t = 2.97`, `v = 0`, `queue`). `spawnPed` only checked `QUEUE_GAP` against `track.node.curb` on crosswalks, never against `pedNear` on sidewalks or pedestrian ways.
3. **19 s at Aleja Niepodległości / Składowa (`-1080.2, 301.9`):** a walker `waiting: true` at `KERB = 1.6 m` on crosswalk `-1068,309` side 1 stood `0.34 m` from the start of the `1.85 m` corner link. `entrance` only checked `routePeds.get(routeKey(next.track))`, missing the walker on `after` (`-1068,309` side 1); in addition, `walk()`'s leg-transition guard `(p.dir > 0 ? t >= p.len : t <= 0) && !held` still stepped a walker onto `next` when `roomCause === 'entrance'` held `t` at the track end.
4. **19 s and 16 s at Święty Marcin (`-707.8, 241.5` / `-710.2, 239.3`):**
   - On the `1.1 m` U-turn link, `entrance` skipped `q.v >= 0.5` even though `next.track.len < 2 * QUEUE_GAP` (`1.1 < 1.24`), letting a follower step to `ahead = 0.05` before the leader stopped at `t = 0.48`.
   - In `js/pedestrian-routes.js` (`wayLinks`), collinear same-way cross-links at one bend (`3.4 m` to `way:142:1:1.7` and `4.5 m` to `way:142:1:2.8`) received distinct `walkKey`s (`corner:way:142:1:1.7` vs `corner:way:142:1:2.8`), so a follower did not see the leader ahead in `routePeds`.

## Ablation (each change alone vs baseline)

Tested on:
- 8-district overlap audit: `node tools/audit-ped-overlaps.mjs --minutes 3 --seeds 4242,77`
- `--ped-rooms`: `node tools/bench-traffic.mjs --ped-rooms --minutes 3 --seed 4242`
- Car flow: `node tools/bench-traffic.mjs --only jezyce,centrum --minutes 5` across 8 seeds (`1, 4242, 7, 99, 2, 3, 5, 11`)

| Variant | Clusters (8-dist) | Mean pairs/s (Centrum 4242 / 77) | Entries/min | Tight spawns | `--ped-rooms` 7-dist (Centrum) | Jeżyce / Centrum 8-seed deadlocks (`held > 120 s`) |
|---|---|---|---|---|---|---|
| **Baseline** | **0** | **6.02** (17.7 / 12.1) | **106.7** | 554 | **23,791** (14,588) | **0 / 0** (`0` > 120 s) |
| **A**: `spawnPed` `pedNear` retry (no nudge) + `filePedCell` | 0 | 4.73 (10.4 / 9.1) | 105.6 | 4 | 20,582 (11,252) | **1** on Jeżyce seed 4242 (`6` > 120 s, max 155 s; 4-vehicle box cycle at `(-2069, -470)` shifted by extra `Math.random()` draws) / 0 |
| **B**: `entrance` guards (`shortNext`, `after.node`, hairpin, `roomCause !== 'entrance'`) | **2** (`dworzec` 4242: 15 s, 77: 10 s at Most Dworcowy / Głogowska `(-1558, 575)`) | 5.87 (16.5 / 11.3) | 106.4 | 554 | 23,960 (13,943; Wilda +776) | **1** on Jeżyce seed 11 / 0 |
| **C**: `wayLinks` shared same-way `walkKey` (`js/pedestrian-routes.js`) | **0** | **5.60** (13.9 / 10.6) | **106.9** | 554 | **23,580** (14,075) | **0 / 0** (`0` > 120 s) |
| **D**: `curbLane` 2nd column (`js/traffic.js`) | 0 | 5.98 (17.3 / 11.5) | 106.8 | 554 | 24,763 (14,588; Wilda +952) | 0 / 0 (`0` > 120 s) |

## Kept change

Only **C** (`js/pedestrian-routes.js` `wayLinks`) improves or matches baseline on every metric (`0` clusters, `-7%` 8-district `pairs/s`, `-21%` Centrum seed 4242 `pairs/s`, `-211` `--ped-rooms` total and `-513` in Centrum, `0` deadlocks and `0` cars held `> 120 s` across all 8 Jeżyce/Centrum seeds). **A**, **B**, and **D** were dropped:
- **A** (`spawnPed` `pedNear` retry) cuts `pairs/s` to `4.73` and `--ped-rooms` to `20,582`, but extra `Math.random()` draws on rejected spawns shift Jeżyce seed 4242 into a pre-existing 4-vehicle box cycle at `(-2069, -470)` (`#18` oncoming R, `#211` in box, `#19`, `tram 2`; `155 s` max wait, failing `tests/traffic-flow.test.mjs`).
- **B** (`entrance` hold on short/corner links) creates `2` new clusters at Most Dworcowy / Głogowska (`15 s` and `10 s`), raises `--ped-rooms` (`+169`, Wilda `+776`), and triggers `1` deadlock on Jeżyce seed 11.
- **D** (`curbLane` 2nd column) barely moves `pairs/s` (`6.02 → 5.98`) and adds `+952` `--ped-rooms` in Wilda (`24,763` total).
