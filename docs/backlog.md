# Poznań backlog

Updated 2026-10-31. The port and documentation cleanup are implemented; the remaining work is below.
Implementation details live in the [topic docs](../AGENTS.md#docs). Original phase numbers refer to the
[archived port plan](archive/poznan-plan.md), which retains historical measurements and decisions.

## Dworzec crossings: connected route implemented

- **Refuge accessibility fixed:** existing median surfaces now permit walking while still blocking cars. This
  restores the crossing onto the western island near `−1589, 562` (node `−1592.6, 579.6`); the grid-and-furniture
  snapshot goes from 0 to 1 crossings within 100 m of the central node. Regression coverage checks the actual
  curbs and furniture, unchanged car lanes and 2 m rail clearance at restored waiting positions.
- **Central connection implemented:** a shared crossing over two same-phase carriageways joins the western refuge
  to the southern sidewalk near `−1558, 579.5`. Crossings within 100 m increase from 1 to 2. Exact-coordinate tests
  walk the real pedestrian links in both directions; they retain queued-roadway and 2 m rail-waiting clearance
  checks. Connector reservations cover the actual crossing and a bus's rear after it leaves the connector.
- **Browser inspection (2026-10-30, commit `482ebdf`):** local Chrome/WebGPU, Midday, full scene. Walked the western
  zebra onto the refuge and the shared connection to the southern sidewalk and back. The shared zebra is visible
  on the carriageway and the player can traverse the connection in both directions. The console contained eight
  informational builder/init messages and no errors or warnings at the console check. These are manual spot
  checks, not a recorded continuous traffic trace or a WebGL2 check.
- **Return-direction head fixed (2026-10-30):** added a southeast-facing pedestrian head on the western refuge at
  `−1580.5, 552`, using the central junction's existing `walk1` plan. The completed grid-and-furniture regression
  checks its facing from the real southern landing, its pole footprint, unchanged car lanes, clear refuge links
  and full rail clearance. The full browser scene now has 1304 pedestrian heads/poles (previously 1303).
- **Refuge planting fixed (2026-10-30):** a 3 m corridor through the hedge follows the measured refuge link, with
  1.5 m end padding. The local hedge area changes from 45.949 to 33.451 m²; northern planting remains. Tests observe
  the polygons actually extruded and verify clear walking/waiting space. Median slabs and traffic blockers stay.
- **Traffic verification completed (2026-10-30, `d2ebe36`):** full Chrome/WebGPU scene, Midday. Recorded
  pedestrian-related stops on both protected carriageways; the turning movement was additionally checked with
  opposing traffic excluded as the cause. Two controlled 12 m bus trials verified the rear-clearance reservation
  across connector handoffs, with rendered inspections of the rear over the zebra and subsequent clearance.
  In the measured release trial, the NPC began walking about 0.53 s after the first sampled body clearance.
  These bus trials started with an already committed bus; a natural end-to-end bus approach was not recorded.
  See the [observation record](observations/dworzec-2026-10-30.md) for setup, timings and limits.
- **Validation after both fixes:** `node --test tests/` passes 280/280 (38.25 s), including head orientation,
  rendered hedge geometry, bidirectional connectivity, vehicle rear clearance and unchanged traffic-flow limits.
  The initial regression for each visual defect failed before its fix. Browser recheck uses a hard reload to
  bypass cached modules; WebGPU boot and console checks pass. Walked the route in both directions through the
  clear hedge corridor; observed red and green on the new head from the southern landing, and checked visibility
  of the existing head from the refuge. The later traffic observations above cover yielding and controlled bus
  rear clearance; the Dworzec route and traffic interaction still need a targeted WebGL2 check.

## Bus pool availability fixed

- Cars could fill every local density slot before a bus received a placement attempt. The pool now reserves its
  proportional bus share within the same total target, only where a nearby major road can accommodate a bus.
  Safe-placement failures leave room for later retries; the normal four-attempt budget remains unchanged.
- Seeded furnished-network Dworzec measurement, 120 s: **72 cars / 0 buses → 67 cars / 5 buses**, 72 vehicles total.
  A naturally spawned bus approached and fully cleared the shared zebra. Full Chrome/WebGPU inspection also
  confirmed five active buses and natural movement through the junction. The geometric zebra-clearance measurement
  was headless; a complete rendered pedestrian interaction trace and WebGL2 remain outside this check.
  See the [observation record](observations/bus-population-2026-10-30.md) for method, timings and limits.
- Validation: `node --test tests/` passes 286/286 (36.30 s), including six new population regressions and the
  unchanged Jeżyce/Centrum traffic-flow limits.

## WebGL2 pedestrian rendering fixed

- The undersized draw-buffer error came from pedestrian pose storage, reproduced with one `PeopleNear` mesh.
  WebGL2 bound 31 pose vec4s as per-vertex input for 2189 vertices. Enabling indexed PBO texture reads fixes the
  draw; invalidating that texture after CPU updates also prevents frozen animation. WebGPU keeps storage buffers.
- Two-frame rendered checks cover both pedestrian LODs. Full Edge WebGL2 and WebGPU scenes booted and rendered
  60 frames with no console errors or warnings; WebGL2 recorded 76,154 draws and no GL errors. These are smoke
  checks, not a complete visual or performance audit. See the [observation record](observations/webgl2-2026-10-30.md).
- Validation: `node --test tests/` passes 289/289 (33.27 s), including pose packing, PBO uploads, padded buffer
  replacement and ordinary WebGPU storage uploads.

## Zebra visibility verified

- The remaining ballast-occlusion report was stale: the existing 1.7 m rail cuts and narrowed tram beds already
  keep the paint visible. The furnished-network regression finds **0 m²** of zebra/ballast overlap across 2563
  zebra pieces and 7760 ballast beds. Disabling the rail cuts reproduces the conflict on the same crossings.
- Full Chrome scenes on WebGPU and forced WebGL2 confirm zero overlap using actual mesh buffers and instance
  matrices; the closest paint-to-bed gap is 0.386 m. Midday rendered spot checks show visible stripes and the
  deliberate unpainted track corridor. No production geometry change was needed.
- Validation: `node --test tests/` passes 290/290 (36.60 s). See the
  [observation record](observations/zebra-visibility-2026-10-30.md) for scope and limits.

## Krucza signals restored and Hetmańska inspected

- **Krucza/Zamenhofa:** restored vehicle heads on both live Krucza approaches at junction `699.25, 2750.75`.
  The historical short approach near `675, 2738` is removed/disabled by the furnished network.
  A large park bounding box incorrectly excluded the sidewalks. The surveyed approaches now check the actual park
  outline, retaining the normal road, rail and crossing clearances. The eastern approach starts pole search at
  `dt >= 6.0 m` along the curb, preserving 4.51 m clearance to the right-turn swept path into Zamenhofa.
  Vehicle heads **743 → 745**, pedestrian heads/poles **1304 → 1306**; all furnished-network lanes, crossings
  and other furniture remain unchanged.
- **Hetmańska:** the examined three-lane runs keep their outer lane centres 1.3 m inside the 9.8 m carriageway.
  The historical 0.5 m excess describes a nominal 3.6 m lane envelope, not a centreline outside the roadway;
  no lane-placement change was justified. The Dmowskiego curb/rail conflict was confirmed here and fixed in the
  follow-up below.
- Validation: **296/296** tests pass (33.33 s). Full Edge WebGPU and forced WebGL2 scenes rendered at least 60
  frames without captured console warnings/errors on the final runs. The restored heads were viewed on both
  backends; WebGPU spot checks observed red and green. Hetmańska received WebGPU geometry spot checks.
  See the [observation record](observations/krucza-hetmanska-2026-10-31.md) for measurements and limits.

## Hetmańska/Dmowskiego curb conflict fixed

- The surveyed 47.5 m² empty curb island near `−2446, 2204` lay entirely inside the standard 2.2875 m
  clearance corridors of the two tram tracks. Cutting both corridors removes the whole island; neighbouring
  sidewalks remain. The same exclusion in `blockAt` keeps rail, pedestrian and player ground queries consistent
  with the emitted geometry. Generated geodata is unchanged.
- Raised rail length **7.992 → 0 m**, conflicting curb area **47.5 → 0 m²**. Regressions record actual curb/slab
  extrusion and replay the pre-fix configuration: furnished-network lanes, crossing endpoints and furniture
  footprints remain unchanged. Both new symptom checks failed before the fix.
- Validation: `node --test tests/` passes **296/296** (38.63 s), including unchanged traffic-flow regressions.
- Full Chrome WebGPU and forced WebGL2 scenes rendered at least 60 frames without captured console warnings or
  errors. Midday spot checks from above and street level show exposed, continuous rails without the raised slab.
  These are geometry checks, not a continuous tram/traffic interaction trace. See the
  [observation record](observations/hetmanska-clearance-2026-10-31.md).

## Footbridges added and katedra scenic view established

- Added three pedestrian and bicycle river crossings to `city-config.js` (`FOOTBRIDGES` merged into `BRIDGES`):
  * **Most Biskupa Jordana**: red tied steel arch bridge across Cybina, span 64.1 m, width 14 m, fully paved with
    sidewalk stone without asphalt roadway.
  * **Kładka Bramy Poznania**: covered glass-walled footbridge gallery across Cybina connecting ICHOT to Śluza Katedralna.
  * **Mosty Berdychowskie**: modern haunched girder footbridge across the Warta and Cybina with tip connector on Zagórze.
- The land raster (`LAND_CODE = 2`) now automatically rasterizes these corridors, making `isLand = true` and `isWater = false`
  across the crossings, enabling walking and cycling across the rivers without player `clampToLand` rejection.
- Vehicular traffic network (`GEO.roadGraph`) remains unmodified (8,756 edges, 11,650 lanes); no cars route onto footbridges.
- Parapet colliders (201 total bridge colliders) along both edges protect players from falling into the river.
- The `katedra` scenic camera preset (`1148, 8, -336`) now stands on Most Jordana (`isLand = true`) with an unobstructed
  westward line of sight to Archikatedra across Cybina.
- Validation: `node --test tests/` passes **301/301** (33.38 s). See the
  [observation record](observations/footbridges-2026-10-31.md).

## Railway level crossing barriers and signals added

- Added 28 level crossing barrier mechanisms (`CrossingBarrierCabinets`, `CrossingBarrierBooms` with red/white
  striped procedural material) and 28 St. Andrew's cross warning signals (`CrossingSignalMasts`, `CrossingStAndrewCrosses`,
  `CrossingSignalLamps`) across all 5 active level crossings covering 25 `GEO.levelCrossings` nodes on public streets
  (ul. Św. Michała, ul. Krańcowa, ul. Bałtycka, ul. Gdyńska, ul. Wrzesińska).
