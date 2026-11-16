# Zawady and Ogrody terminal loop boarding — 2026-11-16

Fixes the missing terminal dwells at the Zawady and Ogrody loops reported in
[browser-checks-2026-11-16.md](browser-checks-2026-11-16.md).

## Causes verified

1. **Chain-end stop scan & pre-switch clamp (`js/trams.js`):**
   - `drive()` previously scanned stops starting at `ic = path.indexAt(u)`. Stops at the exact end of a chain
     (Zawady arrival `(1635.7, -502.7)` on chain 533 `s = 346.46 = len`; Ogrody departure `OGDY42` `(-3475.8, -870.5)`
     on chain 975 `s = 85.41 = len`; Rondo Rataje `(1027.2, 1396.0)` on chain 576 `s = 1027.95 = len`) have their
     stopping target `s + 0.35 * length` (~11.1 m) beyond the chain end. Once the front crossed into the next edge,
     `ic` advanced and the stop vanished from `t.nextStop`.
   - At Zawady, the link after chain 533 (chain 1058, 9.06 m) ends at the switch `(1641.9, -509.3)` (`foulEnd = 4.00 m`),
     so an unclamped `s + 0.35 * length` target would stop the nose ~2.1 m past the switch.
   - Fix: step `j0` back from `ic` while `u - path.start[j0] <= stopOffset + 0.5` so recent chain-end stops remain
     targeted, and in `curbStopTarget` clamp any stop whose target crosses the edge end (`st.s + offset > edge.len`)
     before any `switch` `noStop` zone (`entry - 0.5`) when `stopBodyClear` holds. That covers both chain-end stops
     (Zawady) and stops ~9 m before an edge end at a switch (Głogowska/Hetmańska `(-2750, 2032)`, chain 672,
     `s = 1641.52 / 1650.75`, no-stop zone from `1646.8`), while leaving non-terminal mid-edge stops (`Rynek Jeżycki`,
     `Bałtyk`, `Zamek`, `Kórnicka`) untouched (`car–tram pairs` rose `74 → 97` on 20 seeds when those were clamped).
     `clampStopZone` is hoisted out of `curbStopTarget` so no closure is allocated per frame.

2. **Zawady departure platform track routing (`tools/poz-roads.mjs` → `js/geodata.js`):**
   - At Ogrody, `TRAM_ROUTE_EXTENSIONS` (`495295031 → 100278290 → 495295027`) already follows the main loop
     (avoiding `100278294`, tagged `service=siding` in OSM), and `OGDY42` `(-3475.8, -870.5)` already snaps to
     chain 975 (`routes: [3, 10, 13, 33]`). Fixing cause (a) restores boarding for all lines (2, 7, 8, 18).
     (`OGDY41` at `(-3501.3, -945.7)` remains skipped with `why: 'no room'` in `tram-infra.js`.)
   - At Zawady, OSM relation 4763597 starts at `stop_entry_only` node `2689845386` (`ZAWA42`, `(1650.1, -561.4)`) on
     the **inner** track (`87781251`, end of way `73491169`). On the inner track, the right-hand platform side
     (`side = 1`) sits in the gap between chains 554 and 985, which narrows to 0.44 m before the join at
     `(1609.7, -563)` (`< PLATFORM_EDGE 1.35 m`), so `tram-infra.js` skips `2689845386` with `why: 'no sign spot'`.
     Preferring a routed track when snapping would still fail on chain 554 and leave Zawady with zero departure
     platforms. Because the sim has no platform room on the inner track, `TRAM_ROUTE_EXTENSIONS` routes line 5 via
     the outer track (`133882284 → 335763489`, chain 985) to depart from the outer `ZAWA42` island platform
     (`(1654.1, -565.6)`) before joining `87781251` (chain 555) at `(1609.7, -563)`, and `js/geodata.js` was rebuilt.

## Headless verification

### Loop dwells before vs after (5 min, 15 fps, seed 4242)

