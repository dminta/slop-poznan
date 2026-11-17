# Signal stop lines versus Table 7.2 — part 1 measurement, part 2 hybrid fix (2026-11-17)

Follow-up to [browser-checks-signals-2026-11-17.md](browser-checks-signals-2026-11-17.md) on `cc-signal-stopline` (from
`c02f9ff`). Task: option B, i.e. keep the heads and move each approach's stop line upstream until it lies at least the
Table 7.2 distance before the head's front face (side heads 2,0 m, the 5,3 m overhead head the 5,5 m row, 10,5 m).
**No `js/` change was made.** Step 1 (measure first) shows option B cannot be applied to the overhead heads, so the
mechanism, the visibility check, `accept-traffic` and the browser shots wait for the user's decision. The only new file
besides this record is the reproducible audit `tools/audit-signal-stoplines.mjs` (headless, ~13 s).

## Method

`node tools/audit-signal-stoplines.mjs` builds the furnished world exactly as `tools/audit-fallback-head-sight.mjs`
does (`addRuntimeSignalHeads` with pedestrian routes and tram/rail supports), then for every signalised approach
(`node.in` edge with a live signal plan and lanes) collects the heads that face it (same plan root, same phase group,
`a.u · inArm.u > 0.98`, within 45 m of the node: the matching `findApproachHead` uses). `along` is the head's position
past the approach's stop line (the edge end), positive downstream. The shift is the distance the line must move
upstream: `need − along` with need 10,5 m for an overhead-only approach (footnote **: the overhead rows apply when those
are the only heads) and 2,0 m for an approach with a ground head, using the most downstream head (the smallest shift
that satisfies one head). Link room is the edge's `len` (stop line to the upstream stop line).

## Measurements

954 signalised approaches; 926 have a head, 28 none (disabled or unplaced). 111 are overhead-only, 815 have a ground
head (655 one, 160 two).

| | approaches | median shift | p90 | max | > 2 m | > 5 m | > 10 m |
|---|---|---|---|---|---|---|---|
| overhead (10,5 m row) | 111 | **21,0 m** | 25,5 | 25,5 | 111 | 111 | 100 |
| ground, best head (2,0 m row) | 815 | 0,75 m | 9,3 | 33,4 | 266 | 174 | 73 |
| ground, every head | 815 | 0,75 m | 10,4 | 33,4 | 291 | 193 | 88 |

- Overhead heads sit at −15 m (clamp, 48 approaches), −10,5 m (49), −8 m (2) or +0,03 / +1,75 m (12) along, so the shift is
  25,5 m, 21 m, 18,5 m or 8,75–10,5 m. No overhead approach is already compliant.
- 279 of 815 ground approaches already have a head ≥ 2 m past the line (shift 0). 536 need a shift: 203 up to 1 m,
  ~70 each in 1–2 m and 2–4 m, 46 in 4–6 m, 77 in 6–10 m, 62 in 10–20 m, 11 above 20 m. Ground heads are mostly
  *upstream* of the line (head `along` histogram: −30…−15: 15, −15…−10: 33, −10…−6: 49, −6…−3: 75, −3…0: 92, 0…2: 270,
  2…5: 111, ≥ 5: 168 counted by approach).
- **Room on the link** (edge length minus the shift, i.e. what is left to queue on):

| queue kept after the shift | overhead approaches feasible | ground approaches needing a shift that are feasible |
|---|---|---|
| ≥ 0 m | 20 / 111 | 465 / 536 |
| ≥ 5,5 m | **11 / 111** | 376 / 536 |
| ≥ 10 m | 8 / 111 | 260 / 536 |

The overhead approaches are short: edge length median 10 m (49 are under 10 m, 45 are 10–12 m, only 14 above 15 m).
The fallback hangs a head over a short link *because* ordinary poles do not fit there, and a head 10–15 m upstream of a
10 m link's end stands in the upstream junction. A 21 m shift puts the stop line on the previous link, beyond that
junction's crossing and crosswalk, so option B is geometrically wrong for ~100 of the 111 approaches, not just
expensive.

## Why I stopped

