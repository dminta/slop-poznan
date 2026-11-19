# Tram overrun audit and 20-seed baseline, 2026-11-19

Status: complete continuous tram overrun audit built in `tools/audit-tram-overruns.mjs`, unit-tested in `tests/tram-overruns.test.mjs`, and measured over the 20 default fresh seeds (7 districts, 5 min, 20 fps; 254.158 active tram-hours).

## Why the earlier overrun counter was incomplete

The diagnostic overrun counter in `tools/audit-tram-braking.mjs` only checked `gate.d >= 0 && gate.d + 0.01 < t.speed * dt` against gates emitted into `_audit.gates` by `drive()` in `js/trams.js`:

1. It ignored every gate with `gate.d < 0` when first observed closed (e.g., `signal` gates pulled upstream of `u` by `complexStopGate`, `nodeSwitch`/`crossSwitch`/`block` gates closing while the tram was already inside the fouling zone, and `road`/`nodeRoom`/`crossRoom`/`keepClear` gates with `entry <= 0.2` skipped by `drive()`).
2. It did not track signal stop-line crossings independently of `_audit.gates` (when `gap < 0.2` or committed), so it could neither prove red-signal compliance nor separate committed-in-complex clearings from true red entries.
3. It did not track switch/crossing/block occupancy and approach claims continuously at `entryU` and `nodeU`.
4. `holdBeforeComplex` could emit separate `complex` gates at the same entrance for different downstream blockers while a tram stood still, and `path.trim()` could shift an upstream complex gate behind `u`.

## Audit design (`tools/audit-tram-overruns.mjs`)

`instrumentTramsForOverruns` instruments a headless copy of `js/trams.js` purely for read-only observation (verified bit-identical in RNG state, positions, speeds and `waitReason` against uninstrumented `js/trams.js`). `createOverrunTracker` tracks every active tram continuously per `(tramId, spawnId)` incarnation using monotonic `totalU` (`trimOffset = totalUBefore - pre.u`) so `path.trim()` shifts never drop or duplicate tracked gates:

- **Red-signal stop-line crossings:** checks every signal on `path` where the front moves across `stopLineU = sj + sig.s` (`from <= stopLineU && to > stopLineU`) while `signalPhase` is `'red'` or `'redAmber'`. Crossings are separated into:
  - `trueRedOverruns`: `sig.node` was not in `t._signalCommits` before `advance()`.
  - `committedSignalClearings`: `sig.node` was in `t._signalCommits` (entered the upstream complex entry on green and legally clearing the interior head).
- **Occupied-switch overruns:** checks every `nodeSwitch` (`N.in.length >= 2 || N.out.length >= 2`), off-node `crossSwitch` and single-track `block` where another tram `o !== t` holds (`holds` / `crossHeld` / `inRun`) or claims (`reaches` / `crossApproach` / `entersRun`) the conflict (including a merging tram from another incoming branch still straddling `N` onto the same exit edge). Fires once per traversal if `t` crosses `entryU` while occupied/claimed, or crosses `nodeU` while occupied if not already triggered at `entryU`.
- **Closed-gate crossings:** tracks all safety/control gates (`signal`, `nodeSwitch`, `crossSwitch`, `block`, `nodeRoom`, `crossRoom`, `keepClear`, `road`, `platform`, `stop`, `end`, and `complex`), including gates where `entry <= 0.2` or `gap < 0.2` (`behindProbe: true`). Keying `signal` gates by invariant `absStopLineU` and `complex` gates at the same entrance together prevents multi-blocker or `path.trim()` re-firing. Distinguishes:
  - `forward`: `absFrom <= absGateU && absTo > absGateU` while closed.
  - `behind`: `absGateU < absFrom` when first observed closed (or transitioning from open to closed behind the front), excluding fresh-spawn baselines (`isFreshSpawn`).
  - Also reports a `closedGateNonCreep` sub-breakdown (`speedPre >= 0.3` m/s or `dPost < -0.1` m) alongside total crossings so sub-0.3 m/s IDM asymptotic equilibrium creeps within 0.1 m of the `-0.5 m` gate offset (still >= 0.4 m before the physical stop line) are separated from dynamic crossings.

## 20-seed baseline (7 districts, 5 min, 20 fps, 20 s warmup)

Command:

```sh
node tools/audit-tram-overruns.mjs --default-seeds --minutes 5 --fps 20 --jobs 9 --events --json /tmp/tram-overruns-20seeds.json
```

