# Kaponiera left turn with a tram approaching — 2026-11-19

Follow-up to [browser-checks-trams-2026-11-17.md §3](browser-checks-trams-2026-11-17.md#3-kaponiera).
Completes the two open items at Rondo Kaponiera's south-west junction (`(-1503.3, 224.0)`, the only node at Kaponiera
with `turn === 'L'` entries in `n.tramConflicts`):
1. Framing a natural close left-turn crossing **before, during, and after** the vehicle passes directly ahead of an
   approaching tram nose (previously only the aftermath ~0.25 s later had been framed).
2. Directly reading per-frame `c.held`, `tramFrame`, and `tramConflictGap(t, c)` during a natural ~1 s forecast-gap
   reservation / yield event through release and turn completion, on both **WebGPU high** and **WebGL2 low** in midday
   lighting.

**Verdict: verified clean on both WebGPU high and WebGL2 low (`0` console errors, `0` warnings).** No `js/`, `tools/`
or test file was modified.

## Runtime mechanism (`js/traffic.js`)

- `occupyTrams()` (`js/traffic.js:2085-2120`) increments `tramFrame` once per simulation step and stamps matching
  conflict spans `c` in `te.junctions` / `node.tramConflicts` with `c.held = tramFrame; c.by = t`.
- While a tram `t` is actively approaching unobstructed, `far = path.u + Math.min(TRAM_REACH, 8 + t.speed * 6)`
  (`TRAM_REACH = 70` m). When `t` is slowed/stopped for a car (`t.waitReason === 'car'`, `held = true`), `far` drops
  to `path.u + 2` (`junctionFar = path.u` when `t.speed < 0.1`), releasing its downstream junction forecast so crossing
  vehicles clear.
