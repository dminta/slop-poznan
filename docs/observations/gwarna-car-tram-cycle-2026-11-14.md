# Gwarna car–tram cycle — 2026-11-14

## Reproduction and per-second trace

Reproduced on Centrum seed 1 (`node tools/bench-traffic.mjs --minutes 5 --seed 1 --only centrum --dump --trace -842,13`):

- **Junction `(-842, 13)`** (node 228, give-way, 3 arms, no signal).
  - Approach edge `5390`: `(-814.5, -6.3) -> (-842.3, 12.9)`, length `10.00 m`, 1 lane (`[1.8]`).
  - Exit edge `197`: `(-842.3, 12.9) -> (-861.5, -2.0)`, length `10.00 m`, 1 lane (`[0]`), continuing straight onto `5941` (`60.4 m`).
  - `TramEdge 784` (`len 27.07 m`) runs **against** `197` (`TramLane dir -1`, `s0..s1 = 11.50..21.50`, `l0..l1 = 9.41..0.46`, `0.52 m` lateral separation from `197`'s centreline) and crosses `5390 -> 197` at `TramJunction s0..s1 = 18.39..27.07`.

Per-second sequence in Centrum seed 1:

1. **t = 166.1 s**: Car `#49` enters connector `5390 -> 197` (`conn.len = 27.9 m`) at `6.2 m/s` (`mayEnter` allows entry because `TramEdge 784` is empty).
2. **t = 168.5 s**: Tram `#5` (line `8`) respawns on `TramEdge 784` at `(-878.1, -12.0)` (`u = 550.4`, `s = 3.69` on `TramEdge 784`, `4.6 m/s`, `7.8 m` before `197` and `14.7 m` before `TramJunction 5390 -> 197`). `trackClear(path, length)` in `js/trams.js` checked only `d <= 10 m` ahead of `path.u`, so it did not see `#49` already committed inside `5390 -> 197` (`~35 m` away, crossing `14.7 m` ahead of the tram's nose).
3. **t = 169.1 s**: `occupyTrams` (`js/traffic.js`) places tram `#5`'s opposing-lane proxy (`dir = -1`, `p.speed = 0`) on `197.occ[0]` (`far = path.u + 8 + v*6`). `#49`, still inside `v.conn` (`cs = 17.5 / 27.9`), follows that proxy in `accelerate()` (`follow(v, f.occ[v.out], vs)`) and brakes.
4. **t = 171.1–173.0 s**:
   - `#49` stops inside the junction box at `cs = 26.51 / 27.9` (`vs = -1.4 m` on `197`, `(-848.87, 7.14)`), `0.39 m` behind the tram proxy (`lo = 1.09 m`, `s = 5.63`, `half = 4.54`), `0.30 m` from `TramEdge 784`'s centreline. Its `waitReason` is `'car'` (for the proxy), `held` is `'room'`.
   - Tram `#5` reaches `ROAD_GATE_REACH` (`8 m` before `TramJunction 5390 -> 197` at `s0 = 18.39`). Its ordinary obstacle sweep ignores `#49` as oncoming (`dot = -0.964 < -0.5`, `gap = Infinity`), but `_roadCarGate` in `js/trams.js` sees `#49` `entering` `5390 -> 197` with `waitReason !== 'tram'` (`'car'`) and stops tram `#5` at `s = 17.89` (`(-853.30, 5.02)`), already inside `197` (`0.52 m` from `197`'s centreline).
5. **t = 193–265 s**: Once `#49` has stood `>= 20 s`, `queuedBehindTram(#49, tram 5)` is true, but `obstacleGap(..., true, true)` is finite because `#49` is physically `0.30 m` from `TramEdge 784`. Neither can pass head-on on the `10 m` single-lane corridor (`1.72 m` + `2.40 m` widths vs `0.52 m` separation). At `t = 209 s`, `bench-traffic.mjs` records the 33 s wait-for cycle (`#49` waiting `36.3 s`, tram `#5` stuck `33.4 s`). At `t = 210 s`, a downstream single-track block changes tram `#5`'s `waitReason` to `'block'` while `t.obstacle` remains `#49`. At `t = 266 s` (`stuck > 90 s` while hidden), tram `#5` is retired/respawned and `#49` clears (`wait 92 s`).

## Eight-seed baseline check (Jeżyce, Centrum, Kaponiera)

Checked seeds `1, 2, 3, 5, 7, 11, 99, 4242` (5 min each) on the baseline tree:

- Only **Centrum seed 1** had a deadlock (`1`, the 33 s Gwarna cycle).
- All 7 other Centrum seeds, all 8 Jeżyce seeds, and all 8 Kaponiera seeds had `deadlocks = 0`.

## Fix

In `js/trams.js`, `trackClear(path, length)` now also rejects spawning a tram if any car or bus is already committed inside a junction box (`v.conn && v.edge === c.e && v.lane === c.i && v.move && v.move.to === c.f && v.out === c.j`) for a `te.junctions` conflict `c` within `25 m` ahead of `path.u` (`0 <= base + c.s0 - path.u <= 25`, the tram's spawn braking distance at `8 m/s` / `1.4 m/s²`).

## Regression audit (8 seeds × 7 districts, 5 min, seeds `1, 2, 3, 5, 7, 11, 99, 4242`)

### Traffic flow (`node tools/bench-traffic.mjs --minutes 5 --seed <seed>`)

| District | Mean km/h (before → after) | Stopped % | Worst hold (s) | Held > 60 s | Held > 120 s | Deadlocks |
|---|---:|---:|---:|---:|---:|---:|
| Jeżyce (Rynek Jeżycki) | 14.61 → 14.61 | 33.42% → 33.42% | 118 → 118 | 23 → 23 | 0 → 0 | 0 → 0 |
| Centrum (Św. Marcin) | 14.27 → 14.25 | 33.79% → 33.92% | 92 → **58** | 3 → **0** | 0 → 0 | 1 → **0** |
| Rondo Kaponiera | 12.69 → 12.69 | 49.97% → 49.97% | 145 → 145 | 127 → 127 | 11 → 11 | 0 → 0 |
| Łazarz (Głogowska) | 14.60 → 14.60 | 25.44% → 25.44% | 39 → 39 | 0 → 0 | 0 → 0 | 0 → 0 |
| Stare Miasto | 17.73 → 17.71 | 8.24% → 8.24% | 42 → 42 | 0 → 0 | 0 → 0 | 0 → 0 |
| Rataje (Rondo Rataje) | 17.32 → 17.32 | 34.45% → 34.45% | 70 → 70 | 3 → 3 | 0 → 0 | 0 → 0 |
| Wilda | 15.94 → 15.94 | 35.02% → 35.02% | 63 → 63 | 1 → 1 | 0 → 0 | 0 → 0 |
| **All (56 runs)** | **15.31 → 15.30** | **31.48% → 31.50%** | **145 → 145** | **157 → 154** | **11 → 11** | **1 → 0** |

Jeżyce, Rondo Kaponiera, Łazarz, Rataje, and Wilda are bit-identical across all 8 seeds. Centrum (`−0.02 km/h`, `+0.13%` stopped) and Stare Miasto (`−0.02 km/h`, `0%` stopped) reflect ordinary seeded tram-spawn sequence variation while eliminating the only deadlock (`1 → 0`) and dropping Centrum's worst hold (`92 → 58 s`) and `> 60 s` holds (`3 → 0`).

### Car–tram body overlaps (`node tools/audit-tram-overlaps.mjs --minutes 5 --fps 15 --seed <seed>`)

| District | Pairs before → after |
|---|---:|
| Jeżyce | 19 → 19 |
| Łazarz | 0 → 0 |
| Centrum | 2 → 3 |
| Rondo Kaponiera | 6 → 6 |
| Stare Miasto | 4 → **2** |
| Rataje | 2 → 2 |
| Wilda | 0 → 0 |
| **Total (8 seeds)** | **33 → 32** |

Per seed: `1: 5→6`, `2: 5→4`, `3: 5→4`, `5: 4→4`, `7: 4→4`, `11: 7→7`, `99: 2→2`, `4242: 1→1`. The single added Centrum seed-1 contact (`pair 33:11` at `t = 289.6 s`, `(-1128, 143)`, `carSpeed = 0`, `connector = false`, `conflict = false`) is an unrelated stopped-car touch from the shifted tram spawn sequence, offset by two fewer pairs in Stare Miasto (`33 → 32` net).

## Tests

- Restored the strict `d.deadlocks === 0` assertion for Centrum in `tests/traffic-flow.test.mjs`.
- Full `node --test tests/` passes after the final edit.