The task's step 3 says to stop at overhead heads only when ground shifts are large, but overhead heads are the
mandatory part and they are the infeasible one: moving 100 stop lines 18–25 m upstream would either clamp them to the
link (leaving the Table 7.2 distance unmet, no better than today) or push them across the upstream junction box and
its crosswalk. That needs a different mechanism (a per-approach line on the previous link, whose queue, box-blocking
and crosswalk logic assume a line at the edge end) and would change queue storage on every short link, which
`accept-traffic` would then judge on a rebuilt network. I did not build it.

## Options for the user

1. **Option A for the overhead fallback (recommended).** Hang the head 10,5–15 m *past* the line, which is how real
   far-side gantries stand: on a 10 m link that puts it 4–6 m inside the junction box, over the junction exit, exactly
   where Table 7.2 and ZDM Poznań put it. No traffic or road-paint change; the work is the sign flip in
   `findOverhead`/`findSpan`/`findTractionSpan` described in the previous record (flip `search(-8/-10.5)`, clamp
   +10,5…+30, widen the along windows, re-prove rail, tram-pole, landing and pedestrian clearances with the feet on the far
   corners, update `signal-placement`/`signal-audit` tests). The lead-car visibility check then holds by construction
   (eye 1,2 m → head 5,3 m at 10,5 m ahead = 21°; at 12,5 m 18°).
2. **Hybrid.** Option A for the ~100 short-link overhead approaches, option B for the 11–20 whose link has room, and for
   ground heads a 0–2 m stop-line shift only where the head is within ~2 m of compliance (about half of the 536).
3. **Option B as written, ground heads only** (465 of 536 feasible at zero queue, 376 keeping 5,5 m): a per-edge
   stop-line offset (`e.len -= shift; e.setbackTo += shift`, the pattern `road-network.js` already uses at the
   "the zebra stays where it was" step) honoured by traffic, road paint and pedestrian demand. That leaves the 111
   overhead approaches unfixed, so it fixes the smaller half of the defect.

## What is unchanged

No `js/`, test or CSS file changed; `index.html`, geodata and tests are as in `c02f9ff`. No `accept-traffic` or browser
run was made, because there is no changed behaviour to judge. The rule footnote and the 2019 consolidated table were
already checked in the previous record.


---

# Part 2: the hybrid fix (the user's decision)

Overhead heads (option A) hang past the line; side heads (option B) get their stop line moved upstream where 5.5 m of
queue storage remain. Uncommitted on `cc-signal-stopline`; the user approves the shots before merge.

## A. Overhead heads past the line