- Positions strictly respect road clearance (`roadDist >= 0.15 m`), vehicle lane envelopes (`laneDist >= 1.85 m`),
  rail structure gauge (`railDist >= 2.6 m`) and tram clearance (`tramDist >= 3.0 m`).
- Barrier drive cabinets and signal masts add physical colliders outside vehicle lanes.
- Roadway network and traffic flow remain 100% preserved (8,756 edges, 435.479 km).
- Validation: `node --test tests/` passes **305/305** (33.45 s). See the
  [observation record](observations/rail-crossings-2026-10-31.md).

## Park bounding box signal restoration implemented

- Extended exact park polygon outlines (`exactPark`) across all park-bordering sidewalks in `js/street-details.js`,
  recovering candidate approaches previously suppressed by the 13.26 km² excess AABB bounding boxes of irregular parks.
- Preserved 100% of drivable network lanes by starting candidate pole search at `dt >= 6.0 m` along the curb for unblocked
  approaches, avoiding turning curve swept paths (`pathClear` 0.8 m); adapted Szelągowska to `dt >= 8.4 m` and Miliana
  to `dt >= 7.2 m` to clear adjacent lane envelopes, while dropping candidate side 1 on Baraniaka.
- Vehicle heads **745 → 896** (+151), pedestrian heads / audio signals **1306 → 1578** (+272), adding 274 signal poles across
  128 junctions and 77 streets (e.g. Garbary, Szelągowska, Al. Armii Poznań, Sołacz, Malta, Rataje, Warszawska, Winogrady).
