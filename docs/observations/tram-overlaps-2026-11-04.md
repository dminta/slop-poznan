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
