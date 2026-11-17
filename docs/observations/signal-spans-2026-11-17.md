# Signal span clearance — 2026-11-17

The full headless fixture (`node tools/audit-signal-spans.mjs --json`) builds landmark, building and bridge colliders.
It samples stays every 0.25 m against each railway viaduct piece, using a 2.7 m half-width and 6 m above `deckY` as
an envelope. The rail contact wire is 5.6 m above rail level and the messenger is 7 m (`RAIL_WIRE_Y` and
`RAIL_MESSENGER_Y` in `tram-infra.js`); 6 m is a conservative train/contact-wire envelope, not the full catenary or
8.9 m railway portal beam height. The elevated decks begin at 5.15 m, putting this envelope above both stay heights.
Collider AABBs conservatively bound turned facades. Balconies were not examined: their generated geometry is
separate from colliders.

| Full fixture | Before | After |
|---|---:|---:|
| Span heads | 30 | 30 |
| Stays in sampled rail envelope | 2 | 0 |
| Span angles under 12° | 10 | 0 |
| Anchor feet within 0.3 m of collider AABB | 1 | 0 |

Span candidates now reject those rail envelopes, small angles and facade proximity. Where no cantilever or span
fits, a nearby viaduct can support a short bracket. The viaduct's `yClearance` is the underside of its 0.35 m slab
(`tram-infra.js`); the head centre is 5.15 m, leaving 4.6 m beneath its 0.55 m backplate and 0.3 m below the 6 m
underside. The bracket clears tram tracks and traction supports. Edge 157 near (−1542.733, 551.967) uses it.
`streetDetails.audioSignals` contains pedestrian heads only, so the vehicle-head support does not change audio.

The furnished-grid audit has 113 overhead heads: 85 cantilever, 27 span and one bridge mount. The historical
classes remain A/B/C/D = 208/0/0/2 and no approaches are unplaced. The stop-line audit's printed output matches the
before output byte for byte; it prints aggregate results, not JSON. An instrumented per-approach JSON comparison
found identical edge lengths, setbacks and served status for every approach, but the raw records differ. Edge 157's
support is a bridge mount instead of a span, and edge 1622's head moves from 15 to 10.7 m past the line. Edges 6495,
6837 and 6183 keep their longitudinal offsets but move 0.5–1.1 m sideways; tiny along differences are rounding, not
those lateral moves. Thus the raw JSON is not identical. No signal timing or stop line changed.

The full-fixture changes are edge 157, whose head at (−1526.846, 550.820) now hangs from the deck; edge 1622 and
edges 6495, 6837 and 6183, whose target positions were re-picked to avoid near-collinear supports; edge 10461, formerly
unplaced and now served by a span at (−4740.323, 820.558) with a 25.6° angle; and edge 5931, whose head stays
in place while its anchors change from a 4.0° to a 12.1° pair. Other spans also re-pick anchors without moving
their heads.

The pair search checks at most the 64 lowest-cost pairs per target, including traction pairs. A smaller candidate pool
moved edge 10461, so the wider pool remains. Alternating headless boot runs against `poznan` (`b0845b0`, three pairs,
seed 4242, same benchmark driver with rail layout passed through) measured signal placement at 2239/2271/2341 ms before
and 2564/2673/2700 ms after: means 2284 and 2646 ms (+362 ms, about 16%). Whole-boot means were 12.22 and 12.57 s.
These busy-machine, three-run results do not show the intended boot-cost recovery; the cap bounds clearance checks.
`node --test tests/` passed 684/684.

Headless Chrome WebGPU high, 1280 × 720, DPR 1, midday, seed 4242: the bridge head is visible in the same lead-driver
pose. Same-pose pairs (natural traffic differs):

- Rail case: `/tmp/cx-span-clearance/shots/before-aer-head10-ne.png` and
  `/tmp/cx-span-clearance/shots/final-aer-head10-ne.png`.
- Rail lead view: `/tmp/cx-span-clearance/shots/before-lead-10-fwd.png` and
  `/tmp/cx-span-clearance/shots/final-lead-10-fwd.png`.
- Near-collinear cases: `/tmp/cx-span-clearance/shots/before-aer-head18-ne.png` and
  `/tmp/cx-span-clearance/shots/final-aer-head18-ne.png`; `/tmp/cx-span-clearance/shots/before-aer-head30-ne.png`
  and `/tmp/cx-span-clearance/shots/final-aer-head30-ne.png`.

The browser console recorded zero errors and warnings. Chrome logged macOS `CVDisplayLinkCreateWithCGDisplay failed`
in its process output; WebGPU initialized. Chrome and the HTTP server were stopped. The frames require user approval.