`findOverhead`, `findSpan` and `findTractionSpan` (`js/street-details.js`) now place the head centre
`OVERHEAD_AHEAD_MIN` 10.7 m (Table 7.2's 5.5 m row, 10.5 m, plus the 0.18 m from the head centre to its front face and 2 cm)
to `OVERHEAD_AHEAD_MAX` 15 m (that row's recommended value) beyond the stop line. The clamp in `targetFor`, the duplicate
clamp in the grid loop, the retarget test, the along lists of both span searches and the search windows (feet −2 … 27 m
from the line) all flip; the `band`/`strict` fields are gone. The mounting rules are untouched (S-1 centre 5.3 m, top
below the 5.8 m wire, 12 m reach, same rail 3.1 m / 2.22 m, tram-pole 3.1 m, landing, lane, curve, pedestrian-route,
building and tall-collider checks, span stay checks and the Górna Wilda traction span). **Nothing falls back to the old
side**: an approach without a clear site past the line stays headless (audit class C).

| furnished-grid audit (`tools/audit-signal-heads.mjs`) | before | after |
|---|---|---|
| A / B / C / D | 208 / 0 / 0 / 2 | 208 / 0 / 0 / 2 |
| overhead heads | 113 (69 cantilever, 44 span) | 113 (85 cantilever, 28 span) |
| new overhead poles / reused | 39 / 74 | 30 / 83 |
| head along stop line | −15 … +1.75 m | **10.7 … 15 m** (60 at the 15 m ceiling) |
| runtime poles / reused poles | 108 / 81 | 99 / 90 |

- **Valid placements:** all 111 overhead-only approaches find a site past the line in the headless fixture. The browser
  build (with building, landmark and bridge colliders) places all **114** heads (`dump-after.json`: along 10.7–15 m).
- **Unplaced:** none. The first version of this record listed two class-C approaches (nodes (−3263.5, 1710.8) and
  (−3508.06, −981.98)); that was an audit artifact, not a missing head. Both approaches have an overhead head
  (`runtimeHeads` holds one for edges 6315 and 6259), but `findSameHead` still required a head to stand at most
  `STOP_SETBACK` (1.75 m) past the line, so the post-hoc audit did not recognise a head 10.7–15 m past it. Fixed:
  an overhead head now matches the edge it hangs over when it is 10.7–15 m past that edge's line. Class C is 0 again
  (A 208 / D 2, as before); `summary.unplaced` stays as a tripwire (pinned `[]` in `tests/signal-audit.test.cjs`).
  The earlier "C = 1 among the 210 rows, 2 nodes in `unplaced`" mismatch had the same cause: `counts` covers the
  210 historical rows, `unplaced` all analysed entries.
- **Lead-car elevation** (eye 1.2 m, 1 m behind the line, head centre 5.3 m, 114 browser heads): min 14.4°, median
  14.4°, **max 19.3°** (≤ 20°): 15 m ceiling heads 14.4°, 10.7 m heads 19.3°, 60 of 114 at the ceiling.
- **Costs (C-closure, crosswalk closures, build time):** the C count is unchanged (0, see above); the ground search and the
  crosswalk closures (the 41-crosswalk lesson, `street-details.js` ~550) are untouched because the overhead feet only
  join after the ground search and the pedestrian crossings are laid out before, the furnished fixture's crossings
  test (`signal-placement`: all crossings survive the new footprints) passes. Build time: the fixture's audit takes
  ~11 s for the whole world build and placement (same as before: the search window shrank from 51 to 30 samples
  along the approach); `bench-world` placement measured 7.9 s wall including everything.

## B. Side-head stop lines

Mechanism (least invasive): `network.shiftStopLine(edge, shift)` in `road-network.js`. The edge gets shorter
(`len -= shift`), its `setbackTo` longer by the same amount (`len + setbackTo`, where the zebra stands, is unchanged),
and `edge.stopLead` records the shift. `makeCurve` starts the Bezier at the **old** end and every connector, cached or
built later, leads in with a straight stub of `stopLead` metres (`curvePoint` handles it), so **lanes, swept paths and
the crosswalk do not move**. Because the edge itself is shorter, traffic (stopping, queue, box blocking, `crosswalkEnd`
shifted by the same amount), road paint (`paintEdges` updated; the P-14 line is painted at the edge end) and trams (their
signal stop is derived from the road edge after this runs) all use the new line with no `traffic.js` change.
`shiftSideHeadStopLines` runs at the end of `addRuntimeSignalHeads` (only with pedestrian routes, i.e. once in
`main.js`) from the current line, so a second call moves nothing. `tools/bench-world.mjs` runs the same placement
after the traffic system by default (review 2; `BENCH_RUNTIME_HEADS=0` turns it off) so `accept-traffic` sees it.

Rule: the most forward ground head of the approach (pole + 0.18 m = front face) must be ≥ 2.0 m (2.2 m to the pole)
past the line; the shift is the difference; it is applied only when `len − shift ≥ 5.5 m` and the lane shift profile
is flat over the stub (never failed). Overhead-only approaches are not shifted.

| | headless fixture | browser (WebGPU, furnished) |
|---|---|---|
| ground approaches already compliant | 270 | 270 |
| stop lines moved | 375 | 368 |
| shift: median / max / > 5 m / > 10 m | 1 / 10.6 / 27 / 4 m | 1 / 10.6 / 28 / 4 m |
| left unchanged (< 5.5 m of queue would remain) | 170 | 175 |

The approaches left unchanged are listed by `streetDetails.stopLines.tooShort` (edge, node, head, `along`, `shift`, `len`);
their heads stand 2–33 m (typically 5–10 m) too close/behind the line. The earlier measurement said 376 of 536 fit; 370 ±
a few differ by the 2.2 m margin and the furnished/non-furnished fixtures.

## Traffic acceptance (first round, superseded by "Review round 1" below)

The first round read "no clear regression" on 20 seeds; the review found that every changed seed got worse and
that the summary was not honest (deadlocks 0 → 3, holds 15 → 20, Jeżyce km/h CI [−0.25, −0.01]). See below.

## Tests

`node --test tests/`: **678 / 678 pass** (about 100 s). New: `tests/signal-placement.test.cjs` "overhead heads stand 10.5 m
past their stop line and shifted side-head stop lines 2.0 m before theirs" (every overhead head's face 10.5–15 m past its
line and ≤ 20° elevation; every shifted approach's head face ≥ 2.0 m beyond the new line; queue ≥ 5.5 m; `len + setbackTo`
and `sx` unchanged against a freshly built network; each connector gains exactly the stub and its path is the old one;
the curve starts at the new line on its lane). Updated: the ±along assertions and the old band/strict checks in the same
file, and `tests/signal-audit.test.cjs` (counts, class C, unplaced list, Górna Wilda now 14.0 m past the line, placements hash).

## Browser shots (WebGPU high, Chrome 157 headless, 1280 × 720, midday, LCG seed 4242, cache disabled; 0 errors)

Ports 8280 / 9480, `/tmp/cc-signal-stopline/shots/`; before = `c02f9ff` (poznan) served from a scratch worktree, after =
this tree; harness `/tmp/cc-signal-stopline/{server,cdp,lead,plan}.mjs`. Natural traffic stands where the seeded
simulation put it, so a tram or pedestrian sometimes fills the frame (heads 15, 9 before and after).

- Lead-car views of the previous pass's 12 heads, `{before,after}-lead-<id>.png` (same pose: eye 1.2 m, 1 m behind the
  line, pitch +5°, FOV 50): ids 1, 27, 60, 62, 0, 9, 15, 22, 67, 19, 16, 75; per-head along/elevation in `after-lead.json`
  (head along 10.7–15 m, elevation 14.4–19.3°; before: −15 … +1.75 m, not visible). `after-lead-1.png` shows the
  cantilever head and arm ahead over the junction.
