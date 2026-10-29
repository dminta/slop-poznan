# Actors: traffic, pedestrians, vehicle models and lights

## Map (who owns what)
- `js/traffic.js` exports `createTrafficSystem`, which covers the road graph: cars, buses, **all pedestrian behaviour** (spawning, walking, crosswalk rules, queues, conversations), collision sparks and the pooled vehicle lights. (The Manhattan port's separate ambient highway traffic, `createHighwayTraffic`, was removed: Poznań has no lanes outside the road graph. It survives in the history up to commit c7cd0ca.)
- `js/pedestrians.js` is only the body: `PersonRig` (planted-foot gait + IK) and `PersonCrowd` (one instanced skinned draw per LOD). `controllers.js` also uses them for the player's pedestrian and the cyclist's rider.
- `js/pedestrian-routes.js` lazily builds and caches sidewalk tracks (`along(edge)`) and the corner links between them and the crosswalks (`next`). Junction links connect only points on the same block (`blockAt`). Crossing the road always goes through a crosswalk track.
- **Crosswalks** are laid out for the whole network when the routes are created (~50 ms): at most one per junction arm, never at shape nodes (bends), oriented along the arm road's `clx/clz`, centred on the `CROSSWALK` band of whichever of the arm's edges stops nearer the junction. An arm gets one only where (1) both ends reach a curb island (`blockAt`: sidewalk, median, tram island) within `CROSSWALK_REACH` (4 m, road-network.js) of the curb lines its edges' `half` puts there, the zebra then running on to that real curb (merged junction arms and divided roads are often narrower than the curb-to-curb gap), and the track 2 m onto it at both ends; (2) the walk is clear (`walkable`); (3) its zebra overlaps no other road's run (stop line to stop line, where cars queue); and (4) it overlaps no zebra kept before it, the arms with the longest road (`span`) first, so in a junction complex (the short links between the corners of a divided road or tram corridor) the outer approaches keep theirs and the inner ones give way. `crosswalks` (`{ node, side, group, ax, az, bx, bz` (the zebra's ends at the curbs)`, ux, uz` (out of the junction)`, span, tracks }`) is the one list road-paint.js paints its P-10 zebras from (via `trafficSystem.crosswalks`), so pedestrians never cross where no zebra is painted and no zebra lies where nobody crosses. `across(node)` returns that node's tracks. **Split crossings**: where a divided road's median or tram strip is no curb island (only the gap between its two roadways, separate edges with their own nodes), an end with no island in reach may stop at the strip instead: 3.2–14 m (`STRIP_MIN`/`STRIP_MAX`) up to the next roadway, which must run along this one (a crossing road across the scan means the corner, not a strip), and with no crossing road over the strip's midline for 15 m out of the junction (`STRIP_RUN`, which rules out the gap in the middle of a junction complex). The crosswalk is then kept only together with the one across the strip from it (another strip end, or an island end inside the strip, at most `STRIP_OFFSET` 12 m along the road, chosen mutually), as one group in the overlap pass; its track lands `STRIP_LAND` 1.6 m onto the strip (so the `KERB` queue stands at the curb) and `track.refuge[end]` lists the tracks `links()` walks on to over the strip, where people wait for the second roadway as at any curb. Each line walks over the strip to the nearest line across (crossed walks made their walkers wait for each other for good). **Tram strips**: `createPedestrianRoutes(network, blockAt, railClearance)` (traffic.js passes city-grid.js's) gives a strip end room to wait (`stand`) only where its curb and the 1.6 m behind it keep 2 m from every track centreline (the ~1.7 m a tram body sweeps, plus a person). A pair with no room at either end is no split crossing; where one end has room, the refuge from it to the cramped end carries `hold` (the crosswalk beyond): walkers wait at the roomy end, short of the rails, until `mayCross` holds for that crosswalk, then cross the tracks and the far roadway in one go (`p.through`: no stop at its curb), and nobody is spawned waiting at a cramped end (`track.cramped[end]`). Measured on the 8.2 × 5.7 km network (2026-10-28): 22 split crosswalks before, 12 after (5 pairs had no room either side, 4 crosswalks have a cramped end); 3310 → 3300 crosswalks. Measured on the furnished network: 1385 crosswalks (1899 tracks), 14 of them split (the Dworzec complex went from 0 to 2: one split crossing of Roosevelta); the rest of the arms end in the roadway, mostly inside junction complexes and along open squares with no curb island, or lost to overlaps. Streets outside the largest strongly connected set have no sidewalk tracks and so no crosswalks or zebras.
- `js/trams.js` is a third, separate system: trams on the `GEO.rail` track graph (section "Trams" below). `traffic.js` makes the cars and pedestrians give way to them and collides the player with them.
- `js/actor-models.js` holds the vehicle geometry and TSL materials (cars, bus, trams, and the player's helicopter). `js/vehicle-lights.js` holds the one headlight profile shared by street traffic, trams and the player's taxi.
- `main.js` calls `trafficSystem.update(dt, elapsed, cameraSystem.currentPos, activeEntity, activeMode, camera)`. The **focus is the camera position, not the player**. Consumers of the returned `cars`/`buses`/`peds`: `audio-sources.js` (reads `edge, x, z, speed, acc, driver.a, yaw, yawOffset, isPolice, isSUV, bus, wait, gap, leaderSpeed, conn, yielding`; for peds `placed, v, conversation, rig.feet`, plus track fields) and the `city-map.js` radar. Renaming these fields breaks those modules.

## Street simulation model
- The drivers are IDM + MOBIL-style lane changes. Parameters are `CAR_DRIVER`/`BUS_DRIVER` (`a, b, T, s0, aLat`), with per-vehicle desired speed `v0` = `desiredOn(v, edge)`: the driver's `pace` (cars 0.9–1.1 by `i % 5`, buses 0.7–0.8 by `i % 3`) times the edge's posted `limit` (`road-network.js`, OSM `maxspeed`; 50 km/h without one), at most the vehicle's `vmax` (cars 80, buses 50 km/h). `place()` and `leave()` set it per edge, and approaching the end of an edge a driver eases down to the next edge's `v0` like a bend (`vt` in `accelerate`). `aLat` sets bend speed through connector curves. `bendSpeed` caches a quarter-metre speed profile per curve and
  driver class: local curvature limits lateral acceleration, a backward pass reserves braking distance before tighter
  bends, and the next road limit caps the exit. A short sharp kink no longer makes a car crawl over a long connector. Traffic has no coasting or physics model. Knocks are a separate decaying `vx/vz` impulse applied by `shove()`, clamped to the road.
- Road graph fields used (from `road-network.js`): edge `sx,sz,dx,dz,rx,rz,len,lanes[]` (lateral offsets, `r` = right), `moves[{to, turn:'S'|'L'|'R', out[]}]` (`out[i]` = target lane or -1), `axis` (`'ave'` for major roads), `axisIndex` (signal group at `e.to`: 0 the widest road, 1+ the others, which share the second phase), `inSide/outSide`, `opposite`. Nodes provide `signal, in, out, groupCount, sideCount, hx, hz`. `connector(e,i,f,j)` and `curvePoint` give intersection curves. A node's sides are its arms, numbered from 0.
- Occupancy: `e.occ[lane]` holds pooled `{v, s}` entries sorted by `s`, and `buildOccupancy()` rebuilds them once per frame **before** driving. A vehicle inside an intersection is listed in its source lane at `e.len + cs` and in its target lane at negative `s`. A vehicle more than halfway through a lane change is in both lanes (`straddle`).
- Intersection counters (`n.box`, `n.crossing`, `e.through`, `e.lefts`) are reset only for nodes and edges registered through `touchNode`/`touchEdge`. A new per-node or per-edge counter must be incremented through those helpers or it never resets. `claim()` runs immediately inside `mayEnter`/`enter` so vehicles and pedestrians evaluated later in the same frame see the claim. Keep that ordering.
- Signals come from `signalPhase`/`walkSignal` in `city-config.js`, the same clock `street-details.js` renders. A phase is `'green'`, `'amber'`, `'red'` or `'redAmber'` (the Polish red+amber, the last `SIGNAL_TIMING.redAmber` 2 s of the red): `mayEnter`, `signalAhead`, `yieldOncoming` and the trams treat `'redAmber'` as red, and any code that tests for `'red'` must test for it too. `phaseOf(e)` picks the phase by `e.axisIndex`. Pedestrians crossing a group-0 road use their node plan's `walk1`, the others `walk0`. At unsignalised crosswalks they always have the WALK: vehicles yield to them through `pedestrianOn`, and they step off once no vehicle holds the crosswalk or can no longer stop. `laneCoord(e, i, arm)` and the walkers' `p.coord` both measure along the arm's crosswalk axis. Drivers find the crosswalks from the stop line: the one ahead starts `e.setbackTo` into the connector and is `CROSSWALK` deep, the one on the way out ends `f.setbackFrom` before the connector's end; a car turning in to wait for walkers stops `shortOfZebra(f)` (0.5 m to spare) before the end.
- **Why a car waits**: `accelerate` records the binding term in `v.waitReason` (like a tram's): `'car'` (the vehicle ahead, `v.leader`; a tram proxy's `leader.tram` is the tram), why `mayEnter` refused (`v.held`, set through `refuse()`: `'signal'`, `'box'`, `'tram'`, `'turner'`, `'bus'`, `'oncoming'`, `'crossing'`, `'pedestrian'`, `'room'`, `'merge'`, `'lane'`), `'signal'` (a red beyond), `'merge'`, `'turn'` (waiting inside to turn), `'pedestrian'` (inside, for walkers on its way out), `'player'` or `''`. Nothing in the app reads them; `tools/bench-traffic.mjs` does.
- **Pedestrian courtesy** at unsignalised zebras: walkers have the right of way and step off whenever the car at the line can stop, which it always can, so a steady trickle of walkers held a car for good. `v.pedWait` counts the seconds a car stands with `waitReason 'pedestrian'` (kept while it stands for anything else, reset once it moves); past `PED_COURTESY` (5 s) its turn has come: `buildOccupancy` calls `courtesy(v)`, which raises `n.crossing` for the crosswalks it passes, so people at the curb wait (`mayCross`), and `mayEnter` passes `onIt` to `pedestrianOn`, so the car ignores them and waits only for those already on the zebra. The car behind starts its own count at the line. Not at signals (the WALK decides there).
- Routing is random per edge (`chooseMove`): straight-biased, buses strongly straight and avoiding single-lane turns. Routes deliberately do **not** steer toward the camera. Recycling keeps the population local (the old drift-to-focus weighting was removed).
- **Police** (`isPolice`, set on every emergency vehicle: Policja, ambulances, fire service) ignore red/amber in `signalAhead` and `mayEnter`, but still wait for `boxBusy`, pedestrians, a free exit (`room`/`alongside`/`mergingAhead`) and cross traffic: at a non-green signal `yieldToCrossTraffic` applies to them, and `cautious` caps their approach at 5 m/s. Other drivers turning left count oncoming police as traffic even at red (`yieldOncoming`). `tests/traffic.test.cjs` pins all of this.
- The vehicle mix is deterministic by index in the `NUM_CARS` loop, over five body classes (`BODY_SPECS` in actor-models.js; generic class proportions only, no brands, badges or signature grilles):

  | `bodyType` | class | L × W × H, wheelbase | cars (of 200) |
  |---|---|---|---|
  | `taxi` | Corolla-class saloon with the roof TAXI lamp (spec `saloon` + `sign`) | 4.60 × 1.78 × 1.44 m, 2.70 m | 24 |
  | `hatch` | Golf / Fabia / Yaris-class hatchback | 4.24 × 1.78 × 1.47 m, 2.60 m | 64 |
  | `estate` | Octavia-class kombi; also the Policja car | 4.68 × 1.82 × 1.47 m, 2.69 m | 38 + 5 Policja |
  | `crossover` | Sportage / Duster-class compact SUV | 4.46 × 1.85 × 1.66 m, 2.68 m | 45 |
  | `van` | Ducato / Sprinter / Crafter-class high-roof panel van; also PRM and PSP | 5.60 × 2.02 × 2.50 m, 3.44 m | 18 + 4 PRM + 2 PSP |

  Emergency vehicles carry `livery` (written to `carState.w`, painted by `createLoftedCarMaterial`) plus a blue light-bar instance (one light-bar mesh per body that carries them, `lightbars[bodyType]`: estate and van): Policja `i % 40 === 6` (estate, livery 1), PRM ambulance `i % 50 === 18` (van, 2), PSP light rescue van `i % 100 === 42` (van, 3). Then taxi `i % 8 === 0` (the livery wins at 168; ordinary paint: Polish taxis are any colour; the `sign` body has the roof TAXI lamp and the side chequer strip). The other cars take `PRIVATE_MIX` (hatch 38%, estate 24%, crossover 28%, van 10%) by a plastic-number sequence of the index. Paint is picked from `carPalette` (mostly greys, whites, blacks and silvers, weighted by repeats) or `vanPalette` (mostly white) by a golden-ratio hash of the index (`i % length` would hit only part of a palette). `isSUV` (crossover and van) still selects the bigger engine sound and the heavier push. Each car's size comes from `carDimensions(spec)`: `half`, `halfWidth` (− 3 cm), `axle`, the player collision box `hitW`/`hitL`, the contact-shadow scale `shadowW`/`shadowL` and the light bar's point-light place `barY`/`barZ` (`lightbarPlacement`).
- **Plates**: every car has its own made-up EU registration, `polishRegistration(i + 1)` (actor-models.js): district `PO` 55%, `PZ` 30%, `PY` 15% (Poznań city's two series and the county), then a five-character individual part in one of the Polish two-letter-district layouts (`12345`, `1234A`, `123AB`, `1A234`, `1AB23`, `A1234`, `AB123`; letters without B, D, I, O, Z). `encodeRegistration` packs its seven glyphs into the per-instance `plateCode` vec4 (two 32-cell atlas indices per component, exact in float32), which `renderCar` writes with the paint (both flagged through `dirtyPaint`). The material paints the white plate with the blue EU strip front and rear from one glyph-atlas sample (`plateColor`, shared with the bus, whose fleet shares one registration); the rear plate has the round registration sticker in the gap. The fixed-colour variant (the player's taxi, the wheels) paints blank plates. There are 12 buses (`NUM_BUSES`) in MPK livery, each with a fixed `route` (row of `BUS_ROUTES`, the amber LED destination sign, read from `busState.w`), and they spawn only on `e.major` edges (`road-network.js` `isMajorRoad`: ≥ 14.5 m curb to curb or ≥ 3 travel lanes, or on a named road that is major over most of its length). Instance buffers and the lightbar mesh are sized from the counts, so changing the mix resizes them.

## Population around the camera (spawn/despawn)
- Pools have a fixed size, and nothing is created or destroyed. **Only as many vehicles drive as the lanes around the focus carry at `VEHICLE_DENSITY`** (12 per km of lane, both ways counted, at least `MIN_VEHICLES` 30, at most the pool of 212): `refreshNear` sums the lane length within `NEAR_RADIUS` (`nearLanes`) and sets `nearTarget`. A vehicle retired beyond `VEHICLE_RADIUS` is placed again only while fewer than that drive; otherwise it is parked (`park()`: no edge, moved to 1e6 so the radar draws no stale blip; everything that reads `cars` skips `!v.edge` or draws off-map). A camera jump parks the excess at once. Until 2026-10 the whole pool filled whatever the network: the sparse single-lane grids (2.9–5 lane-km within 350 m at Wilda, Łazarz, Jeżyce, Stare Miasto) carried 40–70 vehicles per lane-km, a jam, and 62% of the cars stood even with no pedestrians, trams or signals (`tools/bench-traffic.mjs --no-peds --no-trams`). Now 28–80 vehicles drive within 300 m (37 at Stare Miasto, 61 at Kaponiera, 79 at Rataje). A rotating cursor scans the pool each frame with an **attempt** budget (4 vehicles, 6 pedestrians), so awkward spots can't monopolize a frame.
- Actors are retired beyond `VEHICLE_RADIUS` 380 m / `PED_RADIUS` 320 m **even when visible**: keeping them starves the streets ahead during travel. Replacements are placed 100–350 m away (pedestrians 60–280 m). A placement is rejected when it is in the frustum and within `VEHICLE_SPAWN_DISTANCE` 250 m (`PED_SPAWN_DISTANCE` 150 m) of the camera (`nearView`), within 25 m (pedestrians 10 m) of the player, or (vehicles) in a lane that isn't clear (`laneClear`).
- A camera jump of more than 140 m in one frame (a teleport, or the first frame) respawns everything beyond `NEAR_RADIUS` anywhere within 0–350 m with no view protection.
- `refreshNear()` selects edges by their nearest point to the focus (not the midpoint), and spawn `s` is limited to the local section of long roads. It refreshes only after the focus moves 40 m.
- Pedestrians flagged `crossesStreets` (every sixth) try crosswalks for 5 attempts, then fall back to sidewalks. They start at the curb of a random crosswalk of a random junction in `nearCrossings` (`refreshNear`: the `crossingNodes` within `NEAR_RADIUS`, every junction with a crosswalk, signalised or not; 1517 on the furnished network of the 8.2 × 5.7 km box, 285 of them signalised, so 2762 of the 3310 zebras are unsignalised; 695, 129 and 1170 of 1385 on the 6.1 × 3.7 km box before the crosswalk ports). Until 2026-10 only signal nodes were used, so unsignalised zebras got crossers only from people walking up to them. Their effect on traffic, measured headless on 2026-10-28 (8.2 × 5.7 km network, 5 simulated minutes at each of Stare Miasto, Jeżyce, Łazarz, Wilda and Centrum, cars within 300 m sampled every second): with crossers at the unsignalised zebras (and cars yielding to them) the mean car speed was 4.7 km/h, 65.1% of samples stopped, the longest stopped queue in a lane 34 cars, the longest wait 261 s and 110 cars held over 120 s; with neither (crossers spawned only at signals, `pedestrianOn` false at unsignalised nodes) 4.8 km/h, 65.2%, 34, 248 s and 154. The crossers cost nothing measurable then, as the gridlock dominated (see "Gridlock" below); with it gone they are the root of 10–30% of stopped cars at give-way zebras, which the courtesy rule above bounds. Spawning a pedestrian ends its conversation and sets `rig.placed = false`. Separately, `PersonRig.update` resets the rig whenever it moves more than 3 m in a frame.

## Gridlock (Phase 15.6) and what is left
Measured with `tools/bench-traffic.mjs` (5 simulated minutes per district, seed 4242, the furnished 8.2 × 5.7 km network
after the rail-crossings merge; cars within 300 m sampled every second; "held" = cars that stood over 120 s at once):

| District | cars before → after | mean km/h | moving km/h | stopped | longest queue | wait p90 / max s | held > 120 s | deadlocks |
|---|---|---|---|---|---|---|---|---|
| Jeżyce (Rynek Jeżycki) | 180 → 51 | 4.9 → 11.0 | 14.9 → 21.7 | 67.3% → 49.7% | 15 → 6 | 48 / 199 → 30 / 84 | 39 → 16 | 2 → 0 |
| Łazarz (Głogowska) | 183 → 33 | 3.7 → 11.3 | 11.3 → 18.1 | 68.1% → 38.2% | 17 → 11 | 37 / 104 → 15 / 47 | 1 → 0 | 0 → 0 |
| Centrum (Św. Marcin) | 191 → 55 | 4.1 → 9.4 | 14.4 → 19.4 | 72.3% → 51.7% | 15 → 9 | 62 / 157 → 53 / 91 | 27 → 8 | 1 → 0 |
| Rondo Kaponiera | 169 → 60 | 5.2 → 10.7 | 18.8 → 24.8 | 72.5% → 56.8% | 11 → 5 | 57 / 147 → 53 / 131 | 35 → 9 | 0 → 0 |
| Stare Miasto | 143 → 37 | 7.4 → 17.7 | 13.0 → 19.1 | 43.6% → 7.3% | 14 → 3 | 19 / 47 → 9 / 18 | 0 → 0 | 0 → 0 |
| Rataje (Rondo Rataje) | 195 → 81 | 6.5 → 11.8 | 19.4 → 24.8 | 66.5% → 52.3% | 8 → 5 | 52 / 117 → 41 / 141 | 7 → 2 | 0 → 0 |
| Wilda | 173 → 28 | 3.3 → 10.5 | 12.9 → 23.6 | 75.1% → 55.9% | 36 → 11 | 57 / 151 → 53 / 82 | 6 → 0 | 0 → 0 |
| all | | 5.0 → 11.6 | 14.9 → 21.7 | 67.1% → 46.7% | 36 → 11 | 52 / 199 → 43 / 141 | 115 → 35 | 3 → 0 |

Root causes found and fixed: jam density from a full pool on sparse networks (`VEHICLE_DENSITY`, above); bends treated
as junctions (road-network.js step 7, docs/world.md); trams holding junction curves ahead while they could not go;
trams and pedestrians waiting for each other at the rails; a trickle of walkers starving a car at a zebra (courtesy);
cycles found: 6 cars and trams at (-1863, -391) and 3 around a car stuck in the (-986, 161) box behind a tram, both gone.
Phase 16 replaces the global clock with `node.signalTiming` (shared with `SIGNAL_SITES[].timing`).
`updateSignal(time, node)` caches both vehicle groups and WALK/display states once per plan and time. Traffic updates
its signal nodes once per frame, and cars read `phaseOf(e)`. Plan splits use inbound lanes and width; minor and compact
junctions start with 44 s cycles, arterials 60 or 76 s. After walking routes are built, each group's minimum green
also allows the last WALK entrant to cross the full width at 1 m/s before opposing traffic starts; a cycle grows only
when both minima cannot fit. Named corridor signals share 60 s cycles (65 s on Św. Marcin) and offsets from road
distance at 40 km/h; other offsets are deterministic. Each transition has 3 s amber followed by 2 s clearance
including the next group's red+amber. WALK admits new entrants for 7 s, then displays flashing green for 3 s.
Two-arm nodes with crossings stay road-green until a walker requests a phase (2 s request delay, at least 20 s road
green); their red clearance allows a 1 m/s walker to finish the measured crossing. Nodes without crossings are disabled.
The furnished graph has 311 regular plans, 22 demand crossings and 12 disabled signals (2026-10-29).

`boxBusy` refines coarse group counts against each holder's remaining swept connector, including the rear and rigid
body curvature allowance; it keeps zebra and exit occupancy claims. This breaks the Jeżyce car–tram–car cycle where
an already disjoint turn owned the box until a far stop line. Path/width/body-length pairs are cached, and repeated
frames reuse their geometry.

Pedestrians wait at least 2 m normal to the rails at any crossing angle. The tram's 1.2 m half-body plus the
world-aligned person's 0.71 m diagonal and 0.05 m margin exceeded the old 1.8 m waiting clearance on diagonal
streets. Two trams could therefore brake for people waiting safely before the other track and hold each other.
The waiting distance and tram obstacle envelope are regression-tested together.

Exit reservations use one transitive approach order and the same `mergeFirst` order within an approach. Uncommitted
red-light approaches do not reserve an empty exit against green traffic. `mergeArrival` records arrival within 2 m
of the line, so a later vehicle stopping a few centimetres farther forward cannot starve a neighbouring lane.

Trams reserve space for their full length plus 2 m beyond switches, track crossings, mapped road/mainline crossings
and occupied platforms. A tram already inside continues through. A tram held before entry records `waitReason: 'room'`
and its downstream `leader`; conflicting approaches can pass it. Actual switch conflicts retain `'switch'`.
Stationary dwelling/red/obstacle-held trams do not claim future switch approaches; their actual body occupancy still
blocks the conflict. Switch/block contenders retain their ordering. Car-curve reservations of a stationary held
tram end at its nose; moving trams keep the approach lookahead. This avoids a 2 m phantom claim beyond a safe gate.
The benchmark follows both `'tram'` and `'room'` leaders, so a reservation cannot hide a deadlock. The opposite-track
lane at Rynek Jeżycki is corrected before connectors and road paint are built (see `world.md`). Passing a waiting
left-turner on a wide single-lane approach remains optional work.

Final Phase 16 benchmark (7 districts × 5 minutes, seed 4242): 15.6 km/h mean, 32.0% stopped, no car held over 120 s,
no persistent deadlocks and no continuous `switch` wait over 60 s (maximum 39.6 s). Before Phase 16: 11.6 km/h,
46.7% stopped, 35 cars held over 120 s and one >60 s switch hold. The longest car hold is now 117 s. The
`--no-signals` comparison is 18.5 km/h / 23.4% stopped. Full measurements and browser limitations are in
`poznan-plan.md`, Phase 16.


## Player interaction
- `player.active` is false in the helicopter or when the entity is at y >= 2.6. Mode-specific `halfW/halfL/push` values are set in `update()`. Drivers treat the player as a leader (`playerGap`), and lane changes avoid the player.
- `collideWithPlayer` uses a SAT OBB test. The extents are the car's `hitW`/`hitL` (from its body spec) or the bus's literals in the call in `update()`, and the mass ratio is set in `collideWithPlayer`. `reportCollision` fires synchronously with a **reused** event object, so listeners (audio) must copy any field they keep.

## Performance patterns (keep them when editing)
- Instance slots are handed out every frame only to actors that `visible()` passes. `visible()` tests side planes only; the margin radii are car 18, bus 22, pedestrian 7, to cover shadows and beams. Every instanced mesh has `frustumCulled = false`. Cars within `CAR_PROXY_DISTANCE` (90 m from the focus) get the full body plus separate wheel instances; farther cars get the ~460–510-triangle proxy with built-in wheels (the full bodies are 2.9–3.0k triangles without wheels). That is two body meshes per class: 10 car body meshes (the US mix had 6), plus 2 wheel, 2 light-bar and 1 contact-shadow mesh; empty meshes are hidden after warm-up.
- Upload only the used prefix: `flagRange(attr, n)` calls `clearUpdateRanges` + `addUpdateRange(0, n*itemSize)`. Paint is stored as `Math.fround` floats and lamp state is compared against the buffer; the paint/state attributes are flagged only when they change (`dirtyPaint`/`dirtyState`).
- Empty meshes are hidden after 2 updates (`hideEmpty`). For the first two frames they keep one zero-scale instance so `main.js` shader precompile and the warm-up frame compile them. Copy this pattern for any new instanced mesh. Idle sparks write and upload nothing.
- Pedestrians: every rig's gait advances every frame. `renderPed` passes `updatePose = draw`, so hidden rigs skip `solve()`, and only drawn rigs are copied into `PersonCrowd` (far LOD beyond 34 m from the focus). Feet and gait stay identical to an always-solved rig.
- Lights come from fixed pools: 96 headlight spots (2 per vehicle) plus 6 blue emergency point lights. Lit vehicles are sorted by an effective distance that penalizes positions behind the camera. Unused lights are parked at y = -1000 with intensity 0. Never add or remove lights at runtime (clustered lighting). The beam fades in from `cityUniforms.uInteriorGlow`. `DUAL_BEAM_*` are unused leftovers.
- `tests/traffic-performance.test.cjs` budgets are **exact write/upload counts, not timings**: idle sparks produce 0 matrix writes and 0 uploads after warm-up, frames 1–2 keep exactly one degenerate visible instance, the live-spark update range is `count * 16` floats, and `renderPed` adds to the crowd only when drawn.
- `tools/benchmark-pedestrians.mjs` (usage in [`testing.md`](testing.md)) is the correctness check after `PersonRig` changes; it string-replaces `if (updatePose) this.solve();`, so keep that exact text.

## Test-harness coupling (gotcha)
`traffic.test.cjs` and `traffic-performance.test.cjs` extract inner functions of `traffic.js` by regex: from a line starting `  function name(` up to the first line that is exactly `  }`. They then run each function in a `vm` with a hand-written context of its free variables. `traffic.test.cjs` also cuts out `courtesy` and runs `mayEnter` with its own context (the courtesy test). The extracted functions are `mayEnter, signalAhead, canStop, yieldToCrossTraffic, yieldOncoming, nearView, refreshNear, spawnVehicle, spawnPed, renderPed, updateSparks, flagRange, occupyTrams, tramBlocks, inTramLane, overlapWithPlayer, collideWithTram, tramRoom, tramCrossings, tramNear` (`mayEnter` needs `tramBlocks`, `refuse` and `PED_COURTESY`; `spawnVehicle` a `nearTram` stub; `refreshNear` `vehicles`, `VEHICLE_DENSITY` and `MIN_VEHICLES`). Keep them as 2-space-indented `function` declarations. When a change adds a free variable or helper to one of them, add a stub to the matching test context.

## Trams (`js/trams.js`)
`createTramSystem(scene, { network, rail = GEO.rail, stops = GEO.tramStops, routes = GEO.tramRoutes, traffic })` is built in `main.js` after
the road paint, and `update(dt, elapsed, focus, camera, playerEntity, activeMode)` runs before the street traffic. It
reads the road network (signal nodes, lanes and junction curves for `mapTramsToRoads`) and, read-only,
`traffic.cars`/`traffic.buses` (`edge, x, z, yaw, yawOffset, half, halfWidth, tx, tz, speed, vx, vz`) and
`traffic.peds` (`placed, x, z, ux, uz, dir, v`) to brake for them; `traffic.js` does the yielding (see "Interactions" below).

- **Track graph** (`buildTrackGraph`, pure). Tram chains become directed edges. One-way chains run one way. A two-way
  chain that runs parallel to another tram track 1.8–6.5 m away is one track of a double-track pair (OSM rarely tags
  them oneway), so it gets the direction that keeps its neighbour on the left (right-hand running). The rest stay
  two-way and form single-track blocks (`run`/`runDir`): a tram enters a block only while nobody runs the other way in
  it. At a node a tram may continue onto an out-edge whose start tangent is within `SWITCH_TURN` (38°) of its end
  tangent; the branch is chosen when the path is extended (see **Lines**). Edges carry `routes` (the chain's
  `GEO.rail[i].routes`), `vmax[]` (curve limit from
  `aLat` 0.9 m/s²), `crossings[]` (level crossings that aren't cut into nodes), `foulStart`/`foulEnd` (clearance points:
  how far the track stays within 2.9 m of the other tracks at a node), `endPad` (buffer stops on a stub that ends on
  another track), `stops[]` and `signals[]`.
- **Lines**: every tram runs one route of `GEO.tramRoutes` (OSM `route=tram`, one per direction: `ref` and the
  terminus `to`; docs/geodata.md), picked at random from the routes using the edge it spawns on; with routes in the data
  it never spawns on track no route uses. `TramPath.route` steers `pickBranch`: at a switch it takes at random a branch
  the route uses, else one that reaches the route within `ROUTE_REJOIN` (2) switches (short connecting pieces the
  relations leave out), else one some line runs on (not a siding or loop stub no route uses), else any. A longer
  lookahead (3 or 4 switches) rejoins nothing more. Laying out the track behind a new tram keeps to the route the same way. Where the
  route ends in the box (a terminus loop past the last stop, Zawady), `turnRoute` switches to the same line's route on
  the next edge (usually the other direction) and the tram's display changes; where the route stops for good on track
  other lines use (a relation gap no rejoin spans: line 10 at (-850, 768), lines 7 and 8 at (-845, 9)), it takes the
  route of that track, as a diverted tram would. Measured on the Poznań network: 98.6% of paths laid out from every
  route edge stay on the route. A headless run (10 minutes at each of Ostrów Tumski, Stare Miasto, Dworzec, Półwiejska,
  Rataje and Jeżyce on the 8.2 × 5.7 km network, 84k tram samples) had 1.15% of samples off their route, 0.77% of them
  on other lines' track (line 10 past its relation's gap, wandering on under its number) and 0.38% on track no route
  uses; now 0.44%, 0.06% on other lines' track. The rest is data: Zawady's terminus loop (#655, #509, #528 behind
  line 5's last stop) is in no relation. Lines run the real
  sequence of tracks only roughly: no timetable, any number of trams per line.
- **Stops**: `tram-infra.js` stops (`railIndex`, `s`, `dir`) are attached to the edge running that way
  (`attachTramStops`). Bare `GEO.tramStops` nodes are snapped to the nearest track within 6 m (`snapTramStops`); that
  fallback is used by the tests. The tram's front stops `0.35 × length` past the stop point, dwells 20–30 s with its
  doors open, then departs.
- **Signals** (`findTrackSignals`): every `n.signal` road node within 9 m of a track puts a stop line on that edge, as
  far out as the stop line of the road arm the tram arrives along (the in-edge within 60° of the track tangent 12 m
  before the junction). Its group is that arm's (`axisIndex === 0` → group 0), else the group the roads don't use.
  The phase is `signalPhase(elapsed, group === 0, node)` from `city-config.js`, the same local plan the cars and
  heads use. Trams stop on red and red+amber, and on amber when they can stop at 3 m/s². The effective stop line
  moves upstream over a protected complex when the whole body cannot fit between its crossings. Entry on green is
  recorded in a fixed pool: a later red at an interior head allows the tram to finish clearing that complex. A
  boarding dwell clears that commitment before the next departure.
- **Driving**: IDM (`TRAM_DRIVER`: a 1.15, b 1.4, T 1.6 s, s0 3 m; 50 km/h street-running, 65 km/h segregated, ×0.9–1.0
  per tram; a street track also keeps to the lowest posted `limit` of the car lanes it runs along for 10 m or more,
  `te.roadLimit` from `mapTramsToRoads`, and eases down to a lower limit ahead like a curve). The acceleration is the minimum over the free road, trams ahead on the path (their rear, minus the
  clearance point while it is still on another branch; head-on on two-way track counts as stopped), switches, crossings
  and blocks another tram holds or reaches first, the next stop, red signals, curves and a buffer stop. `waitReason`
  names the binding one (`tram`, `room`, `switch`, `block`, `stop`, `signal`, `curve`, `end`, or empty).
- **Population**: 24 pooled trams (every third is a Tramino), kept within 900 m of the camera focus and respawned
  120–800 m away, never within 300 m in view or 70 m from another tram. After a camera jump of more than 140 m they are
  all respawned. A tram waiting at a buffer stop is respawned after 8 s out of view (40 s in view). A tram stopped
  90 s out of view (240 s in view) is respawned too; that also clears rare head-on deadlocks.
- **Bodies**: `TRAM_MODELS` in `trams.js` (Moderus Gamma, 3 sections; Solaris Tramino, 5; both 31.8 m). Each section
  lies on the chord between its two ends on the path (`poseSections`), so the joints stay on the track. Section kinds
  map to one `InstancedMesh` each (`buildTramSectionGeometry` in `actor-models.js`), plus the bellows. All of them use
  `createTramMaterial` with the per-vertex `tramInfo` (half length, cab ±1/0, door z) and the per-instance `tramState`
  (brake, livery 0 Gamma / 1 Tramino, doors open, display row = route + 1). The amber LED display above each cab's windscreen samples that row of `createTramDestinationTexture(GEO.tramRoutes)` (actor-models.js; line number, then the terminus; row 0 blank), mirrored per cab so it reads left to right from outside (not yet checked in a browser). The pantograph head is at `TRAM_PANTOGRAPH_HEAD` (5.5 m).
  Culling: the whole tram is tested against the frustum side planes (radius half its length + 6 m) and dropped beyond
  1.5 km. The upload, `hideEmpty` and zero-scale first-frames patterns are the same as for traffic. Per-frame code is
  allocation-free apart from refreshing the `trams` list.
- **Lights**: `tramLightSpec(cabLength)` in `vehicle-lights.js` gives `headlight`/`zFront`. A pool of 8 spots lights
  the 4 nearest trams in view, placed with the front section's matrix.

**Public contract for interactions** (car yielding, pedestrians, player collisions, audio):
- `tramSystem.trams`: the active trams, refreshed every update (the same objects as `tramSystem.pool`, filtered).
  Each has `id`, `model` (`'gamma'|'tramino'`), `spec` (its `TRAM_MODELS` entry), `length`, `x, z, heading` (the
  track point and tangent at mid-length), `frontX, frontZ`, `speed` (m/s), `acc`, `v0`, `atStop`, `stopName`, `dwell`,
  `doorsOpen`, `nextStop`, `waitReason`, `leader`, `gap`, `route` (its `GEO.tramRoutes` index, -1 for none), `line`
  (the line number, e.g. `'17'`) and `destination` (the terminus, e.g. `'Starołęka PKM'`; both `''` without a route),
  and `sections: [{ x, z, heading, halfLength, halfWidth, fx,
  fz, rx, rz }]`. These are world-space OBBs (centre, heading, half extents; `fx/fz`, `rx/rz` are the body's front and
  rear ends), front to rear. Use them for SAT tests. They are rewritten in place every frame, so copy any value you
  keep.
- `tram.path` (`TramPath`): `edges[0..n-1]`, `start[]` (path coordinate of each edge's start), `u` (the front's path
  coordinate), `end` (a dead end's path coordinate, or Infinity), `indexAt(u)`, `pointAt(u, out)` → `{ x, z, tx, tz }`.
  The tram's body covers path coordinates `[u - length, u]`. `tram.occN/occEdge/occS0/occS1` list the track edges under
  the body with local `[s0, s1]`, updated before driving.
- `tramSystem.graph` (`{ nodes, edges, runs }`), `tramSystem.stops`, `tramSystem.signals` (`{ node, edge, s, group }`,
  where `node` is the road-network node), `tramSystem.routes` (`GEO.tramRoutes`) and `tramSystem.models`.
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
  `TRAM_REACH` 70 m) and stands still, so cars stop short of the track. A tram standing held by anything but a curve
  (at a stop, a red, behind another tram, at a switch, for a car) reaches only 2 m past its front, lanes and junction
  curves alike: holding the curves ahead of a tram that can't go kept the cars of a green approach waiting, and at a
  busy tram junction (Most Teatralny) cars waited 240 s through green and red. The reach never covers a car already there
  (it ends 0.3 m short of it; a crossing with a car on it gets no proxy). Junction curves within the same reach are
  marked `held = tramFrame, by = tram`; `mayEnter` refuses a held curve through `tramBlocks(v, n, f, j)`, except for
  the car the tram waits for (`tram.obstacle`), a car right in front of the front, or one ahead in a lane the tram
  runs along (`inTramLane`). While a tram waits for a car (`waitReason 'car'`) it holds only what its body is over.
  `spawnVehicle` rejects places within 3 m of a tram body (`nearTram`); tram spawns reject track with a car on it.
- **Trams brake** (`drive()`): the path ahead is sampled every 2 m up to the braking distance + 12 m (≤ 70 m); cars,
  buses and the player whose OBB reaches into that swept corridor are IDM leaders at their speed along the track
  (`waitReason 'car'` / `'player'`), and so are pedestrians within `TRAM_HALF_WIDTH + PED_REACH` (1.7–1.9 m) of the centreline (`traffic.peds`, `'pedestrian'`, no bell). Bodies already beside the tram (gap < -1 m) are collisions, not leaders. Cars
  facing the tram are ignored: where a lane runs against the track a car can't back out, so waiting would deadlock (the
  proxies keep cars out of the tram's way there instead). A headless 10-minute run on the real network: no car or
  pedestrian overlapping a tram body after the first frame (3665 / 49 overlap samples without the interactions), no
  tram held 90 s.
- **Pedestrians** (`tramRoom(p)` in `walk()`): each walking track caches `route.tramCrossings` (where it crosses a
  track, and how far along it the tram body reaches, `1.8 m / sin(angle)`); a pedestrian stops short of the next
  crossing while `tramNear` finds a tram body over it or a front due within `PED_TRAM_TIME` 6 s, but not a tram standing
  short of it waiting for pedestrians (`waitReason 'pedestrian'`): someone stopped 1.8 m off the rails is inside the
  tram's 1.7–1.96 m envelope, so both waited for each other until the tram was respawned after 90 s (seen at Rynek
  Jeżycki, Św. Marcin, Most Dworcowy). Anyone already on the
  rails walks on. Standing on a crosswalk keeps them in `n.walkers`, so cars wait for them. A stop short of one track that lies within the reach of another (between the two tracks of a line) moves back short of that one, or, once on it, p walks on. Walking on the rails (`onRails`: within a crossing's reach) p ignores the queue ahead and closes up rather than stand in a tram's way. Measured headless (3 min at each of six tram-strip crossings): pedestrians standing within 1.7 m of a track 10,439 → 0 samples, inside a tram body 6261 → 0–47 (people already on the rails walking past a tram stopped beside them).
- **Player** (`collideWithTram(t)` after the cars in `update()`): SAT (`overlapWithPlayer`) against every section OBB.
  The tram is immovable: the player takes the whole push, loses speed (up to 75% head-on) and, in the car, gets a
  bus-sized knock; a crash is reported with `b` = the tram (no `type`), not for a pedestrian.

## Vehicle lights and turn-signal conventions
- Model space: +Z is forward and **+X is the vehicle's left**. `carState` (vec4) = (brake, left/+x signal, right/−x signal, livery 0 none / 1 Policja / 2 ambulance / 3 fire). `busState` uses the same first three, and `.w` is the bus's route (destination sign row; the sign mesh shares the attribute). `v.blink < 0` means left. `pose()` sets the blink from a lane change (sign of `dl`) or from a planned turn within 35 m of the edge end or inside the connector. The flash period is 0.8 s, offset per vehicle by `blinkPhase`. Brake lights on street traffic come on at `acc < -0.8 || speed < 0.3`. The player's taxi uses the fixed-colour material variant and drives `material.userData.carState` from `controllers.js`. It is silver, and `createCarEntity` lays its own meshes over the body material's taxi marking and blank plates: a side stripe across both doors (y 0.55–0.71 m, one canvas per side, covering the chequer strip, badge and side number) and 520 × 114 mm Polish plates on holders larger than the painted plates, so those stay hidden whatever `actor-models.js` paints there.
- Lamps are painted by the TSL material from spec numbers: `headlight`/`taillight` = [centre |x|, y, half-width, half-height]. The front turn signal is the outer ~30% of the headlight. The rear turn signal is the **outer** section of the tail lens (fixed in 168c3a4; it used to be inner) and reverse is the opposite end. When `tlH > tlW` (crossover, van) the sections stack vertically, so the turn signal is the top section.
- Add new body specs inside `BODY_SPECS` (taxi is `Object.assign` of saloon). Optional spec keys: `sideGlassRear` (side glass panelled over behind this z: the hatch's and crossover's thick rear pillar, the van's cargo box), `glassTop` (no glass above this y: the van's high roof), `backlight: false` (no rear window), `panelVan` (door seams, split rear doors, PRM/PSP rear chevrons and a high stop lamp on the upper body), `band` (livery band [y0, y1]), `letterZ` (livery lettering centre), `barT` (light bar position along the roof). `tests/vehicle-models.test.cjs` pins the class dimensions, the plate layouts and the plates' clearance from bumpers and lamps.
- `placeVehicleHeadlight(spot, spec, side, matrix)` uses `spec.headlight[0..1]` and `zFront + noseOffset`, and resets local coordinates on every call (pooled reuse). Always pass the **rendered body matrix**: streets compose pitch / `yaw + yawOffset` / roll, so beams follow slopes and impacts. The player passes no matrix and parents the spots to `chassisPivot`. `BUS_SPEC.headlight` is the midpoint of the white lamp pair, excluding the amber indicator.
- Invariants tested in `vehicle-lights.test.cjs`: spots are unshadowed with no `map`/`colorNode`; the whole cone stays below the chassis horizon, so `HEADLIGHTS.pitch` must stay greater than `angle`, accounting for toe-out. The test's spec fixtures are copies (saloon and van numbers), not `BODY_SPECS`.

## Physics and coasting parameters (player vehicles, `controllers.js`)
- Traffic AI speed is IDM only. Player car and bicycle speed comes from `driveSpeed()` with `CAR_DRIVE`/`BICYCLE_DRIVE`. `rolling` and `drag` apply **always, including under throttle** (powered speed is built on the coasted value). `coast` applies only with no throttle. `brake × |throttle|` applies only when throttle opposes the speed.
- To change how fast a released vehicle slows, tune `coast`. History: f3132b6 separated coasting from braking; 039a327 lowered `rolling`/`drag` and was reverted (35c183e); 0e92315 then added `coast` instead.
- `driveLoad()` in `audio-sources.js` mirrors the controller's throttle priority and braking test, so update both together. Player brake lights are `braking || (speed === 0 && !throttle)`.

## Recipes
**New car body type** (e.g. a van):
1. `actor-models.js`: add a full `BODY_SPECS` entry with a unique `name` (materials are cached by name).
2. `traffic.js` `createTrafficSystem`: add the kind to `CAR_KINDS` and `bodyCounts` (and `barCounts` if it carries a light bar), and pick it in the `NUM_CARS` loop (an index rule or a `PRIVATE_MIX` share) with a palette. Sizes, collision box, contact shadow and the light bar's point light follow from the spec (`carDimensions`, `lightbarPlacement`); the mass ratio in `collideWithPlayer` follows `isSUV`. The wheel geometry is shared (`WHEEL_SPEC`'s wheel scaled by `wheelRadius`). Each class adds two draw calls (near and far body).
3. Audio: map the type in `audio-sources.js` (`v.isSUV ? 'suv' : 'sedan'`, `car.kind === 'suv'`). A new sound kind must also be added to the allowed list in `audio-synthesis.js`.

A bus-like type with its own meshes also needs: its own instanced meshes and state attribute, inclusion in the zero-init lists (`carInstances`/`busInstances`), `syncInst` calls, a `renderX`, and a lights spec with `headlight` and `zFront`.

**New pedestrian behaviour**: add state to the `peds` initializer, reset it in `spawnPed` (and in `endConversation` if it is social), implement it in `walk()`/`meet()`, and set the facing in `renderPed`. The rig animates purely from x/z deltas plus heading (and `air` for jumps), so just move the pedestrian. Anyone standing or walking on a crosswalk must be in `n.walkers`, because drivers yield through `pedestrianOn`. Curb queues use `n.curb` (`atCurb`/`gatherCurbs`); stepping off is governed by `mayCross`. If you change walking-surface heights in `pedGround`, update the copy in `audio-sources.js`. New track kinds in `pedestrian-routes.js` must carry `ax, az, ux, uz, len, node, side, group, line, from, to`. Sidewalk tracks also carry `edge` and `block`, which the rest and meeting logic checks.
