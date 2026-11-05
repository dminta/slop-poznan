# Tram queues at the detail-box edge, 2026-11-04 (v2, 2026-11-05)

The user reported that trams jam near the edge of the map and stay stuck. This records the mechanism, the v1 fix
that removed the queues by emptying the edges, the v2 fix, and the before/after measurements.

## Method

`tools/bench-tram-edges.mjs` uses the same headless world as `tools/bench-traffic.mjs` (real network, street traffic,
pedestrians and trams; no rendering). It parks the focus just inside each of the 11 track buffer stops at the
detail-box edge and at Jeżyce, Centrum and Rataje as central baselines. Five simulated minutes at 15 fps. The runs
below use Math.random seed 4242 and three injectable tram seeds (1922 default, 77 and 4242); `createTramSystem` takes
`seed` and `tools/bench-world.mjs` passes `tramSeed`, so the default 1922 behaviour is unchanged.

Each simulated second the tool records:

- **population**: active trams (pool of 24), trams within 400 m and within 250 m of the focus;
- **stopped queue**: trams whose path ends on the same last edge and is within 300 m of that end, and their speed.
  A queue here counts all of them; "slow" counts those under 0.5 m/s. A moving convoy approaching a buffer is normal
  traffic, not a jam;
- stopped trams (`stuck` over 30/60 s), `deadEndWait`/`bufferWait`/`stuck` histograms, and the worst stopped cluster.

Two camera variants:

- **headless**: no camera, so every tram is out of view. This is the browser case when the camera looks elsewhere.
- **`--in-view`**: a fake camera at the focus with a 360° view, so with `outOfView` every tram within `TRAM_CULL`
  1,500 m counts as on screen. It is a worst case, not the browser frustum, and it maximises what cannot be retired without popping on screen.

## Mechanism

The track graph has 54 dead ends; 11 on the detail-box boundary are the buffers used here. A dead end ends a tram's
path and the tram stops there. Before the fix:

1. `spawn()` picked a random edge and distance, extended the path only 140 m (`LOOKAHEAD`) and rejected it only when
   the buffer was under 80 m ahead. A boundary edge is often 1–3 km long, so most spawns on it were 100 m to 2 km
   from the buffer: accepted, and aimed straight at the buffer queue. Near an edge focus the long boundary edges are
   a large part of `nearEdges`, so the population kept refilling the approach.
2. Only the tram AT the buffer accrued `deadEndWait` (8 s unseen, 40 s seen). Trams queued behind counted `stuck`
   (90 s unseen, 240 s seen) and could not be at the end until the front left. The queue drained at one tram per
   front retirement while new trams arrived: 4–5 trams behind most buffers for 84–99% of a five-minute run.

The first fix used a 900 m spawn gate and a 400 m queue clock. It removed the queues but emptied the edges: average
trams within 400 m of the S, N, SE and E foci fell from 6.7–10.2 to 0–3.7, the SE pool fell to 7.1 of 24, and
moving trams more than 250 m away but still inside the frustum could be retired. That version was rejected.

## v2 fix (`js/trams.js`)

- `spawn()` extends the candidate path to `SPAWN_BUFFER_CLEAR` = 200 m and rejects only spawns inside the last 200 m
  of a buffer approach. The edge population and pool fill are therefore kept; the spawn no longer lands a tram
  directly into the buffer queue.
- A tram on the buffer approach accumulates `bufferWait` only while its speed is under `BUFFER_SPEED` = 2 m/s and
  it is queued behind a buffer end. `bufferQueueAhead` follows its leader chain because the runtime path only sees
  `LOOKAHEAD + 20` = 160 m ahead, so a tram several places back does not have a finite `path.end` itself.
- `bufferWait` retires a tram after `BUFFER_WAIT` = 2 s only when `outOfView` is true: no camera, outside the
  `TRAM_CULL` 1 500 m render range, or outside the frustum. Trams in the frustum inside 1 500 m are on screen and are
  never retired by this rule. A moving tram never accrues the clock.
- A free-ending buffer (`endPad` 1: 10 of the 54 dead ends, 9 at the detail-box edge; the tenth is a 23 m stub with
  no route at (−2677, 2292)) is the edge of the model: a stopped front retires after 2 s out of view instead of the 8 s
  wait. A stub ending on another track (`endPad` 19 = 1 + 2·FOUL) keeps the 8 s wait; that includes 2 of the 11 edge
  buffers, S (214, 2995) and S (−1889, 3597). In view it keeps the existing 40 s buffer wait, so no new popping was
  added.
