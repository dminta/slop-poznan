# Tram-shelter clearance — final review, 2026-11-17

The work is rebased onto `poznan feff6af` (outskirts tracks and the Warta crossing deck retained), uncommitted.
The comparison baseline throughout this record is `33ee2ba`. This replaces the stale round-1 measurements.

## Clearance standard and result

`node tools/audit-shelter-clearance.mjs --json` audits street-detail footprints, tree trunks and oriented pits,
city-grid prop colliders, tram poles, railway masts, stop signs and ticket machines against each shelter's roof
footprint plus **0.3 m** and its **1.2 m open-front strip**. It also checks trunks/pits against machines and signs.

Catenary poles alone have a fallback standard: their centres must remain outside the roof rectangle expanded by
**0.15 m** (`POLE_KEEP`). This is the historical pole rule, not a claim that every pole passes the stricter
0.3 m / 1.2 m standard. The audit now reports the strict exceptions separately in `strictPoleHits` and
`strictAffectedShelters`.

- Before, strict standard: **224 shelters, 55 affected**; footprint 27, margin 16, access 32. This includes the
  original 14 sites. With the historical pole fallback standard, the same baseline has **39 affected**; footprint
  27, margin 4, access 20. The earlier draft mixed its strict baseline count with its fallback after count.
- Final: **224 shelters, 0 affected**, footprint/margin/access all 0, **0 tree/furniture overlaps**.
- Final strict pole count: **1 shelter**, Rondo Rataje, pole at local **(2.61, 0)**. The earlier review counted
  two, including Teatr Polski, and placed the Rataje pole at local (2.71, 0). The final nearest-first search shifts
  Rataje slightly, and Teatr Polski now uses the existing short shelter model and passes the strict standard.
- `node tools/audit-shelter-roadway.mjs --json`: 232 stops, 224 shelters, 57 moved from their original fixed
  placement, 4 dropped; **0 roadway, raised-ground or roof/pole violations**. The four absent shelters are the
  pre-existing AWF, Gwarna, Rondo Śródka and Sołacz cases.

Raw reports: `/tmp/agy-shelter-clear/audit-before.json`, `audit-final.json`, `roadway-final.json`.

## Root causes and shared fix

Streetlamps and curbside props were placed before shelters without a shelter keep-out. Trees checked tram poles,
but omitted the shelters, their access strips and stop furniture. The tram layout omitted city-grid props and
mapped tree pits, and stop signs/machines could overlap a neighbouring shelter.

`layoutTramInfrastructure(network, grid)` now obtains its inputs through **`tramLayoutInputs(grid)`**: the built
grid's prop colliders, `OSM_TREES` and `TEATR_POLSKI_GARDEN_TREES`. All direct layout callers in tools/tests now
pass their built grid; the street-details injection and main fallback use the same interface. Reduced network
fixtures remain reduced fixtures, but no longer silently omit the grid prop keep-outs.

Mapped curb-row trees reserve oriented 1.7 × 2.6 m pits, scaled to 0.7 on narrow streets; promenade trees use the
promenade tangent. Back-garden trees reserve trunks. This prevents a relocated shelter from displacing a mapped
pit. Stop machines check these reservations too. Signs and machines slide clear of shelter zones.

The returned `createShelterKeepout(stops)` index combines shelter zones, machines and signs in 16 m cells.
Street-details unregisters colliding lamps/props before trees are placed, then relocates those items along their
curb edges after trees, checking the existing curb, lane, rail, landing, wall and neighbour rules. This preserves
valid trees such as the Małe Garbary tree at (210.37, −261.17).

The final search streams candidates outwards without sorting, retains the nearest pole-rule fallback during the
strict search, and avoids repeating geometry passes for that fallback. It can use the existing 3.2 m shelter
model when a wider roof cannot fit between mapped pits and furniture. Per-stop pole neighbourhoods are resolved
once. Extras are indexed only near stops. Clearance queries reuse visit stamps, avoid query arrays/Sets, and
construct query OBBs lazily. The roof sampling arithmetic is streamed rather than allocating sample arrays.

## Mapped trees and local changes

The city-wide comparison uses the existing `tools/audit-tree-clearance.mjs` full building/landmark/bridge fixture,
run with `worldOnly: true` against each source tree. The sorted identity keys are `(source, x, z)` for every
accepted `osm` and `site` tree, not a net tree-count comparison.

- **32,787 → 32,787 mapped trees: 0 lost, 0 added** (32,778 OSM and nine mapped garden trees).
- A second comparison using the shelter audit's world fixture, including canopies and bridges, independently keeps
  **34,666 → 34,666** accepted mapped trees, again **0 lost**. These fixtures have different building/collider and
  park-tree inputs; their absolute tree totals must not be mixed.
- The smaller tree-distribution fixture keeps **32,800 OSM trees**. Its regression explicitly checks both Teatr
  Polski trees at (−658, 45) and (−647.4, 45.6).
- **Teatr Polski:** the wide shelter could not fit between the mapped pits, the bench and the raised-ground edge.
  The existing short model now stands at **(−653.60, 45.20), len 3.2**, about 1 m from the previous shelter centre,
  rather than jumping 6.6 m onto the OSM tree. Its machine relocates to **(−656.04, 44.52)**. Both mapped trees stay.
- **Mogileńska:** the shelter slides along its platform; the mapped tree at (4003.9, −131.8) stays.
- The Rondo Rataje island shelter stays. The Rondo Kaponiera machine near the stop at (−1409.8, 89.0) stays and
  relocates to **(−1405.34, 89.36)**.

Full fixture output comparison:

| Output | Before | After | Difference |
| --- | ---: | ---: | --- |
| All tree sites | 118,159 | 118,161 | 18 removed positions, 20 added positions |
| Street-detail footprints | — | — | 17 removed, 17 added; 13 LEDs, 2 hydrants, 2 parking machines moved; 0 dropped |
| Tree placement diagnostics: moved | 1,908 | 1,926 | +18 |
| Tree placement diagnostics: rejected | 163 | 164 | +1 rejected candidate, not a lost mapped tree |
| Footprint changes beyond 25 m of a shelter | — | — | 0 |
| Tree changes beyond 25 m of a shelter | — | — | 0 |

Outside 25 m neighbourhoods of the **original 14 reported shelters**, there are **9 removed / 9 added street-detail
footprints** and **11 removed / 13 added tree positions**. These are additional clearance sites found by the
city-wide audit. They still all lie within 25 m of some shelter; the rest of the city is unchanged.

All 18 removed tree positions can be paired with same-source added positions within the 6 m relocation window;
there are two additional procedural positions. The raw position diff and placement counters are reported
separately because candidate rejections do not identify lost previously placed trees.

Evidence and reproducible scratch runners are under `/tmp/agy-shelter-clear/`: `full-snapshot.mjs`,
`base-full.json`, `work-full.json`, `snapshot.mjs`, `base-snapshot.json`, `work-snapshot.json`, `diff-summary.json`.
The base source is a `git archive 33ee2ba` extraction in `base/`.

## Shelter re-placements

Against `feff6af`, 56 shelter positions change, all along their platform with yaw kept and none dropped: 16 are
intrusion-driven moves (Fredry 4.5 m, Sielska and Park Wilsona 2.5 m, Uniwersytet Ekonomiczny 2.1 m including 1.45 m
sideways, Św. Czesława 2.0 m, the rest 0.15–1.5 m); the other 40 had already been moved in the base and the new
search lands them slightly differently (38 by ≤ 0.3 m, Baraniaka 5.3 m).

## Boot measurement

Four fresh-process **interleaved base/work pairs**, with no tests or browser captures running alongside them.
`buildStreetDetails` includes its furnished road-network build and the injected tram layout. The work version
includes the rebased `feff6af` changes. These are Node headless build times, not browser frame/render times.

| Pair | Base build (ms) | Work build (ms) | Base tram (ms) | Work tram (ms) |
| --- | ---: | ---: | ---: | ---: |
| 1 | 6678.4 | 6100.8 | 862.8 | 1072.1 |
| 2 | 6451.0 | 6654.8 | 887.1 | 1143.6 |
| 3 | 6720.2 | 6269.0 | 905.9 | 1122.4 |
| 4 | 5612.5 | 6484.2 | 763.2 | 1137.4 |
| Median | **6564.7** | **6376.6** | **875.0** | **1129.9** |

The table above compares against a `33ee2ba` extraction while the work tree already contains `feff6af`, so its
−188.1 ms total median is not a valid comparison (paired deltas span −577.7…+871.7 ms). The review re-measured five
interleaved pairs against `feff6af` under the same load: `buildStreetDetails` median 5,923 → 6,259 ms, median paired
difference **+207 ms** (+194, +207, +159, +264, +336), at the +200 ms limit rather than clearly under it; the tram
layout median 857 → 1,119 ms (**+262 ms**) accounts for all of it. Trimming the tram layout is a possible follow-up.
An earlier four-pair run failed the target (+913.3 ms total) and drove the search/index optimizations; it is retained
as `interleaved.json`. Final samples and snapshots are `interleaved-final.json` and `final-pair-{1..4}-{base,work}.json`.

## Why the 2026-11-14 tree audit said zero

`tools/audit-street-tree-clearance.mjs` passed a shelter object to the four-argument `shelterRect(x, z, yaw, len)`
function, then read nonexistent `cx`, `cz`, `dx`, `dz` fields instead of `x`, `z`, `ux`, `uz`, `vx`, `vz`.
The resulting NaNs made every comparison false. The audit now uses the correct signature and rectangle axes.

## Verification and screenshots

- `node --test tests/`: **678/678 pass**, 225.0 s, including geodata; no isolated rerun needed.
- `node --test tests/tree-distribution.test.cjs`: **2/2 pass**, including the added mapped-tree assertions.
- Final clearance audit and its regression: **0/224 affected**, **0 tree/furniture overlaps**, strict pole fallback **1**.
- Final roadway audit: **0** violations. `git diff --check` and JS syntax checks pass.

Headless Chrome, WebGPU high, 1280 × 720, HUD hidden, HTTP cache disabled through CDP. HTTP **8310**, CDP **9510**,
profile `/tmp/agy-shelter-clear/chrome`; no other agent's ports were used. Before is `33ee2ba`, after is the rebased
working tree, at matching camera poses. **0 console errors/warnings** across all capture runs.

All **20** images are in `/tmp/agy-shelter-clear/shots/`, each with `-before.png` and `-after.png`:
`polanka`, `malegarbary`, `serbska`, `lakowa`, `dworzec-zachodni`, `zeromskiego`, `termalna`, `teatr-polski`,
`rondo-rataje`, `uniwersytet-ekonomiczny`.

Teatr Polski is framed around the final shelter and garden tree. Serbska and Termalna were retaken from close
platform-side views so passing trams do not hide the trees/pits or machines. Camera poses/scripts are
`poses.json`, `poses-serbska.json`, `poses-termalna.json`, `shot.mjs`, `shot-serbska.mjs`, `shot-termalna.mjs`;
FOV is 65°, 85° and 90° respectively. Console logs are `console-round2.json`, `console-serbska.json` and
`console-termalna.json`. The screenshots remain for user approval before merge; no merge or commit was made.