- Physical clearances strictly verified: 100% of restored poles satisfy `roadClearance >= 0.8 m` and `railClearance >= 2.22 m`.
- Roadway network (8,715 edges, 11,577 lanes), pedestrian crossings, and non-signal street furniture remain 100% unchanged.
- Validation: `node --test tests/` passes **305/305** (34.85 s). See the
  [observation record](observations/park-signals-2026-10-31.md).

## Known gaps and follow-up investigations

| Topic | Remaining work | Original reference |
|---|---|---|
| Railway viaducts and underpasses | Restore sidewalks under rail bridges without joining blocks into filled rings; model raised track/viaduct decks bridging cut tracks over roadways. Level-crossing barriers are implemented. | 15.8 |
| Other missing signal heads | Park bounding box candidates (266 approaches) are restored. Remaining unmatched incoming edges are investigation candidates on curved approaches with `dot` between 0.70 and 0.98 or offset > 45 m. | 15.5 |
| Park bounding boxes | Signal placement exclusions from park bounding boxes are resolved across all 128 junctions (896 vehicle heads, 1578 pedestrian heads). Remaining follow-up is optional exact polygon checks for non-signal street furniture (lamps/trees/benches). | Follow-up |
| Sparse OSM blocks | Check the nine large blocks with under 5% mapped building coverage against BDOT10k; supplement only confirmed omissions. The original audit covered 0.69 km² and needs rechecking against the current enlarged box. Verify source terms before adding data. | 14.3 |
| Building accuracy | Replace estimated landmark heights and massing where supported by measurements; real building footprints/roof heights remain optional. Candidates include Ratusz, Fara, Zamek Królewski, Teatr Wielki, Brama Poznania, tower placements, Iglica and AND2. | 4.4, 7 |
| Tram route quality | Re-measure global off-route samples after the Zawady/Ogrody/Starołęka membership correction. The loops have coordinate regressions; the former off-route percentages are historical. | 15.10 |

