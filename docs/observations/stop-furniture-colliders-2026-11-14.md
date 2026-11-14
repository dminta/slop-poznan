# Stop furniture collider audit, 2026-11-14

Headless geometric and controller-simulation audit of all tram/bus stop furniture built by `js/tram-infra.js`
(`stopFurnitureColliders`, lines 1571–1610) against the instanced visual geometry (`TramShelterFrames`,
`TramShelterGlass`, `TramShelterAdverts`, `TramStopSignPoles`, `TicketMachines`) and `js/controllers.js` collision
resolution (`buildingContact`, `updatePerson`, `updateCar`).

## Method

- `node tools/audit-stop-furniture-colliders.mjs` builds the furnished headless network (`road-network.js`,
  `city-grid.js`, `street-details.js`, `tram-infra.js`), captures the instanced furniture counts from
  `buildTramInfrastructure`, and samples every visual part at player height (`y < 1.9 m`, excluding the `2.45–2.55 m`
  shelter roof and `2.44–2.86 m` stop sign plate) and every collider OBB on a 0.05 m grid.
- It checks `c.obb` presence and OBB-to-AABB consistency against `controllers.js` (`buildingContact`, `nearColliders`).
- It runs `ThirdPersonControllerManager.prototype.updatePerson` (capsule radius `0.48 m`) and `updateCar` (oriented
  car rectangle `hx = 0.86 m, hz = 2.23 m`) against each named diagonal shelter at **Dworzec Zachodni**, **Żniwna**,
  and **Bałtyk** `(-1552.65, 229.67)` from the back (`-z`), left end (`-x`), right end (`+x`), and open front (`+z`).

## Findings (before fix)

- **Instanced counts:** 225 shelters, 232 stop signs, 232 ticket machines (all OBBs, 0 AABB mismatches).
- **Shelters (225):** `maxVisualOutsideCollider = 0.000 m`, **`maxColliderBeyondVisual = 0.880 m`**.
  `stopFurnitureColliders` emitted one solid OBB (`hx = len / 2, hz = 0.7`) across `z ∈ [-0.7, +0.7]`, blocking the
  entire open front (`+z`) with an invisible wall up to `0.880 m` in front of the bench (`z = -0.18`). Worst excess
  points all lay along `localZ = +0.70` (e.g. Budziszyńska `(-5851.20, 2270.79)`, Junikowo `(-6780.50, 2802.96)`,
  Rondo Skubiszewskiego `(-5484.02, 2084.18)`). Walking into any shelter from the open front stopped at
  `localZ = +1.180 m` (`entered = false`).
- **Stop signs (232):** `maxVisualOutsideCollider = 0.000 m`, `maxColliderBeyondVisual = 0.073 m` (0.16 × 0.16 m square
  around the `r = 0.04 m` pole; corner excess `0.08 * √2 - 0.04 = 0.073 m`).
- **Ticket machines (232):** `maxVisualOutsideCollider = 0.000 m`, `maxColliderBeyondVisual = 0.000 m` (exact match to
  the `0.62 × 0.48 m` top cap).

## Fix and verification (after)

- **Change:** `stopFurnitureColliders` in `js/tram-infra.js` now emits 4 OBBs per shelter matching the ground-level
  visuals (`s = len / 4.4`):
  1. Back glass + back posts: `local = (0, -0.62)`, `hx = 2.185 * s`, `hz = 0.035`, `maxY = y + 2.6`
  2. Left end glass + left posts: `local = (-2.15 * s, 0)`, `hx = 0.035 * s`, `hz = 0.655`, `maxY = y + 2.6`
  3. Right advert box + right posts: `local = (2.15 * s, 0)`, `hx = 0.05 * s`, `hz = 0.655`, `maxY = y + 2.6`
  4. Bench: `local = (0, -0.38)`, `hx = 1.2 * s`, `hz = 0.20`, `maxY = y + 0.5`
- **Geometric audit after fix:**
  - Shelters (225): `maxVisualOutsideCollider = 0.000 m`, `maxColliderBeyondVisual = 0.035 m` (down from `0.880 m`).
  - Signs (232): `0.000 m` / `0.073 m` (unchanged).
  - Machines (232): `0.000 m` / `0.000 m` (unchanged).
- **Named diagonal shelter simulations (after fix):**
  - **Bałtyk** `(-1552.65, 229.67)` `yaw = 179.0°`, `len = 4.4 m`:
    - Person: `back` stops `0.515 m` from glass (`localZ = -1.135`), `left` `0.515 m`, `right` `0.480 m`,
      `frontOpen` enters shelter (`local = (1.673, -0.096)`, `entered = true`, `0.524 m` from glass),
      `frontCenter` enters under roof and stops `0.480 m` from bench (`localZ = 0.300`, `entered = true`).
    - Car: `back` stops `2.342 m` from glass (`localZ = -2.962`), `frontOpen` enters to `localZ = 2.137`.
  - **Dworzec Zachodni** (4 shelters: `(-1715.23, 760.96)` `43.9°` `4.4 m`, `(-1695.21, 753.74)` `223.9°` `3.2 m`,
    `(-1618.42, 828.27)` `258.7°` `4.4 m`, `(-1637.99, 878.92)` `78.7°` `4.4 m`) and **Żniwna** (2 shelters:
    `(-521.04, -1750.56)` `224.3°` `4.4 m`, `(-490.63, -1806.34)` `42.3°` `4.4 m`):
    - Every 4.4 m shelter matches the exact same local stop coordinates and `entered = true` from `frontOpen` and
      `frontCenter`. On the 3.2 m Dworzec Zachodni shelter, `person frontOpen` enters to `(1.314, 0.009)` (`entered = true`),
      while the 1.72 m wide car cannot pass between the bench (`x = 0.873`) and right advert (`x = 1.527`) and stops
      outside (`localZ = 2.962`).
- **Collider diff proof:** `main` (`89ec754`) produced 15,266 tram-infra colliders; `agy-shelter-colliders` produced
  15,941 (`+675 = 225 × 3` additional shelter OBBs; only `stopFurnitureColliders` in `js/tram-infra.js` changed).
- **Interleaved headless tram-infra boot timings (3 runs each):**
  - `main` (`89ec754`): `2634.5, 2553.3, 2414.2 ms` (median `2553.3 ms`)
  - `agy-shelter-colliders`: `2624.1, 2493.0, 2403.7 ms` (median `2493.0 ms`)
- **Tests:** `node --test tests/tram-infra.test.cjs` passed (1/1); full `node --test tests/` passed (615/615).

## Rerun commands

```sh
node tools/audit-stop-furniture-colliders.mjs
node tools/audit-stop-furniture-colliders.mjs --json
node --test tests/tram-infra.test.cjs
node --test tests/
```