- Two rear-queue views (three taxis, eye 28 m behind the line): `{before,after}-queue-9.png`, `…-queue-15.png`.
- Three shifted-line approaches (edges 4469, 6279, 5527; shifts 7.8, 7.0, 6.9 m; same pose 16 m upstream of the old line):
  `{before,after}-ground-{1,2,3}.png`; before, the dashed P-14 line sits directly under the zebra; after, it stands 7.8 m
  upstream with open asphalt between them (`after-ground-1.png`).
- Two aerial views of relocated heads (edge 3450 cantilever, edge 7168 Górna Wilda span): `{before,after}-aerial-{1,2}.png`
  and the side views `…-aerial-{1,2}b.png`.

Not done: no WebGL2 pass; the rear-queue frames show the head small (`after-queue-9.png`: a red lens at ~15 px
between the mast and the queue); no aerial of the previously unplaced approaches (the browser places them all).


---

# Review round 1: part B fixes and honest traffic numbers

## Fixes

1. **`boxSamples` and the stub.** It looked up the Bezier parameter with the full arc length against `c.lut`, which
   does not include the stub, so every shifted connector's curvature samples sat `lead` metres early (feeding
   `bendSpeed` and `boxConflictEnd`'s widening). Now `sb = s − c.lead`, bend 0 on the stub. Test: "box curvature samples of a
   connector with a shifted stop line follow the Bezier, not the straight stub" (`tests/traffic.test.cjs`).
2. **`e.len` meant two things.** `shiftStopLine` now also records `e.linkLen` (the physical link length, `len + stopLead`).
   Every `e.len` reader was classified; **physical** (`linkLen ?? len`) where the number classifies the link's size,
   **line** (`len`) where it is a distance to the stop line or queue storage:

