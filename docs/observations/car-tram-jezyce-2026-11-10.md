# Car–tram Jeżyce investigation (2026-11-10)

Base `aecdb54`, benchmark world, five simulated minutes at 15 fps, 20 s warmup. Pair IDs are pooled and may be reused. An instrumented copy of the audit sampled vehicle and tram positions, section rectangles, lane and connector state, leader and tram obstacle once per second, without changing update order. The benchmark omits the full rendered scene; rectangle contact is not a browser collision test.

## Diagnosis before changes

The four articulated-bus pairs described at `42329c3` do not recur in this checkout's seed-2 Jeżyce run: its five pairs are 19:21, 12:13, 47:5, 32:22 and 56:17, all cars. The earlier bus geometry question therefore remains unresolved by this replay; counting its rigid 18 m rectangle as proof of a rendered-body collision would be unsound.

For seed 2, car 19 is stopped at lane 0, edge 4660 s=7.8, position (−2049.5, −455.9), from seconds 122–139. Tram 21's section 0 moves from (−2044.0, −450.9) at 122 to (−2055.6, −460.7) at 136; the rectangles overlap throughout. The car waits for the tram, with proxy gaps −4.1 to −4.5 m at 123–127, while the tram reports car 31 as obstacle through 132 and then curve/stop. This is a stopped car inside a turning sweep, not an articulated-bus measurement artefact.

Car 47 follows tram 5 on lane 0 of edge 8081: at 173.2 s first contact is at 4.4 m/s; at 174–194 the car is stationary at (−2153.1, −492.6), s=45.8, with tram 5 its leader and gap −2 m. The tram is almost stationary at (−2137.3, −487.3), waits for car 33, and its section 4 is at (−2148.4, −491.3), overlapping the car. This demonstrates the proxy is present after contact but came too late to prevent the rear approach. Car 32 touches tram 22 on its connector at 221.5 s; at 222–225 it slows 6.1 → 0 m/s while following the tram, whose sections 0–2 overlap. These distinct mechanisms cannot safely be fixed by assuming every contact is the same dropped proxy.

Current default seed 4242 does have an articulated bus contact: bus 204 at (−2056.3, −458.3), edge 4660 lane 0 s=0.6, is stationary while tram 21 turns. At 76 s the rigid audit rectangle overlaps section 0 but neither rendered section rectangle does; at 77–82 s the 10.4 m front section does overlap tram sections 0–2. The rear section is placed using the simulated trailer's position and yaw, with half-length 3.4 m; the front uses the bus position/yaw and half-length 5.2 m. Thus this contact begins as a rigid-rectangle false positive but becomes a real rendered-section rectangle overlap; merely changing the audit would not resolve the encounter.

Default car 53 follows tram 21 from edge 8080 into edge 6222. At seconds 118–121 its reported leader is car 10, the tram's obstacle, and the recorded gap falls 48.4 → 37.6 m while the tram nearly stops; at 122 the car is at (−2207.6, −516.1), s=11.5, 5.5 m/s, overlapping section 2 at (−2212.6, −517.4). At 123 the tram proxy becomes its leader with gap −2.7 m. Car 4 follows tram 19 on the same route: the tram proxy is its leader at 136–139 (gap 9.8 → 5.9 m), but at 140–142 it disappears and car 53, the tram's obstacle, becomes the leader (41.3 → 32.5 m); at 142 car 4 overlaps section 2. At 143 the proxy returns with gap −4 m. These are current counterparts of the historical dropped-proxy trace, on different edge IDs after the network changes.

## Candidate under test