| Loop | Lines | Loop passes (before → after) | Dwells (before → after) | Dwells / pass | Switch stops |
|---|---|---|---|---|---|
| Zawady `(1645, -535)` | 5 | 5 → 3 | 0 → 5 | 0.00 → 1.67 (2.00/full pass) | 0 |
| Ogrody `(-3490, -905)` | 2, 7, 8, 18 | 10 → 7 | 0 → 7 | 0.00 → 1.00 | 0 |

At Zawady after the fix, line 5 trams dwell with open doors at both the arrival platform `(1638.9, -506.1)` (4.5 m
before the switch) and the departure platform `(1645.0, -571.8)`, then depart. At Ogrody, lines 2, 7, 8, and 18 all
dwell with open doors at `(-3466.1, -865.3)` and depart.

### Stops beyond the loops newly revealed by the step-back (5 min, 15 fps, seed 4242)

Three non-loop stops also sit within `0.35 × length` of a chain end and are now served with `switchStops = 0`:
- `Wrocławska` `(-115.2, 333.9)` (chain 1195, `s = 77.79 / 85.73`): 6 dwells at `(-104.7, 337.3)` / `(-138.7, 323.4)`,
  `switchStops = 0`.
- `Rondo Rataje` `(1027.2, 1396.0)` (chain 576, `s = 1027.95 / 1027.95`): 13 dwells around Rondo Rataje including
  `(1037.1, 1400.8)`, `switchStops = 0`.
- `Głogowska/Hetmańska` `(-2749.6, 2032.5)` (chain 672, `s = 1641.52 / 1650.75`, ending at a switch): 3 line-7 dwells
  at `(-2745.6, 2034.8)` clamped before the switch's `noStop` zone (17 total dwells in the area), `switchStops = 0`.

### City-wide per-line comparison (8 locations × 5 min, 15 fps, seed 4242)

Line 5 dwells rise `30 → 52` (mean `13.8 → 10.6 km/h` from the added terminal dwells; moving `23.8 → 22.5 km/h`).
Ogrody lines 2, 7, 8, 18 show `38→40`, `42→41`, `40→38`, `29→31` dwells (moving `22.8→22.2`, `22.6→24.7`, `22.6→21.8`,
`24.7→23.8 km/h`). Elsewhere, downstream timing shifts from the added dwells change line 9 (`14 → 8` dwells, moving
`20.7 → 20.4 km/h`), line 12 (`38 → 30` dwells, moving `29.8 → 30.1 km/h`), and line 17 (`29 → 40` dwells, moving
`24.4 → 24.7 km/h`); lines 10, 11, 14, 15, 24 are unchanged in dwells and moving speed.

### Traffic acceptance (`node tools/accept-traffic.mjs --base poznan`, 20 fresh seeds)

| Metric | Baseline | Working | Mean diff / seed | 95 % CI | Verdict |
|---|---|---|---|---|---|
| car–tram pairs | 74 | 76 | +0.1 | [-0.4, +0.6] | within noise |
| holds > 120 s | 28 | 27 | -0.05 | [-0.15, 0] | within noise |
| deadlocks | 3 | 3 | 0 | [0, 0] | within noise |
| max wait s | 2195 | 2166 | -1.45 | [-6.1, +2.45] | within noise |
| km/h all | 304 | 305.1 | +0.05 | [-0.06, +0.16] | within noise |

All 7 per-district speeds are `within noise` (Jeżyce, Łazarz, Kaponiera, Wilda: 0.0 diff). New deadlock patterns: none.

## Visual check (Headless Chrome, WebGPU high, 60 fps, port 8240 / CDP 9440)

Captured under `/tmp/agy-loop-boarding/` with 0 browser exceptions:
- `zawady-arrival.png`: line 5 (`Zawady`) dwelling at the Zawady arrival platform, clear of the switch ahead.
- `zawady-departure.png`: line 5 (`Zawady`) dwelling at the Zawady departure island platform/shelter.
- `ogrody-departure.png`: line 2 (`Dębiec PKM`) dwelling at the Ogrody departure island platform with open doors
  clearly visible.