Seeds: `61 67 71 73 79 83 89 97 101 103 107 109 113 127 131 137 139 149 151 157`.

### Overall totals (254.158 tram-hours)

| Metric | 20-seed total | Breakdown / notes |
|---|---:|---|
| True red-signal stop-line overruns | **0** | 0 `red`, 0 `redAmber` |
| Committed-in-complex clearings | **110** | Legitimate green-entry complex clearings (Kaponiera 54, Jeżyce 30, Centrum 25, Stare Miasto 1) |
| Occupied-switch overruns | **1** | `nodeSwitch:occupied` 1 (same-exit merge straddle), `claimed` 0, `crossSwitch` 0, `block` 0 |
| Closed-gate crossings (all) | **8,258** | 6,630 forward / 1,628 behind (7,751 IDM creep + 507 non-creep) |
| Closed-gate crossings (non-creep) | **507** | 223 forward / 284 behind (`speedPre >= 0.3` m/s or `dPost < -0.1` m) |

### Breakdown by district (20-seed sums)

| District | Tram-hours | True red | Committed clearings | Occupied switches | Closed gates (all: fwd / beh) | Non-creep (fwd / beh) |
|---|---:|---:|---:|---:|---:|---:|
| Jeżyce | 36.780 | 0 | 30 | 0 | 1,274 (1,053 / 221) | 77 (32 / 45) |
| Łazarz | 33.840 | 0 | 0 | 0 | 1,580 (1,520 / 60) | 60 (20 / 40) |
| Centrum | 37.241 | 0 | 25 | 1 | 954 (684 / 270) | 50 (23 / 27) |
| Kaponiera | 37.190 | 0 | 54 | 0 | 1,412 (1,062 / 350) | 203 (79 / 124) |
| Stare Miasto | 37.187 | 0 | 1 | 0 | 853 (671 / 182) | 50 (19 / 31) |
| Rataje | 35.420 | 0 | 0 | 0 | 885 (780 / 105) | 27 (10 / 17) |
| Wilda | 36.500 | 0 | 0 | 0 | 1,300 (860 / 440) | 40 (40 / 0) |

### Closed-gate breakdown by kind (20-seed sums)

| Gate kind | All forward | All behind | Non-creep forward | Non-creep behind |
|---|---:|---:|---:|---:|
| `signal` | 2,358 | 76 | 4 | 10 |
| `complex` | 1,577 | 1,001 | 147 | 38 |
| `platform` | 1,729 | 0 | 0 | 0 |
| `keepClear` | 662 | 302 | 0 | 66 |
| `nodeRoom` | 162 | 75 | 4 | 48 |
| `road` | 101 | 157 | 42 | 113 |
| `stop` | 41 | 0 | 26 | 0 |
| `crossRoom` | 0 | 8 | 0 | 0 |
| `block` | 0 | 6 | 0 | 6 |
| `nodeSwitch` | 0 | 3 | 0 | 3 |

### Per-seed summary

| Seed | Tram-h | True red | Committed | Switch | Closed (all: fwd / beh) | Non-creep (fwd / beh) |
|---:|---:|---:|---:|---:|---:|---:|
| 61 | 12.728 | 0 | 7 | 0 | 413 (322 / 91) | 27 (10 / 17) |
| 67 | 12.715 | 0 | 6 | 0 | 418 (339 / 79) | 17 (9 / 8) |
| 71 | 12.698 | 0 | 7 | 0 | 420 (340 / 80) | 38 (16 / 22) |
| 73 | 12.706 | 0 | 5 | 0 | 414 (334 / 80) | 21 (9 / 12) |
| 79 | 12.708 | 0 | 7 | 0 | 408 (334 / 74) | 13 (6 / 7) |
| 83 | 12.709 | 0 | 5 | 0 | 425 (337 / 88) | 24 (9 / 15) |
| 89 | 12.728 | 0 | 4 | 0 | 423 (341 / 82) | 15 (8 / 7) |
| 97 | 12.727 | 0 | 6 | 0 | 410 (330 / 80) | 31 (16 / 15) |
| 101 | 12.714 | 0 | 4 | 0 | 409 (327 / 82) | 25 (11 / 14) |
| 103 | 12.708 | 0 | 5 | 0 | 414 (339 / 75) | 30 (13 / 17) |
| 107 | 12.696 | 0 | 4 | 0 | 420 (330 / 90) | 27 (10 / 17) |
| 109 | 12.707 | 0 | 6 | 0 | 404 (325 / 79) | 24 (10 / 14) |
| 113 | 12.682 | 0 | 3 | 0 | 408 (327 / 81) | 28 (17 / 11) |
| 127 | 12.694 | 0 | 7 | 0 | 405 (324 / 81) | 26 (8 / 18) |
| 131 | 12.685 | 0 | 9 | 0 | 402 (323 / 79) | 27 (11 / 16) |
| 137 | 12.708 | 0 | 5 | 0 | 422 (336 / 86) | 33 (13 / 20) |
| 139 | 12.722 | 0 | 6 | 1 | 402 (323 / 79) | 27 (12 / 15) |
| 149 | 12.705 | 0 | 4 | 0 | 398 (321 / 77) | 17 (9 / 8) |
| 151 | 12.719 | 0 | 6 | 0 | 437 (343 / 94) | 35 (16 / 19) |
| 157 | 12.699 | 0 | 4 | 0 | 406 (335 / 71) | 22 (10 / 12) |

