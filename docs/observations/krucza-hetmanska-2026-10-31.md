# Krucza signal and Hetmańska geometry — 2026-10-31

The requested scope was to restore the missing Krucza/Zamenhofa heads and inspect two remaining Hetmańska
geometry candidates. Both Krucza signal poles are restored. Hetmańska geometry is unchanged; the confirmed curb conflict
is retained in the backlog for a separate slab/track correction.

## Krucza: actual approaches and cause

The historical short approach near `675, 2738` is not an active signalised incoming approach in the furnished
full scene. Its node at `673.05, 2742.9` has one incoming and one outgoing edge, with its signal disabled.
The nearby active junction at `699.25, 2750.75` has two incoming edges. Both initially lacked a matching vehicle head.

The live park/plaza exports reveal a park bounds entry spanning x `176…881.5`, z `1184…2844`.
`street-details.js` treated the entire rectangle as park/plaza, including sidewalks outside the irregular island.
The restored Krucza approaches now check the actual polygon, with the same 0.5 m exclusion margin.
This exception is limited to the surveyed inbound arms at signal site `700.6, 2745.7` (western `ux < −0.9` and
eastern `ux > 0.9`). On the eastern approach, the pole search starts at `dt >= 6.0 m` along the curb instead of
the default `4.8 m`, avoiding the swept path of the right-hand turn into Zamenhofa.
All other pole checks remain active. No rail-clearance relaxation or traffic-lane shift is used.

| Measurement | Baseline | Western only | West + East |
|---|---:|---:|---:|
| Vehicle heads | 743 | 744 | 745 |
| Pedestrian heads / poles | 1,304 | 1,305 | 1,306 |
| Head on the live western Krucza approach | 0 | 1 | 1 |
| Head on the live eastern Krucza approach | 0 | 0 | 1 |

The western pole is at `680.560312, 2754.986397`; its vehicle lens is at `680.388048, 3.55, 2754.934196`, facing
`−0.957024, −0.290007`, shared plan 132, group 1. The pole is 3.080813 m from the nearest track centreline
and 4.006230 m outside the roadway.
The eastern pole is at `714.353653, 2740.959030`; its vehicle lens is at `714.533396, 3.55, 2740.949421`, facing
`0.998574, −0.053383`, shared plan 132, group 1. It is >20 m from the nearest track and 4.51 m clear of roadway
and turning curves. The ordinary pole footprints, player colliders, pedestrian displays and audio registrations
are retained.

`tests/signal-placement.test.cjs` builds the real grid and street furniture with the grid's populated exports.
Removing the park-ring export reproduces the old input and fails the incoming-head assertions.
The final regression checks both lens facings/groups, rail/road clearances and exact equality of all drivable lane
geometry, pedestrian crossing endpoints and non-signal furniture against that baseline. It adds exactly two poles.

## Full-scene recount

Edge loaded the current CDN modules through temporary local servers. All production builders ran, including
buildings, landmarks and bridges. The baseline served the pre-change `city-grid.js` and `street-details.js`;
the final variant used the working tree. Instrumentation ran before static culling and read actual lens
instance matrices and their `signalIndex` attributes.

An incoming edge matches a head when its plan index agrees, outward direction dot product is over 0.98,
and the head is within 45 m of its node. Disabled/non-signal nodes are excluded. This is a conservative candidate
audit: unmatched edges can reflect aliasing, placement distance or other modelling choices. They are not a
verified count of absent heads, and one physical head may serve several edges.

| Variant | Heads | Incoming edges audited | Unmatched candidates | Network edges | Lane entries |
|---|---:|---:|---:|---:|---:|
| Baseline, WebGPU | 743 | 742 | 272 | 8,715 | 11,577 |
| Final, WebGL2 | 744 | 742 | 271 | 8,715 | 11,577 |

Final WebGPU also measured 745 heads, 742 incoming edges and 270 unmatched candidates. The eastern Krucza
incoming direction `0.998574, −0.053383` now matches head 745.

Using exact park outlines for all signal arms without per-arm clearance checks was rejected after differential
measurements showed arbitrary pole placements encroaching on turn sweeps. The broader park-bounds problem,
including existing park traffic footprints, remains open.

## Browser observations

Final full Edge WebGPU and forced WebGL2 scenes each rendered at least 60 loop frames. Backend identity came
from the initialized renderer, not the static WebGPU HUD label. Final runs captured no console warnings/errors,
uncaught errors or unhandled rejections. A temporary diagnostic import error occurred during harness setup and
was corrected before these final runs. GL errors were not separately instrumented in this check.

At Midday, the restored vehicle lens was visible from eye `655, 1.6, 2747` looking at
`680.388, 3.55, 2754.934` on both backends. WebGPU spot checks showed green and red, with corresponding group-1
states captured from plan 132. WebGL2 was spot-checked on red. The nearby tree was visible beside the line of
sight from this eye; other positions and moving-vehicle occlusion were not exhaustively checked. These are
appearance and wiring spot checks, not a continuous traffic-compliance trace or an audio listening test.
All camera controls, telemetry and renderer forcing lived in temporary server files; production has no debug globals.

## Hetmańska: three-lane candidate

The examined straight three-lane roadways near `−2299, 2276` are 9.8 m wide. The road graph tuple includes
another 6.5 m for the tram strip (16.3 m total); it is not all carriageway. Lane centres relative to the
carriageway centre are `−3.6, 0, +3.6` m. The outer lane centre is therefore 1.3 m inside its 4.9 m half width,
leaving 0.1 m beyond the road-network's 1.2 m lane-clearance allowance.

The old 0.5 m report equals `3.6 + 1.8 − 4.9`: it describes the envelope of a nominal 3.6 m lane, not an actual
centreline outside the roadway. The WebGPU elevated spot check from `−2305, 20, 2302` towards `−2270, 0, 2292`
showed the marked lanes and traffic within the street corridor. No centreline correction was justified.
This does not establish full vehicle swept-path safety at every Hetmańska junction.

## Hetmańska/Dmowskiego: confirmed curb conflict

The actual conflict lies near `−2446, 2204`, roughly 10 m north of the old report point. Block 1235 is a
47.5 m² six-vertex curb polygon with no building lot rects. `city-grid.js` emits its raised slab, and
`layoutTrackBeds` in `tram-infra.js` uses `blockAt` at each rail piece midpoint to choose ground height.
Two adjacent pieces of rail 570 start at arc lengths 263.735 and 267.731 m and take `ground = 0.22` rather
than zero. Together they span 7.992 m: rail tops jump from 0.016 to 0.236 m and back.

WebGPU spot checks from `−2465, 14, 2220` and `−2463, 1.3, 2195` towards `−2446, 0.2, 2204` showed the
small raised island across the rail corridor. The fix must address the slab/curb geometry as well as rail height;
lowering the rails alone would bury them. No slab, rail or geodata change was made in this inspection.

The headless measurement used the real `city-config.js`/`geodata.js` and vm-loaded `road-network.js` and
`tram-infra.js`, calling `buildRoadNetwork([], [])` then `layoutTramInfrastructure(network)`. Filtering beds
within 20 m of `−2448, 2214` for `ground > 0` returns the two pieces above. This bare-network variant omits
furniture and colliders; the rendered spot checks independently confirm the local visual conflict.

## Validation

- `node --test tests/signal-placement.test.cjs`: 2/2.
- `node --test tests/`: 292/292, 39.89 s, including the unchanged traffic-flow regressions.
- Independent subagent review found no blocking correctness or scope issues in the final patch.
