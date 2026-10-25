# World building at runtime

Frame: x = grid east, z = grid south, y up, 1 unit = 1 m (see [`geodata.md`](geodata.md)). Geodata reaches the world builders mostly through `js/city-config.js` exports (`BLOCKS`, `ALL_AVENUES`, `ALL_STREETS`, `LANDMARK_SITES`, the coastline and borough polygons). Only `road-network.js` (`GEO.roadGraph`), `city-grid.js` (`plazas`, `centralPark`, `points`, `parks`) and `buildings.js` (`plazas`) import `GEO` directly.

## Map (non-obvious ownership)
- `city-grid.js` `buildCityGrid`: water, bulkhead, road deck, raised sidewalks and curbs from `BLOCKS`, parks and Central Park, plazas, piers, and the waterfront edge (esplanade, FDR, Route 9A, South Street Viaduct). It also exports `batchStaticGroupMeshes`, which landmarks.js reuses.
- `boroughs.js`: everything off the detailed island, including Upper Manhattan north of `CUT_Z`, the outer boroughs, the islands, all bridges and the tram. Hand-placed places are written in lon/lat through `LL()`.
- `buildings.js` `buildCityBlocks`: generic Manhattan buildings on every block's lot rects, plus the streamed roof and street-level detail. `fire-escapes.js` is that detail's near/far fire escape renderer.
- `landmarks.js`: hand-modelled Manhattan landmarks fitted onto their OSM lots. `street-details.js`: signals, lamps, steam stacks, subway entrances, carts, hydrants, mailboxes, and all trees (it plants them through `trees.js` `createTreeField`).
- `road-network.js`: the drivable and walkable graph. `traffic.js` builds it; it is not built in main.js. `road-paint.js`: road markings generated from that graph.

