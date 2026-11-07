# Testing and local development

No package.json or npm install is needed. The tests use only Node built-ins (`node:test`, `node:assert/strict`, `node:vm`);
the browser loads three.js from the CDN. Verified on Node v26.12.1. Node 22+ is needed because importing `js/*.js`
as ESM without a package.json depends on Node's automatic module-syntax detection.

## Commands (verified)

- Full suite: `node --test tests/`. 425 tests, about 50 s (2026-11-07). Most time is spent in `tests/geodata.test.mjs`, which runs the full `tools/build-poznan.mjs` in a temp copy of the repo with `--max-old-space-size=8192`, the five-minute traffic-flow regression, and the signal-head and pedestrian-route audits.
- Quick loop that skips the geodata rebuild: `node --test tests/*.cjs` (about 9 s, most of it `road-network`, `tram-infra` and `tram-clearance` building the network and the street furniture on the real Poznań graph, and `buildings-density` running `buildCityBlocks` twice).
- One file: `node --test tests/cameras.test.cjs`. Running `node tests/cameras.test.cjs` directly also works.
- By test name: `node --test --test-name-pattern="police" tests/`
- Serve the app: `python3 -m http.server 8000` from the repo root, then open `http://localhost:8000/`. Any static server works. There is no build step, and `.js` is served as `text/javascript`. Three.js loads from jsDelivr (`three@dev`) through the import map in `index.html`, so the page needs network access. `localhost` counts as a secure context, which WebGPU requires.
- `.gitignore` contains only `.DS_Store`. Nothing is generated except `js/geodata.js`, which is committed.

## No rendering tests

No test runs a browser, WebGPU, TSL shader compilation or a screenshot comparison. Tests that touch shader or scene code (`facade-projection`, `vehicle-lights`) re-implement or stub the TSL nodes and check only the math. Any change to geometry, materials, TSL nodes, lighting, post-processing or culling has to be checked by hand: serve the app and look in a WebGPU browser. `WebGPURenderer` falls back to WebGL2 when WebGPU is unavailable, and `js/main.js` branches on `renderer.backend.isWebGPUBackend` (for example for instanced attributes). If you touch that kind of code, check the fallback too. Watch the browser console, because shader and node errors show up only there.

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
     `return { along, across, next, crosswalks, segments, segmentsNear };` in pedestrian-routes.js to check real bidirectional connectivity.
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
   - `facade-projection` slices `js/tsl-materials.js` between markers: `const facadeNormalVertex =`, `function facadeCell(`, `let bayWidth`, `const evaluateApartmentInterior`, `const rayWorld =` and `// Slab intersection`.

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

- **To add a new `js/*.js` module**, also add `<link rel="modulepreload" href="./js/NAME.js" />` to `index.html`. Keep that exact attribute order and the self-closing ` />`, and place it after the import map and before the stylesheet. Then bump the expected preload count in `boot.test.cjs`, which is currently 42, one per file in `js/`.
- Relative imports must be `./name.js` paths that resolve to a preloaded URL.
- `index.html` must contain exactly two `<script>` tags (the import map and `./js/main.js`).
- `three` and `three/webgpu` must map to the same URL.
- Each `data-teleport="key"` button in `index.html` must have exactly one matching key in `TELEPORT_LOCATIONS` (`js/city-config.js`), and the reverse. The destination must be on a road and not inside a block.

## Pedestrian benchmark

