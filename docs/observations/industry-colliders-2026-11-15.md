# Industrial structure collider audit, 2026-11-15

Headless geometric and controller-simulation audit of every industrial structure (instanced chimneys and cooling towers)
built by `js/buildings.js` (`industryStructures`) against its player collider and `js/controllers.js` collision
resolution (`buildingContact`, `updatePerson`, `updateCar`), plus clearance against buildings, roads, rails, and props.

## Method

- `node tools/audit-industry-colliders.mjs [--json]` loads `city-config.js`, `geodata.js`, `city-grid.js`,
  `buildings.js`, `road-network.js`, `street-details.js`, and `controllers.js`.
- It captures the instanced meshes (`IndustryCoolingTowers`, `IndustryChimneys`) and their `LatheGeometry` /
  `CylinderGeometry` radius profiles at walking height (`y ∈ [0, 2] m`), compares each structure's ground-level
  rendered polygon against its collider(s) for walk-through penetration and invisible-wall gaps, checks overlaps with
  other building colliders, road lanes (`1.8 m` half-width), rails (`1.75 m` keep-out), and `propColliders`, and
  drives `ThirdPersonControllerManager.prototype.updatePerson` (capsule radius `0.48 m`) and `updateCar` (oriented car
  rectangle `hx = 0.86 m, hz = 2.23 m`) straight at each structure from 8 directions (`N, NE, E, SE, S, SW, W, NW`).

## Findings (before fix)

- **Structures in detail box (7 total):** 1 cooling tower (`EC Garbary` curated `55 m`, `R = 14 m`), 6 chimneys
  (`EC Garbary` curated `65 m`, `R = 5.5 m`; `OSM` `45 m` by the Warta at `(604, 218)`, `R = 2.95 m`; and 4 `OSM`
  chimneys at `(-3772.2, -1347.4)`, `(-5987.1, -1630.7)`, `(-5984.6, -1638.9)`, `(-6149, -1887)`, `R = 2 m`,
  `H = 15–45 m`).
- **Overlaps:** `0` building overlaps, `0` road overlaps (closest lane `11.739 m` away at `(-6149, -1887)`), `0` rail
  overlaps, `0` prop overlaps.
- **Collider defect:** `buildings.js` emitted one axis-aligned square AABB `[x - R, x + R] × [z - R, z + R]` per
  structure (`maxPenetration = 0.000 m`), creating large diagonal invisible walls at the corners:
  - **EC Garbary cooling tower** (`R = 14 m`, `H = 55 m`, 18-gon): `maxGap = 5.936 m` at `(669, -861)`; diagonal
    person approaches stopped `5.959 m` short of the rendered surface (`6.439 m` surface distance), car `5.987 m` short.
  - **EC Garbary chimney** (`R = 5.5 m`, `H = 65 m`, 14-gon): `maxGap = 2.367 m` at `(745.5, -924.5)`; diagonal person
    approaches stopped `2.382 m` short, car `2.407 m` short.
  - **OSM Warta chimney** (`R = 2.95 m`, `H = 45 m`, 14-gon): `maxGap = 1.270 m` at `(601.05, 215.05)`.
  - **Remaining 4 OSM chimneys** (`R = 2 m`, `H = 15–45 m`, 14-gon): `maxGap = 0.861 m` at corners.

## Fix and verification (after)

- **Changes:**
  - `js/controllers.js` (`buildingContact`): added `c.circle` (`{ cx, cz, r }`) support for both person/circle
    (`dist < r + body.radius`) and car/OBB (`circle` vs oriented car rectangle `[-hx, hx] × [-hz, hz]`).
  - `js/buildings.js`: emitted `circle: { cx: s.x, cz: s.z, r: s.radius }` on each industrial structure collider, and
    increased `LatheGeometry` segments `18 → 32` and `CylinderGeometry` radialSegments `14 → 24` so polygon edge
    midpoints stay within `0.067 m` (`cooling`) and `0.047 m` (`chimney`) of the circle collider.
- **Geometric and controller audit after fix:**
  - **EC Garbary cooling tower** (`R = 14 m`, 32-gon, `y=0..2 m` radius `14.000 → 13.491 m`, inradius `13.933 m`):
    `maxGap = 0.067 m`, `maxPenetration = 0.000 m`; person stops uniformly at `14.480 m` (`0.067 m` from surface
    in all 8 directions); car stops uniformly at `16.282 m` (`0.119 m` from surface in all 8 directions); `0` pass-throughs.
  - **EC Garbary chimney** (`R = 5.5 m`, 24-gon, `y=0..2 m` radius `5.500 → 5.424 m`, inradius `5.453 m`):
    `maxGap = 0.047 m`, `maxPenetration = 0.000 m`; person stops uniformly at `5.980 m` (`0.047 m` from surface); car at
    `7.782 m` (`0.099 m` from surface).
  - **OSM Warta chimney** (`R = 2.95 m`, 24-gon, `y=0..2 m` radius `2.950 → 2.891 m`, inradius `2.925 m`):
    `maxGap = 0.025 m`, `maxPenetration = 0.000 m`; person at `3.430 m` (`0.025 m`), car at `5.232 m` (`0.077 m`).
  - **Remaining 4 OSM chimneys** (`R = 2 m`, 24-gon): `maxGap = 0.017 m`, `maxPenetration = 0.000 m`; person at
    `2.480 m` (`0.017 m`), car at `4.282 m` (`0.069 m`).
- **Tests:** `node --test tests/industry-colliders.test.cjs` passed (2/2).

## Rerun commands

```sh
node tools/audit-industry-colliders.mjs
node tools/audit-industry-colliders.mjs --json
node --test tests/industry-colliders.test.cjs
node --test tests/
```