## Build order (main.js `initApp`) and why it is fixed
1. `buildCityGrid(scene)` comes first. It assigns **live `let` exports** that later builders import: `parkTreeSites`, `parkLampSites`, `pavedPlazaRects`, `sidewalkBlocks`, `centralParkClearings` and `fdrViaduct`. They are `undefined` until it has run.
2. `buildBoroughs(scene, { sidewalks })` needs the grid's raised sidewalk rects, because bridge approach columns may stand only on blocks.
3. `buildLandmarks` sets the live export `bryantParkLawn`, which street-details reads. It must run before `buildStreetDetails`.
4. `buildCityBlocks` reads `fdrViaduct.boxes` (no buildings under the viaduct) and the plaza, tree and sidewalk exports.
5. `buildStreetDetails`.
6. `createTrafficSystem(scene, cityGrid.sidewalks, obstacles)` → `buildRoadNetwork`. The obstacles are `cityGrid.footprints`, `streetDetails.footprints` and the colliders with no `obb` and `minY < 3.5`.
7. `buildRoadPaint(scene, trafficSystem.network)`.
8. Controllers get `allColliders`: landmarks + blocks + boroughs + city-grid.
9. `setupSceneCulling` runs over the root groups found **by name**: `ManhattanCityGrid`, `ManhattanCityBlocks`, `ManhattanStreetDetails`, `ManhattanLandmarks`, `Boroughs`.
10. On WebGPU only, instance matrices are swapped for storage attributes; see [`rendering.md`](rendering.md#renderer-and-the-webgl2-fallback).

Per frame: `cityBlocks.update(camX, camZ)` (detail streaming), `cityBlocks.updateLights`, `streetDetails.update(camera)` (pooled lamp lights), `boroughs.update(elapsed)` (tram), and `updateSceneCulling`. Trees update themselves from a chained `scene.onBeforeRender` that skips orthographic and array cameras, so shadow passes don't change the levels of detail.

## Road network (shared by traffic, pedestrians and paint)
- The network is **derived from what was built**, not from CSCL lanes. Avenue corridors are the most common curb-to-curb gap between the grid's raised sidewalk rects around each `ALL_AVENUES` x. Cross streets are the free z intervals between neighbouring corridors. Lower Manhattan and the non-grid northern roads come from `GEO.roadGraph`, minus the links the grid corridors already carry. If you move curbs or sidewalks in city-grid.js, the lanes move too.
- `buildRoadNetwork` returns `{ nodes, edges, paintEdges, connector, curvePoint, walkable, onSidewalk, isRoadClear }`.
  - Edges are straight and directed. Each has a unit direction `(dx, dz)`, a right normal `(rx, rz) = (−dz, dx)`, and `lanes` as lateral offsets right of the centreline, sorted left to right.
  - Nodes have `in`/`out` edges, `signal`, and `general`/`shape` for centreline junctions and bend points.
  - Step 9 assigns sides and right-of-way groups. A grid node's sides are 0 east, 1 west, 2 south, 3 north, and centreline arms count from 4. Group 0 is the avenue, or the widest road at a junction.
  - Lane-to-lane curves are built lazily by `connector(e, i, f, j)` and cached.
  - Only the largest strongly connected component is kept, so no vehicle can reach a dead end. A blocked lane can make whole streets vanish from traffic.
- **Obstacle rule:** an obstacle footprint anywhere within `LANE_CLEAR` (1.2 m) of a lane, between two nodes, removes that lane from the whole edge. Keep obstacle footprints on curb islands, or deliberately in medians.
- For pedestrians, `walkable(minX, maxX, minZ, maxZ)` rejects any non-curb footprint. `pedestrian-routes.js` uses `walkable` and `onSidewalk`.
- **Signals:** signalised nodes are exactly the core `AVENUES` × `STREETS` intersections (step 8). These are city-config's 7 midtown avenues × 9 streets = 63, *not* `ALL_AVENUES`/`ALL_STREETS`. `street-details.js` section 1 mounts signal heads on the same loops. Lenses and traffic both run on `SIGNAL_TIMING` (city-config) and the `signalClock` uniform, which main.js sets every frame. To change which intersections are signalised, change both modules.
- `road-paint.js` draws on `network.paintEdges` and uses `isRoadClear` to drop centre lines that would cross obstacles. It imports `CROSSWALK` (2.5 m between the intersection box and the stop lines) from road-network.js, which uses the same constant for the stop-line setback. Change it in that one place.

## Buildings and collision
- `buildCityBlocks` walks the lot rects of every `BLOCKS` entry except parks (`park > 0.6`) and medians. For each rect it subtracts `LANDMARK_RESERVE`, splits deep lots (`splitDeep`), and calls `populateBlock(minX, maxX, minZ, maxZ, …, district)` on each piece. The district profile (`blockProfile`, `LAYOUTS`) picks the block kind. A building is a set of non-overlapping box parts `{x0, x1, z0, z1, y0, y1}`, and `commit()` emits them.
- Irregular blocks carry frontage frames (`BLOCKS[i].frames`, from geo-blocks.mjs). The generator lays the lots out in a frame turned by θ about p (`xf`), as if on a grid block. `placeInFrame` then turns everything the block emitted into place. **Any new per-block detail list must be added to the list of lists in `placeInFrame`**, or it will be misplaced on turned blocks.
- **Colliders** are `{ minX, maxX, minZ, maxZ, minY?, maxY, obb? }`, where a missing `minY` means 0. `obb: { cx, cz, hx, hz, cs, sn }` marks an oriented box, and min/max are then its world AABB. `pushCollider` emits exactly one collider per building part, from `y0` to `y1`.
  - Commit 49b2ef2 removed the old whole-block collider up to 26 m. It covered yards, courts and gaps, so players hit invisible walls. Make colliders follow the visible geometry, and never add coarse block-sized ones.
  - `minY` lets the player pass under raised parts.
  - main.js drops oriented colliders and those with `minY >= 3.5` from the traffic obstacles. Oriented boxes would over-block through their AABB.
  - The narrow phase is `buildingContact` in controllers.js: a circle for walkers, cyclists and the helicopter, SAT for the car. `tests/controllers.test.cjs` covers the corner cases.
- `LANDMARK_RESERVE` (buildings.js) lists the `LANDMARK_SITES` names whose footprint, plus a 3 m margin, stays free of generic buildings. Bridge approach corridors and `fdrViaduct.boxes` are kept clear the same way.

## Near/far detail levels
- **Building detail streaming:** cornices, water towers, HVAC, fire escapes, awnings, storefront signs and scaffold sheds sit per block in a `Quadtree`. `update()` re-queries blocks within `STREAM_RADIUS` (560 m) once the focus has moved 18 m or more. It sorts them nearest first, so the nearest blocks win when a pool's fixed cap (`MAX_*`) runs out, and refills the instanced pools.
  - Uploads are limited to the used range (`flagRange` → `addUpdateRange`; commit b574893).
  - The pools are `frustumCulled = false`, which also keeps them out of scene-culling.
- **Fire escapes** (`createFireEscapes(group)` → `{ begin, add(fe, focusX, focusZ), end }`, driven from the buildings `update`):
  - Within `NEAR_DISTANCE` 90 m of the focus, each landing is an instance of real geometry: two meshes alternate mirrored flights by landing parity, with up to `MAX_NEAR_FLOORS` (256) landings in total. Per-instance `escapeFlags` hide the flight above the top landing and the drop ladder above the first.
  - Farther out, or once the near budget is spent, an escape is a single box whose `maskNode` draws decks, pickets and stairs from `escapeSize = (storey, total height)`.
  - The fe record holds `x, y, z, ry, facing, storey, landings, h`.
- **Trees** (`trees.js`): `LOD_NEAR` is 105 m, `LOD_MID` 420 m, then crown cards, with 6 m of hysteresis. The meshes are regrouped per 200 m cell / species / variant / level. Instance buffers use static usage on purpose: DynamicDrawUsage re-uploads in every pass of every frame.
- **Scene culling** is automatic for anything under the five named roots; thresholds and opt-outs are in [`rendering.md`](rendering.md#culling-scene-cullingjs-registering-new-static-geometry).

## Batching
- `batchStaticGroupMeshes(root, excludeMaterials)` merges all non-instanced meshes that share a **material object** into one mesh. It keeps only `position`, `normal` and `uv`, and meshes missing any of those are skipped. The originals are removed, so their names, userData and custom attributes are lost.
  - Pass a material in `excludeMaterials` to keep its meshes separate, for example a material with custom attributes, or one whose mesh another module looks up.
  - city-grid.js batches its group at the end of `buildCityGrid`, and landmarks.js at the end of `buildLandmarks`.
- Share material instances wherever possible. Every distinct node material is another WGSL pipeline to precompile behind the loading screen, which is why landmarks share "canonical" facade materials.
- landmarks.js re-emits unrotated `BoxGeometry` parts that use a material from `boxLocalTwins` as instanced facade boxes (`createFacadeBoxes`, tsl-materials.js).

## Recipes
**New kind of street furniture** (in `street-details.js` `buildStreetDetails`):
1. Pick sites with the local helpers: `isOnCurbIsland`, `isOnSidewalk(x, z, pad)`, `inPlaza`, `blockAt` (city-config), `isClearOfPoles`. To place props along every real block rather than only the midtown core grid, iterate `BLOCKS`, `sidewalkBlocks` or `ALL_*`.
2. Call `addFootprint(x, z, w, d)` for each prop that should block pedestrians and lanes, and mind the obstacle rule above.
3. Build one `InstancedMesh` per geometry and material, and `group.add` it. It is chunk-culled automatically if it passes the thresholds above. Do not set `frustumCulled = false`.
4. For a night light, push a site onto `streetPointSites` (pooled point lights) or `cobraLampSites`.
5. For player collision, return a `colliders` array from `buildStreetDetails` and add it to `allColliders` in main.js. Street details currently return no colliders, so the player passes through hydrants and the like.
6. For a sound source, follow how `audioSignals` is consumed by `CityAudioSystem`.
7. A new module needs the registration steps in `AGENTS.md`.

**New Manhattan landmark:**
1. Footprint: add its OSM name to `tools/data/q_landmarks.overpassql`, refetch and rebuild ([`geodata.md`](geodata.md)). It then appears in `LANDMARK_SITES[name]`.
2. `landmarks.js`: add a block `{ const c0 = colliders.length; …model around a local origin…; group.add(obj); colliders.push(…); fitToSite([obj], site('Name'), c0, { height }); }`. `fitToSite` scales the model to the real height, capped by the outline width (+6%), and moves it onto the site centre. It applies the same transform to every collider pushed since `c0`, so author colliders in the model's own coordinates. Reuse the shared facade materials, and use the `boxLocalTwins` keys for box parts.
3. Add the name to `LANDMARK_RESERVE` in buildings.js, or generic buildings will grow through it.
4. Optionally add it to `NYC_LANDMARKS` and `TELEPORT_LOCATIONS` (city-config.js) for labels, the map and teleports.
5. Landmarks off the island belong in boroughs.js instead (`buildBoroughLandmarks`, `registerLandmarkExclusions`, coordinates via `LL()`).

**New streamed building detail:** add a list to `blockDetail` in `populateBlock`, fill it in `commit()`, add it to `placeInFrame`, create a capped pool next to the `MAX_*` constants, and fill it and set its count and `flagRange` in `update()`.

## Determinism
- World building uses no `Math.random`. Only traffic.js and pedestrian-routes.js do.
  - buildings.js reseeds `mulberry32` per block from `(minX, minZ)` at the start of `populateBlock`. A block's buildings therefore depend only on its own bounds and profile: editing one block leaves the others unchanged, but any geodata change to a block's rect reshuffles that block.
  - boroughs.js and trees.js use `mulberry32` with fixed seeds per generator, and city-grid.js piers use a fixed-seed Park–Miller generator.
- Keep new procedural placement on a seeded generator, so screenshots and tests stay reproducible.
- Draw order matters in the shared generators. Inserting `rand()` calls into an existing loop changes everything generated after it in that seed's scope.
