# Kaponiera deadlock traces, 2026-11-10

Investigated at `aecdb54`. The first round changed no production code; the retained release (`queuedBehindTram`,
see the end of this record) landed on `poznan` on top of `3279f75`, with the verifier's oncoming-envelope fix
(Stare Miasto (288, -244) seed 5: pair 56:20 removed; eight-seed audit 37 -> 36). Five-minute, 15 fps
`node tools/bench-traffic.mjs --only kaponiera --seed <seed> --dump` reproduced the following:

| Seed | km/h | stopped % | finished wait p90 / max s | held >60 / >120 s | deadlocks |
|---|---:|---:|---:|---:|---:|
| 1 | 13.2 | 50.0 | 44 / 118 | 25 / 0 | 1 |
| 2 | 11.3 | 55.9 | 50 / 145 | 27 / 10 | 0 |
| 7 | 11.8 | 53.0 | 49 / 155 | 28 / 6 | 1 |
| 99 | 12.1 | 53.2 | 42 / 89 | 21 / 0 | 1 |
| 5 | 11.7 | 54.7 | 45 / 83 | 32 / 5 | 2 |

The full all-district seed 1 run also completed and matched these seed 1 Kaponiera figures. The seed 1 overlap
audit completed with 6 pairs, one in Kaponiera. The eight-seed all-district benchmark and overlap audit were not
completed, so the eight-seed figures in the previous record have not been independently remeasured here. Since no
behavior changed, there is no measured after run. The historical eight-seed figures are 12.3 km/h, 52.2% stopped,
155 s worst finished wait, 169 s longest sampled hold, 167 held over 60 s, 21 over 120 s, 5 deadlocks, and 73
overlap pairs including 8 in Kaponiera. See [the previous record](kaponiera-traffic-2026-11-10.md) for other districts.

## Trace

`--trace x,z --trace-min 20` prints the lanes once per second. Positions below are lane coordinates in metres;
negative outgoing coordinates mean the vehicle is still in the connector. The east-side trace required a temporary
copy of the benchmark with its trace distance gate enlarged from 300 to 400 m; simulation and sampling were unchanged.

- Seed 2, `--trace -1497,198 --trace-min 100`: at t=217 lane 2 car 15 has waited 101 s for room at s=17.9/20.7,
  car 6 is at s=11.3 behind it, and car 41 is behind that at s=4.8. Downstream cars 25 and 39 occupy both lanes at
  s=7.3 and 7.2/10, waiting for the signal. At t=297–299 cars 10 and 15 occupy those two slots at s=7.2, both held by
  the signal; car 6 waits for the merge and car 41 behind it reaches 168 s. At t=300 its sampled hold reaches 169 s.
  This is a backed-up queue, not a reported wait-for cycle; its finished wait maximum is separately 145 s.
- Seed 7, `--trace -1468,118 --trace-min 20`: at t=120–123 car 83 is stopped in the connector, outgoing lane 1 at
  s=-4.9, behind a proxy at s=0.8; tram 10 at (-1469, 136) waits for car 83, reaching 89 s at t=123. Car 33 and bus
  203 queue in lane 2; car 62 waits at the downstream signal. At t=124 the proxy disappears and the connector starts
  clearing. The reported cycle lasts 89 s and the upstream box is blocked 83 s.
- Seed 5, same trace: at t=234–238 car 66 is stopped for room at s=7.3 on lane 0 of the 10 m approach to
  (-1468, 118). The outgoing lane has a tram proxy at s=0.3 and car 78 at s=7.3, stopped at the signal. Tram 13 at
  (-1456, 98) waits for car 66. The benchmark reports a 70 s cycle at t=300. This room refusal involves a real
  downstream queue as well as the proxy, so allowing the car to enter is not established to be safe.
- Seed 5, `--trace -1136,127 --trace-min 20` with the enlarged trace gate: at t=225 car 35 moves in the connector
  toward outgoing lane 2, at s=-4.7 behind a proxy at s=4.1, while tram 5 at (-1113, 136) waits for it. At t=226 the
  car stops at s=-3.7; at t=290–295 it remains there behind the proxy at s=3.0, while tram 5 at (-1116, 138) reaches
  a 66 s wait. Bus 202 and car 83 also occupy connectors/exit lanes alongside. The benchmark reports a 66 s cycle.
