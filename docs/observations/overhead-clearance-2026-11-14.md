# Overhead clearance audit (headless, 2026-11-14)

Static geometric audit of every overhead structure over rail tracks, tramways and drivable roadways in Poznań, plus swept vehicle envelopes from the production builders.

## Method and sources

- Tool: `tools/audit-overhead-clearance.mjs` (runs `js/geodata.js`, `js/city-config.js`, `js/road-network.js`, `js/canopies.js`, `js/bridges.js`, `js/tram-infra.js` and `js/landmarks*.js` headlessly via `tests/helpers/module.cjs` and `tests/helpers/three-stub.cjs`).
- Overhead structures collected (10,524 parts total; 393 intersecting track or lane corridors):
  - **Canopies** (`js/canopies.js:88-122`): roof slabs (`[c.clearance, c.h]`), long-edge beams (`[c.clearance - 0.28, c.clearance]`), and `0.4 × 0.4 m` columns (`[0, c.clearance]`).
  - **Mainline rail viaducts & abutments** (`js/tram-infra.js:880-1030, 1270-1370`): viaduct decks (`yClearance` `6.0 m` over trams / `4.8 m` over roads, deck top `yClearance + 0.35`, `160 m` ramp length) and `7.5 m` abutment walls (`h = yClearance`).
  - **Mainline rail catenary portals** (`js/tram-infra.js:2008-2015`): crossbeams at `yElev + 8.9 m` (`0.35 × 0.5 m`), droppers at `yElev + RAIL_WIRE_Y..yElev + 8.65 m` (`RAIL_WIRE_Y = 5.6`, `RAIL_MESSENGER_Y = 7.0`).
  - **Bridges, overpasses and footbridges** (`js/bridges.js:1-883`, `js/city-config.js:150-250`): deck undersides, arch wind-bracing (`ribY(t) - 0.55` where `ribY >= 7.2`), covered footbridges (Cybina `3.39 m`), piers and abutments.
  - **Landmarks** (`js/landmarks-dworzec.js:41-183`, `js/landmarks*.js`): Poznań Główny 2012 station hall (`13.6 m` high at `(-1439.8, 649.2)`), Stary Dworzec, Avenida, Katedra (`(1000.6, -336.7)`), and remaining landmark colliders.
- Swept vehicle envelopes from code (`js/actor-models.js`, `js/trams.js`, `js/tram-infra.js`):
  - `train_body` (static gauge above rail track, `yElev + 4.30 m` roof), `train_catenary` (`yElev + RAIL_MESSENGER_Y = 7.0 m` + portal/wire clearance),
  - `tram_body` (`TRAM_ROOF = 3.18 m`, `w = 2.45 m`), `tram_panto` (`TRAM_PANTOGRAPH_HEAD = 5.77 m` + `0.025 m` collector half-height = `5.795 m`),
  - `fire_truck` (`BODY_SPECS.fireTruck`, `3.40 m`), `bus_12_18` (`BUS_SPEC` / `BUS_18_SPEC`, `3.255 m` height, `w = 2.55 m` / half-width `1.275 m`), `van` (`2.65 m`), `crossover` (`1.70 m`), `taxi` (`1.63 m` + `TAXI_LAMP`).
- Roadway corridor: `network.edges` lanes and `network.connector` curves (`js/road-network.js`). Rail corridor: `GEO.rail` laid `rail` and `tram` polylines (`js/geodata.js`).

## Findings and fixes

### 1. Mainline catenary portals on viaducts & ramps (`js/tram-infra.js:2008-2015`)
- **Finding**: `rail.portals` and `rail.droppers` hardcoded `8.9` and `8.65` in world `y`, omitting `rail.elevationAt(...)`, whereas `rail.masts` and `rail.arms` already added `yElev`. That dropped 21 portal beams on viaducts and `160 m` ramps below the `11.95 m` catenary and `11.11 m` train body gauge (worst `-3.300 m` at `(-1356.0, 129.5)`).
- **Fix**: Added `yElev = rail.elevationAt ? Math.max(rail.elevationAt(p.ax, p.az), rail.elevationAt(p.bx, p.bz)) : 0` to `rail.portals` (`yElev + 8.9`) and `yElev` to `rail.droppers` (`yElev + RAIL_WIRE_Y` to `yElev + 8.65`). **Result**: `0` `rail-portal` clashes after the fix.

