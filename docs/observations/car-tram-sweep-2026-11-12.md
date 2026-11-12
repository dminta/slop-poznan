# Car–tram section sweeps (2026-11-12)

Base `5199713`, branch `cx-car-tram-sweep`. Measurements use the benchmark world, all seven districts,
five simulated minutes at 15 fps, 20 s warmup, seeds 1, 4242, 7, 99, 2, 3, 5, 11. The earlier 36-pair
measurement is not this checkout's baseline. Pooled IDs, the rigid articulated-bus audit rectangle and omitted
rendered-world colliders retain the limitations in [testing](../testing.md#cartram-body-overlap-audit).

## Method and geometry

`tools/audit-tram-stop-sweeps.mjs` builds the real furnished benchmark network and tram graph. It takes every
unique section length directly from `TRAM_MODELS` and calls the production `poseSections` on chords between
track stations. Articulation gaps determine when a section reaches a station, but do not change its swept set.
The union therefore samples each distinct section length independently; it does not substitute a rigid full tram.
Short graph pieces are continued recursively through permitted, routed switch branches, rather than extrapolated
along their terminal tangent. Route-unassigned branches are excluded. Curvature is detected from the endpoint
tangents, the chord midpoint and intervening polyline vertices; straight shared track is excluded from this
*turning* sweep diagnosis.

The city-wide list below uses 0.25 m station steps and a 0.10 m margin around the section rectangles. It tests a
5.6 × 2.02 m standing van rectangle, nose at the edge end, with the actual lane profile, against the sampled union
using four separating axes. Intrusion is the greatest minimum separating-axis penetration over intersecting
sections, not a proposed longitudinal retreat. Retreat is searched in 0.25 m steps along the existing lane.
Six metres of retained edge storage is required (one van plus clearance). The hypothetical required retreat is
also listed where it would leave the edge: it is a diagnostic extrapolation, not permission to extend a lane into
the previous junction. Shape nodes have no junction stop line and are excluded.

At 0.5 m and 0.25 m sampling, the list has 176 lane ends in both cases; 38 and 37 respectively can retreat clear
while retaining six metres. The finer run builds 699,808 section rectangles in 0.56–0.65 s and queries in 1.93–5.21 s
(world build 6.78–7.71 s under concurrent audits). These structures exist only in the offline tool and are not retained
by the app. This is a sampled planning envelope, not an analytic guarantee between samples, nor an audit of all
possible queue positions on connectors. The widest fire vehicle and buses need their own body checks.

### Named stop lines

- Jeżyce 4660: 10 m edge, 2.36 m intrusion; retreat needs 24.75 m along the extrapolated lane. Reverse 4661
  needs 10.25 m. There is no stop-line-only solution on either current edge that stores one car. Moving the
  line four metres merely leaves a waiting car in the envelope; it does not fix the contact.
- Kaponiera 6522: 9.41 m, three lanes. Lane 0 clears at 2.25 m retreat (7.16 m storage); lanes 1 and 2 need
  6.25 and 9.50 m. The existing setback is per edge, so clearing all three removes its one-car storage. The
  other recorded Kaponiera contacts were on connectors, where moving an edge end alone is not proof of clearance.
- Stare Miasto 8503/8504: retreat needs 33.25 / 12.75 m on 10 m edges. Both instead have lateral room:
  the same-direction track centres at the midpoints are +1.00 / +1.84 m in their own road frames, and the
  lane-centre curb allowance is +5.80 m. These are candidates for an outward offset, without touching the tracks.

No feeder cap, connector stop, proxy clipping, gate standoff or `tramStandsAt` exemption change is part of this work.

## Measurements

The current baseline is **37 pairs** (19 moving, 18 stopped, none slow). Repeating the complete seed-1 Jeżyce
row with the same commands gives byte-identical overlap output and identical benchmark fields: measured simulation
noise is zero. Timings are wall-clock measurements under concurrent work, not noise in the seeded trajectories.
The baseline full suite passes **583/583**.
Baseline per-seed wall times are 112–183 s for the overlap audit and 113–163 s for the benchmark. The isolated
candidate uses four concurrent seed jobs: 167–224 s per overlap run and 128–131 s per benchmark. Each command
uses all seven districts, so the first-world building-collider RNG consumption matches on both sides.

| District | Pairs | Moving / stopped | Mean km/h | Stopped % | Worst wait / hold s | Held >120 s | Deadlocks |
|---|---:|---:|---:|---:|---:|---:|---:|
| jezyce | 23 | 6 / 17 | 14.812 | 32.275 | 85 / 85 | 0 | 0 |
| lazarz | 0 | 0 / 0 | 14.600 | 25.438 | 39 / 39 | 0 | 0 |
| centrum | 1 | 0 / 1 | 14.725 | 32.288 | 72 / 72 | 0 | 0 |
| kaponiera | 8 | 8 / 0 | 13.062 | 48.837 | 175 / 175 | 1 | 0 |
| stare | 5 | 5 / 0 | 17.975 | 7.225 | 37 / 36 | 0 | 0 |
| rataje | 0 | 0 / 0 | 16.988 | 35.100 | 95 / 95 | 0 | 0 |
| wilda | 0 | 0 / 0 | 15.938 | 35.025 | 63 / 63 | 0 | 0 |

Means and stopped shares are unweighted averages of the eight district rows; waits and holds are maxima, held
counts and deadlocks are sums. The exact raw rows are retained in `.agent-task/measurements/base-*`.
All eight Kaponiera contacts now start with the car moving; the earlier stopped-car Kaponiera traces did not recur.
Six lie near the two documented short-link feeder knots; seed 99 also has 74:3 at `−1119,133` and 204:21 at `−1509,238`.
This pass does not modify the feeder rule or claim to solve it by a stop-line retreat.

### Stare Miasto offset candidate

Only the two named stubs are changed in an isolated source variant: eastbound lane +1.80 → +3.70 m, westbound
+1.80 → +4.60 m. Both retain their original 10 m stop-line span, offsets stay within the +5.80 m curb allowance,
and both pass the existing `laneOpen` check. A 0.25 m sweep with 0.15 m section margin finds an empty lateral
band at fully stored van centres 2.8–7.2 m along each stub (first clear tenth-metre offsets +3.60 / +4.50 m;
the candidate adds 0.10 m). The real model section lengths, rather than just the centreline clearance, determine
that band.

Preflight comparison on the seeded benchmark network: **13,187 edges before and after**, identical movement
mappings, no new straight connector above 15°. Paint snapshots receive the changed lane arrays before they are
created. No stop line or zebra reservation moves. The opposing audit remains **40 / 38 / 293 m**, with
15 / 13 / 205 m skipped; `--all` is 55 / 51 / 498 m. No wider shared-stub or Rynek Jeżycki correction is attempted.

Three alternating headless builds (road-network / traffic ms): baseline 1649/419, 1495/377, 1644/427;
candidate 1576/384, 1588/404, 1617/392. Means are 1596/408 versus 1594/393 ms, within the observed timing spread.
The offline sweep tool is not part of either app build.

**Rejected: no production geometry change is retained.** The eight-seed total is **37 → 37**, still
19 moving / 18 stopped. Jeżyce 23, Kaponiera 8 and Centrum 1 are bit-identical; Stare stays at 5 moving pairs.
The named `−318,−184` contacts disappear on seeds 1, 99 and 2, but contacts appear elsewhere on seeds 1, 3 and 11.
The changes therefore fail the required reduction even before the flow comparison.

| Seed | Jeżyce before → candidate | Centrum | Kaponiera | Stare Miasto | Total |
|---:|---:|---:|---:|---:|---:|
| 1 | 4 → 4 | 1 → 1 | 0 → 0 | 2 → 2 | 7 → 7 |
| 4242 | 4 → 4 | 0 → 0 | 0 → 0 | 1 → 1 | 5 → 5 |
| 7 | 1 → 1 | 0 → 0 | 0 → 0 | 0 → 0 | 1 → 1 |
| 99 | 1 → 1 | 0 → 0 | 3 → 3 | 1 → 0 | 5 → 4 |
| 2 | 4 → 4 | 0 → 0 | 0 → 0 | 1 → 0 | 5 → 4 |
| 3 | 3 → 3 | 0 → 0 | 1 → 1 | 0 → 1 | 4 → 5 |
| 5 | 3 → 3 | 0 → 0 | 1 → 1 | 0 → 0 | 4 → 4 |
| 11 | 3 → 3 | 0 → 0 | 3 → 3 | 0 → 1 | 6 → 7 |

| District | Mean km/h before → candidate | Stopped % | Worst wait / hold s | Held >120 s | Deadlocks |
|---|---:|---:|---:|---:|---:|
| jezyce | 14.812 → 14.812 | 32.275 → 32.275 | 85/85 → 85/85 | 0 → 0 | 0 → 0 |
| lazarz | 14.600 → 14.600 | 25.438 → 25.438 | 39/39 → 39/39 | 0 → 0 | 0 → 0 |
| centrum | 14.725 → 14.725 | 32.288 → 32.288 | 72/72 → 72/72 | 0 → 0 | 0 → 0 |
| kaponiera | 13.062 → 13.062 | 48.837 → 48.837 | 175/175 → 175/175 | 1 → 1 | 0 → 0 |
| stare | 17.975 → 18.038 | 7.225 → 7.037 | 37/36 → 37/36 | 0 → 0 | 0 → 0 |
| rataje | 16.988 → 16.988 | 35.100 → 35.100 | 95/95 → 95/95 | 0 → 0 | 0 → 0 |
| wilda | 15.938 → 15.938 | 35.025 → 35.025 | 63/63 → 63/63 | 0 → 0 | 0 → 0 |

Every benchmark field outside Stare Miasto is identical on every seed. Per-seed Stare rows expose the regressions
that an improved average could hide:

| Seed | Mean km/h before → candidate | Stopped % | Maximum wait s | Longest hold s | Off-stop trams held >60 s |
|---:|---:|---:|---:|---:|---:|
| 1 | 17.7 → 18.7 | 8.4 → 4.9 | 28 → 17 | 27 → 16 | 2 → 1 |
| 4242 | 17.3 → 18 | 9.4 → 6.9 | 29 → 25 | 28 → 25 | 1 → 2 |
| 7 | 18.2 → 17.9 | 6.7 → 7.4 | 37 → 37 | 36 → 36 | 1 → 3 |
| 99 | 17.4 → 17.6 | 8.2 → 8 | 20 → 21 | 20 → 21 | 3 → 1 |
| 2 | 18.4 → 17.3 | 6.5 → 10.2 | 28 → 30 | 27 → 30 | 4 → 4 |
| 3 | 18.5 → 18.6 | 5.6 → 5.2 | 20 → 19 | 19 → 19 | 2 → 2 |
| 5 | 18 → 18 | 6.4 → 6.7 | 31 → 31 | 31 → 31 | 2 → 1 |
| 11 | 18.3 → 18.2 | 6.6 → 7 | 26 → 21 | 36 → 20 | 2 → 2 |

Seed 7's 18.2 → 17.9 km/h, 6.7 → 7.4% stopped and one → three off-stop tram holds over 60 s already fail the
no-regression criterion against zero measured repeat noise; seed 2 also loses 1.1 km/h and adds 3.7 percentage
points stopped. No car held over 120 s or deadlock is added, but that
is not sufficient to keep the candidate. The candidate only existed in `.agent-task/variant-world.mjs`; production
`js/road-network.js` was never changed. The raw eight-seed overlap and flow rows are retained under
`.agent-task/measurements/stare-*`.

## Rejected geometry and remaining scope

- **Whole-edge retreats at the named Jeżyce and Kaponiera lines:** rejected by storage feasibility before a live
  variant. Clearing only Kaponiera's lane 0 would leave lanes 1/2 unsafe; clearing all three cannot store a car.
  No queue/gate rule was re-tried to compensate.
- **Stare Miasto outward offsets:** geometrically clear the named stubs, preserve topology and boot cost, but
  leave the overall contact count unchanged and regress seed-7 flow. Not retained. No wider stub pass was run.
- **Other potentially feasible retreats:** the 37 rows in the list are geometric candidates, not measured fixes.
  No broad city-wide retreat variant was run. This pass does not prove arbitrary connector/proxy queue positions
  clear, and does not meet the requested 8–10-pair reduction. Changing an edge end is not a demonstrated fix for a
  car already waiting within its connector or for a longer bus body.

A seed-1 Jeżyce replay with edge/standing-position instrumentation reproduces all four baseline contacts exactly:
210:21 on edge 4660 is 0.43 m short of its line; 6:16 on 8947 is 0.60 m short; 200:16 on 6237 is 0.54 m short.
The latter two contacts require separate queue/body geometry diagnosis: the non-shape standing-van list does not
establish their clearance. These are not measurements of a successful stop-line change.

## Verification and browser limits

- Final `node --test tests/`: **589/589**, including six new sweep/search tests. The geodata rebuild remains byte
  identical. Existing traffic regression bounds, source-slice markers and preload counts are unchanged.
- `git diff --check` passes. No app source, geodata, three.js SHA, track/route/stop, audio field or graph topology
  change is retained; the new geometry/index is offline only, so there is no app boot or retained-heap addition.
- Headless Chrome 157.0.8103.79, WebGPU/Metal, low tier, 1280 × 900, served on port 8157. Baseline boot is 10.5 s;
  `[init]` has streetDetails 1407 ms, traffic 1514 ms, trams 134 ms. Page console has no app exception or error.
  Screenshots: `.agent-task/measurements/browser-jezyce.png`, `browser-kaponiera.png`, `browser-stare.png`.
  They show the current geometry; the Jeżyce view is partly occluded by the corner building. The camera was patched
  only inside that browser session; the player was moved above the scene to avoid holding the trams.
- No successful "tram turns past a waiting car without touching" scenario is claimed. No moved stop-line paint or
  signal-head facing check exists because no stop line moved. The rejected offsets were not rendered in a browser;
  there is no visual approval of that candidate. The server and isolated browser were stopped.

## City-wide intruding lane ends

The table is the complete finer-sampled baseline list. `—` in storage means the required retreat cannot leave
six metres on that edge. Edge IDs refer to the benchmark network, not the full rendered network.

| Edge:lane | Standing centre x,z (m) | Intrusion (m) | Required retreat (m) | Storage after safe retreat (m) |
|---|---|---:|---:|---:|
| 135:0 | -3246.95, 1730.06 | 3.77 | 5.50 | — |
| 135:1 | -3243.56, 1731.28 | 3.18 | 8.00 | — |
| 280:0 | -1496.11, 242.84 | 2.82 | 7.00 | — |
| 295:0 | -1409.12, -201.99 | 0.73 | 26.25 | — |
| 353:1 | 284.68, -234.53 | 0.04 | 12.50 | — |
| 356:0 | -1037.75, -814.76 | 2.65 | 11.25 | — |
| 357:0 | -1033.80, -813.28 | 3.18 | 8.50 | — |
| 479:0 | -850.52, 32.48 | 1.58 | 35.00 | — |
| 1000:0 | 1395.07, 568.81 | 1.86 | 11.25 | — |
| 1000:1 | 1394.58, 572.37 | 2.92 | 10.00 | — |
| 1939:0 | -3081.83, 680.03 | 0.54 | 17.00 | — |
| 1939:1 | -3085.31, 680.93 | 0.01 | 15.75 | — |
| 2488:0 | -1026.45, -807.87 | 1.74 | 8.25 | — |
| 2488:1 | -1023.04, -809.00 | 2.13 | 7.25 | — |
| 2489:0 | -1029.65, -800.44 | 1.44 | 14.50 | — |
| 2617:0 | 2486.09, 2709.48 | 0.40 | 13.75 | — |
| 2629:0 | 300.28, -1987.24 | 1.90 | 7.75 | 9.93 |
| 2750:0 | 300.39, -247.51 | 2.84 | 5.25 | — |
| 2750:1 | 299.36, -244.06 | 2.69 | 10.75 | — |
| 2750:2 | 298.33, -240.62 | 1.93 | 17.00 | — |
| 2818:0 | -708.82, 1469.75 | 2.18 | 10.75 | 47.22 |
| 3061:0 | 1388.68, 564.68 | 3.38 | 7.25 | — |
| 3061:1 | 1387.89, 561.17 | 3.34 | 7.25 | — |
| 3176:0 | 419.70, 540.09 | 0.19 | 17.75 | — |
| 3201:0 | 3036.49, 2203.09 | 3.29 | 8.00 | — |
| 3202:0 | 3038.21, 2208.51 | 3.69 | 9.50 | — |
| 3280:0 | -3070.32, 680.41 | 0.74 | 26.00 | — |
| 3310:0 | -1578.95, 586.71 | 1.75 | 18.50 | 13.70 |
| 3378:0 | 911.33, 1990.83 | 2.42 | 7.00 | — |
| 3379:0 | 907.30, 1987.13 | 2.06 | 10.50 | — |
| 3380:0 | 1247.64, 1020.21 | 2.77 | 16.50 | — |
| 3380:1 | 1244.31, 1018.84 | 3.26 | 12.50 | — |
| 3393:0 | -875.45, 130.25 | 2.10 | 6.00 | 65.65 |
| 3439:0 | -985.60, 151.37 | 1.73 | 6.75 | — |
| 3566:0 | -1947.44, -1892.04 | 1.78 | 26.50 | — |
| 3718:0 | -1328.09, 2615.07 | 3.71 | 35.00 | — |
| 3719:0 | -1333.36, 2617.19 | 3.74 | 19.25 | — |
| 3720:0 | -2702.17, 2056.11 | 3.65 | 7.25 | — |
| 3720:1 | -2699.01, 2057.83 | 3.69 | 7.25 | — |
| 3721:0 | -2718.67, 2053.31 | 1.71 | 10.50 | — |
| 3721:1 | -2722.01, 2051.98 | 1.25 | 11.00 | — |
| 3727:0 | -2796.35, 2001.46 | 2.79 | 4.75 | — |
| 3728:0 | -2801.75, 2003.24 | 0.70 | 8.00 | — |
| 3791:0 | -1117.38, 2717.84 | 1.51 | 11.25 | — |
| 3792:0 | -1120.92, 2722.01 | 2.33 | 6.75 | — |
| 3806:0 | 353.76, -1976.52 | 0.81 | 8.75 | — |
| 3807:0 | 358.26, -1969.36 | 2.93 | 10.75 | — |
| 3979:0 | -1727.84, -1407.94 | 3.47 | 3.75 | 6.25 |
| 4103:0 | -1272.40, -563.82 | 1.08 | 11.25 | — |
| 4103:1 | -1274.43, -566.80 | 1.65 | 13.00 | — |
| 4130:0 | -1095.71, 2202.29 | 1.75 | 18.75 | 47.52 |
| 4141:0 | 2479.89, 2705.79 | 3.31 | 5.50 | — |
| 4215:0 | -2836.40, 584.93 | 2.88 | 7.75 | — |
| 4240:0 | -862.96, 980.19 | 1.37 | 2.75 | 75.72 |
| 4301:0 | 89.30, 1028.45 | 3.24 | 18.25 | — |
| 4345:0 | -2309.82, 346.16 | 0.07 | 0.75 | 9.25 |
| 4351:0 | -1963.15, 1001.00 | 0.24 | 15.75 | — |
| 4405:0 | -234.93, -1946.44 | 1.89 | 50.00 | — |
| 4415:0 | -173.71, -1973.70 | 1.62 | 15.75 | — |
| 4532:0 | -2429.33, 2215.64 | 1.35 | 5.50 | — |
| 4532:1 | -2432.63, 2214.19 | 2.69 | 5.75 | — |
| 4562:0 | 886.59, -2165.58 | 4.17 | 8.50 | — |
| 4609:0 | -30.17, 574.41 | 0.47 | 26.50 | — |
| 4658:0 | -1852.52, -389.41 | 2.06 | 16.50 | — |
| 4660:0 | -2050.04, -456.12 | 2.36 | 24.75 | — |
| 4661:0 | -2052.98, -460.99 | 1.60 | 10.25 | — |
| 4810:0 | 1985.63, -38.07 | 2.04 | 8.75 | — |
| 4810:1 | 1985.84, -34.48 | 1.47 | 10.50 | — |
| 4844:0 | 3170.06, -82.12 | 3.62 | 8.50 | — |
| 4845:0 | 3170.70, -87.77 | 2.00 | 11.75 | — |
| 5035:0 | -35.00, 502.50 | 2.44 | 32.00 | — |
| 5045:0 | -3089.92, -114.81 | 3.81 | 7.00 | — |
| 5046:0 | -3093.50, -118.95 | 2.64 | 8.75 | — |
| 5188:0 | -2091.25, -1660.06 | 2.07 | 10.25 | 46.95 |
| 5205:0 | -502.08, -1786.88 | 2.00 | 34.25 | — |
| 5208:0 | 277.09, -1985.70 | 1.59 | 18.00 | — |
| 5213:0 | 3038.29, 2191.05 | 1.95 | 22.00 | 46.17 |
| 5350:0 | 3922.63, -135.95 | 4.24 | 4.50 | — |
| 5390:0 | -822.24, -3.14 | 1.50 | 14.25 | — |
| 5395:0 | -281.78, -172.27 | 2.21 | 8.50 | 16.11 |
| 5396:0 | -253.90, -158.22 | 1.75 | 9.25 | — |
| 5439:0 | 936.40, 1906.72 | 3.60 | 8.00 | — |
| 5440:0 | 939.10, 1911.08 | 0.46 | 8.25 | — |
| 5732:0 | -3477.00, 867.65 | 2.49 | 7.25 | — |
| 5733:0 | -3479.19, 870.66 | 2.16 | 6.25 | — |
| 5939:0 | -972.57, -70.91 | 2.23 | 7.75 | — |
| 5986:0 | -869.94, 1700.70 | 1.33 | 18.25 | — |
| 6196:0 | -1267.77, -550.33 | 2.46 | 10.50 | — |
| 6197:0 | -1270.44, -555.35 | 4.12 | 10.50 | — |
| 6232:0 | -2039.96, -436.04 | 2.07 | 24.25 | — |
| 6233:0 | -2907.19, -744.86 | 1.66 | 23.25 | — |
| 6273:1 | -3253.71, 1714.71 | 1.21 | 14.00 | — |
| 6287:0 | -1396.92, -204.07 | 0.54 | 0.75 | 9.25 |
| 6310:0 | -2294.97, 331.29 | 3.78 | 6.00 | — |
| 6311:0 | -2286.71, 325.10 | 1.91 | 18.75 | — |
| 6362:0 | -3158.33, 2683.23 | 2.15 | 14.75 | — |
| 6368:0 | -1574.16, 548.42 | 1.89 | 3.75 | 6.25 |
| 6428:0 | 79.97, 869.61 | 2.57 | 4.50 | — |
| 6435:0 | -1460.20, 114.44 | 1.33 | 14.25 | — |
| 6455:0 | -759.06, -1230.87 | 3.65 | 6.25 | — |
| 6455:1 | -755.55, -1231.67 | 1.72 | 2.50 | 7.50 |
| 6477:0 | -950.05, -64.62 | 2.32 | 22.75 | — |
| 6522:0 | -1124.89, 139.56 | 1.39 | 2.25 | 7.16 |
| 6522:1 | -1125.29, 143.13 | 3.97 | 6.25 | — |
| 6522:2 | -1125.68, 146.71 | 1.52 | 9.50 | — |
| 6595:0 | -655.02, 1362.55 | 0.84 | 5.25 | — |
| 6597:0 | 2657.10, 2578.16 | 3.88 | 8.25 | — |
| 6603:0 | 2657.39, 2586.97 | 0.10 | 0.25 | 8.25 |
| 6678:0 | -2427.11, -590.66 | 0.80 | 5.25 | — |
| 6697:0 | -1341.28, 2402.31 | 1.39 | 16.00 | — |
| 6727:0 | 1985.70, -30.36 | 2.02 | 3.25 | 14.32 |
| 6751:0 | -2896.85, -734.01 | 3.05 | 14.50 | — |
| 6751:1 | -2893.44, -732.88 | 0.18 | 0.50 | 9.50 |
| 6770:0 | -1267.91, -535.95 | 3.01 | 7.00 | — |
| 6770:1 | -1265.62, -533.17 | 2.90 | 9.75 | — |
| 6893:0 | -1843.09, 885.25 | 2.41 | 19.25 | — |
| 6910:0 | -1535.68, -275.06 | 1.80 | 7.75 | 9.93 |
| 6961:0 | -1176.87, 653.07 | 2.07 | 8.50 | — |
| 6961:1 | -1177.39, 649.51 | 3.99 | 5.75 | — |
| 6980:0 | -1169.57, 659.98 | 3.61 | 4.00 | 6.00 |
| 6984:0 | -1557.11, 556.92 | 3.97 | 5.75 | — |
| 6984:1 | -1557.47, 553.33 | 1.86 | 2.50 | 7.50 |
| 7092:0 | -2152.12, -133.80 | 2.10 | 4.75 | 21.75 |
| 7118:0 | -601.24, 1195.60 | 2.46 | 15.25 | — |
| 7125:0 | -459.01, 974.33 | 1.84 | 6.25 | 13.69 |
| 7126:0 | -469.06, 985.17 | 1.80 | 4.25 | 15.69 |
| 7151:0 | 280.15, -236.53 | 2.52 | 11.00 | — |
| 7176:0 | -2025.61, 229.98 | 0.84 | 5.75 | 7.52 |
| 7358:0 | -1475.80, -253.88 | 0.01 | 0.25 | 9.75 |
| 7618:0 | -2063.40, -381.73 | 1.72 | 15.25 | 22.96 |
| 7633:0 | -1353.68, -210.44 | 2.21 | 35.50 | — |
| 7650:0 | -1515.05, 234.13 | 4.07 | 6.25 | — |
| 7650:1 | -1514.62, 237.70 | 1.77 | 2.50 | 7.50 |
| 7653:0 | -1939.28, -419.61 | 1.71 | 1.75 | 12.92 |
| 7824:0 | -1224.04, 2425.26 | 2.06 | 21.50 | — |
| 7830:0 | -2345.39, -566.24 | 2.11 | 6.75 | 9.24 |
| 7841:0 | -2468.36, -613.99 | 1.90 | 4.25 | — |
| 8042:0 | -998.94, 2038.56 | 1.66 | 28.50 | — |
| 8078:0 | -1184.17, 641.68 | 2.10 | 9.75 | — |
| 8078:1 | -1182.81, 638.35 | 3.30 | 5.00 | — |
| 8101:0 | -604.74, 238.02 | 2.32 | 11.50 | — |
| 8131:0 | -2157.33, -107.64 | 1.87 | 36.25 | — |
| 8132:0 | -2162.26, -104.80 | 2.20 | 35.50 | — |
| 8173:0 | -997.58, 145.18 | 2.33 | 10.25 | — |
| 8213:0 | -2076.59, 2410.17 | 4.08 | 8.25 | — |
| 8254:0 | 3037.86, 2221.61 | 1.73 | 14.00 | 63.99 |
| 8254:1 | 3040.94, 2223.48 | 2.43 | 5.25 | 72.74 |
| 8408:0 | -1504.34, 246.19 | 1.94 | 10.25 | — |
| 8408:1 | -1507.76, 245.08 | 3.33 | 13.50 | — |
| 8503:0 | -318.37, -181.19 | 1.72 | 33.25 | — |
| 8504:0 | -321.60, -185.87 | 2.42 | 12.75 | — |
| 8549:0 | -865.65, 1053.42 | 1.57 | 17.75 | 60.72 |
| 8606:0 | -609.22, -144.29 | 2.01 | 5.50 | 8.06 |
| 8708:0 | -2324.19, 349.96 | 3.07 | 6.25 | — |
| 8741:0 | -1169.69, 331.11 | 2.07 | 25.25 | — |
| 8748:0 | -347.54, -183.49 | 1.46 | 19.75 | — |
| 8769:0 | 742.29, 1274.30 | 2.27 | 8.00 | — |
| 8774:0 | 373.20, -1970.88 | 2.57 | >60 | — |
| 8798:0 | 886.01, -2159.80 | 2.17 | 12.75 | — |
| 8799:0 | -962.09, 2000.58 | 2.36 | 24.25 | — |
| 8833:0 | -881.37, 1703.85 | 1.72 | 57.00 | — |
| 8834:0 | -956.28, 1797.78 | 2.45 | 25.00 | — |
| 8834:1 | -959.75, 1796.81 | 0.34 | 11.75 | — |
| 8835:0 | -951.65, 1793.51 | 3.20 | 30.25 | — |
| 8842:0 | -898.59, 1718.63 | 2.36 | 29.00 | — |
| 8910:0 | -2087.58, -1636.37 | 1.82 | 3.50 | 6.50 |
| 8944:0 | -2003.78, -444.25 | 1.35 | 5.75 | — |
| 9000:0 | -2909.28, -758.82 | 3.45 | 6.50 | — |
| 9000:1 | -2908.85, -755.24 | 4.13 | 4.50 | — |
| 9042:0 | -363.98, 202.06 | 3.14 | 8.25 | 15.72 |
| 9042:1 | -360.54, 203.11 | 3.40 | 4.50 | 19.47 |
| 9196:0 | -835.65, 39.34 | 2.01 | 33.50 | — |
| 9299:0 | 850.15, -159.75 | 0.87 | 7.50 | — |
| 9356:1 | -4857.25, 1456.47 | 0.54 | 9.25 | — |
| 9356:2 | -4860.40, 1458.22 | 3.21 | 9.75 | — |
| 10999:0 | -4208.33, 1176.57 | 3.11 | 7.25 | — |
