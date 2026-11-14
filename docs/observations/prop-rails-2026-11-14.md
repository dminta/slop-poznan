# Prop-and-Outskirts Rail Clearance Audit & Fix (2026-11-14)

## Method

[tools/audit-prop-rails.mjs](../../tools/audit-prop-rails.mjs) builds the full Poznań scene headlessly (without WebGPU/browser rendering) and measures the exact 2D distance from every static object's final built footprint (oriented bounding box or circle at its final `InstancedMesh` transform or collider record) to every `GEO.rail` centreline segment (`kind: 'tram'` and `kind: 'rail'`).

- **On-track threshold**: `< 0.5 m` from track centreline.
- **Vehicle envelope threshold**: `< TRAM_HALF_WIDTH` (`1.2 m` from [js/trams.js](../../js/trams.js)) for `kind: 'tram'`, and `< RAIL_SLEEPER / 2` (`1.3 m` from `RAIL_SLEEPER = 2.6 m` in [js/tram-infra.js](../../js/tram-infra.js)) for `kind: 'rail'`.

Rerun commands:

```sh
node tools/audit-prop-rails.mjs
node --test tests/
```

## Baseline vs After-Fix Numbers

Audited `271,705` static objects before fixes and `271,349` after fixes:

| Category | Before count | Before onTrack | Before inEnv | Before minDist | After count | After onTrack | After inEnv | After minDist |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `outskirts-building` | 45,787 | 168 | 176 | 0.000 m | 45,609 | 0 | 0 | 1.535 m |
| `tram-stop-sign` | 232 | 0 | 1 | 1.032 m | 232 | 0 | 0 | 1.688 m |
| `rail-end-wall` | 178 | 178 | 178 | 0.000 m | exempt (178) | — | — | tram >= 1.2 m |
| `landmark-collider` | 15,112 | 1 | 1 | 0.000 m | 15,112 | 1 | 1 | 0.000 m |
| `tram-catenary-pole` | 4,491 | 2 | 8 | 0.321 m | 4,491 | 2 | 8 | 0.321 m |

All other 25 audited categories (`ad-column`, `airport-collider`, `bench`, `bollard`, `bridge-parapet`, `canopy-post`, `flower`, `gas-lantern`, `hydrant`, `kiosk`, `led-mast`, `parking`, `plaza-park-lamp`, `plaza-planter`, `postbox`, `rail-catenary-mast`, `rail-fence`, `signal-mast`, `signal-pole`, `tram-shelter`, `tram-ticket-machine`, `tree-pit-curb`, and all six `tree:*` sources) had **0** on-track and **0** in-envelope hits both before and after.

## Fixes

1. **`outskirts-building` ([js/outskirts.js](../../js/outskirts.js))**: imported `railRectClear` from [js/city-grid.js](../../js/city-grid.js) (reusing its existing 32 m `_railCells` index). In `place()`, buildings keep their exact `rand()` draws and are tagged `onRail: !railRectClear(p.x, p.z, w * 0.5, d * 0.5, rot, 1.5)`; `roofBox()` tags roof structures with `onRail: rec.onRail`; and `generateOutskirtsBuildings()` filters `list.filter((b) => !b.onRail)` after generation so the shared RNG stream is untouched. Comparing `main` vs `agy-props-rails` (`generateOutskirtsBuildings().list`) confirms `46,873 -> 46,682` records (`191` removed: `13` panel blocks and `178` unit/roof boxes) with `0` unmatched `x/z/w/d/h/seed` differences among all `46,682` kept buildings, and `0` on-track / `0` in-envelope hits (`minDist = 1.535 m` across the `45,609` unit-box outskirts buildings).
2. **`tram-stop-sign` ([js/tram-infra.js](../../js/tram-infra.js))**: replaced straight tangent extrapolation (`at(12, base + 0.55)`) with `pointAt(tr, sSign)` along the curved track (clamped to the island platform `[stop.platform.s0 + 0.5, stop.platform.s1 - 0.5]` or `[0, tr.len]`). On the curved Os. Czecha loop at `(2804.96, 2505.68)`, the sign moved from `1.0316 m` (inside `TRAM_HALF_WIDTH = 1.2 m`) to `minDist = 1.688 m` across all `232` stops.

## Exemptions & Grade-Separated Cases

Legitimate track-side/overhead elements excluded from prop counts:

- `tram-rail-pieces` (`30,691`), `tram-platforms` (`192`), `tram-overhead-spans-arms` (`2,882`)
- `rail-ballast-sleepers` (`13,612`), `rail-viaducts` (`99`), `rail-overhead-arms-portals` (`1,561`)
- `rail-end-walls-cut-beds` (`178`): concrete retaining walls/abutments spanning across cut railway beds; verified `>= TRAM_HALF_WIDTH` from every tram track.
- `canopy-overhead-roofs` (`215`, `minY >= 4.0 m`) and `name-plates-wall-mounted` (`222`).

Remaining non-exempt 2D hits are intentional vertical/grade-separated crossings:

- `landmark-collider` (`1` hit at `(-1439.8, 649.2)` `[rail]`, block 849 Wilda): the Poznań Główny station hall intentionally spans over the station tracks (`railCorridor` keeps players out; trams do not run on `kind: 'rail'`).
- `tram-catenary-pole` (`2 < 0.5 m`, `8 < 1.3 m`, worst `0.3209 m` at Most Dworcowy `(-1414.83, 588.19)`): all `8` are measured against `kind: 'rail'` underneath grade-separated railway viaducts (`yClearance >= 6.0 m`); against `kind: 'tram'`, `minDist = 1.610 m`.

## Boot-Time Benchmark (Main vs Worktree)

3 interleaved headless builds (`city-config` + `city-grid` + `outskirts` + `tram-infra`, `.agent-task/bench-boot.mjs`):

- `main` (`b884518`): `totalMs` `[18038.3, 51075.5, 25986.4]` (median **25,986.4 ms**); `outskirtsMs` median **1,948.5 ms**; `tramMs` median **5,343.8 ms**.
- `agy-props-rails`: `totalMs` `[19889.9, 46149.5, 18452.2]` (median **18,452.2 ms**); `outskirtsMs` median **1,661.5 ms**; `tramMs` median **4,504.1 ms**.

Reusing `_railCells` adds no new global index and keeps boot time flat.

## Verification & Limits

- `node --test tests/`: `603` tests passed, `0` failed, `0` skipped.
- Headless geometry only; no browser pages were opened. Visual verification coordinates:
  1. `(2804.96, 2505.68)` — Os. Czecha curved tram loop stop sign (moved clear of the 1.2 m tram envelope).
  2. `(-1570.93, 3050.74)` — southern outskirts corridor where an outskirts building (`0.23 m` from track) was removed.
  3. `(-6195.94, -3290.83)` — northwest outskirts corridor where an outskirts building (`0.14 m` from track) was removed.
