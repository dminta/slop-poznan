# Actors: traffic, pedestrians, vehicle models and lights

## Map (who owns what)
- `js/traffic.js` has two independent systems. `createTrafficSystem` covers the road graph: cars, buses, **all pedestrian behaviour** (spawning, walking, crosswalk rules, queues, conversations), collision sparks and the pooled vehicle lights. `createHighwayTraffic` covers lane polylines `city-grid.js` may lay outside the road graph (`cityGrid.highwayLanes`; empty in Poznań, so it builds no cars). It is a lighter model: IDM per lane, no lane changes, cyclic leaders, 3 LODs, lamp flares.
- `js/pedestrians.js` is only the body: `PersonRig` (planted-foot gait + IK) and `PersonCrowd` (one instanced skinned draw per LOD). `controllers.js` also uses them for the player's pedestrian and the cyclist's rider.
- `js/pedestrian-routes.js` lazily builds and caches sidewalk tracks (`along(edge)`), crosswalk tracks (`across(node)`: one per junction arm, oriented along the arm road's `clx/clz`, at every junction except shape nodes (bends)) and the corner links between them (`next`). Junction links connect only points on the same block (`blockAt`). Crossing the road always goes through a crosswalk track.
- `js/trams.js` is a third, separate system: trams on the `GEO.rail` track graph (section "Trams" below). `traffic.js` makes the cars and pedestrians give way to them and collides the player with them.
- `js/actor-models.js` holds the vehicle geometry and TSL materials (cars, bus, trams, and the player's helicopter). `js/vehicle-lights.js` holds the one headlight profile shared by street traffic, highway traffic and the player's taxi.
- `main.js` calls `trafficSystem.update(dt, elapsed, cameraSystem.currentPos, activeEntity, activeMode, camera)`. The **focus is the camera position, not the player**. Consumers of the returned `cars`/`buses`/`peds`/`highwayTraffic.cars`: `audio-sources.js` (reads `edge, x, z, speed, acc, driver.a, yaw, yawOffset, isPolice, isSUV, bus, wait, gap, leaderSpeed, conn, yielding`; for peds `placed, v, conversation, rig.feet`, plus track fields) and the `city-map.js` radar. Renaming these fields breaks those modules.

## Street simulation model
- The drivers are IDM + MOBIL-style lane changes. Parameters are `CAR_DRIVER`/`BUS_DRIVER` (`a, b, T, s0, aLat`), with per-vehicle desired speed `v0`. `aLat` sets bend speed through connector curves. Traffic has no coasting or physics model. Knocks are a separate decaying `vx/vz` impulse applied by `shove()`, clamped to the road.
- Road graph fields used (from `road-network.js`): edge `sx,sz,dx,dz,rx,rz,len,lanes[]` (lateral offsets, `r` = right), `moves[{to, turn:'S'|'L'|'R', out[]}]` (`out[i]` = target lane or -1), `axis` (`'ave'` for major roads), `axisIndex` (signal group at `e.to`: 0 the widest road, 1+ the others, which share the second phase), `inSide/outSide`, `opposite`. Nodes provide `signal, in, out, groupCount, sideCount, hx, hz`. `connector(e,i,f,j)` and `curvePoint` give intersection curves. A node's sides are its arms, numbered from 0.
- Occupancy: `e.occ[lane]` holds pooled `{v, s}` entries sorted by `s`, and `buildOccupancy()` rebuilds them once per frame **before** driving. A vehicle inside an intersection is listed in its source lane at `e.len + cs` and in its target lane at negative `s`. A vehicle more than halfway through a lane change is in both lanes (`straddle`).
- Intersection counters (`n.box`, `n.crossing`, `e.through`, `e.lefts`) are reset only for nodes and edges registered through `touchNode`/`touchEdge`. A new per-node or per-edge counter must be incremented through those helpers or it never resets. `claim()` runs immediately inside `mayEnter`/`enter` so vehicles and pedestrians evaluated later in the same frame see the claim. Keep that ordering.
- Signals come from `signalPhase`/`walkSignal` in `city-config.js`, the same clock `street-details.js` renders. `phaseOf(e)` picks the phase by `e.axisIndex`. Pedestrians crossing a group-0 road (the widest road at the junction; the track's `group`) walk on `stWalk`, the others on `aveWalk`. At unsignalised crosswalks they always have the WALK: vehicles yield to them through `pedestrianOn`, and they step off once no vehicle holds the crosswalk or can no longer stop. `laneCoord(e, i, arm)` and the walkers' `p.coord` both measure along the arm's crosswalk axis.
- Routing is random per edge (`chooseMove`): straight-biased, buses strongly straight and avoiding single-lane turns. Routes deliberately do **not** steer toward the camera. Recycling keeps the population local (the old drift-to-focus weighting was removed).
- **Police** (`isPolice`) ignore red/amber in `signalAhead` and `mayEnter`, but still wait for `boxBusy`, pedestrians, a free exit (`room`/`alongside`/`mergingAhead`) and cross traffic: at a non-green signal `yieldToCrossTraffic` applies to them, and `cautious` caps their approach at 5 m/s. Other drivers turning left count oncoming police as traffic even at red (`yieldOncoming`). `tests/traffic.test.cjs` pins all of this.
- The vehicle mix is deterministic by index in the `NUM_CARS` loop: police `i % 40 === 6` (sedan body plus livery through `carState.w`, plus a lightbar instance), taxi `i % 5 === 0`, SUV for the remaining even indices, sedan otherwise. There are 12 buses (`NUM_BUSES`), and they spawn only on `e.major` edges (`road-network.js` `isMajorRoad`: ≥ 14.5 m curb to curb or ≥ 3 travel lanes, or on a named road that is major over most of its length). Instance buffers and the lightbar mesh are sized from the counts, so changing the mix resizes them. The highway uses its own random thresholds (20% taxi / 45% sedan / 35% SUV) and palettes, with no police and no buses.

## Population around the camera (spawn/despawn)
- Pools have a fixed size, and nothing is created or destroyed. A rotating cursor scans the pool each frame with an **attempt** budget (4 vehicles, 6 pedestrians), so awkward spots can't monopolize a frame.
- Actors are retired beyond `VEHICLE_RADIUS` 380 m / `PED_RADIUS` 320 m **even when visible**: keeping them starves the streets ahead during travel. Replacements are placed 100–350 m away (pedestrians 60–280 m). A placement is rejected when it is in the frustum and within `VEHICLE_SPAWN_DISTANCE` 250 m (`PED_SPAWN_DISTANCE` 150 m) of the camera (`nearView`), within 25 m (pedestrians 10 m) of the player, or (vehicles) in a lane that isn't clear (`laneClear`).
- A camera jump of more than 140 m in one frame (a teleport, or the first frame) respawns everything beyond `NEAR_RADIUS` anywhere within 0–350 m with no view protection.
- `refreshNear()` selects edges by their nearest point to the focus (not the midpoint), and spawn `s` is limited to the local section of long roads. It refreshes only after the focus moves 40 m.
- Pedestrians flagged `crossesStreets` try crosswalks for 5 attempts, then fall back to sidewalks. Spawning a pedestrian ends its conversation and sets `rig.placed = false`. Separately, `PersonRig.update` resets the rig whenever it moves more than 3 m in a frame.

## Player interaction
- `player.active` is false in the helicopter or when the entity is at y >= 2.6. Mode-specific `halfW/halfL/push` values are set in `update()`. Drivers treat the player as a leader (`playerGap`), and lane changes avoid the player.
- `collideWithPlayer` uses a SAT OBB test. The per-type extents are hard-coded in the call in `update()` (bus / `isSUV` / other), and the mass ratio is set in `collideWithPlayer`. `reportCollision` fires synchronously with a **reused** event object, so listeners (audio) must copy any field they keep.

## Performance patterns (keep them when editing)
- Instance slots are handed out every frame only to actors that `visible()` passes. `visible()` tests side planes only; the margin radii are car 18, bus 22, pedestrian 7, to cover shadows and beams. Every instanced mesh has `frustumCulled = false`. Cars within `CAR_PROXY_DISTANCE` (90 m from the focus) get the full body plus separate wheel instances; farther cars get the ~250-triangle proxy with built-in wheels.
- Upload only the used prefix: `flagRange(attr, n)` calls `clearUpdateRanges` + `addUpdateRange(0, n*itemSize)`. Paint is stored as `Math.fround` floats and lamp state is compared against the buffer; the paint/state attributes are flagged only when they change (`dirtyPaint`/`dirtyState`).
- Empty meshes are hidden after 2 updates (`hideEmpty`). For the first two frames they keep one zero-scale instance so `main.js` shader precompile and the warm-up frame compile them. Copy this pattern for any new instanced mesh. Idle sparks write and upload nothing.
- Pedestrians: every rig's gait advances every frame. `renderPed` passes `updatePose = draw`, so hidden rigs skip `solve()`, and only drawn rigs are copied into `PersonCrowd` (far LOD beyond 34 m from the focus). Feet and gait stay identical to an always-solved rig.
- Lights come from fixed pools: 96 headlight spots (2 per vehicle) plus 6 police point lights for streets, 28 spots for the highway. Lit vehicles are sorted by an effective distance that penalizes positions behind the camera. Unused lights are parked at y = -1000 with intensity 0. Never add or remove lights at runtime (clustered lighting). The beam fades in from `cityUniforms.uInteriorGlow`. `DUAL_BEAM_*` are unused leftovers.
- `tests/traffic-performance.test.cjs` budgets are **exact write/upload counts, not timings**: idle sparks produce 0 matrix writes and 0 uploads after warm-up, frames 1–2 keep exactly one degenerate visible instance, the live-spark update range is `count * 16` floats, and `renderPed` adds to the crowd only when drawn.
- `tools/benchmark-pedestrians.mjs` (usage in [`testing.md`](testing.md)) is the correctness check after `PersonRig` changes; it string-replaces `if (updatePose) this.solve();`, so keep that exact text.

## Test-harness coupling (gotcha)
`traffic.test.cjs` and `traffic-performance.test.cjs` extract inner functions of `traffic.js` by regex: from a line starting `  function name(` up to the first line that is exactly `  }`. They then run each function in a `vm` with a hand-written context of its free variables. The extracted functions are `mayEnter, signalAhead, canStop, yieldToCrossTraffic, yieldOncoming, nearView, refreshNear, spawnVehicle, spawnPed, renderPed, updateSparks, flagRange, playerInLane, occupyTrams, tramBlocks, inTramLane, overlapWithPlayer, collideWithTram, tramRoom, tramCrossings, tramNear` (`mayEnter` needs a `tramBlocks` stub, `spawnVehicle` a `nearTram` one), plus the `const pl = entity ... } : null;` snippet in highway `update`. Keep them as 2-space-indented `function` declarations. When a change adds a free variable or helper to one of them, add a stub to the matching test context.

## Trams (`js/trams.js`)
`createTramSystem(scene, { network, rail = GEO.rail, stops = GEO.tramStops, traffic })` is built in `main.js` after
the road paint, and `update(dt, elapsed, focus, camera, playerEntity, activeMode)` runs before the street traffic. It
reads the road network (signal nodes, lanes and junction curves for `mapTramsToRoads`) and, read-only,
`traffic.cars`/`traffic.buses` (`edge, x, z, yaw, yawOffset, half, halfWidth, tx, tz, speed, vx, vz`) to brake for
them; `traffic.js` does the yielding (see "Interactions" below).

- **Track graph** (`buildTrackGraph`, pure). Tram chains become directed edges. One-way chains run one way. A two-way
  chain that runs parallel to another tram track 1.8–6.5 m away is one track of a double-track pair (OSM rarely tags
  them oneway), so it gets the direction that keeps its neighbour on the left (right-hand running). The rest stay
  two-way and form single-track blocks (`run`/`runDir`): a tram enters a block only while nobody runs the other way in
  it. At a node a tram may continue onto an out-edge whose start tangent is within `SWITCH_TURN` (38°) of its end
  tangent; the branch is chosen at random when the path is extended. Edges carry `vmax[]` (curve limit from
  `aLat` 0.9 m/s²), `crossings[]` (level crossings that aren't cut into nodes), `foulStart`/`foulEnd` (clearance points:
  how far the track stays within 2.9 m of the other tracks at a node), `endPad` (buffer stops on a stub that ends on
  another track), `stops[]` and `signals[]`.
- **Stops**: `tram-infra.js` stops (`railIndex`, `s`, `dir`) are attached to the edge running that way
  (`attachTramStops`). Bare `GEO.tramStops` nodes are snapped to the nearest track within 6 m (`snapTramStops`); that
  fallback is used by the tests. The tram's front stops `0.35 × length` past the stop point, dwells 20–30 s with its
  doors open, then departs.
- **Signals** (`findTrackSignals`): every `n.signal` road node within 9 m of a track puts a stop line on that edge, as
  far out as the stop line of the road arm the tram arrives along (the in-edge within 60° of the track tangent 12 m
  before the junction). Its group is that arm's (`axisIndex === 0` → group 0), else the group the roads don't use.
  The phase is `signalPhase(elapsed, group === 0)` from `city-config.js`, the cars' clock. Trams stop on red, and on
  amber when they can stop at 3 m/s².
- **Driving**: IDM (`TRAM_DRIVER`: a 1.15, b 1.4, T 1.6 s, s0 3 m; 50 km/h street-running, 65 km/h segregated, ×0.9–1.0
  per tram). The acceleration is the minimum over the free road, trams ahead on the path (their rear, minus the
  clearance point while it is still on another branch; head-on on two-way track counts as stopped), switches, crossings
  and blocks another tram holds or reaches first, the next stop, red signals, curves and a buffer stop. `waitReason`
  names the binding one (`tram`, `switch`, `block`, `stop`, `signal`, `curve`, `end`, or empty).
- **Population**: 24 pooled trams (every third is a Tramino), kept within 900 m of the camera focus and respawned
  120–800 m away, never within 300 m in view or 70 m from another tram. After a camera jump of more than 140 m they are
  all respawned. A tram waiting at a buffer stop is respawned after 8 s out of view (40 s in view). A tram stopped
  90 s out of view (240 s in view) is respawned too; that also clears rare head-on deadlocks.
- **Bodies**: `TRAM_MODELS` in `trams.js` (Moderus Gamma, 3 sections; Solaris Tramino, 5; both 31.8 m). Each section
  lies on the chord between its two ends on the path (`poseSections`), so the joints stay on the track. Section kinds
  map to one `InstancedMesh` each (`buildTramSectionGeometry` in `actor-models.js`), plus the bellows. All of them use
  `createTramMaterial` with the per-vertex `tramInfo` (half length, cab ±1/0, door z) and the per-instance `tramState`
  (brake, livery 0 Gamma / 1 Tramino, doors open). The pantograph head is at `TRAM_PANTOGRAPH_HEAD` (5.5 m).
  Culling: the whole tram is tested against the frustum side planes (radius half its length + 6 m) and dropped beyond
  1.5 km. The upload, `hideEmpty` and zero-scale first-frames patterns are the same as for traffic. Per-frame code is
  allocation-free apart from refreshing the `trams` list.
- **Lights**: `tramLightSpec(cabLength)` in `vehicle-lights.js` gives `headlight`/`zFront`. A pool of 8 spots lights
  the 4 nearest trams in view, placed with the front section's matrix.

**Public contract for interactions** (car yielding, pedestrians, player collisions, audio):
- `tramSystem.trams`: the active trams, refreshed every update (the same objects as `tramSystem.pool`, filtered).
  Each has `id`, `model` (`'gamma'|'tramino'`), `spec` (its `TRAM_MODELS` entry), `length`, `x, z, heading` (the
  track point and tangent at mid-length), `frontX, frontZ`, `speed` (m/s), `acc`, `v0`, `atStop`, `stopName`, `dwell`,
  `doorsOpen`, `nextStop`, `waitReason`, `leader`, `gap`, and `sections: [{ x, z, heading, halfLength, halfWidth, fx,
  fz, rx, rz }]`. These are world-space OBBs (centre, heading, half extents; `fx/fz`, `rx/rz` are the body's front and
  rear ends), front to rear. Use them for SAT tests. They are rewritten in place every frame, so copy any value you
  keep.
- `tram.path` (`TramPath`): `edges[0..n-1]`, `start[]` (path coordinate of each edge's start), `u` (the front's path
  coordinate), `end` (a dead end's path coordinate, or Infinity), `indexAt(u)`, `pointAt(u, out)` → `{ x, z, tx, tz }`.
  The tram's body covers path coordinates `[u - length, u]`. `tram.occN/occEdge/occS0/occS1` list the track edges under
  the body with local `[s0, s1]`, updated before driving.
- `tramSystem.graph` (`{ nodes, edges, runs }`), `tramSystem.stops`, `tramSystem.signals` (`{ node, edge, s, group }`,
  where `node` is the road-network node), and `tramSystem.models`.
- Also `obstacle`: the car (or player entity) nearest in the tram's way this frame, or null. Audio reads `x, z,
  heading, speed, acc, atStop, waitReason, length, id` and `sections[k].heading` (docs/audio.md).

**Interactions** (mixed traffic; `main.js` runs `tramSystem.update` before `trafficSystem.update` and calls
`trafficSystem.setTrams(tramSystem)` once):
- **Road mapping** (`mapTramsToRoads(graph, network)`, pure, run by `createTramSystem`; ~0.1 s on the Poznań data).
  The geodata carries no link between a track and its road, so it is geometric. `te.lanes`: the stretches of each tram
  edge where a car lane's centre line is within `ROAD_OVERLAP` 2.3 m of the track (tram 1.2 + car 0.92 half widths),
  with the lane positions at both ends, `dir` (+1 the lane's way, -1 against it, 0 across) and `pad` (the tram's width
  along the lane). `te.junctions` / `node.tramConflicts` (same objects): the lane-to-lane junction curves (`e, i, f, j`)
  passing within 2.2 m of the track. Measured: 9.4 of 72.5 km of directed track over lanes (7.9 km the lanes' way,
  0.75 km against, 1.1 km across), 939 junction curves at 205 nodes.
- **Cars yield** (`traffic.js` `occupyTrams()`, at the end of `buildOccupancy()`). Each tram goes into the lanes under
  its body as a pooled proxy `occ` entry (`v.tram`, `half`, `speed`, `driver`, `v0`; `claimed: true`, `move: null`,
  `edge: null` so the merge/claim/turn checks skip it). In lanes running its way it reaches `4 m + speed × 1 s` ahead
  of the front and moves at the tram's speed; in lanes against or across it, it reaches `8 m + 6 s` ahead (at most
  `TRAM_REACH` 70 m) and stands still, so cars stop short of the track. The reach never covers a car already there
  (it ends 0.3 m short of it; a crossing with a car on it gets no proxy). Junction curves within the same reach are
  marked `held = tramFrame, by = tram`; `mayEnter` refuses a held curve through `tramBlocks(v, n, f, j)`, except for
  the car the tram waits for (`tram.obstacle`), a car right in front of the front, or one ahead in a lane the tram
  runs along (`inTramLane`). While a tram waits for a car (`waitReason 'car'`) it holds only what its body is over.
  `spawnVehicle` rejects places within 3 m of a tram body (`nearTram`); tram spawns reject track with a car on it.
- **Trams brake** (`drive()`): the path ahead is sampled every 2 m up to the braking distance + 12 m (≤ 70 m); cars,
  buses and the player whose OBB reaches into that swept corridor are IDM leaders at their speed along the track
  (`waitReason 'car'` / `'player'`). Bodies already beside the tram (gap < -1 m) are collisions, not leaders. Cars
  facing the tram are ignored: where a lane runs against the track a car can't back out, so waiting would deadlock (the
  proxies keep cars out of the tram's way there instead). A headless 10-minute run on the real network: no car or
  pedestrian overlapping a tram body after the first frame (3665 / 49 overlap samples without the interactions), no
  tram held 90 s.
- **Pedestrians** (`tramRoom(p)` in `walk()`): each walking track caches `route.tramCrossings` (where it crosses a
  track, and how far along it the tram body reaches, `1.8 m / sin(angle)`); a pedestrian stops short of the next
  crossing while `tramNear` finds a tram body over it or a front due within `PED_TRAM_TIME` 6 s. Anyone already on the
  rails walks on. Standing on a crosswalk keeps them in `n.walkers`, so cars wait for them.
- **Player** (`collideWithTram(t)` after the cars in `update()`): SAT (`overlapWithPlayer`) against every section OBB.
  The tram is immovable: the player takes the whole push, loses speed (up to 75% head-on) and, in the car, gets a
  bus-sized knock; a crash is reported with `b` = the tram (no `type`), not for a pedestrian.

## Vehicle lights and turn-signal conventions
- Model space: +Z is forward and **+X is the vehicle's left**. `carState` (vec4) = (brake, left/+x signal, right/−x signal, livery 1 = police). `busState` uses the same first three. `v.blink < 0` means left. `pose()` sets the blink from a lane change (sign of `dl`) or from a planned turn within 35 m of the edge end or inside the connector. The flash period is 0.8 s, offset per vehicle by `blinkPhase`. Brake lights on street traffic come on at `acc < -0.8 || speed < 0.3`. Highway cars set only brake, at `acc < -1.2`. The player's taxi uses the fixed-colour material variant and drives `material.userData.carState` from `controllers.js`. It is silver, and `createCarEntity` lays its own meshes over the body material's taxi badge and plates: a side stripe across both doors (y 0.585–0.75 m, one canvas per side) and 520 × 114 mm Polish plates on holders larger than the painted plates, so those two stay hidden whatever `actor-models.js` paints there (the rear-quarter medallion number does show).
- Lamps are painted by the TSL material from spec numbers: `headlight`/`taillight` = [centre |x|, y, half-width, half-height]. The front turn signal is the outer ~30% of the headlight. The rear turn signal is the **outer** section of the tail lens (fixed in 168c3a4; it used to be inner) and reverse is the opposite end. When `tlH > tlW` (SUV) the sections stack vertically, so the turn signal is the top section.
- `spec.lamps`/`spec.lampX` (used by highway flares) are derived in a loop after `BODY_SPECS` is defined. Add new specs inside `BODY_SPECS` (taxi is `Object.assign` of sedan) so the loop covers them.
- `placeVehicleHeadlight(spot, spec, side, matrix)` uses `spec.headlight[0..1]` and `zFront + noseOffset`, and resets local coordinates on every call (pooled reuse). Always pass the **rendered body matrix**: streets compose pitch / `yaw + yawOffset` / roll, and the highway reads `getMatrixAt` from the rendered slot, so beams follow slopes and impacts. The player passes no matrix and parents the spots to `chassisPivot`. `BUS_SPEC.headlight` is the midpoint of the white lamp pair, excluding the amber indicator.
- Invariants tested in `vehicle-lights.test.cjs`: spots are unshadowed with no `map`/`colorNode`; the whole cone stays below the chassis horizon, so `HEADLIGHTS.pitch` must stay greater than `angle`, accounting for toe-out. The test's spec fixtures are copies (older sedan numbers), not `BODY_SPECS`.

## Physics and coasting parameters (player vehicles, `controllers.js`)
- Traffic AI speed is IDM only. Player car and bicycle speed comes from `driveSpeed()` with `CAR_DRIVE`/`BICYCLE_DRIVE`. `rolling` and `drag` apply **always, including under throttle** (powered speed is built on the coasted value). `coast` applies only with no throttle. `brake × |throttle|` applies only when throttle opposes the speed.
- To change how fast a released vehicle slows, tune `coast`. History: f3132b6 separated coasting from braking; 039a327 lowered `rolling`/`drag` and was reverted (35c183e); 0e92315 then added `coast` instead.
- `driveLoad()` in `audio-sources.js` mirrors the controller's throttle priority and braking test, so update both together. Player brake lights are `braking || (speed === 0 && !throttle)`.

## Recipes
**New car body type** (e.g. a van):
1. `actor-models.js`: add a full `BODY_SPECS` entry with a unique `name` (materials are cached by name).
2. `traffic.js` `createTrafficSystem`: in the `NUM_CARS` loop, add the index rule, `bodyType`, palette, and the `createVehicle` half-length / half-width / axle / `v0`; add a counter; add the `[kind, geo, count, mat]` tuple to the `bodies` table; give it collision extents in the `collideWithPlayer(...)` call in `update()` and a mass ratio in `collideWithPlayer`. The contact-shadow scale (2.22×5.05) and the wheel geometry (sedan wheels scaled by `wheelRadius`) are shared; change them if the vehicle needs different values.
3. Highway (optional): add the type to `KINDS`, `PALETTES` and the kind thresholds in `createHighwayTraffic`.
4. Audio: map the type in `audio-sources.js` (`v.isSUV ? 'suv' : 'sedan'`, `car.kind === 'suv'`). A new sound kind must also be added to the allowed list in `audio-synthesis.js`.

A bus-like type with its own meshes also needs: its own instanced meshes and state attribute, inclusion in the zero-init lists (`carInstances`/`busInstances`), `syncInst` calls, a `renderX`, and a lights spec with `headlight` and `zFront`.

**New pedestrian behaviour**: add state to the `peds` initializer, reset it in `spawnPed` (and in `endConversation` if it is social), implement it in `walk()`/`meet()`, and set the facing in `renderPed`. The rig animates purely from x/z deltas plus heading (and `air` for jumps), so just move the pedestrian. Anyone standing or walking on a crosswalk must be in `n.walkers`, because drivers yield through `pedestrianOn`. Curb queues use `n.curb` (`atCurb`/`gatherCurbs`); stepping off is governed by `mayCross`. If you change walking-surface heights in `pedGround`, update the copy in `audio-sources.js`. New track kinds in `pedestrian-routes.js` must carry `ax, az, ux, uz, len, node, side, group, line, from, to`. Sidewalk tracks also carry `edge` and `block`, which the rest and meeting logic checks.
