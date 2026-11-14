# Kaponiera Seed 1 Boundary Queue (2026-11-14)

## Baseline on `eed1a16` (after `5015aa1`)

Running `tools/bench-traffic.mjs` across 8 seeds (`1 2 3 5 7 11 99 4242`) × 7 districts (5 min, 15 fps) on `eed1a16` shows **0 deadlocks** city-wide (all 56 district-seed runs). Since `5015aa1` ("Keep trams from spawning just short of a car already in the junction box"), Kaponiera seed 1's `waitMax` is `142 s` (down from `175 s` at the 2026-11-11 baseline) and seed 5 has `boxStuck = 0`:

| District | mean km/h | stopped % | worst hold | waitMax | held > 60 s | held > 120 s | deadlocks | boxStuck |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Jeżyce (Rynek Jeżycki) | 14.61 | 33.4% | 118 s | 85 s | 23 | 0 | 0 | 2 |
| Łazarz (Głogowska) | 14.60 | 25.4% | 39 s | 39 s | 0 | 0 | 0 | 0 |
| Centrum (Św. Marcin) | 14.25 | 33.9% | 58 s | 58 s | 0 | 0 | 0 | 0 |
| Rondo Kaponiera | 12.69 | 50.0% | 145 s | 142 s | 127 | 11 | 0 | 2 |
| Stare Miasto | 17.71 | 8.2% | 42 s | 42 s | 0 | 0 | 0 | 0 |
| Rataje (Rondo Rataje) | 17.32 | 34.5% | 70 s | 70 s | 3 | 0 | 0 | 2 |
| Wilda | 15.94 | 35.0% | 63 s | 63 s | 1 | 0 | 0 | 0 |

Per-seed Rondo Kaponiera (`eed1a16`):
- Seed 1: `mean 12.5 km/h`, `stopped 50.4%`, `waitMax 142 s`, `longestHeld 142 s`, `held >60 s 20`, `>120 s 3`, `deadlocks 0`, `boxStuck 0`
- Seed 2: `mean 14.1 km/h`, `stopped 45.6%`, `waitMax 118 s`, `longestHeld 117 s`, `held >60 s 9`, `>120 s 0`, `deadlocks 0`, `boxStuck 0`
- Seed 3: `mean 12.5 km/h`, `stopped 50.5%`, `waitMax 126 s`, `longestHeld 126 s`, `held >60 s 11`, `>120 s 1`, `deadlocks 0`, `boxStuck 0`
- Seed 5: `mean 10.3 km/h`, `stopped 57.9%`, `waitMax 138 s`, `longestHeld 145 s`, `held >60 s 30`, `>120 s 6`, `deadlocks 0`, `boxStuck 0`
- Seed 7: `mean 13.7 km/h`, `stopped 47.1%`, `waitMax 96 s`, `longestHeld 95 s`, `held >60 s 20`, `>120 s 0`, `deadlocks 0`, `boxStuck 0`
- Seed 11: `mean 12.8 km/h`, `stopped 49.9%`, `waitMax 98 s`, `longestHeld 98 s`, `held >60 s 10`, `>120 s 0`, `deadlocks 0`, `boxStuck 0`
- Seed 99: `mean 13.2 km/h`, `stopped 47.4%`, `waitMax 111 s`, `longestHeld 110 s`, `held >60 s 9`, `>120 s 0`, `deadlocks 0`, `boxStuck 1`
- Seed 4242: `mean 12.4 km/h`, `stopped 51.0%`, `waitMax 123 s`, `longestHeld 123 s`, `held >60 s 18`, `>120 s 1`, `deadlocks 0`, `boxStuck 1`

## Per-second Trace: Kaponiera Seed 1 `(-1174, 136) -> (-1136, 127)`