## Decisions awaiting the user

- **Buildings inside 13 park blocks:** the existing recommendation is to leave them unbuilt. Their OSM buildings
  explain some whole-district density differences in Sołacz and Antoninek; see [world.md](world.md).
- **Real Poznań hejnał:** the noon show currently uses a generic natural-trumpet call. Decide whether to replace
  it with the real melody and establish a suitable source before implementation.

## Optional features and fidelity

- Trams: PST, Kaponiera tunnel portals, Siemens Combino and visible white-bar signal heads. The current models
  are Gamma and Tramino; tram control uses the shared local signal plans.
- Vehicles: an articulated 18 m bus and a PSP truck instead of the current rescue van; verify the registration
  atlas appearance on systems without Arial Narrow/Arial. Taxi crests and exact livery/marking fidelity require
  source verification before use.
- Street details: conditional S-2 arrows, pedestrian countdowns, P-22 BUS text with actual bus-lane data, a fourth
  tree species and real OSM tree positions.
- Traffic: passing a waiting left-turner on a wide single-lane approach, such as Łazarz at `−1875, 1299`.
  This needs lane and swept-path safety work. Kaponiera and Wilda retain substantial queues despite meeting the
  aggregate flow targets.
- Geodata semantics: road levels and richer road-priority classification; revisit only with a runtime consumer.
  Additional height sources (nDSM/LoD1/LoD2) and GEOPOZ machine-readable data remain research candidates.

