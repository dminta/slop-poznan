# Jeżyce 4660 unsafe storage investigation (2026-11-15)

No production change is retained. A static, geometry-selected downstream-exit admission guard reduces fresh-seed
Jeżyce contacts **41 → 20**, but fails the mandatory acceptance gates: holds over 120 s **28 → 118** and mean
per-seed maximum wait **+62.25 s**. The game and test files were restored to the baseline; no commit was made.

## Method

Base `poznan` / HEAD `9c781f4`. Measurements use the normal benchmark world, five simulated minutes at 15 fps,
20 s warmup and the default 20 fresh acceptance seeds. The baseline and working code hashes are recorded in
`.agent-task/4660/accept.json`. Four acceptance jobs run concurrently. Headless only, as requested.
Pooled IDs, omitted scene colliders and discrete section-rectangle overlap retain the limitations in
[testing](../testing.md#cartram-body-overlap-audit). These measurements do not prove continuous or rendered-scene
clearance. The three fresh baseline stub contacts below involve ordinary cars, so rigid articulated-bus rectangles
are not responsible for these witnesses.

Fresh reproduction commands:

```sh
node tools/audit-tram-overlaps.mjs --seed 61 --only jezyce
node tools/bench-traffic.mjs --seed 61 --only jezyce --trace -2050,-456
node tools/audit-tram-overlaps.mjs --seed 67 --only jezyce
node tools/bench-traffic.mjs --seed 67 --only jezyce --trace -2023,-448
```

The first trace coordinate selects the upstream node; the second selects the downstream node. A copied audit adds
edge/station, planned exit, overlapping section rectangles and once-per-second vehicle/tram state without changing
update order or consuming random values. Its baseline results reproduce both ordinary audits: seed 61 has 2 pairs /
131 pair-frames; seed 67 has 2 pairs / 310 pair-frames. Raw commands, traces, probes and the rejected source patch
are under `.agent-task/4660/` (ignored local artifacts).

## Geometry: braking room is not safe storage

The graph nodes bounding 4660 are `(-2068.875, -469.875)` and `(-2022.6, -448.2)`, both unsignalised. Its road
centreline run is only 10 m, from `(-2056.2184, -460.2290)` to `(-2046.7950, -456.8823)`, with lane offset 1.8 m.
The connector from incoming edge 2595 is **25.9732 m** long. The outgoing moves are right to 6231 (13.7300 m)
and straight to 7652 (10 m). Admission and arrival therefore occur several seconds apart even before a queue forms.

Opposing tram mapping `te 748` spans lane stations **9.957 → 0.957 m**, and `te 764` spans **9.140 → 3.345 m**.
The observed standing centres, at stations 6.59–7.72 m, are inside these runs. A normal stop just before the far
line is already unsafe; moving the stop point a small distance upstream does not establish body clearance.

Re-running the real section sweep at 0.25 m stations with a 0.10 m margin gives the same 699,808 sampled section
rectangles and named retreat bounds as the earlier sweep record:

| Edge | Run length m | Standing van centre x,z m | Intrusion m | Required retreat m | Retreat retaining 6 m storage |
|---|---:|---|---:|---:|---|
| 4660 | 10 | -2050.036, -456.123 | 2.364 | 24.75 | none |
| 4661 (reverse) | 10 | -2052.977, -460.988 | 1.604 | 10.25 | none |

The van is 5.6 × 2.02 m, with its nose at the lane end. The most intrusive sampled section on 4660 has physical
length 11.8 m, on chain 1150; the margin-expanded rectangle is centred at `(-2048.114, -455.633)`, heading
-2.2695 rad, half-length 6 m and half-width 1.3 m. This is actual section-chord geometry, not a full-tram rectangle
or a centreline-only guess. The envelope remains a sampled planning diagnostic, not a continuous proof.

## Fresh-seed mechanism

| Seed | Pair | First contact s | Edge / station m | Car / tram speed m/s | Car wait |
|---:|---|---:|---|---|---|
| 61 | 1:21 | 150.9 | 4660 / 7.580 | 0 / 3.1 | tram |
| 67 | 12:21 | 96.5 | 4660 / 7.722 | 0 / 1.5 | tram |
| 67 | 26:1 | 275.5 | 4660 / 6.594 | 0 / 2.4 | car (tram proxy 1) |

**Seed 61, car 1:** at 134 s it is still on `8081 → 2595`, while tram 21 stands for car 17 with its front at
`(-2044.79, -424.32)`. At 136–138 s it crosses `2595 → 4660` at connector stations 4.45, 14.45 and 25.61 m.
At 139 s it reaches 4660 and brakes for the downstream box. At 140–141 s it is stationary at s=7.58 for `box`,
at 142 s for `crossing`, and from 143 s for `tram`. The tram resumes, reaches the car at 150.9 s, and turns
through its stationary body. The car was stored before contact; it did not run a last-moment tram entry gate.

**Seed 67, car 12:** at 82 s it follows bus 203 on 2595 while tram 21 is slow and held for car 48.
It traverses the connector at 83–85 s, reaches 4660 at 86 s (`box`), stops at 87 s (`crossing`), and waits for
`tram` from 88 s. At 96.5 s section 0 overlaps it. That actual section rectangle has centre
`(-2043.656, -450.312)`, heading -2.5975 rad, half-length 5.9 m and half-width 1.2 m.

**Seed 67, car 26:** this encounter also shows why downstream queue capacity is not the entire problem. After
waiting for pedestrians upstream, it enters the connector at 254 s. At 258–265 s the tram-1 proxy stops it inside
the connector (cs=23.54 m). It resumes at 266 s, reaches 4660 at 267 s, then yields to the tram and stops at
s=6.594 by 270 s. At 273 s the tram resumes from its `room` hold; the car follows its proxy and section 0 overlaps
at 275.5 s. A proxy/give-way stop can itself place a vehicle in the unsafe standing band.

The binding cause is unsafe intermediate storage plus changing downstream/tram occupancy. In the first two
witnesses the junction box and crossing traffic stop the car before the tram reservation binds. Neither node has
a local red-light phase. The tram's oncoming-body exemption allows it to sweep over these opposing-lane cars;
its current obstacle is another vehicle, not the stored car. `tramStandsAt`'s exemption for a tram waiting for the
same car is unchanged throughout this investigation.

## Rejected trial: instantaneous exit admission on opposing-tram stubs

The new geometric reason for testing this narrow variant, rather than reviving the rejected broad stand test,
is that an opposing tram run reaching the standing end of a short link means that even comfortable braking does
not establish safe storage. No edge IDs or coordinate exceptions are hard-coded. At connection time the trial
marks lanes on links under 12 m whose opposing tram mapping reaches within 3 m of the far line. It marks 26 edges,
including 4660/4661 and Kaponiera 6522. This predicate is a conservative selection of suspected unsafe storage,
not a section-envelope clearance proof for all 26 edges.

For an uncommitted entrant to a marked lane, the trial requires a downstream green if signalled, empty conflicting
box counters, no currently binding priority crossing traffic, no `nextTramBlocked` hold, and `room(..., true)` on
every reachable outgoing lane. Checking every possible exit avoids drawing a future route early from the shared
random stream: the real next turn is still selected on arrival. It claims no downstream reservation. Existing
committed-vehicle behavior, tram exemptions, geometry and route topology are unchanged.

A preliminary version incorrectly passed the upstream vehicle to downstream `boxBusy`, which would compare the
upstream connector with downstream holders. It was corrected to use the conservative box counters before the
complete comparison below. An interrupted run only generated reusable baseline cache entries; no preliminary
working measurement is used in the acceptance table.

The definitive trial still has seed-61 contacts: **2 pairs / 154 pair-frames**, both stopped. Car 27 / tram 21
contacts on 4660 at 93.6 s, s=7.166, while planning the right turn to 6231. At 65–72 s the new guard holds it
upstream for `room`; it is admitted at 73–74 s, crosses the 25.97 m connector at 74–77 s, reaches 4660 at 78 s
and stops for `crossing` by 80 s. At 84 s `tram` binds, followed by section-0 contact.
The other contact is bus 208 / tram 10 on `2595 → 4660` at cs=16.829 m, 158.2 s. Thus the guard leaves both
unsafe stub storage and a stopped connector contact; checking the exit now does not keep it open over transit.

A seed-67 trial benchmark gives Jeżyce mean **13.0 → 12.9 km/h**, stopped **39.4 → 39.0%**, longest hold
**83 → 81 s**, holds over 60 s **3 → 8**, over 120 s **0 → 0**, deadlocks **0 → 0**. This local row is diagnostic;
the complete acceptance comparison, not a per-seed 0.1 km/h bound, decides rejection.

## Complete acceptance comparison

```sh
node tools/accept-traffic.mjs --base poznan --jobs 4 --json .agent-task/4660/accept.json
```

The runner's working columns below describe the **rejected trial**; the final restored game corresponds to baseline.
Exit status **1**. Both mandatory long-wait gates read `worse`; no new deadlock pattern repeats in three seeds.
The aggregate pair reduction is within noise, although Jeżyce's district reduction is clear. Jeżyce mean speed
falls 14.370 → 14.030 km/h and Kaponiera 13.135 → 12.210 km/h. The table below is the complete runner output;
its baseline/working columns sum per-seed values, including speeds and per-seed maximum waits. The maximum-wait
mean rises 109.75 → 172.00 s. Those sums must not be mistaken for one physical waiting episode.

## Traffic acceptance: poznan vs working tree (20 seeds, 5 min, 15 fps)

Seeds: 61 67 71 73 79 83 89 97 101 103 107 109 113 127 131 137 139 149 151 157. Diff = working − baseline; 95 % CI is a paired bootstrap of the mean diff per seed.

| metric | baseline | working | mean diff / seed | 95 % CI | verdict |
|---|---|---|---|---|---|
| car–tram pairs | 74 | 62 | -0.6 | [-1.5, +0.3] | within noise |
| holds > 120 s | 28 | 118 | +4.5 | [+2.4, +6.45] | worse |
| deadlocks | 3 | 2 | -0.05 | [-0.25, +0.15] | within noise |
| max wait s | 2195 | 3440 | +62.25 | [+43.8, +79.6] | worse |
| km/h all | 304 | 301.4 | -0.13 | [-0.28, +0.01] | within noise |
| km/h Jeżyce (info) | 287.4 | 280.6 | -0.34 | [-0.62, -0.07] | worse |
| km/h Łazarz (info) | 279.6 | 279.6 | 0 | [0, 0] | within noise |
| km/h Centrum (info) | 287.9 | 289.9 | +0.1 | [-0.3, +0.5] | within noise |
| km/h Kaponiera (info) | 262.7 | 244.2 | -0.93 | [-1.36, -0.46] | worse |
| km/h Stare Miasto (info) | 357.9 | 358.6 | +0.04 | [-0.21, +0.28] | within noise |
| km/h Rataje (info) | 337.2 | 344.6 | +0.37 | [-0.04, +0.74] | within noise |
| km/h Wilda (info) | 324.8 | 324.8 | 0 | [0, 0] | within noise |

Per-seed paired values (baseline → working (diff)):

| seed | car–tram pairs | holds > 120 s | deadlocks |
|---|---|---|---|
| 61 | 3 → 6 (+3) | 3 → 4 (+1) | 0 → 0 (0) |
| 67 | 5 → 2 (-3) | 0 → 7 (+7) | 0 → 0 (0) |
| 71 | 2 → 3 (+1) | 0 → 1 (+1) | 0 → 0 (0) |
| 73 | 3 → 3 (0) | 0 → 9 (+9) | 0 → 1 (+1) |
| 79 | 2 → 4 (+2) | 0 → 8 (+8) | 0 → 0 (0) |
| 83 | 3 → 4 (+1) | 3 → 8 (+5) | 0 → 0 (0) |
| 89 | 2 → 1 (-1) | 3 → 10 (+7) | 1 → 0 (-1) |
| 97 | 4 → 2 (-2) | 0 → 1 (+1) | 0 → 0 (0) |
| 101 | 3 → 2 (-1) | 6 → 1 (-5) | 1 → 0 (-1) |
| 103 | 4 → 3 (-1) | 0 → 6 (+6) | 1 → 0 (-1) |
| 107 | 7 → 2 (-5) | 0 → 6 (+6) | 0 → 0 (0) |
| 109 | 2 → 4 (+2) | 0 → 10 (+10) | 0 → 0 (0) |
| 113 | 4 → 2 (-2) | 0 → 12 (+12) | 0 → 0 (0) |
| 127 | 4 → 6 (+2) | 5 → 5 (0) | 0 → 0 (0) |
| 131 | 4 → 3 (-1) | 1 → 7 (+6) | 0 → 0 (0) |
| 137 | 2 → 3 (+1) | 0 → 8 (+8) | 0 → 0 (0) |
| 139 | 7 → 3 (-4) | 0 → 5 (+5) | 0 → 0 (0) |
| 149 | 6 → 4 (-2) | 7 → 1 (-6) | 0 → 0 (0) |
| 151 | 3 → 3 (0) | 0 → 8 (+8) | 0 → 1 (+1) |
| 157 | 4 → 2 (-2) | 0 → 1 (+1) | 0 → 0 (0) |

New deadlock patterns (in ≥ 3 working seeds, none of the baseline's): none

REGRESSION: holds > 120 s worse (mean diff 4.5); max wait s worse (mean diff 62.25)

### District overlap totals (additional diagnostic)

| metric | baseline | working | mean diff / seed | 95 % CI | verdict |
|---|---|---|---|---|---|
| pairs jezyce (info) | 41 | 20 | -1.05 | [-1.75, -0.35] | better |
| pairs lazarz (info) | 0 | 0 | 0 | [0, 0] | within noise |
| pairs centrum (info) | 5 | 4 | -0.05 | [-0.35, +0.25] | within noise |
| pairs kaponiera (info) | 17 | 20 | +0.15 | [-0.35, +0.65] | within noise |
| pairs stare (info) | 4 | 9 | +0.25 | [0, +0.55] | within noise |
| pairs rataje (info) | 7 | 9 | +0.1 | [-0.15, +0.35] | within noise |
| pairs wilda (info) | 0 | 0 | 0 | [0, 0] | within noise |

## Decision and remaining work

Rejected and reverted. The instantaneous exit guard trades contacts for long upstream holds and still permits
unsafe standing positions after admission. No feeder cap, connector stop, lane geometry change, proxy clipping,
tram-body exception or rejected bus-only conflict rule is retained. `js/road-network.js` and `js/street-details.js`
were not touched.

A future controlled-box design would need to secure a usable body path through the connector, stub and downstream
junction until the rear clears, while allowing existing occupants and tram obstacles to leave. Merely extending
this instantaneous check to more short links is not evidence of that guarantee. This experiment does not prove
that a controlled-box fix or an OSM correction is impossible; neither was implemented or measured here.
The stub, bus-clearance and other connector contacts remain open work.

## Verification

- Final `node --test tests/`: **646/646 pass**, no failures, cancellations or skips, 105.5 s.
- `js/traffic.js` and `tests/traffic.test.cjs` are byte-identical to their pre-trial copies and have no git diff.

Two focused trial-rule tests passed with the 58-test traffic unit file (including existing tests): static lane
selection/reset and downstream admission against blocked exits/box/crossing/tram. They and their source-slice
stubs were removed with the rejected rule; copies remain only in the ignored investigation directory.
Final `git diff --check` passes. No browser check is required or claimed for this headless, reverted experiment.