| reader | meaning |
|---|---|
| traffic.js bus target `e.major && len ≥ 2·half + 10`, bus spawn `len < 2·half + 10` | physical |
| `f.len ≥ 20` feeder rule, `g.len < 12` short signal link (room) | physical |
| the 12 m short-link tests in `room`, `shortLinkLane`, the straight fallback, the short-link merge exemptions (`f.len < 12`, ~1185–1274, 1341, 1565), `shortLinkTramBlocked` | physical |
| `SHORT_SIGNAL_LINK` / `BOX_WAIT_EXIT` (`straightWait`) | physical |
| `f.len < 2·half` body longer than the link (tram refusal, hard stop) | physical |
| `RSV_MAX_LEN` reservation zones, `junctionFar/shortFar` (~2007, 2113) | physical |
| trams.js `unable`/`arriving` (`c.e.len < 12`) | physical |
| trams.js `mapTramsToRoads`: lane-run clipping `along > r.len`, grid extent | physical (`len + stopLead`), so the tram↔lane runs are exactly the baseline's |
| `laneCoord` (`s = e.len` at the arm that is `e.inArm`) | **crosswalk end**: now `len + stopLead`, since it asks where lane i meets the zebra, which a shift leaves in place (before: up to 10.6 m short of it) |
| distances: `d = e.len − v.s − half`, `canStop`, `yieldOncoming`, lane-change room (`len − v.s − half < 12`), `enter`/`leave`, `blink` horizon, room/storage on `f` (`f.len − 1`, `free`, `alongside`, `canStandOn`), reservation far-line distance (`f.len − RSV_FAR_LINE`), tram-follow `len − s` | line (`len`) |

   Edge 2149 into (−1117, 132) (12.8 → 7.5 m, lead 5.3) and edge 1602 into (1010, 1675) are classified by 12.8 / 12.5 m again.

## Harness confound

`tools/bench-world.mjs` calling `addRuntimeSignalHeads` changes trajectories even with the shift disabled (seed 73 15.1 →
15.9 km/h). It was made opt-in in round 1 (to keep the baseline clean) and is **on by default again** since review 2, because `main.js` always shifts and the bench must model what ships: `BENCH_RUNTIME_HEADS=0` disables it, `=noshift` runs it with the shift
disabled (the control), `BENCH_STOP_MIN_LINK=12|17.5` skips shifts on links whose physical length is under that.
`accept-traffic` keeps the working side's cache entries per variant (the baseline side ignores the variable). The control on the final code (call, no shift, 20 seeds) reads holds 15 → 12 and deadlocks 0 → 0, within noise.

## Traffic results (final; `accept-traffic`, fresh seeds; `/tmp/cc-signal-stopline/r3/*.log`)

Final numbers: the tree rebased (fast-forward) onto poznan `feff6af`, measured against `feff6af` with
`BENCH_RUNTIME_HEADS` as below. The 20 + 20 seeds were also run against `c02f9ff` (`r2/`, after fixes 1–2) and give
**identical numbers**, as the poznan change (`js/tram-infra.js`, outskirts rails) does not enter the bench world. Two earlier
passes are void: the first (`accept*.log`, V1 before fixes 1–2 and with `bends[0]` zeroed on every curve by a bug in my
first `boxSamples` edit, found when `tests/demand-crossings.test.mjs` failed: `if (sb <= 0)` instead of `c.lead && sb <= 0`) read
`holds 15 → 42 (A), 17 → 41 (B, clear regression)`; those numbers are not the current code's.

Seed set A = the 20 default seeds (V1 with `--ped`), B = 20 more (163 167 173 179 181 191 193 197 199 211 223 227 229 233 239
241 251 257 263 269). V1 = shifts wherever the 5.5 m queue rule allows (code state), L12 / L17.5 = additionally skip links of
physical length under 12 / 17.5 m, control = the runtime call with the shift disabled (A only). Baseline: holds 15 (A) +
17 (B), deadlocks 0 + 2, max wait 2158 / 2285 s.

| variant | set | shifted edges (bench world) | holds > 120 s | deadlocks | max wait s | km/h all | verdict |
|---|---|---|---|---|---|---|---|
| V1 | A (+ped) | 391 | 15 → 24 (+0.45, CI [−0.75, +1.65]) | 0 → 2 | 2158 → 2072 | 0 | within noise; Jeżyce km/h −0.12 [−0.25, −0.01] worse (info); ped clusters 7 → 12 |
| V1 | B | 391 | 17 → 20 (+0.15) | 2 → 2 | 2285 → 2297 | −0.14 | within noise |
| L12 | A | 275 | 15 → 33 (+0.9, CI [−0.85, +2.95]) | 0 → 2 | 2158 → 2164 | +0.08 | within noise; Jeżyce −0.12 worse (info) |
| L12 | B | 275 | 17 → 14 (−0.15) | 2 → 4 | 2285 → 2254 | −0.14 | within noise; Wilda km/h −1.27 [−2.26, −0.34] worse (info) |
| L17.5 | A | 221 | 15 → 18 (+0.15) | 0 → 1 | 2158 → 2201 | +0.13 | within noise; Jeżyce −0.12 worse, Wilda +1.0 better (info) |
| L17.5 | B | 221 | 17 → 19 (+0.1) | 2 → 2 | 2285 → 2201 | −0.05 | within noise |
| control (no shift) | A | 0 | 15 → 12 (−0.15) | 0 → 0 | 2158 → 2205 | +0.2 [+0.06, +0.34] better | within noise |

