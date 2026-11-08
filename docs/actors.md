# Actors: traffic, pedestrians, vehicle models and lights

Static counts re-measured headlessly on 2026-10-29 use the current 8.2 × 5.7 km data: build `city-grid.js` first,
pass its populated plaza/park sites to `buildStreetDetails`, then call `createTrafficSystem` with the grid sidewalks
and both builders' footprints; attach `layoutTramInfrastructure` stops to `createTramSystem`. Three.js/TSL are inert
stand-ins, as in `tools/bench-traffic.mjs`. Building, landmark and bridge colliders are omitted, so this is a documented
static snapshot, not a browser scene count. The traffic benchmark omits the grid build and sidewalks too; its counts
are a separate variant. Historical simulation comparisons below have not been re-run for this documentation refresh.
The follow-up refuge fix allows walking on median surfaces while retaining their car blockers. Raised-island
landings now require the same 2 m rail clearance for their curb queues as unmodelled strip refuges. On the same
headless snapshot, crossings change from 2414 to 2409: newly reachable medians add crossings while unsafe
rail-side waiting positions are removed. At the western Dworzec refuge, crossings within 100 m change from 0 to 1;
the subsequent central connection adds a shared crossing to the southern sidewalk at `−1558, 579.5`. The local
100 m count rises from 1 to 2; the full grid-and-furniture snapshot now has 2411 crossings and 3358 walking tracks,
including two shared crossings. Split crossings (8) and cramped ends (3) are unchanged. Exact-coordinate regression
checks reachability in both directions through the actual walking links; full-scene inspection remains in the
[backlog](backlog.md).