- `tramConflictGap(t, c)` (`js/traffic.js:2269-2278`) returns `base + c.s0 - path.u` (metres along `t.path` from the
  tram's nose `path.u` to the near end `c.s0` of conflict `c`, negative once the nose passes `c.s0`).
- `mayEnter()` (`js/traffic.js:1354`) refuses a left-turner with `v.held = 'tram'` (`v.waitReason = 'tram'`) when
  `tramBlocks(v, n, f, j)` finds `c.held === tramFrame` and `t.obstacle !== v` (and not exempted as a nose/same-lane
  leader).

## Headless Node scout (`tools/bench-world.mjs` harness)

A headless Node scout at `(-1490, 160)` (`dt = 0.05` s, 300 s across seeds `4242, 1, 2, 3, 5, 7`) confirmed both classes
occur naturally at `(-1503.3, 224.0)`:
- **Seed 1 (`t = 174.65 s`, car 83 / tram 21 line 10):** close crossing directly ahead of the braking tram (`vSpeed = 9.45`
  m/s, `tSpeed = 1.32` m/s, `tramWait = 'car'`, `minBodyGap = 2.76` m, `tramConflictGap = 2.92` m).
- **Seed 2 (`t = 40.25 s`, car 63 / tram 19 line 10):** stopped left-turner held `v.held = 'tram'`, `c.held = 805 === tramFrame`,
  `tSpeed = 11.65` m/s, `tramConflictGap = 11.86` m (`ttc = 1.02` s).

## Browser environment & harness

- **Browser:** Headless Chrome (`--headless=new --enable-unsafe-webgpu --use-angle=metal`), `1280 × 720`, DPR 1,
  `Network.setCacheDisabled(true)`, temporary localhost HTTP server (`Cache-Control: no-store`, stopped and deleted
  after capture).
- **Modes tested:** **WebGPU high** (`/?quality=high`, midday) and **WebGL2 low** (`/?backend=webgl&quality=low`, midday).
  Note that `low` halves `QUALITY_TIERS.low.population` (`vehicleDensity: 6, minVehicles: 15` vs `12 / 30` on `high`),
  so each tier runs its own natural traffic stream.
- **Deterministic stepping:** an in-memory-only patch to `index.html` / `js/main.js` (disk files untouched) seeds
  `Math.random` before `createTrafficSystem`, sets `selectTime('midday')`, hides the HUD and player, fixes the simulation
  focus at `(-1490, 0, 160)`, and steps `tramSystem.update` + `trafficSystem.update` at an exact `0.05` s (`20` Hz)
  cadence with no background `requestAnimationFrame` drift between captured frames.
- **Camera:** elevated oblique view at `(−1472, 24, 262)` looking at `(−1499, 0.8, 232)` (set at `startStep - 1` so all
  approach stop lines, the south-west connector box, and approaching trams are framed clearly).
- **Clearance & frame clock:** `bodyGap` is the exact 2D oriented-rectangle distance (`0` = touching) between the
  vehicle footprint (including trailer OBB for articulated buses) and all tram section OBBs. `tramFrame` is read as the
  global maximum `c.held` stamped on `network.nodes` that step (`cHeldActive = c.held === tramFrame`).
- **Console:** **0 errors, 0 warnings** across every page boot and sequence on both WebGPU high and WebGL2 low.

## 1. WebGPU high (`/?quality=high`)

### (a) Close left-turn crossing ahead of an approaching tram (`seed=47`, car 17, tram 19 line 10)

Steps `830–930` (`t = 41.50–46.50` s). `car 17` (white sedan) enters the left-turn connector at `(-1496.59, 239.28)` while
`tram 19` (Moderus Gamma, line 10) approaches northbound/westbound along the conflict (`waitReason = 'car'`, forecast
released with stale `c.held = 794 !== tramFrame`):

| Step | t (s) | Car 17 pos | Car v / a (m/s, m/s²) | Tram 19 nose | Tram v / a (m/s, m/s²) | `c.held` / `tramFrame` | `tramConflictGap` (m) | `bodyGap` (m) | Phase |
|---|---|---|---|---|---|---|---|---|---|
| 848 | 42.40 | `(-1497.61, 235.24)` | `5.47` / `+1.96` | `(-1492.19, 220.77)` | `5.14` / `-1.53` (`car`) | `794 / 848` (`false`) | `11.77` | `13.28` | Before: car enters box, tram approaching & braking |
| 864 | 43.20 | `(-1499.76, 230.70)` | `7.01` / `+1.88` | `(-1493.51, 224.14)` | `3.99` / `-1.36` (`car`) | `794 / 864` (`false`) | `8.16` | `7.25` | Car crossing in front of tram nose |
| 866 | 43.30 | `(-1500.14, 230.10)` | `7.20` / `+1.86` | `(-1493.64, 224.48)` | `3.47` / `-9.00` (`car`) | `794 / 866` (`false`) | `7.79` | `6.93` | Tram reaches `−9 m/s²` braking cap |
| 875 | 43.75 | `(-1502.17, 227.32)` | `8.02` / `+1.79` | `(-1493.98, 225.36)` | `1.42` / `-2.39` (`car`) | `794 / 875` (`false`) | `6.85` | `6.13` | Directly ahead of nose |
| 876 | 43.80 | `(-1502.44, 227.01)` | `8.10` / `+1.78` | `(-1494.01, 225.42)` | `1.31` / `-2.16` (`car`) | `794 / 876` (`false`) | `6.78` | **`6.11`** | Minimum body clearance |
| 899 | 44.95 | `(-1510.47, 220.37)` | `9.98` / `+1.48` | `(-1494.25, 226.04)` | `0.19` / `-0.44` (`car`) | `794 / 899` (`false`) | `6.11` | `13.74` | After: car clearing west, tram nearly stopped |
| 912 | 45.60 | `(-1516.63, 217.51)` | `10.81` / `+0.92` | `(-1494.27, 226.09)` | `0.00` / `-0.19` (`car`) | `794 / 912` (`false`) | `6.06` | `20.62` | Tram stopped short (`6.06` m from conflict) |

Visual frames confirm the white sedan enters, sweeps directly across the track ahead of the green/yellow Moderus Gamma
nose, and exits west with clean asphalt clearance throughout (`6.11` m minimum OBB gap, zero overlap/clipping).

### (b) ~1 s forecast-gap reservation & yield (`seed=11`, car 15, tram 19 line 10)

Steps `1170–1380` (`t = 58.50–69.00` s). `car 15` (grey SUV) stands behind the south approach stop line at
`(-1496.11, 242.82)` held by `v.held = 'tram'` (`v.waitReason = 'tram'`) while `tram 19` (line 10, Moderus Gamma)
accelerates along its reserved path (`c.held === tramFrame` every frame from `1170` through `1308`), passes with
`0.91` m minimum body gap, and releases `car 15` to complete its left turn:

| Step | t (s) | Car 15 (`held`/`wait`) | Tram 19 nose | Tram v / a (m/s, m/s²) | `c.held` / `tramFrame` | `tramConflictGap` (m) | Forecast TTC (s) | `bodyGap` (m) | Phase |
|---|---|---|---|---|---|---|---|---|---|
| 1188 | 59.40 | `0.00` m/s (`tram`/`tram`) | `(-1491.31, 218.46)` | `6.85` / `+1.05` (`curve`) | `1188 / 1188` (`true`) | `14.24` | `2.08` | `22.26` | Forecast holding car at line |
| 1205 | 60.25 | `0.00` m/s (`tram`/`tram`) | `(-1493.55, 224.26)` | `7.71` / `+0.97` (`curve`) | `1205 / 1205` (`true`) | `8.03` | `1.04` | `16.11` | ~1 s forecast gap |
| 1206 | 60.30 | `0.00` m/s (`tram`/`tram`) | `(-1493.70, 224.62)` | `7.76` / `+0.96` (`curve`) | `1206 / 1206` (`true`) | **`7.64`** | **`0.98`** | `15.73` | ~1 s forecast gap (`0.98` s) |
| 1224 | 61.20 | `0.00` m/s (`tram`/`tram`) | `(-1496.39, 231.48)` | `8.56` / `+0.82` (`curve`) | `1224 / 1224` (`true`) | `0.27` | `0.03` | `8.59` | Tram nose reaches conflict |
| 1248 | 62.40 | `0.00` m/s (`tram`/`tram`) | `(-1499.84, 241.73)` | `9.36` / `+0.49` (`curve`) | `1248 / 1248` (`true`) | `-10.55` | `-1.13` | **`0.91`** | Tram sweeps past held car nose |
| 1308 | 65.40 | `0.00` m/s (`tram`/`tram`) | `(-1506.40, 269.46)` | `9.85` / `+0.74` (`stop`) | `1308 / 1308` (`true`) | `-39.08` | `-3.97` | `0.92` | Final reserved frame (rear clears) |
| 1309 | 65.45 | `0.10` m/s (`tram`/``) | `(-1506.50, 269.94)` | `9.88` / `+0.74` (`stop`) | `1308 / 1309` (`false`) | `-39.58` | `-4.00` | `0.92` | Reservation drops; car accelerates |
| 1323 | 66.15 | `1.50` m/s (`conn = true`) | `(-1507.94, 276.90)` | `10.37` / `+0.65` (`stop`) | `1308 / 1323` (`false`) | `-46.68` | `-4.50` | `3.57` | Car enters left-turn connector |
| 1350 | 67.50 | `4.19` m/s (`conn = true`) | `(-1510.88, 291.15)` | `11.12` / `+0.48` (`stop`) | `-1 / 1350` (`false`) | — | — | `20.45` | Car mid-turn west cleanly |

## 2. WebGL2 low (`/?backend=webgl&quality=low`)

### (a) Close left-turn crossing ahead of an approaching tram (`seed=47`, articulated bus 201, tram 16 line 18)

Steps `2150–2240` (`t = 107.50–112.00` s). Articulated bus `201` turns left across northbound `tram 16` (line 18) while
`tram 16` brakes `waitReason = 'car'` (`c.held = 2132 !== tramFrame`, forecast released):

| Step | t (s) | Bus 201 pos | Bus v / a (m/s, m/s²) | Tram 16 nose | Tram v / a (m/s, m/s²) | `c.held` / `tramFrame` | `tramConflictGap` (m) | `bodyGap` (m, w/ trailer) | Phase |
|---|---|---|---|---|---|---|---|---|---|
| 2171 | 108.55 | `(-1495.45, 248.31)` | `8.98` / `-5.16` | `(-1499.59, 252.50)` | `5.20` / `-1.82` (`car`) | `2132 / 2171` (`false`) | `11.31` | `2.18` | Before: bus entering left-turn curve |
| 2183 | 109.15 | `(-1496.02, 243.60)` | `7.31` / `-1.46` | `(-1498.97, 249.78)` | `4.21` / `-1.53` (`car`) | `2132 / 2183` (`false`) | `8.52` | `1.24` | Bus cutting ahead of tram nose |
| 2192 | 109.60 | `(-1496.53, 240.47)` | `6.91` / `-0.56` | `(-1498.60, 248.15)` | `2.80` / `-9.00` (`car`) | `2132 / 2192` (`false`) | `6.85` | `0.63` | Tram braking at `−9 m/s²` cap |
| 2203 | 110.15 | `(-1497.40, 236.85)` | `6.76` / `-0.05` | `(-1498.52, 247.79)` | `0.00` / `-0.88` (`car`) | `2132 / 2203` (`false`) | `6.48` | **`0.51`** | Minimum clearance (tractor+trailer) |
| 2219 | 110.95 | `(-1499.39, 231.87)` | `6.91` / `+0.37` | `(-1498.48, 247.64)` | `0.49` / `+0.94` (`car`) | `2132 / 2219` (`false`) | `6.32` | `4.47` | After: bus clears west, tram resumes |

Visual inspection confirms clean asphalt separation between `tram 16`'s nose and both sections of articulated `bus 201`
at closest approach (`0.51` m OBB gap, zero overlap/clipping).

### (b) ~1 s forecast-gap reservation & yield (`seed=31` car 24 / tram 14, and `seed=17` car 21 / tram 19)

- **`seed=31` (`car 24` maroon taxi / `tram 14` line 15, steps `5560–5720`, `t = 278.00–286.00` s):** `car 24` waits at
  `(-1496.10, 242.94)` on `signal` until `s = 5594` (`t = 279.70` s), when the signal clears and `car 24` immediately
  transitions to `v.held = 'tram'` (`v.waitReason = 'tram'`) with `c.held = tramFrame` active every step:
  - `s = 5594, t = 279.70`: `held = 'tram'`, `c.held = 5594 === tramFrame`, `tram 14` accelerating at `0.67` m/s²,
    `tramConflictGap = 2.04` m, `ttc = 3.05` s.
  - `s = 5606–5607, t = 280.30–280.35`: `c.held = 5606 / 5607 === tramFrame`, `tram 14` at `1.34–1.40` m/s,
    **`tramConflictGap = 1.42 → 1.36` m (`ttc = 1.06 → 0.97` s)**, `bodyGap = 20.53` m (`tram 14` crosses eastbound/westbound
    across the northern curve with `minBodyGap = 20.49` m).
- **`seed=17` (`car 21` tan car / `tram 19` line 10, steps `760–920`, `t = 38.00–46.00` s):** `car 21` at
  `(-1496.12, 242.76)` is held by `signal` while `tram 19` approaches at `11.17` m/s (`s = 785, t = 39.25` s:
  `tramConflictGap = 11.07` m, `ttc = 0.99` s, `c.held = 785 === tramFrame`), switches directly to `v.held = 'tram'`
  when green arrives at `s = 794, t = 39.70` s (`gap = 6.03` m, `tSpeed = 11.24` m/s, `ttc = 0.54` s), holds while
  `tram 19` sweeps past at `11.04–11.11` m/s (`minBodyGap = 0.96` m at `s = 823–827, t = 41.15–41.35` s), releases
  when `c.held` stops updating at `s = 880, t = 44.00` s (`c.held = 879`, `tramFrame = 880`), and enters the left-turn
  connector at `s = 894, t = 44.70` s.

## Backend comparison

- Both **WebGPU high** (SSR + bloom + 3072² shadows + full vehicle density) and **WebGL2 low** (no SSR/bloom, 1024²
  shadows, 0.75 DPR scale, reduced density) render the Kaponiera tracks, stop lines, cars, articulated buses, trams, and
  midday shadows cleanly with **0 console errors and 0 warnings**.
- In all five sequences, vehicles crossing directly ahead of an approaching tram nose (`minBodyGap` `6.11` m WebGPU,
  `0.51` m WebGL2) trigger natural tram braking (`waitReason = 'car'`, up to the `−9 m/s²` cap) with zero body clipping,
  and stopped left-turners yield on `c.held === tramFrame` through the ~1 s forecast-gap window (`ttc = 0.98` s WebGPU,
  `0.97` s WebGL2) and release cleanly once the tram's rear clears.