- Seed 99 reports a 59 s car 56 / tram 5 cycle at the same east-side box, at t=295. No separate per-second trace was
  completed for that seed; the similar position does not prove identical geometry.
- Seed 1 reports the known 89 s car 62 / tram 6 cycle at (-1503, 224) at t=292, with car 62 stopped in the box.
  The earlier record documents its per-second entry on green and proxy chain. A fresh per-second seed-1 trace was not
  completed in this investigation.

## Variants and limits

No new variant was tested or retained. The prior connector proxy-bypass trial changed the seed-1 two-body cycle to a
three-body cycle and left an 84 s box blockage; the room-behind-proxy trial had no effect. Their numerical results and
other rejected variants are in [the 2026-11-10 record](kaponiera-traffic-2026-11-10.md) and
[the 2026-11-08 record](kaponiera-traffic-2026-11-08.md). These observations do not establish a collision-safe fix,
and do not show that all possible fixes fail.

## Follow-up entry guard trial (interrupted at user request)

Candidate A changed `room()` in `js/traffic.js` to use the rear gap for any occupied exit under 12 m, including a tram
proxy, and changed `mayEnter()` to refuse a short link whenever `nextTramBlocked()` reports its next conflict, rather
than only when `shortLinkTramBlocked()` says the car cannot stand on the link. The two edits remain in the worktree
as an **unaccepted experiment**. Occupancy is built before cars drive, so proxies can be visible in `room()`; however,
`mayEnter()` returns early for a previously committed car. A proxy/reservation arriving after commitment can therefore
still catch it. The ordinary `roomCause` field is pedestrian-only; a car's refusal is `v.held` / `v.waitReason`.

Five-minute `--only kaponiera` results (baseline → A; finished wait p90/max in seconds):

| Seed | km/h | stopped % | p90 / max | held >60 | held >120 | deadlocks | longest sampled hold |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | 13.2 → 12.8 | 50.0 → 50.7 | 44/118 → 47/98 | 25 → 19 | 0 → 0 | 1 → 1 | 118 → 98 |
| 2 | 11.3 → 12.3 | 55.9 → 51.1 | 50/145 → 45/129 | 27 → 13 | 10 → 2 | 0 → 0 | 169 → 129 |
| 7 | 11.8 → 9.5 | 53.0 → 63.9 | 49/155 → 93/181 | 28 → 55 | 6 → 19 | 1 → 2 | see prior record → 181 |
| 5 | 11.7 → 11.0 | 54.7 → 56.2 | 45/83 → 52/121 | 32 → 32 | 5 → 1 | 2 → 0 | see prior record → 121 |
| 99 | 12.1 → 10.5 | 53.2 → 57.2 | 42/89 → 52/150 | 21 → 28 | 0 → 3 | 1 → 0 | see prior record → 150 |

Reject A: seed 7 adds 13 long holds and a deadlock; seed 99 adds three long holds. All-district seed 4242 adds two
Kaponiera holds over 120 s (0 → 2); Jeżyce seed 1 falls 16.0 → 12.8 km/h and 30.2 → 37.6% stopped, and seed 4242
falls 13.3 → 11.3 km/h and 37.1 → 43.8% stopped. The seed-1 overlap audit is 6 → 8 pairs, Kaponiera 1 → 1, Jeżyce
3 → 7. Candidate A audits completed for seeds 1/4242/7/99: total pairs 8/4/10/7, Kaponiera 1/1/0/1; seed 2 was
interrupted after three districts and is not a complete result. Candidate A all-district benchmarks completed for
1/4242/7/99; baseline all-district benchmarks completed for 1/4242/7/99/2. Eight-seed totals were not measured.
Raw results and a clean base snapshot are under `/tmp/kaponiera-followup/`, subject to temporary-file retention.

## Candidate B: release the road-car gate for a car queued behind the tram's proxy (retained as B3)

Diagnosis with a stderr trace of `t.obstacle` and its leader chain (seed 1, `bench-world.mjs` console silenced by
default, so the first debug log of B showed nothing and was misread as "never fires"): tram 10/6 waits for car 208, which
is in the (-1503, 224) connector at sweep `out` (outside the stopped-body envelope), whose leader is car 62 (also `out`),
whose leader is the tram's own road proxy. The tram's ordinary sweep (`obstacleGap(..., stopped=true)`) ignores both
cars, but the committed-road-car gate (`roadCarGate` in `drive`) still holds the tram on them, so the chain
tram -> car -> car -> proxy -> tram is a cycle. The same chain is the (-1468, 118) seed 7 cycle (car 83 / tram 10 / proxy)
and the (-1136, 127) seed 5 cycle. Seed 2 and the seed 5 car 66 room refusal are not this chain (no tram proxy leader).

