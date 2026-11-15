# Closed twin-lane pedestrian stand-offs, 2026-11-15

Investigation on `cx-ped-standoff`, baseline `637105e`, including the current Kaponiera signal offsets.
The earlier rejected capacity, admission, spawn and routing candidates were not retried. Measurements below use
actual pedestrians, traffic and trams in the furnished benchmark world, with its documented omissions; no browser
appearance or audio check was performed.

## Method and freshly measured baseline

```
node tools/audit-ped-overlaps.mjs --minutes 3 --seeds 4242,77 --json <output>
node tools/bench-traffic.mjs --ped-rooms --minutes 3 --seed 4242 --json <output>
node tools/bench-traffic.mjs --ped-rooms --minutes 3 --seed 77 --json <output>
node tools/bench-traffic.mjs --seed 1 --json <output>
node tools/bench-traffic.mjs --seed 5 --json <output>
```

Overlap: eight districts, 15 fps, sampling each second after 20 s. Rooms: seven districts, same duration and seeds.
Traffic: seven districts, five minutes, seeds 1 and 5. Means below are arithmetic means of the audit's rounded district
rows; changes smaller than its 0.1 pairs/s district reporting precision are not evidence of an improvement.

| Baseline seed | Clusters | Longest pair | Pairs/s | Entries/min | Room ped-s | Centrum room ped-s |
|---|---:|---:|---:|---:|---:|---:|
| 4242 | 0 | 19 s | 5.8750 | 107.8000 | 24,958 | 15,158 |
| 77 | 0 | 19 s | 5.2625 | 104.9125 | 23,264 | 12,326 |
| Both-seed mean / room sum | 0 | 19 s | 5.56875 | 106.35625 | 48,222 | 27,484 |

This replaces the historical 5.60 pairs/s, 106.9 entries/min and seed-4242 23,580 room ped-s snapshot for this tree.
The historical 24 s Poznańskie Krzyże pair does not recur; the longest pairs are still 19 s and are not all U-turns.

| District | Rooms 4242 | Rooms 77 | Traffic km/h seed 1 | Traffic km/h seed 5 |
|---|---:|---:|---:|---:|
| Jeżyce | 901 | 873 | 16.5 | 13.5 |
| Łazarz | 1,465 | 1,458 | 14.2 | 13.9 |
| Centrum | 15,158 | 12,326 | 13.3 | 15.0 |
| Kaponiera | 2,035 | 2,511 | 13.0 | 12.1 |
| Stare Miasto | 498 | 1,052 | 18.1 | 18.2 |
| Rataje | 1,471 | 1,630 | 16.3 | 17.4 |
| Wilda | 3,430 | 3,414 | 15.5 | 15.7 |

All fourteen baseline traffic district runs have zero deadlocks. These traffic rows are the comparison baseline,
not evidence about an unrun candidate traffic audit.

## Trace and minimal reproduction

A per-second scratch trace uses the audit's accumulated `1 / 15` clock and records current segment geometry,
remaining legs, direction, lane offset, `stuck`, `roomCause` and nearby walkers. At Dworzec seed 4242:

- At t140, #162 and #191 have overlapped for 19 s at the **eastern** end of the isolated 4.78 m twin sidewalk,
  near `(-1553.9, 576.0)`. They occupy opposite direction objects of the same 1.1 m link, at t0.48 and t0.50,
  with opposite headings, both held by `entrance`. The western end is the named `(-1558, 575)` site.
- The longest list also contains a separate 19 s same-direction approach overlap: #117/#197 near
  `(-1582.8, 563.2)` at t72, on a 5.29 m corner approach held by `queue` / `approach`.
- Centrum seed 77 has #46/#180 at t136 near `(-1081.2, 302.5)`: a crosswalk `curbQueue` next to a 0.68 m
  link held by `approach`, lasting 19 s. A short-link head-on rule cannot by itself resolve this pair.

The closed-racetrack topology and 332-track world count are from the
[2026-11-10 scan](ped-twin-lane-loops-2026-11-10.md), not a newly repeated topology census.

A minimal fixture executes the actual source-sliced `laneOffset` with two stopped walkers on reversed 1.1 m
segments, each t0.48, both inset sides validated. The original lane ramp keeps their centres only **0.258747 m**
apart after two seconds; an assertion requiring at least 0.5 m fails. No traffic, random route choice or additional
walker is necessary to reproduce that lateral separation failure. This fixture isolates the lane issue; the full
simulation remains the test of entrance cycles and throughput.

## New mechanisms tested

### A: latched head-on sidestep

