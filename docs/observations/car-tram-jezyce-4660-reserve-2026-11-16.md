# Jeżyce 4660 body-path reservation trial (2026-11-16)

**Kept: variant V10** (= V9 restricted to links with an oncoming approach and a 5 m tram run, with the release latched and bounded, below), a
geometry-selected reservation on unsignalised short links swept by an opposing tram.

**Headline (review rounds 2 and 3, `poznan` `462cd6f`, both sides rebuilt, 20 default fresh seeds,
`node tools/accept-traffic.mjs --base poznan`, output in `.agent-task/accept-final-2.txt`; round 3 reran it with the 6342 criterion, `.agent-task/accept-final-3.txt`, identical because no district covers 6342):**

| metric | baseline | working | mean diff / seed | 95 % CI | verdict |
|---|---|---|---|---|---|
| car–tram pairs | 95 | 69 | -1.3 | [-1.85, -0.7] | better |
| holds > 120 s | 17 | 15 | -0.1 | [-0.3, 0] | within noise |
| deadlocks | 2 | 0 | -0.1 | [-0.25, 0] | within noise |
| max wait s (sum) | 2165 | 2158 | -0.35 | [-8.5, +5.4] | within noise |
| km/h all | 304 | 303.1 | -0.05 | [-0.1, +0.02] | within noise |
| km/h Jeżyce | 280.5 | 275.6 | **-0.25** | [-0.6, +0.13] | within noise |
| km/h Stare Miasto | 359 | 358.5 | -0.02 | [-0.05, 0] | within noise |

District pairs (base → work): Jeżyce **53 → 27**, Kaponiera 27 → 27, Stare Miasto 6 → 6, Rataje 9 → 9, Centrum,
Łazarz, Wilda 0 → 0. Deadlocks 2 → 0 (seeds 139 and 151 resolved, none new). Exit status 0. **Trade-off for the user:**
Jeżyce mean speed falls **0.25 km/h per seed** (sum over seeds 280.5 → 275.6, CI [-0.6, +0.13]), over the 0.1 km/h
per-district tolerance; the interval includes 0 but the point estimate is twice the earlier rounds'
(-0.15 / -0.12). The rebased baseline itself carries 53 Jeżyce pairs (41 before `462cd6f`).

History (kept, not the headline): `2670dc1`, V9 with all one-way links, 20 seeds: pairs 74 → 59, Jeżyce 41 → 26, holds
28 → 28, deadlocks 3 → 0, max wait +0.95 s, Jeżyce -0.12 km/h (`.agent-task/accept-final.txt`). `9f3d3c0`, same rule:
pairs 76 → 63, Jeżyce 41 → 26, holds 27 → 27, deadlocks 3 → 1, Jeżyce -0.12 km/h, Centrum pairs 0 → 2 and one new
deadlock (below). Earlier numbers in the variant table (pairs 74 → 57, Jeżyce -0.15 km/h) were measured before the
latch, the longer tram scan and the rebases.

**Per-car cost at 4684/4685** (measured by the reviewer over the same 20 seeds, base → work): cars through the stubs
374 → 327 (**-13 %**); mean feeder stop before entry 12.2 → 17.4 s (**+5 s per car**); **4712 car-s** held for the
reservation (`held 'reserve'`); stopped car-s on the main-road approach 6264 2552 → 3049 (**+19 %**) and on 8989
1783 → 1992 (**+12 %**). The pair reduction is bought with these waits; the district speed figure above is the
aggregate of them.

**Round 2 changes.**
1. *A released car touched a standing tram* (seed 79, Stare Miasto, car 210 / tram 16 at (289, -247), 287.9 s, 2.5 m/s,
   inside the release window): the released car took the `t.obstacle` skip, which dropped the whole proxy including the
   tram's body band. A released car still behind the body band now keeps that band as its leader (the proxy is clipped
   to `blo..bhi`); with the tram's body not on the lane (seed 1, Jeżyce) nothing changes. Seed 79 Stare Miasto on the
   `2670dc1` tree reads 1 → 0 pairs after the fix (that contact is gone); the headline Stare Miasto total is 6 → 6.
