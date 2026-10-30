# Bus population verification — 2026-10-30

The cars-first vehicle pool could fill the entire local density target before a bus received a placement attempt.
The rotating cursor alone did not help once those nearby cars occupied every place. The fix reserves the fleet's
proportional bus share within the existing target; it does not enlarge the population or placement budget.

## Deterministic regression

`node --test tests/traffic-population.test.cjs` exercises the production update, refreshNear, spawnVehicle,
laneClear and park functions with seeded placement on available major roads. Before the fix, both initial filling
and teleport tests failed: 30 active cars, no buses after 120 updates. After the fix the mix is 28 cars and 2 buses.
Further cases cover unavailable/too-short major roads, recovery after a tram blocks bus placement, the normal
four-attempt budget and correction of an already-full cars-only population on a camera jump.

## Furnished-network measurement

A temporary headless harness used the actual Poznań network with city-grid sidewalks and footprints, current
plaza/park sites, street furniture, pedestrians and trams. Focus was `(-1558, 579.5)`, seed `4242`, 15 updates/s,
120 simulation seconds. The baseline loaded commit `81c164a`'s traffic.js; the fixed run loaded the working version.
Two runs produced identical results:

| Version | First update | At 120 s |
|---|---|---|
| Before | 72 cars, 0 buses | 72 cars, 0 buses |
| After | 67 cars, 5 buses | 67 cars, 5 buses |

No vehicle was manually placed. Bus pool index 5 approached the shared Dworzec crossing naturally on movement
incoming side 5 to outgoing side 3:

| Simulation time | Observation |
|---|---|
| 85 s | On the approach outside the connector at `(-1553.40, 556.55)`. |
| 90 s | Inside the connector; stopped at the 95–100 s samples. |
| 105.333 s | First sampled body overlap with the shared zebra. |
| 110.133 s | Whole body clear of the zebra; bus centre displaced 16.24 m since the first overlap. |
| 120 s | Continuing on the following road at `(-1601.61, 621.32)`. |

Overlap used SAT between the bus OBB and the actual 4 m zebra band, whose ends are `(-1579.803, 560.273)` and
`(-1559.909, 578.714)`. This checks a natural traversal rather than a bus already committed by controlled placement.
The headless scene omits rendering/frustum protection and building, landmark and bridge colliders; it does not
repeat the earlier pedestrian rear-clearance reservation audit. The temporary harness was removed.

## Browser check

Chrome, full WebGPU scene, hard reload, camera near `(-1557.94, 583.65)` at Dworzec. The initial console had eight
builder/init messages and no errors or warnings. A debugger read counted 66 active cars and 5 active buses.
The full-scene density target differs from the headless snapshot above because the builder inputs differ.

Temporary DevTools instrumentation observed naturally spawned bus index 2 on the southern approach at
`(-1576.77, 591.39)` at 12.560 s, entering the central junction connector at 15.594 s and reaching the outgoing
road at `(-1561.16, 548.45)` at 23.928 s. Another bus traversed the western refuge junction. Rendered Midday
inspection showed the bus body, wheels and destination sign near the crossings. No vehicle placement was staged.
This browser sample checks availability and natural movement; the geometric shared-zebra clearance measurement
above is headless, not a complete rendered pedestrian/traffic interaction trace. WebGL2 was not checked.
Instrumentation was removed by reloading.

## Validation

`node --test tests/` passes 286/286 (36.30 s), including six population regressions and the existing five-minute
Jeżyce/Centrum traffic-flow regression. No flow thresholds were changed.