For two walkers already stuck at least one second on the exact same connector shorter than `2 * QUEUE_GAP`
(1.24 m), require opposite headings, segment lengths and midpoints matching within 0.01 m, centres within
`QUEUE_GAP`, and **both** inset sides validated (`insetLane === 3`). Latch both walkers to their full directional
0.34 m inset until their current leg ends, retaining the existing 1.5 m/s lateral easing. This is a conditional
settlement of an existing head-on meeting, not the rejected universal length-scaled lane ramp. Entrance, queue
and capacity checks are unchanged; no oncoming body is ignored and no random draw is added.

The minimal fixture separates to **0.694262 m** within two seconds. In the full world, however, it fails acceptance:

| Seed | Clusters | Longest pair | Pairs/s | Entries/min | Room ped-s |
|---|---:|---:|---:|---:|---:|
| 4242 | 0 | 19 s | 5.8875 | 107.6500 | 24,813 |
| 77 | 0 | 19 s | 5.2625 | 104.9125 | 23,264 |

Rooms improve only at Kaponiera 4242 (2,035 → 1,890); the seven-district total falls by 145. Dworzec 4242's named
eastern head-on pair leaves the longest list, but its overall pairs/s rises **8.1 → 8.2** and the independent 19 s
approach pair remains. Dworzec 77's western pair remains. Both-seed mean pairs/s rises **5.56875 → 5.575** and
entries/min changes **106.35625 → 106.28125**. Reject: no longest-pair improvement and pairs/s higher.

### B: physical retreat to the original approach

Remember the original sidewalk and travel direction when stepping onto a link. For an exact head-on meeting
(shorter than 1.24 m, matching segment length/midpoint within 0.01 m, both stuck at least one second, centres
within 0.62 m), choose the walker with the **shorter distance back to its origin**, breaking ties by segment-origin
coordinates. Reverse it and make its next leg the original sidewalk facing away. It physically retraces the link;
ordinary entrance, queue and capacity checks remain active, and the existing 0.85 s turn pause applies. This is
not an entrance exemption or an exit swap. A minimal helper fixture confirms exactly one walker reverses onto
its own approach, without a random draw.

| Seed | Clusters | Longest pair | Pairs/s | Entries/min | Room ped-s |
|---|---:|---:|---:|---:|---:|
| 4242 | 0 | 19 s | 5.9000 | 107.8875 | 24,950 |
| 77 | 0 | 19 s | 5.2750 | 104.9125 | 23,011 |

Rooms change only at Kaponiera 4242 (2,035 → 2,027) and Wilda 77 (3,414 → 3,161). Both-seed mean pairs/s rises
**5.56875 → 5.5875**; entries/min rises **106.35625 → 106.4**. Dworzec 4242 pairs/s rises **8.1 → 8.3**.
Reject: longest pair unchanged in both seeds, pairs/s higher in both seeds.

The seed-77 western-link trace explains the failure: at t176 #282 has reversed (`dir = -1`), but both #193 and
#282 still have the same northern sidewalk as their next leg, both held by `entrance`. #116 is 0.444 m from that
sidewalk's entry, itself waiting to enter the link; more walkers occupy the shared approach key. A local reversal
does not create an empty landing. The pair lasts 19 s despite the reversal.

The same trace records reversed link masks **2** and **1**: those are the same allowed physical side, not two
opposing validated lanes. Both original `dir = +1` walkers cannot take their respective right-hand inset there;
requiring both sides in candidate A deliberately leaves this western link unchanged. Applying a full two-sided
sidestep here would use ground the route builder has not validated.

## Decision and verification

**Neither new mechanism passes; all experimental game changes were reverted.** No game code, route graph,
threshold, signal plan or seeded random stream is changed. No new regression test is kept because no behavioural
change is kept. The full eight-district and both seven-district room audits were completed for each candidate.
Candidate traffic runs were not needed after the pedestrian gates failed; the baseline traffic runs above were
completed for both requested seeds. There is no claim that either rejected candidate meets the traffic gate.

The backlog now keeps the rejection inventory while moving the older numerical history into its linked records.
Scratch traces, minimal fixtures, exact experimental patches, raw JSON and stdout are retained as debug artifacts
under `.agent-task/`; they are not production modules or tests. The smallest lane fixture is a useful lateral
separation check, but cannot substitute for the multi-body admission-cycle audit.

Full `node --test tests/`: **629 / 629 pass**, zero failures or skips (102.8 s). `git diff --check` passes.
Production `js/`, `tests/` and `tools/` are identical to `HEAD`; no commit was made.

A future mechanism needs validated space at the sidewalk landing as well as on the U-turn, and must also address
the independent 19 s curb/approach pairs to pass the longest-pair gate. Neither a lateral repair alone nor a local
reversal without a landing reservation is sufficient.
