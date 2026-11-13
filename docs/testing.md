# Testing and local development

No package.json or npm install is needed. The tests use only Node built-ins (`node:test`, `node:assert/strict`, `node:vm`);
the browser loads three.js from the CDN. Verified on Node v26.12.1. Node 22+ is needed because importing `js/*.js`
as ESM without a package.json depends on Node's automatic module-syntax detection.

## Commands (verified)

- Full suite: `node --test tests/`. 598 tests, about 124 s under concurrent traffic audits (2026-11-12). Most time is spent in `tests/geodata.test.mjs`, which runs the full `tools/build-poznan.mjs` in a temp copy of the repo with `--max-old-space-size=8192`, the five-minute traffic-flow regression, and the signal-head and pedestrian-route audits.
- Quick loop that skips the geodata rebuild: `node --test tests/*.cjs` (about 9 s, most of it `road-network`, `tram-infra` and `tram-clearance` building the network and the street furniture on the real Poznań graph, and `buildings-density` running `buildCityBlocks` twice).
- One file: `node --test tests/cameras.test.cjs`. Running `node tests/cameras.test.cjs` directly also works.
- By test name: `node --test --test-name-pattern="police" tests/`
- Serve the app: `python3 -m http.server 8000` from the repo root, then open `http://localhost:8000/`. Any static server works. There is no build step, and `.js` is served as `text/javascript`. Three.js loads from jsDelivr (`three@dev`) through the import map in `index.html`, so the page needs network access. `localhost` counts as a secure context, which WebGPU requires.
- `.gitignore` contains only `.DS_Store`. Nothing is generated except `js/geodata.js`, which is committed.

## Piotrowo landmark regression

`node --test tests/landmarks-piotrowo.test.cjs` builds the real landmark module with the shared Three.js stub.
It checks corrected heights and courtyard holes, shared materials, player/vehicle colliders over sampled solid
footprints, geometry vertices clear of carriageways/tram envelopes/water, and closed roofs with mapped holes.
Round 2 also checks all 42 additional campus buildings and three university boundary rings. A before-control
turns off only campus suppression in the real `buildings.js`; it must detect the removed houses, preserve all
non-campus generic footprints (including nearby neighbours), and keep outside-600 m geometry and tones identical.
`roofs.test.cjs` checks that rewinding a discarded campus building leaves no roof instances or consumed capacity.
The furnished audit in `tools/audit-tree-clearance.mjs` and park-paving fixture include the campus builder.

The 2026-11-13 detail regressions also pin barrel-vault ridge/eave heights, ground-level solid hall collision and
clear air beside the curved roof, all five source sport/surface tags, each standard marking layout (including both
sports on the carpet) fitting inside its actual rotated outline, and the mapped 20.35 m forecourt walkway radius,
13.5 m lawn opening and estimated 28.3 m paving radius. All non-colliding ground meshes have casting disabled;
production batches these separately from building shadow casters. No source-slice markers changed.

Round 1 pins: preloads 50 → 51; named landmarks 36 → 39; model-only map-label exemption. Round 2 adds no module
preload, named landmark, teleport or UI destination. The reduced tree fixtures omit replacement landmark walls:
removing campus housing restores 177 accepted OSM park trees (25,454 → 25,631), changing species/site/street-collider
pins and tree-field mesh counts (25,477/30,366 → 25,480/30,368). Grid prop colliders stay unchanged. Each moved pin
has its reason next to its assertion. The partial-park source-slice endpoint now precedes the separate campus-ground
pass, retaining that test's original scope. Browser checks, paired timings and outside collider/tree/prop hashes
are recorded in `.agent-task/REPORT.md`; headless tests do not verify appearance.

## No rendering tests

No test runs a browser, WebGPU, TSL shader compilation or a screenshot comparison. Tests that touch shader or scene code (`facade-projection`, `vehicle-lights`) re-implement or stub the TSL nodes and check only the math. Any change to geometry, materials, TSL nodes, lighting, post-processing or culling has to be checked by hand: serve the app and look in a WebGPU browser. `WebGPURenderer` falls back to WebGL2 when WebGPU is unavailable, and `js/main.js` branches on `renderer.backend.isWebGPUBackend` (for example for instanced attributes). If you touch that kind of code, check the fallback too. Watch the browser console, because shader and node errors show up only there.

The [worker boundary study](observations/perf-workers-2026-11-12.md) stopped at Stage 1: no production worker,
fallback switch or new module exists, so no test markers or module-preload counts change. Its scratch harnesses
rebuild the browser boot profiler, measure builder call trees and payload sizes, and compare a canonical tram layout;
that is not a replacement for the 60 whole-build categories, query-reader equivalence, fallback/error protocol tests
or backend/screenshot checks that a production worker change must pass. For future profiling, capture ready time at
the `[init]` event, filter long tasks to that boot interval, and measure worker CPU and heap separately. In Chrome
157, page CPU throttling does **not** throttle a dedicated worker (measured: config 385–405 ms at both 1× and 6×),
and `Emulation.setCPUThrottlingRate` on the worker target is rejected. Scale or measure worker work separately;
page-throttled page time against an unthrottled worker overstates any gain. The scratch harness lives under
`.agent-task/perf/` and is not committed.

