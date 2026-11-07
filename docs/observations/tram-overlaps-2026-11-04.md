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
deadlocks. The 60 opposing close lanes (64 runs, 668 m) from `tools/audit-tram-opposing-lanes.mjs` are unchanged at this point; the next section corrects them.

## Opposing-lane clearance against the real track pair (2026-11-05)

`tools/audit-tram-opposing-lanes.mjs` at HEAD `7566c2a` listed **64 runs on 60 lanes (668 m)** where a car-lane
centreline runs under 2.3 m from a tram track used by trams in the opposite direction. The Półwiejska correction
(edge 7500) was the only earlier fix. This pass adds `clearOpposingTracks` in `js/road-network.js`, run after stop
lines are placed, and then places the moved edges at their bends and those neighbours again so the new offsets get the
bend setbacks they need.

- On right-hand running the left track of a parallel pair is oncoming; a one-way piece pointing against the edge is
  oncoming; a two-way piece with no partner may be either way.
- Where a lane stays within 2.3 m of such a track for at least 10 m, all lanes of the edge move together, keeping
  their spacing, by the least delta that clears every oncoming track over its close run. A directed edge on a two-way
  link keeps its lanes on its own side of the centreline. The result must stay on the car part of the carriageway (a
  tram strip is not road for cars) and pass `laneOpen` for every shifted lane.
- The re-check also rejects a lane that lands on or beside a same-direction track on a tram-strip road (not a shared
  tram lane), a move on an edge under 12 m, and a move that would make a straight connector steeper than the
  base's.

### Classification at the repaired base `a302005`

| Group | Runs | Lanes | Length | Examples (world metres) |
|---|---:|---:|---:|---|
| Moved by the rule | 2 | 2 | 42 m | Głogowska 3015 (+0.66 m), Małopolska 3201 (−0.11) |
| Remaining: short junction/shared-tram stubs | 42 | 40 | 284 m | 305 at `−1823, −3`; 4336/4337 at `−2051, −459`; 5758 at `−2043, −433`; Fredry 197/424 at `−850, 0…30`; Centrum 6020/6034 at `−1137, 154` |
| Remaining: track curving across the straight run | 3 | 3 | 41 m | Roosevelta 1840 at `−1363, −341 → −1352, −380`; Winogrady 4100 at `−708, −1476 → −696, −1500` |
| Remaining: a constant shift cannot work | 3 | 3 | 104 m | Głogowska 4257; the 4677 link at `−35, 520`; Wierzbięcice 7930 |
| Remaining: off-street / grade-separated track | 8 | 8 | 161 m | Most Chrobrego 3096/3097/3098 at `481, 623 / 466, 613 / 455, 600`; 6273 at `−1274, −533`; 8178 at `891, −2156` |
| Remaining: track no route uses | 6 | 4 | 36 m | Kraszewskiego 5757; Głogowska 3422 at `−2707, 2062`; Głogowska 4227 at `−2869, 2299` |

The short-stub group is left to the junction curves and tram proxies: the remaining excursions are 5–9 m at junctions
where the tracks fork too ambiguously to choose a safe direction. The off-street pieces have their own formation
(`street: 0`), and the six unserved pieces are depot/junction track no `route=tram` relation uses.

The constant-shift cases are left listed rather than forced:

- **4257, Głogowska at `−2987, 2475`, 20 m.** The edge bends at both ends; the +2.34 m shift needed to clear the
  opposing track makes a 22.4° straight connector in the review's curbs/medians network, against 19.3° at the base.
  Re-placing the stop lines does not absorb it, so the lane stays where it is.
- **4677, `−35, 520`, 13 m.** This is a tram-strip road; the +0.44 m shift would leave the lane within 2.3 m of the
  same-direction track, which the re-check rejects.
- **7930, Wierzbięcice at `−865, 978`, 71 m.** The merged one-way pair is skewed about 3.3° against the corridor: the
  opposing track runs from −0.8 to +3.6 m across the edge, the same-direction track from +1.9 to +7.0 m, and the right
  curb drifts from about +7.5 to +11.2 m. A constant +4.12 m shift clears the opposing track but sits on the
  same-direction track from s ≈ 55 m and only about 1.6 m from the right curb at s = 0. Fixing it needs the source
  centreline/skew or a per-station lateral offset, not a constant lane offset; it stays in the audit.

### Lane moves

| Edge | Place | Before | After | Delta |
|---:|---|---|---|---:|
| 3015 | Głogowska, `−1601, 653` | [−5.40, −1.80, 1.80, 5.40] | [−4.74, −1.14, 2.46, 6.06] | +0.66 |
| 3201 | Małopolska, `−2080, −1625` | [−1.45] | [−1.56] | −0.11 |

No edge or lane is lost: the furnished headless network stays at 8,707 edges, 11,568 lanes and 442.1 directed lane-km,
and `paintEdges` carries the new lane arrays (the paint regression checks this). The curbs/medians check finds 165
straight moves over 15° before and after, with no new connector; `tests/shared-tram-lanes.test.cjs` pins that.