Pooled over the 40 seeds (baseline holds 32, deadlocks 2): **V1 44 / 4**, **L12 47 / 6**, **L17.5 37 / 3**. No variant trips a gate; no
new deadlock pattern (≥ 3 seeds) in any. The directions are mixed rather than clearly worse, so all three are
indistinguishable from noise at 20 + 20 seeds, with V1 and L12 leaning to more holds/deadlocks and L17.5 the least.
(The first pass's "control raises holds" reading is withdrawn: the control on the final code has no excess.)

Per-site (deadlock signatures in the working runs, `deadlockPatterns`): **V1** — Kaponiera@−1438,115;−1468,118 with tram 13
(seed 103), Rataje@1026,1671 with tram 13 (seeds 113 and 173), Jeżyce@−2069,−470 (seed 197, also in the baseline). These are the
same signatures the reviewer found at the first round: the latent box/tram cycles of the backlog (Rataje seed-4) re-exposed by the shifted
lines, and they persist after fixes 1–2 although at a lower rate (V1 4 in 40 seeds). L17.5 keeps 3 (seeds 103, 263 changed,
211 improved), L12 6 (seeds 97, 157, 229, 257, 263 changed). Holds: V1's added holds sit in seeds 103 (+8) and 239 (+7); L12's in 131 (+17)
and 263 (+8); L17.5's in 131 (+9), 211 (+8), 263 (+7). Earlier diagnosis of V1 on seed 67 (Centrum (−965, 482) gridlock, in-edge leads
0.8 / 1.0 / 5.8 m) belongs to the void pass.

**Shipped variant: L17.5** (the user's pick; `SIDE_HEAD_MIN_LINK = 17.5`, review 2). Its r3 numbers: holds 32 → 37, deadlocks 2 → 3, all within noise; the
base already deadlocks at Rataje@1026,1671 (seed 211, gone under L17.5) and Jeżyce@−2069,−470 (seed 197, unchanged); L17.5 adds
Wilda@−108,1867 (seed 103) and Kaponiera@−1136,127 (seed 263).

(Round-1 text:) V1 was left in the tree (`SIDE_HEAD_MIN_LINK = 0`). Measured recommendation: if part B stays,
L17.5 is the least bad on the numbers (37 holds / 3 deadlocks pooled vs 44 / 4 for V1), at the price of
221 instead of 391 shifted lines; the user decides V1, L12, L17.5 or dropping part B. A one-constant change each.

## Record corrections

- **Shifted-line counts differ by world:** the accept (unfurnished) world shifts 391 lines, the headless audit fixture
  (city-grid without colliders) 375 and the browser 368. The three builds have different obstacle sets (no building,
  landmark or bridge colliders, plazas and park furniture in the bench world), so different ground-pole sites exist, and
  therefore different heads and different needs; I did not attribute the 23-line gap to individual causes.
- **The 170 non-compliant ground approaches** (headless fixture, 2.2 m pole rule; the review's 2.0 m count is 149 > 5 m, 70 > 10 m;
  here 152 > 5 m and 71 > 10 m): by remaining need, 2–5 m: 16, 5–10 m: 81, 10–20 m: 61, over 20 m: 12;   link length (the edge length at the time), 10–12 m: **116**, 8–10 m: 33, 6–8 m: 18, under 6 m: 2, over 20 m: 1;
  by where the most forward head stands: −40…−15 m: 17, −15…−10 m: 33, −10…−6 m: 39, −6…−2 m: 74, −2…0 m: 7; 142 stand
  on static poles, 28 on runtime poles; 5 are pedestrian-only plans. The user decides on moving those heads (most are
  10–12 m links, where a 5 m shift leaves under 5.5 m of queue).
- **`after-lead.json` labels** copied `span` from the before dump; id 9 (edge 7025) is a span head after the change (cantilever
  before). Fixed (`span` now from the live dump, `spanBefore` keeps the old label).