2. *The latch outlived its reason* (seed 83, Stare Miasto (280, -246), 23 frames): `v.released` is cleared as soon as
   the tram is no longer waiting for the car (`t.obstacle !== v`) or moves faster than `RELEASE_TRAM_SPEED` (1 m/s).
3. *Centrum links 197/483.* On `9f3d3c0` they produced a new Centrum deadlock (seed 79, (-878, 159): car 10 in the box,
   a tram and an oncoming left-turner) and 2 new pairs. Excluding exactly those two links reproduced the baseline
   run of that seed number for number (50 cars, 15.1 km/h), so the links caused the divergence; the cycle itself is
   the existing box/proxy/left-turn kind (car 10 waits behind tram 3's proxy, tram 3 waits for car 4, car 4 yields to
   car 10), not the release. Both are **one-way 20 km/h streets with no
   oncoming approach into their far junction**. Round 2 required `f.opposite`; **that field is the oncoming approach on
   the same axis into the same far junction (`road-network.js`, `e.opposite = e.to.in.find(...)`; for 4684 it is 8989 from
   (-1997, -439)), not the reverse lane of the link, so "two-way" in the round 2 text and backlog was wrong.** It removed
   197/483 and the other one-way links (4923, 5112, 5163, 6018, 6343) but also kept 6342.
3b. *Round 3: link 6342* ((-2293, 323) → (-2297, 338), 7.7 m, only a 0.7 m lane run near the Matejki stops, outside every
   bench district). Measured over 10 seeds (61–103), cars within 300 m, base → work: entries 100 → 67, mean stop before
   entry 9.5 → 19.3 s, max stop 106 → 162 s (seed 73 162 s, seed 89 153 s, both over 120 s), mean speed 13.56 → 13.15
   km/h. It is dropped by a **geometric criterion added to the zone filter**: the opposing tram run must cover at least
   `RSV_MIN_RUN` = 5 m of lane (`|l1 - l0|`). `f.opposite` stays: the run criterion alone would also keep 197 (8.0 m),
   483 (5.9 m), 4923 (7.1 m) and 6343 (8.1 m), the links the round 2 evidence argues against. City-wide the zones are
   now exactly **4684 (-2023, -448) and 4685 (-2069, -470)** (`node .agent-task/marked.mjs`-style check over the
   network's `_rsvRuns`), both in the Jeżyce bench district.
4. *Test for the Stare Miasto release site:* the unit test now covers the release, the body-band clip, the latch
   persisting while the car creeps and clearing when the tram moves or waits for another car; it cannot reproduce the
   exact Stare Miasto geometry, which is measured by seed 79 and the acceptance run.

## Rule

Selection (`setTrams`, no edge ids): lanes of links shorter than 12 m, **unsignalised at both ends**, along which an
opposing tram run (`mapTramsToRoads`, `dir < 0`) reaches within 3 m of the far line **and covers at least 5 m of lane**,
on links whose far junction has an oncoming approach on the same axis (`f.opposite`). This is the predicate of the
rejected exit-room guard minus the signalised ends, plus the last two conditions. With signals included it marks 26
edges including Kaponiera 6522.
**Ten links qualified before the `f.opposite` and run-length conditions (two remain, see above)** (edge id, `to` coordinates, length): 197 (-861, -2) 10.0 m, 483 (-855, 45) 10.0 m,
4684 (-2023, -448) 10.0 m, 4685 (-2069, -470) 10.0 m, 4923 (-1799, 849) 10.0 m, 5112 (1276, 1024) 10.0 m,
5163 (1582, -539) 9.4 m, 6018 (-856, 1680) 10.0 m, 6342 (-2297, 338) 7.7 m, 6343 (-2279, 316) 10.0 m. 4684/4685 are the
Jeżyce 4660/4661 of the earlier records (the ids are the current network numbering). Only four lie inside a bench
district (300 m around its focus): 197 and 483 in Centrum, 4684 and 4685 in Jeżyce. **Six (4923, 5112, 5163, 6018,
6342, 6343) are outside every bench district and were never measured.**

`reservationRefused(v, f, j, c, d)` in `mayEnter` (after the tram-curve check, `held = 'reserve'`) refuses entry to a
marked lane unless all hold:

1. **Mutex:** no other non-tram body has its rear before the link's far line in `f.occ[j]` (that list already holds a car
   on the incoming connector, claimed, and one on the link or its outgoing connector). Waiting cars stand at the upstream
   line, outside the envelope. The holder is released when its rear is past the far line.