### 2. Canopy columns in roadways & canopy height over tram pantographs (`tools/poz-canopies.mjs`)
- **Findings**:
  - `canopyColumns` only checked `railDistance` (`2.6 m`), not road pieces, placing 5 columns of `roof#4 (-2201.3, 1560.4)` inside drivable lanes/connectors around Rynek Łazarski (worst `dist = 0.000 m`, `bus_12_18` intrusion `1.275 m` at `(-2170.4, 1574.0)`).
  - `SPEC.tram` (`4.8 m`, edge beam `4.52 m`) and `SPEC.roof` (`4.6 m`, edge beam `4.32 m`) clipped animated tram pantographs (`5.795 m`) at 10 canopies (`roof#8, 185, 203, 211`, `tram#7, 9, 110, 133, 199`, `platform#10`) by `-0.795 m` to `-1.475 m`.
- **Fixes**:
  - Added `roadClear(x, z)` in `tools/poz-canopies.mjs` built from `roadPieces` (`hw = (r.w || 6) * 0.5 + 1.5` to cover lane offsets and `1.275 m` bus half-width) and required `columns.length >= 4` (matching `tests/geodata.test.mjs:181`, removing 8 canopies whose columns all fell on roadways).
  - Added `rectOverlapsTram(rect)` (1.3 m lateral reach) raising `clearance = 6.1, h = 6.5` (beam underside `5.82 m > 5.795 m`, within `tests/geodata.test.mjs:178-179` `c.h <= 6.5`).
- **Result**: `0` `canopy-column` road intrusions and `0` `tram_panto` / `tram_body` clashes across all 206 canopies (2,434 columns).

### 3. Document-only findings (no code change)
- **Road vehicles**: `0` vertical clashes across `fire_truck`, `bus_12_18`, `van`, `crossover`, `taxi`. Tightest clearance is `+0.920 m` (`fire_truck` under `4.32 m` canopy beams at `roof#4 (-2171.2, 1533.9)`, `roof#21`, `roof#32`).
- **Poznań Główny 2012 station hall** (`js/landmarks-dworzec.js:41-71`, `(-1439.8, 649.2)`): lidar-calibrated `13.6 m` volume from `y = 0` sits across 51 mainline track segments (`train_body` intrusion `1.500 m`); left unchanged because no animated mainline trains exist and raising it onto a deck would alter its calibrated building height.
- **Garbary & Główny platform canopies on ramps**: `platform#19 (-1391.2, 526.7)`, `platform#1 (-1580.5, 800.3)` and `platform#6 (-1603.7, 826.7)` show `train_body` / `train_catenary` clashes (`-4.829 m` to `-6.113 m`) where elevated `160 m` viaduct approach ramps pass through/under standard `5.0 m` platform canopies; `rail-viaduct` shows 9 `train_catenary` overlaps (`-4.750 m` to `-7.150 m`, worst at `viaduct#72 rail#253 (-1552.6, 614.4)`) where crossing rail tracks stack at Główny.
- **Katedra** (`(1000.6, -336.7)`): ground-level collider corner intrudes into road edge `8453` (`bus_12_18` intrusion `1.275 m`).

## Verification

- **Worst-case remaining counts** (`node tools/audit-overhead-clearance.mjs --top 15`):
  - Before fixes: 42 vertical clashes (incl. 21 `rail-portal`, 10 `tram_panto`), 55 lateral intrusions (incl. 5 `canopy-column`).
  - After fixes: 16 vertical clashes (0 `rail-portal`, 0 `tram_panto`, 0 `tram_body`, 0 road vehicles), 52 lateral intrusions (0 `canopy-column`).
- **Hash check vs `HEAD`** (`node .agent-task/verify-hashes.mjs`): `215 -> 206` canopies (`139` identical, `8` height-only, `59` columns-only, `1` both, `8` dropped with `< 2` road-clear columns); `js/tram-infra.js` diff touches only `rail.portals` and `rail.droppers`.
- **Interleaved headless boot timings** (`main` vs worktree, 3 runs each, `geodata` + `road-network` + `canopies`):
  - `main`: `[8472.7, 8688.6, 9452.2]` ms, median `8688.6 ms`
  - `worktree`: `[8339.2, 9524.3, 9594.7]` ms, median `9524.3 ms` (`+835.7 ms`, within run-to-run variance)
- **Tests**: `node --test tests/` passed `618 / 618` (including `tests/overhead-clearance.test.cjs` and `tests/geodata.test.mjs`).

## Coordinator camera positions for browser screenshots

1. **Rynek Łazarski canopy (`roof#4`, road-cleared columns)**: `eye (-2158, 4.2, 1558)`, `look (-2172, 3.2, 1574)`
2. **Raised tram canopy over tramway (`tram#7`, `clearance = 6.1 m`, beam `5.82 m` > `5.8 m` wire) or viaduct portal**: `eye (3255, 4.5, 2318)`, `look (3274, 5.5, 2324)` (and Główny viaduct portal at `eye (-1340, 12.0, 118)`, `look (-1356, 14.0, 130)`).

## Rerun

```sh
node tools/audit-overhead-clearance.mjs --top 20
node --test tests/overhead-clearance.test.cjs
```