## Browser checks still outstanding

Full-scene smoke checks on 2026-10-30 confirmed boot and 60 rendered frames on both WebGPU and WebGL2, with
no console warnings or errors; the WebGL2 check also recorded no GL errors. The two-frame pedestrian probes
verified pose updates on both LODs. These checks do not establish detailed appearance, traffic correctness or
performance; see the [WebGL2 observation record](observations/webgl2-2026-10-30.md).
The static measurements refreshed on 2026-10-29 use the documented headless variants in [world.md](world.md)
and [actors.md](actors.md); they do not validate the full rendered scene or sound.

Partial signal/traffic observations on 2026-10-30 covered the full Chrome/WebGPU scene at Kaponiera (150.01 s),
Most Teatralny (150.01 s) and Głogowska/Hetmańska (194.76 s), in simulation time. Nearby shared signal states
recorded the vehicle phase pairs and steady green, flashing green and red pedestrian display states. The trace
also recorded pedestrian waiting/release and tram movement transitions, with rendered spot checks. Only two
ordinary uncommitted car entries were captured across the three locations, both on green; previously committed
and emergency entries were counted separately. This is limited traffic coverage, not a general compliance verdict.
Shared state does not prove visible head orientation/colour, and sampled tram views do not prove full-body rear
clearance.

A 2026-10-31 follow-up on the same commit (`369c21b`), Chrome/WebGPU, observed demand node `2422` at
`415.5, 523` for 145.0001 simulation seconds. Natural NPC requests produced three complete pedestrian service
cycles, with 20 s road-green intervals between them; all five recorded waiting-to-release transitions occurred
on WALK. Rendered spot checks showed NPCs on the zebra. This covers one demand crossing, not all demand plans
or visible-head correspondence. Remote cached-phase observations of Św. Marcin nodes `1671` and `1673` recorded
65 s periods and green0 starts 1.775–1.776 s apart, against 1.777175 s expected for 19.7464 m at 40 km/h.
This checks the shared phase offset of one pair; it does not establish full rendered corridor progression.
Broader demand coverage, the full Św. Marcin green wave, audio and WebGL2 junction behaviour remain open.
See the [signal observation record](observations/signals-2026-10-30.md) for setup, results and limits.

- Continue targeted signal and traffic checks at Kaponiera, Most Teatralny and Głogowska/Hetmańska, including
  visible head correspondence and WebGL2; extend NPC demand-request coverage beyond node `2422`, test the full
  rendered Św. Marcin green-wave corridor and crossing ticks against the displayed heads.
- Watch whole trams clear switches, crossings and occupied stops; observe Zawady/Ogrody loop boarding and
  return destinations and the Starołęka boundary routes.
- Inspect landmark placement, scenic-camera sightlines, roof normals/ridges on rotated blocks, panel-material
  shimmer, balcony LOD transitions, railway crossings and track cuts in squares. Check platform/slab flicker
  where their surfaces are only 1 cm apart.
- Check load time and frame rate over the enlarged detail box, roof/dormer coverage and pool limits, estate
  slabs and transitions to the outskirts. The balcony pool was close to its limit in the historical scan.
- Listen to sirens, bells, tram motors/squeal and the noon show; verify their local timing and audible range.
- Verify map labels/pin clustering, English UI with Polish names and metric readings on both backends. The WebGL2
  draw-buffer error is fixed; detailed fallback appearance and performance checks remain.

For each implemented fix, record the before/after measurement, run the relevant regression checks, and state
which browser checks were actually performed. Keep unresolved items here rather than reopening archived phase notes.
