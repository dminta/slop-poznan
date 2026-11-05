# Car–tram overlap investigation (2026-11-04)

Measured with `tools/audit-tram-overlaps.mjs` (overlaps) and `tools/bench-traffic.mjs` (holds, deadlocks); see
[testing](../testing.md#cartram-body-overlap-audit). Five simulated minutes at 15 fps per district, seeds reset per district, first 20 s excluded. The benchmark world omits buildings and several scene details; pairs are pooled object IDs. A held conflict at entry does not establish whether the vehicle had committed earlier, and absence of a matching held conflict does not establish which geometry or prediction failed. These are observations, not a complete fault classification.

| District | Seed | Pair | First contact (s, x, z) | Matching conflict held by this tram at last observed entry |
|---|---:|---|---|---|
| centrum | 1 | 58:11 | 36, -598, 174 | No recorded entry |
| centrum | 1 | 18:18 | 237.1, -1080, -106 | Yes |
| centrum | 1 | 54:18 | 238.7, -1071, -109 | Yes |
| centrum | 1 | 44:11 | 290.1, -1126, 143 | No |
| centrum | 4242 | 53:11 | 61.5, -597, 62 | Yes |
| centrum | 7 | 28:20 | 157.7, -1125, 143 | No |
| kaponiera | 1 | 51:21 | 46.5, -1135, 128 | No |
| kaponiera | 1 | 209:7 | 90.3, -1385, -208 | Yes |
| kaponiera | 1 | 0:1 | 97.9, -1203, -150 | Yes |
| kaponiera | 1 | 36:11 | 149.1, -1434, 115 | No |
| kaponiera | 4242 | 200:1 | 36.6, -1388, -210 | Yes |
| kaponiera | 4242 | 38:1 | 94.1, -1211, -158 | No |
| kaponiera | 4242 | 202:4 | 258, -1506, 216 | Yes |
| kaponiera | 7 | 37:7 | 89.3, -1386, -217 | Yes |
| kaponiera | 99 | 206:1 | 33.9, -1382, -221 | No |
| kaponiera | 99 | 204:1 | 38.9, -1388, -210 | Yes |
| kaponiera | 99 | 14:7 | 88.7, -1386, -217 | Yes |

The original audit at `1eff3b4` found 17 pairs in these eight runs (the table above). Across all seven districts and
four seeds it found 49 pairs: 14 in Jeżyce, 6 in Centrum, 11 in Kaponiera and 18 in Stare Miasto. Łazarz, Rataje and
Wilda had none.

## What changed

- **Restart gate** (`js/trams.js`, `drive`): a tram under 1 m/s holds 0.5 m short of a mapped road conflict 0.2–5 m
  ahead while a car or bus is committed to that curve, on it, or still has its tail on it, unless that vehicle itself
  waits for a tram. Kaponiera seed 1 pair 51:21 is gone.
- **Opposing strip lane** (`js/road-network.js`, `clearOpposingStripTrack`): moves the inner of two lanes 2.5 m clear of
  a one-way street track running against it along the whole edge, keeping the lanes ≥ 2.6 m apart. Only edge 7500
  (Półwiejska southbound, offset 1.45 → 2.34 m) moves; `tools/audit-tram-opposing-lanes.mjs` lists 61 → 60 lanes,
  753 → 668 m of close runs (65 → 64 directed runs). Centrum seed 1 pair 58:11 is gone.

## Eight-seed results

Seeds 1, 4242, 7, 99, 2, 3, 5 and 11, five minutes per district at 15 fps. Each cell is mean longest car hold (s) /
cars held over 60 s / over 120 s / deadlocks / overlapping car–tram pairs, summed over the eight seeds (the hold is the
mean of the eight longest holds). Baseline is `1eff3b4`; final is the lane correction plus the 5 m gate.

| District | Baseline | Final |
|---|---|---|
| Jeżyce | 78.3 / 29 / 0 / 0 / 29 | 77.9 / 27 / 0 / 0 / 28 |
| Łazarz | 31.9 / 0 / 0 / 0 / 0 | 31.9 / 0 / 0 / 0 / 0 |
| Centrum | 82.8 / 26 / 0 / 0 / 11 | 77.8 / 21 / 1 / 0 / 10 |
| Kaponiera | 122.3 / 144 / 14 / 1 / 19 | 116.9 / 134 / 8 / 1 / 13 |
| Stare Miasto | 29.1 / 0 / 0 / 0 / 29 | 32.3 / 2 / 0 / 0 / 22 |
| Rataje | 71.1 / 9 / 2 / 0 / 1 | 71.1 / 9 / 2 / 0 / 1 |
| Wilda | 39.0 / 0 / 0 / 0 / 0 | 39.0 / 0 / 0 / 0 / 0 |
| **Sum** | 3635 s / 208 / 16 / 1 / **89** | 3574 s / 193 / 11 / 1 / **74** |

The original eight runs go 17 → 12 pairs, and the seven districts on four seeds 49 → 40. Variants measured the same way
(sum of longest holds / held over 60 s / over 120 s / deadlocks / pairs):

| Variant | Sum |
|---|---|
| Baseline | 3635 / 208 / 16 / 1 / 89 |
| Lane correction only | 3620 / 205 / 17 / 1 / 81 |
| Lane correction + 10 m gate | 3630 / 221 / 21 / 1 / 70 |
| Lane correction + 5 m gate (kept) | 3574 / 193 / 11 / 1 / 74 |

The 10 m gate removed the most pairs but was rejected: Jeżyce went 29 → 59 cars held over 60 s and 0 → 2 over 120 s
(seed 99 longest hold 82 → 120 s, seed 11 79 → 120 s), and Jeżyce seed 2 gained a car–tram wait cycle at `−2023, −448`
(car #22 in the box, waiting for the tram on line 2 that the gate held for it, 89 s). Its total stayed at one deadlock
only because Kaponiera seed 1's baseline cycle disappeared.

Single-seed outliers of the kept change, all from simulations that diverge once the network or tram behaviour changes:

- **Kaponiera seed 1** longest hold 133 → 154 s, over 120 s 4 → 6. Its one deadlock moved from the baseline's tram 2 ↔
  car #16 at `−1476, 83` to car #7 (waiting for a tram) ↔ the line 6 tram (waiting for that car in its ordinary sweep)
  at `−1503, 224`. An instrumented rerun showed the restart gate inactive for that tram from 84.7 s until 197 s,
  after the cycle had formed, so it is the pre-existing sweep cycle at a new place.
- **Stare Miasto seed 3** longest hold 21 → 77 s (two cars over 60 s), a give-way queue of 9 at `287, −89`, root cause
  "queue moving"; the lane correction alone gives the same numbers.
- **Centrum seed 3** longest hold 118 → 129 s (one car over 120 s), also identical with the lane correction alone.

## Rejected variants

- Forcing a stop on tram refusal at the entry line left the original eight-run total at 17; narrowing the
  ahead-of-tram exemption raised it to 18.
- Keeping the forecast while a tram was moving and braking for a car reduced the eight runs 17 → 11 and all districts
  on four seeds 49 → 44, but introduced a Jeżyce seed 7 car–tram wait cycle and raised the Kaponiera seed 99 longest
  hold 103 → 132 s. Extending it only for short signal approaches kept the hold and deadlock metrics but left 17 pairs.
- A bus pre-entry guard for the Kaponiera hotspot below (stop a bus that cannot otherwise stop before a refused
  conflict) raised the Jeżyce seed 99 longest hold 82 → 125 s and is not in the code.
- The 10 m restart gate (above).

## Traced mechanisms

- **Kaponiera, seed 4242, bus 200 / tram 1 (not fixed)**: IDs 200–211 are the 12 buses. Bus 200 is articulated, with
  simulation half-length 9 m and half-width 1.3 m. It committed to edge 321's 42.48 m connector at 25.13 s; tram 1's
  conflict on the following edge was acquired by 26.07 s. At 35.2 s the bus left that connector at 8.9 m/s for edge
  7343, 10 m long, its front less than 1 m from the next stop line. At 35.267 and 35.333 s `mayEnter` refused the
  matching conflict as `tram`; at 35.333 s `enter` accepted it anyway through its `speed >= 4` fallback (bus 7.7 m/s,
  tram 5.6 m/s). The conflict curve exists and is held, and the first OBB overlap is at 36.6 s (bus 8.4 m/s, tram
  6.1 m/s). The headless audit represents each bus by its simulation OBB, including an articulated bus as one 18 m
  rectangle; it does not model its trailer's independent angle.
- **Kaponiera, seed 1, car 51 / tram 21 (fixed by the restart gate)**: the tram stood for exit room 4.02 m before a
  mapped conflict and released its forecast. The car committed at 41.667 s and entered at 42.4 s. The tram restarted
  and held the conflict by 45 s, after the car was committed. Its present-position sweep first reported the laterally
  approaching car at 46.533 s, after the first OBB overlap at 46.5 s.
- **Centrum, seed 1, car 58 / tram 11 (fixed by the lane correction)**: the car waited on edge 7500 in an opposing
  lane, about 1.9 m laterally from the track, with tram 11's proxy as its leader. The tram deliberately ignores oncoming
  cars in its forward sweep, so it restarted into the stationary car. The proxy is deliberately inserted for
  opposite-direction track runs to stop cars entering them; deleting it would instead send the car toward the tram.

## Short-link bus guard (2026-11-04 follow-up)

The Kaponiera bus hotspot was traced further: bus 200 committed at 25.13 s while tram 1 stood at a curve 10 m before
the next conflict. The conflict became held at 25.6 s, after the bus had committed, and its front reached the 10 m
link 7343 with d = 1 m, so it could not stop before that link's far line. The `enter` fallback then accepted the
refused conflict above 4 m/s. `mayEnter` now checks the connector out of a link shorter than the bus body from the
upstream approach, but only for a committed bus and only while the tram is within 16 m of that curve; the >4 m/s
fallback still stops a bus on a short link if a tram body is already over the curve.

Eight seeds, five minutes, 15 fps, all seven districts; same benchmark world as above. Cells are mean longest hold
(s) / cars held over 60 s / over 120 s / deadlocks / overlap pairs, summed over the eight seeds. Baseline is the
previous HEAD (49e11a6), not the older `1eff3b4` columns above.

| District | Baseline | Guard |
|---|---|---|
| Jeżyce | 77.9 / 27 / 0 / 0 / 28 | 74.4 / 31 / 0 / 0 / 18 |
| Łazarz | 31.9 / 0 / 0 / 0 / 0 | 31.9 / 0 / 0 / 0 / 0 |
| Centrum | 77.8 / 21 / 1 / 0 / 10 | 77.8 / 22 / 1 / 0 / 10 |
| Kaponiera | 116.9 / 134 / 8 / 1 / 13 | 118.6 / 119 / 6 / 0 / 10 |
| Stare Miasto | 32.2 / 2 / 0 / 0 / 22 | 28.5 / 2 / 0 / 0 / 26 |
| Rataje | 71.1 / 9 / 2 / 0 / 1 | 71.1 / 9 / 2 / 0 / 1 |
| Wilda | 39.0 / 0 / 0 / 0 / 0 | 39.0 / 0 / 0 / 0 / 0 |
| **Sum** | 446.75 s / 193 / 11 / 1 / **74** | 441.25 s / 183 / 9 / 0 / **65** |

The Kaponiera hotspot pairs 200:1 (seed 4242), 206:1 and 204:1 (seed 99) are gone; seeds 7, 2, 5 and 11 keep their
baseline numbers or swap them for late car pairs. The Stare Miasto 22 → 26 rise is late in the run (seeds 7 and 11
2 → 4, seed 5 1 → 2, all after 200 s) and is car-only; bus timings shift the later trajectories, so it is not a new
bus–tram mechanism. Kaponiera's mean hold rises 1.5% while both held counts fall; seed 2's 115 → 141 s peak is a
give-way merge queue at `−1497, 198`, not the guarded junction. Rejected variants: a generic guard for every
committed vehicle and a 16 m hard-stop reach reduced pairs to 50 but raised Kaponiera to 134.2 s mean / 16 cars over
120 s; the upstream guard without the commit check had the same regression. The generic high-speed fallback for cars
outside the short-link case is still open.

Browser check: the hard stop in `enter` sets speed to 0 from above 4 m/s, a visible jolt chosen over a tram body
overlap; watch a guarded bus at Kaponiera.

## What remains

The final audit's 74 pairs, grouped by 25 m cell (pairs / of them buses): Jeżyce `−2050, −450` 11 / 5, `−1875, −400`
7 / 3, `−2025, −450` 4 / 4; Stare Miasto `−225, −150` 8 / 0, `275, −250` 5 / 0; Kaponiera `−1375, −225` and
`−1400, −200` 7 / 4 (the bus hotspot above, seeds 1, 4242, 7, 99); Centrum `−1125, 150` 4 / 0; the rest are one to
three pairs each. 23 of the 74 are buses. 51 vehicles were on a connector at first contact, and for 44 of them the
overlapping tram held that connector's conflict, so most remaining cases are entries into a curve the tram had already
reserved (the `enter` fallback above, or a commitment made before the reservation), not missing conflicts. The
short-link bus guard above takes the total to 65. Open:

- the generic high-speed entry fallback in `enter` that accepts a refused tram conflict above 4 m/s for cars outside
  the short-link bus case (the guarded bus stops at the line);
- the other 60 opposing close lanes (64 runs, 668 m) from `tools/audit-tram-opposing-lanes.mjs`, which the
  correction's conditions do not cover: 49 runs are 10 m or shorter; the longest is 71 m on edge 7930 at `−865, 978`
  (down to 0.02 m from the track);
- the Jeżyce, Stare Miasto and Centrum clusters above, not yet traced.

## Oncoming exemption fix (2026-11-05)

The largest traced mechanism was not the `enter` fallback: in Stare Miasto, `heldByTram` exempted a car that projected
ahead of the tram's nose in world space even when it was oncoming and approaching the same conflict from another arm. The
tram's `drive()` ignores cars facing it, so the tram drove into the exempted car. The exemption now requires the car to
travel the tram's way (heading dot above 0.2) unless the tram is farther than 8 m from the conflict, which keeps distant
tram-stop queues out of the change. `inTramLane` keeps its own exemption.

Eight seeds (1, 4242, 7, 99, 2, 3, 5, 11), five minutes, 15 fps, all seven districts; same benchmark world as above. Cells
are mean longest hold (s) / cars held over 60 s / over 120 s / deadlocks / overlap pairs, summed over the eight seeds.
Baseline is HEAD `313bb33`.

| District | Baseline | Final |
|---|---|---|
| Jeżyce | 74.4 / 31 / 0 / 0 / 18 | 74.4 / 31 / 0 / 0 / 18 |
| Łazarz | 31.9 / 0 / 0 / 0 / 0 | 31.9 / 0 / 0 / 0 / 0 |
| Centrum | 77.8 / 22 / 1 / 0 / 10 | 81.0 / 24 / 1 / 0 / 9 |
| Kaponiera | 118.6 / 119 / 6 / 0 / 10 | 118.6 / 119 / 6 / 0 / 10 |
| Stare Miasto | 28.5 / 2 / 0 / 0 / 26 | 27.4 / 0 / 0 / 0 / 14 |
| Rataje | 71.1 / 9 / 2 / 0 / 1 | 71.1 / 9 / 2 / 0 / 1 |
| Wilda | 39.0 / 0 / 0 / 0 / 0 | 39.0 / 0 / 0 / 0 / 0 |
| **Sum** | 441.3 s / 183 / 9 / 0 / **65** | 443.4 s / 183 / 9 / 0 / **52** |

Centrum's mean rises 3.2 s and held >60 by 2 (seed 7 longest hold 61 → 87 s); its single >120 s car and the Kaponiera
hotspot are unchanged. The seed 7 rise is a divergence of the random sequence, not a car held by a tram: logging every
frame where the new rule changes a decision in Centrum seed 7 finds exactly one (t 49.8 s, a car at (−600, 49), heading
dot −0.98), about 500 m from the known signal/merge junction at (−1117, 132) where the 87 s car waits. The Stare Miasto pair count falls 26 → 14. A contact-frame classifier over the 65 baseline pairs
groups them as: 28 moving vehicles ≥4 m/s with the matched conflict held (17 after), 17 stopped with no matched conflict
(15), 10 stopped on a connector with a matched conflict (12), 5 slow (1–4 m/s), 3 moving with no matched conflict (1) and
2 moving with the curve not held at contact (0). The categories move by a pair or two because later trajectories diverge;
the clear change is the Stare Miasto oncoming cluster.

### Rejected variants measured on the way

- **Tram-body hard stop for every vehicle** (drop the bus/short-link test in `enter` and stop whenever a refused
  `v.held === 'tram'` has a body already over the next curve): the three hot districts (Centrum, Kaponiera, Stare
  Miasto) go 46 → 20 pairs, but Kaponiera's mean longest hold rises 118.6 → 140.0 s and cars held over 120 s 6 → 20
  (sum 468.8 s / 222 / 23). Limiting it to links under 12 m still gives Kaponiera 134.5 s / 147 / 15.
- **Forecast guard for every vehicle entering a short link** (refuse at the upstream line while a tram holds the curve
  beyond, with the connector length added to the 16 m reach; with or without the committed branch): the three districts
  go 46 → 19 and 46 → 18 pairs, but the sums rise to 516.6 s / 359 / 41 / 4 deadlocks and 504.4 s / 277 / 22 / 5
  deadlocks; Kaponiera alone reaches 153.1 s / 212 / 32 / 4. Guarding only cars that cannot physically stop on the link
  still gives 456.4 s / 216 / 16 / 1 and 12 Kaponiera pairs.
- **Broader oncoming rule** (no 8 m close gate, or requiring same direction for the whole exemption): the three
  districts go 46 → 33–35 pairs, but Kaponiera's mean stays 124–125 s and held over 120 s rises 6 → 10. The close gate
  is what keeps the hold metrics at baseline.

## Kaponiera regression and fix (2026-11-05)

The buffer spawn gate of `7566c2a` was measured again over the same 8 seeds and 7 districts (5 min, 15 fps). It was
the gate's side effect on the tram random sequence, not its edge-queue purpose, that hurt: extending every spawn's
path to 200 m with `rand` shifted every later spawn. Reverting only the gate restored Kaponiera in the verifier's
bisect; varying the tram seed at `7566c2a` also moved Kaponiera's longest hold per seed between 107 and 138 s, while
`907b555` has no injectable tram seed (always 1922). The gate is now limited to free-ending detail-box stubs and peeks
without drawing tram random numbers (see [tram-edge-jams](tram-edge-jams-2026-11-04.md#v3-fix-2026-11-05-the-gate-only-where-it-is-needed)).

The new tram mix exposed a real car-in-the-box ↔ tram cycle at Kaponiera's `-1468, 118` link (line 10 at
`(-1469, 136)`, car at `(-1468, 118)`) in seeds 1, 7 and 5, ~90 s each, plus exit-signal pairs at `-1503, 224`. The
root fix, all in `js/trams.js` / `js/traffic.js`:

- **Crossing proxy pad**: a lane proxy on a crossing is (tram 1.2 + car 0.92 m) × sin + 0.5 m long, so a car stopped
  at its edge clears the tram body; it was stopping 0.1 m inside it.
- **Stopped or slow cars in a crossing stretch** (< 1 m/s, or already past the tram's body part) get no proxy, so they
  can clear; the tram brakes for their bodies. A moving car entering keeps the proxy: the first version dropped it for
  every overlap and cars at 3.5–8.7 m/s drove into a tram leaving its stop at `-1469, 114` (seeds 99, 3 and 11).
- **Stopped vehicles in the tram sweep** are tested against their actual rectangle in 0.5 m steps, not the moving-car
  projection; a stopped car or bus standing clear no longer holds the tram. Reverting it brings back the seed 5 and
  seed 3 Kaponiera cycles and raises the per-seed holds.
- A **stopped tram** (`speed < 0.1`) reaches only 0.5 m past its nose in lanes running its way, not the usual 4 m +
  1 s, so a left-turner finishing in the box is not held by a phantom stretch of tram. It matters at Kaponiera:
  reverting only it gives 137.8 s mean and 17 cars over 120 s; Jeżyce is bit-identical.
- **Rejected**: exempting a vehicle whose last leader is a tram proxy from `_roadCarGate`. Reverting it left all 16
  Jeżyce/Kaponiera runs bit-identical, so it was dropped; the release comes from the stopped-body sweep.

`tools/bench-traffic.mjs` now follows the actual held conflict for a `'tram'` wait: a tram that is itself waiting for
the car (`t.obstacle === v`) is exempt in `mayEnter`, and only conflicts stamped in the current frame count. Without
that, a car blocked by a third tram's body was reported as a cycle with the tram waiting for the car. The change moves
no baseline deadlock count (907b555 0, 7566c2a 3). The skip is the `heldByTram` exemption only; `tramRefusedClose`, the
short-link bus guard in `enter`/`mayEnter`, calls `heldByTram` with `exempt = false`, so a bus cycle through that guard
would still be followed (and would be a real cycle).

Eight seeds (1, 4242, 7, 99, 2, 3, 5, 11), five minutes, 15 fps, all seven districts; same benchmark world as above.
Cells are mean longest hold (s) / cars held over 60 s / over 120 s / deadlocks / overlapping car–tram pairs (pairs with
the car moving over 1 m/s at first contact in brackets), summed over the eight seeds. Baselines re-measured with the
corrected deadlock follower.

| District | 907b555 | 7566c2a | Fixed |
|---|---|---|---|
| Jeżyce | 74.4 / 31 / 0 / 0 / 18 (4) | 72.3 / 32 / 2 / 0 / 22 (7) | 83.8 / 51 / 1 / 0 / 20 (7) |
| Łazarz | 31.9 / 0 / 0 / 0 / 0 (0) | 30.1 / 0 / 0 / 0 / 0 (0) | 31.9 / 0 / 0 / 0 / 0 (0) |
| Centrum | 81.0 / 24 / 1 / 0 / 9 (5) | 82.5 / 30 / 0 / 0 / 8 (7) | 77.5 / 13 / 2 / 0 / 7 (3) |
| Kaponiera | 118.6 / 119 / 6 / 0 / 10 (8) | 163.5 / 205 / 49 / 3 / 20 (10) | 114.9 / 138 / 8 / 0 / 11 (9) |
| Stare Miasto | 27.4 / 0 / 0 / 0 / 14 (8) | 25.6 / 0 / 0 / 0 / 9 (6) | 26.9 / 0 / 0 / 0 / 16 (13) |
| Rataje | 71.1 / 9 / 2 / 0 / 1 (0) | 80.3 / 15 / 1 / 0 / 3 (0) | 71.1 / 9 / 2 / 0 / 1 (0) |
| Wilda | 39.0 / 0 / 0 / 0 / 0 (0) | 39.0 / 0 / 0 / 0 / 0 (0) | 39.0 / 0 / 0 / 0 / 0 (0) |
| **Sum** | **3547 / 183 / 9 / 0 / 52 (25)** | **3946 / 282 / 52 / 3 / 62 (30)** | **3560 / 211 / 13 / 0 / 55 (32)** |

Kaponiera is better than `7566c2a` on every hold count and has no deadlocks; against 907b555 it is 3.7 s lower on the
mean and has 2 more cars over 120 s. The new Kaponiera cluster at `-1470, 114` (cars at 3.5–8.7 m/s into the line 10
tram leaving its stop) is gone: the 1 m/s rule leaves only cars already at 0.5 m/s there. Pairs with a car moving over
1 m/s are 32 against 25 at 907b555. The extra seven are not the new crossing rule (it did not change any moving pair
outside Kaponiera): Stare Miasto 8 → 13 and Jeżyce 4 → 7 are more occurrences of the same pre-existing sites, e.g.
Stare Miasto `-187, 305` (four seeds), `-128, -278` (two), `-295…-298, -174` and `284…296, -245`, some of them cars
entering a curve the tram is not holding (the short-link blind spot). They are phase-shifted by the load-bearing pad and
stopped-body changes: reverting only the pad leaves Stare Miasto at 10 moving pairs, only the `near` rule at 11, only
the stopped-body test at 12, but each of those brings back Kaponiera deadlocks or long holds.

The remaining per-seed outliers are not this change: Jeżyce 99 (129 s) and 5 (103 s) are a tram → car → pedestrian →
tram gridlock (tram 20 waits for bus #210 and tram 2 for car #4, both wait for people frozen mid-crosswalk at v = 0 by
`tramRoom`/`tramNear` next to the two stopped trams; it clears only when the tram respawns after 90 s). The same paired
line 20 / line 2 holds of 70–89 s at `-2105…-2040` occur in 907b555 seeds 4242 and 2 and 7566c2a seeds 2, 3 and 99, so
it predates this work; the Jeżyce aggregate shift is phase divergence. Centrum 3 (182 s) is the known merge queue at
`-1117, 132` (the open merge-hold work), and Rataje 4242 (186 s) is unchanged from both baselines.

## What remains after 2026-11-05

The 52 pairs of the oncoming-exemption build (before the Kaponiera fix above; the current audit finds 55) split into: Kaponiera 10 and Centrum 4 of the 17 moving entries into a held curve, almost all on the
10 m links at `−1386, −217` and `−1125, 143`; 27 cars already stopped in or near the tram envelope (Jeżyce mostly buses);
and the Jeżyce `−2050, −450` bus cluster. The short-link blind spot for cars needs a solution that does not hold the
upstream junction box; the forecast and hard-stop variants above all traded the collisions for long Kaponiera holds or
deadlocks. The 60 opposing close lanes (64 runs, 668 m) from `tools/audit-tram-opposing-lanes.mjs` are unchanged.