- The tram seed is injectable (`createTramSystem(..., { seed })`, `buildWorld({ tramSeed })`); the default is still
  1922.

## Results

### Population and queues in the 360° in-view worst case

Averaged over tram seeds 1922, 77 and 4242. "active/400/250" is the average number of trams active, within 400 m and
within 250 m of the focus. "stopped queue" is `max maximum/slow` and `final average/stopped` (slow = under 0.5 m/s);
the max is taken across the three seeds.

| Location | Base active/400/250 | v2 active/400/250 | Base stopped queue | v2 stopped queue |
|---|---|---|---|---|
| SW buffer (-3604, 3023) | 7.3/3.0/2.0 | 7.7/3.5/1.9 | 2/1, final 0.7/0 | 2/2, final 1.0/0.3 |
| S buffer (-1889, 3597) | 13.6/3.2/1.6 | 14.7/4.1/2.4 | 3/3, final 0.7/0 | 5/5, final 2.7/1.7 |
| S buffer (214, 2995) | 23.0/7.0/2.7 | 23.2/5.7/2.5 | 5/5, final 3.0/1.7 | 5/5, final 4.7/3.7 |
| S buffer (625, 3124) | 20.7/8.1/4.3 | 21.0/7.1/2.9 | 5/5, final 4.3/3.3 | 5/5, final 4.7/3.3 |
| SE buffer (1504, 3539) | 19.9/9.2/3.3 | 20.6/9.6/3.5 | 5/5, final 4.0/1.3 | 5/5, final 5.0/5.0 |
| SE buffer (4458, 2886) | 23.1/7.7/0 | 23.4/8.3/0 | 5/5, final 4.3/1.3 | 5/5, final 5.0/4.3 |
| E buffer (4641, -132) | 18.3/8.8/7.1 | 16.5/6.5/4.5 | 5/5, final 5.0/4.3 | 5/5, final 4.7/2.7 |
| NE buffer (891, -3124) | 22.0/7.6/4.2 | 21.9/7.1/4.1 | 3/2, final 2.0/1.3 | 3/2, final 1.7/0.7 |
| N buffer (-945, -3050) | 22.4/6.8/6.3 | 22.6/7.2/6.6 | 5/5, final 4.7/3.3 | 5/5, final 4.3/1.7 |
| N buffer (-118, -2963) | 23.4/10.4/0 | 23.5/10.7/0 | 5/5, final 3.0/0.7 | 5/5, final 5.0/4.3 |
| NW buffer (-1551, -3650) | 18.8/7.0/3.8 | 20.8/10.2/6.7 | 5/5, final 3.7/3.0 | 5/5, final 4.7/1.7 |
| Jeżyce (central) | 23.2/5.5/3.1 | 23.0/5.6/3.1 | 0/0, final 0/0 | 0/0, final 0/0 |
| Centrum (central) | 23.9/7.6/3.8 | 23.9/8.0/3.8 | 1/1, final 0/0 | 1/1, final 0.3/0 |
| Rataje (central) | 20.4/0/0 | 20.6/0/0 | 0/0, final 0/0 | 0/0, final 0/0 |

The edge population is back: no 400 m or 250 m count is below the old base minus its stopped queue, and the pool
fills at every edge (16.5–23.5 of 24, against 7.1 for the rejected 900 m version). Most counts are within about
±2 trams of the old base; E is 2.3 lower at 400 m (its old base included the queue) and NW is 3.2 higher there (its
old queue is gone). Central counts are unchanged. The verifier's population script, run over the same three tram
seeds, measured 0 retirements of trams moving over 3 m/s on a buffer approach (the v1 number was 25 per run at the
S focus) and 0 stopped retirements inside the synthetic 360° frustum.

Stopped queues in this 360° test are not removed: because everything within the frustum and 1 500 m is on screen, the
new rule may not retire any of them, and the front still holds the buffer for the existing 40 s. Some are larger than
the old baseline because the baseline retired stopped trams beyond 250 m even though they were inside the render
range — the popping this version removes. This is the deliberate trade-off: no visible popping, with the queue in
front of a camera that purposefully sees every direction.

### Stopped queues out of view (the jam case)

Headless runs, all trams out of view, same three tram seeds. Values are maximum stopped trams in a buffer queue and
final stopped count (average over seeds).

