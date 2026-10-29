# Poznań backlog

Updated 2026-10-29. The port and documentation cleanup are implemented; the remaining work is below.
Implementation details live in the [topic docs](../AGENTS.md#docs). Original phase numbers refer to the
[archived port plan](archive/poznan-plan.md), which retains historical measurements and decisions.

## Next: pedestrian crossings at Dworzec

- **Refuge accessibility fixed:** existing median surfaces now permit walking while still blocking cars. This
  restores the crossing onto the western island near `−1589, 562` (node `−1592.6, 579.6`); the grid-and-furniture
  snapshot goes from 0 to 1 crossings within 100 m of the central node. Regression coverage checks the actual
  curbs and furniture, unchanged car lanes and 2 m rail clearance at restored waiting positions.
- **Central connection remains open:** the six-arm node near `−1567.23, 560.23` still has no crossing. Its
  candidate landings either miss a curb island or overlap another approach's queued roadway. Two refuge
  polygons already exist in the committed geodata, so missing islands alone do not explain the failure.
- Design a connected route through the whole junction complex, coordinating the curb/refuge geometry with the
  road stop lines and pedestrian signal ownership. Preserve the checks against other roadways and unsafe rail
  waiting positions. Rebuild geodata if its geometry changes and add exact-coordinate connectivity regressions.
  See [world.md](world.md) and [actors.md](actors.md) for the current rules.

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
| Geodata tests | Add a fresh-build comparison against the committed `js/geodata.js` and explicit coverage of all 25 landmark sites. Repeated identical builds alone do not check the committed file. | 4, test checklist |
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