`node tools/benchmark-pedestrians.mjs /abs/path/to/three/build/three.core.js` (or set `THREE_CORE_PATH`). You need a local three.js build, because the repo has none (any npm `three` package's `build/three.core.js` works). Verified run: about 7 s. It prints JSON with the ms per frame for 340 rigs, before and after, plus the reduction percentage. It first asserts that deferring the pose solve for hidden rigs gives bit-identical gait and poses, so it doubles as a correctness check after `PersonRig` changes. It loads `js/pedestrians.js` through `loadModule` with stubs only for `'three/webgpu'`, `'three/tsl'` and `'three/addons/utils/BufferGeometryUtils.js'`. It also builds its baseline by replacing the literal `if (updatePose) this.solve();`. If you add an import to `pedestrians.js`, add a stub here. If you change that line, update the replacement.

## Pedestrian overlap audit

`node tools/audit-ped-overlaps.mjs` runs the real pedestrians, traffic and trams headless with the camera parked at
Centrum, Stare Miasto, Jeżyce, Łazarz, Wilda, Rataje, Rondo Kaponiera and Poznań Główny. Defaults are 3 simulated minutes
per focus point at 15 fps and seed 4242; the record below also used seed 77 (`--minutes`, `--fps`, `--seeds`, `--only`,
`--json` override them). After
20 s it samples once per simulated second: an overlapping pair is two placed peds with centres under 0.5 m apart, a
cluster is a connected group of at least four such peds lasting over 5 s, and it also reports citywide overlapping pairs
per second and crosswalk entries per minute so throughput is visible. Each cluster lists its centroid, street name,
member states, route positions, spawn origins and age. It uses the benchmark's headless world and omissions. Results are
in [observations/ped-overlaps-2026-11-05.md](observations/ped-overlaps-2026-11-05.md); no test runs the whole audit, but
`tests/pedestrian-route-sinks.test.cjs` covers the route-side regression on the bare network.

## Traffic benchmark

`node tools/bench-traffic.mjs` runs the street traffic, pedestrians and trams headless on the real network, with no
three.js (every three.js/TSL import is an inert stand-in; `traffic.js`, `trams.js`, `road-network.js`,
`pedestrian-routes.js`, `street-details.js` (the furniture that closes lanes) and `tram-infra.js` (the tram stops) run
for real through `loadModule`). It parks the camera in turn at Jeżyce (Rynek Jeżycki), Łazarz (Głogowska), Centrum
(Św. Marcin), Rondo Kaponiera, Stare Miasto, Rataje (Rondo Rataje) and Wilda, rebuilds the world for each, runs
`--minutes` (default 5) at `--fps` (15) with `Math.random` seeded (`--seed`, 4242: a run is reproducible), and samples
the vehicles within 300 m once a second after 20 s. About 12–17 s per district. Options: `--only jezyce,lazarz` (keys
`jezyce lazarz centrum kaponiera stare rataje wilda`), `--top N` junctions, `--dump` (the longest wait as text: every
vehicle, tram and walker at its junction), `--watch x,z` (that junction every 30 s), `--json file`, `--ped-rooms` (the
room audit below), and the experiments `--no-peds`, `--no-trams`, `--no-signals` (they patch `traffic.js` by exact text
and throw if it changed).

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

Empty-ending counts are not printed by the benchmark. They were taken from the same `buildWorld()` result by exposing
`links` with the source replacement in `tests/pedestrian-route-sinks.test.cjs` and asking `links(track, ±1)` for every
crosswalk track end. That makes the 2026-11-07 before/after pairs **269 → 246 → 212 ends** and **247 → 225 → 197
tracks with an empty end** reproducible without a separate tool; crosswalk count and the harness's omissions must be
reported with it. The direct fit (up to 8 m) and the 32 m fallback (8 m corridor) are measured together, as are the
2 m rail keep and building colliders. The same run audits every fallback connector leg against each road lane with the
exact segment-to-segment distance and reports `laneHits` (0; the former line-line form admitted 17 legs by up to
1.09 m).

Per district it prints the cars sampled, mean speed (and of the moving ones), the share stopped (< 0.5 m/s), the longest
stopped queue in a lane, the distribution of finished waits (p50/p90/max), cars held over 60 and 120 s, why the stopped
cars stand (`v.waitReason`) and the **root cause**: it follows the wait-for graph (the leader, the tram whose proxy or
held curve is in the way, the cross traffic in the box, the last car in a full exit lane, the oncoming lead; a tram
follows its `obstacle` or `leader` (including an exit-room reservation's leader)) to the vehicle the queue really waits for (`queue moving`: the queue ahead is moving,
v only waits its turn). Then the junctions by stopped car-seconds with their throughput (cars entering a junction curve)
and root causes, deadlocks (cycles in that graph whose members all stood over 30 s), junction boxes with a car stopped
inside over 20 s, and trams stopped over 60 s off a stop (with the pedestrian holding one). Last, a Markdown table of
every district. `tramsHeld60` retains the total continuous stop across all reasons; its text records the reason at
the longest sample. A car refused by a held tram curve follows the conflict actually held this frame and skips a tram
that is itself waiting for that car, matching `heldByTram`'s exemption; without that, a third tram's body covering the
junction made the car and the waiting tram look like a cycle (Kaponiera `-1468, 118`). That skip is `heldByTram`'s
exemption only; `tramRefusedClose` (the short-link bus guard in `enter`/`mayEnter`) calls it with `exempt = false`, so a
bus cycle through that guard is still followed and would be a real cycle. Separately, `switchHeld60`,
`maxSwitchWait` and `switchSeconds` measure the actual switch reason
every frame while speed is below 0.5 m/s, excluding boarding dwells. A long red followed by a short switch wait is
therefore distinguishable from a tram blocking a switch for over a minute. `tests/traffic-flow.test.mjs` runs the
benchmark for 5 simulated minutes at Jeżyce and Centrum as a regression test.

## Car–tram body overlap audit

`node tools/audit-tram-overlaps.mjs` runs the same independent seeded worlds and update order as the traffic
benchmark. It accepts `--minutes`, `--fps`, `--seed` and `--only` with the same defaults and district keys. Each JSON
line reports a district's overlapping pooled vehicle–tram pairs, the number of pair-frames and the first observed
contact for each pair. After the 20 s warmup, it compares each car and bus's oriented body rectangle against each
active tram section on every frame; touching counts as an overlap. Pooled IDs may be reused after respawning, so a pair
is counted once even if those objects meet again. It uses the benchmark's headless scene and omissions described above;
it neither proves collision-free behavior between frames nor checks the rendered scene. Each seed takes a few minutes
for all seven districts; no test runs it. Results over eight seeds are in
[observations/tram-overlaps-2026-11-04.md](observations/tram-overlaps-2026-11-04.md).

## Opposing tram-lane clearance audit

`node tools/audit-tram-opposing-lanes.mjs` lists JSON lines for each opposing track/lane run whose centre separation is
under 2.3 m for at least 5 m; the total on stderr counts directed runs and distinct road lanes. The default clearance is
0.9 m car half-width + 1.2 m tram half-width + 0.2 m margin. `--clearance` can lower the threshold, and `--min-length`
changes the 5 m cutoff. It uses the benchmark network and `mapTramsToRoads` runs, samples them every metre, and classifies
direction from each mapped run, so short encounters and unsampled gaps are not covered. The counts are not lengths of
unique physical streets where track runs overlap. The scene omissions above apply. It takes a few seconds. At `1eff3b4`
it listed 65 runs on 61 lanes (753 m). The Półwiejska lane correction left 64 runs on 60 lanes (668 m); the 2026-11-05
general pass against the real street-track pair leaves **62 runs on 58 lanes (626 m)**. `tests/opposing-tram-audit.test.mjs`
runs it, checks the row and total format, that edge 7500 and the two newly corrected edges do not appear, and the
remaining lane and length totals. `tests/shared-tram-lanes.test.cjs` slices `alignSharedTramLane` and removes both
`for (const e of edges) alignSharedTramLane(e);` and the `clearOpposingTracks();` call for its pre-fix control, so keep
those calls on their own lines. It also rebuilds the curbs/medians network with and without the correction and asserts
that no new straight connector becomes steeper than 15°.

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
(91/0/66/10, hash `85648549...`); `signal-placement.test.cjs` rebuilds the network with the new footprints and compares
lanes, crossings and pedestrian segments and their route connections near the new poles, as well as phase, facing,
setbacks, reused pole curbside bounds (`lateral <= half + 2.6 m`), colliders and audio registrations.