## Map (who owns what)
- `js/traffic.js` exports `createTrafficSystem`, which covers the road graph: cars, buses, **all pedestrian behaviour** (spawning, walking, crosswalk rules, queues, conversations), collision sparks and the pooled vehicle lights. Traffic stays on this graph; there is no separate highway population.
- `js/pedestrians.js` is only the body: `PersonRig` (planted-foot gait + IK) and `PersonCrowd` (one instanced skinned draw per LOD). `controllers.js` also uses them for the player's pedestrian and the cyclist's rider.
- `js/pedestrian-routes.js` lazily builds and caches sidewalk tracks (`along(edge)`) and the corner links between them and the crosswalks (`next`). Junction links connect only points on the same block (`blockAt`). Crossing the road always goes through a crosswalk track.
- **Crosswalks** are laid out for the whole network when the routes are created (~50 ms): at most one per junction arm, never at shape nodes (bends), oriented along the arm road's `clx/clz`, centred on the `CROSSWALK` band of whichever of the arm's edges stops nearer the junction. An arm gets one only where (1) both ends reach a curb island (`blockAt`: sidewalk, median, tram island) within `CROSSWALK_REACH` (4 m, road-network.js) of the curb lines its edges' `half` puts there, the zebra then running on to that real curb (merged junction arms and divided roads are often narrower than the curb-to-curb gap), and the track 2 m onto it at both ends; (2) the walk is clear (`walkable`); (3) its zebra overlaps no other road's run (stop line to stop line, where cars queue); and (4) it overlaps no zebra kept before it, the arms with the longest road (`span`) first, so in a junction complex (the short links between the corners of a divided road or tram corridor) the outer approaches keep theirs and the inner ones give way. `crosswalks` (`{ node, side, group, ax, az, bx, bz` (the zebra's ends at the curbs)`, ux, uz` (out of the junction)`, span, tracks }`) is the one list road-paint.js paints its P-10 zebras from (via `trafficSystem.crosswalks`), so pedestrians never cross where no zebra is painted and no zebra lies where nobody crosses. `across(node)` returns that node's tracks. **Split crossings**: where a divided road's median or tram strip is no curb island (only the gap between its two roadways, separate edges with their own nodes), an end with no island in reach may stop at the strip instead: 3.2–14 m (`STRIP_MIN`/`STRIP_MAX`) up to the next roadway, which must run along this one (a crossing road across the scan means the corner, not a strip), and with no crossing road over the strip's midline for 15 m out of the junction (`STRIP_RUN`, which rules out the gap in the middle of a junction complex). The crosswalk is then kept only together with the one across the strip from it (another strip end, or an island end inside the strip, at most `STRIP_OFFSET` 12 m along the road, chosen mutually), as one group in the overlap pass; its track lands `STRIP_LAND` 1.6 m onto the strip (so the `KERB` queue stands at the curb) and `track.refuge[end]` lists the tracks `links()` walks on to over the strip, where people wait for the second roadway as at any curb. Each line walks over the strip to the nearest line across (crossed walks made their walkers wait for each other for good). **Tram strips**: `createPedestrianRoutes(network, blockAt, railClearance)` (traffic.js passes city-grid.js's) gives a strip end room to wait (`stand`) only where its curb and the 1.6 m behind it keep 2 m from every track centreline (the ~1.7 m a tram body sweeps, plus a person). A pair with no room at either end is no split crossing; where one end has room, the refuge from it to the cramped end carries `hold` (the crosswalk beyond): walkers wait at the roomy end, short of the rails, until `mayCross` holds for that crosswalk, then cross the tracks and the far roadway in one go (`p.through`: no stop at its curb), and nobody is spawned waiting at a cramped end (`track.cramped[end]`). Measured on the 8.2 × 5.7 km network (2026-10-28): 22 split crosswalks before, 12 after (5 pairs had no room either side, 4 crosswalks have a cramped end); 3310 → 3300 crosswalks. Historically, on the smaller 6.1 × 3.7 km furnished network: 1385 crosswalks (1899 tracks), 14 of them split (the Dworzec complex went from 0 to 2: one split crossing of Roosevelta). The current static snapshot has 2409 crosswalks (3355 crossing tracks), 8 split crosswalks and 3 with a cramped end. The remaining arms end in the roadway, mostly inside junction complexes and along open squares with no curb island, or lose their crossings to overlaps. Streets outside the largest strongly connected set have no sidewalk tracks and so no crosswalks or zebras.
- `js/trams.js` is a third, separate system: trams on the `GEO.rail` track graph (section "Trams" below). `traffic.js` makes the cars and pedestrians give way to them and collides the player with them.
- `js/actor-models.js` holds the vehicle geometry and TSL materials (cars, bus, trams, and the player's helicopter). `js/vehicle-lights.js` holds the one headlight profile shared by street traffic, trams and the player's taxi.
- `main.js` calls `trafficSystem.update(dt, elapsed, cameraSystem.currentPos, activeEntity, activeMode, camera)`. The **focus is the camera position, not the player**. Consumers of the returned `cars`/`buses`/`peds`: `audio-sources.js` (reads `edge, x, z, speed, acc, driver.a, yaw, yawOffset, isPolice, isSUV, bus, wait, gap, leaderSpeed, conn, yielding`; for peds `placed, v, conversation, rig.feet`, plus track fields) and the `city-map.js` radar. Renaming these fields breaks those modules.

## Street simulation model

Shared crossings span a parallel outgoing-only arm and incoming-only arm in the same signal group, at the outgoing
arm's normal zebra band. The ordinary reach, obstacle, queued-roadway overlap and rail-waiting checks still apply.
Their tracks carry `sides: [{ side }]` for both protected arms (`null` on ordinary tracks). `mayCross` checks both
approaches. Drivers on the additional incoming arm reserve the whole shared walk while pedestrians occupy it,
because turning connectors shift sideways beyond the lane coordinate at the stop line. `configureCrosswalks`
precomputes the last actual connector intersection (`crosswalkEnd`) and outgoing `crosswalkTails`, retaining the
reservation until the rear clears, including on a short outgoing edge followed by another connector. Sampling
happens at build time; the per-frame checks reuse the existing occupancy counters.
Crossings owned by nearby graph nodes can join across the same median island, within the existing 32 m link limit
and 4 m curb band. This extra connection is limited to medians: enabling it on every ordinary city block changed
unrelated pedestrian routes and raised the deterministic Centrum benchmark's longest hold from 84 s to 141 s.
The median-only variant restores it to 82 s without relaxing the 120 s regression limit.

- The drivers are IDM + MOBIL-style lane changes. Parameters are `CAR_DRIVER`/`BUS_DRIVER` (`a, b, T, s0, aLat`), with per-vehicle desired speed `v0` = `desiredOn(v, edge)`: the driver's `pace` (cars 0.9–1.1 by `i % 5`, buses 0.7–0.8 by `i % 3`) times the edge's posted `limit` (`road-network.js`, OSM `maxspeed`; 50 km/h without one), at most the vehicle's `vmax` (cars 80, buses 50 km/h). `place()` and `leave()` set it per edge, and approaching the end of an edge a driver eases down to the next edge's `v0` like a bend (`vt` in `accelerate`). `aLat` sets bend speed through connector curves. `bendSpeed` caches a quarter-metre speed profile per curve and
  driver class: local curvature limits lateral acceleration, a backward pass reserves braking distance before tighter
  bends, and the next road limit caps the exit. A short sharp kink no longer makes a car crawl over a long connector. Traffic has no coasting or physics model. Knocks are a separate decaying `vx/vz` impulse applied by `shove()`, clamped to the road.
- Road graph fields used (from `road-network.js`): edge `sx,sz,dx,dz,rx,rz,len,lanes[]` (lateral offsets, `r` = right), `moves[{to, turn:'S'|'L'|'R', out[]}]` (`out[i]` = target lane or -1), `axis` (`'ave'` for major roads), `axisIndex` (arrival group at `e.to`: at signals it matches the original displayed arm in the local plan; at unsignalised junctions group 0 has priority), `inSide/outSide`, `opposite`. Nodes provide `signal, in, out, groupCount, sideCount, hx, hz`. `connector(e,i,f,j)` and `curvePoint` give intersection curves. A node's sides are its arms, numbered from 0.
- Occupancy: `e.occ[lane]` holds pooled `{v, s}` entries sorted by `s`, and `buildOccupancy()` rebuilds them once per frame **before** driving. A vehicle inside an intersection is listed in its source lane at `e.len + cs` and in its target lane at negative `s`. A vehicle more than halfway through a lane change is in both lanes (`straddle`).
- Intersection counters (`n.box`, `n.crossing`, `e.through`, `e.lefts`) are reset only for nodes and edges registered through `touchNode`/`touchEdge`. A new per-node or per-edge counter must be incremented through those helpers or it never resets. `claim()` runs immediately inside `mayEnter`/`enter` so vehicles and pedestrians evaluated later in the same frame see the claim. Keep that ordering.
- Signals come from `signalPhase`/`walkSignal` in `city-config.js`, the same clock `street-details.js` renders. A phase is `'green'`, `'amber'`, `'red'` or `'redAmber'` (the Polish red+amber, the last `SIGNAL_TIMING.redAmber` 2 s of the red): `mayEnter`, `signalAhead`, `yieldOncoming` and the trams treat `'redAmber'` as red, and any code that tests for `'red'` must test for it too. `phaseOf(e)` picks the phase by `e.axisIndex`. Pedestrians crossing a group-0 road use their node plan's `walk1`, the others `walk0`. At unsignalised crosswalks they always have the WALK: vehicles yield to them through `pedestrianOn`, and they step off once no vehicle holds the crosswalk or can no longer stop. `laneCoord(e, i, arm)` and the walkers' `p.coord` both measure along the arm's crosswalk axis. Drivers find the crosswalks from the stop line: the one ahead starts `e.setbackTo` into the connector and is `CROSSWALK` deep, the one on the way out ends `f.setbackFrom` before the connector's end; a car turning in to wait for walkers stops `shortOfZebra(f)` (0.5 m to spare) before the end.
- **Why a car waits**: `accelerate` records the binding term in `v.waitReason` (like a tram's): `'car'` (the vehicle ahead, `v.leader`; a tram proxy's `leader.tram` is the tram), why `mayEnter` refused (`v.held`, set through `refuse()`: `'signal'`, `'box'`, `'tram'`, `'turner'`, `'bus'`, `'oncoming'`, `'crossing'`, `'pedestrian'`, `'room'`, `'merge'`, `'lane'`), `'signal'` (a red beyond), `'merge'`, `'turn'` (waiting inside to turn), `'pedestrian'` (inside, for walkers on its way out), `'player'` or `''`. Nothing in the app reads them; `tools/bench-traffic.mjs` does.
- **Pedestrian courtesy** at unsignalised zebras: walkers have the right of way and step off whenever the car at the line can stop, which it always can, so a steady trickle of walkers held a car for good. `v.pedWait` counts the seconds a car stands with `waitReason 'pedestrian'` (kept while it stands for anything else, reset once it moves); past `PED_COURTESY` (5 s) its turn has come: `buildOccupancy` calls `courtesy(v)`, which raises `n.crossing` for the crosswalks it passes, so people at the curb wait (`mayCross`), and `mayEnter` passes `onIt` to `pedestrianOn`, so the car ignores them and waits only for those already on the zebra. The car behind starts its own count at the line. Not at signals (the WALK decides there).
- Routing is random per edge (`chooseMove`): straight-biased, buses strongly straight and avoiding single-lane turns. Routes deliberately do **not** steer toward the camera. Recycling keeps the population local (the old drift-to-focus weighting was removed).
- **Police** (`isPolice`, set on every emergency vehicle: Policja, ambulances, fire service) ignore red/amber in `signalAhead` and `mayEnter`, but still wait for `boxBusy`, pedestrians, a free exit (`room`/`alongside`/`mergingAhead`) and cross traffic: at a non-green signal `yieldToCrossTraffic` applies to them, and `cautious` caps their approach at 5 m/s. Other drivers turning left count oncoming police as traffic even at red (`yieldOncoming`). `tests/traffic.test.cjs` pins all of this.
- The vehicle mix is deterministic by index in the `NUM_CARS` loop, over six body classes (`BODY_SPECS` in actor-models.js; generic class proportions only, no brands, badges or signature grilles):

  | `bodyType` | class | L × W × H, wheelbase | cars (of 200) |
  |---|---|---|---|
  | `taxi` | Corolla-class saloon with the roof TAXI lamp (spec `saloon` + `sign`) | 4.60 × 1.78 × 1.44 m, 2.70 m | 25 |
  | `hatch` | Golf / Fabia / Yaris-class hatchback | 4.24 × 1.78 × 1.47 m, 2.60 m | 65 |
  | `estate` | Octavia-class kombi; also the Policja car | 4.68 × 1.82 × 1.47 m, 2.69 m | 40 + 3 Policja |
  | `crossover` | Sportage / Duster-class compact SUV | 4.46 × 1.85 × 1.66 m, 2.68 m | 46 |
  | `van` | Ducato / Sprinter / Crafter-class high-roof panel van; also PRM | 5.60 × 2.02 × 2.50 m, 3.44 m | 18 + 2 PRM |
  | `fireTruck` | PSP fire service truck | see `BODY_SPECS` | 1 PSP |

  Emergency vehicles carry `livery` (written to `carState.w`, painted by `createLoftedCarMaterial`) plus a blue light-bar instance (one light-bar mesh per body that carries them): Policja `i % 80 === 6` (estate, livery 1), PRM ambulance `i % 100 === 18` (van, 2), PSP fire truck `i % 200 === 42` (fireTruck, 3). These rules do not overlap. Their statutory paint, bands, lettering and badges are described under [Emergency-service markings](#emergency-service-markings). Then taxi `i % 8 === 0` (ordinary paint: Polish taxis are any colour; the `sign` body has the roof TAXI lamp, the black-and-yellow side chequer, the Poznań city crest on the front door, `poznanCrestTexture()`, and the 1427 side-number panel on the rear door, `taxiNumberTexture()`). The other cars take `PRIVATE_MIX` (hatch 38%, estate 24%, crossover 28%, van 10%) by a plastic-number sequence of the index. Paint is picked from `carPalette` (mostly greys, whites, blacks and silvers, weighted by repeats) or `vanPalette` (mostly white) by a golden-ratio hash of the index (`i % length` would hit only part of a palette). `isSUV` (crossover, van and fire truck) still selects the bigger engine sound and the heavier push. Each car's size comes from `carDimensions(spec)`: `half`, `halfWidth` (− 3 cm), `axle`, the player collision box `hitW`/`hitL`, the contact-shadow scale `shadowW`/`shadowL` and the light bar's point-light place `barY`/`barZ` (`lightbarPlacement`).
- **Plates**: every car has its own made-up EU registration, `polishRegistration(i + 1)` (actor-models.js): district `PO` 55%, `PZ` 30%, `PY` 15% (Poznań city's two series and the county), then a five-character individual part in one of the Polish two-letter-district layouts (`12345`, `1234A`, `123AB`, `1A234`, `1AB23`, `A1234`, `AB123`; letters without B, D, I, O, Z). `encodeRegistration` packs its seven glyphs into the per-instance `plateCode` vec4 (two 32-cell atlas indices per component, exact in float32), which `renderCar` writes with the paint (both flagged through `dirtyPaint`). The material paints the white plate with the blue EU strip front and rear from one glyph-atlas sample (`plateColor`, shared with the bus, whose fleet shares one registration); the rear plate has the round registration sticker in the gap. The fixed-colour variant (the player's taxi, the wheels) paints blank plates. There are 12 buses (`NUM_BUSES`) in MPK livery, each with a fixed `route` (row of `BUS_ROUTES`, the amber LED destination sign, read from `busState.w`), and they spawn only on `e.major` edges (`road-network.js` `isMajorRoad`: ≥ 14.5 m curb to curb or ≥ 3 travel lanes, or on a named road that is major over most of its length). Instance buffers and the lightbar mesh are sized from the counts, so changing the mix resizes them.

## Emergency-service markings
The three emergency liveries are painted procedurally by `createLoftedCarMaterial` from object-space position and
normal. They add no mesh and no draw call: `carState.w` still selects the livery inside the one instanced material per
body class, and only two small canvas atlases are sampled (one text mask, one RGBA badge atlas). `EMERGENCY_PAINT` in
`actor-models.js` holds the base paints used by `traffic.js`; `LETTERING`/`LETTERING_ROWS` extend the existing text
atlas to six rows; `emergencyBadgeTexture()` holds four 128 px cells (Policja star, PRM star of life, PSP flame
shield, PRM P roundel). `drawPoliceStar`, `drawPrmBadge`, `drawPspBadge` and `drawPrmTeamBadge` are exported and pinned
by `tests/vehicle-models.test.cjs`.

- **Policja** (silver estate, livery 1), after §31 of Dz.U. 2022 poz. 122: silver body `#c7ccd1`, a reflective blue
  band (`#1d3f8f`) at 0.70–0.90 m below the windows with white (`#f4f6f8`) rectangular reflectors at 7 cm pitch along
  its top and bottom edges, white `POLICJA` on the band on both sides and the rear, a 13 cm police star on the front
  door, and the optional fluorescent yellow-green (`#c8f000`) stripes at 0.94–1.00 m and 0.18–0.24 m plus the rear and
  front rails. The older silver/blue cars remain legal under §31(3), so no car is repainted in place.
- **PRM** (yellow van, livery 2), after part I of Annex 2 to Dz.U. 2023 poz. 118: yellow body `#f2e11c`
  (CMYK 10/0/90/0, RAL 1016 class), red lower stripe 0.88–1.03 m (`#c8161e`), blue stripe 1.03–1.18 m (`#1f4fbf`),
  red roof stripe 2.28–2.43 m, red `AMBULANS` on the cargo box, the 7.5 cm `ZESPÓŁ RATOWNICTWA MEDYCZNEGO` line below
  it, the 40 cm red `P` roundel on the front door, the 50 cm star of life on the cargo box and on the rear doors, and
  the existing red/yellow rear chevrons. The 2023 scheme is the red–blue–red one specified in the task; the December
  2025 amendment that would make the three lower-stripe bands red–red–red is not modelled.
- **PSP** (signal-red fire truck, livery 3), after §27 of the vehicle regulation and KG PSP order 14/2002: red body
  `#ab1017` (RAL 3000 class), a white reflective band at 1.05–1.30 m with yellow rails at 0.95–1.03 m and 1.32–1.40 m,
  white `STRAŻ` in a 22 cm box on the front door, white `998` on the rear doors, the 24 cm PSP flame shield on the
  locker band, and the existing red/white rear chevrons. The equipment lockers keep their silver roller shutters; the
  band and text paint over them through the same `fireEquipment` branch.

The temporary shader harness (not committed) rendered the estate, van and fire truck with `carState.w` 1/2/3 in Chrome
157 headless on WebGPU and forced WebGL2. The side, front, rear and close-up views showed the bands, white reflector
blocks, `POLICJA`, `AMBULANS`, the long PRM name, `STRAŻ`, `998`, the star/star-of-life/P roundel/shield badges and the
rear chevrons with no console or shader errors on either backend. The full app also booted and rendered with a clean
console on both backends.

## Pedestrian queues, routes and route ends
Pedestrians keep a `QUEUE_GAP` of 0.62 m behind anyone ahead walking the same way on the same line, not only at a
curb: a faster walker used to close up on a leader that then stopped with no room to back off. The per-frame check is
indexed by `routePeds`, rebuilt once per frame and keyed by the **physical line** (`walkKey` on sidewalk tracks; the
undirected segment for corner links and crosswalks), because one line carries several route objects: the two directed
edges of a two-way street, and one corner link per pair of tracks. Following and the split-crossing `hold` queue compare
world positions and headings, since the two directed copies have opposite route parametrisations. A walker approaching
a new leg keeps its entrance clear (world entry point, so converging routes and both directions compete, plus a
length-based capacity), and a walker that is already stopping does not stop inside a stationary oncoming body; free
walkers still pass, so crossing throughput does not fall. A queue at a split crossing's `hold` backs along the track in
queue-gap steps instead of standing on the strip's end point. The corner queue ignores people at exactly the same point
(`forward > 0.01`), so an overlap left by a shared link or a respawn cannot report zero room to both and lock itself
for good. Every walking track also names which of its two right-hand sides has room for a `LANE_INSET` 0.34 m inset
(`insetLane`: bit 1 for the +right side, bit 2 for -right; both on ordinary two-way sidewalks, and only the sides
with room on a one-sided corner link). `walk()` eases each pedestrian's `lane` offset toward the side of its travel
direction, so opposing flows on a narrow line sit 0.68 m apart instead of stopping on one point. The target fades to
zero within
`PED_LANE_RAMP` 1.5 m of either track end, and the stored offset moves no faster than `PED_LANE_RATE` 1.5 m/s, so a
leg change, a dead-end reversal or a respawn never jumps a walker sideways.

Connector legs (corner links, wide-corner connectors, fallback connectors) are keyed by the **physical line they land
on** (`physicalLine`: the target's `walkKey`, else its undirected segment), and a fallback projection sub-track
inherits its parent's key. Two spans that reach the same landing line therefore queue as that one line instead of
stacking on the shared corridor; the 11.8 m Droga Dębińska corner link can no longer turn its crosswalk queue into a
four-body pile.

`pedestrian-routes.js` never links the two painted lines of one crosswalk to each other: that 1.5 m step is a U-turn
back over the zebra just crossed, and at a curb with no sidewalk exit every walker funnelled through that one short
link. A route choice also skips a crossing whose far end lands on a known block with no way off it (a park edge with no
sidewalk track); before the fix those crossings made people cross, find nothing, turn round and cross straight back
forever. Removing the U-turn exposed empty landings, so `links` fills one only when the connector stays within the
source block's edge corridor (16 m as of the 2026-11-07 stage-2 widening; points beyond the 8 m sidewalk band must
still see their block edge without a building between, so a closed courtyard stays off limits), is at most 32 m
long, keeps every road lane at least its half width + 0.8 m away, stays `RAIL_KEEP` 2 m from any rail/tram centreline,
avoids building lots (2 m pad) and the real building colliders passed by `main.js` (0.4 m body pad, once a collider's
underside is below the 1.9 m pedestrian), keeps off obstacle footprints and never crosses water. It can join the
nearest point on a sidewalk track or another zebra; a cross-block seam also passes `clearGap`. The long fallback also
accepts a sidewalk track end (those tracks carry `from`/`to`, not `node`); the old `!next.node` gate skipped every
one beyond `DIRECT_MAX` and left 16 ends isolated. `DIRECT_MAX` 8 m still caps the shortest-link length; every longer
connector up to 32 m may use the 16 m corridor. The connector clearance measures the exact segment-to-segment
distance (four endpoint projections plus a crossing test): the old line-line form read 5.39 m where the pair was
2.0 m and let 17 fallback legs into a lane by up to 1.09 m. On the headless benchmark world (`tools/bench-world.mjs`,
street furniture plus city-block colliders, no city-grid curbs, landmarks or bridges) empty ends fall **269 → 212 →
156 → 47** and tracks with an empty end (never entered by the full routing) **247 → 197 → 143 → 41**, with crosswalk
count unchanged at 3,270; `laneHits`, rail hits and building hits stay 0, and 87 ends now use 581 fallback
connector legs (209 / 1,004 before stage 3). Removing the node gate accounts for 16 ends; the 8 → 16 m corridor with
its courtyard sight line for 20 more alone and 44 together. The 16 m corridor gains 56 of the 68 ends that even a
32 m corridor would, and a 40/48 m `FALLBACK_MAX` adds only 6/7, so 32 m stays. The 2 m rail keep replaces the earlier
1.5 m check; on this harness it changed no count, but a 1.7 m synthetic clearance now blocks a connector. The street
index is built with the routes; sidewalk tracks are materialised only for the nearby edges of a landing and `links()`
never loops the whole network in a frame.

**Kerb tracks (stage 3, 2026-11-07).** A road-edge sidewalk line is only walked where it lies on a curb island, but one
line can pass several blocks and tram cuts end to end; the old code dropped the whole line when any sample left its
block, which removed every island track through a cut (Okrąglak, Święty Marcin, Górna Wilda). `along(edge)` now keeps
the clear same-block runs separately (`split: true`), indexes every sidewalk-track end by its block (`curbPorts`), and
`baseLinks` offers a crosswalk end the same-block ends within `CURB_LINK_MAX` 8 m. Where a tram-cut island or median
still has no road-edge run at the landing (Miła), `links` adds a short kerb spur (`landing: true`, at most 6 m) along
the landing's block outline; it keeps 2.22 m from every rail centreline and is rejected if it would cross a lane, a
lot or a wall. A spur is a terminus: its far end has no node, so `next()`'s dead-end guard never routes a walker into it
as a through path; it only gives the zebra a legal place to land. On the headless world this leaves **47 empty ends /
41 tracks** (bare network **38 / 33**, down from 109 / 98), with 16,046 split runs whose `splitLaneHits` is 0
(`splitMinLane` 0.8 m), 5 spur links on 4 generated tracks, `spurRailHits`,
`spurBuildingHits` and `spurBlockHits` all 0, and the closest spur sample 2.48 m from a rail. The five named nodes are
linked: Okrąglak, Okrąglak / Święty Marcin, Miła / Dąbrowskiego (the `-3269.1, -884.3` end; its far end on the ordinary
block at `-3263, -901.3` stays isolated), Promienista / Grochowska (both lines) and Wierzbięcice / Górna Wilda (both
lines). Route build stays ~223 ms and `links()` over all ends rises 6.3 → 8.8 s (worst call 57.6 ms) after the 16,046
split runs; it is still lazy and cached per end, and the split runs add no per-frame work. The remaining isolated landings are ordinary blocks and
roadway cases, listed in the [backlog](backlog.md) with reasons;
`tools/audit-crosswalk-landings.mjs` counts them, re-checks every fallback leg's lane, rail and building clearance, and
re-checks the generated spurs' rail/building/block clearance. A pedestrian that still
stands with no legitimate wait (not a curb wait, strip hold, conversation or rest) for `PED_STUCK_TIME` 20 s is
re-placed 60-280 m away with the normal view protection. Removal is postponed while `nearView` says the camera can
see the old spot, but only for `PED_STUCK_VIEW_TIME` 30 s in total: after 10 s of a held view the body is re-placed
anyway (`spawnPed` still picks the new spot out of view), so a player standing at a knot cannot keep it there forever.
Waiting at the curb for the WALK is the only crossing wait that exempts the clock, and only when the **next** leg is
the crosswalk and the walker is within 2 × `QUEUE_GAP` of its curb (or is already `waiting` on it); a body far back on
a long approach ages and is re-placed. A body that has crossed but cannot leave the far curb (a blocked, usually
unsignalised, exit) is treated the same way. Short tracks (corner links, cramped sidewalks) do not get the crossing
exemption: a blocked exit there is exactly the bottleneck that piles people up. The crosswalk merge yield (the
"closest arrival merges first" rule) runs only within 2 × `QUEUE_GAP` of the crossing entrance; beyond that a walker
keeps to its own line, so a 20 m corner-link approach cannot be pinned at its start with zero room.

Conversations need `MEET_CLEAR` 0.65 m (one body width plus the queue gap) of clear space around both partners, checked
against every placed body (`pedNear` over the reused 2 m `pedCells` grid). Two pairs can no longer meet inside each
other, and a conversation does not start in a crowd.

Measured headlessly with `tools/audit-ped-overlaps.mjs` (8 focus points, seeds 4242 and 77, 3 simulated minutes each,
one sample per second after 20 s): clusters of >= 4 peds with centres under 0.5 m lasting over 5 s fall **27 → 20**, the
longest **145 → 16 s**, the biggest **20 → 6 peds**, overlapping pairs per second **32.3 → 10.5** and crosswalk entries
per minute **142.6 → 131.7**. The old worst places were the Park Mickiewicza / Aleja Niepodległości corner (25 s, 4
peds on one 1.5 m link), Droga Dębińska in Wilda (53-74 s, up to 12) and Głogowska / Most Dworcowy (108-115 s, up to
20). A separate flow classifier (seeds 4242/77, 3 min) puts the entries drop at **133.1 → 122.8 per minute (-7.7%)**;
before the landing connections it was -9.5%, about 58% of which was the removed U-turn and dead-end crossing pairs and
the rest walkers queueing briefly behind sidewalk conversations (6-12 s) and rests (1.5-4.5 s). `traffic.update`
measured 0.632 → 0.66 ms/frame at Centrum (60 fps, 1 800 frames, headless); route build 180 → 182 ms and links()
over all ends 5.1 → 5.33 s (worst call 34 → 33.4 ms). The 2026-11-07 physical-line follow-up, re-measured on the two
remaining hotspots (Dworzec and Wilda, same seeds and duration), moved clusters **17 → 12**, longest **26 → 24 s**,
biggest **7 → 8**, overlapping pairs/s **18.8 → 14.1** and crosswalk entries **108.0 → 109.2/min**. The
direction-inset follow-up (same two districts, seeds 4242/77, 3 min, measured again on this tree, including the
review fixes) moves clusters **8 → 1**, longest **20 → 9 s**, biggest **6 → 4**, overlapping pairs/s
**13.25 → 5.68** and crosswalk entries **125.7 → 126.6/min**. The 24 s / 5-body Most Dworcowy two-way knot and the
8 s / 8-body Droga Dębińska queue are gone. The 2026-11-08 overlap-remnant follow-up (all eight districts, same seeds
and duration) moves clusters **2 → 1**, longest **18 → 7 s**, biggest **5 → 5**, overlapping pairs/s **4.41 → 4.84**
and crosswalk entries **116.7 → 118.3/min**. The Rondo Kaponiera 11 s / 4-body cluster is gone; Wilda has no cluster in
either seed and the 11.8 m Droga Dębińska link no longer turns its crosswalk queue into one (its remaining longest
pair is 18 s, two bodies at a 1.4 m link during a red light). The remaining 7 s / 5-body cluster is the Most Dworcowy
short-link knot, where corner-link starts and a crosswalk curb share one point. `bench-traffic.mjs --ped-rooms`
falls **23,660 → 21,829 frozen ped-s** of about 642,800 sampled (-7.7%), longest hold 20.1 s. `traffic.update` stays at
**0.789 → 0.780 ms/frame** at Centrum (noise); on the bare network, materialising every walking track rises
1.23 → 4.81 s and `segments()` 5.69 → 11.81 s (the 0.5 m block/rail sweep runs once at build time), with no
per-frame allocation. Method, counts and the before/after tables are in
[the remnant record](observations/ped-overlap-remnants-2026-11-08.md); earlier phases are in
[the 2026-11-05 record](observations/ped-overlaps-2026-11-05.md).

## Population around the camera (spawn/despawn)
- Pools have a fixed size, and nothing is created or destroyed. **Only as many vehicles drive as the lanes around the focus carry at `VEHICLE_DENSITY`** (12 per km of lane, both ways counted, at least `MIN_VEHICLES` 30, at most the pool of 212): `refreshNear` sums the lane length within `NEAR_RADIUS` (`nearLanes`) and sets `nearTarget`. A vehicle retired beyond `VEHICLE_RADIUS` is placed again only while fewer than that drive; otherwise it is parked (`park()`: no edge, moved to 1e6 so the radar draws no stale blip; everything that reads `cars` skips `!v.edge` or draws off-map). A camera jump parks the excess at once. Until 2026-10 the whole pool filled whatever the network: the sparse single-lane grids (2.9–5 lane-km within 350 m at Wilda, Łazarz, Jeżyce, Stare Miasto) carried 40–70 vehicles per lane-km, a jam, and 62% of the cars stood even with no pedestrians, trams or signals (`tools/bench-traffic.mjs --no-peds --no-trams`). Now 28–80 vehicles drive within 300 m (37 at Stare Miasto, 61 at Kaponiera, 79 at Rataje). A rotating cursor scans the pool each frame with an **attempt** budget (4 vehicles, 6 pedestrians), so awkward spots can't monopolize a frame.
- `nearBusTarget` reserves `ceil(nearTarget × 12 / 212)` places for buses (2 at the minimum population), with the
  remaining places for cars. Without a nearby `major` edge long enough for a bus, all places are available to cars.
  Previously the cars-first pool filled the shared target before any bus could spawn: a seeded furnished-network
  Dworzec run had 72 cars and no buses after 120 s; with the reservation it has 67 cars and 5 buses, still 72 total.
  Failed bus placements leave those places free for later safe attempts; they never relax lane/tram clearance or
  view protection. A camera jump trims each class to its share; during ordinary travel excess vehicles retire
  through the existing distance rule. See [the observation record](observations/bus-population-2026-10-30.md).
- Actors are retired beyond `VEHICLE_RADIUS` 380 m / `PED_RADIUS` 320 m **even when visible**: keeping them starves the streets ahead during travel. Replacements are placed 100–350 m away (pedestrians 60–280 m). A placement is rejected when it is in the frustum and within `VEHICLE_SPAWN_DISTANCE` 250 m (`PED_SPAWN_DISTANCE` 150 m) of the camera (`nearView`), within 25 m (pedestrians 10 m) of the player, or (vehicles) in a lane that isn't clear (`laneClear`).
- A camera jump of more than 140 m in one frame (a teleport, or the first frame) respawns everything beyond `NEAR_RADIUS` anywhere within 0–350 m with no view protection.
- `refreshNear()` selects edges by their nearest point to the focus (not the midpoint), and spawn `s` is limited to the local section of long roads. It refreshes only after the focus moves 40 m.
- Pedestrians flagged `crossesStreets` (every sixth) try crosswalks for 5 attempts, then fall back to sidewalks. They start at the curb of a random crosswalk of a random junction in `nearCrossings` (`refreshNear`: the `crossingNodes` within `NEAR_RADIUS`, every junction with a crosswalk, signalised or not; 1107 in the current static snapshot, 188 of them signalised; 2069 of its 2409 zebras are unsignalised). Until 2026-10 only signal nodes were used, so unsignalised zebras got crossers only from people walking up to them. Their effect on traffic, measured headless on 2026-10-28 (8.2 × 5.7 km network, 5 simulated minutes at each of Stare Miasto, Jeżyce, Łazarz, Wilda and Centrum, cars within 300 m sampled every second): with crossers at the unsignalised zebras (and cars yielding to them) the mean car speed was 4.7 km/h, 65.1% of samples stopped, the longest stopped queue in a lane 34 cars, the longest wait 261 s and 110 cars held over 120 s; with neither (crossers spawned only at signals, `pedestrianOn` false at unsignalised nodes) 4.8 km/h, 65.2%, 34, 248 s and 154. The crossers cost nothing measurable then, as the gridlock dominated (see "Gridlock" below); with it gone they are the root of 10–30% of stopped cars at give-way zebras, which the courtesy rule above bounds. Spawning a pedestrian ends its conversation and sets `rig.placed = false`. Separately, `PersonRig.update` resets the rig whenever it moves more than 3 m in a frame.

## Traffic flow and junction coordination

Historical Phase 15.6 baseline, superseded by the Phase 16 results below. Measured with
`tools/bench-traffic.mjs` (5 simulated minutes per district, seed 4242, the furnished 8.2 × 5.7 km network
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
Local signal plans live in `node.signalTiming` (shared with `SIGNAL_SITES[].timing`).
`updateSignal(time, node)` caches both vehicle groups and WALK/display states once per plan and time. Traffic updates
its signal nodes once per frame, and cars read `phaseOf(e)`. Plan splits use inbound lanes and width; minor and compact
junctions start with 44 s cycles, arterials 60 or 76 s. After walking routes are built, each group's minimum green
also allows the last WALK entrant to cross the full width at 1 m/s before opposing traffic starts; a cycle grows only
when both minima cannot fit. Named corridor signals share 60 s cycles (65 s on Św. Marcin) and offsets from road
distance at 40 km/h; other offsets are deterministic. Each transition has 3 s amber followed by 2 s clearance
including the next group's red+amber. WALK admits new entrants for 7 s, then displays flashing green for 3 s.
Two-arm nodes with crossings stay road-green until a walker requests a phase (2 s request delay, at least 20 s road
green); their red clearance allows a 1 m/s walker to finish the measured crossing. Two-arm nodes without crossings are disabled.
The Phase 16 benchmark variant (no grid sidewalks) has 311 regular plans, 22 demand crossings and
12 disabled signals (2026-10-29); these are not counts for the static snapshot above.

`boxBusy` refines coarse group counts against each holder's remaining swept connector, including the rear and rigid
body curvature allowance; it keeps zebra and exit occupancy claims. This breaks the Jeżyce car–tram–car cycle where
an already disjoint turn owned the box until a far stop line. Path/width/body-length pairs are cached, and repeated
frames reuse their geometry.

Pedestrians wait at least 2 m normal to the rails at any crossing angle. The tram's 1.2 m half-body plus the
world-aligned person's 0.71 m diagonal and 0.05 m margin exceeded the old 1.8 m waiting clearance on diagonal
streets. Two trams could therefore brake for people waiting safely before the other track and hold each other.
The waiting distance and tram obstacle envelope are regression-tested together.

Exit reservations use one transitive approach order and the same `mergeFirst` order within an approach.
`mergeArrival` records arrival within 2 m of the line. For exits under 12 m, a red approach whose lead has arrived
and waited over 10 s remains eligible if the green entrant is estimated to reach a non-green downstream signal.
The estimate uses a scratch signal plan, leaving the live signal unchanged. This can hold green traffic before an
empty link if the estimated travel time is pessimistic, but lets it through when the predicted signal is green.
On an exit shorter than 12 m whose start node is a signal, a lead that is stopped and held by a physical obstruction
(`box`, `tram`, `oncoming`, `crossing`, `pedestrian`, `turner`, `bus` or `lane`) no longer reserves space. At the
9.4 m Św. Marcin link a police car held by a tram kept its only usable lane reserved through the whole cross green
(seed 99: 184 s); the rule cut that to 52 s with no junction-box stop or cycle (2026-11-07). Give-way short exits keep
the old reservation. A left turn that `mayEnter` refuses on a short link between signals is retried once as the first
straight or other non-left move from the same lane (`straightFallback`), so it does not wait on the link; the turn is
still taken when the way is clear, and no movement or protected phase was added. On a long exit (20 m or more) that
feeds such a short signal-to-signal link, a car that cannot stop (not a bus, which the short-link bus guard covers)
also checks the space behind the rearmost car rather
than the sum of all gaps, so a committed entrant does not stop in the upstream box behind a full approach queue
(the Św. Marcin approach backed into `(-1074, 129)` for 53 s, seed 5, 2026-11-07).
At a short link (under 12 m), a follower stopped over 15 s by merge braking may close up behind its own lane lead;
the lead still obeys merge priority. The exemption applies at unsignalised give-ways as well as between signals: a
give-way merging into a short exit (e.g. Kaponiera's 10 m exit at −1497, 198, 87–95% merge and 80–139 s maximum
wait) starves the same way. The lead is found with `ahead(list, v.s, v)`, not `leadOf(list)`: `leadOf` skips a predecessor
still in the connector unless its s is negative, so a queue head whose lead had entered the connector counted as
having no lead and kept yielding to the merging lane. Counting that lead as present only bypasses merge priority;
`mayEnter` still checks room, alongside, oncoming, cross traffic, pedestrians and trams. See
[observations/long-holds-2026-11-05.md](observations/long-holds-2026-11-05.md) for the decomposition.
On a short link the graph's lane mapping can leave free storage unused: at Kaponiera's 10 m give-way exit
`(-1497, 198)` two approach lanes feed the lane that also serves the right turn, while the straight lane beside it
stays empty. `shortLinkLane` (2026-11-08) lets an uncommitted car take a sibling lane of the same edge when the planned
lane is full, but only at a link whose far end is a signal, only when the planned lane's front car is already stopped
for that signal, and only if the sibling lane can make the current turn and offers no movement the planned lane lacks
(a left-turn-only sibling crosses the tram tracks at `(-1438, 115)` and produced 89 s switch waits without that test).
The chosen lane is kept in `v.outEdge`, which `room` and `mergingAhead` use so the reservation follows the real slot.
A 20 m or longer feeder into such a short signal link now also counts only the space behind the rearmost car when that
car is stopped, not the sum of all gaps, so a stoppable car does not take the feeder and then stand in the upstream
junction box; a moving queue can still be followed in. Measured over the 8 Kaponiera seeds: mean 11.9 → 12.3 km/h,
stopped 53.5% → 52.0%, worst wait 195 → 139 s, held > 120 s 25 → 7, deadlocks 2 → 0 and no `(-1490, 170)` box stop.
[Measurements and rejected variants](observations/kaponiera-traffic-2026-11-08.md).

Trams reserve space for their full length plus 2 m beyond switches, track crossings, mapped road/mainline crossings
and occupied platforms. A tram already inside continues through. A tram held before entry records `waitReason: 'room'`
and its downstream `leader`; conflicting approaches can pass it. Actual switch conflicts retain `'switch'`.
Stationary dwelling/red/obstacle-held trams do not claim future switch approaches; their actual body occupancy still
blocks the conflict. Switch/block contenders retain their ordering. Car-curve reservations of a stationary held
tram end at its nose; moving trams keep the approach lookahead. This avoids a 2 m phantom claim beyond a safe gate.
The benchmark follows both `'tram'` and `'room'` leaders, so a reservation cannot hide a deadlock. The opposite-track
lane at Rynek Jeżycki is corrected before connectors and road paint are built (see `world.md`). Passing a waiting
left-turner on a wide single-lane approach is implemented (see `docs/backlog.md`).

Final Phase 16 benchmark (7 districts × 5 minutes, seed 4242): 15.6 km/h mean, 32.0% stopped, no car held over 120 s,
no persistent deadlocks and no continuous `switch` wait over 60 s (maximum 39.6 s). Before Phase 16: 11.6 km/h,
46.7% stopped, 35 cars held over 120 s and one >60 s switch hold. The longest car hold is now 117 s. The
`--no-signals` comparison is 18.5 km/h / 23.4% stopped. Full measurements and browser limitations are in
the [archived Phase 16 report](archive/poznan-plan.md#phase-16-signal-timing-and-trams-on-switches).

## Player interaction
- `player.active` is false in the helicopter or when the entity is at y >= 2.6. Mode-specific `halfW/halfL/push` values are set in `update()`. Drivers treat the player as a leader (`playerGap`), and lane changes avoid the player.
- `collideWithPlayer` uses a SAT OBB test. The extents are the car's `hitW`/`hitL` (from its body spec) or the bus's literals in the call in `update()`, and the mass ratio is set in `collideWithPlayer`. `reportCollision` fires synchronously with a **reused** event object, so listeners (audio) must copy any field they keep.

## Performance patterns (keep them when editing)
- Instance slots are handed out every frame only to actors that `visible()` passes. `visible()` tests side planes only; the margin radii are car 18, bus 22, pedestrian 7, to cover shadows and beams. Every instanced mesh has `frustumCulled = false`. Cars within `CAR_PROXY_DISTANCE` (90 m from the focus) get the full body plus separate wheel instances; farther cars get the ~460–510-triangle proxy with built-in wheels (the full bodies are 2.9–3.0k triangles without wheels). That is two body meshes per class: 12 car body meshes, plus 2 wheel, 3 light-bar and 1 contact-shadow mesh; empty meshes are hidden after warm-up.
- Upload only the used prefix: `flagRange(attr, n)` calls `clearUpdateRanges` + `addUpdateRange(0, n*itemSize)`. Paint is stored as `Math.fround` floats and lamp state is compared against the buffer; the paint/state attributes are flagged only when they change (`dirtyPaint`/`dirtyState`).
- Empty meshes are hidden after 2 updates (`hideEmpty`). For the first two frames they keep one zero-scale instance so `main.js` shader precompile and the warm-up frame compile them. Copy this pattern for any new instanced mesh. Idle sparks write and upload nothing.
- Pedestrians: every rig's gait advances every frame. `renderPed` passes `updatePose = draw`, so hidden rigs skip `solve()`, and only drawn rigs are copied into `PersonCrowd` (far LOD beyond 34 m from the focus). Feet and gait stay identical to an always-solved rig.
- Lights come from fixed pools: 96 headlight spots (2 per vehicle) plus 6 blue emergency point lights. Lit vehicles are sorted by an effective distance that penalizes positions behind the camera. Unused lights are parked at y = -1000 with intensity 0. Never add or remove lights at runtime (clustered lighting). The beam fades in from `cityUniforms.uInteriorGlow`. `DUAL_BEAM_*` are unused leftovers.
- `tests/traffic-performance.test.cjs` budgets are **exact write/upload counts, not timings**: idle sparks produce 0 matrix writes and 0 uploads after warm-up, frames 1–2 keep exactly one degenerate visible instance, the live-spark update range is `count * 16` floats, and `renderPed` adds to the crowd only when drawn.
- `tools/benchmark-pedestrians.mjs` (usage in [`testing.md`](testing.md)) is the correctness check after `PersonRig` changes; it string-replaces `if (updatePose) this.solve();`, so keep that exact text.

## Test-harness coupling (gotcha)
`traffic.test.cjs` and `traffic-performance.test.cjs` extract inner functions of `traffic.js` by regex: from a line starting `  function name(` up to the first line that is exactly `  }`. They then run each function in a `vm` with a hand-written context of its free variables. `traffic.test.cjs` also cuts out `courtesy` and runs `mayEnter` with its own context (the courtesy test). The extracted functions are `mayEnter, signalAhead, canStop, yieldToCrossTraffic, yieldOncoming, nearView, refreshNear, spawnVehicle, spawnPed, renderPed, updateSparks, flagRange, occupyTrams, tramBlocks, heldByTram, tramClose, tramHoldsClose, inTramLane, overlapWithPlayer, collideWithTram, tramRoom, tramCrossings, tramNear` (`mayEnter` needs `tramBlocks`, `tramRefusedClose`, `refuse` and `PED_COURTESY`; `spawnVehicle` a `nearTram` stub; `refreshNear` `vehicles`, `VEHICLE_DENSITY` and `MIN_VEHICLES`). Keep them as 2-space-indented `function` declarations. When a change adds a free variable or helper to one of them, add a stub to the matching test context.

## Trams (`js/trams.js`)
`createTramSystem(scene, { network, rail = GEO.rail, stops = GEO.tramStops, routes = GEO.tramRoutes, traffic })` is built in `main.js` after
the road paint, and `update(dt, elapsed, focus, camera, playerEntity, activeMode)` runs before the street traffic. It
reads the road network (signal nodes, lanes and junction curves for `mapTramsToRoads`) and, read-only,
`traffic.cars`/`traffic.buses` (`edge, x, z, yaw, yawOffset, half, halfWidth, tx, tz, speed, vx, vz`) and
`traffic.peds` (`placed, x, z, ux, uz, dir, v`) to brake for them; `traffic.js` does the yielding (see "Interactions" below).
Trams follow the associated road signal phase; dedicated tram signal heads are not rendered.

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
  route ends in the box (after a terminus loop), `turnRoute` switches to the same line's route on
  the next edge (usually the other direction). Each path edge stores the route selected when it was laid out; the display,
  line and destination change only when the front enters that edge. Routing still looks ahead as before. Where the
  route stops for good on track other lines use (a relation gap no rejoin spans: line 10 at (-850, 768), lines 7 and 8 at (-845, 9)), it takes the
  route of that track, as a diverted tram would. Historically, before the Phase 15.10 route correction, 98.6% of paths
  laid out from every route edge stayed on the route. A headless run (10 minutes at each of Ostrów Tumski, Stare Miasto, Dworzec, Półwiejska,
  Rataje and Jeżyce on the 8.2 × 5.7 km network, 84k tram samples) had 1.15% of samples off their route, 0.77% of them
  on other lines' track (line 10 past its relation's gap, wandering on under its number) and 0.38% on track no route
  uses; before 15.10 this was down to 0.44%, 0.06% on other lines' track. Phase 15.10 completes the main loops at
  Zawady (line 5) and Ogrody (2/7/8/18) through their actual departure stops, and extends Starołęka's 7/12/13 routes
  across the detail boundary. These are five existing OSM ways absent from the relations; `poz-roads.mjs` adds their
  membership using adjacent member-way anchors (see `geodata.md`). Track geometry, runtime routing and the 38 route
  records stay unchanged. Exact-coordinate tests cover both loops at two branch choices, return destinations and
  both boundary directions. On 2026-11-03, a seeded headless re-measurement at those six locations (10 minutes each,
  15 fps, one sample per active tram per second, 84,235 samples) found **0 off-route samples**: none on track used only
  by other numbered lines and none on track assigned to no route. Before the display fix, 355 samples of line 5 showed
  Górczyn PKM while the front was still on the Zawady-bound direction; afterwards the same benchmark has 0 such samples.
  The historical script, seed, exact camera positions and sampling details were not retained, so the historical 0.44%
  and the new 0% are not a controlled before/after comparison.
  See `tools/bench-tram-routes.mjs` and [testing.md](testing.md#tram-route-membership-benchmark) for method and limits.
  Lines run the real sequence of tracks only roughly: no timetable, any number of trams per line.
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
  names the binding one (`tram`, `room`, `switch`, `block`, `stop`, `signal`, `curve`, `end`,
  `car`, `player`, `pedestrian`, or empty).
- **Population**: 24 pooled trams (~12% Combino, ~29% Tramino, ~58% Gamma), kept within 900 m of the camera focus and respawned
  120–800 m away, never within 300 m in view or 70 m from another tram. After a camera jump of more than 140 m they are
  all respawned. `createTramSystem` takes an optional `seed` (default 1922, passed through as `buildWorld({ tramSeed })`
  in the benchmarks) so runs can vary the tram sequence. A spawn is rejected inside the last 200 m of a free-ending
  detail-box stub (endPad 1, `SPAWN_BUFFER_CLEAR`), which stops a new tram joining the buffer queue directly without
  emptying the edge approaches. That check walks the track ahead with a fixed branch choice instead of `rand`:
  extending every spawn's path to 200 m shifted the whole tram random sequence and, from that alone, moved the
  Kaponiera 7 × 8 mean longest hold from 118.6 s to 163.5 s (see the [observation record](observations/tram-edge-jams-2026-11-04.md)).
  A tram queued behind a buffer end (`bufferQueueAhead`, following its leader chain because the path only sees 160 m
  ahead) accumulates `bufferWait` only while it is under 2 m/s. After 2 s it is respawned when `outOfView` says it is
  not rendered: no camera, beyond `TRAM_CULL` 1 500 m, or outside the frustum. A tram in the frustum inside the render
  range is never retired by that rule, and a moving tram never accrues the clock. A free-ending buffer (`endPad` 1,
  mostly at the detail-box edge; a stub ending on another track has 19 and keeps 8 s) lets a stopped front go after
  2 s out of view instead of 8 s; in view the existing 40 s wait stays, so no new popping is added. On 2026-11-05,
  over tram seeds 1922/77/4242, no edge count within 400 m or 250 m
  fell below the old base minus its stopped queue; most were within about ±2 trams of the old base and every edge pool
  filled (16.5–23.5 of 24). With the camera elsewhere no edge had a stopped buffer queue (max 0). A camera that sees
  every direction still sees the front's 40 s wait and its queue: that is the no-visible-popping trade-off. See the
  [observation record](observations/tram-edge-jams-2026-11-04.md) and `tools/bench-tram-edges.mjs`.
- **Bodies**: `TRAM_MODELS` in `trams.js` (Moderus Gamma, 3 sections, 31.8 m; Solaris Tramino, 5, 31.8 m; Siemens Combino, 5, 31.9 m). Each section
  lies on the chord between its two ends on the path (`poseSections`), so the joints stay on the track. Section kinds
  map to one `InstancedMesh` each (`buildTramSectionGeometry` in `actor-models.js`), plus the bellows. All of them use
  `createTramMaterial` with the per-vertex `tramInfo` (half length, cab ±1/0, door z) and the per-instance `tramState`
  (brake, livery 0 Gamma / 1 Tramino / 2 Combino, doors open, display row = route + 1). The amber LED display above each cab's windscreen samples that row of `createTramDestinationTexture(GEO.tramRoutes)` (actor-models.js; line number, then the terminus; row 0 blank), mirrored per cab so it reads left to right from outside (not yet checked in a browser). The pantograph head is at `TRAM_PANTOGRAPH_HEAD` (5.5 m).
  Culling: the whole tram is tested against the frustum side planes (radius half its length + 6 m) and dropped beyond
  1.5 km. The upload, `hideEmpty` and zero-scale first-frames patterns are the same as for traffic. Per-frame code is
  allocation-free apart from refreshing the `trams` list.
- **Lights**: `tramLightSpec(cabLength)` in `vehicle-lights.js` gives `headlight`/`zFront`. A pool of 8 spots lights
  the 4 nearest trams in view, placed with the front section's matrix.

**Restart gate for committed cars.** A tram stopped (under 1 m/s) before a mapped road conflict may have released its
forecast while a car or bus committed to that curve. Before restarting it holds 0.5 m short of any conflict whose entry
is 0.2–5 m ahead while a vehicle (not itself waiting for a tram) is committed to the curve, on it, or still has its tail
on it after leaving (`_roadCarGate` keeps the gate until the vehicle clears). The ordinary sweep sees only a vehicle's
current position, so a fast crossing car was detected after the bodies met. A 10 m window held more trams and added a
car–tram wait cycle. Exempting a vehicle whose last leader is a tram proxy was tried (it can be waiting for the very
tram the gate holds) and measured as a no-op: reverting it left all 16 Jeżyce/Kaponiera runs bit-identical, so the
exemption is not in the code and the car-in-the-box release comes from the stopped-body sweep below.
`tools/audit-tram-overlaps.mjs` finds 55 car–tram body overlaps over 8 seeds × 7 districts (32 with the car moving
over 1 m/s), from 62 at the previous HEAD and 52 at 907b555; the [investigation](observations/tram-overlaps-2026-11-04.md)
records the runs, rejected variants and remaining clusters. The 2026-11-05 opposing-lane pass moves only Głogowska 3015
and Małopolska 3201, outside the sampled districts, so those pairs are unchanged; moving the Rynek Jeżycki stubs would
lower holds but raise the pairs and add a deadlock, so it is not in the code. At the 2026-11-07 tree (`10b4594`) the same
audit measures **138 → 71 pairs** (110 → 41 with the car moving over 1 m/s): Jeżyce 83 → 31, Centrum 24 → 8, Kaponiera
16 → 17, Stare Miasto 12 → 12, Rataje 3 → 3. The remaining stopped pairs are mostly cars touching a stopped tram in a
shared lane or parked in a close opposing lane; the moving Kaponiera pair is the short-link commitment race. The
2026-11-08 short-link pass (below) takes the default seed-4242 audit **9 → 5 pairs** (Kaponiera 4 → 1, Stare Miasto
2 → 0, Centrum 0 → 1 stopped) with no additional deadlock or car held over 120 s.

**Rear-end proxy for a tram waiting ahead.** `occupyTrams` dropped a lane's whole proxy when the tram was braking for
`t.obstacle`, wherever that vehicle was. A tram waiting behind a queue therefore had no proxy under its own body, and
following cars and buses drove into its rear in shared lanes (Jeżyce: eight pairs in the seed 4242 run, all with
`tramWait = car`, six in the `-2167, -498` cluster). The proxy is now dropped only when the obstacle is inside the proxy span, where
it must be allowed to clear. This is the 138 → 71 pair change above; seed 1 Jeżyce moves mean 16.0 → 15.7 km/h and
longest hold 32 → 36 s with no deadlock or car over 60 s there (Centrum stays at 62 s), and the seed 4242 deadlock is the
separate pedestrian box jam.

**Car in the box, tram waiting for it.** A lane proxy on a crossing must keep a stopped car's nose outside the tram's
body too: `pad` is (tram 1.2 + car 0.92 m) times the crossing's sine plus 0.5 m, so a car stopped at the proxy edge
clears the 1.2 m body. Before that, a car stopped 0.1 m inside it held the line 10 tram at Kaponiera's `-1468, 118`
link while the car waited for the tram's own proxy. Two more rules complete the release: a **stopped or slow car**
(under 1 m/s) already in a crossing stretch, or one already past the tram's body part, gets no proxy at all (it must
clear; the tram brakes for its body), while a moving car entering keeps the proxy — dropping it for every overlap let
cars at 3.5–8.7 m/s drive into a tram leaving its stop at `-1469, 114`; and the tram's sweep tests a stopped vehicle
against its actual rectangle in 0.5 m steps instead of the moving-car projection (which keeps a long bus's whole length
in the way). Taken together, the 8-seed Kaponiera mean longest hold falls from 163.5 s to 114.9 s, cars held over 120 s
from 49 to 8 and deadlocks from 3 to 0, while the edge-queue results are kept. The stopped-tram `near` rule in
`occupyTrams` (below) is part of that: reverting only it gives Kaponiera 137.8 s mean and 17 cars over 120 s (Jeżyce is
identical).

**Oncoming cars at a held curve.** `heldByTram` exempts a car the tram is following (its `obstacle`, a car right in
front of the nose, or one ahead in a lane the tram runs along), so that the tram does not hold its own leader. The
nose/lane exemption used a world-space projection and did not check heading: an oncoming car 30 m ahead of the tram but
approaching the same conflict from the other arm counted as "right in front". `drive()` ignores cars facing the tram
(heading dot below −0.5), so the tram then drove into it. The exemption now needs the car to travel the tram's way
(heading dot above 0.2) unless the tram is farther than `TRAM_ONCOMING_REACH` 8 m from the conflict, so crossing cars
just ahead of the nose of a tram at the conflict wait too; only `inTramLane` and the tram's own `obstacle` keep their
exemption. Over the 8 seeds × 7 districts this removes 13 pairs, 12 of them
in Stare Miasto, without moving cars held over 60 s / over 120 s (183 / 9) or the deadlock count (0).

**Short-link bus guard.** A bus can be longer than the edge after a connector (18 m on Kaponiera's 10 m link 7343), so
its front is already at that edge's far stop line when it enters. The connector out of it was never seen before the bus
was committed. `nextTramHoldsClose` checks the moves out of a short link from the upstream approach, and a committed
bus on a link shorter than its body refuses entry while a tram holds that next curve within `TRAM_STOP_REACH` 16 m of
it. The check is deliberately bus-and-short-link only: applying it to every committed vehicle, or to distant held
curves, blocked junction boxes and raised Kaponiera holds. The >4 m/s `enter` fallback remains for genuine can't-stop
cases, but a bus on a short link stops at the line rather than entering a tram body already over the curve
(`TRAM_HARD_REACH` 0). This removes Kaponiera bus 200 / tram 1 (seed 4242) and the seed 99 bus pairs. The remaining
overlaps are mostly cars: 10 at Kaponiera are mostly the same short-link blind spot, 27 are cars already stopped in or
near the tram envelope (15 before the line, 12 on a connector), and 18 are in Jeżyce, mostly buses. A blanket forecast
guard for cars on short links and a tram-body hard stop for every vehicle were both measured and rejected: they took
the three hot districts from 46 to 18–20 pairs but raised Kaponiera's mean longest hold to 134–153 s and cars held over
120 s to 15–32, with up to 4 deadlocks. **Browser check:** the hard stop in `enter` snaps speed to 0 from above 4 m/s,
a visible jolt chosen over driving into a tram; watch it at Kaponiera.

**Short-link car guard and restart gate (2026-11-08).** The moving Kaponiera/Centrum pairs are cars, not buses: a car
enters a 10 m link at 10–14 m/s, the exit curve is claimed by a tram, and the car cannot stop on the link. `mayEnter`
now calls `shortLinkTramBlocked` for every car entering a link under 12 m: when the comfortable stopping distance
`v² / 2b` no longer fits the link's room (`len − half − 0.5 m`) and the link's exit curve is held by a tram within
`TRAM_SHORT_REACH` 20 m, the car waits at the upstream line with `held: 'tram'`. A tram standing just before the curve
counts too (`tramStandsAt`), because a stopped tram reserves only its body but can pull away; the test skips a tram
dwelling at a stop, held by a red or at a route end, and the tram that is already waiting for this car. A car that can
stand on the link keeps the ordinary storage behaviour, and buses keep the longer-body guard above. On the tram side,
`ROAD_GATE_REACH` in `drive()` is 8 m instead of 5 m, and the restart gate also counts a car still on a short link that
cannot stop before the curve (`speed² > 2b(len − s − half)`) before `v.commit` is set. The default seed-4242 audit moves
9 → 5 pairs and the benchmark moves Kaponiera's worst wait 120 → 112 s, held over 60 s 13 → 11 and kept deadlocks and
cars held over 120 s at zero. Rejected while measuring: the same stand test in every short-link `tramBlocks` call or a
long-connector stop (Kaponiera worst wait 191 s, 12 cars over 120 s, five new Centrum pairs), the feeder two-step, and
the old `enter` hard stop for cars. [Measurements and mechanisms](observations/car-tram-overlaps-2026-11-08.md).

**Public contract for interactions** (car yielding, pedestrians, player collisions, audio):
- `tramSystem.trams`: the active trams, refreshed every update (the same objects as `tramSystem.pool`, filtered).
  Each has `id`, `model` (`'gamma'|'tramino'|'combino'`), `spec` (its `TRAM_MODELS` entry), `length`, `x, z, heading` (the
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
  passing within 2.2 m of the track. The current static snapshot has 822 directed tram edges totalling 130.4 km
  (different from physical track length: two-way chains contribute both directions). Of that, 12.9 km overlaps road lanes, merging overlapping lane runs
  on each track edge. Summing the lane runs separately gives 13.4 km: 11.0 km the lanes' way, 0.90 km against and
  1.47 km across; one stretch can map to more than one lane. There are 1803 track–junction curve mappings at
  335 distinct road nodes (a curve can map to multiple track edges).
- **Cars yield** (`traffic.js` `occupyTrams()`, at the end of `buildOccupancy()`). Each tram goes into the lanes under
  its body as a pooled proxy `occ` entry (`v.tram`, `half`, `speed`, `driver`, `v0`; `claimed: true`, `move: null`,
  `edge: null` so the merge/claim/turn checks skip it). In lanes running its way it reaches `4 m + speed × 1 s` ahead
  of the front and moves at the tram's speed; in lanes against or across it, it reaches `8 m + 6 s` ahead (at most
  `TRAM_REACH` 70 m) and stands still, so cars stop short of the track. A tram standing held by anything but a curve
  (at a stop, a red, behind another tram, at a switch, for a car) limits opposite/across-lane proxies to 2 m past
  its front; a stationary held tram reserves junction curves only up to its actual nose: holding the curves ahead of a tram that can't go kept the cars of a green approach waiting, and at a
  busy tram junction (Most Teatralny) cars waited 240 s through green and red. A stopped tram (`speed < 0.1`) also
  stops reaching for cars that are already past its nose: the usual 4 m + 1 s made a left-turner finishing in the box
  wait for a phantom stretch of tram that could not move. Reverting only this rule gives Kaponiera 137.8 s mean longest
  hold and 17 cars over 120 s (Jeżyce is bit-identical). The reach never covers a car already there (it ends 0.3 m
  short of it); a lane crossing the track gets no proxy while a stopped or slow car (< 1 m/s) or a car already past the
  tram's body part is in the stretch, but a moving car entering keeps it. A crossing proxy's `pad` is (tram 1.2 + car
  0.92 m) times the crossing's sine plus 0.5 m, so a car stopped at its edge clears the tram's body. Junction curves
  within the same reach are marked `held = tramFrame, by = tram`. For a signal approach shorter than 12 m, a tram's
  junction forecast ends at `tram.clearance` only if it can stop before that gate at 3 m/s². Gates include signals,
  switches, single-track blocks, downstream queues and occupied platforms; its actual body remains reserved. Cars can
  use the gap while the tram brakes; the tram itself still brakes for any car in its swept path.
  `mayEnter` refuses a held curve through `tramBlocks(v, n, f, j)`, except for
  the car the tram waits for (`tram.obstacle`), a car right in front of the front, or one ahead in a lane the tram
  runs along (`inTramLane`).
  `spawnVehicle` rejects places within 3 m of a tram body (`nearTram`); tram spawns reject track with a car on it.
- **Trams brake** (`drive()`): the path ahead is sampled every 2 m up to the braking distance + 12 m (≤ 70 m); cars,
  buses and the player whose OBB reaches into that swept corridor are IDM leaders at their speed along the track
  (`waitReason 'car'` / `'player'`), and so are pedestrians within `TRAM_HALF_WIDTH + PED_REACH` (1.7–1.9 m) of the centreline (`traffic.peds`, `'pedestrian'`, no bell). For a moving body the test keeps the whole rectangle in the way
  (a long bus's length projects onto the track normal); a stopped body (`speed < 0.3`) is tested in half-metre steps
  against the actual rectangle and the 1.35 m corridor, so a stationary car or bus standing clear of the tram body no
  longer freezes it. Bodies already beside the tram (gap < -1 m) are collisions, not leaders. Cars
  facing the tram are ignored: where a lane runs against the track a car can't back out, so waiting would deadlock (the
  proxies keep cars out of the tram's way there instead). The historical Phase 9 headless 10-minute run on the real
  network found no car or pedestrian overlapping a tram body after the first frame (3665 / 49 overlap samples without the interactions), no
  tram held 90 s.
- **Pedestrians** (`tramRoom(p)` in `walk()`): each walking track caches `route.tramCrossings` (where it crosses a
  track, and how far along it a pedestrian must stay clear, `2 m / sin(angle)`); a pedestrian stops short of the next
  crossing while `tramNear` finds a tram body over it or a front due within `PED_TRAM_TIME` 6 s, but not a tram standing
  short of it waiting for pedestrians (`waitReason 'pedestrian'`). Once at the clearance edge or just inside it
  (`before <= 0`, the old `-0.3` dead band included), a walker finishes crossing a tram that is standing short of the
  crossing and is neither over it nor moving: a stopped tram used to pin the walker there with zero room for good. A
  body over the crossing and a moving tram's 6 s lookahead still hold it; `walk()` records the binding term in
  `p.roomCause` for the `bench-traffic.mjs --ped-rooms` audit. The 2 m normal clearance includes the person's
  diagonal footprint, so a waiting pedestrian does not itself block the tram. Anyone already on the
  rails walks on. Standing on a crosswalk keeps them in `n.walkers`, so cars wait for them. A stop short of one track that lies within the reach of another (between the two tracks of a line) moves back short of that one, or, once on it, p walks on. Walking on the rails (`onRails`: within a crossing's reach) p ignores the queue ahead and closes up rather than stand in a tram's way. Historical Phase 15.5 headless measurement (3 min at each of six tram-strip crossings): pedestrians standing within 1.7 m of a track 10,439 → 0 samples, inside a tram body 6261 → 0–47 (people already on the rails walking past a tram stopped beside them).
- **Player** (`collideWithTram(t)` after the cars in `update()`): SAT (`overlapWithPlayer`) against every section OBB.
  The tram is immovable: the player takes the whole push, loses speed (up to 75% head-on) and, in the car, gets a
  bus-sized knock; a crash is reported with `b` = the tram (no `type`), not for a pedestrian.

## Vehicle lights and turn-signal conventions
- Model space: +Z is forward and **+X is the vehicle's left**. `carState` (vec4) = (brake, left/+x signal, right/−x signal, livery 0 none / 1 Policja / 2 ambulance / 3 fire). `busState` uses the same first three, and `.w` is the bus's route (destination sign row; the sign mesh shares the attribute). `v.blink < 0` means left. `pose()` sets the blink from a lane change (sign of `dl`) or from a planned turn within 35 m of the edge end or inside the connector. The flash period is 0.8 s, offset per vehicle by `blinkPhase`. Brake lights on street traffic come on at `acc < -0.8 || speed < 0.3`. The player's taxi uses the fixed-colour material variant and drives `material.userData.carState` from `controllers.js`. It is silver, and `createCarEntity` lays its own meshes over the body material's taxi marking and blank plates: a side stripe across both doors (y 0.55–0.71 m, one canvas per side, covering the chequer strip, crest and side number) and 520 × 114 mm Polish plates on holders larger than the painted plates, so those stay hidden whatever `actor-models.js` paints there. The player's stripe draws its own vector crest with `drawPoznanCrest()` (the same routine as the street taxis' texture), "TAXI" and "POZNAŃ" on the front door, and the side number in the official white panel with a black frame on the rear door. The crest and the city's marking rules are public-domain municipal symbols (art. 4 of the Polish Copyright Act); the drawing follows the Statut Miasta Poznania and the § 10 taxi marking resolution (XX/342/VIII/2019), keeping the model's yellow-and-black chequer for visibility instead of the official 4 cm white-and-black squares.
- Lamps are painted by the TSL material from spec numbers: `headlight`/`taillight` = [centre |x|, y, half-width, half-height]. The front turn signal is the outer ~30% of the headlight. The rear turn signal is the **outer** section of the tail lens (fixed in 168c3a4; it used to be inner) and reverse is the opposite end. When `tlH > tlW` (crossover, van) the sections stack vertically, so the turn signal is the top section.
- Add new body specs inside `BODY_SPECS` (taxi is `Object.assign` of saloon). Optional spec keys: `sideGlassRear` (side glass panelled over behind this z: the hatch's and crossover's thick rear pillar, the van's cargo box), `glassTop` (no glass above this y: the van's high roof), `backlight: false` (no rear window), `panelVan` (door seams, split rear doors, PRM/PSP rear chevrons and a high stop lamp on the upper body), `barT` (light bar position along the roof). Emergency livery bands are not spec keys: `createLoftedCarMaterial` selects them from `carState.w` (see [Emergency-service markings](#emergency-service-markings)). `tests/vehicle-models.test.cjs` pins the class dimensions, the plate layouts, the plates' clearance from bumpers and lamps, and the emergency paints, atlas rows and badges.
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