A harness-only follower brake retained the tram body as a private virtual leader solely for the nearest car behind the body on a same-direction mapped lane, when it lies within that driver's braking distance plus time headway. The tram's obstacle and other vehicles did not see an occupancy proxy. Initial Jeżyce results: seed 4242 pairs 5 → 3, mean 13.3 → 14.1 km/h, stopped 37.1 → 33.6%, maximum wait 70 → 70 s, held over 120 s 0 → 0, deadlocks 0 → 0; seed 2 pairs 5 → 3, mean 14.7 → 14.7, stopped 32.3 → 32.3%, maximum wait 56 → 56 s, held over 120 s 0 → 0, deadlocks 0 → 0; seed 1 pairs 3 → 2, mean 16.0 → 16.0, stopped 30.2 → 30.1%, maximum wait 55 → 55 s, held over 120 s 0 → 0, deadlocks 0 → 0. The default seed gained two different moving contacts, so the pair reduction alone is not evidence of a safe fix. The initial diagnostic leader used the tram object directly; the wider check uses a proxy carrying `tram` so the benchmark follows it in its wait-for graph.

## Harness benchmark (seeds 1, 4242, 7, 99, 2, 3)

An isolated harness first ran the candidate with lazily created proxies. Full-district benchmark totals (mean km/h, stopped %, maximum finished wait seconds, held >120 s, deadlocks; baseline → harness candidate):

| Seed | Mean | Stopped | Worst wait | Held >120 s | Deadlocks |
|---|---|---|---|---|---|
| 1 | 15.5 → 15.5 | 33.7 → 33.7 | 118 → 118 | 0 → 0 | 1 → 1 |
| 4242 | 14.7 → 14.8 | 34.8 → 34.4 | 112 → 112 | 0 → 0 | 0 → 0 |
| 7 | 15.2 → 15.3 | 33.9 → 33.7 | 155 → 155 | 6 → 6 | 1 → 1 |
| 99 | 15.0 → 15.0 | 34.3 → 34.3 | 89 → 89 | 0 → 0 | 1 → 1 |
| 2 | 14.8 → 14.8 | 35.0 → 35.0 | 145 → 145 | 10 → 10 | 0 → 0 |
| 3 | 15.1 → 15.1 | 34.2 → 34.3 | 97 → 97 | 0 → 0 | 0 → 0 |

The first production `setTrams` initialized the private proxies from the active tram list, which is empty at connection time, and threw when the first follower needed one; it now initializes `system.pool`. The verification below is of that corrected code.

## Final verification (production code, 2026-11-10)

Production `js/traffic.js` reproduces the harness (seed 4242 Jeżyce 3 pairs, 14.1 km/h, 33.6%, wait 70 s, 0 held, 0 deadlocks). The pool-initialization bug is fixed. Eight seeds (1, 4242, 7, 99, 2, 3, 5, 11) x 7 districts, audit and 5 min benchmark, base vs change:

Overlap pairs: 73 -> 37 (moving 53 -> 19, stopped 20 -> 18). Jeżyce 47 -> 21, Centrum 11 -> 1, Kaponiera 8 -> 8, Stare Miasto 7 -> 7, Łazarz/Rataje/Wilda 0 -> 0.

Benchmark (mean km/h / stopped % / worst wait s / held >120 s / deadlocks), only rows that changed:
- Jeżyce: seed 4242 13.3/37.1/70/0/0 -> 14.1/33.6/70/0/0; seed 7 14.2/34.4/67/0/0 -> 15.0/32.5/85/0/0; seed 3 13.9/35.0/85/0/0 -> 13.7/35.5/85/0/0; seeds 1, 99, 2, 5, 11 identical or +-0.1.
- Centrum: seed 4242 13.4/36.8/61 -> 13.3/37.4/57; seed 7 13.2/38.1/58 -> 13.3/38.9/56; seed 99 15.9 -> 15.8; seed 5 13.0 -> 13.1; seed 11 14.2 -> 14.1 (all within 0.1 km/h, stopped within 0.8 points).
- Kaponiera (held >120 / deadlocks base = new): seed 1 0/1, seed 7 6/1, seed 99 0/1, seed 2 10/0, seed 5 5/2. All other districts identical on every seed.
No new deadlock or >120 s hold anywhere. Full `node --test tests/`: 499/499 (496 + 3 new).