Rule, `queuedBehindTram(v, t)` in `trams.js`: a gate candidate is skipped when it has stood still (`speed < 0.3`,
`wait >= 20` s), its leader is the tram or its proxy, or one stopped car whose leader is, and its own stopped body is
outside the swept envelope (`obstacleGap(..., stopped=true) === Infinity`). The earlier "leader is a proxy exemption"
in `docs/actors.md` was a no-op on a different tree and lacked the sweep and wait terms.

Variants (Kaponiera `--only kaponiera`, base -> variant: km/h, stopped %, held >60, held >120, deadlocks):

| Variant | Seed 1 | Seed 7 | Seed 5 | Seed 99 | Seed 2 |
|---|---|---|---|---|---|
| base | 13.2, 50.0, 25, 0, 1 | 11.8, 53.0, 28, 6, 1 | 11.7, 54.7, 32, 5, 2 | 12.1, 53.2, 21, 0, 1 | 11.3, 55.9, 27, 10, 0 |
| B1 direct leader, no wait | 13.2 (cycle stays: leader is a car) | 11.6, 53.9, 12, 0, 0 | not recorded | not recorded | unchanged |
| B2 leader or one stopped car, no wait | 13.6, 47.7, 10, 0, 0 | 11.6, 53.9, 12, 0, 0 | 11.8, 54.0, 26, 2, 1 | 11.9, 53.2, 15, 0, 0 | unchanged |
| B3 B2 and `wait >= 20` s | 13.6, 48.3, 16, 0, 0 | 13.6, 47.7, 9, 1, 0 | 11.7, 54.6, 31, 2, 1 | 12.1, 52.8, 16, 0, 0 | unchanged |

B2 over eight seeds: Kaponiera 12.3 -> 12.4 km/h, deadlocks 5 -> 1, held >120 21 -> 14, but the overlap audit rises
73 -> 79 (Kaponiera 8 -> 11, Jeżyce 47 -> 49, Centrum 11 -> 12): most new pairs have the tram moving at 5-6.5 m/s
(`tramWait curve`) past a car that the instant release exposed, so B2 is rejected. The 20 s wait keeps the rule to real
cycles (B3).

B3 over 8 seeds (1, 4242, 7, 99, 2, 3, 5, 11) x 7 districts x 5 min, base -> B3:

| District | km/h | stopped % | worst wait s | held >60 | held >120 | deadlocks | box stuck |
|---|---|---|---|---|---|---|---|
| Rondo Kaponiera | 12.3 -> 12.6 | 52.2 -> 51.3 | 155 -> 145 | 167 -> 133 | 21 -> 13 | 5 -> 1 | 3 -> 2 |
| Stare Miasto | 17.9 -> 18.0 | 7.8 -> 7.2 | 53 -> 37 | 0 -> 0 | 0 | 0 | 0 |
| Jeżyce / Łazarz / Centrum / Rataje / Wilda | identical | identical | identical | 21 / 0 / 13 / 6 / 1 unchanged | 0 | 0 | 4 / 0 / 0 / 2 / 0 unchanged |

Per seed Kaponiera (held >120): seed 7 6 -> 1, seed 5 5 -> 2, seed 2 10 -> 10, others 0; deadlocks: seeds 1, 7, 99 gone,
seed 5 2 -> 1. Seeds 4242, 2, 3, 11 are bit-identical to base. Eight-seed overlap audit: 73 -> 73 pairs (Kaponiera
8 -> 9: seed 7 gains 38:7 and 67:4 and loses 63:7; Stare Miasto 7 -> 6; others unchanged). The base was re-measured
(12.3 km/h, 52.2 %, 155 s, 167 / 21 / 5, 73 pairs), matching the record at 5e6a68e.

Remaining: seed 2's 10 holds over 120 s (a signal-red queue, no cycle), seed 5 car 66 / tram 13 (room refusal with a
real stopped car on the exit, 70 s), and seed 7's one hold.

Candidate A (above) is rejected. Raw runs: `/tmp/kaponiera-followup/`.
