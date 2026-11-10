# Archived implementation plan: replacing New York with Poznań

Archived on 2026-10-29 after the Phase 12.5 documentation update. This is a historical record: status notes,
counts and instructions below describe their original milestones and may contradict later entries.
Use [the current backlog](../backlog.md) for remaining work and the [topic documentation](../../AGENTS.md#docs)
for the current implementation. Phase 12.5 is complete; the former handoff below is retained for context.

Status: **Phases 1–11 done, with open items** (each phase heading carries its own status note; Phase 9 skips PST, the
Kaponiera portals and the Combino; Phase 10 the articulated bus, the S-2 arrow and the taxi crest; Phase 11
the S-2 arrow, signal countdowns, "BUS" lane text, a 4th tree species and real OSM tree positions). The 2026-10-27 audit
found further gaps; its six functional gaps were fixed on 2026-10-28, the rest is listed in **Open items from the
2026-10-27 audit** below. Phase 12 is done except the docs rewrite and the
archiving in 12.5. Phase 15 items 1–5 and 7–10 are implemented; 6 is continued in Phase 16.
Phase 16 is implemented and meets its headless targets (2026-10-29), with a WebGPU boot/console smoke check;
the detailed browser checks below remain open.
Line references are as of commit `46ec12b` and will drift; grep for the named symbol if a line no longer matches. Read `AGENTS.md` and the topic docs (`geodata.md`, `world.md`, `rendering.md`,
`actors.md`, `audio.md`, `architecture.md`, `testing.md`) before starting any phase. They hold the repo-wide rules
(modulepreload + boot count, module syntax, source-sliced tests, generated geodata, CSS `?v=` bump).

## Handoff: where to start (updated 2026-10-29)

The working tree passes `node --test tests/` (271 tests, about 34 s). Phase 16 has a WebGPU boot/console smoke check;
full corridor observation and audio checks remain manual, as does the detailed visual review of earlier phases.
The user tests in the browser and reports bugs back, so read those reports literally and probe with real coordinates
before fixing.

**Next task: the docs rewrite and archiving (12.5).** The static counts in `world.md` and `actors.md` were re-measured
on 2026-10-29 (15.9); both docs describe the headless snapshot and its differences from the traffic benchmark and
the full browser scene. Phase 15.10 completes the Zawady/Ogrody loops and Starołęka boundary routes. Phase 16 fixes the signal,
tram clearance and opposite-track lane items from 15.6; its measurements and remaining manual checks are below.

**Remaining work, in this order:**
1. Phase 12.5: the docs rewrite and archiving this plan.
2. The central Dworzec node zebras (medians and tram strips as blocks in `tools/`).
3. Optional skips from Phases 4 and 9–11 (listed in the audit section), including passing a waiting left-turner (16.5).

**Decisions pending with the user:**
- Whether to build in the 13 park blocks (15.7). The recommendation is no.
- The real hejnał melody (12.1). The current one is a generic bugle call.

**Working rules that have paid off:**
- One worktree agent per disjoint file set.
- Agents never edit this plan; the coordinator records results here.
- Never hand-merge `js/geodata.js`; rebuild it from `tools/` after the merge.
- Every fix gets a headless measurement before and after, plus a regression test.
- Report in the final message what could not be verified in a browser.

## Open items from the 2026-10-27 audit

A read-only audit compared every Phase 1–11 deliverable with the code at `a37d2d8`; `node --test tests/` passed (168/168).
About 300 items checked out. The items below are what is left.

**Functional gaps: fixed on 2026-10-28** (checked headless, 189/189 tests; none of it seen in a browser yet):
1. **Tram tracks on Ostrów Tumski** (Phases 4, 9, 11). The snapshot was not stale: OSM tags the line as closed for
   rebuilding (`railway=razed` on Most Chrobrego, `disused` from Pl. Wielkopolski via Katedra and Most Mieszka I to
   Rondo Śródka and on the Fredry curve, `construction` on Most Teatralny), so a `railway=tram` filter dropped it. The
   build now keeps such ways when a `route=tram` relation lists them (`poz_tram_routes.json`, 59 ways): tram links
   599 → 666, stops 121 → 129. Still without a stop: a Pl. Wielkopolski node on a disused siding and a Stare Zoo node in
   the old depot yard. The Most Teatralny link 1.5 m from a track was a perpendicular crossing, correctly skipped.
2. **Tram line routes** (Phase 9, step 2): `GEO.tramRoutes` (36 one-direction routes of 19 day lines from OSM), route
   following at switches with a terminus turn, `line`/`destination` on each tram and on the cab LED display. A build bug
   that merged switch branches with different attributes into one chain was fixed on the way (chains 249 → 367).
   1.2% of tram samples were off-route in a 10-minute headless run.
3. **Zebras over medians and tram strips that are not blocks** (Phase 11): split crossings in `pedestrian-routes.js`
   (gap 3.2–14 m, paired across the strip). Zebras 1375 → 1385, Dworzec 0 → 2; only 7 split crossings city-wide. The
   central Dworzec node is still bare; the real fix is still medians/tram strips as blocks in `tools/`. Unchecked:
   people waiting on a strip stand at the rail edge, and split zebras may be painted up to the rails.
4. **Crossers at unsignalised zebras** (Phase 2): `nearSignals` → `nearCrossings`, drawn from the 695 junctions with
   a crosswalk (129 signalised). The effect of the extra yielding on traffic flow is unmeasured.
5. **Phase 8 features**: instanced dormers (10,472, ≈ 136k triangles, roof pool 32k → 64k), stepped and volute Rynek
   gables, and the Śródka mural square at ul. Śródka 3 (`SRODKA_MURAL`, `landmarks-heritage.js`). Dormers are the
   costly item: lower `DORMER_P` / `DORMER_MAX` if the browser frame time suffers.
6. **Map**: the empty highways layer and the dead `#minimap-street-label` code are gone; the legend says "Bridge". Open:
   pin dots overlap at low zoom around Stary Rynek and Andersia, and "Kiss & Ride & Zachodnia" clashes with the HUD's
   " & " street join.

**Skips not recorded in the phase bodies until now:**
- Phase 9: there is no Combino (only Gamma and Tramino) and no white-bar tram signal heads. Trams obey S-1 groups that
  nobody can see.
- Phase 10: the taxi side stripe has no city crest (code comments say "licensing").
- Phase 4:
  - §4.4 (real heights and footprints) is not done.
  - There is no `poz-parks.mjs`; parks live in `poz-extra.mjs`.
  - Półwiejska is not in `plazas`; it is a linear way.
  - There are no footbridges (Jordana, Berdychowskie) in any snapshot.
  - Road pieces have no `level` field.
  - Rail `tracks` is always 1.
  - No test checks determinism against the committed file.
- Phase 2: `major` ignores the OSM class (width and lanes only).
- Phase 1: `RAISED_GROUND` (planned as `RAISED_LAWNS`) takes rectangles only and is always empty.
- Phase 6 and Phase 3 (fixed 2026-10-28): GRUNWALD and WINOGRADY district titles over their osiedla, pins for all 25
  landmarks, and the altitude readout through `formatCount`.

**NYC leftovers that no phase covers** (add them to Phase 12.5):
- Visible:
  - Sidewalk, curb and manhole materials (`js/tsl-materials.js:1633–2003`): "5 ft NYC concrete flags", the NYC granite
    curb, NYC Parks hex pavers, the ConEd manhole and the NYC Parks globe lamp. Phase 11 never mentions surfaces.
  - The helicopter's Manhattan Sightseeing livery (`js/actor-models.js:1704`, `:1955`, `:2014`).
  - The NYC bus body (`:1389`).
- Dead code:
  - The Times Square billboard canvas and material (`js/tsl-materials.js:2046–2360`, still exported).
  - `createHighwayTraffic` with its FDR / West Side Highway comments (`js/traffic.js:2443`, `:2696`). `highwayLanes` is
    `[]`.
  - `chainCoastline`, `elemRing`, `Raster.keepLargest` and `Raster.traceOuter` in `tools/geo-util.mjs`.
  - The `0xffbe14` taxi yellow on the wheel material (`js/traffic.js:195`).
- Names:
  - `blk.fireEscapes` / `fireEscapeSystem` (`js/buildings.js`, `AGENTS.md`).
  - The `'Manhattan Night · 23:00'` preset, and the camera far plane sized for 13.6 km of Manhattan (`js/lighting.js:112`,
    `:158`).
  - `keyboardHarness(nyc = {})` in `tests/controllers.test.cjs`. The Phase 12.5 grep for `NYC` is case-sensitive.
- Comments:
  - `geo-blocks` / `geo-roadgraph` / `geo-extra` references in `tools/poz-*.mjs`.
  - `js/scene-culling.js:4` and `js/city-grid.js:724`.
  - "the NYC plane" in `tests/trees.test.cjs`.
  - `js/landmarks-rynek.js:6`, `:64` (says Phase 8 reuses `buildArcadedHouseRow`; it doesn't).
  - `css/style.css:3` ("blue" plates; they are graphite with a blue strip).

**Plan text the audit corrected in place:** D12, the §6 checklist, §9.1 Stary Browar, §9.2 counts, §9.4, and the Phase 8,
Phase 11 and Phase 12 notes. Some status notes keep their historical numbers on purpose: 32 preloads and 129 tests at
Phase 5 (now 41 and 168), 1851 crosswalks in Phase 11 (now 1374), 1.26 MB geodata (now 1.29 MB). The §2 contract table
is also superseded by `docs/geodata.md`. It does not list `landHoles`, `outskirtsHoles`, `tramStops`, `rail[].oneway`,
`water[].holes` or `kind:'pond'`. `roads` names are raw OSM names with no "ul.", and `dir` is never -1 because pieces
are reversed. The road graph is 213 KB with 3,903 links. The landmark `h` rule also accepts OSM `height` when it is at
least max(6, levels × 3.4).

**Not yet verified in a browser:** the rendering from Phases 7–11, including the WebGL2 fallback for instanced roofs.

## 0. Summary

Two things carry the NYC content:

1. **The geodata pipeline** (`tools/` → `js/geodata.js`). It reads NYC Open Data formats (CSCL, DCP, NYC Parks) and
   calibrates the world frame on the Manhattan grid.
2. **One runtime model of the city.** "A detailed island surrounded by water, cut by a grid of avenues × numbered
   streets." It appears as:
   - `getIslandBoundsAtZ`, `ISLAND_BOUNDS` and `MANHATTAN_COASTLINE`;
   - `AVENUES`/`STREETS`/`ALL_AVENUES`/`ALL_STREETS`, `streetZ`, `avenueX`;
   - the avenue corridors in `road-network.js`;
   - `AVENUES × STREETS` signals in both `road-network.js` and `street-details.js`;
   - grid-only crosswalks in `pedestrian-routes.js`;
   - the shore clamp in the controllers;
   - the night skyline in the water shader.

Most of the engine is city-agnostic and is kept:
- the 1 m block raster, lot rects and frontage frames;
- `BLOCKS` sidewalks and `buildCityBlocks`;
- IDM traffic, pooled spawning, pedestrians, audio, input, cameras, culling and lighting.

Poznań breaks both carriers. It is land cut by a river (the Warta, plus the Cybina, Ostrów Tumski island and Malta
lake), it has no global grid, it has street-running trams, and its architecture has pitched roofs.

The plan has three stages:

- **Stage A, generalise in place (Phases 1–3).** Refactor the NYC-coupled APIs into city-agnostic ones *while Manhattan
  still runs*. Every step stays verifiable against today's behaviour; the geodata rebuild must stay byte-identical.
- **Stage B, Poznań pipeline (Phase 4).** Build an OSM-only pipeline that emits the new GEO contract for Poznań, next to
  the NYC one.
- **Stage C, cutover and content (Phases 5–12).** Switch the runtime to Poznań, delete the NYC content, then add Poznań
  content: landmarks, architecture, trams, props, audio, UI.

Stage A is what makes the port tractable: the risky refactors land while the old city is still there to test against.

---

## 1. Decisions to make up front

**D1–D11 are accepted as recommended (2026-10-25). D12 is resolved (Phase 6): the repo is `dminta/slop-poznan`.**

| # | Decision | Recommendation | Why |
|---|---|---|---|
| D1 | World origin | Fixed lat/lon at the Ratusz on Stary Rynek, **52.40856 N, 16.93401 E**, with `ORIGIN = [0, 0]` | Don't derive it from a data node. OSM node ids and names are not stable, unlike the CSCL node used today. |
| D2 | Frame bearing | **0° (true north)**: x = east, z = south | Poznań has no single grid; Stary Rynek, Dzielnica Cesarska, Jeżyce and Łazarz all have different angles. The map, compass and sun maths need no rotation. Cost: almost every block gets frontage `frames` (they already work), roughly 2× rect data, and `blockAt` loses its axis-rect fast path. Alternative: the length-weighted dominant direction of Śródmieście roads mod 90°, logged per build. |
| D3 | Extent | **Detailed core** 52.392–52.425 N, 16.895–16.985 E (≈ 3.7 × 6.1 km ≈ 22 km²): Jeżyce, Łazarz, Wilda, Centrum, Stare Miasto, Ostrów Tumski, Śródka, Cytadela, Malta. **Low-detail outskirts** around it, out to the city boundary (admin_level 8). | ≈ 35 M raster cells at 1 m, about 55% of today's Manhattan raster. Fits the current heap budget. |
| D4 | Data sources | **OSM only** (ODbL), as committed Overpass snapshots in `tools/data/`. Heights from `building:levels` (82% coverage in the core) ×≈3.4 m. Optional later: GUGiK NMPT − NMT (nDSM) for real roof heights. | One licence, one fetch tool (`overpass.sh` already exists), deterministic builds. GUGiK data is free for any use but is EPSG:2180 sheets, which means a heavier toolchain. |
| D5 | Roads model | **Pure graph.** `GEO.roadGraph` covers the whole core; `streets: []`, `avenues: []`. | The grid corridor passes cannot describe Poznań. The `GEO.roadGraph` path already runs Lower Manhattan. |
| D6 | Land/water model | Replace the island model with **land rings + water rings** and a runtime `isLand(x, z)`/`isWater(x, z)`, with bridges as graph links flagged `bridge` | Ostrów Tumski and both banks are separate land components. |
| D7 | Bridges | Bridges are **drivable, walkable, tram-carrying deck links at street level (y ≈ 0)**, with the river surface 3–5 m below. The structure is scenery under the deck. | The Warta bridges are nearly level with the streets, so the road graph can stay flat. Today the NYC bridges are scenery only. |
| D8 | Trams | **In scope, as a late phase (Phase 9).** Before that, tram tracks are paint/rail meshes plus catenary only, with no actors. | Trams are the biggest new code (a new actor system with mixed traffic), but they define Poznań streets visually. |
| D9 | UI language | **English UI, Polish place names** (with diacritics). `lang="en"` stays. A Polish UI can follow via a string table. | Smallest change. Translation is orthogonal. |
| D10 | Units | Switch to **km/h and metres** | Poland uses metric. |
| D11 | File naming | City-neutral names: `js/nyc-geodata.js` → `js/geodata.js`, `js/nyc-map.js` → `js/city-map.js` (`CityMapSystem`), `boroughs.js` → split into `outskirts.js` + `bridges.js`. Scene roots: `CityGrid`, `CityBlocks`, `StreetDetails`, `Landmarks`, `Outskirts`, `TrafficAndPedestrians`. | Avoids a second rename for the next city. |
| D12 | Repo / live URL (**resolved**) | `dminta/slop-poznan`, live at https://slop-poznan.dominikminta.com/ (`index.html`, `README.md`, `tests/boot.test.cjs`). | Resolved in Phase 6 |

---

## 2. Target GEO contract (Poznań)

The current keys, layouts and consumers are documented in `docs/geodata.md` and in the comments next to the `GEO` literal
in `tools/build-geodata.mjs`. Proposed contract:

| key | layout | status | notes |
|---|---|---|---|
| `version` | `2` | changed | Bump it so stale consumers are obvious. |
| `frame` | `{ bearingDeg, origin, lat0, lon0, units, strip, sidewalk, detailBox:[x0,x1,z0,z1], ll:[a,b,c,d,e,f] }` | changed | `ll` holds the affine lon/lat → world coefficients, so the runtime `LL()` reads them instead of a hand copy (`boroughs.js:78-83` today). `cutZ` → `detailBox`. |
| `land` | `[flatRing]` | **new** | Land components inside the detail box (west bank, Ostrów Tumski, east bank, …). Negative shoelace winding, as today. |
| `water` | `[{name, kind:'river'\|'lake'\|'canal', ring}]` | **new** | Warta, Cybina, Stare koryto Warty, Jezioro Maltańskie, ponds. |
| `outskirts` | `[flatRing]` | **new** | Low-detail land outside the detail box, up to the city boundary. Replaces `boroughs`/`upperManhattan`. |
| `districts` | `[{name, ring}]` | **new** | OSM admin_level 9/10 (osiedla) or `place=*` areas. Replaces `districtAt`. |
| `labels` | `[{name, kind, x, z}]` | **new** | Area labels for the map (`place=suburb/quarter/neighbourhood`, water names). Replaces `AREA_LABELS` in `city-map.js`. |
| `streets`, `avenues` | `[]` | kept empty | They stay so the runtime can tolerate empty lists during the transition; delete them in Phase 12. |
| `roads` | `[name, w, dir, lanes, hw, flatPts]` | kept | `name` is the display name (`ul. Święty Marcin`), not upper-case CSCL. `dir` becomes `1/-1/0` instead of `FT/TF/TW` (update `city-config` `ROADS`). |
| `roadGraph` | `{ nodes, links:[[a,b,nameIdx,w,lanes,dir,innerFlat,flags,kmh]], names, signals:[nodeIdx] }` | extended | `flags` bit 0 = bridge, bit 1 = tram on street, bit 2 = roundabout, bits 3/4 = a painted bike lane (`cycleway=lane`/`opposite_lane`) right/left of a→b (Phase 11). `kmh` is the speed limit (OSM `maxspeed`, zone tags, else by class; Phase 10). `signals` comes from OSM `highway=traffic_signals` nodes snapped to junctions. |
| `rail` | `[{kind:'tram'\|'rail', street:0\|1, tracks, pts}]` | **new** | From `railway=tram` (476 ways, 1435 mm, 600 V) and `railway=rail`. |
| `plazas` | `[{name, ring}]` | changed | Pedestrian areas (`highway=pedestrian` areas, `area:highway`, `place=square`): Stary Rynek, Plac Wolności, Plac Kolegiacki, Półwiejska. |
| `blocks` | unchanged tuple | kept | `[outline, rects, parkShare, parkName, rect, frames]`. Generic. |
| `parks` | `[{name, cat, area_m2, rings}]` | changed | `acres` → `area_m2`. Update the thresholds at `geo-extra.mjs:32,99` and the consumers (`city-grid.js`, `city-map.js`). |
| `centralPark`, `piers`, `bridges`(NYC), `islands`, `boroughs`, `upperManhattan`, `innerShore`, `broadway`, `points` | — | **removed** | `innerShore` already has no consumer. `points` becomes optional named points (e.g. the Ratusz tower) if needed. |
| `landmarks` | `{osmName: {x, z, w, d, h, area, ring, ang}}` | extended | New `ang` (principal axis of the outline). `h` falls back to `building:levels × 3.4`. Never trust OSM `height` blindly: the Katedra has `height=0.1` and Teatr Wielki `height=1`. |
| `buildings` (optional) | quantised footprints + levels + roof shape | **new, optional** | Only if Phase 8 uses real footprints instead of synthetic lots. Keep it out of the main GEO file if it is over about 1 MB. |

Target output size: ≈ 1–1.5 MB, comparable to today's 1.1 MB. `roadGraph` grows to ≈ 300–500 KB (6–10 k links); `blocks`
is ≈ 400–700 KB.

---

## 3. Stage A: generalise in place (Manhattan keeps running)

Rule for this stage: every commit keeps the NYC build working.
- `node --test tests/` must stay green.
- A tools refactor must rebuild `js/geodata.js` **byte for byte**: build to a temp path and `cmp` (`docs/geodata.md`).
- The browser must show the same city, with no console errors.

### Phase 1: Land/water API instead of the island model

**Status: done.** `distToWater` and `waterRings` were deferred until a consumer needs them. The only behaviour change is at the
Battery tip: over its last 2.5 m (z 6509.5–6512) the land is narrower than 16 m, and the collision clamp now picks the
land's middle instead of the west margin, a shift of up to 2.2 m.

The goal is that no runtime code asks "west/east shore at z".

1. In `js/city-config.js`, add `isLand(x, z)`, `isWater(x, z)`, `distToWater(x, z)`, `landRings`, `waterRings` and
   `CITY_BOUNDS` (`{minX, maxX, minZ, maxZ, sidewalkHeight, waterLevel}`). For NYC they are backed by the existing
   coastline and borough polygons, using a coarse raster or grid index like `boroughs.js` `LAND_GRID`.
2. Migrate the consumers from `getIslandBoundsAtZ`/`ISLAND_BOUNDS`:
   - `road-network.js:55` `onLand`, and `Z_MIN`/`Z_MAX` at :22-23;
   - `controllers.js:387-395` and `:891-898`, the shore clamp and helicopter bounds;
   - `nyc-map.js` `clampToManhattan` (:742-747);
   - `city-grid.js`: seawall and deck;
   - `boroughs.js` `onManhattan`/`distToManhattan`;
   - `tsl-materials.js`: water.
   Keep `getIslandBoundsAtZ` only inside the NYC-specific waterfront builder, which is deleted in Phase 5.
3. Tests:
   - `tests/controllers.test.cjs:196-201` stubs `ISLAND_BOUNDS`, `CENTRAL_PARK_BOUNDS`, `getIslandBoundsAtZ`, `blockAt`.
     Add stubs for the new names, and keep the clamp math tests (`:406-418`) passing, re-expressed via `isLand`.
   - `tests/teleports.test.cjs:19-20`: check "inside the city" via `isLand` instead of island bounds.
   - `tests/nyc-map.test.cjs:98-101`: config stub keys.

   vm tests turn a missing import into `undefined`, while the browser fails at link time. So after each rename, also boot
   the page.
4. `getGroundHeight` (`controllers.js:834-845`) hard-codes `CENTRAL_PARK_BOUNDS` (1.24 m) and `bryantParkLawn`.
   Generalise it to a `RAISED_LAWNS` list of `{rect | ring, y}` exported from city-config and city-grid.

### Phase 2: Graph-generic traffic semantics

**Status: done.** Signals come from `SIGNAL_SITES` (option a). Crosswalks follow `n.arms` and the walk phase follows the arm's
group. Buses spawn on `e.major`. `buildRoadGraph({ wholeArea: true })` lifts the 14th St and `NORTHERN_ROADS` limits. The
geodata rebuild stays byte-identical. Behaviour changes on Manhattan:
- 3,454 new crosswalks at 841 unsignalised centreline junctions south of 14th St. Pedestrians have priority there.
- Buses now run on the crosstown streets (14th, 23rd, 34th, 42nd, …) and on Houston, Canal and Delancey. They no longer
  run on narrow avenues (Manhattan Ave, Vanderbilt, Irving Pl, Ave C) or on Park Row.
- Links with no width take their road's median width instead of 18 m (Park Row, Bowery, Broadway, Cooper Sq).
- 166 centreline edges switched `axis`, so `major` now decides which road is group 0.

Pedestrians that start a crossing used to spawn only at signalised crosswalks; since 2026-10-28 they spawn at every
junction with a crosswalk (`nearCrossings` in `refreshNear`).
The signal-mast layout in `street-details.js` still assumes axis-aligned junctions; that is Phase 11 work.

1. **Signals from one source.** `road-network.js` step 8 (:1073-1079) and `street-details.js` §1 (:227-230) both loop
   `AVENUES × STREETS`. Change it so that:
   - `buildRoadNetwork` marks `node.signal` from a list of signalised positions (NYC: the 63 core corners; Poznań:
     `GEO.roadGraph.signals`);
   - `street-details` mounts signal heads by iterating `network.nodes.filter(n => n.signal)`.

   This needs the network before street details. The order is fixed (`world.md` build order: street details before
   traffic), so either:
   - **(a)** pass the signal-site list from city-config to both (recommended: no order change); or
   - **(b)** move signal-head building into a post-network step called from main.js.
2. **Signal groups beyond avenue/street.**
   - Today `signalPhase(t, isAvenue)`/`walkSignal` (`city-config.js:738-753`) and traffic's
     `avePhase/stPhase/aveWalk/stWalk` and `phaseOf(e)` (`traffic.js:417-421`) use `axisIndex === 0`.
   - `sidesAndGroups` (`road-network.js:866+`) already makes group 0 the widest road for general nodes, so keep the
     2-group model but stop calling it "avenue": rename to `group 0/1` in comments. Changing field names is not needed
     and is risky.
   - Keep the `isAvenue` field on `streetDetails.audioSignals` (audio reads it, `audio-sources.js:225`;
     `docs/audio.md`). Or rename it in the same commit as `audio-sources.js`.
3. **Crosswalks at general junctions.**
   - Today `pedestrian-routes.js:42-62` `across(n)` only builds crossings for grid sides 0–3 with axis-aligned geometry,
     and `traffic.js:1469` `walkOn(side) = side >= 2 ? stWalk : aveWalk`.
   - Generalise both to oriented arms, using each arm's edge `dx/dz/rx/rz`, and map the walk phase by the arm's group,
     not its side index.
   - Verify on Lower Manhattan, where general nodes exist today: crossings should appear there.
   - This is the **single biggest grid coupling for pedestrians**. Without it, Poznań gets almost no crossings.
4. **Bus spawning.**
   - `spawnVehicle` (`traffic.js:1369`) spawns buses only on `e.axis === 'ave'`.
   - `road-network.js:391` sets `MAJOR = /\bAVE\b|AVENUE|BROADWAY|BOWERY|BLVD|PARK ROW/`.
   - Replace both with a per-edge `major` flag computed from width/lanes/class (≥ 14.5 m or ≥ 3 lanes, or OSM
     `primary/secondary`), and spawn buses on `e.major`.
5. **Pure-graph mode.**
   - Make the avenue-corridor and cross-street passes (`road-network.js:109-233`) no-ops when `ALL_AVENUES` is empty.
   - Make the grid-snap helpers (`aveAt`, `pieceAt`, `pieceRows`, `p.mids`) tolerate no grid.
   - Lift the `zFrom`/`NORTHERN_ROADS` limits in `tools/geo-roadgraph.mjs:10-14` behind a config flag. The NYC build
     keeps them, so the output stays byte-identical.
6. **Source-sliced tests.** `tests/traffic.test.cjs` and `traffic-performance.test.cjs` cut `mayEnter`, `signalAhead`,
   `canStop`, `yieldToCrossTraffic`, `yieldOncoming`, `nearView`, `refreshNear`, `spawnVehicle`, `spawnPed`,
   `renderPed`, `updateSparks`, `flagRange`, `playerInLane` and the `const pl = entity … } : null;` block by exact text.
   Every new free variable (`e.major`, a group helper) needs a stub there.

### Phase 3: Data-driven content hooks

**Status: done.** The geodata rebuild stays byte-identical apart from the added `frame.ll` key and the renamed header
line. Deviations and open points:
- Persistence: the key is now `player-state`, migrated from `nyc-player-state` on read. `version` stays 1 until the
  Phase 5 cutover bumps it and drops the migration. `nyc-sound` → `sound`, with the old key read as a fallback.
- Units: the gauge's `topSpeedKmh` is the boosted controller cap × 3.6 (person 30, car 130, cyclist 68, helicopter 187).
- Landmarks: `fitToSite` supports `ang`, but the NYC pipeline doesn't emit it. `LANDMARK_RESERVE` in `buildings.js` still
  reserves the unrotated box; Phase 4/7 must reserve the turned AABB or the ring.
- `frame.ll` deviates from the old hand constants by at most 0.55 mm.
- GPS route: undirected Dijkstra on the traffic network (one-ways are treated as two-way), with a straight-line fallback
  when a point snaps farther than 300 m. `compareNames` is exported but unused, because the map has no alphabetical
  sort. The compass tooltip now reads "True north · the street grid runs 29° east of it".
- `prettyName` is the identity for `GEO.version` ≥ 2; the v1 path was verified identical on all 740 NYC names.
- Scene roots: the `main.js` "root" is the `cullingRoots` name list, which now reads `CityGrid`, `CityBlocks`,
  `StreetDetails`, `Landmarks`, `Outskirts`. Nothing else looks roots up by name.

These changes are all behaviour-preserving for NYC.

1. **`fitToSite` rotation** (`landmarks.js:133-174`). It doesn't rotate today. Add `ang` from `GEO.landmarks[name].ang`,
   rotate the model about the site centre, and turn colliders pushed since `c0` into `obb` colliders (as
   `buildings.js` `pushCollider` does). main.js already excludes `obb` colliders from traffic obstacles.
2. **`LL()` from data.** Emit `frame.ll` coefficients from `tools/geo-base.mjs` `toWorld` and have `boroughs.js:78-83` use
   them. Check that they match the hand constants to within 1 mm.
3. **Map labels and alias tables** (`nyc-map.js:87-107` `AREA_LABELS`, `LABEL_ALIAS`): move them into city-config data
   (later `GEO.labels`).
4. **GPS route** (`nyc-map.js:402-415`): it draws an L-shape (x then z). Replace it with a road-graph shortest path
   (Dijkstra on `network` edges, cached per destination), or a straight line as a fallback.
5. **Map compass**: `nyc-map.js:44` already reads `GEO.frame.bearingDeg`. Move the hard-coded "grid runs 29° east"
   tooltip (`index.html:284`) to runtime text.
6. **Units**:
   - `main.js:248-249` `topSpeedMph`; `main.js:736-737` conversions (`*2.237`, `*3.281`);
   - `index.html:201,203` labels;
   - `toLocaleString('en-US')` at `main.js:746` and `nyc-map.js:452`.

   Switch to km/h and m. Keep the gauge scale in step with the controller speed caps.
7. **Persistence keys**:
   - `nyc-player-state` (`main.js:106,123`): rename it to `player-state` *and* bump `version` to 2 at the cutover, so a
     saved Manhattan position isn't restored into Poznań. Read-and-discard the old key.
   - `nyc-sound` (`audio-system.js:97,187`): rename it, reading the old key as a fallback to keep the mute choice.
   - Update `architecture.md` and `audio.md`.
8. **Text normalisation**:
   - `prettyName` (`city-config.js:58-63`) uses `\b\w`, which is ASCII-only, so it turns "Święty Marcin" into
     "śWięty Marcin". Make the pipeline emit display names, and make `prettyName` the identity for v2 data.
   - Map search folding: NFD plus stripping combining marks does **not** fold `ł/Ł`; map them explicitly.
   - Use `Intl.Collator('pl')` for sorting and `toLocaleUpperCase('pl')` for the upper-case map labels.
9. **Scene root renames** (D11):
   - Root names: `main.js:153`, `city-grid.js:1480`, `buildings.js:258`, `street-details.js:107`, `landmarks.js:19`,
     `boroughs.js:3343`, `traffic.js:79`.
   - No test references them. Update `world.md` and `rendering.md`.
10. **Module renames** (D11):
    - `nyc-map.js` → `city-map.js`:
      - `index.html:44` modulepreload;
      - `main.js:19,449`;
      - `tests/teleports.test.cjs:59`, the injected `NYCMapSystem` key;
      - `tests/nyc-map.test.cjs` → `tests/city-map.test.cjs`.
    - `nyc-geodata.js` → `geodata.js`:
      - `index.html:22`;
      - every importer (`city-config`, `city-grid`, `buildings`, `road-network`, the map);
      - `tools/build-geodata.mjs:11,226`;
      - `tests/geodata.test.mjs:26`;
      - the map test stubs `'./nyc-geodata.js'` (`:14,106`).
    - The boot preload count (`tests/boot.test.cjs:28`, 31) is unchanged by a 1:1 rename. `boot.test.cjs:39` checks that
      every import resolves to a preloaded URL.
    - Update `AGENTS.md` (title, the "`js/nyc-geodata.js` is generated" rule) and the docs.

---

## 4. Stage B: Poznań geodata pipeline (Phase 4)

**Status: done.** `node --max-old-space-size=8192 tools/build-poznan.mjs [out.js]` builds the §2 contract in ≈ 11 s
(≈ 0.76 GB peak RSS), deterministically, to 1.26 MB: 822 blocks, 3,903 graph links, 235 signals, 27 bridge links. How
to build and what each module decides is in `docs/geodata.md`. Deviations and open points:
- Output: until the Phase 5 cutover the default path is `os.tmpdir()/geodata-poznan.js`, not `js/geodata.js`.
- Extra keys `landHoles` and `outskirtsHoles` (`[{ outer, ring }]`, positive winding), so `land` and `outskirts` stay
  plain `[flatRing]`. `water` entries may carry `holes` (islands), and `kind` also takes `'pond'`. `plazas` entries may
  carry `holes`: the buildings standing on a pedestrian multipolygon, such as Stary Rynek's central block.
- The road graph leaves out `highway=service` (`buildRoadGraph(..., { service: true })` keeps it), so it has 3,903 links,
  below the 6–10 k estimate. The block raster stamps named service roads only (167 pieces).
- `STRIP` = 10 m riverside strip. Bridges are stamped like any road, because their decks are at street level (D7).
- Plazas: place=square outlines and pedestrian areas are cleared, then the multipolygon inner rings of 100 m² and up are
  given back, grown by `SIDEWALK`. This replaces the Times/Herald Square hack. Linear `highway=pedestrian` ways are
  stamped at 8 m (or their `width`) outside plazas.
- Most Bolesława Chrobrego and Most Mieszka I had no tram bit because OSM tags their closed track `razed`/`disused`;
  fixed on 2026-10-28 by keeping route-member track (666 tram links).
- `Pomnik Czerwca 1956` is a node only (a fixed 10 × 10 m site). Delta 4 is not in OSM; the `Delta` key is the older
  building.
- Water labels (`kind: 'water'`) sit at the deepest point of each body inside the detail box. Jezioro Maltańskie runs
  past the box's east edge, so its label (2690, 726) is on the box's part of the lake.
- Blocks: none is axis-rectangular (bearing 0); 476 carry frontage frames, and 332 have no lots (195 of them are under
  300 m²).

Build it alongside the NYC pipeline. `tests/geodata.test.mjs` copies only top-level `tools/*.mjs`, so new modules must be
flat files: `tools/poz-*.mjs` plus a `tools/build-poznan.mjs` entry point. Inputs go in `tools/data/poznan/`, or in
`tools/data/` with a `poz_` prefix; the test symlinks `tools/data`. Output: `js/geodata.js` (D11), written only by the
Poznań build after the cutover. Until then, write to a temp path.

### 4.1 Inputs (Overpass snapshots, via `tools/overpass.sh`)

| file | query | content |
|---|---|---|
| `poz_roads.json` | `q_poz_roads.overpassql` | `way[highway]` in the bbox with `out body geom;`, so node ids are kept for splitting at shared nodes |
| `poz_rail.json` | `q_poz_rail.overpassql` | `railway=tram\|rail\|light_rail`, `landuse=railway` |
| `poz_water.json` | `q_poz_water.overpassql` | `natural=water` (`water=river\|reservoir\|lake\|pond\|canal`), `waterway=riverbank`, `waterway=river\|stream\|canal`; relation 7550595 (Malta) |
| `poz_parks.json` | `q_poz_parks.overpassql` | `leisure=park\|garden\|playground\|pitch`, `landuse=grass\|recreation_ground\|cemetery\|forest`, `natural=wood` |
| `poz_landmarks.json` | `q_poz_landmarks.overpassql` | exact-name regex (§9.1), ways + relations |
| `poz_admin.json` | `q_poz_admin.overpassql` | `boundary=administrative` admin_level 8/9/10; `place=suburb\|quarter\|neighbourhood` nodes |
| `poz_signals.json` | (part of roads) | `node[highway=traffic_signals]`, `node[crossing]`, `node[railway=tram_stop]` |
| `poz_buildings.json` (optional) | `q_poz_buildings.overpassql` | `building=*` with `out tags geom` limited to `building, building:levels, roof:*, height, name`. Raw it could be 30–80 MB: trim tags in the query and consider not committing it raw. |

Other changes:
- Change the overpass.sh User-Agent (`tools/overpass.sh:21`, `nyc-layout-research/1.0`). Overpass returns 406 without a
  UA and is often at 502 capacity; the retry logic already copes.
- Delete the stale `tools/fetch-geodata.sh` reference in the `geo-base.mjs` header.
- Write down the bbox and the date of every snapshot in `docs/geodata.md`.

### 4.2 Modules

**`poz-base.mjs`: the frame and the helpers.**
- Reuse `rdp`, `rdpRing`, `ringArea`, `bbox`, `pointInRing`, `centroid`, the `Raster` class (`fillRing`, `edt`, `open`,
  `close`, `keepLargest`, `traceOuter`), `elemRing`/`elemRings` and `chainCoastline`.
  - Extract them from `geo-base.mjs` into a side-effect-free `geo-util.mjs` first. This is a Stage A commit: the NYC
    rebuild must stay byte-identical.
  - `chainCoastline` and `mergeRoads` use `ways.find` in a loop (O(n²)). Index them by endpoint key before feeding
    thousands of OSM ways.
- Frame:
  - LAT0/LON0 per D1, bearing per D2. Log both as `[geodata]` lines.
  - Emit `frame.ll` affine coefficients.
  - At 52.4° the scale is KX ≈ 67.9 km/° and KY ≈ 111.25 km/°.

**`poz-roads.mjs`: OSM ways → `pieces`.**
- Split every way at nodes shared by two or more drivable ways. CSCL came pre-split, OSM does not.
- Fields:

  | field | rule |
  |---|---|
  | `name` | `name` or else `ref` |
  | `cls` | `highway` |
  | `w` | `width`; else `lanes × 3.25` (+2.2 per side with `parking:lane`/`parking:both`); else the class default: primary 15, secondary 12, tertiary 10, residential/unclassified 7.5, living_street 6, service 5 |
  | `lanes` | `lanes`, else the class default |
  | `dir` | `oneway=yes` or `junction=roundabout` → 1, `oneway=-1` → −1, else 0 |
  | `level` | `bridge` / `tunnel` / `layer` |

- Coverage in the core: `lanes` 68%, `oneway` 64%, `width` 1.3%. The class defaults matter.
- Streets carrying a parallel `railway=tram` get **+6.5 m** of width (two tracks), and the link `flags` get the
  tram-on-street bit. Examples: Głogowska, Dąbrowskiego, Grunwaldzka, Św. Marcin, Królowej Jadwigi.
- Exclude:
  - `footway, path, cycleway, steps, track, bridleway, construction, proposed, raceway`;
  - `service` with `service=driveway|parking_aisle|drive-through`.
- `highway=pedestrian`, pedestrian areas and `area:highway` become `plazas`: stamped into the block raster as non-block
  space, never put into the graph. This replaces the Times/Herald Square z hack (`geo-blocks.mjs:31-50`).
- Tunnels are dropped from the at-grade graph (e.g. the trams below Rondo Kaponiera, PST cuttings).

**`poz-water.mjs`: land and water.**
- Land = the detail box minus water rings, on a 2 m raster: fill 1, burn water to 0, then `open`/`close`.
- **Don't `keepLargest`.** Keep every component above an area threshold (west bank, Ostrów Tumski, east bank/Śródka, and
  the Malta shores). Add a multi-component tracer.
- Emit `land`, `water` and `outskirts` (the city boundary minus the detail box, minus water).
- `STRIP` becomes the riverside embankment strip (≈ 10–15 m; the Wybrzeże Wiadrowe and Chwaliszewo embankments), or 0
  when stamped riverside roads already bound the blocks. Decide after the first build by looking at the block outlines.
- Drop all NYC shore logic: piers, Hudson River Park, NJ cut, Ellis, harbour islands, `CUT_Z` split, `shoreProfile`.

**`poz-blocks.mjs`: curb islands, lots and frames.** Mostly a parameterised copy of `geo-blocks.mjs`, which is already
direction-agnostic:
- capsule stamping of road pieces;
- 4-connected labelling, `traceComponent`, `destair`;
- sidewalk erosion (`SIDEWALK` 4.6 m; Poznań sidewalks are ≈ 3–5 m, keep it);
- `maskRects`, `lotRects`, `blockFrames`.

Also:
- Stamp **rail corridors and `landuse=railway`** as non-buildable. The Poznań Główny yards separate Łazarz and Wilda from
  Centrum.
- Water cells are never block cells. Bridges are not stamped over land.
- `blockFrames` per-cell nearest-edge loops (`geo-blocks.mjs:312-329`) scale with frames × cells. Expect the build to slow
  down with bearing 0; measure, and add a per-block bbox prefilter if it goes much beyond the current ≈ 11 s.

**`poz-parks.mjs`.**
- OSM park rings feed the existing scanline park-coverage pass (`geo-extra.mjs:20-68`), using `area_m2` thresholds.
- Name the big ones explicitly: Park Cytadela, Park Wilsona, Park Mickiewicza, Park Chopina, Malta greens, Park
  Sołacki (outside D3, outskirts only).

**`poz-roadgraph.mjs`.**
- Reuse the node-merge, name-index and renumber half of `buildRoadGraph` (`geo-roadgraph.mjs:15-75`).
- Keep `bridge=yes` links with the bridge flag. Drop tunnel and `layer<0` links.
- Bridges in the core:
  - Most Bolesława Chrobrego, Most Św. Rocha, Most Królowej Jadwigi, Most Mieszka I (Cybina);
  - pedestrian only: Most Biskupa Jordana, Mosty Berdychowskie;
  - over the rail yard: Most Dworcowy, Most Teatralny, Most Uniwersytecki.
- Snap `highway=traffic_signals` nodes to the nearest merged junction within ≈ 25 m, giving `roadGraph.signals`.
  OSM tags signals on approach nodes, not only on the junction node. There are 257 signal nodes in the core.

**`build-poznan.mjs`: assemble the contract (§2).**
- Landmarks (§9.1): largest outline wins (as today), with `ang` and the `h` fallback.
- `labels` and `districts` from `poz_admin.json`.
- Header attribution: "© OpenStreetMap contributors (ODbL)". Add GUGiK ("Źródło: GUGiK, geoportal.gov.pl") if nDSM
  heights are used, and ZTM ("source, last-updated date, processed" — their terms) if GTFS is used.

### 4.3 Tests for Phase 4

- **`tests/geodata.test.mjs`**:
  - Point it at the Poznań build. It must run without network access, from committed snapshots.
  - Its temp dir name `'New York 東京 '` can become `'Poznań Zażółć 東京 '` to keep exercising non-ASCII paths.
  - Add assertions:
    - ≥ 3 land rings;
    - a water entry named `Warta`;
    - ≥ 1 `roadGraph` link with the bridge flag;
    - `landmarks['Ratusz']` present;
    - `roadGraph.signals.length > 100`;
    - `blocks.length > 500`.
- **`tests/overpass.test.mjs`**: unchanged, unless the endpoint or retry logic changes.
- **Determinism**: the rebuild must reproduce the committed output byte for byte. Keep `--max-old-space-size=8192`.
- Read the `[geodata]` log lines (counts, frame, per-key KB) on every build.

### 4.4 Optional: real heights and footprints

- GUGiK NMT/NMPT (1 m, free for any use, EPSG:2180, EVRF2007 heights):
  - nDSM = NMPT − NMT gives a per-building roof height.
  - Index WMS/WFS: `mapy.geoportal.gov.pl/wss/service/PZGIK/NMT/...`. The WCS export limit is 7 km² per request, so the
    detail box needs ≈ 4 tiles.
  - Use it for landmark heights the web could not confirm: the Ratusz tower (≈ 61 m, unconfirmed), Fara, Zamek
    Królewski, Teatr Wielki.
- GUGiK LOD1/LOD2 CityGML: LOD1 covers all of Poland; **it is unconfirmed whether LOD2 covers Poznań**. Check with the
  geoportal identify tool before planning around it.
- Converting EPSG:2180 → WGS84 in Node needs a small projection routine (Transverse Mercator with known PUWG-1992
  parameters). There must be no npm dependency at runtime, and preferably none in tools either.
- Terrain: the core has ≈ 15–40 m relief (the Warta floodplain ≈ 52–55 m a.s.l. against the Cytadela/Winiary hill and
  Wzgórze Przemysła). The engine is flat (y = 0 roads). **Keep it flat** for this port; terrain is a separate project.
  At most, raise the Cytadela park mesh as a gentle mound with no roads on it.

---

## 5. Stage C: cutover and content

### Phase 5: Cutover (Poznań boots, NYC content deleted)

**Status: done.** Poznań boots from `build-poznan.mjs`'s `js/geodata.js`; the NYC tools, data, models and exports are
gone, boot preloads are 32 and `node --test tests/` passes (129 tests, ≈ 11 s). The code is described in `world.md`,
`architecture.md` and `rendering.md`. Deviations and open points:
- `city-config.js`: `LAND_RINGS`/`LAND_HOLES` (not `LAND`), plus `OUTSKIRTS`, `BRIDGES` and `SPAWN`. A 2 m land raster
  backs `isLand` (bridge decks count as land and are never narrowed by a shore margin), `isWater`, `distToWater` and
  `clampToLand`, which now returns the nearest point in 2-D. `prettyName` and its test went with the v1 names.
- `landmarks.js`: the NYC models are deleted now rather than in Phase 7; it returns an empty `Landmarks` group and keeps
  `fitToSite` and the facade-box pass. `bryantParkLawn` is gone and `RAISED_GROUND` is empty.
- `cameras.js`: the scenic preset ids stay the Manhattan ones (the `index.html` buttons, a `main.js` shortcut and the
  tests name them); the views are rough Poznań stand-ins until Phase 12.
- `street-details.js`: the steam stacks, subway entrances, food carts, god rays, mailboxes and the Central Park and
  Bryant Park plantings are deleted now rather than in Phase 11. Signals, cobra-heads (post-top globes in Stare Miasto)
  and hydrants stay; lamps and street trees follow the real curb edges of every block (`curbEdges`).
- `city-grid.js`: one battered stone embankment everywhere (no levee/quay/promenade variants yet). Squares are every
  `PLAZAS` ring (deduplicated, minus outlines carrying > 30 m of road centreline), not a hand list. `parkClearings` holds
  the ponds (no reader yet) and `keepClearBoxes` is empty. The road network gets the **ungrown** lot rects of irregular
  islands as curbs: the 4.4 m-grown rect cover reaches into the roadway on turned blocks and halved the largest SCC
  (~3150 → ~1660 edges).
- `road-network.js`: the SCC is logged as `[road-network] edges: … long enough, … in the largest strongly connected set`;
  `tests/road-network.test.cjs` floors the bare graph at > 3850 edges / 175 km in the set (measured 4300 / 193.8 km) and requires street furniture to keep ≥ 99% of it (measured 193.5 km after the Phase 11 follow-up, 184.6 km after Phase 11.2; it was 126.9 km until runs got shape nodes on gentle arcs, which kept the outer lanes off the curbside lamps).
  `major` comes from width and lanes (the graph has no road class).
- `outskirts.js` has no towers (the tall ones stand inside the detail box, Phase 7) and no colliders. `bridges.js`
  builds the 13 `BRIDGES` names as arch/girder/overpass structures with the deck at y ≈ −0.01 running 15 m onto each bank; only the
  parapets collide, `sidewalks` is accepted but unused, and Most Jordana (not a road-graph link) is not built.
- Spawn: `SPAWN` is on the westbound Św. Marcin carriageway by CK Zamek, facing west (13° north of due west); the four
  modes start at offsets in its frame. Teleports were measured on the real streets (Stary Rynek from Zamkowa's mouth,
  142 m from the Ratusz; Poznań Główny on Most Dworcowy).
- Persistence: `player-state` is version 2; version 1 is ignored and `nyc-player-state` removed on load.
- `tsl-materials.js`: the water's night skyline marches the reflected ray over a land-mask texture; `canyonSkyAONode`
  opens over 0–22 m and reads a park-mask texture. NYC-only materials (Chrysler crown, TKTS steps, god rays, …) are gone.
- `city-map.js` already draws the Poznań layers (outskirts, water with its islands, plazas, bridges) north up; branding
  and HUD text stay for Phase 6. `cityGrid.highwayLanes` is `[]`, so `createHighwayTraffic` builds no cars.

This is one large commit, or a short series on a branch, because NYC-only exports disappear and the browser import fails
at link time on any leftover.

1. Generate `js/geodata.js` from `build-poznan.mjs`. Delete the NYC tools (`geo-*.mjs`, the NYC `tools/data` files and
   queries) or move them to git history only.
2. **`city-config.js`**:
   - Remove:
     - `AVENUES`, `STREETS`, `ALL_AVENUES`, `ALL_STREETS`, `streetZ`, `avenueX`, `avenueNameAt`;
     - `CENTRAL_PARK_BOUNDS`, `MANHATTAN_COASTLINE`, `SHORE`, `getIslandBoundsAtZ`;
     - `getBroadwayX`/`BROADWAY_LINE`, `PIER_KINDS`/`WATERFRONT_PIERS`;
     - all island and borough polygons, `LIBERTY_STATUE_POS`, `EAST_RIVER_BRIDGES`, `OUTER_BRIDGES`;
     - `HOUSTON_Z`/`CANAL_Z`/`CHAMBERS_Z`, `LANDMARK_BLOCKS`/`getBlockBounds` (after Phase 7 rewrites landmarks),
       `fromOldFrame`/`OLD_AVE_X`/`OLD_ST_Z`, `CUT_Z`.
   - Add `districtAt` from `GEO.districts`, plus `WATER`, `LAND`, `RAIL` and `PLAZAS`.
   - Keep `ROADS`/`nearestRoads`, `BLOCKS`/`blockAt`/`blocksInRect`, `LANDMARK_SITES`, `SIGNAL_TIMING`/`signalPhase`/
     `walkSignal`, `isTypingInField` and `getLocationLabel`. `getLocationLabel` loses its "Central Park"/"Hudson
     River"/"New York Harbor" strings and gains "Warta", "Jezioro Maltańskie" and `nearestRoads` crossings
     ("ul. Św. Marcin & al. Niepodległości"). `main.js:390-433` `renderLocation` splits on `" · "`, `" & "` and
     `"near "`; keep that format.
   - Replace `TELEPORT_LOCATIONS` and `NYC_LANDMARKS` (→ `CITY_LANDMARKS`) with the Poznań sets (Phase 12.4).
3. **`city-grid.js`**:
   - Delete:
     - Times/Herald/Flatiron plazas (1608-1790);
     - Central Park (1791-2278) and the schist rocks;
     - the Battery and Castle Clinton (2323+);
     - `buildWaterfrontPiers` (766-1477);
     - `buildManhattanWaterfrontEdge` (2551-3066), `buildSouthStreetViaduct` (3090), `buildUnderpassPortal` (3445).
   - Keep:
     - the water plane (1490);
     - raised sidewalks and curbs from `BLOCKS` (1533-1606);
     - the generic per-park-block lawn, tree and lamp treatment (≈ 2279-2322);
     - `addPavedPlaza`, `addBench`, `addLamp`, `addPlanterTree`, `setPavingStyle`, `addStoneArchBridge`;
     - `batchStaticGroupMeshes`;
     - the return shape `{ group, sidewalks, footprints, highwayLanes, colliders }`. `highwayLanes` becomes `[]`
       unless Phase 9 uses it.
   - New:
     - the land deck = `GEO.land` rings, with holes where water and plazas are;
     - **Warta embankments** built from offset water rings: a sloped grass levee in most places, quay walls with railings
       at Chwaliszewo and the Wybrzeże Wiadrowe, and a riverside promenade (Bulwar). Reuse the `quad`/`makeAcc`
       accumulator and the railing/lamp spotting idioms from the deleted waterfront code;
     - plazas from `GEO.plazas`: Stary Rynek (paved setts, with a hole for the Ratusz + Domki Budnicze block), Plac
       Wolności, Plac Kolegiacki, Plac Mickiewicza.
   - Live `let` exports:
     - keep `parkTreeSites`, `parkLampSites`, `pavedPlazaRects`, `sidewalkBlocks`;
     - rename `fdrViaduct` → `keepClearBoxes` (empty, or bridge abutments);
     - rename `centralParkClearings` → `parkClearings`;
     - update `buildings.js` and `street-details.js` (`world.md` build order).
4. **`boroughs.js` → `outskirts.js` + `bridges.js`** (two new modules: modulepreload ×2 in `index.html`, boot count 31 → 32
   net after removing `boroughs.js`; recount when doing it).
   - `outskirts.js` keeps:
     - the geometry helpers, `LAND`/`LAND_GRID`/`landAt`;
     - the land-use texture mechanism (`paintLandUse`, repainted: Puszcza Zielonka forest edge, Malta, Rusałka,
       Ławica airport, Franowo/Główna industry);
     - `ZONE_LIST` street grids for low-detail districts (Grunwald, Ogrody, Naramowice, Winogrady, Rataje), with angles
       per zone;
     - `createLandMaterial`, `createBoroughBuildingMaterial`;
     - the cheap block generator with a panel-block palette (grey, white and pastel 5/11/16-storey slabs);
     - `TOWER_HOTSPOTS`/`SIGNATURE_TOWERS` for the skyline outside the core (Collegium Altum 103 m, Andersia 102 m,
       AND2 116 m, Poznań Financial Centre 91 m, if they fall outside D3).
   - `outskirts.js` deletes:
     - the Palisades ridge (`ridgeHeightAt` returns 0 or is removed, so update main's use);
     - harbour islands, the Statue of Liberty, Ellis and Governors;
     - the borough landmarks;
     - the Roosevelt Island aerial tram.
   - `bridges.js` keeps `createBeamSet`, `bridgeFrame`, `makeDeckProfile`, `createBridgeMaterials`, `buildDeck`,
     `addBridgeCollider`, `roundArchPath`/`pointedArchPath`, and adds parametric builders:
     - **tied steel arch** (Most Chrobrego, Most Jordana: single ≈ 70 m span);
     - **girder/box beam** (Św. Rocha, Królowej Jadwigi: 52.5/80/52.5 m spans, 22 m wide; Mieszka I);
     - **overpass** (Dworcowy, Teatralny, Uniwersytecki over the rail yard).
   - Bridges are placed from `roadGraph` links with the bridge flag. The deck sits at y≈0 on the link; piers and arches
     go below/above.
   - Delete the Brooklyn, Queensboro, Manhattan, Williamsburg, GWB and Verrazzano builders and `onManhattan*`.
   - **Use `GEO.frame.ll` for every `LL()` call.**
5. **`road-network.js`**:
   - pure graph (the Phase 2 work);
   - `onLand` → `isLand` ‖ bridge link;
   - signals from `GEO.roadGraph.signals`;
   - `lanesOf` (395-409) from OSM lanes/width/class;
   - `major` from class/width.
6. **Watch the largest-SCC filter** (`road-network.js:985`): any obstacle within `LANE_CLEAR` 1.2 m of a lane deletes the
   lane from the whole edge. Log edge counts before and after SCC. A big drop means an obstacle rule violation (tram
   islands, bollards, kiosks).
7. **`main.js`**:
   - the root names;
   - the spawn (`controllers.js:35` `SPAWN_Z = streetZ(37)` and the x offsets −11.6/3.6/5.2/−110). Replace them with an
     explicit `SPAWN` point from city-config: **ul. Święty Marcin by CK Zamek**, or Plac Wolności, chosen by checking
     `nearestRoads`;
   - the loading text "Constructing Manhattan Grid…" (`main.js:73`).
8. **`tsl-materials.js`**:
   - the water night skyline (2441-2670) is built from `MANHATTAN_BOXES`, NJ and Long Island shore crossings and the
     Central Park rim. **Simplify first**: reflect a generic band of bank heights sampled from `GEO.land` along the
     water rings. A faithful rewrite comes later;
   - `canyonSkyAONode` (168-182) assumes ≈ 68 m canyons and the CP rectangle. Lower the `heightOpenness` range to
     Poznań's ≈ 18–25 m streets and replace the rectangle with a park mask texture or `isPark`.
9. **Verification** (browser, no automated coverage):
   - the city boots and there are no console errors;
   - culling roots are found;
   - traffic drives over the Warta bridges;
   - pedestrians cross at the new crosswalks;
   - the helicopter and the controllers clamp to `CITY_BOUNDS`;
   - the map draws land, water and blocks.

   Also run `node --test tests/`.

### Phase 6: Map, HUD, branding

**Status: done** (not yet checked in a browser). D12 is resolved: the repo is `dminta/slop-poznan`, live at
https://slop-poznan.dominikminta.com/. Deviations and open points:
- `city-map.js`: most layers, the north-up frame and the Ratusz default waypoint already came with Phase 5. New: the
  tram (red) and rail (dashed grey) layer from `RAIL`, the fit-to-city `minZoom()`, area labels straight from
  `GEO.labels` (`AREA_LABELS` is gone from `city-config.js`), arc-length road labels over same-name chains
  (`chainRoadPieces`, `roadLabelAnchors`). OSM has no place elements for ŚRÓDMIEŚCIE, CHWALISZEWO, CYTADELA and MALTA,
  so they are hand-placed in `tools/data/poz_places.json` and appended to `GEO.labels` (`docs/geodata.md`). CENTRUM is
  dropped: it names the same centre as ŚRÓDMIEŚCIE and would overlap it and STARE MIASTO. The map legend
  (`#fullmap-legend`) has Tram and Rail swatches, coloured from `MAP` in `city-map.js`.
- The accent stays yellow (`--accent` #ffc21a). The HUD street plate follows Poznań's System Informacji Miejskiej (2017
  manual, pp. 41–51) like the in-world wall plates: graphite #3b3d3f, no border, white left-set medium Overpass, the
  full lowercase kind word with the patron's given names on top ("ulica Jana Henryka" over "Dąbrowskiego"), and a blue
  #1f5bb5 bottom strip with the district (`districtAt`) in capitals. `main.js` takes the lines from `plateLabel` in
  `street-details.js`; `splitStreetKind` and the "ul./al./pl./os." abbreviations are gone.
- The gauge labels live in `controllers.js` (`ent.label`): "Poznań Taxi", "Bike Lane Cyclist".
- Camera popover labels name the Poznań views; the preset ids stay NYC until Phase 12.

1. **`city-map.js`**:
   - layers: `land` (outskirts), `water` polygons (the model flips from "land on water background" to "water on land
     background"), `cityArea`, `parks`, `blocks`, `plazas`, `bridges`, a **tram line layer** (`GEO.rail`),
     `landmarks`;
   - delete the Central Park special layer;
   - `MIN_ZOOM` fits the city boundary;
   - the default waypoint is Stary Rynek / Ratusz (instead of `timessquare`, `:484-486`);
   - "Fit all" fits the detail box;
   - road-label straight-run splitting (`:310-330`) assumes CSCL's ≈ 80 m vertices. Switch to arc-length placement along
     the polyline for curvy streets.
   - **Labels** (`GEO.labels`):
     - districts: STARE MIASTO, OSTRÓW TUMSKI, ŚRÓDKA, CHWALISZEWO, JEŻYCE, ŁAZARZ, WILDA, CENTRUM, CYTADELA, MALTA,
       GARBARY, ŚRÓDMIEŚCIE;
     - outskirts: GRUNWALD, RATAJE, WINOGRADY, SOŁACZ;
     - water, in italic: Warta, Cybina, Jezioro Maltańskie.
2. **`index.html`**:
   - title, meta description (drop "125th St to Battery Park", "11 cinematic cameras" if the count changes);
   - the loading badge (`mta-bullet` "NY" → e.g. a "PZ" roundel or the city's colours) and title;
   - canvas and minimap aria-labels;
   - the map title "Manhattan Street Atlas" → "Poznań Street Atlas";
   - the "You are at…" placeholder; the search placeholder (`:276`, also `city-map.js:465`) "Św. Marcin, Głogowska,
     Stary Rynek…";
   - the compass tooltip;
   - the mode button "Car · Yellow Cab" → "Car · Taxi";
   - the gauge label (overwritten by `ent.label`, `main.js:288`);
   - the units (D10);
   - the teleport and camera popovers (Phase 12);
   - the GitHub link (D12).
3. **`css/style.css`**:
   - `--taxi`/`--taxi-ink` → `--accent`/`--accent-ink`, about 12 uses. The accent colour can be MPK green/yellow, or
     keep yellow;
   - `.mta-bullet` → `.badge`;
   - the street-name sign (`:626-666`, a green Highway Gothic blade) → **a Poznań street plate: white text on a blue
     plate**, unverified, so check street imagery first. The "ul."/"al."/"pl."/"os." prefix sits small above the name;
   - **bump the `?v=YYYYMMDD-<slug>` query in `index.html`**;
   - fonts must cover latin-ext (Ą Ć Ę Ł Ń Ó Ś Ź Ż); any Google Font with the latin-ext subset works.
4. **`README.md`**: title, description, live URL (D12), data credits (OSM ODbL; GUGiK and ZTM if used). **`AGENTS.md`**:
   title "Slop Poznań", the renamed module rules, a pointer to this plan until it is done.

### Phase 7: Landmarks

**Status: done** (built and checked headlessly, not yet in a browser). Deviations and open points:
- Layout: `landmarks.js` only assembles; the models live in five area modules (`landmarks-rynek`, `-heritage`,
  `-centrum`, `-dworzec`, `-towers`) on `landmark-kit.js` (`fitToSite`, shared materials, roof/lathe/prism helpers).
  Boot preloads are 38. The NYC models were already deleted in Phase 5.
- All 25 `LANDMARK_SITES` are modelled (≈ 33k triangles, 85 colliders). Domki Budnicze is new: OSM way 343867707 is
  unnamed, so the query fetches it by id. `buildArcadedHouseRow` (landmarks-rynek.js) is exported for Phase 8.
- Koziołki: the goats live in the unbatched, unculled `LandmarksDynamic` root; a 26 s show runs when the lighting
  preset becomes `midday` and every 120 s while it stays. No clock or audio yet (§12).
- Heights: the model tops are now in `LANDMARK_H`. Fara 40, Zamek Królewski 43, Brama 18, Teatr Wielki 27,
  Collegium Minus 27, the station buildings, Stary Browar and Wieża Wójtowska are estimates from photos (nDSM, §4.4).
  Unconfirmed placements: the Zamek Cesarski tower (south-west corner), the Ratusz tower (centred), Iglica's square
  lattice, AND2's two-volume massing. Delta 4 is not in OSM; `Delta` is the older 11-storey block.
- Materials: no new tsl-materials.js shaders. Six masonry and three curtain-wall styles plus about 20 plain materials
  are shared in `createLandmarkMaterials`, with three local pastels for the Domki. Turned and prism parts keep the
  world-space window grid.
- The build warns for every name in `q_poz_landmarks.overpassql` that matches nothing in the snapshot.
- Not done: the Brama footbridge and Most Jordana (bridges.js), teleports and cameras (Phase 12).

**Pattern.** Each landmark is `{ const c0 = colliders.length; …model…; fitToSite([obj], site('OSM name'), c0, {height}) }`
(`world.md` recipe). It uses the Phase 3 rotation. Add it to `LANDMARK_RESERVE` (`buildings.js:1927-1935`) and,
optionally, to `CITY_LANDMARKS`, the teleports and the cameras.

**Materials.** Reuse the shared canonical facade materials and the `boxLocalTwins` keys. Every new material is another
WGSL pipeline to precompile. New materials needed:
- copper patina roofs, red ceramic tile, sandstone, plaster in ochre/pastel, red clinker brick;
- the Bałtyk dark-glass cubes.

Delete the NYC landmarks (ESB, Chrysler, One Vanderbilt, GCT/MetLife, Bryant Park/NYPL, One Times Square, 30 Rock,
Citigroup, Flatiron, Seagram, One WTC). The `bryantParkLawn` live export goes away; update `street-details.js` §7,
`cameras.js` and `controllers.js`.

**Priority order** (heights from §9.1; "nDSM" means measure it in Phase 4.4 or estimate from photos):

1. **Ratusz** (OSM way 30611684, Q53211). It sits on the Stary Rynek central block.
   - Renaissance loggia façade, 3 storeys, attic, tower ≈ 61 m (nDSM to confirm), eagle on top.
   - Animated **koziołki**: two goats emerge and butt heads 12× at 12:00. They hang off the landmark's update hook,
     triggered by the Midday preset or a clock (§12.3).
2. **Domki budnicze**: the row of narrow arcaded 3–4-storey houses beside the Ratusz. They form a template, reused by the
   Rynek houses (Phase 8).
3. **Bazylika Archikatedralna** (Ostrów Tumski): Gothic brick, 72 × 36 m, twin baroque helmets ≈ 62 m. The OSM height is
   wrong.
4. **Zamek Cesarski**: neo-Romanesque, tower 75 m, ul. Św. Marcin 80/82.
5. **Bałtyk** (MVRDV, 67 m, 16 storeys of staggered cubes) at Rondo Kaponiera.
6. **Fara** (OSM full name: "Bazylika Kolegiacka Matki Bożej Nieustającej Pomocy, Świętej Marii Magdaleny i Świętego
   Stanisława Biskupa"): baroque, pink/white façade; height from nDSM.
7. **Zamek Królewski** (Wzgórze Przemysła, rebuilt 2016, tower with a viewing terrace).
8. **Teatr Wielki** (six Ionic columns, Pegasus) and **Collegium Minus**.
9. **Okrąglak** (45 m, 9-storey cylinder).
10. **Pomnik Ofiar Czerwca 1956** (two steel crosses, 21 m / 19.5 m, Plac Mickiewicza).
11. **Iglica MTP** (64 m openwork spire), **Poznań Główny** (2012 station deck over the tracks plus the Avenida mall),
    **Stary Browar** (red brick, 6 storeys).
12. **Brama Poznania ICHOT** (with its 63 m footbridge over the Cybina) and **Most Jordana**. The bridge is built in
    `bridges.js`, not here.
13. Skyline towers in the core, if inside D3: Andersia Tower, Collegium Altum, Novotel, Delta, Wieżowiec Miastoprojektu,
    the Alfa towers. These are simpler boxes or glass with `fitToSite`.

**Query.** Add the exact OSM names to `q_poz_landmarks.overpassql`, ways and relations. Verify every name against the
snapshot. An OSM rename silently drops a landmark, because `fitToSite` returns early on a missing site. Add a build-time
warning in `build-poznan.mjs` for any requested name that has no match.

### Phase 8: Architecture (buildings.js)

**Status: done** (built and checked headlessly and in Dawn offscreen renders of the materials, not yet in a browser).
Deviations and open points:
- Corners and fronts come from the block's curb outline (`frontages()`: a 10 m sample test plus an 18 m outward ray
  test for slivers between frontage frames), not from `frames`. 19% of lot-rect area stays courtyard (true block
  interiors). The core builds ≈ 12,000 buildings (was ≈ 26,800 with the narrower NYC lots).
- Profiles also use geometry, not only `GEO.districts`: offices within 240 m of Bałtyk/Andersia/AND2/PFC/Collegium
  Altum, `CESARSKA_BOX` around Zamek Cesarski–Teatr Wielki, Rynek fronts probed against the `Stary Rynek` plaza ring,
  Ostrów/Śródka within 650 m of the Katedra. Only 4 buildings qualify as `monumental`.
- Rynek houses are facade boxes with a gable roof spec, not `buildArcadedHouseRow` (keeps them in the batched boxes).
- Materials: `createRoofMaterial` (tile/slate/metal/copper share one pipeline), `createPanelBlockMaterial` (+1 pipeline),
  `masonry: 'brick'|'ashlar'|'plaster'` on `createPreWarBuildingMaterial`. The NYC window air-conditioners are gone
  from the pre-war shader.
- Roofs: `js/roofs.js` (boot preloads 39), 9,240 roofs / 21k instances; chimneys and skylights replace water towers;
  scaffold sheds became renovation scaffolding with building-wrap adverts. The Times Square billboard canvas and material
  (`createBillboardCanvasTexture` / `createBillboardMaterial` in `tsl-materials.js`) survive as unused exports; delete
  them in Phase 12.5.
- Dormers, stepped/volute Rynek gables (§8.5) and Śródka's mural square (§8.1) were added on 2026-10-28 after the
  audit; see the audit section at the top.
- Balconies: `fire-escapes.js` → `balconies.js`, street fronts only, `BALCONY_P` 0.5.
- Outskirts osiedla use the panel material (60 extra draw calls); `place()` now rejects footprints leaving their zone.
- Browser checks pending: roof normals/pitch and ridge alignment on turned blocks, panel shader cost and shimmer on
  distant slabs, balcony LOD popping, startup time (build ≈ 460 ms headless, was ≈ 300 ms).

1. **Districts → profiles.** Rewrite `blockProfile(blk, district)` (`buildings.js:1766-1800`) and the profile constants
   (`RES_*`, `LOFT_*`, `OFFICE_*`, `PROJECTS_*`, `uptownProfile`, `harlemProfile`) for `GEO.districts`:

   | district | profile |
   |---|---|
   | Stare Miasto (Rynek) | `rynek` layout: narrow 6–9 m lots, 3–4 storeys, gable to the square, polychrome pastel façades |
   | Stare Miasto (rest), Garbary, Chwaliszewo | kamienice 3–5 storeys, mixed, some gaps |
   | Centrum / Dzielnica Cesarska | monumental 4–6-storey public buildings and kamienice, grey sandstone and plaster; `cesarska` layout |
   | Jeżyce, Łazarz, Wilda | perimeter blocks of kamienice, 4–5 storeys (≈ 15–22 m), with deep oficyny (rear wings) around courtyards; corner turrets; red/yellow brick in Wilda |
   | Ostrów Tumski, Śródka | low (2–3 storeys), churchy, greenery; Śródka's mural square |
   | Around Kaponiera / Plac Andersa | modern offices, 6–20 storeys, glass |
   | Outskirts (outskirts.js) | panel slabs 5/11/16 storeys in greenery |

2. **Row kinds** (`ROW_KINDS`, 874-884) → `kamienica` (12–20 m frontage, deep), `rynekHouse`, `villa`, `modernist1930s`,
   `postwarBlock`, `infill`. Floor height is ≈ 3.6–4.0 m for kamienice, 2.8 m for panel blocks.
3. **Layouts** (`LAYOUTS`, 1496-1503).
   - `residentialBlock` (1106) is close to the Poznań perimeter block. Replace its avenue-based corner logic (`avenueEnds`,
     `avenueName`, `avenueKind`, `AVE_ENDS`, `QUIET_AVENUES`, 1530-1590, all `ALL_AVENUES`/`getBroadwayX`-based) with
     "corner = vertex of the block outline where two street frontages meet", taken from `frames`/the outline.
   - Add `rynek` and `cesarska`.
   - `projectsBlock` (1735) seeds the osiedle slabs.
4. **Facades** (306-370). Six materials today. The new set:
   - plastered kamienica in ochre, cream, grey-green and salmon, via `createPreWarBuildingMaterial` with new colours
     (cached by options, so free);
   - red clinker brick;
   - grey sandstone;
   - glass (curtain wall);
   - **a new panel-block family** (wielka płyta joints, loggia rhythm: +1 pipeline).
5. **Roofs.** This is the biggest architectural gap: every part is a flat-topped box.
   - Add a **roof instance family** with unit gable prism, hip prism and mansard frustum `InstancedMesh`es, in red tile,
     grey slate/metal and copper materials.
   - Emit it from `commit()` for the top part of each pitched-roof kind.
   - **Register the new list in `placeInFrame`** (`buildings.js:1884,1893`), or it will be misplaced on turned blocks,
     which with bearing 0 is almost all of them.
   - Keep roofs static (skyline) and register them with scene culling (automatic under the `CityBlocks` root).
   - Colliders stay boxes up to the eave.
   - Add dormers, chimneys and Rynek gables (stepped/volute) as shader masks on the gable face or as a few templated
     geometries.
6. **Roof gear.** Remove the cedar water towers (`commit()` 657-700, `wtP`). Add chimney stacks and skylights. Keep HVAC
   on modern roofs.
7. **Fire escapes.** Set the probability to 0, then **repurpose `fire-escapes.js` as wrought-iron balcony stacks**. The fe
   record `x, y, z, ry, facing, storey, landings, h` and the near/far LOD (90 m real geometry, masked box beyond) fit a
   stack of balconies with no stairs. Rename it to `balconies.js` when done (rename only, boot count unchanged).
8. **Keep** awnings and storefront signs, and scaffold sheds as renovation scaffolding with netting. Turn the Times Square
   billboard machinery into building-wrap adverts (siatki reklamowe), or delete it.
9. `bridgeCorridors` (412+) now comes from bridge-flagged links (abutments and overpasses). `overlapsParkOrLandmark` (1965)
   uses park polygons instead of `CENTRAL_PARK_BOUNDS`.
10. **Determinism**: `populateBlock` reseeds `mulberry32` from `(minX, minZ)`. Keep new roof and balcony draws after the
    existing draws, or accept a one-time reshuffle; it's a new city anyway.

### Phase 9: Trams

**Status: done (steps 1–3); steps 4 (PST) and 5 (Kaponiera portals) skipped.** Interactions (cars yield, trams brake
for cars and the player, pedestrians wait, player SAT collisions) and audio (tram motor voice, bell) are in
[`actors.md`](../actors.md#trams-jstramsjs) "Interactions" and [`audio.md`](../audio.md); checked headless on the real
network, not yet in a browser. Step 1 is `js/tram-infra.js`
([`world.md`](../world.md#tram-infrastructure)), built after the road network and kept clear of its lanes. It places 121
stops (97 islands) from the 142 stop nodes; since the 2026-10-28 route-member track fix it places 129 (102 islands),
including Katedra, Fredry and Rondo Śródka. Not yet checked in a browser.

1. **Static first** (no actors):
   - `GEO.rail` → grooved-rail paint or meshes (2 × 1435 mm per track) in `road-paint.js`, or a dedicated instanced
     mesh;
   - catenary poles and span wires in `street-details.js` (poles at ≈ 30 m on street-running track; wall rosettes in
     narrow Old Town streets, to be verified);
   - tram-stop platforms as raised curb islands with shelters, ZTM signage and ticket machines (≈ 105 city-wide) from
     `railway=tram_stop` / `public_transport=platform`.

   **Obstacle rule:** platforms and poles must sit on curb islands or medians, never within 1.2 m of a car lane, or the
   SCC filter removes streets.
2. **Actor system** (`js/trams.js`: modulepreload + boot count +1). **Status: core done** (docs/actors.md "Trams"): the
   track graph with switches, right-hand running on unmarked double track, single-track blocks, clearance points and
   uncut crossings; stops from `tram-infra.js` with a 20–30 s dwell and doors; signals; IDM following;
   Gamma and Tramino articulated bodies with bellows and a pantograph; headlights; the map radar (`trams` array).
   Line routes from OSM `route=tram` relations since 2026-10-28 (`GEO.tramRoutes`); no GTFS. **Interactions done**: cars yielding on shared lanes and junction
   curves, trams braking for cars and the player, pedestrians waiting at the rails, player collisions per section.
   Template: `createHighwayTraffic` (`traffic.js:2128-2160`;
   lane polylines, IDM per lane, no lane changes, cyclic leaders, LOD). Add:
   - track polylines from `GEO.rail`, with junction/switch topology and line routes. Optionally take the routes from the
     ZTM GTFS (`ztm.poznan.pl/otwarte-dane`, free; credit the source, the last-update date and "processed");
   - stop dwell (20–30 s), door animation optional;
   - **articulated multi-section bodies** posed per section from arc length:
     - Moderus Gamma: 82 in service; 3 sections ≈ 32 m;
     - Solaris Tramino: 45 in service; 5 sections ≈ 32 m;
     - Combino.
     - Livery green + yellow, newer ones metallic green; check photos for exact shades.
   - a pantograph;
   - signals: trams obey the node signal (Poland uses dedicated white-bar tram signals; group 0/1 is enough);
   - interaction:
     - cars on shared edges must yield to trams. Insert the tram as an `occ` leader on overlapping car lanes;
     - pedestrians must not walk through trams;
     - player collisions use SAT extents per section.
3. `vehicle-lights.js` spec (`headlight`, `zFront`) for trams (**done**: `tramLightSpec`; the radar draws `tramSystem.trams`). Audio: a tram motor kind and the bell (§12) (**done**: `tram` voice, `bell` event). The map radar
   and audio read a separate `trams` array; don't mix trams into `cars`/`buses`.
4. **PST (Pestka)** (**skipped**: not done): the grade-separated fast tram north of the centre, partly in a cutting. Mostly outside D3. Skip it, or
   render it as an off-street track only.
5. Rondo Kaponiera (**skipped**: no portals): trams run below the roundabout. Tunnelled track is dropped from the at-grade data (§4.2). Show tram
   portals only if time allows.

### Phase 10: Other vehicles and drivers

**Status: done, except the articulated 18 m bus and the conditional green arrow (S-2).** Checked headless (tests,
`createTrafficSystem` on the real network); see [`actors.md`](../actors.md) for the livery codes (`carState.w`: 1 Policja,
2 PRM ambulance, 3 PSP fire, all with `isPolice` for the siren and signal privileges), the MPK bus routes, per-link
speed limits (`edge.limit`, driver `pace`/`vmax`) and the `'redAmber'` phase. Taxis are ordinary colours with a TAXI
roof lamp; NPC and player cars carry EU "PO" plates; drivers honk after 8 s blocked. The NYC model's folded front bike
rack is gone from the bus.

All in `traffic.js`, `actor-models.js`, `controllers.js` and `vehicle-lights.js`. Mind the audio field contract
(`docs/audio.md`).

1. **Taxis.**
   - Polish taxis are any colour (no yellow cabs), with a roof "TAXI" lamp; Poznań adds a side stripe with the city
     crest and the side number (local rules unverified).
   - Remove `taxiYellow` (`traffic.js:164`, `0xffbe14`; highway `PALETTES.taxi`) and give taxis the sedan/SUV palette.
   - Keep `BODY_SPECS.taxi` (`sign: true`) and swap the medallion roof light (`actor-models.js:784-819`) for a TAXI lamp.
2. **Police (Policja).**
   - Silver/white with blue stripes and a "POLICJA" lettering. NYPD livery is at `actor-models.js:1174-1198`.
   - **All-blue lightbar** (`:877-895`; today red −x / blue +x).
   - Keep the `isPolice` field (audio siren selection: `audio-sources.js:150`, `audio-system.js:265`).
3. **Ambulance and fire** (optional).
   - PRM ambulance: yellow/white with red and blue reflective bands, "AMBULANS"; yellow-only from 2030 per the draft
     regulation.
   - PSP: red.
   - A new livery code via `carState.w`. Sirens need `isPolice=true` or a new `hasSiren` flag **threaded through both
     audio files** in the same commit.
4. **Buses.**
   - MPK runs Solaris Urbino 12/18. The articulated 18 m bus is a new jointed body; keep the 12 m rigid body
     (`BUS_SPEC`, `actor-models.js:1334-1361`) and change only the livery (MPK: green/yellow) for now.
   - Destination texture (`traffic.js:52-73`, "M1 · 5 AV / HARLEM") → an amber LED "174 · RONDO KAPONIERA" style, or real
     ZTM line numbers.
   - `tests/vehicle-lights.test.cjs:34` carries its own bus spec copy; update it only if the bus is resized.
5. **Player car** (`controllers.js`):
   - door decal "NYC TAXI / 7Y48 · MEDALLION / $3.00" (`:130-158`) → the Poznań taxi side stripe and number;
   - NY plate (`:161-182`, box `:506-510`) → EU plate 520 × 114 mm, white with the blue EU strip "PL", "PO 12345";
   - labels "NYC Yellow Taxi" (`:559`) / "NYC Bike Lane Cyclist" (`:720`);
   - material `0xffbe14` (`:478`).
6. **Traffic rules.**
   - Right-hand traffic is unchanged.
   - Built-up limit 50 km/h, many 30/20 zones. OSM `maxspeed` coverage is 83% in the core; carry it per link and cap IDM
     desired speed.
   - Optional:
     - **red+amber before green**: a new phase string. The `'amber'` checks in `mayEnter`/`signalAhead` are pinned by
       `tests/traffic.test.cjs:122-185`, so add, don't change;
     - the conditional green right-turn arrow (S-2).
   - The unsignalised default "group 0 has priority" is an acceptable simplification of the Polish right-hand priority
     rule.
   - Blocked-horn threshold: raise it from 4 s; Polish drivers honk less.
7. **Pedestrians**: change the `pedestrians.js:28` "New Yorkers" comment. The palettes (`:724-730`) are generic; adjusting
   their distributions is optional.

### Phase 11: Street details, trees, road paint

**Status: done, except the optional parts** (S-2 arrows, pedestrian countdowns, "BUS" lane text, a 4th tree species,
real OSM tree positions). Checked headless only (tests, the furnished network on the real land); the per-item notes below
carry the measured numbers.

**Partly fixed (2026-10-28): split crossings over medians and tram strips** (see the audit section at the top; Dworzec
0 → 2 zebras). The rest of this note still holds. **Was: no crosswalks where medians and tram strips aren't blocks.** Zebras need a curb island within `CROSSWALK_REACH`
(4 m) at both ends (`pedestrian-routes.js`), so junction complexes whose refuges are only road-network gaps get none.
The Dworzec complex (Roosevelta / Most Dworcowy, junction nodes around −1567, 560) went from 18 broken zebras to 0: the
station side is open and the nearest island, a 2 m strip 6 m east of Roosevelta's western roadway, is out of reach. Fix
by modelling tram strips and central medians as walkable blocks in the geodata pipeline (`tools/`), then re-measure
crosswalks (1887 of 1928 tracks) and the connected set.

1. **`road-paint.js`**:
   - **All markings white** (`YELLOW` stops being used for centre lines, `:89-93`): P-1 dashed, P-4 solid/double solid
     between opposing lanes;
   - bike lanes **red** instead of green (`:97-106`; gate on OSM `cycleway=lane` instead of `axis==='ave'`);
   - P-10 zebras ≈ 4 m deep with 0.5 m stripes. `CROSSWALK` (`road-network.js`, 2.5 m) → ≈ 4.0. It also moves the
     stop-line setback, which is correct, but it changes lane lengths;
   - P-12/P-14 stop lines; optional "BUS" lane text.

   **Done** (Phase 11.1): all white; P-1 dashed lane lines (4 m / 8 m), P-4 double solid between opposing lanes where
   either way has ≥ 2 lanes, P-1 dashed between single opposing lanes above 30 km/h, none at ≤ 30 km/h; P-14 stop lines
   at signalised approaches only (the geodata has no STOP/give-way signs for P-12/P-13); P-10 zebras 4.0 m deep in
   0.5 m stripes (`CROSSWALK` 4.3 = zebra + 0.15 m margins); red bike lanes from new link flags bits 3/4 (OSM
   `cycleway=lane`/`opposite_lane`, 15.2 km of curb tagged), painted only where the outer lane leaves ≥ 1 m (4.1 km).
   No "BUS" text: the graph carries no bus-lane data. Browser rendering unverified at the time of writing.
   Later checked against the regulation's annex (Dz.U. 2019 poz. 2311, załącznik nr 2): lane lines became P-1b
   (2 m / 4 m; 4 m / 8 m is P-1a, above 70 km/h). P-14 became 0.75 m rectangles 0.25 m apart, on every junction
   approach. Centre lines are dropped under 5.8 m of carriageway. P-14 then moved 2.0 m before the zebra (4.2.5):
   `STOP_SETBACK` 1.75 m between the `CROSSWALK` band and the stop line, given up first on short links, which then get
   no P-14 (1834 of 2684 approaches had one; see [`world.md`](../world.md) road-paint and Markings). That was too many, so
   P-14 now goes on every signalised approach (7.6.2.4; on squeezed links at the edge end, closer than 2 m to the zebra)
   and on unsignalised major-road approaches with the full setback, standing in for the priority roads where 4.2.1
   requires it before crossings; nowhere else: 377 signalised + 117 major = 494 stop-line pieces of 2684 approaches.
   Zebras then moved from every paint-edge end (3616, 276 overlapping pairs, X shapes inside junction complexes, 2208
   ending in the roadway) to exactly the crosswalks `pedestrian-routes.js` lays (1374: curb island to curb island,
   none overlapping, the longest roads' first); unsignalised major-road P-14 only before one (49, so 426 pieces).
   Browser rendering of that change unverified.
2. **`street-details.js`**:

   **Status: done** ([`world.md`](../world.md#street-furniture-street-detailsjs)), not yet checked in a browser. Signal
   heads go per junction from `SIGNAL_SITES` (now with `junction` and `arms`), not from `node.signal` (street details
   still run before the network); groups are re-derived from the arms, as `sidesAndGroups` ranks them. No S-2 arrows
   or countdowns. Name plates go on building walls found through the colliders main.js now passes in; the pole blades
   are gone. Steam stacks, subway entrances, god rays, the `streetZ` window and `fromOldFrame` were already gone in
   Phase 5; `createSteamMaterial` stays. New: `roadClearance`/`LANE_GUIDE` in city-config, because curb outlines
   alone left furniture in lanes near merged junctions. Furnished network 184.6 of 193.8 km (95.3%; it was 182.5 km
   with the NYC set). Follow-up: signal poles moved behind the crosswalks (turning curves cut the corners they stood
   on), `LANE_GUIDE` gained the junction chords, narrow-lane reach and one-way pair lanes, furniture keeps off the
   crosswalk landings (`JUNCTIONS`), every prop is a player collider, and the name plates follow the Poznań SIM 2017
   design: 193.5 km (99.8%), 1851 of 1884 crosswalks (before the crosswalk rework; now 1374 crosswalks, see above).
   - **§1 signals.** Pole-mounted S-1 three-aspect heads (black/grey housing; some with a yellow backplate) at each
     signalised corner, an S-2 arrow where configured, and pedestrian red/green figure heads with countdowns. They are
     driven from `node.signal` (Phase 2). Street names move from pole blades to wall plates on corner buildings.
   - **§2 lamps.**
     - Remove the `streetZ(61)..streetZ(14)` / `|cx| < 920` window (`:322-327`) and the axis-based "avenue edge" test;
       use the per-street class instead.
     - Modern LED bent-mast poles on main streets (OSM: 1,624 lamps in the core, mostly `bent_mast`).
     - **Historic gas lanterns** in the Old Town, which Poznań still lights.
     - Pooled lights (§8) unchanged.
   - **§2B** god rays: re-place or drop. **§3** steam stacks: delete (keep `createSteamMaterial` for chimney smoke).
   - **§4** subway entrances: delete. Poznań has no metro; tram stops replace them (Phase 9.1).
   - **§5** carts → kiosks (press/flower stands), **słupy ogłoszeniowe** (advertising columns, 146 city-wide), parking
     machines (704 city-wide).
   - **§6** hydrants → tall red Polish hydrants; USPS boxes → red Poczta Polska boxes; plus bollards.
   - Respect the obstacle rule and call `addFootprint` for each.
   - **Don't place Poznański Rower Miejski bike-share docks.** The system closed in Nov/Dec 2022.
   - Delete `fromOldFrame` uses (518, 547, 714, 771).
3. **Trees** (`trees.js`, `SPECIES` 398-420).
   - Replace London plane / honey locust / American elm with **lime (lipa), horse chestnut (kasztanowiec) and Norway
     maple**: repaint the 2×2 leaf atlas tiles 0–2 (painters at 75/100/129).
   - A 4th species (plane or birch) needs a 3×2/4×2 atlas and touches `meshIndex` (861).
   - OSM has 2,521 `natural=tree` nodes in the Stare Miasto core alone. Optionally plant real tree positions there
     instead of procedural rows (keep `mulberry32` determinism for the rest).
   - §7 A/B (Bryant Park allées, Central Park CPB) are deleted. C/D (street trees from `sidewalkBlocks`) stay.
   - **Status: done** (bar the options). `SPECIES` is lime / Norway maple / horse chestnut on tiles 0–2 (heart-shaped
     leaves with the odd bract, toothed five-lobed leaves, seven-leaflet palmate leaves), with per-species crowns,
     tints and bark (`createTreeMaterial`). The indices keep their callers' roles, so `street-details.js`, `city-grid.js`
     and `buildings.js` are unchanged (lime where the plane was, maple where the locust was, chestnut where the elm
     was); the `street-details.js` §4 comments are renamed too. The Bryant Park and Central
     Park plantings were already gone (Phase 5). Skipped: the 4th species, and OSM tree positions (no `natural=tree`
     in the `tools/data` snapshots; it needs a new Overpass query and a geodata key). Unverified in a browser.

### Phase 12: Audio, lighting, cameras, teleports, cleanup

**Status: done except the 12.5 docs rewrite and the archiving of this plan** (2026-10-28; checked headless, not yet
seen or heard in a browser).
- 12.1 audio: Polish two-tone siren with a fast wail 6 s in every 30 s; slow red tick and fast green rattle at
  crossings; Fara and Katedra bells on the hour from the in-game clock (`js/city-clock.js`); the noon show at the
  Ratusz under the Midday preset. The hejnał is a generic natural-trumpet call, **not** Poznań's real melody.
- 12.2 lighting: `sunPosition()` (NOAA/Meeus) at 52.41 N, 16.93 E; each preset carries a `when` time. Twilight and
  night raise the rendered sun (`minElevation`). The far plane went from 60 to 32 km. Golden hour is now a real 8° sun,
  so its shadows are much longer.
- 12.3 cameras: the eight place views (`PLACE_VIEWS`) and the drone at 125–155 m. Open: the katedra view hovers over the
  Cybina because Most Jordana is not in the snapshot, and no test checks line of sight.
- 12.5 cleanup: the NYC dead code, names, comments, materials (sidewalks, curbs, park paving, manholes), the
  billboard, the steam stack, the LPR helicopter livery and the Urbino-like bus are done. The `nyc-*` localStorage
  migrations are kept on purpose. Still to do: the full `docs/*.md` rewrite and archiving this plan.

Done earlier, ahead of this phase: the teleports (12.4 table, `TELEPORT_LOCATIONS`, the Ratusz
test; the `dworzec` sub-label reads "Most Dworcowy · Łazarz"), the tram motor hum, wheel squeal and bell (Phase 9.3),
and the `nyc-sound` → Poznań key rename with migration. 12.5 must also cover the unlisted NYC leftovers in **Open items
from the 2026-10-27 audit**; grep case-insensitively.

1. **Audio** (`docs/audio.md`: fields are read directly and break silently; there are no tests).
   - **Siren**: replace the US wail/yelp (`audio-synthesis.js:201-215,522-555`) inside the existing `'siren'` kind with the
     Polish two-tone hi-lo (≈ 435/580 Hz, ≈ 0.5–0.6 s per tone, stepped square control wave), with an occasional fast
     wail. No allow-list change is needed.
   - **Crossing signals**: Polish acoustic signals (a slow tick on red, fast clicking or beeping on green). Only the timing
     changes (`audio-events.js:276-286`).
   - **New**:
     - tram motor hum and wheel squeal (a new motor kind on the allow-list at `audio-synthesis.js:306`);
     - the tram bell double "ding-ding" (a one-shot in `levels`, `playEvent` and the `emit()` ref/range);
     - church bells (Fara, the Katedra) on the hour;
     - the **noon hejnał + koziołki** at the Ratusz, by proximity, keyed to the Midday preset or clock.
   - Keep the horn (365/465 Hz). Speech formants are language-neutral, so Polish fricatives are optional.
   - Rename the `nyc-sound` key (Phase 3.7).
   - Update `docs/audio.md`, and the Battery-tunnel comment at `audio-sources.js:198`.
2. **Lighting** (`lighting.js` `TIME_PRESETS`, 30-140).
   - The presets are hand-tuned `sunDir` vectors in the NYC frame, which is rotated 29.02°. Re-derive each one from
     azimuth/elevation at **52.41 N, 16.93 E, Europe/Warsaw**, rotated by the D2 bearing (0 → no rotation):
     - noon elevation ≈ 61° at the summer solstice, ≈ 38° at the equinoxes, ≈ 14° at the winter solstice;
     - summer solar noon ≈ 12:53 CEST, summer sunset ≈ 21:18 CEST, winter sunset ≈ 15:40 CET.
   - Keep the "17:45 golden" preset but pick a Poznań date that makes the label true (e.g. late September), or relabel
     it.
   - Summer nights never get fully dark (the sun stays ≈ 14° below the horizon at midnight), so the midnight preset can
     keep a blue twilight sky.
3. **Cameras** (`cameras.js` `CAMERA_PRESETS` :8-20 and the switch :258-325). Every position is a Manhattan world
   coordinate; re-author all of them. **Lower the altitudes**: the tallest building is ≈ 116 m (AND2) / 103 m
   (Collegium Altum), so the 330 m drone and 322 m observatory are far too high. New set:
   - `rynek` (Stary Rynek & Ratusz)
   - `katedra` (Ostrów Tumski from Most Jordana)
   - `cytadela`
   - `malta`
   - `zamek` (Zamek Cesarski / Św. Marcin)
   - `warta` (riverside boulevard)
   - `baltyk` (a terrace view ≈ 60 m, replacing `observatory`)
   - `dworzec` (Poznań Główny / Avenida)

   IDs also live in:
   - `index.html` `data-camera` (`:243-257`);
   - the `main.js:507-523` digit bindings;
   - `tests/cameras.test.cjs:185`, which iterates `['chase','observatory','drone']`: update it if you rename
     `observatory`. Its `./landmarks.js` stub (`:62`) remains.
4. **Teleports** (`TELEPORT_LOCATIONS` must match `index.html` `data-teleport` keys exactly; `tests/teleports.test.cjs:13-24`
   checks `blockAt === null`, on-land, and `nearestRoads(…, 20)` within half the road width).

   | key | label | sub-label |
   |---|---|---|
   | `rynek` | Stary Rynek | Ratusz · Stare Miasto |
   | `katedra` | Ostrów Tumski | Katedra · Ostrów Tumski |
   | `zamek` | Zamek Cesarski | ul. Święty Marcin · Centrum |
   | `baltyk` | Bałtyk | Rondo Kaponiera · Jeżyce |
   | `dworzec` | Poznań Główny | ul. Dworcowa · Łazarz |
   | `teatr` | Teatr Wielki | ul. Fredry · Centrum |
   | `cytadela` | Cytadela | al. Armii Poznań · Winiary |
   | `malta` | Jezioro Maltańskie | ul. Baraniaka · Rataje |

   Replace the OWTC/Vesey St test (`teleports.test.cjs:26-34`) with "Ratusz arrives on Stary Rynek facing the tower". The
   `main.js` slice markers (`'  function teleportTo('`, `'  const openMapBtn'`) and their free-variable stubs must follow
   any rename (`NYCMapSystem` → `CityMapSystem`).
5. **Cleanup.**
   - Delete the empty `streets`/`avenues` keys and the dead comments.
   - Grep for `Manhattan|NYC|New York|Broadway|Hudson|Brooklyn|Queens|Bronx|MTA|NYPD|ConEd|taxi yellow`; the
     tsl-materials billboard strings are at 1936, 2046, 2160, 2219.
   - Update every `docs/*.md` to describe Poznań.
   - Remove this plan's "status" note, or archive it.

### Phase 13: Denser blocks, a larger detail box

**Status: 13.1 and 13.2 done, both unverified in a browser** (decided 2026-10-27; 13.2 done 2026-10-28).

13.2 results:
- The box is 52.383–52.434 N, 16.880–17.000 E: x −3675…4491, z −2831…2844, 46 km². Snapshots were refetched on
  2026-10-28, with no tag changes inside the old box.
- Build:

  | | Before | After |
  |---|---|---|
  | Geodata | 1.42 MB | 2.48 MB |
  | Build time | 14 s | 29 s |
  | Peak RSS | 0.81 GB | 1.27 GB |

- Network and buildings:

  | | Before | After |
  |---|---|---|
  | Blocks | 796 | 1,422 |
  | Road links | 3,903 | 7,116 |
  | Buildings | 10.4k | 20.1k |
  | Zebras | 1,602 | 3,310 |
  | Signalised junctions | 235 | 490 |
  | Tram routes | 36 | 38 |

- `MAX_ROOF_INSTANCES` went from 64k to 128k (82.6k used). Before the change the pool overflowed and dropped roofs.
- A new `ESTATE` profile covers Nowe Winogrady, Żegrze and Piątkowo. The garden suburbs and industrial districts steer
  by `blockStats` storeys.
- Headless boot: the builders take 2.0 → 3.1 s, and the scene holds 7.8M → 12.4M triangles before culling.
- Open:
  - villa districts are still under their real density (Sołacz 3.7 vs 9.0%, Winiary 8.9 vs 17%);
  - Chartowo is over (18.8 vs 12.1%);
  - the near-balcony pool is at 245 of its 256 cap.
- Browser checks: load time and frame rate, roofs across the box, the Winogrady/Żegrze slab strips, the box edges
  against the outskirts, single GRUNWALD/WINOGRADY map titles, and the Plac Waryńskiego paving cut.

1. **Density** (`buildings.js`; done, not yet checked in a browser). The emptiness came from building generation,
   not missing lots. Frontless lot rects (20–40% of the lot area by district) and the cores of big rects were left
   as yard, and the Targi (one 29 ha curb island) took the kamienica profile. They now get `innerLot` /
   `innerBuildings` and `FAIRGROUND`. The headless footprint count went from 3.80 to 4.39 km² over the detail box,
   and the Targi from 12% to 35% built. Pieces of part-park blocks that lie in a park ring are no longer built
   (0.42 km² of buildings had stood in parks), and the osiedla get schools, shop pavilions and garages between the slab
   rows. Net result: 3.80 → 4.00 km². Footprint per lot area went from 49% to 57% in Stare Miasto and from 21% to 26%
   in Rataje; that is about what real panel estates reach.
   - The Warta banks stay green on purpose. Their emptiness is park blocks (Park Nad Wartą, Skwer Obrońców Ukrainy,
     Malta, Polana Harcerza), which are meadows and the Wartostrada in reality too. Building on their non-park 0.61 km²
     was tried and reverted.
   - Still to check in a browser: the Targi, the side streets of Św. Marcin, Rataje by Zamenhofa. If the centre still
     looks empty, look next at gaps in the frontages and at the 4.6 m lot setback with slivers up to 13 m deep.
2. **Extent:** grow D3 by about 1 km on every side, to ≈ 8.1 × 5.7 km ≈ 46 km² (2×).
   - Move `DETAIL_LL` in `tools/poz-base.mjs` and the padded boxes in every `q_poz_*.overpassql`, then refetch and
     rebuild. Expect about 2.6 MB of geodata.
   - Measure the build heap (8 GB today), the boot time and the instance pools (`MAX_ROOF_INSTANCES` 32k, the streamed
     `MAX_*` caps).
   - Re-check `outskirts.js` zones that the new box now swallows (Winogrady, Rataje, Grunwald), `blockProfile`
     districts that have no profile yet, the map extents and the teleport and camera tests.

### Phase 14: Real building density from OSM

**Status: steps 1–2 done, not yet checked in a browser; step 3 open** (decided 2026-10-27). This replaces guessing the density from the street layout.
- Snapshot: 13.4 MB, 14,287 footprints, 10,508 in the detail box, `building:levels` on 84%. `GEO.blockStats` adds 8 KB.
- `poz-blocks.mjs` now emits more lot rects per frame (12/10, stopping at 2% of the mask), which shrinks the holes in big irregular blocks. Geodata 1.33 → 1.37 MB.
- Generated vs real built share: 16.2% / 17.3% over the detail box. Still under real: Sołacz and Winiary (villas, 4.3% / 8.9%) and Św. Marcin's side streets (29% / 38%).
- Nine large blocks under 5% built in OSM (0.69 km²) may be under-mapped. Check them against BDOT10k (step 3).

1. **Data** (`tools/`): a `q_poz_buildings.overpassql` snapshot (`building=*` ways and multipolygons in the padded
   box, tags trimmed to `building`, `building:levels`, `height`). Rasterise the footprints on the `poz-blocks.mjs` 1 m
   block raster and emit `GEO.blockStats`: one entry per `GEO.blocks` entry, the built share of the curb island, the
   median `building:levels` and a building count. Do not emit the footprints themselves; they would add several MB.
   ODbL like the rest, so no new attribution.
2. **Runtime** (`buildings.js`): steer each block toward its real built share and storeys through the frontage gaps,
   the inner-lot kinds and the row floors, instead of fixed profile weights.
3. **Check** against GUGiK BDOT10k `OT_BUBD_A` for Poznań, once. Use BDOT10k only where OSM is incomplete. It is free,
   in EPSG:2180, licence wording unconfirmed. GUGiK LoD1 2024 (`measuredHeight`) is for later, for heights.

### Phase 15: Bug fixes and Polish vehicles

**Status: items 1–5 and 7–10 done, item 6 implemented in Phase 16 (2026-10-29)** (opened 2026-10-28 from in-browser reports and the agents'
open items). Everything was checked headless only (230 tests).
- 15.1: Plac Cyryla Ratajskiego and Plac Wielkopolski are paved round a 2.29 m cut on each side of the track
  (`cutSlab`). Every prop keeps 2 m off any rail (`clearOfRails`); 48 square/park props, 154 street props and 66 street
  trees were removed or moved. Open: 18 signal poles found no free spot and are gone. Platforms sit 1 cm above the slab,
  which may flicker.
- 15.2 root causes:
  - lanes aimed into merged junction centres;
  - divided roads forced onto one centreline;
  - the tram strip added to both sides when the tracks run on one side (now link bits 3/4: 35 right, 475 left);
  - kinks where the lane count changes;
  - 6 stale stop lines.

  Lane centres off their carriageway: Św. Marcin 4.3% → 0.3%, Roosevelta 1.4% → 0.2%. Zebras 1388 → 1602. Open:
  two-way streets with tracks down the middle keep lanes on the tracks, and some docs numbers were not re-measured.
- 15.3: five classes (Corolla-class taxi, hatch, estate incl. Policja, crossover, high-roof van incl. PRM and PSP) and
  per-car EU plates (PO/PY/PZ) from one glyph texture. There are 15 instanced meshes instead of 11. Open: the PSP is a
  van rather than a truck, and the plate font depends on Arial Narrow/Arial being installed.
- 15.4: bike lanes and their flags are removed. The cyclist player mode stays.

1. **Trams drive through square furniture and their rails vanish on squares** (reported at Plac Cyryla Ratajskiego).
   Cause, measured: `pavedPlazas()` (`js/city-grid.js`) drops only the place outlines with more than 30 m of `ROADS`
   inside. It does not count `GEO.rail`. Plac Cyryla Ratajskiego has 146 m of tram track and 0 m of road inside its
   ring, and Plac Wielkopolski has 366 m and 0 m. Both are paved with the 0.24 m granite slab, which buries the
   rails. Their edge lamps and benches (`addLamp` / `addBench`) and planter trees land on the track, and trams do not
   collide with prop colliders. Fix:
   - Treat tram track inside a plaza like a road: either skip paving such squares, or cut a hole in the slab along each
     track (the track gauge plus about 1.5 m of clearance a side) and keep the rails and catenary visible.
   - Keep every piece of plaza and park furniture (lamps, benches, planters, trees) and every square furniture collider
     at least 2 m from any `GEO.rail` track.
   - Also check other furniture sources against the rails (`street-details.js` kiosks, columns and trees,
     `tram-infra.js` platforms, landmark props).
   - Test: no prop collider or furniture instance within 2 m of a tram track, and every plaza with tram track inside it
     still shows its rails (not under a slab).
   - Files: `js/city-grid.js`, maybe `js/street-details.js`, tests.
2. **Shifted lanes; cars line up oddly.** Seen on **Św. Marcin** and **Roosevelta**: lanes are painted off their real
   position, and cars queue at odd offsets or angles. First collect cases (coordinates or street names and a screenshot) and a headless check:
   - lane centres more than about 0.3 m from the paint;
   - lanes crossing the curb or a median;
   - joins between consecutive edges whose lane offsets jump.

   Suspects:
   - lane offsets of OSM `lanes` / `width` mismatches;
   - divided roads where the left bike lane or the median drops a lane;
   - the bike-lane offset (see 15.4);
   - `turn:lanes` / lane counts changing mid-link;
   - stop-line queues using a different offset than the lane paint.

   Files: `js/road-network.js`, `js/road-paint.js`, `js/traffic.js` (source-sliced tests).
3. **Polish vehicles** (`js/actor-models.js`, `js/traffic.js`, `js/tsl-materials.js`). Decided 2026-10-28: vehicles
   should resemble models that are popular in Poland.
   - **Taxi**: a Toyota Corolla-like saloon or estate (most Poznań taxis are Corolla hybrids).
   - **Ambulance (PRM)**: a VW Transporter / Crafter-class van box ambulance.
   - **Fire service (PSP)**: a van or a medium truck in the same spirit, plus the red PSP livery.
   - **Policja**: a common police saloon or estate (e.g. Kia Ceed / Škoda Octavia-like) with the Polish blue-silver
     livery.
   - **Private cars**: hatchbacks, estates (kombi) and compact SUVs or crossovers in the spirit of Škoda Octavia /
     Fabia, Toyota Yaris / Corolla, VW Golf, Kia Sportage / Dacia Duster, plus delivery vans (Ducato / Sprinter-class).
     Use smaller widths and lengths than the US bodies, and a palette leaning to greys, whites, blacks and silvers.
   - **Licensing: resemble, never copy.** Use generic proportions and silhouettes of the vehicle class only. Do not put
     brand names, badges, logos, grille trademarks or model names on the vehicles, in textures or in UI text. Do not
     import third-party 3D models, blueprints or photos as textures. Code comments may name the class ("Corolla-class
     saloon"). Official liveries (Policja, PRM, PSP) are public-service markings: approximate their colours and
     reflective patterns, and keep crests and emblems out. Taxi crests are already skipped for this reason.
   - **Plates**: EU white plates with the blue EU band, using `PO`, `PY` and `PZ` prefixes (Poznań city, the city's
     second series, Poznań county) and a plausible Polish plate layout (`PO 1AB23`, `PZ 12345` style). Drawn
     procedurally, no real registrations.
   - The MPK bus and the helicopter are in Phase 12.5, and the 18 m articulated bus is still in Phase 10. Keep the
     draw-call count per class, and update `docs/actors.md`.
4. **Remove bike lanes** (decided 2026-10-28). The red bike-lane paint looks poor. Remove the paint, the `edge.bike` lane
   offsets and their effect on lane placement, and link flag bits 3/4 and their build code if nothing else needs them,
   then rebuild the geodata. Removing them also takes away one suspect of 15.2. Check what reads `bike` before
   deleting: `road-network.js`, `road-paint.js`, `traffic.js`, `audio-*.js`, the cyclist player mode in
   `controllers.js`, and `tools/poz-roadgraph.mjs`. The cyclist player mode stays, riding in the roadway.
5. **Agent-reported open items: done 2026-10-28.**
   - Pedestrians on tram strips wait 2 m clear of the rails, and trams brake for pedestrians within 1.7 m.
     Measured over 3 minutes at six crossings, people within 1.7 m of a track went from 10,439 samples to 0. Split
     crosswalks went from 22 to 12.
   - Zebra paint leaves 1.7 m either side of a track unpainted (238 zebras).
   - Map pins merge into one ringed dot with a count ("Ratusz +2").
   - The HUD street join is now `STREET_JOIN = ' / '`.
   - Tram off-route samples went from 1.15% to 0.44%. The rest is data: the Zawady loop is in no route relation, and
     some relations end inside the box.
   - Crossers at unsignalised zebras make no measurable difference to traffic.
   - Signal heads move to the left pole when the right curb has no spot, so arms without a head went from 219 to 161.
   - Still open: the central Dworzec node still has no zebras (needs medians and tram strips as blocks in `tools/`).
     One approach at (675, 2738) off Krucza/Zamenhofa has no signal head.
6. **Traffic gridlock: initial fixes 2026-10-29; continued in Phase 16.** The measurements below are the historical
   baseline before Phase 16, whose final measurements supersede them.
   - Benchmark: `node tools/bench-traffic.mjs` (`docs/testing.md`).
   - Over 7 districts × 5 min:

     | | Before | After |
     |---|---|---|
     | Mean speed | 5.0 km/h | 11.6 km/h |
     | Cars stopped | 67% | 47% |
     | Longest queue | 36 cars | 11 cars |
     | Cars held > 120 s | 115 | 35 |
     | Deadlocks | 3 | 0 |

   - Causes and fixes:
     - The car pool is now capped at 12 cars per km of nearby lane (sparse districts show 28–81 cars, not about 180).
     - Unsignalised two-arm bends give right of way both ways.
     - A held tram blocks only what is under its body.
     - Pedestrians may cross in front of a tram that is waiting for them.
     - A zebra courtesy rule: a car that has waited 5 s gets priority.
   - `tests/traffic-flow.test.mjs` guards against deadlocks.
   - Addressed in Phase 16: local timing/offsets, demand-only two-arm crossings, the opposite-track lane at Rynek
     Jeżycki, whole-tram switch/exit reservations, and the diagonal tram–pedestrian clearance mismatch.
   - Optional remaining work: passing a left-turner on a wide single-lane give-way approach (Łazarz (−1875, 1299)).
7. **Villa density: done 2026-10-28.** A new `villaBlock` layout builds detached houses steered to each block's real
   share. Blocks that are empty in OSM stay empty, and Chartowo is now an `ESTATE`. On buildable blocks:

   | District | Before | After | Real |
   |---|---|---|---|
   | Sołacz | 7.1% | 12.7% | 12.9% |
   | Winiary | 8.8% | 17.4% | 17.0% |
   | Ogrody | 10.2% | 17.1% | 15.9% |
   | Chartowo | 18.7% | 13.0% | 12.1% |

   Covered by `tests/buildings-density.test.cjs`. **Decision pending:** whether to build inside the 13 park blocks.
   Leaving them unbuilt keeps Sołacz at 6.7% vs 9% and Antoninek at 3.2% vs 6.6% over the whole district. Górczyn and
   Grunwald Północ are about 15% over.
8. **Trackbed over roadways** (reported on Hetmańska): done 2026-10-28 in `js/tram-infra.js` (`layoutTrackBeds`). The
   ballast narrows to 2.4 m or goes flush, so it now covers 0 m² of carriageway (297 m² before). The worst case was
   28 Czerwca 1956 r. just south of Hetmańska, at 84 m². Hetmańska itself has no ballast. Two candidates there, not
   changed until the user confirms:
   - on the 3-lane stretch, the outer lanes run 0.5 m past the carriageway toward the flush tracks;
   - near Dmowskiego (−2448, 2214), the rails ride up on a 0.22 m curb sliver.

   Zebras over ballasted track are still covered by the bed.

   **The actual Hetmańska bug, fixed 2026-10-29.** The street had an 80 m gap under the Górczyn railway bridge
   (−1855, 2482). OSM maps it as `tunnel=yes` / `layer=-1`, and `poz-roads.mjs` dropped every underground way. The
   mainline track lay across the gap.
   - `railwayUnderpasses()` now keeps underground roads and tram ways that cross at-grade mainline track. That also
     restored Nad Wierzbakiem and two service roads.
   - Level crossings (`GEO.levelCrossings`, 39 nodes) get flush rails and no ballast, wall or fence on the road.
   - Covered by `tests/rail-crossings.test.cjs`.
   - Open: sidewalks stop under rail bridges, because giving them back joined blocks into rings. There is no viaduct
     deck or raised track, and level crossings have no barriers.
9. **Re-measure the docs: done 2026-10-29.** Refreshed `docs/world.md` and `docs/actors.md`: grid and street furniture,
   road paint, network and crosswalk counts, tram infrastructure and tram–road mappings. The documented headless
   snapshot builds the grid before the furniture, passes its sidewalks and both footprint sets to traffic, and
   measures paint after the final pedestrian/signal configuration. Rendering is stubbed; building, landmark and
   bridge colliders are omitted. It has 442.8 lane-km, 864 stop-line strips, 205.3 km of P-1b, 2.3 km of P-1a,
   0.95 km of P-4 strips and 130.4 km of directed tram edges. Historical comparisons and the benchmark variant
   are labelled separately. The measurement scripts were re-run independently with matching totals; browser
   rendering/audio and dynamic traffic benchmarks were not re-checked for this docs-only update.
10. **Tram route data: done 2026-10-29.** The rail geometry already existed; its route membership was missing.
    `TRAM_ROUTE_EXTENSIONS` in `tools/poz-roads.mjs` completes five ways using adjacent OSM member-way anchors:
    - Zawady line 5: the two missing member ways from the arrival stop `(1635.7, −502.7)` through the proper departure
      stop `(1650.1, −561.4)`. The outer loop bypasses that stop and remains unassigned.
    - Ogrody lines 2/7/8/18: the main loop from `(−3501.3, −945.7)` to the actual departure stop
      `(−3475.8, −870.5)`. The siding and alternative bypass remain unassigned.
    - Starołęka lines 7/12/13: the two split ways that carry the routes across the map boundary, closing the
      membership gap starting around `(696, 2718)`, 126 m before the boundary.
    - This adds 12 way memberships and routes six previously unassigned chains, 998.1 m: track on a route
      120.7 → 121.7 km of 127.4 km (473 → 479 of 642 tram chains). The generated change is confined to those six
      `rail[].routes` arrays; track geometry, the 38 route records and all other output values are identical.
    - Three exact-coordinate regressions failed on the old output and pass now: both main loops through their
      boarding stops, return destinations with both branch choices, and both Starołęka directions. Fresh-build
      geodata tests check all three places too. Full suite: 271/271; two rebuilds are byte-identical. The 7 × 5 min
      traffic benchmark is unchanged: 15.6 km/h, 32.0% stopped, no >120 s car holds, persistent deadlocks or >60 s
      continuous switch waits. No input refresh was needed. Live loop observation remains a manual browser check.

### Phase 16: Signal timing and trams on switches

**Status: implemented; headless targets met** (2026-10-29). Local timing, pedestrian requests and tram exit
reservations are complete. The WebGPU smoke check passes; the detailed browser checks below remain manual.

Implemented:
- One shared plan per physical junction; inbound lane/width demand chooses the split. Minor and compact junctions
  start with 44 s cycles, arterial plans 60/76 s. Named green-wave corridors share 60 s cycles (65 s on Św. Marcin);
  offsets follow road distance at 40 km/h, with deterministic offsets elsewhere. Compact non-corridor signals joined
  by 14–100 m links start with 44 s to reduce queue spillback. After the final walking routes are built, splits and
  cycles reserve enough time for the last WALK entrant to cross the measured width at 1 m/s; all cycles remain
  within 90 s. This corrected 141 crossings with insufficient clearance. Both groups keep at least 10 s green,
  3 s amber and 2 s clearance/red+amber; WALK is 7 s steady plus 3 s flashing green.
  Roosevelta also has a coordinated 60 s arterial plan through Kaponiera, taking precedence at its shared Bukowska
  and Głogowska sites. Corridor names match OSM's full names, including Jana Henryka Dąbrowskiego and Ewarysta
  Estkowskiego; the latter's two sites share the one Garbary junction plan.
- Road nodes, trams, pedestrians, audio and heads consume the same cached plan state. The heads use one RGBA8 texture
  plus an immutable per-instance plan coordinate rather than duplicating the CPU schedule in TSL; culling copies
  the coordinate, so requests still work after chunking. Original OSM arm matching preserves head/traffic grouping
  even when lane centring rotates a runtime arm across the 35° threshold. Merged-site aliases retain orientation.
- On the furnished graph, 22 two-arm signals become pedestrian requests and 12 without crosswalks are disabled;
  311 stay regular signals. The 12 disabled sites have dark lenses and no audio; their static poles/housings remain
  because furniture is built before the final walking network. Their signal-only stop lines are also disabled.
  Rebuilding the world resets dynamic plans and produces the same furniture, lanes and timing each time.
- Trams check space for their whole body plus 2 m beyond switches, tram crossings, road/mainline crossings and
  occupied platforms. A tram already inside keeps going; one waiting for exit room does not claim priority over
  other approaches. `room` describes a blocked exit, `switch` an actual conflict. The benchmark follows both the
  following and exit-room leader links, so neither can conceal a deadlock.
- Benchmarking exposed two traffic constraints alongside the new signals: coarse box claims could retain a
  physically disjoint turn until its far exit line (a Jeżyce car–tram–car cycle), and one sharp point imposed its
  speed on an entire long connector (a 38.7 m Centrum turn crawled at 0.9 m/s). Box conflicts now require actual
  swept-path overlap including the rear/body curvature; curve speed profiles reserve braking distance before local
  bends. Both cache their sampled geometry and have exact-coordinate regression fixtures.
- Exit reservations now rank approaches consistently and ignore uncommitted red-light contenders; a stable
  arrival order at the stop line prevents newer cars from continually jumping a waiting lane. Demand crossings
  give the road at least 20 s green between requests (WALK and full crossing clearance unchanged), so queues can
  discharge before the next request closes the road.
- The Rynek Jeżycki opposite-track lane (15.6) proved necessary to fix the last >120 s car waits. Flagged shared
  street lanes now align to an unambiguous right-hand track pair only inside the roadway and clear of obstacles;
  generic, single/ambiguous-track and segregated roads are unchanged. Paint and connectors inherit the correction.
- Queue/red holds propagate backwards over closely spaced protected zones, preventing a tail from fouling the
  earlier switch while its nose waits before the next. Straight shared-lane movements are not crossing reservations;
  real turns, convergence and crossings remain protected. Curb stop nose offsets are clamped only where the whole
  dwelling body remains clear; fixed island stops keep their boarding geometry.
- A stationary tram before a crossing no longer reserves car curves 2 m beyond its actual nose. A tram dwelling
  or held by a red/obstacle also yields its future switch approach priority; its actual body still holds any
  crossing it occupies. Competing switch/block approaches retain their priority order. Green entry past the
  effective complex stop line is recorded, so a later interior red cannot strand a tail across an earlier crossing.
- Pedestrian waiting clearance is 2 m normal to the rails at every angle, matching the tram's actual obstacle
  envelope (the old 1.8 m still overlapped its diagonal pedestrian square). This removes a two-tram/two-crossing
  wait cycle exposed by the new protected-complex routing.
- Optional item 5 (passing a waiting left-turner) is deferred: it needs lane/trajectory safety work.

Final measurement: `node tools/bench-traffic.mjs --minutes 5` (7 districts, seed 4242, 15 fps, 20 s warm-up;
the same population/spawn rules before and after). Each run used a frozen source snapshot.

| Measure | Before Phase 16 | After | Target |
|---|---|---|---|
| Mean car speed | 11.6 km/h | 15.6 km/h | ≥ 15 km/h |
| Car samples stopped | 46.7% | 32.0% | < 40% |
| Cars held > 120 s | 35 | 0 | 0 |
| Trams held continuously for `switch` > 60 s | 1 | 0 | 0 |
| Longest continuous `switch` wait | 91.5 s | 39.6 s | ≤ 60 s |
| Persistent deadlocks | 0 | 0 | 0 |
| Longest stopped car queue | 11 | 10 | — |

The longest car hold after the change was 117 s. By district, mean speed / stopped share:
Jeżyce 17.7 km/h / 23.1%, Łazarz 13.0 / 27.0%, Centrum 15.0 / 30.8%, Kaponiera 13.6 / 47.5%,
Stare Miasto 16.8 / 11.2%, Rataje 17.8 / 34.6%, Wilda 13.3 / 42.0%. The aggregate targets are met;
Kaponiera and Wilda still have substantial queues. With `--no-signals` (all car phases green; pedestrians and tram
signals retained), the final comparison is 18.5 km/h / 23.4% stopped, with no >120 s car holds or persistent deadlocks.

The benchmark now measures the continuous switch reason every frame, separately from `t.stuck`, which spans all
reasons during a stop. A 55 s red followed by 6 s at a switch used to be labelled a 61 s switch wait. The original
total-stop metric is retained; queued trams may still wait over 60 s for exit room, signals or a track block.

Validation: `node --test tests/` passes 268/268, including real furnished-graph crossing clearance and repeat-build
checks. The five-minute Jeżyce/Centrum flow regression now requires mean >14 km/h, stopped <40%, no car held 120 s,
no persistent deadlocks and no continuous switch wait over 60 s. Unit regressions cover whole-tram exit reservations,
protected complexes, original head/arm alignment, local display/audio requests, box clearance, merge order,
diagonal pedestrian clearance and the Rynek Jeżycki lane geometry. `git diff --check` passes.

Browser smoke checks: Chrome/WebGPU boots and compiles with a clean console; signal lenses render. Forced WebGL2
boots but reports `GL_INVALID_OPERATION: glDrawElements: Vertex buffer is not big enough for the draw call` on both
the pre-change snapshot and Phase 16. This is an existing fallback issue, not resolved here. Full corridor observation,
request cycles at the named junctions and listening checks remain manual work.

**Signal baseline before Phase 16** (historical; implementation notes above supersede this):
- `SIGNAL_TIMING` in `js/city-config.js` is `{ cycle: 60, avenueAmber: 26, avenueRed: 30, streetAmber: 56, redAmber: 2,
  walk: 7 }`. Every signal in the city runs on **one global clock**, with no per-junction offset.
  - Group 0 is the widest road (`isAvenue`, from `road-network.js` `sidesAndGroups`); group 1 is the rest.
  - Red turns green through 2 s of red-amber (Polish S-1).
- These read the same clock and the same functions:
  - `signalPhase(time, isAvenue)` and `walkSignal(time, isAvenue)`;
  - `js/traffic.js` (`avePhase` / `stPhase` / `aveWalk` / `stWalk`, computed once per frame around line 2434);
  - `js/trams.js` (around line 1384);
  - `js/audio-sources.js` (lines 157 and 244: green engines, crossing ticks);
  - the **signal-head shaders** in `js/street-details.js` (around lines 177–230; TSL `mod(clock, cycle)` on a shared
    uniform);
  - `tests/signals.test.cjs` and the `tests/trams.test.cjs` stub.

  Changing the timing means changing all of them together, or the lights you see will disagree with the traffic.
- `docs/audio.md` warns that audio reads `isAvenue` and car fields directly.

**Work:**
1. **Per-junction timing.** Give each signal node an `offset` and optionally its own `split` (the group-0 green share),
   and add a `cycle` per node only if needed.
   - Thread the values through `signalPhase(time, isAvenue, node)` / `walkSignal(…)`, or precompute per-node phase
     functions. Keep the per-frame cost flat: today phases are computed once per frame. Use per-node values, or a
     small table of distinct timings, not a call per vehicle per frame.
   - **Signal heads:** add a per-instance offset (and split) attribute to the head instanced meshes and use it in the
     TSL. Keep the vertex-buffer budget in mind: `docs/rendering.md` notes the WebGPU limit of 8 attributes.
   - **Audio:** pass the node's timing to the crossing-tick source.
2. **Better timing:**
   - **Splits:** green by demand proxy (lanes and width of each group, major vs minor). Minimum green 10 s per group;
     walk ≥ 7 s; clearance (amber 3 s plus all-red 1–2 s) kept.
   - **Cycles:** 60–90 s; a short cycle (e.g. 40–50 s) where both groups are minor.
   - **Green waves:** offsets along the main corridors (Św. Marcin, Głogowska, Grunwaldzka, Dąbrowskiego,
     Królowej Jadwigi, Garbary / Estkowskiego, the Hetmańska / Górecka / Bukowska arterials), computed from the link
     length and a design speed of about 40 km/h. Elsewhere, deterministic pseudo-random offsets so the city doesn't
     flash in sync.
   - **Polish rules to keep:** amber 3 s at 50 km/h roads, red-amber 2 s, pedestrian green then flashing green (the
     audio already has a fast tick on green), trams on their own S-1 groups as today.
3. **Two-arm signal nodes** whose third OSM arm was dropped (example: Wilda (−156, 1992)) stop the road for 34 s per
   cycle for nobody.
   - If the node has a crosswalk, turn it into a pedestrian-only signal: road green by default, red only after a
     crosser has spawned and waited (a push-button style request), with a minimum green.
   - Otherwise drop the signal at build time and give the heads back.
   - Count these nodes and report them.
4. **Trams must not stop on switches or level crossings** (Kaponiera (−1396, 96), Rynek Wildecki (−851, 1681)). Trams
   queue behind a tram dwelling at a busy stop, the queue backs over a switch, and other trams wait at the switch (the
   `'switch'` wait in `js/trams.js` around lines 1310–1340) until respawned after 90 s (`t.stuck > 90`).
   - Add a "don't enter unless you can clear" rule. Before passing a switch's `foulEnd` or a crossing, a tram checks
     that there is room behind the tram ahead (its length + 2 m) beyond the fouling point; otherwise it holds before
     the switch.
   - Do the same for a tram stop whose platform is full.
   - Report the `'switch'` stuck counts before and after.
5. **Single-lane give-way approaches** block behind a left-turner (Łazarz (−1875, 1299)). If the approach is wide
   enough (≥ 5.5 m), let straight and right-turning cars pass a waiting left-turner on its right. Otherwise accept it.
   This is optional; do it only if it is cheap.

**Measure:** `node tools/bench-traffic.mjs --minutes 5` (all districts) before and after each step, plus
`--no-signals` as the lower bound. Targets:
- mean speed ≥ 15 km/h;
- stopped < 40%;
- no car held > 120 s except at a red longer than the cycle;
- no tram held > 60 s at a switch.

**Tests:**
- extend `tests/signals.test.cjs` (per-node phase, splits, clearance and walk invariants for every node);
- keep `tests/traffic-flow.test.mjs` passing and tighten its limits to the new numbers;
- add a tram test for "doesn't stop on a switch".

**Files:** `js/city-config.js`, `js/road-network.js` (where signal groups and nodes are built), `js/traffic.js`
(source-sliced tests: update the markers and stubs), `js/trams.js`, `js/street-details.js` (head shader), and
`js/audio-sources.js`. Do not touch `tools/` or `js/geodata.js`, which are not needed.

**Browser checks** (for the user):
- the heads you see match the traffic at a few junctions (Kaponiera, Most Teatralny, Głogowska / Hetmańska);
- the green wave works along Św. Marcin;
- the crossing ticks stay in sync with the pedestrian heads.

---

## 6. Test impact checklist

| test | what changes | phase |
|---|---|---|
| `boot.test.cjs` | preload count (now 41, after `outskirts.js`, `bridges.js`, `roofs.js`, `balconies.js`, the `landmarks-*.js` split, `trams.js`, `tram-infra.js`); base URL (done) | 5–9 |
| `geodata.test.mjs` | Poznań build, new assertions, output path, temp dir name | 4 |
| `overpass.test.mjs` | none, unless the retry logic changes | — |
| `teleports.test.cjs` | land test, OWTC test → Ratusz test, `NYCMapSystem` stub key, slice markers (all done) | 1, 3 |
| `controllers.test.cjs` | stubs for `ISLAND_BOUNDS`/`CENTRAL_PARK_BOUNDS`/`getIslandBoundsAtZ`/`blockAt`/`streetZ` (`:26`, `:196-201`); clamp math (`:406-418`) re-expressed | 1, 5 |
| `nyc-map.test.cjs` → `city-map.test.cjs` | path, class, GEO stubs, config stub keys | 3 |
| `traffic.test.cjs`, `traffic-performance.test.cjs` | stubs for new free variables in sliced functions (`major`, group helpers, tram yielding); red+amber added without changing the amber assertions | 2, 9, 10 |
| `cameras.test.cjs` | preset id list `:185` if `observatory` is renamed | 12 |
| `vehicle-lights.test.cjs` | bus spec copy `:34` only if the bus is resized | 10 |
| `facade-projection.test.cjs`, `smoke-texture.test.cjs` | source-sliced from `tsl-materials.js`: update the markers if you rename or re-indent there | 5, 8 |
| `trams.test.cjs`, `tram-infra.test.cjs` | new: track graph, stops, signals, obstacle rule | 9 |
| `road-paint.test.cjs`, `signals.test.cjs`, `trees.test.cjs`; `road-network.test.cjs` furnished-network and crosswalk floors | new | 11 |
| `geodata.test.mjs` | missing: all 25 landmark sites present; determinism against the committed `js/geodata.js` | 4, 7 |

Rendering, shaders, lighting, culling and audio have no automated coverage. Every phase ends with a browser check
(`python3 -m http.server 8000`, a WebGPU browser, the console clean), including the WebGL2 fallback after Phase 8 (new
instanced roofs; see commit 2aad875).

---

## 7. Risks (ranked)

1. **The island model is everywhere** (road network, controllers, map, city grid, water shader). Mitigation: Phase 1 lands
   while NYC still works.
2. **The geodata pipeline gates everything.** OSM ways must be split at shared nodes. Widths are mostly defaulted, so curb
   geometry depends on class defaults and the +6.5 m tram rule. Mitigation: iterate on block outlines in the map view
   before building anything 3D.
3. **The largest-SCC filter silently removes streets** when obstacles (tram platforms, poles, kiosks) sit within 1.2 m of
   a lane. Mitigation: log edge counts pre/post SCC and assert a floor in a test.
4. **Silent breakage on renamed exports**: the vm tests give `undefined`, the browser fails at link time. Mitigation:
   boot the page after every rename commit.
5. **Crosswalks and signal groups at general junctions.** Without Phase 2.3 Poznań has almost no pedestrian crossings.
6. **Audio field coupling**: new vehicle kinds go silent unless `audio-sources.js` is updated in the same commit.
7. **Pitched roofs**: a new geometry family. It must go into `placeInFrame`, it adds pipelines, and it needs a WebGL2
   check.
8. **Trams**: the largest new code (mixed traffic, articulated bodies, stops). It is deliberately late and optional for a
   first playable Poznań.
9. **Licensing/attribution**: OSM ODbL (keep the attribution in the geodata header and the README); GUGiK and ZTM terms
   if used; no City or ZTM logos (ZTM terms).
10. **Landmark heights**: OSM `height` is unreliable (1.3% coverage, wrong values). Use nDSM, or document estimates.
11. **Build time and memory**: more framed blocks and more ways. Mitigation: endpoint-key indexes and per-block bbox
    prefilters; keep the 8 GB heap flag.

---

## 8. Suggested milestones

| milestone | phases | result |
|---|---|---|
| M1 "Generic engine" | 1–3 | Manhattan unchanged, byte-identical geodata, the engine city-agnostic |
| M2 "Poznań on the map" | 4 | `build-poznan.mjs` produces a valid GEO; inspected in the 2D map (temporarily wired) |
| M3 "First playable Poznań" | 5–6 | Drive and walk around flat Poznań with generic buildings, river, bridges, map, HUD |
| M4 "Looks like Poznań" | 7–8, 11 | Landmarks, kamienice with pitched roofs, Polish street furniture and markings |
| M5 "Sounds and moves like Poznań" | 9–10, 12 | Trams, Polish vehicles, sirens and bells, sun at 52.4°N, cameras and teleports |

---

## 9. Reference data

### 9.1 Key coordinates and heights (WGS84; OSM/Wikidata, 2026-10-25)

| place | lat, lon | height / notes |
|---|---|---|
| Ratusz | 52.40856, 16.93401 | tower ≈ 61 m (unconfirmed); OSM `height=16` = eaves; way 30611684 |
| Stary Rynek (square) | 52.40826, 16.93354 | 141 m square, central block ≈ 74 × 76 m |
| Fara | 52.4061, 16.9340 | height unknown → nDSM |
| Zamek Królewski | 52.4092, 16.9310 | rebuilt 2016, tower |
| Katedra (Ostrów Tumski) | 52.4114, 16.9478 | ≈ 62 m, 72 × 36 m; the OSM footprint centre is ≈ 66 m away |
| Most Biskupa Jordana | 52.41158, 16.95088 | footbridge 72.3 × 14.8 m, 70 m span |
| Brama Poznania ICHOT | 52.41232, 16.95167 | OSM `height=5` is wrong |
| Zamek Cesarski | 52.4078, 16.9186 | tower 75 m |
| Rondo Kaponiera / Bałtyk | ≈ 52.4078, 16.9125 | Bałtyk 67 m, 16 storeys |
| Okrąglak | 52.4084, 16.9222 | 45 m, 9 storeys |
| Collegium Minus | 52.4082, 16.9157 | |
| Teatr Wielki | 52.4102, 16.9177 | OSM `height=1` is wrong |
| Pomnik Czerwca 1956 | ≈ 52.4079, 16.9170 | crosses 21 m / 19.5 m |
| Poznań Główny | 52.4017, 16.9116 | building 52.4027, 16.9129; Avenida 52.4008, 16.9132 |
| Stary Browar | 52.4024, 16.9255 | 6 storeys; the old 52.4016, 16.9277 was 177 m off the OSM site |
| Iglica MTP | by Most Dworcowy | 64 m |
| Park Cytadela | 52.4215, 16.9349 | ≈ 100 ha |
| Jezioro Maltańskie | 52.4039, 16.9715 | 2.2 × 0.46 km; relation 7550595 |
| Malta Ski / Termy | 52.3993, 16.9793 / 52.4051, 16.9737 | |
| Most Św. Rocha | 52.4020, 16.9448 | 22 m wide, 2 tram tracks |
| Most Królowej Jadwigi | 52.3981, 16.9406 | 185 × 22 m, spans 52.5/80/52.5 |
| Most Chrobrego | 52.4098, 16.9446 | 122 m |
| Most Mieszka I | 52.4105, 16.9512 | over the Cybina, tram |
| Enea Stadion | 52.3977, 16.8582 | outside D3 (outskirts only) |

Tall buildings:

| building | height | notes |
|---|---|---|
| AND2 | 116 m | due 2026; in OSM as `building=construction` |
| Collegium Altum | 103.35 m | |
| Andersia Tower | 102.1 m | |
| Poznań Financial Centre | 91 m | |
| Delta 4 | 73 m | |
| Novotel | 68 m | |
| Nowy Rynek E | 66 m | |

### 9.2 OSM coverage in the core (measured 2026-10-25)

- **Buildings** (8,344): `building:levels` 82.4%, `height` 1.3%, `roof:shape` 3.8%, `building:part` ≈ 0.
- **Car roads** (4,391):

  | tag | coverage |
  |---|---|
  | `name` | 90% |
  | `surface` | 86% (182 `sett`) |
  | `maxspeed` | 83% |
  | `lanes` | 68% |
  | `oneway` | 64% |
  | `turn:lanes` | 16% |
  | `width` | 1.3% |

- **Trams**: 476 `railway=tram` ways (1435 mm, 600 V); the committed padded-box snapshot has 341 (see audit item 1).
  **Signals** in the build: 475 nodes in the padded box, 235 snapped to junctions.
- **Signals**: 257 nodes. **Lamps**: 1,624. **Trees**: 2,521 in Stare Miasto alone.

### 9.3 Sources

- OSM / Overpass (ODbL): https://www.openstreetmap.org/copyright
- GUGiK BDOT10k: https://www.geoportal.gov.pl/pl/dane/baza-danych-obiektow-topograficznych-bdot10k/
- GUGiK NMT/NMPT: https://www.geoportal.gov.pl/pl/dane/numeryczny-model-terenu-nmt/
- GUGiK 3D buildings: https://www.geoportal.gov.pl/en/data/other-data/3d-models-of-building/
- ZTM Poznań open data (GTFS, GTFS-RT): https://www.ztm.poznan.pl/otwarte-dane/
- Poznań open data: https://www.poznan.pl/opendata; GEOPOZ: https://sipgeoportal.geopoz.poznan.pl/ (no documented open
  endpoints found)
- pl.wikipedia: Tramwaje w Poznaniu; Lista najwyższych budynków w Poznaniu; Ratusz w Poznaniu; Stary Rynek w Poznaniu;
  Most … w Poznaniu; Jezioro Maltańskie; Poznański Rower Miejski

### 9.4 Open questions

- Exact heights of the Ratusz tower, Fara, Zamek Królewski, Teatr Wielki (→ nDSM).
- Whether GUGiK LOD2 covers Poznań.
- Exact MPK tram and bus livery colours; Poznań taxi marking rules (→ street imagery /
  city regulations).
- Whether GEOPOZ offers machine-readable open data.
- Why the Ostrów Tumski / Śródka tram line is missing from `poz_rail.json` (audit item 1).
