# Missing signal heads: span-wire fallback — 2026-11-08

The backlog's "Other missing signal heads (15.5)" left 43 historical Category C approaches after the earlier
cantilever fallback. This pass widens the overhead search and adds a span-wire fallback; the furnished audit now
reports **156/0/1/10** (A/B/C/D), down from **114/0/43/10**, with one C left at Górna Wilda.

## Baseline

`node tools/audit-signal-heads.mjs` on the starting tree:

| metric | value |
|---|---:|
| historical approaches | 167 |
| A / B / C / D | 114 / 0 / 43 / 10 |
| vehicle heads | 1,001 |
| overhead heads | 32 (10 new 6.2 m masts, 22 reused poles) |
| overhead arm max / mean | 11.717 / 8.819 m |
| overhead fallback heads | 14 |
| pedestrian heads / audio entries | 1,572 |

The 43 C approaches had no clear mast foot within 12 m, or no support in the −15…+10 m approach corridor. Most
failed the curb/road checks at every one of the 300 ground samples; the rest failed the track, lane, curve or
crosswalk checks. Several are tram-shared lanes where a head over the lane centreline is within 2.22 m of a track.

## Implementation

- `findOverhead` now samples the approach from −30 to +20 m and up to ±(edge.half + 24) m laterally, while keeping
  the 12 m cantilever limit.
- A new `findSpan` fallback runs when no cantilever site exists. Two stays from existing signal poles or new 10 m
  masts up to 55 m away meet 10 m above the head and drop vertically to the 5.3 m S-1 centre. The stays run above
  the 7.6 m tram poles, 9.6 m railway portal masts and 8.9 m portal beams, so they may cross a track; only the head
  and the vertical drop need the 2.22 m horizontal track clearance.
- The head stays over a real lane. When a tram occupies the lane axis, it may slide up to 1.5 m across the lane
  envelope until it clears the 2.22 m track buffer.
- New span masts keep 3.1 m from every track and pass the same curb, roadway, lane, curve, landing,
  pedestrian-route and building checks as ground poles. Every span foot and head keeps **3.1 m** from the real tram
  poles, railway masts and portal masts; every cantilever arm, foot and head does too.
- `main.js` computes `layoutTramInfrastructure` and `layoutRailInfrastructure` once after the network, hands their
  supports to `addRuntimeSignalHeads`, and reuses the same layouts in `buildTramInfrastructure`. The support check
  uses an 8 m bucket grid, so the wider search stays cheap.
- The first span pass found that the 6.75 m stays could pass within 0.1 m of a 7.6 m tram pole. Raising the stays to
  10 m clears every support (the tallest railway portal mast is 9.6 m); the anchors and the 5.3 m head are the only
  parts checked horizontally against the supports.

## Measurements

| metric | before | after |
|---|---:|---:|
| A / B / C / D | 114 / 0 / 43 / 10 | **156 / 0 / 1 / 10** |
| vehicle heads | 1,001 | **1,043** |
| runtime heads (new-head + reused-head) | 98 (70 + 28) | **140 (94 + 46)** |
| overhead heads | 32 | **74** |
| cantilever heads | 32 | **48** (16 new masts, 32 reused poles) |
| span heads | 0 | **26** (25 new 10 m masts, 26 reused anchors) |
| span heads on at least one new mast / existing only | — | **18 / 8** |
| cantilever arm max / mean | 11.717 / 8.819 m | **11.759 / 8.281 m** |
| span stay max / mean | — | **54.604 / 27.824 m** |
| fallback heads at the stop line | 14 | **8** (7 cantilever, 1 span) |
| closest new foot to a track | 7.67 m | **3.141 m** |
| closest span head to a track | — | **2.298 m** |
| closest cantilever arm to a track | 2.604 m | **2.604 m** |

The audit's `overheadFootRailMin` is 3.141 m (new feet), `spanHeadRailMin` 2.298 m and `overheadArmRailMin`
2.604 m. The signal-placement regression rebuilds the real tram and railway layouts and checks every span foot and
head at **≥ 3.1 m** from every tram pole, railway mast and portal mast; every cantilever arm, foot and head at
**≥ 3.1 m**; every span head and anchor at **≥ 2.22 m** from every track; and the stays above the 9.6 m portal
masts.

## Remaining

One C remains at **Górna Wilda**, node `(-448.825, 947.425)`, stop line `(-459.248, 971.007)`, approach direction
`(0.480, -0.877)`. It has one nearby existing signal pole at 14.5 m, no clear ground within the 35 m corridor, and
its first clear ground lies 46–52 m past the stop line. A span from those far points would need a second anchor and
would not keep the 3.1 m support clearance under the current checks. It needs a site-specific span anchored to the
tram traction poles or a gantry on the far side of the junction.

The audit fixture omits building, landmark and bridge colliders, so the browser's placements and counts may differ.
The 10 m span masts and their stays are also unverified in the browser; the rendered appearance and visibility of
the new span heads remain a browser check.

## Validation

- `node tools/audit-signal-heads.mjs` → 156/0/1/10; `--before` stays 17/65/75/10.
- `node --test tests/*.cjs` → **442/442**.
- `tests/signal-audit.test.cjs` carries the new counts and placement hash.
- `tests/signal-placement.test.cjs` covers the span branch: head over a lane, 2.22 m from tracks, 3.1 m from real
  supports, foot road/building clearance, unchanged lanes and crossings, and unchanged pedestrian links near every
  new foot.