## Measuring performance on a real device

Add `?stats=1` to the page URL (`https://slop-poznan.dominikminta.com/?stats=1`, or
`http://localhost:8000/?stats=1`). The panel appears under the brand line; on a 390 × 844 phone it stays clear of the
touch stick and action buttons. It refreshes twice a second and shows:

- frame rate and frame time p50/p95/max over the last 5 s;
- CPU time inside `renderPipeline.render()`, the tram + traffic/pedestrian update, and the whole frame (all in ms,
  averaged over the panel's half-second display window);
- draw calls and triangles for every pass (scene, shadow cascades and post-processing) from `renderer.info`;
- shader program and render-target counts, GPU memory, JS heap, quality tier with its reason (when
  `body[data-quality-reason]` is set), backend, GPU adapter, devicePixelRatio, drawing-buffer size and window size;
- boot time from navigation start to the first frame, with the `[init]` phase list in the copied report.

**Kopiuj raport** copies a plain-text report that also includes the URL and its parameters, user agent, platform,
`hardwareConcurrency`, `deviceMemory`, the current travel mode, camera preset, time preset and both positions. If the
clipboard is unavailable (for example an insecure origin or a denied permission), the same text appears in a selected
textarea inside the panel. Paste the report into the issue or observation record, together with the viewport, quality
tier and backend you used.

The switch is opt-in so a normal visit pays nothing: without `?stats=1` the module is loaded (static import) but builds
no DOM, does not reset `renderer.info`, and the loop hooks are null checks. With it on, expect the panel itself to cost
a few tenths of a millisecond per frame: one `renderer.info.reset()`, three `performance.now()` pairs and two `textContent`
batches a second, with no per-frame allocation. Verify a change with a screenshot on the target device and by comparing
draw calls/triangles and CPU render with the audit numbers in
[observations/perf-older-devices-2026-11-11.md](observations/perf-older-devices-2026-11-11.md) at the same view.

## Three ways tests reach production code

Know which one covers the code you are editing. Two of them are coupled to the exact source text.

1. **`loadModule(source, { imports, globals, filename })`** from `tests/helpers/module.cjs`. It reads a whole `js/*.js` file, rewrites its static `import`/`export` declarations, and runs it in a `vm` context. Used by cameras, controllers, city-map, road-network, pedestrian-routes, touch-controls and vehicle-lights tests, and by the benchmark. `buildings-density` loads `js/buildings.js` with one catch-all Proxy stub for three.js, TSL, the materials, roofs and balconies (every property, call and `new` returns the stub) and the real `city-config.js` and `geodata.js`, so the lot layout runs for real; it also needs a `document` global.
2. **Slicing source text.** The test cuts out a function or block with a regex or `indexOf` and runs it in `vm.runInNewContext` with hand-built context variables:
   - `traffic*.test.cjs` match `^  function NAME(` through `\n  }` (two-space indent) in `js/traffic.js`.
     `traffic-population` also captures the vehicle-pool declaration and cursor state to run the full update with
     real placement and local density selection, stubbing rendering/driving and seeding the available roads.
   - `traffic-network-reuse.test.cjs` slices `createTrafficSystem` from its function declaration to
     `  // Sides of an intersection`, stubbing the initial mesh/material setup to check supplied-network identity
     and the default builder call. Keep this marker after the network destructuring.
   - `tree-distribution.test.cjs` captures the street landing checker at `const TREE_SP = 15;` and moved
     positions at `treePlacement.moved++;` to run the clearance audit against its existing furnished fixture.
   - `signal-display.test.cjs` captures the head group before `      const half = a.w / 2;` in street-details.js, then
     compares the rendered groups with real incoming road lanes. It also checks the shared texture and crossing audio.
   - `dworzec-crossings.test.cjs` exposes the internal `links` function by replacing the literal
     `return { along, across, next, crosswalks, segments, segmentsNear, ways: wayTracks, waysNear };` in pedestrian-routes.js to check real bidirectional connectivity.
     It also records `setFacing` at `dummy.rotation.set(0, Math.atan2(fx, fz), 0);` in street-details.js to check
     that the refuge head faces walkers at the actual southern landing.
   - `signal-placement.test.cjs` records actual vehicle-head placement at `          s1Matrices.push(m);` and the
     same `setFacing` marker to compare the restored Krucza head with its live incoming lane. It instruments
     `signalArmPoles.set(a, { site, poles: armPoles, hasHead: false });` and the consecutive
     `record.hasHead = true;` / `vehicleHeadSites.push({ site, a, p, group0 });` lines for runtime heads, plus
     the instanced-mesh and attribute creation. It slices `configureSignals` from traffic.js with the same
     two-space function marker as the traffic tests.
   - `median-refuge.test.cjs` records `createExtrudedPolygonMesh` at `const shape = createWorldXZShape(pts, holes);`
     in city-grid.js, checking emitted hedge polygons against the measured walking/waiting corridor.
   - `hetmanska-clearance.test.cjs` records the same extrusion marker for actual curbs/slabs. Its original-world
     replay omits city-config.js from `// The surveyed Hetmańska/Dmowskiego island` to
     `// Spatial index of the blocks`; keep those markers aligned with the surveyed correction.
   - `teleports.test.cjs` runs the part of `js/main.js` from `  function teleportTo(` to `  const openMapBtn`.
   - `opaque-shadows` slices `prepareOpaqueShadows` in `tsl-materials.js` through the final `export {` marker,
     checking the build-time scene/shadow branch and the exclusions for alpha, masks and transmission.
   - `facade-projection` slices `js/tsl-materials.js` between markers: `const facadeNormalVertex =`, `function facadeCell(`, `let bayWidth`, `const evaluateApartmentInterior`, `const rayWorld =` and `// Slab intersection`.
   - `boot-indexes` slices the boot indexes from their source: the buildings block outline grid, nearest-distance hierarchy and
     `outlineRay`/`outlineDist` (`const FRONT_REACH = 10;` to the lot-rect comment), the bridge corridors and SAT
     (`const bridgeCorridors = [];` to `const SIDES = `), `segmentGrid` (`function segmentGrid(cell = 24, walk = false) {`
     to the lane-distance comment), the tram pole block (`const poleCells = new Map();` to the `// March out from the track`
     comment) and the street-details curb grid (`const curbEdgeIndexes = new Map();` through `blockCurbDist` and
     `nearestCurbFrame`, before `const parkCollider`). Keep those markers aligned when the indexed functions move.
   - `boot-indexes-3` slices the part-3 fast paths: `ringDist` plus the 16 m edge grid (`js/city-grid.js`), the rail
     clearance bbox reject (`function railCells()` through `railClearance`), the walked `segmentGrid`, the rail
     keep-out `fillRect`, `crossingRuns` (inside `clearOpposingTracks`), the packed `createFootprintIndex` factory and
     its curb/obstacle setup, and the whole land-raster IIFE; it also runs
     `pavedPlazas()` with and without the road-segment buckets. Keep those markers aligned when the functions move.

   - `boot-indexes-4` slices `cornerClear` from `  function cornerClear(a, b, block) {` to
     `  // Clearance for a fallback connector:` in pedestrian-routes.js. It compares the 4 m early exit with the plain
     full scan on real outlines, exact band boundaries and degenerate edges, and counts distance calls to pin the
     early exit. The existing `boot-indexes` tests also cover deep/clipped curb rings and interior/exterior outline
     hierarchy queries against the plain scans.

   - `boot-indexes-5` slices `nearSegment` inside `segmentsNear` through its closing `    };`, the partial-park loop
     from `  const PARK_TREE_EDGE = 10;` to `  // One merged lawn mesh`, and the signal audit's grid helpers from
     `    const key =` to `    const curves =`. It compares segment acceptance against the plain projection on real
     road segments and boundaries, verifies one lazy lot build per partial-park block, and compares numeric signal
     buckets with the original string keys, including candidate order and negative cell boundaries.

   - `teatr-polska-surroundings` builds the real grid with the extrusion marker above and two recording replacements:
     `group.add(createFlatPolygonMesh(ring, 0.232, roadMat));` for each car-park surface and
     `const mesh = createFlatPolygonMesh(path.ring, 0.238 + i * 0.0004, pavingMat);` for each site path. It checks the
     full drawn lawns (not slivers), the three surveyed car parks, no parked cars, bench/lamp/planter colliders and the
     clear portico corridor. Keep those call texts exact, and keep the site pass after `// One merged lawn mesh` so the
     `boot-indexes-5` slice stays unchanged.

   If you rename, re-indent, reorder or reformat around these markers, the tests break. So do new free variables in a sliced block that the test context does not provide. When that happens, update the test's markers and context in the same change. Keep the tested behaviour as it is.
3. **Real ESM import.** `teleports`, `signals`, `city-text` and `road-network` tests run `await import('../js/city-config.js')` (signals and road-network also import `geodata.js`; road-network feeds both into a `loadModule`d `road-network.js`), and `geodata.test.mjs` imports a freshly built `geodata.js`. **`js/city-config.js` and `js/geodata.js` must import nothing beyond each other or other Node-loadable relative files.** A bare specifier such as `'three/webgpu'` cannot be resolved in Node, so adding one breaks these tests.

## loadModule: supported module syntax (hard constraint for js/ authors)

Each module that a `loadModule` test or the benchmark loads (cameras, controllers, city-map, touch-controls, vehicle-lights, pedestrians) must use only these forms. Use them across `js/` anyway, so a module can get tests later:

- `import * as NS from 'spec';` and `import { a, b as c } from 'spec';`. Multi-line braces are fine. The statement must start at column 0 and end with `;`.
- `export { a, b as c };` at column 0 with a `;`. Multi-line is fine. This is the house style: one export list at the end of the file.
- `export const|let|var|function|class name`. Only the first name is exported: `export const a = 1, b = 2;` silently drops `b`.

Verified to throw `Unsupported module syntax` or a SyntaxError:

- default imports
- side-effect `import 'x';`
- an import with no semicolon
- an indented import or export
- `export default`
- `export async function`
- `export function*`
- `export const { a } = ...`
- `export { a } from` and `export * from`
- `export { a }` with no `;`
- `import.meta`
- top-level `await`

Any line inside a template literal that starts with the word `import` or `export` also throws. Dynamic `import()` loads, but calling it rejects inside the vm.

Behaviour to know when writing a test:

- Every imported specifier needs a key in `imports`, even if the code under test never uses it (`Missing import stub: X`). Pass `{}` for unused ones. Keys match the exact specifier string, such as `'three/webgpu'`, `'three/tsl'` or `'./city-config.js'`.
- An imported name missing from a stub becomes `undefined` without an error, so stub every name the exercised path calls.
- `globals` becomes the vm global object. Nothing from Node leaks in: `window`, `document`, `performance`, `setTimeout` and so on are `undefined` unless you pass them. `console.log` exists but prints nothing, so pass `globals: { console }` when debugging.
- Objects and arrays created inside the module come from another realm. `assert.deepEqual(moduleArray, [1, 2])` fails even when the values match. Copy them first (`{ ...result }`, `[v.x, v.y]`, `.slice()`) or compare fields, as the existing tests do.
- The code runs in strict mode inside a function wrapper and returns only the exported bindings. To test methods without building scenes, tests often call `Object.create(Class.prototype)` and set only the fields they need (see `tests/controllers.test.cjs`).
- Exported `let` bindings are snapshots in this harness, unlike live ES-module imports. If a builder reassigns an
  exported array (for example city-grid's plaza and park sites), importing the original returned value into the next
  builder still gives the old value. Pass populated values explicitly when measuring a sequence of builders.

## Writing a new test

- Name it `tests/<area>.test.cjs` so `node --test tests/` picks it up. Use `require('node:test')` and `require('node:assert/strict')`. Read the source with `readFileSync(join(__dirname, '../js/x.js'), 'utf8')` and pass it to `loadModule`. Model it on `tests/vehicle-lights.test.cjs` (a tiny `SpotLight`/`Vector3` stub for `'three/webgpu'`) or `tests/cameras.test.cjs` (`window`/`document` globals with event-target fakes).
- Stub only the Three.js surface the path touches, as small classes. Do not try to load real three.js in tests, because the repo has no local copy.
- Use `.mjs` only when you need real ESM or child processes (`import.meta.url`, `spawnSync`, `await import`), as `geodata.test.mjs` and `overpass.test.mjs` do. `overpass.test.mjs` tests `tools/overpass.sh` with a fake `curl` on `PATH` in a temp dir. Tests write only to `os.tmpdir()`, never into the repo.

## Coupled checks in tests/boot.test.cjs

- **To add a new `js/*.js` module**, also add `<link rel="modulepreload" href="./js/NAME.js" />` to `index.html`. Keep that exact attribute order and the self-closing ` />`, and place it after the import map and before the stylesheet. Then bump the expected preload count in `boot.test.cjs`, which is currently 50, one per file in `js/`.
- Relative imports must be `./name.js` paths that resolve to a preloaded URL.
- `index.html` must contain exactly two `<script>` tags (the import map and `./js/main.js`).
- `three` and `three/webgpu` must map to the same URL.
- Each `data-teleport="key"` button in `index.html` must have exactly one matching key in `TELEPORT_LOCATIONS` (`js/city-config.js`), and the reverse. The destination must be on a road and not inside a block.

## Pedestrian benchmark

`node tools/benchmark-pedestrians.mjs /abs/path/to/three/build/three.core.js` (or set `THREE_CORE_PATH`). You need a local three.js build, because the repo has none (any npm `three` package's `build/three.core.js` works). Verified run: about 7 s. It prints JSON with the ms per frame for 340 rigs, before and after, plus the reduction percentage. It first asserts that deferring the pose solve for hidden rigs gives bit-identical gait and poses, so it doubles as a correctness check after `PersonRig` changes. It loads `js/pedestrians.js` through `loadModule` with stubs only for `'three/webgpu'`, `'three/tsl'` and `'three/addons/utils/BufferGeometryUtils.js'`. It also builds its baseline by replacing the literal `if (updatePose) this.solve();`. If you add an import to `pedestrians.js`, add a stub here. If you change that line, update the replacement.

## Shelter–raised-ground audit

`node tools/audit-shelter-roadway.mjs [--before] [--json] [--top N] [--near x,z,r]` builds the furnished headless
network (street details' own road graph, as `tests/tram-infra.test.cjs` does) and measures every tram stop shelter's
real 4.6 × 1.6 m roof and advert footprint against the raised ground it stands on: each stop platform's rendered 3 m
box rectangles (`platformPieceRects`) and the raised sidewalk blocks (`blockAt`, underpass sidewalks included). The
footprint edge is sampled every 0.05 m and its interior on a 0.8 m grid; on a mixed platform that starts on a sidewalk
block and ends in the tram/bus reservation it also requires the shelter to stand on the block. It keeps the 3.6 m
car-lane envelopes and junction turning curves and the 1.75 m track keep-out, and counts catenary pole centres inside
the roof plus 0.15 m. `--before` loads `js/tram-infra.js` from commit `de70d64` and runs the same **current**
predicate, so the pre-fix count is reproducible; `--near` restricts the report to a centre and radius. It prints the
count, the worst overlaps, and the `raisedShelters`/`poleShelters` lists with their stop names/coordinates, and exits
non-zero while any overlap remains. Measured 2026-11-12: the old roadway predicate found **30 before** (8 in the
carriageway, 13 within the track keep-out, 10 on mixed platforms and 3 curb stops, several overlapping) and 0 after
`23c5a05`; the raised-ground predicate found **41** on the `de70d64` layout (7 raised-ground, 14 pole, the rest
lane/track/mixed) and **17** on the `23c5a05` layout (4 raised-ground, 13 pole). The rule then moved 38 shelters,
dropped 3 (all already dropped) and restored 7 the old roadway test had dropped, leaving **225** shelters and 0
overlaps; the browser build matched (38 moved, 3 dropped, 225 shelters). The Rondo Kaponiera north island shelter at
(−1455.6, 4.1) led the raised-ground cases with a **0.08 m** roof corner past the platform pieces; it moved to
(−1458.8, 4.3). `tests/shelter-roadway.test.cjs` runs the after audit, checks both Rondo Kaponiera north stops were
moved, and runs the `--before` audit to check the new predicate still catches the pre-fix 0.08 m overhang and the
pole shelter. The audit uses the headless fixture, not the browser's full collider set.

## Pedestrian overlap audit

`node tools/audit-ped-overlaps.mjs` runs the real pedestrians, traffic and trams headless with the camera parked at
Centrum, Stare Miasto, Jeżyce, Łazarz, Wilda, Rataje, Rondo Kaponiera and Poznań Główny. Defaults are 3 simulated minutes
per focus point at 15 fps and seed 4242; the record below also used seed 77 (`--minutes`, `--fps`, `--seeds`, `--only`,
`--json` override them). After
20 s it samples once per simulated second: an overlapping pair is two placed peds with centres under 0.5 m apart, a
cluster is a connected group of at least four such peds lasting over 5 s, and it also reports citywide overlapping pairs
per second and crosswalk entries per minute so throughput is visible. Each cluster lists its centroid, street name,
member states, route positions, spawn origins and age. It uses the benchmark's headless world and omissions. Results are
in [observations/ped-overlaps-2026-11-05.md](observations/ped-overlaps-2026-11-05.md); no test runs the whole audit.
`tests/pedestrian-route-sinks.test.cjs` covers the route-side regression on the bare network (11 empty ends / 11 tracks,
ceilings 15/15) and builds the furnished headless world once to pin the five named landings, their kerb links, `next()`
for six city goals, and the 2.22 m rail / building / block / lane clearance.

## Traffic benchmark

`node tools/bench-traffic.mjs` runs the street traffic, pedestrians and trams headless on the real network, with no
three.js (every three.js/TSL import is an inert stand-in; `traffic.js`, `trams.js`, `road-network.js`,
`pedestrian-routes.js`, `street-details.js` (the furniture that closes lanes) and `tram-infra.js` (the tram stops) run
for real through `loadModule`). It parks the camera in turn at Jeżyce (Rynek Jeżycki), Łazarz (Głogowska), Centrum
(Św. Marcin), Rondo Kaponiera, Stare Miasto, Rataje (Rondo Rataje) and Wilda, rebuilds the world for each, runs
`--minutes` (default 5) at `--fps` (15) with `Math.random` seeded (`--seed`, 4242: a run is reproducible), and samples
the vehicles within 300 m once a second after 20 s. About 12–17 s per district. Options: `--only jezyce,lazarz` (keys
`jezyce lazarz centrum kaponiera stare rataje wilda`), `--top N` junctions, `--dump` (the longest wait as text: every
vehicle, tram and walker at its junction), `--watch x,z` (that junction every 30 s), `--trace x,z` (that junction every
second: signal phases, box, every lane queue on its arms and nearby trams; `--trace-min s` suppresses lines until a car
there has waited that long), `--json file`, `--ped-rooms` (the room audit below), and the experiments
`--no-peds`, `--no-trams`, `--no-signals` (they patch `traffic.js` by exact text and throw if it changed).

`--ped-rooms` samples pedestrians once a second and reports `ped-s` with `stuck > 0`, grouped by the `roomCause` that
`walk()` recorded: `queue`, `entrance`, `approach`, `merge`, `curb`, `curbQueue`, `hold`, `holdQueue`, `tram` or
`none`. `stuck` already excludes legitimate curb waits, split holds, pauses, conversations and crosswalk waits, so the
count is the retained check of the non-tram `room` terms; it does not replace the full pedestrian-overlap audit. The
cause and longest hold are also written to the `--json` row as `pedRoomSamples`, `pedRoomStuck`, `pedRoomLongest` and
`pedRoomCauses`.

This is a benchmark variant, not the complete browser scene: it does not build city-grid's sidewalks or square/park
furniture, passes empty plaza/park site lists to street-details, and omits landmark and bridge colliders. It builds the
city-block colliders once per process and passes them to the pedestrian route builder, so fallback connectors cannot cut
through building walls; landmark walls only add a little at this scale. Its network and crosswalk counts therefore differ
from the grid-and-furniture measurement snapshot in
[`world.md`](world.md#measurement-snapshot-2026-10-29) and from the full browser world. Compare runs with the same
builder inputs, seed, population rules and sample window.

Empty-ending counts are not printed by the benchmark, but `node tools/audit-crosswalk-landings.mjs` reads the same
`buildWorld()` result, exposes `links` (and the three connector tiers) with the source replacement used by
`tests/pedestrian-route-sinks.test.cjs`, and asks `links(track, ±1)` for every crosswalk track end. It prints the
empty ends, tracks, reason counts, every fallback/kerb-step leg's lane, rail and building clearance, the generated
spurs and the split runs' lane distance. Its `--full` switch builds the rendered world's landmark, bridge and
building colliders and the real city-grid curbs through `tools/audit-tree-clearance.mjs` instead of the benchmark's
city blocks. The 2026-11-08 run leaves **24 ends / 24 tracks** on the benchmark (full scene **18 / 18** on 2,397
crosswalks), down from **47 / 41**; the measured before/after pairs since the first fallback pass are 269 → 246 → 212
→ 156 → 47 ends and 247 → 225 → 197 → 143 → 41 tracks. Crosswalk count and the harness's omissions must be reported
with any count. The direct fit (up to 8 m), the 32 m fallback (16 m corridor) and the 32 m kerb step are measured
together, as are the 2 m rail keep and building colliders. Every fallback and kerb-step connector leg is audited
against each road lane with the exact segment-to-segment distance and reported as `laneHits` / `curbStepLaneHits`
(0; the former line-line form admitted 17 fallback legs by up to 1.09 m).

Per district it prints the cars sampled, mean speed (and of the moving ones), the share stopped (< 0.5 m/s), the longest
stopped queue in a lane, the distribution of finished waits (p50/p90/max), cars held over 60 and 120 s, why the stopped
cars stand (`v.waitReason`) and the **root cause**: it follows the wait-for graph (the leader, the tram whose proxy or
held curve is in the way, the cross traffic in the box, the last car in a full exit lane, the oncoming lead; a tram
follows its `obstacle` or `leader` (including an exit-room reservation's leader)) to the vehicle the queue really waits for (`queue moving`: the queue ahead is moving,
v only waits its turn). Then the junctions by stopped car-seconds with their throughput (cars entering a junction curve)
and root causes, deadlocks (cycles in that graph whose members all stood over 30 s), junction boxes with a car stopped
inside (its body centre past the stop line) over 20 s, and trams stopped over 60 s off a stop (with the pedestrian holding one). Last, a Markdown table of
every district. `tramsHeld60` retains the total continuous stop across all reasons; its text records the reason at
the longest sample. A car refused by a held tram curve follows the conflict actually held this frame and skips a tram
that is itself waiting for that car, matching `heldByTram`'s exemption; without that, a third tram's body covering the
junction made the car and the waiting tram look like a cycle (Kaponiera `-1468, 118`). That skip is `heldByTram`'s
exemption only; `tramRefusedClose` (the short-link bus guard in `enter`/`mayEnter`) calls it with `exempt = false`, so a
bus cycle through that guard is still followed and would be a real cycle. Separately, `switchHeld60`,
`maxSwitchWait` and `switchSeconds` measure the actual switch reason
every frame while speed is below 0.5 m/s, excluding boarding dwells. A long red followed by a short switch wait is
therefore distinguishable from a tram blocking a switch for over a minute. `tests/traffic-flow.test.mjs` runs the
benchmark for 5 simulated minutes at Jeżyce and Centrum as a regression test. It uses seed 1: seed 4242's five-minute
Jeżyce run reaches the separate pedestrian-in-the-box gridlock at `(-2069, -470)` (pedestrian-overlap backlog), which is
not a car–tram flow regression. A 3-minute seed 4242 Jeżyce run is kept as a bound (`deadlocks <= 1`, longest hold
under 130 s) so the known cycle cannot hide a new one. The same file runs `tools/audit-tram-overlaps.mjs` on Jeżyce seed
4242 and requires at most 11 car–tram first contacts (the west expansion's seeded order); the current tree settles at 5,
all stopped shared-lane touches. The pre-proxy baseline was eight, all with `tramWait = car`, six in the
`-2167, -498` cluster.

## Car–tram body overlap audit

`node tools/audit-tram-overlaps.mjs` runs the same independent seeded worlds and update order as the traffic
benchmark. It accepts `--minutes`, `--fps`, `--seed` and `--only` with the same defaults and district keys. Each JSON
line reports a district's overlapping pooled vehicle–tram pairs, the number of pair-frames and the first observed
contact for each pair. After the 20 s warmup, it compares each car and bus's oriented body rectangle against each
active tram section on every frame; touching counts as an overlap. Pooled IDs may be reused after respawning, so a pair
is counted once even if those objects meet again. It uses the benchmark's headless scene and omissions described above;
it neither proves collision-free behavior between frames nor checks the rendered scene. Each seed takes a few minutes
for all seven districts; `tests/traffic-flow.test.mjs` runs only the five-minute Jeżyce pass at seed 4242 as a bound.
Results over eight seeds are in
[observations/tram-overlaps-2026-11-04.md](observations/tram-overlaps-2026-11-04.md).

## Tram section sweep and standing-position audit

`node tools/audit-tram-stop-sweeps.mjs [--step 0.25] [--margin 0.1]` prints a summary followed by every non-shape
lane end whose standing 5.6 × 2.02 m van intersects a sampled turning-section envelope. It uses the benchmark world,
the real `TRAM_MODELS` and `poseSections`, and recursively follows short track pieces over permitted routed switches.
The section sweep is indexed only in the offline tool; it adds no app boot phase or runtime allocation. The margin
is in metres, the sampling step in track metres. This is a sampled diagnostic, not a continuous clearance proof.
Straight shared track is excluded from the turning envelope; connector queues and articulated buses need separate
body checks. `retreat` / `remaining` are null when the retreat cannot leave six metres of storage; `requiredRetreat`
still reports the hypothetical retreat along the extrapolated lane, up to 60 m.

`node --test tests/tram-sweep.test.cjs` checks the real section pose against a circular-chord reference, compares
indexed queries with a plain sampled union, exercises a clear retreated standing position, follows short switch
pieces, excludes straight shared track, catches an S bend whose midpoint and end tangents align, and requires every returned
retreat to clear the envelope while preserving storage (including search exhaustion). It loads the
whole tram module with rendering imports stubbed; no new source-slice marker or preload is needed.
The city-wide list and the eight-seed comparisons are in the
[2026-11-12 record](observations/car-tram-sweep-2026-11-12.md).

## Opposing tram-lane clearance audit

`node tools/audit-tram-opposing-lanes.mjs` lists JSON lines for each opposing track/lane run whose centre separation is
under 2.3 m for at least 5 m; the total on stderr counts directed runs and distinct road lanes. The default clearance is
0.9 m car half-width + 1.2 m tram half-width + 0.2 m margin. `--clearance` can lower the threshold, and `--min-length`
changes the 5 m cutoff. It uses the benchmark network and `mapTramsToRoads` runs, samples them every metre, and classifies
direction from each mapped run, so short encounters and unsampled gaps are not covered. The counts are not lengths of
unique physical streets where track runs overlap. The scene omissions above apply. It takes a few seconds. At `1eff3b4`
it listed 65 runs on 61 lanes (753 m). The Półwiejska lane correction left 64 runs on 60 lanes (668 m); the 2026-11-05
general pass against the real street-track pair leaves **62 runs on 58 lanes (626 m)**. The 2026-11-07 pass removes the
`< 12 m` exception, moving edge 305 clear, and the default report counts only street-running tracks a `route=tram`
relation uses: **47 runs on 45 lanes (417 m)**; the 14 runs / 12 lanes / 200 m on off-street formations or unused track
are summarized under `skipped` and can be listed with `--all` (61 / 57 / 617 m). `tests/opposing-tram-audit.test.mjs`
runs it, checks the row and total format, that each row is a used street track, that edge 7500, 3015, 3201 and 305 do
not appear, and the lane and length totals. `tests/shared-tram-lanes.test.cjs` slices `alignSharedTramLane` and removes
both `for (const e of edges) alignSharedTramLane(e);` and the `clearOpposingTracks();` call for its pre-fix control, so
keep those calls on their own lines. It also rebuilds the curbs/medians network with and without the correction and
asserts that no new straight connector becomes steeper than 15°.

## Tram edge queue benchmark

`node tools/bench-tram-edges.mjs --in-view --seed 4242 --tram-seed 1922` parks the headless focus just inside each
of the 11 track buffer stops at the detail-box edge, plus Jeżyce, Centrum and Rataje as central baselines, and runs
five simulated minutes at 15 fps (`--minutes`, `--fps`, `--seed`, `--tram-seed`, `--only` override them). It reports
the average active trams and those within 400 m/250 m of the focus, trams ever stopped over 30/60 s,
`deadEndWait`/`bufferWait`/`stuck` histograms, the queue at every buffer end (all and slow/stopped: max and final,
share of one-second samples) and the worst cluster of stopped trams, then a Markdown table. Without `--in-view` there
is no camera, so every tram is out of view; with it, a fake camera at the focus sees in every direction, so every tram
within `TRAM_CULL` 1,500 m counts as on screen: a 360° worst case, not the browser frustum. Tram seeds 1922/77/4242 and limits are in
[observations/tram-edge-jams-2026-11-04.md](observations/tram-edge-jams-2026-11-04.md). No test runs the benchmark;
`tests/tram-buffers.test.cjs` covers the spawn gate, moving-tram clock, render-range visibility, seed injection and
hidden queue retirement on synthetic track, and `tests/tram-road-proxies.test.cjs` covers the crossing proxy pad
(a stopped car's nose clear of the tram body) and the gate's 200 m look-ahead without the tram random sequence.

## Tram route membership benchmark

`node tools/bench-tram-routes.mjs` runs six independent headless worlds at Ostrów Tumski (907.1, -246.5),
Stare Miasto (0, 0), Dworzec (-1518.5, 557.7), Półwiejska (-250, 850), Rataje (1108, 1439) and Jeżyce
(-2056, -391), in world metres. Defaults: 10 simulated minutes per location, 15 fps and seed 4242, reset at each
location; `--minutes`, `--fps` and `--seed` override them. It emits JSON lines with per-location counts and off-route
edge details, then a total. Samples are taken once per simulated second from the first second, for every active tram,
without a distance filter. The front edge's route membership is compared with the tram's displayed direction and
numbered line. `other` means the edge has routes, but none with the tram's line number; `unused` means no route uses it.
`sameLine` counts a direction-membership mismatch where another route of the same line uses the edge. Sum counts before
dividing for the global share. Both benchmarks share `tools/bench-world.mjs` for the headless world setup.

The setup uses the same headless world and omissions as the traffic benchmark above. It does not check the rendered
scene or full tram body. Route selection can change ahead of the front as the path is extended; the displayed route
follows the front edge. The historical six-location run's exact coordinates, sampling point, seed, frame rate and setup
were not recorded; this is a reproducible reconstruction, not a controlled replay. On 2026-11-03 it sampled 84,235
tram-seconds: 0 on another numbered line's track and 0 on track without any route. Before the display timing fix, 355
samples of line 5 showed its return direction before the front entered that route; afterwards the same benchmark found
0 such samples. Historical pre-15.10 figures were 0.44% total and 0.06% on other routes' track, using the older
direction-membership classification.

## Signal head audit

`node tools/audit-signal-heads.mjs` prints JSON lines for the 167 historical strict-unmatched runtime edges and
A/B/C/D totals; `--before` stops after the earlier existing-pole additions. A includes head along/lateral offsets
from the stop line; C reports the failure counts over up to 300 sampled sites and the least-blocked sample. The audit
and runtime use the same search, including actual lanes, turn samples, crossing landings and locally materialised
sidewalk, corner and refuge segments. The headless fixture uses live park/plaza data but omits building, landmark and
bridge colliders. The browser includes them, so candidate sites and counts can differ. The audit checks geometry, not
visual occlusion, and C does not rule out unsampled sites. `tests/signal-audit.test.cjs` checks before and after counts
(114/0/43/10, hash `1f83459c...`); `signal-placement.test.cjs` rebuilds the network with the new footprints and compares
lanes, crossings and pedestrian segments and their route connections near the new poles, as well as phase equality
over the full plan cycle (pedestrian plans included), facing, setbacks, reused pole curbside bounds
(`lateral <= half + 2.6 m`), overhead arm reach (`<= 12 m`), 0.5 m arm/head
rail clearance (`>= 2.22 m`), the 8 m/10.5 m visibility bands, foot rail clearance (`>= 3.1 m`), colliders and audio
registrations. It also builds the tram/rail catenary layouts and checks every overhead arm, foot and head against
every pole and mast (`>= 0.5 m`).