| Location | Base stopped queue | v2 stopped queue |
|---|---|---|
| SW buffer (-3604, 3023) | 2, final 0.3 | 0, final 0 |
| S buffer (-1889, 3597) | 5, final 0 | 0, final 0 |
| S buffer (214, 2995) | 5, final 0.3 | 0, final 0 |
| S buffer (625, 3124) | 3, final 0 | 0, final 0 |
| SE buffer (1504, 3539) | 5, final 1.3 | 0, final 0 |
| SE buffer (4458, 2886) | 5, final 1.3 | 0, final 0 |
| E buffer (4641, -132) | 5, final 0.3 | 0, final 0 |
| NE buffer (891, -3124) | 2, final 0.3 | 0, final 0 |
| N buffer (-945, -3050) | 5, final 2.7 | 0, final 0 |
| N buffer (-118, -2963) | 5, final 1.0 | 0, final 0 |
| NW buffer (-1551, -3650) | 5, final 3.3 | 0, final 0 |
| Jeżyce (central) | 1, final 0 | 0, final 0 |
| Centrum (central) | 1, final 0.7 | 0, final 0 |
| Rataje (central) | 0, final 0 | 0, final 0 |

No stopped buffer queue remains at any edge with the camera elsewhere. The all-tram queue count (including moving
approaches) can still show 3–4 trams within 160 m of a buffer, but their speed is above 0.5 m/s and they leave in
sequence; no tram waits there.

## v3 fix (2026-11-05): the gate only where it is needed

The v2 gate extended every spawn's path to 200 m with `rand`. That took extra random numbers from every spawn, so the
whole tram sequence shifted; over 7 districts × 8 seeds the Kaponiera mean longest hold rose from 118.6 s to 163.5 s
while the edge queues were gone. The gate now runs only for free-ending detail-box stubs (`endPad` 1) and peeks ahead
with a fixed branch choice, without touching the tram random sequence (`bufferAhead` in `js/trams.js`). Two edge
buffers are stubs ending on another track (`endPad` 19); they keep the older 8 s front wait and are not gated.

Re-measured against v2 with the same method and three tram seeds (headless; active/400 m/250 m):

- **Population** is lower at some edge foci: SW 9.8/5.31/3.83 → 9.0/4.19/2.77, S (625,3124)
  22.5/12.76/7.58 → 21.9/10.61/6.94, S (-1889,3597) 19.2/8.45/5.16 → 18.4/7.74/4.40 and Centrum
  23.9/8.93/4.16 → 23.9/7.82/3.78; the northern and eastern foci are within ±0.3. Active trams are within 0.9 of v2
  everywhere. The v2 400 m counts included trams queued at the buffer; v3 keeps the pool full (active 18.3–23.9 of
  24) without them.
- **Stopped queues out of view**: 0 at every one of the 11 edge buffers (max 0, final 0), as in v2.
- **In view (360° worst case)**: the front's 40 s wait and its queue remain, as designed; most buffers stay within
  one tram of v2. The two endPad-19 stubs (S (-1889,3597), S (214,2995)) are not gated, so their queues can be
  larger (up to 5 stopped trams, against 1–5 at v2 depending on the seed); with the camera elsewhere they are empty.
- **Gate scope**: the 200 m gate now covers only endPad-1 stubs, so spawns heading for the endPad-19 stub ends
  80–200 m ahead are accepted. Spawns whose path reaches a buffer within 900 m rose from 0 to 11 at S (-1889,3597),
  9 at S (625,3124) and 3 at S (214,2995) over the three seeds; none formed a stopped queue.

The traffic tables in [tram-overlaps-2026-11-04.md](tram-overlaps-2026-11-04.md#kaponiera-regression-and-fix-2026-11-05)
use this gate with the car-in-the-box fixes; the 7 × 8 aggregates are within 13 s of 907b555 on the summed mean hold
and have no deadlocks.

## Limits and trade-off

- The `--in-view` camera is deliberately 360°, so it is a worst case. In the browser the frustum is narrower and a
  camera looking out at a buffer sees the approach from behind it as out of view; those trams retire before joining
  the queue. A camera that stares at a box-edge buffer from a distance still sees the front's 40 s wait and its
  queue. Removing that visible queue would require popping trams in view or a rendered fade/turnaround, which this
  fix deliberately does not add.
- No rendered or audible check was run here; the benchmark covers the simulation only.
- The benchmark's world omits grid sidewalks, square/park furniture, buildings, landmarks and bridge colliders, as
  the other headless benchmarks do.
- Varying the tram seed changes the queue phase. The tables above average three seeds; single-seed runs can be
  larger or smaller by one or two trams.