2. **Downstream lane space:** `room(g, k, v, true)` for every exit lane reachable from `j` (the real turn is still drawn on
   arrival).
3. **Far junction:** `boxBusy` empty, a green at arrival (`downstreamStops`) where signalled, and no moving main-road lead
   that reaches its line within the car's travel time + 2 s (standing leads are already waiting for something else).
4. **Tram timing:** no tram whose run on the lane ends ahead of its rear and whose nose is within
   `max(speed, 3 m/s) × (travel time + 1 s)` of the run start (run padded by its width allowance; the scan along
   the tram's path reaches as far as that travel plus 10 m, not a fixed 70 m: a 10 m/s tram covers ~85 m in 8.5 s); the tram waiting for
   this very car (`t.obstacle === v`) is exempt, so `tramStandsAt`'s "tram waits for me" case is unchanged. A committed
   car (cannot stop) still passes through `enter` as before.

Vehicles never keep a stored reservation, so nothing can leak on respawn.

**Proxy release** (`occupyTrams`, `ARRIVING_WAIT`, `v.released`): the changed trajectories hit a pre-existing tram/car
cycle in the flow regression test (seed 1, Jeżyce (-2023, -448); seed 73 has the same, car 20 / tram 2): a car stopped
4.7 m short of the end of a 37.9 m left-turn connector behind the proxy of the tram standing for that very car
(`t.obstacle === v`), the proxy lying just beyond the car's lane position so the existing "obstacle inside the sweep"
skip did not apply. A tram's obstacle that has stood on a connector for 20 s (the `PROXY_RELEASE_WAIT` scale) now
drops that proxy. **The first version tested this every frame and only hid the cycle:** the dropped proxy let the car
reach 0.53 m/s, which reset `wait`, so the proxy returned at once and the car crept 0.2 m at a time for about a
minute, below the bench's 30 s deadlock threshold. The release is now latched on the car (`released = tram`) until it
leaves the connector. Trace, seed 1, car 46: stands from 262.9 s, released at ~281 s, at 283 s it is on 6263 at
5.1 m/s and at 307 s it is 100 m away at 13 m/s. Trials: no wait condition (V6) raised Stare Miasto pairs 4 → 17; a 5 s
wait (V8) 4 → 12 and Kaponiera 17 → 19, losing the pair gain (65, within noise).

**Bench detector:** `tools/bench-traffic.mjs` `blocker()` now follows a `'reserve'` wait (another body on the stub, a
tram heading for its run, then a full exit lane), so a cycle through a reservation is no longer invisible.

## Variants (20 seeds, vs `poznan` `d985b3f` (the final row: `2670dc1`); district pairs from the per-seed tram audits)

| variant | pairs | Jeżyce / Kaponiera / Stare / Rataje pairs (base 41 / 17 / 4 / 7) | holds > 120 s | max wait sum s (base 2195) | km/h all | Jeżyce km/h Δ / seed | verdict |
|---|---|---|---|---|---|---|---|
| V1 mutex + exit room + tram timing + exit-lane length held during transit (`room`), all 26 zones | 59 (better) | 16 / 17 / 5 / 12 | 28 → **134** | 2601 (worse) | -0.28 (worse) | -1.24 (worse) | rejected |
| V2 = V1 + far-junction checks | 75 | 18 / 28 / 10 / 12 | 28 → **149** | 2589 (worse) | -0.26 (worse) | -0.75 | rejected |
| V3 = V2 without the transit hold | 76 | 23 / 26 / 10 / 12 | 28 → 56 | 2612 (worse) | -0.11 | -0.14 | rejected (max wait; Kaponiera -0.57) |
| V3b = mutex + room + tram timing only, 26 zones | 74 | 29 / 23 / 7 / 12 | 28 → 36 | 2388 | -0.10 | -0.43 (worse) | no gain city-wide |
| V5a = V3b on unsignalised zones | 61 (better) | 29 / 17 / 4 / 7 | 28 → 25 | 2175 | -0.06 (worse) | -0.43 (worse) | rejected (speed) |
| V5b = V3 on unsignalised zones | 55 (better) | 23 / 17 / 4 / 7 | 28 → 30 | 2237 (+2.1) | +0.01 | -0.14 | passes the runner but fails `tests/traffic-flow.test.mjs` (seed 1 deadlock) |
| V6 = V5b + proxy release without wait | 72 | 23 / 21 / 17 / 7 | 28 → 26 | 2233 | 0 | -0.12 | rejected (Stare Miasto -0.21 km/h, pairs 4 → 17) |
| V8 = V5b + release after 5 s | 65 | 23 / 19 / 12 / 7 | 28 → 32 | 2284 | -0.01 | -0.12 | rejected (pair gain lost, Stare Miasto 4 → 12) |
| V9 = V5b + release after 20 s, unlatched | 57 (better) | 25 / 17 / 4 / 7 | 28 → 30 | 2237 (+2.1) | +0.01 | -0.15 | hid the seed-1 cycle (see above) |
| **V9 final = latched release, bench detector, scan by travel, rebased** | **59 (better)** | **26 / 17 / 5 / 7** | **28 → 28** | **2214 (+0.95)** | **+0.01** | **-0.12** | **kept** |

Mechanism of the failures: V1/V2's transit hold subtracted a car's length (2 × half + s0 ≈ 8.6 m) from *each* exit
lane of the stub while it crossed the 25.97 m connector. The exits are 10 m / 13.7 m links shared with main-road traffic,
so (-2023, -448) showed 4088 stopped car-s, 89 % `room`, max wait 297 s (seed 73, Jeżyce). Holding both candidate exits
for a car whose turn is not yet drawn is too coarse. Signalised and Kaponiera zones (V2–V3b) raised pairs there
(Kaponiera 17 → 23–28, Stare Miasto 4 → 7–10) and long holds; the mutex and far-line checks do not fit stubs between
signals, whose exits are released by phase.

## Commands

```sh
node tools/accept-traffic.mjs --base poznan --jobs 9 --json <out>.json     # per variant, shared .accept-cache
node tools/audit-tram-overlaps.mjs --seed 61 --only jezyce                  # Jeżyce 2 → 1 pair on seed 61
node --test tests/
```

Variant trees were scratch `git worktree`s with only `js/traffic.js` differing; baseline results are cached per tree
hash, so all six comparisons share one baseline. Seeds `61 67 71 73 79 83 89 97 101 103 107 109 113 127 131 137 139 149
151 157`, 5 min, 15 fps.

## What is left

The final rule removes about 37 % of the Jeżyce pairs, not all. The remainder includes the `8947 → 4659` bus clearance, cars
committed at speed that cannot stop at the line (the mutex does not apply to them), and the signalised/connector cases;
the zone rule deliberately leaves signalised stubs alone. A bus longer than the 10 m link is covered only by the same
rigid-rectangle rule as before. Headless only; no browser check was made.
