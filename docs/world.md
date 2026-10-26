# World building at runtime

Frame: x = east, z = south (north = −z), y up, 1 unit = 1 m, origin at the Ratusz; the axes are not turned (`GEO.frame.bearingDeg` 0, true north up; see [`geodata.md`](geodata.md)). Geodata reaches the world builders mostly through `js/city-config.js` exports (`BLOCKS`, `ROADS`, `PLAZAS`, `LAND_RINGS`/`LAND_HOLES`, `WATER`, `OUTSKIRTS`, `BRIDGES`, `LANDMARK_SITES`, `SIGNAL_SITES`). Only `road-network.js` (`GEO.roadGraph`), `buildings.js` (`GEO.parks`) and `city-map.js` (`frame`, `parks`) import `GEO` directly.

**Land and water** go through the `city-config.js` land raster (2 m cells over the detail box, built at boot in ~40 ms): `isLand(x, z, margin)` counts bridge decks as land (deck cells are pinned 255 m from water, so a shore margin never narrows a bridge), `isWater` (open water; false on a deck), `distToWater`, `waterAt` (the `WATER` entry under a point; use it to tell a deck over the river from one over land), and `clampToLand(x, z, margin)`, which returns the nearest qualifying point in 2-D as `{x, z}` (always a point; callers needing the margin re-check `isLand`). Outside the detail box is neither land nor water. Also `CITY_BOUNDS` (the detail box, `sidewalkHeight` 0.22, `waterLevel` −3), `RAISED_GROUND` (raised rects the controllers stand on; empty until landmarks push theirs), `districtAt` (osiedle name or null) and `SPAWN` (`{x, z, heading}`: the westbound Św. Marcin carriageway by CK Zamek, facing west).

## Map (non-obvious ownership)
- `city-grid.js` `buildCityGrid`: the water plane at `waterLevel`, the street-level land deck (`LAND_RINGS` minus the ponds in `LAND_HOLES`), battered stone embankments from the deck edge down below the water, raised sidewalks and curbs of every `BLOCKS` curb island (instanced slabs for rect islands, extruded outlines for the rest), hedged medians, the paved squares (`PLAZAS`, deduplicated, minus outlines carrying > 30 m of road centreline) and the park blocks (lawn, trees, lamps, ponds cut out). It also exports `batchStaticGroupMeshes`, which landmarks.js reuses.
- `outskirts.js` `buildOutskirts(scene)` → `{ group, colliders: [] }`: everything between the detail box and the city boundary (`OUTSKIRTS`, lakes as holes), a horizon filler beyond the city line, the land-use "city carpet" shader with per-zone street grids, and instanced panel-block/villa/shed buildings. Hand-placed land use is written in lon/lat through `LL()`. Nothing collides: ground modes never leave the detail box.
- `bridges.js` `buildBridges(scene, { sidewalks })` → `{ group, colliders }`: one structure per `BRIDGES` name (links merged across carriageways and junction pieces), as a tied arch, a girder/box beam or an overpass (`KIND_BY_NAME`, else by whether `waterAt` finds water under it). The roadway deck sits at y ≈ −0.01 on the flat road graph and runs `DECK_REACH` 15 m onto each bank; the player collides only with the parapets (oriented boxes). `sidewalks` is accepted but unused so far.
- `buildings.js` `buildCityBlocks`: generic ~5-storey buildings (kamienice, villas, estates, works by osiedle) on every block's lot rects, plus the streamed roof and street-level detail. `fire-escapes.js` is that detail's near/far fire escape renderer.
- `landmarks.js` `buildLandmarks(scene)` → `{ group, colliders, update }`: the hand-modelled Poznań landmarks, one area module each (`landmarks-rynek.js`: Ratusz with the noon koziołki, Domki Budnicze, Wieża Wójtowska; `landmarks-heritage.js`: Katedra, Fara, Zamek Królewski, Brama Poznania; `landmarks-centrum.js`: Zamek Cesarski, Teatr Wielki, Collegium Minus, Okrąglak, the 1956 crosses; `landmarks-dworzec.js`: Poznań Główny, Stary Dworzec, Avenida, Stary Browar, Iglica; `landmarks-towers.js`: Bałtyk and the skyline towers). They share `landmark-kit.js`: `fitToSite`, the canonical materials (`createLandmarkMaterials`), the facade-box pass and roof/lathe/prism helpers, with the modelling conventions in its header. Static parts go into the `Landmarks` root; moving parts (the goats) into a separate `LandmarksDynamic` root that is neither batched nor culled. `street-details.js`: signals, cobra-head and post-top lamps, hydrants and all trees (it plants them through `trees.js` `createTreeField`).
- `road-network.js`: the drivable and walkable graph. `traffic.js` builds it; it is not built in main.js. `road-paint.js`: road markings generated from that graph.