Junction `(-1136, 127)` sits `330.3 m` from Kaponiera `(-1464, 88)` (outside the `300 m` `bench-traffic.mjs` district radius, though `(-1174, 136)` queues inside `300 m` and `(-1136, 127)` prints in `--dump` with `stopped 1892 car-s, through 0, max wait 140 s`). Its signal plan is `cycle 65 s`, `green0 18 s` (eastbound `(-1174, 136)`, 3 lanes, `27.7%` split), `start1 23 s`, `green1 37 s` (southbound `(-1126, 93)`, 3 lanes).

Car `#11` in `(-1174, 136) -> (-1136, 127)` lane `l2` (length `16.2 m`) waits `153 s` (`T125..T278`) before clearing at `T278` (with `#63` behind it waiting `117 s`):

1. **`T125..T147` (`23 s`) — `signal` (`mayEnter` signal stage check):** `g0` is red.
2. **`T148..T165` (`18 s`, `g0` green) — `room` (`mayEnter` exit `room()` check):** `TRAM5` (line 17) is stopped on the curved track at `(-1133.4, 158.1)` (`stuck 4.9..45+ s`, `waitReason: room`, `leader: TRAM9` line 20 clearing the stop/signal ahead at `(-1066.3, 137.2)`). `TRAM5`'s body spans the `9.4 m` exit `(-1136, 127) -> (-1117, 132)` `l2` with a tram proxy at `s = 8.7/9.4`, leaving insufficient room for `#11` to clear. `TRAM5` clears at `T160..T165` right as `g0` ends.
3. **`T166..T212` (`47 s`) — `signal` (`mayEnter` signal stage check):** `g0` is amber/red/red-amber. During `g1` green (`T171..T207`), `#53` (`T176`) and `#68` (`T178`) enter from `(-1126, 93)` heading Straight to `(-1135, 173)` while `(-1135, 173)` is empty. At `T181`, `TRAM2` (line 5) arrives behind `TRAM5` on the curved track (`(-1136.1, 162.3)`, `waitReason: room`, `leader: TRAM5`), placing a tram proxy on `(-1135, 173)` `l0` (`s = 6.6/18.6`) and trapping `#53` (`cs = 44.15/45.85`) and `#68` (`cs = 38.55/46.61`, at `(-1135.8, 145.4)`, rear `z = 143.22`) inside the `(-1136, 127)` box.
4. **`T213..T230` (`18 s`, `g0` green) — `box` (`mayEnter` `boxBusy()` check):** `#68`'s rear at `z = 143.22` physically overlaps `west l2 -> east l2` (`z = 145.61`) and lies `1.23 m` from `west l1 -> east l1` (`z = 141.99`, within `width + 0.3 = 2.10 m`), while `west l0 -> east l0` (`z = 138.36`, `4.86 m` away) flows freely (`#211`, `#74`).
5. **`T231..T277` (`47 s`) — `signal` (`mayEnter` signal stage check):** `g0` is amber/red/red-amber. `TRAM2` clears at `T234`, and `#53`/`#68` clear the box by `T239`.
6. **`T278` — clears:** `g0` turns green and `#11` (`153 s`) and `#63` (`117 s`) enter and clear.

## Kaponiera Seed 5 Note (`eed1a16`)

On `eed1a16`, Kaponiera seed 5 has `boxStuck = 0` and `deadlocks = 0`. Its worst hold (`145 s`, `91%` `merge`) is at the 2-arm give-way `(-1497, 198)`, where 3 lanes on `(-1490, 170) -> (-1497, 198)` merge into 2 lanes on `(-1497, 198) -> (-1503, 224)`, alongside signal holds of `129 s` at `(-1136, 127)` and `135 s` at `(-1503, 224)`.

## Conclusion

No game code was changed. Both missed greens in Kaponiera seed 1 (`T148..T165` `room` behind a physical tram queueing for the `(-1066.3, 137.2)` stop/signal, and `T213..T230` `box` behind cross-traffic `#68` trapped by the following tram) are geometrically accurate `room` and `boxBusy` holds combined with `(-1136, 127)`'s `18 s / 65 s` (`27.7%`) `g0` capacity split — a capacity/tram-queue interaction rather than a logic hold.