## Real findings and defect analysis

1. **Red-signal stop-line compliance is 100% across all 20 seeds:** 0 true red or red+amber entries in 254.158 tram-hours. All 110 red stop-line crossings were legitimate `committed_complex_clearing` events (Kaponiera 54, Jeżyce 30, Centrum 25, Stare Miasto 1).
2. **One minor occupied-switch foul-entry overshoot (seed 139, Centrum):** at `272.10 s`, tram `#10` (line 18, Gamma) at `(-1467.7, 127.9)` (`6.52 -> 6.07 m/s`, `acc = -9 m/s²`, `waitReason = 'room'`) overshot the `foulEntry` point (`u = 83.222 -> 83.291`, `+0.07 m`) while tram `#4` (`4.38 m/s`) was still straddling switch `(-1467.7, 127.9)` after merging onto the same exit edge (`sameExitEdge: true`). There were 0 cross-branch switch overruns, 0 claimed-switch overruns, 0 diamond-crossing overruns and 0 single-track block overruns.
3. **Behind-tram signal closures (10 non-creep events):** all 10 non-creep `signal:behind` events occurred on `amber` (`dPre` `-2.81` to `-44.68 m`) at Most Teatralny (`-1373.18, -213.7`), Dworcowa (`-1191.53, 583.17`), Kaponiera (`-1503.29, 224.03`) and Rondo Rataje (`1238.65, 1037.55`), where the tram was inside a complex without green entry commitment (or after an `atStop` dwell cleared `_signalCommits`) and `complexStopGate` pulled the amber gate behind `u`. Every one of them still stopped before the red stop line (0 true red overruns).
4. **Behind-tram `nodeSwitch` (3) and `block` (6) closures:**
   - `nodeSwitch:behind` (3): Jeżyce seed 61 tram `#13` at `245.3 s`, `(-2048.63, -458.7)` (`3.3 -> 2.85 m/s`, `dPre -5.605 m`, blocker `#1`); Kaponiera seed 83 tram `#11` at `270.95 s`, `(-1469.79, 111.82)` (`0.46 -> 0.01 m/s`, `dPre -2.498 m`, blocker `#22`); Centrum seed 127 tram `#6` at `138.1 s`, `(-1518.83, 226.81)` (`0 -> 0 m/s`, `dPre -10.374 m`, blocker `#12`). All 3 stopped clear of the switch node.
   - `block:behind` (6): Rataje seeds `73, 83, 109, 127, 151, 157` tram `#8` at `252.05 s`, `(1288.9, 1040.37)` (`block:11`, `2.27 -> 1.82 m/s`, `dPre -1.895 m`, blocker `#21`), all stopping clear of the block.
5. **Road-car and complex gates dominate remaining non-creep crossings:** `road:behind` (113) + `road:forward` (42) and `complex:forward` (147) + `complex:behind` (38) account for 340 of the 507 non-creep crossings. Kaponiera alone accounts for 203 of 507 non-creep crossings (especially `-1117.13, 132.17` and `-1373.18, -213.7`). Also note a `complexStopGate` quirk in `js/trams.js`: `if (entry <= entered + 0.2 ...)` sets `gate = entry - 0.5`, which pulls `complex` gates up to `0.29 m` behind `u` whenever `0.2 < entry - u < 0.5`.