### Rejected Rynek Jeżycki moves

Moving the two-way shared stubs 4336/5758 would fix more of the audit, but on `a302005` it trades lane clearance for
traffic. Jeżyce over the eight seeds (sum longest hold / held over 60 s / over 120 s / deadlocks / pairs [moving >1]):

| Variant | Jeżyce result | Total |
|---|---|---|
| Base `a302005` | 670 / 51 / 1 / 0 / 20 (7) | 3560 / 211 / 13 / 0 / 55 (32) |
| 4336 + 5758 | 546 / 21 / 0 / 1 / 21 (13) | 3433 / 181 / 12 / 1 / 56 (38) |
| 5758 only | 546 / 21 / 0 / 1 / 21 (13) | not run for all districts |
| 4336 only | 687 / 55 / 3 / 0 / 17 (9) | not run for all districts |
| 4336 + 5757 + 5758 | 494 / 6 / 0 / 0 / 27 (17) | not run for all districts |

The first two cut Jeżyce's mean hold but raise its overlap pairs from 20 to 21 and moving pairs from 7 to 13, and add
a deadlock. 4336 alone makes the holds worse. All three make the pairs worse. None is in the code; the two lanes that
remain are documented in the classification table.

### Eight-seed results at `a302005`

Seeds 1 / 4242 / 7 / 99 / 2 / 3 / 5 / 11, five simulated minutes per district at 15 fps, same headless world and
update order as `tools/bench-traffic.mjs` and `tools/audit-tram-overlaps.mjs`. Each cell is the mean longest car hold
over the eight seeds (s) / cars held over 60 s / over 120 s / deadlocks / overlapping car–tram pairs, summed over the
eight seeds.

| District | Base `a302005` | With the lane moves |
|---|---|---|
| Jeżyce | 83.8 / 51 / 1 / 0 / 20 | 83.8 / 51 / 1 / 0 / 20 |
| Łazarz | 31.9 / 0 / 0 / 0 / 0 | 31.5 / 0 / 0 / 0 / 0 |
| Centrum | 77.5 / 13 / 2 / 0 / 7 | 77.5 / 13 / 2 / 0 / 7 |
| Kaponiera | 114.9 / 138 / 8 / 0 / 11 | 114.9 / 138 / 8 / 0 / 11 |
| Stare Miasto | 26.9 / 0 / 0 / 0 / 16 | 26.9 / 0 / 0 / 0 / 16 |
| Rataje | 71.1 / 9 / 2 / 0 / 1 | 71.1 / 9 / 2 / 0 / 1 |
| Wilda | 39.0 / 0 / 0 / 0 / 0 | 39.0 / 0 / 0 / 0 / 0 |
| **Sum** | **3560 / 211 / 13 / 0 / 55** (32 moving) | **3557 / 211 / 13 / 0 / 55** (32 moving) |

Only Łazarz changes (mean 31.9 → 31.5 s); the other six districts are identical, and the overlap pairs and their
moving subset are unchanged. The earlier 62-pair baseline at `7566c2a` is not comparable to the repaired base.

Limits: this is the headless benchmark world; it omits the city-grid sidewalks, buildings, landmarks and bridge
colliders, and no browser check was run. The lane paint follows the corrected offsets in `paintEdges`, but the rendered
markings and lane positions at Głogowska and Małopolska still need a visual check. The lane-direction inference in
`road-network.js` is geometric and can disagree with the tram graph at a fork; the audit and its regression are the
backstop.

## Rear-end proxy and short-stub pass (2026-11-07)

Measured on the current tree (`10b4594`), not on the older `a302005` baseline above: the merge moved vehicle and tram
sequences, so its absolute pair counts are higher. Method is unchanged: `tools/audit-tram-overlaps.mjs`, seeds 1, 4242,
7, 99, 2, 3, 5 and 11, five simulated minutes at 15 fps, all seven districts, first 20 s excluded. Baseline was a clean
worktree at `10b4594`; the flow check is `tools/bench-traffic.mjs --minutes 5 --only jezyce,centrum`.

### Fix: keep the proxy for an obstacle outside the sweep

`occupyTrams` skipped the whole lane proxy as soon as the tram was braking for its `t.obstacle`, even when that vehicle
was far ahead. A tram waiting behind a queue therefore had no proxy under its own body, and following cars and buses
rear-ended it in shared lanes. In the seed 4242 Jeżyce run, eight pairs rear-ended a stopped tram, all eight moving over
1 m/s and all with `tramWait = car`; six sat in the `-2210…-2154, -517…-493` cluster on the one-lane shared tracks
7508/7509, the other two at `-2100, -277` and `-1997, -443`. The obstacle check now runs only after the car is known to
overlap the proxy span; the proxy then stops the follower at the tram body. A vehicle the tram is already braking for
inside the sweep keeps its exemption, so the car-in-the-box release is unchanged.

### Eight-seed result

