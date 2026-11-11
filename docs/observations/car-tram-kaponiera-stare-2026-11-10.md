# Car–tram overlaps at Kaponiera and Stare Miasto (2026-11-10)

Base `8c41595`, benchmark world, five simulated minutes at 15 fps, 20 s warmup. The eight-seed audit is the
`tools/audit-tram-overlaps.mjs` baseline from the backlog: **36 pairs** (Jeżyce 21, Kaponiera 9, Stare Miasto 5,
Centrum 1). Pair IDs are pooled and may be reused. Instrumented copies of the audit sampled vehicle and tram
positions, lane and connector state, leader, gate and section rectangles once per frame without changing update order.
The benchmark omits the rendered scene; rectangle contact is not a browser collision test.

This pass diagnoses the Kaponiera and Stare Miasto pairs. No production change was kept: the feeder speed cap that
removed the most common Kaponiera mechanism cost 1.9 km/h at Kaponiera in the benchmark, and the narrower stand-only
variant added a 146 s hold at Jeżyce. Both are recorded under [Rejected variants](#rejected-variants).

## Baseline

Eight seeds (1, 4242, 7, 99, 2, 3, 5, 11), all seven districts:

| District | Pairs | Moving | Stopped/slow |
|---|---:|---:|---:|
| Jeżyce | 21 | 6 | 15 |
| Centrum | 1 | 1 | 0 |
| Kaponiera | 9 | 6 | 3 |
| Stare Miasto | 5 | 5 | 0 |
| **Total** | **36** | **18** | **18** |

Per seed (after = before: no production change was kept):

| Seed | Jeżyce | Centrum | Kaponiera | Stare Miasto | Total |
|---:|---:|---:|---:|---:|---:|
| 1 | 2 | 0 | 1 | 2 | 5 |
| 4242 | 3 | 0 | 1 | 1 | 5 |
| 7 | 1 | 0 | 2 | 0 | 3 |
| 99 | 1 | 0 | 1 | 1 | 3 |
| 2 | 3 | 0 | 1 | 1 | 5 |
| 3 | 3 | 0 | 0 | 0 | 3 |
| 5 | 5 | 1 | 2 | 0 | 8 |
| 11 | 3 | 0 | 1 | 0 | 4 |
| **Total** | **21** | **1** | **9** | **5** | **36** |

## Kaponiera pairs

### The short-link feeder race (6 of 9)

At the 10 m link 7909 (`-1392, -200`, two lanes) and the equivalent 10 m links 3316/280 at `-1503, 299` /
`-1497, 250`:

| Seed | Pair | Place | Car / tram m/s | Trace |
|---:|---|---|---:|---|
| 1 | 46:7 | `-1383, -216` | 13.2 / 0.0 | car 46 on the 42.4 m feeder out of edge 364; tram 7 line 9 stands at the conflict with `obstacle` = car 46 |
| 4242 | 22:1 | `-1386, -217` | 8.3 / 4.4 | car 22 enters the 42.5 m feeder at 7.5 m/s, accelerates to 12.8; tram 1 line 9 was gated for car 39 between 29.1 and 30.6 s, so its curve was not reserved while the car accelerated |
| 7 | 38:7 | `-1387, -216` | 7.6 / 4.9 | same feeder; tram 7 line 9 is turning and holds the curve at contact |
| 2 | 61:0 | `-1497, 237` | 6.6 / 8.2 | car 61 crossed the 10 m link 280 at 12.2 m/s, refused at its line, 5.0 m/s on the 45 m exit connector, tram 0 line 18 crossing at 8.2 |
| 5 | 24:1 | `-1383, -215` | 13.6 / 0.8 | car 24 carries a `commit` from edge 363 at 4.4 m/s, accelerates to 13.6 on the feeder; tram 1 is standing at the conflict |
| 11 | 29:1 | `-1375, -211` | 6.3 / 0.2 | car 29 on the 42.4 m feeder at 9.8 m/s; tram 1 stands at the conflict with gate clearance 0.6 m |

The common mechanism, one pair per seed:

1. The entry guard at the upstream line passes the car while it can still stand on the 10 m link (`canStandOn`
   uses `len − half − 0.5`), or the tram has not reserved the exit curve yet because it is stopped/gated (a gated
   tram keeps only its body, `far = 2`).
2. The car accelerates along the 40–45 m feeder well past that standable speed (6.3 m/s for a 4.7 m car on a
   10 m link): 7.5 → 12.8, 9.8 → 11–13, 4.4 → 13.6.
3. When the car reaches the link, `mayEnter` refuses it (`held: 'tram'`) but it can no longer stop: the 10 m link
   gives 7.2–7.7 m of braking room and 12.8 m/s needs about 29 m.
4. `enter`'s too-fast-to-stop fallback (`speed >= 4`, not a bus) drives it across the link line. The car then
   crosses the tram's turning curve on the exit connector at 5–8 m/s: contact.

The important detail for seed 4242 is step 1: the tram was held at the road-car gate for car 39, and
`occupyTrams` deliberately drops a gated tram's future curve reservation. By the time the gate released (30.6 s),
the car had already passed the standable speed. This is not the "unheld-curve arrival forecast" (which compared
the tram's time to the conflict); the tram's *current* hold was visible to the car-side guard only after the gate
released.

### Stopped or slow car inside a turning sweep (3 of 9)

| Seed | Pair | Place | Car / tram m/s | Trace |
|---:|---|---|---:|---|
| 7 | 67:4 | `-1138, 158` | 0.0 / 5.8 | car 67 on the 22.8 m connector at `-1172, 133`; tram 4 line 5 moving 5.8 with `obstacle` = car 47 (17–21 m ahead) and no gate; the tram's turning front sweeps into 67 |
| 99 | 85:15 | `-1125, 140` | 0.0 / 3.0 | car 85 on the 9.4 m link 6522 at `-1131, 139`, entering its left-turn connector at 5.4 m/s; tram 15 line 5 turning at 3.0 |
| 5 | 83:15 | `-1129, 143` | 0.0 / 4.0 | car 83 on the 25.4 m connector at cs 20.9, queued behind car 35 (gap −3.3 m); tram 15 gated for car 35 (clearance 5.8 m), then moves and sweeps into 83 |

These are the same family as the Jeżyce stopped-car cluster: the tram's obstacle sweep is a centreline corridor
with the tram's half width; a stopped or slow car whose corner is inside the body's turning rectangle is either
masked by a closer obstacle (seed 5), missed until the front is already there (seed 99), or simply stationary in
the swept area while the tram follows another car (seed 7). The audit's rectangle is exact; the tram's `obstacle`
only names the nearest body. No production rule in this pass changes them.

## Stare Miasto pairs

### Shared street-running lane, side by side (3 of 5)

Seeds 1 (9:9), 99 (54:6) and 2 (13:6) all contact at `-318, -184`:

- The 10 m stubs 8503 (eastbound) and 8504 (westbound) carry one car lane at `+1.80 m` from the edge centre, and
  the line 17 track is mapped along that lane (`dir 1`, the whole edge). It is a shared tram lane.
- The car's 32.1 m connector joins that lane while the tram's rear section is already beside the entry point. The
  car and tram move the same way at 6.0–7.6 m/s, so the audit records a moving pair at the tram's rear section.
- The connector branch follows leaders ahead in the target lane; the tram's body *beside* the merge point is not
  a leader, and `room`/`alongside` run only in `mayEnter`, before the connector. The car therefore joins the lane
  inside the tram's rectangle. A merge guard on shared tram lanes would need the proxy's body span beside the car;
  it is not attempted here.

### Car passing a tram that stopped for it (2 of 5)

| Seed | Pair | Place | Car / tram m/s | Trace |
|---:|---|---|---:|---|
| 1 | 34:2 | `276, -243` | 3.5 / 0.0 | car 34 on the 17.6 m connector, queued behind car 16 (gap −1.6 m); tram 2 line 17 stands 0.4 m before the conflict, `waitReason car`, `obstacle` = car 34 (gate clearance 0.4 m) |
| 4242 | 38:8 | `-187, 305` | 7.4 / 2.2 | car 38 commits out of the 10 m link 8986 into a 30.9 m right-turn connector at 4.0 m/s and accelerates to 7.4; tram 8 line 2 stops 3.1 m before the conflict waiting for car 38 |

Both contacts are with the tram's nose while the tram waits for the very car passing it. The standoff at the
conflict is `entry − 0.5 m` plus the IDM standstill gap; for the shallow connector angle that is about the car's
half-length, so the car's swept rectangle reaches the tram's front corner. A larger constant standoff was already
rejected in 2026-11-09 (eight-seed total 60, Centrum 4 → 10), and a per-car standoff would change the same
gate timing. Not attempted here.

## Centrum pair

Seed 5, 14:6 at `-843, 7`: car 14 entered the 13.7 m link 5393 at 9.1 m/s, tram 6 line 16 was moving 6.4 m/s out
of its stop; the car's connector reaches the track as the tram arrives. This is a "tram leaving a stop into a
turning car" case; the audit's `conflict` flag is false because the contact is not on a registered curve.

## Rejected variants

All were applied to `js/traffic.js`, measured, and reverted. Audit runs are five minutes at 15 fps; benchmark runs
are five minutes at 15 fps on the same seeded world.

### Feeder speed cap

While a car is on a connector into a short link (`len < 12`) whose exit curve is tram-held within 20 m or has a
standing tram, cap its speed at the speed it can stand from inside the link
(`sqrt(2 * b * (len − half − 0.5))`), ignoring the "the tram waits for me" exemption in the stand test. A shared
tram lane (a lane the track runs along) is excluded, and the cap only engages above 1.6× the standable speed.

This removed the `-1385` feeder cluster in every tested seed (Kaponiera's remaining pairs were then at other
junctions), but the eight-seed audit moved the contacts elsewhere:

| Metric | Base | Feeder cap |
|---|---:|---:|
| Audit total | 36 | 34 |
| Jeżyce | 21 | 23 |
| Centrum | 1 | 4 |
| Kaponiera | 9 | 3 |
| Stare Miasto | 5 | 4 |

The default-seed benchmark also failed the flow gate: all districts 14.9 → 14.4 km/h mean, stopped 33.5 → 35.6 %;
**Kaponiera 13.7 → 11.8 km/h, stopped 47.1 → 52.9 %, maximum wait 112 → 119 s**. The remaining contacts were the
stopped/slow-car turning-sweep family above, which the cap does not address and whose pair count moved with the
changed queues. Not kept.

Variants of the cap tried while narrowing it: the first cap (no shared-lane exclusion, no threshold, stand case
included) fired 1,641 frames in one Jeżyce run, mostly on the Rynek Jeżycki stubs 4660/2595/4661, and took Jeżyce
13.2 km/h; adding the shared-lane exclusion cut that to 306 frames but still 13.0 km/h; the 1.6× threshold then
left 0 cap frames and 14.1 km/h at Jeżyce seed 4242. The eight-seed table above is the 1.6× + exclusion variant.

A **long-feeder-only** variant applied the cap only on connectors of 25 m or more (the 40–45 m feeders that let the
car gain speed), still with the shared-lane exclusion and the 1.6× threshold. Jeżyce seed 4242 stayed bit-identical
(14.1 km/h, 33.6 %, 70 s), but over the four seeds 4242, 1, 5, 11 the audit was 21 pairs against 22 (Kaponiera
5 → 2; Stare 3 → 3; Jeżyce 13 → 15, seed 11 alone 3 → 5) — the same movement of turning-sweep pairs, and seed 5
still had two Kaponiera pairs (`-1368, -210` and `-1496, 230`). Not kept.

### Connector stop for a tram standing at the exit curve

A narrower version braked a car on the connector to a stop at the short link's line only when `tramStandsAt`
found a tram standing at the exit curve, including a tram waiting for this very car. Jeżyce seed 4242 then gained
a **146 s hold and one car held over 120 s** (mean 14.0 km/h, stopped 36.3 %). The tram's obstacle sweep still
contained the stopped car in some geometries, so both waited. Not kept; the "tram waits for me" exemption must
stay in the stand test.

## What remains

- The Kaponiera feeder race needs the car to lose speed on the 40 m feeder. Every variant that does so costs
  Kaponiera throughput (the feeder is the junction approach), and every longer-range forecast of the tram's curve
  has already been rejected. A fix would have to make the tram's curve reservation survive its road-car gate
  without holding the gate's own car.
- The Stare shared-lane and stopped-tram nose pairs are geometry/standoff cases: a lane inside the tram's width on
  a 10 m stub, and a stop 0.4–3.1 m before a track crossing that a passing car's corner still reaches.
- `tools/audit-tram-opposing-lanes.mjs` is unchanged at 40 street-running rows / 38 lanes / 293 m (`--all`
  55 / 51 / 498 m).
