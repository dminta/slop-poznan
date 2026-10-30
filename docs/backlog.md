# Poznań backlog

Updated 2026-10-30. The port and documentation cleanup are implemented; the remaining work is below.
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
  rear clearance; WebGL2 remains a separate open item.

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

## Known gaps and follow-up investigations

| Topic | Remaining work | Original reference |
|---|---|---|
| WebGL2 fallback | Diagnose `GL_INVALID_OPERATION: glDrawElements: Vertex buffer is not big enough for the draw call`, observed on both the pre-change and final signal-timing snapshots. A clean WebGPU boot does not validate this backend. | 16 |
| Railway crossings | Restore sidewalks under rail bridges without joining blocks into filled rings; model raised track/viaduct decks and add level-crossing barriers. Current roadways are clear, while the railway remains flat. | 15.8 |
| Zebra visibility | Keep crossings over ballasted tram track visible; the bed can still cover their paint. | 15.8 |
| Missing signal head | Find a safe position for the approach near Krucza/Zamenhofa at `675, 2738`; both curbs are close to track. Recount any other missing heads against the full scene before choosing fixes. | 15.5 |
| Hetmańska geometry | Confirm the two remaining visual candidates before changing them: outer lanes about 0.5 m beyond the three-lane carriageway, and rails over a 0.22 m curb sliver near Dmowskiego at `−2448, 2214`. The reported 80 m road gap under the Górczyn railway bridge was fixed. | 15.8 |
| Sparse OSM blocks | Check the nine large blocks with under 5% mapped building coverage against BDOT10k; supplement only confirmed omissions. The original audit covered 0.69 km² and needs rechecking against the current enlarged box. Verify source terms before adding data. | 14.3 |
| Footbridges and camera | Add Most Jordana, the Brama Poznania footbridge and the Berdychowskie crossings to the data/models. Revisit the `katedra` camera, currently above the Cybina, and test landmark lines of sight. | 4, 7, 12.3 |
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

The existing WebGPU smoke check confirms boot, shader compilation and a clean console for the signal work.
The static measurements refreshed on 2026-10-29 use the documented headless variants in [world.md](world.md)
and [actors.md](actors.md); they do not validate the full rendered scene or sound.

- Observe signals and traffic at Kaponiera, Most Teatralny and Głogowska/Hetmańska; test pedestrian requests,
  the Św. Marcin green wave and crossing ticks against the displayed heads.
- Watch whole trams clear switches, crossings and occupied stops; observe Zawady/Ogrody loop boarding and
  return destinations and the Starołęka boundary routes.
- Inspect landmark placement, scenic-camera sightlines, roof normals/ridges on rotated blocks, panel-material
  shimmer, balcony LOD transitions, railway crossings and track cuts in squares. Check platform/slab flicker
  where their surfaces are only 1 cm apart.
- Check load time and frame rate over the enlarged detail box, roof/dormer coverage and pool limits, estate
  slabs and transitions to the outskirts. The balcony pool was close to its limit in the historical scan.
- Listen to sirens, bells, tram motors/squeal and the noon show; verify their local timing and audible range.
- Verify map labels/pin clustering, English UI with Polish names, metric readings and the WebGL2 fallback
  after resolving its known draw-buffer error.

For each implemented fix, record the before/after measurement, run the relevant regression checks, and state
which browser checks were actually performed. Keep unresolved items here rather than reopening archived phase notes.