## Build order (main.js `initApp`) and why it is fixed
1. `buildCityGrid(scene)` comes first. It assigns **live `let` exports** that later builders import: `parkTreeSites`, `parkLampSites`, `pavedPlazaRects`, `sidewalkBlocks`, `parkClearings` (the ponds; nothing reads it yet) and `keepClearBoxes` (`[{minX, maxX, minZ, maxZ}]` no building may stand in; empty for now). They are `undefined` until it has run.
2. `buildOutskirts(scene)`, then `buildBridges(scene, { sidewalks: cityGrid.sidewalks })`.
3. `buildLandmarks(scene)`.
4. `buildCityBlocks` keeps buildings off the `BRIDGES` decks (+3 m, 4 m past each end) and `keepClearBoxes`, and reads the plaza, tree and sidewalk exports.
5. `buildStreetDetails`.
6. `createTrafficSystem(scene, cityGrid.sidewalks, obstacles)` → `buildRoadNetwork`. The obstacles are `cityGrid.footprints`, `streetDetails.footprints` and the colliders with no `obb` and `minY < 3.5`.
7. `buildRoadPaint(scene, trafficSystem.network)`.
8. Controllers get `allColliders`: landmarks + blocks + outskirts + bridges + city-grid.
9. `setupSceneCulling` runs over the root groups found **by name**: `CityGrid`, `CityBlocks`, `StreetDetails`, `Landmarks`, `Outskirts`, `Bridges`.
10. On WebGPU only, instance matrices are swapped for storage attributes; see [`rendering.md`](rendering.md#renderer-and-the-webgl2-fallback).

Per frame: `cityBlocks.update(camX, camZ)` (detail streaming), `cityBlocks.updateLights`, `streetDetails.update(camera)` (pooled lamp lights), `landmarks.update(dt, elapsed, presetId)` (the Ratusz goats, keyed to the `midday` lighting preset), and `updateSceneCulling`. Outskirts and bridges have no per-frame update. Trees update themselves from a chained `scene.onBeforeRender` that skips orthographic and array cameras, so shadow passes don't change the levels of detail.

## Road network (shared by traffic, pedestrians and paint)
- The network comes from the OSM centreline graph (`GEO.roadGraph`): junctions (nearby graph nodes merged), straight runs between them and every bend, lanes from each link's real width, OSM lane count and direction. Bridge links are ordinary links, because `isLand` counts their decks. It is then **cut by what was built**: lanes must keep clear of the curbs and obstacles city-grid and street-details hand over. If you move curbs or sidewalks in city-grid.js, lanes vanish or reappear.
- **Curbs:** city-grid passes rect islands as they are and irregular islands as their **ungrown** lot rects. The 4.4 m-grown rect cover (`sidewalkBlocks`, for rect consumers) reaches into the roadway on turned blocks; passed as curbs, it cut the largest strongly connected set from ~3150 to ~1660 edges.
- `buildRoadNetwork` returns `{ nodes, edges, paintEdges, connector, curvePoint, walkable, isRoadClear }`.
  - Edges are straight and directed. Each has a unit direction `(dx, dz)`, a right normal `(rx, rz) = (−dz, dx)`, and `lanes` as lateral offsets right of the centreline, sorted left to right.
  - Nodes have `in`/`out` edges, `arms`, `signal`, and `shape` for bend points (one road going on, < 35°: no corner, no crosswalk).
  - Step 7 assigns sides and right-of-way groups: a node's sides are its arms, numbered from 0; the arms of one road form a group, and group 0 is the widest road (`axis` `'ave'` marks major roads).
  - Lane-to-lane curves are built lazily by `connector(e, i, f, j)` and cached.
  - Only the largest strongly connected component is kept, so no vehicle can reach a dead end. A blocked lane can make whole streets vanish from traffic. The build logs `[road-network] edges: N with clear lanes, M long enough, K in the largest strongly connected set`; watch K after touching curbs or obstacles. `tests/road-network.test.cjs` pins it on the real land: the bare graph (no curbs or furniture) at > 6200 long enough and > 3850 edges / 175 km in the set (measured 6925, 4300 / 193.8 km), and street-details' furniture must leave ≥ 90% of those km (measured 184.3 km). Runs get a shape node wherever the real centreline strays > 0.5 m from the chord (not within 25 m of a junction): with bends-only shape nodes, gentle arcs strayed ~3 m and the outer lanes hit the curbside lamps, which cut the set to 127 km.
- **Obstacle rule:** an obstacle footprint anywhere within `LANE_CLEAR` (1.2 m) of a lane, between two nodes, removes that lane from the whole edge. Keep obstacle footprints on curb islands, or deliberately in medians.
- For pedestrians, `walkable(minX, maxX, minZ, maxZ)` rejects any non-curb footprint. `pedestrian-routes.js` uses `walkable` and `blockAt`.
- **Signals:** `SIGNAL_SITES` (city-config) is the one list of signalised junctions, built from `GEO.roadGraph.signals` (235 OSM signal nodes), `{x, z, nsWidth, ewWidth}` each (the widest arm running mostly north–south and east–west). Step 6 marks the node within `SIGNAL_REACH` 12 m of each site, and `street-details.js` section 1 mounts signal heads at each site (it runs before the network exists, so it can't read `node.signal`). Lenses and traffic both run on `SIGNAL_TIMING` (city-config) and the `signalClock` uniform, which main.js sets every frame. Signals run two phases: group 0 (the widest road; `isAvenue` in `signalPhase`/`walkSignal`) and every other group.
- `road-paint.js` draws on `network.paintEdges` and uses `isRoadClear` to drop centre lines that would cross obstacles. It imports `CROSSWALK` (2.5 m between the intersection box and the stop lines) from road-network.js, which uses the same constant for the stop-line setback. Change it in that one place.

## Buildings and collision
- `buildCityBlocks` walks the lot rects of every `BLOCKS` entry except parks (`park > 0.6`) and medians. For each rect it subtracts `LANDMARK_RESERVE`, splits deep lots (`splitDeep`), and calls `populateBlock(minX, maxX, minZ, maxZ, …, district)` on each piece. The district profile (`blockProfile`, `LAYOUTS`, keyed by `districtAt`) picks the block kind. A building is a set of non-overlapping box parts `{x0, x1, z0, z1, y0, y1}`, and `commit()` emits them.
- Irregular blocks carry frontage frames (`BLOCKS[i].frames`, from the geodata build). The generator lays the lots out in a frame turned by θ about p (`xf`), as if on a grid block. `placeInFrame` then turns everything the block emitted into place. **Any new per-block detail list must be added to the list of lists in `placeInFrame`**, or it will be misplaced on turned blocks.
- **Colliders** are `{ minX, maxX, minZ, maxZ, minY?, maxY, obb? }`, where a missing `minY` means 0. `obb: { cx, cz, hx, hz, cs, sn }` marks an oriented box, and min/max are then its world AABB. `pushCollider` emits exactly one collider per building part, from `y0` to `y1`.
  - Commit 49b2ef2 removed the old whole-block collider up to 26 m. It covered yards, courts and gaps, so players hit invisible walls. Make colliders follow the visible geometry, and never add coarse block-sized ones.
  - `minY` lets the player pass under raised parts.
  - main.js drops oriented colliders and those with `minY >= 3.5` from the traffic obstacles. Oriented boxes would over-block through their AABB.
  - The narrow phase is `buildingContact` in controllers.js: a circle for walkers, cyclists and the helicopter, SAT for the car. `tests/controllers.test.cjs` covers the corner cases.
- `LANDMARK_RESERVE` (buildings.js) lists the `LANDMARK_SITES` names (Ratusz, Fara, Zamek Cesarski, Bałtyk, AND2, …) whose outline, plus a 3 m margin, stays free of generic buildings. Bridge decks and `keepClearBoxes` are kept clear the same way.

## Near/far detail levels
- **Building detail streaming:** cornices, water towers, HVAC, fire escapes, awnings, storefront signs and scaffold sheds sit per block in a `Quadtree`. `update()` re-queries blocks within `STREAM_RADIUS` (560 m) once the focus has moved 18 m or more. It sorts them nearest first, so the nearest blocks win when a pool's fixed cap (`MAX_*`) runs out, and refills the instanced pools.
  - Uploads are limited to the used range (`flagRange` → `addUpdateRange`; commit b574893).
  - The pools are `frustumCulled = false`, which also keeps them out of scene-culling.
- **Fire escapes** (`createFireEscapes(group)` → `{ begin, add(fe, focusX, focusZ), end }`, driven from the buildings `update`):
  - Within `NEAR_DISTANCE` 90 m of the focus, each landing is an instance of real geometry: two meshes alternate mirrored flights by landing parity, with up to `MAX_NEAR_FLOORS` (256) landings in total. Per-instance `escapeFlags` hide the flight above the top landing and the drop ladder above the first.
  - Farther out, or once the near budget is spent, an escape is a single box whose `maskNode` draws decks, pickets and stairs from `escapeSize = (storey, total height)`.
  - The fe record holds `x, y, z, ry, facing, storey, landings, h`.
- **Trees** (`trees.js`): `LOD_NEAR` is 105 m, `LOD_MID` 420 m, then crown cards, with 6 m of hysteresis. The meshes are regrouped per 200 m cell / species / variant / level. Instance buffers use static usage on purpose: DynamicDrawUsage re-uploads in every pass of every frame.
- **Scene culling** is automatic for anything under the six named roots; thresholds and opt-outs are in [`rendering.md`](rendering.md#culling-scene-cullingjs-registering-new-static-geometry).

## Batching
- `batchStaticGroupMeshes(root, excludeMaterials)` merges all non-instanced meshes that share a **material object** into one mesh. It keeps only `position`, `normal` and `uv`, and meshes missing any of those are skipped. The originals are removed, so their names, userData and custom attributes are lost.
  - Pass a material in `excludeMaterials` to keep its meshes separate, for example a material with custom attributes, or one whose mesh another module looks up.
  - city-grid.js batches its group at the end of `buildCityGrid`, and landmarks.js at the end of `buildLandmarks` (the `LandmarksDynamic` root is left out).
- Share material instances wherever possible. Every distinct node material is another WGSL pipeline to precompile behind the loading screen, which is why landmarks share "canonical" facade materials.
- landmarks.js re-emits unrotated `BoxGeometry` parts that use a material from `boxLocalTwins` as instanced facade boxes (`createFacadeBoxes`, tsl-materials.js).

## Recipes
**New kind of street furniture** (in `street-details.js` `buildStreetDetails`):
1. Pick sites with the local helpers: `isOnCurbIsland`, `isOnSidewalk(x, z, pad)`, `inPlaza`, `blockAt` (city-config), `isClearOfPoles`. To place props along every real block at any bearing, walk `curbEdges` (curb edges ≥ 24 m fronting open roadway, with inward/outward normals), as the lamps and street trees do.
2. Call `addFootprint(x, z, w, d)` for each prop that should block pedestrians and lanes, and mind the obstacle rule above.
3. Build one `InstancedMesh` per geometry and material, and `group.add` it. It is chunk-culled automatically if it passes the thresholds above. Do not set `frustumCulled = false`.
4. For a night light, push a site onto `streetPointSites` (pooled point lights) or `cobraLampSites`.
5. For player collision, return a `colliders` array from `buildStreetDetails` and add it to `allColliders` in main.js. Street details currently return no colliders, so the player passes through hydrants and the like.
6. For a sound source, follow how `audioSignals` is consumed by `CityAudioSystem`.
7. A new module needs the registration steps in `AGENTS.md`.

**New landmark:**
1. Footprint: add its OSM name to `tools/data/q_poz_landmarks.overpassql` and its curated entry to `tools/poz-extra.mjs`, refetch and rebuild ([`geodata.md`](geodata.md)). It then appears in `LANDMARK_SITES[name]`.
2. The area module (`landmarks-<area>.js`, conventions in the `landmark-kit.js` header): add a block `{ const c0 = colliders.length; …model around a local origin…; group.add(obj); collider(colliders, …); fitToSite([obj], site('Name'), colliders, c0, { height }); }`. `fitToSite` scales the model to the real height, capped by the outline width (+6%), and moves it onto the site centre. It applies the same transform to every collider pushed since `c0`, so author colliders in the model's own coordinates, as axis-aligned boxes. When the site has an `ang`, the model is scaled in the site's own frame and then turned by `ang` about the site centre, `offset` turns with it, and each collider becomes an `obb` collider (the shape buildings.js `pushCollider` emits), which keeps it out of the traffic obstacles. Turned box parts keep the world-space window grid, because the `boxLocalTwins` re-emit skips rotated parts. Reuse the shared facade materials, and use the `boxLocalTwins` keys for box parts.
3. Add the name to `LANDMARK_RESERVE` in buildings.js, or generic buildings will grow through it.
4. Optionally add it to `CITY_LANDMARKS` and `TELEPORT_LOCATIONS` (city-config.js) for labels, the map and teleports.
5. Towers outside the detail box belong in outskirts.js instead (coordinates via `LL()`).

**New streamed building detail:** add a list to `blockDetail` in `populateBlock`, fill it in `commit()`, add it to `placeInFrame`, create a capped pool next to the `MAX_*` constants, and fill it and set its count and `flagRange` in `update()`.

## Determinism
- World building uses no `Math.random`. Only traffic.js and pedestrian-routes.js do.
  - buildings.js reseeds `mulberry32` per block from `(minX, minZ)` at the start of `populateBlock`. A block's buildings therefore depend only on its own bounds and profile: editing one block leaves the others unchanged, but any geodata change to a block's rect reshuffles that block.
  - outskirts.js and trees.js use `mulberry32` with fixed seeds per generator; city-grid.js and street-details.js hash positions (`prand`, `hashPos`); bridges.js uses no randomness.
- Keep new procedural placement on a seeded generator, so screenshots and tests stay reproducible.
- Draw order matters in the shared generators. Inserting `rand()` calls into an existing loop changes everything generated after it in that seed's scope.