Cells are overlap pairs / of them with the car moving over 1 m/s at first contact (the audit rounds the recorded speed
to 0.1 m/s). The full event list has 27 stopped
pairs (v < 0.5 m/s) after the change against 24 before.

| District | Baseline | Final |
|---|---|---|
| Jeżyce | 83 / 70 | 31 / 17 |
| Łazarz | 0 / 0 | 0 / 0 |
| Centrum | 24 / 20 | 8 / 5 |
| Kaponiera | 16 / 11 | 17 / 11 |
| Stare Miasto | 12 / 9 | 12 / 8 |
| Rataje | 3 / 0 | 3 / 0 |
| Wilda | 0 / 0 | 0 / 0 |
| **Sum** | **138 / 110** | **71 / 41** |

Per seed, Jeżyce falls 6/8/12/8/11/13/17/8 → 2/2/6/2/5/5/4/5 and Centrum 3/1/5/0/12/1/1/1 → 3/0/1/0/3/0/1/0.
Kaponiera is the only district that moves the wrong way, and only by one pair: seed 99 goes 2 → 4 while seeds 3 and 11
improve or hold; the extra pairs are the same short-link commitment race described below, not the proxy change. Stare
Miasto and Rataje are unchanged.

### Flow

Seed 1, five minutes. The change moves no deadlock and no car-over-120 s bound:

| District | Baseline | Final |
|---|---|---|
| Jeżyce mean / stopped / longest hold / deadlocks | 16.0 km/h / 27.1% / 32 s / 0 | 15.7 / 28.3% / 36 s / 0 |
| Centrum mean / stopped / longest hold / deadlocks | 13.9 km/h / 34.9% / 62 s / 0 | 13.9 / 34.9% / 62 s / 0 |

At seed 4242, both trees keep the same pre-existing Jeżyce pedestrian-box cycle at `(-2069, -470)` (89 s, car #204 in
the box, car #1 oncoming, tram 2), 126 s longest hold and 1 deadlock; the change leaves its position and timing
unchanged. `tests/traffic-flow.test.mjs` therefore runs seed 1 and says why; it also keeps a bounded 3-minute seed 4242
run (`deadlocks <= 1`, longest hold under 130 s, at most one car over 120 s) so a second cycle or a longer hold would
still fail.

### Remaining pairs

The 71 first contacts split as:

| Group | Pairs |
|---|---:|
| Jeżyce shared lane, no mapped conflict | 24 (14 moving, 10 stopped) |
| Jeżyce connector | 7 (3 moving, 4 stopped) |
| Kaponiera short-link connector | 14 (11 moving, 2 slow, 1 stopped) |
| Kaponiera lane | 3 (1 slow, 2 stopped) |
| Stare Miasto connector | 11 (7 moving, 4 stopped) |
| Stare Miasto lane | 1 (moving) |
| Centrum lane | 6 (4 moving, 2 stopped) |
| Centrum connector | 2 (1 moving, 1 stopped) |
| Rataje lane | 3 (stopped) |
| **Sum** | **71 / 41 moving / 27 stopped / 3 slow** |

The Jeżyce lanes are shared tram lanes (tracks 7508/7509 at `-2167, -498`): the proxy now stops followers, but a car
that already covers the last 0.3 m at 15 fps still registers a touching SAT pair, and the audit models an articulated
bus as one 18 m rectangle. The Kaponiera/Stare Miasto moving pairs are the known short-link commitment race: the car
enters a 10 m link before the tram's curve is stamped as held, and the `enter` fallback above 4 m/s accepts it. The
`enter` hard stop for cars on short links was measured again: it removes car 38 at Kaponiera seed 4242 but replaces it
with a stopped car hit by a tram at `-1135, 157` and a later bus at the same blind spot, so it is not in the code.
Extending the tram's closed-curve forecast from `8 + 6v` to `8 + 8v` removed one Jeżyce and one Stare pair but raised
Centrum from 0 to 6; a larger proxy trim margin (0.8 m) raised Jeżyce seed 4242 from 2 to 4. A pedestrian-near filter on
boxed cars did not move the seed 4242 cycle.

### Opposing lanes

`tools/audit-tram-opposing-lanes.mjs` now applies the same pass to edges under 12 m, which moves the 10 m edge 305 at
`-1823, -3` clear (9 m close run); the full list goes 62 runs / 58 lanes / 626 m → 61 / 57 / 617. The default report counts only
street-running track a `route=tram` relation uses, so off-street formations and unused depot/junction track move to
`skipped` (`--all` lists them): the collision-relevant remainder is **47 runs on 45 lanes (417 m)**, with 14 runs / 12
lanes / 200 m skipped. `tests/opposing-tram-audit.test.mjs` pins both totals and the categories. The 41 short stubs,
three curved-track runs and three constant-shift cases from the earlier classification still need per-station lane
geometry; the Rynek Jeżycki stubs remain rejected for the traffic regression recorded above. Edge 305's 2.446 m lane
move and its paint have not been checked in a browser.
