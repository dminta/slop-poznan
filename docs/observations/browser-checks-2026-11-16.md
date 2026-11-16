# Browser checks, round 3 — 2026-11-16

Inspection of `b48b055` on `cx-browser-checks-3`. No shipped JavaScript, CSS, geodata or tests changed. Two visual/
behavioural defects are recorded below; neither is a small isolated rendering fix.

## Environment and evidence

- Headless Chrome 157, Metal, HTTP **8230**, CDP **9430**, isolated profile
  `/tmp/cx-browser-checks-3/chrome`. `Network.setCacheDisabled(true)` on each connection; scratch server also sends
  `Cache-Control: no-store`. No use of port 8000 or another inspector's profile.
- Viewport **1280 × 720**, DPR **1**, midday. WebGPU **high**, canvas 1280 × 720; forced
  `?quality=low&backend=webgl`, **WebGL2 low**, canvas 960 × 540 (the tier's normal internal resolution).
- All evidence and harness files are under **`/tmp/cx-browser-checks-3/`**. Screenshot names below are relative to
  that absolute directory. Cited PNGs were opened individually or in labelled contact sheets; obstructed views were
  reframed or excluded from OK verdicts. Initial 1280 × 577 captures were replaced before judging the heads.
- `server.mjs` serves the worktree and transforms only its in-memory `main.js` response to expose inspection handles,
  pin the camera and gate frames. The files on disk remain unchanged. `cdp.mjs`, `signals.mjs`, `clearance.mjs`,
  `watch.mjs` and `return-sign.mjs` drive the inspection. Camera coordinates and head identities are in
  `webgpu-signals.json` / `webgl2-signals.json`; natural traffic states accompany each sequence as `*-states.json`.
- Seeded `Math.random`: LCG starting at 4242 on navigation; tram seed remains the production default 1922. The
  traffic sequences use normal spawning, routing, signals and interactions, with the player moved out of the way.
  The HUD is hidden in scratch DOM styles. No actors were manually placed in the natural traffic sequences.
- The head sight test deliberately uses **three static clones of the player's taxi**, spaced 7 m apart, with the
  lead centre 3 m before the approach stop line. The eye is 28 m before that line at **1.2 m**, looking at the head.
  Elevated support views show all three cars. The supported sightline verdict is: **visible from 13–30 m behind
  the queue; lead-car view not checked**. Nine of the eleven heads hang 10.5–15 m upstream of the stop line
  (the edge end, `js/road-network.js:836`), over the second/third staged car. The rear eye therefore does not
  establish visibility for the lead driver. Natural queue formation and visibility behind buses/vans were not
  tested. These clones are hidden before the traffic sequences.
- The whole-tram sequences cited below (`zawady-overhead`, `ogrody`, `kap-north`, `staroleka`) advance in 0.05 s
  production simulation steps, **0.95 s between captures**, plus at most 0.05 s for the rendered frame: at least
  one captured frame per simulated second. The earlier exploratory `kaponiera` / `kap-south` runs use 1 s clock
  steps plus a render step; they are not the evidence for the minimum whole-tram capture cadence.
- Console monitoring during boot and captures: **0 console warnings/errors and 0 browser log warnings/errors** on
  both backends (`console.jsonl`); no shader, WebGPU validation or WebGL draw errors observed.

## 1. Cantilever and span heads

**Partial, WebGPU high and WebGL2 low:** six cantilever heads and five span heads, including Górna Wilda,
were sampled. The heads are visible from the rear queue view, with weak evidence for head 75 (approximately
10 px). **Visible from 13–30 m behind the queue; lead-car view not checked.** Support and wire-clearance coverage
is incomplete as detailed below; these frames do not establish an OK verdict for every mast, arm or stay.

**Open head-position sign question:** `findOverhead` (`js/street-details.js:2592–2643`) uses `search(-8)` /
`search(-10.5)` and clamps longitudinal position at −15 m, placing the head upstream of the edge-end stop line.
Check whether this implementation and the “8 m before the stop line” explanation in `docs/world.md:423` have the
intended visibility-band sign backwards. The present rear-queue views do not resolve the lead-driver sightline.

The current full browser world has **114 overhead heads: 70 cantilevers and 44 spans**. These are a sample, not a
new citywide clearance audit; the older 48/27 counts describe the earlier build.

For every row, the four screenshot paths are
`{webgpu,webgl2}-head-<id>-{queue,support}.png` under the evidence directory above.

| ID | Head position (x, z), m | Support in placement records | Verdict on both backends |
|---|---|---|---|
| 1 | −3243.32, 1721.11 | New 6.2 m cantilever mast | Rear-queue head view OK; lead view not verified |
| 27 | −2832.80, 592.73 | New 6.2 m cantilever mast | Rear-queue head view OK; lead view not verified |
| 60 | 899.20, 1989.53 | New 6.2 m cantilever mast | Rear-queue head view OK; lead view not verified |
| 62 | 1248.97, 1007.56 | New 6.2 m cantilever mast | Rear-queue head view OK; lead view not verified |
| 75 | 86.81, 1057.88 | New 6.2 m cantilever mast | Weak head visibility (≈10 px); lead view not verified |
| 9 | −1549.80, 552.58 | Reused cantilever support below bridge | Head visible; arm/traction-pole clearance not verified |
| 15 | −1496.68, 250.67 | Ordinary span, one new 10 m mast | Head visible; only one anchor/mast in frame |
| 16 | −2722.30, 2056.76 | Ordinary span, two new 10 m masts | Head visible; neither new mast shown |
| 22 | −1180.12, 608.48 | Ordinary span, two new 10 m masts | Head visible; only one anchor/mast in frame |
| 67 | −1177.24, 645.06 | Ordinary span, one new 10 m mast | Head visible; only one anchor/mast in frame |
| 19 | −460.08, 982.52 | Górna Wilda, two existing 7.6 m poles | Head visible; left stay not distinguishable |

For head 9 the arm appears to pass through a dark tram traction pole. A side view is needed to distinguish a
projection overlap from a real crossing; the present images do not resolve it.

`webgpu-gorna-wilda-stays-close.png` and `webgl2-gorna-wilda-stays-close.png` additionally frame Górna Wilda's
head, drop and wire arrangement, but the left signal stay is indistinguishable from a tram span wire. **Not
verified:** clearance/sag of that stay and the complete anchor pair. The 7.2 m stay height and clearance measurements
remain results of [the geometric audit](signal-tram-clearance-2026-11-14.md), not a new visual confirmation.

**Not verified:** a signal stay actually crossing a mainline railway portal in one legible frame. Section 4
frames the elevated portals themselves, which is a different subject. Do not treat those views as proof of
signal-stay/portal clearance. Only 11 of 114 overhead heads were sampled.

## 2. Whole trams, loops and boundary routes — WebGPU high

### Whole-body switch and road-crossing passages

**OK for the sampled passages; occupied-stop admission not verified.**

- **Zawady switch at (1641.9, −509.3):** `zawady-overhead-044.png` through `055.png` show the whole line 5 tram
  (pool ID 4) entering and leaving the fork. Its front is still before the fork in frame 45, reaches it in frame
  46, and its rear has passed in frame 51; it continues through frame 55 without stopping across the switch or
  clipping the neighbouring track. Rear coordinates in frames 50 / 51 / 52 are `(1640.0, −507.3)` /
  `(1644.1, −512.1)` / `(1647.5, −516.8)`. These are copied section ends, not a rigid full-tram approximation.
- **Kaponiera east-side road crossing, approximately (−1427, 118):** `kap-north-180.png` through `199.png` show
  tram ID 2 traversing the crossing and then dwelling at the platform. Front z moves from 125.1 in frame 180
  to 117.1 in frame 184; rear z moves from 155.4 to 106.4 by frame 195. The visible tail clears the crossing
  before the platform dwell; no visible body clipping was found in this passage. The station roofs partly cover
  the tram roof in the middle of the sequence, so this is not a pantograph-clearance measurement.
- **Not verified:** a controlled observation of a follower being held outside an *occupied boarding stop* and
  subsequently admitted after its leader departs. Nearby queues and `room` waits occurred, but that complete
  named interaction was not established visually. No citywide claim follows from the two passages above.

### Zawady and Ogrody boarding — defect

**Defect:** trams traverse the terminal platforms without a boarding dwell. Return destinations do change.

- **Zawady:** `zawady-overhead-050.png` through `063.png` show line 5 tram ID 4 proceeding round the loop with
  closed doors and no stop; it changes from Zawady to Górczyn PKM at frame 56. IDs 19 and 15 make the same
  destination change at frames 83 and 130. Across the 171 s clock-time overhead watch, no sampled tram near
  the loop has open doors or a positive dwell. The close view `zawady-return-destination.png` independently
  shows the readable **5 Górczyn PKM** plate on a naturally returning tram (ID 1, later watch).
- **Ogrody:** `ogrody-020.png` through `027.png`, and `044.png` through `051.png`, show trams continuing past
  the terminal platforms instead of dwelling. Doors are not legible in these wide frames: the boarding verdict
  rests on the logged states in `ogrody-states.json`. The 228 s clock-time watch contains eight sampled
  return-direction changes and no positive dwell/open-door state near the loop. ID 4 changes Ogrody → Franowo
  at frame 26; ID 1 changes Ogrody → Miłostowo at frame 49. `ogrody-return-destination.png` clearly reads **8 Miłostowo** on
  a naturally returning tram (ID 10, later watch).

The review diagnosed two causes (no fix applied):

1. **Arrival stops drop out of the search at chain ends.** `js/trams.js:1739` scans stops starting at
   `ic = path.indexAt(u)`. Zawady's arrival stop is at the end of chain 533 (`s = length = 346.457 m`);
   Ogrody's is at the end of chain 975 (`s = length ≈ 85.41 m`). The target includes `0.35 × tram.length`,
   approximately 11 m beyond that end. Once the front passes the chain end, the preceding stop is no longer
   scanned, although the target is still ahead (tram 4 changes from `waitReason: 'stop'` at 4.07 m/s to
   `'curve'`). Candidate fix: start the scan at `Math.max(0, ic - 1)`, plus clamp the Zawady target before
   the switch at `(1641.9, −509.3)`; link chain 1058 is only 9.1 m long.
2. **Departure platforms snap to unrouted tracks.** `js/tram-infra.js:747–807` snaps each platform to the
   nearest track, while `TRAM_ROUTE_EXTENSIONS` in `tools/poz-roads.mjs:524–532` routes lines over the main
   loop. The Zawady departure platform is on chain 985 and Ogrody's departure platform tracks are chains
   976/978, with `routes: []`. Runtime attachment evidence (`webgl2-scene-evidence.json`) includes Zawady
   `(1654.1, −565.6)` on edge 558 / chain 985 and Ogrody `(−3472.64, −876.61)` on edge 551. Candidate fixes:
   route via the platform tracks, or prefer a routed track when snapping the platform.

No routing/stop fix was attempted: this needs a coordinated route-membership and stop-target review rather than
a small visual adjustment. **Return plate rendering: OK for the two legible samples. Boarding: defect.**

### Starołęka boundary — route samples OK; rendered corridor defect

`staroleka-000.png` through `003.png`, `010.png` through `013.png`, `050.png` through `053.png`, and
`130.png` through `133.png` show whole trams on the extended boundary tracks. `staroleka-states.json` identifies
line 7 northbound to Połabska and southbound to Ogrody, line 12 northbound to Os. Sobieskiego and southbound to
Starołęka PKM, and line 13 northbound to Junikowo. These trams retain those route/destination assignments.
Line 13 southbound was **not verified**, and the distant LED lettering is not legible in these wide frames.

**Defect:** around `(658, 2855)` the trams continue across the coarse lawn/road surface while the rendered rails
and traction-wire corridor terminate at the detailed-city edge. The full tram over the lawn with no rails/wires
beneath/above it is particularly clear in `staroleka-051.png` through `053.png`; the opposing movement is visible
in `staroleka-130.png` through `133.png`. This is a visible simulation/infrastructure boundary mismatch, not evidence
that routes are missing from the graph. The diagnosed cause is a mismatch between
`tools/poz-roads.mjs:533–534`, which extends lines 7/12/13 beyond the map to z ≈ 3125, and
`layoutTrackRails` (`js/tram-infra.js:544`), which drops rail pieces where `isLand` is false, including outside
the detail box (z maximum 2844.2). Candidate fixes: lay rails/wires on outskirts ground, or end these tracks at
the box edge and retire trams there. Neither option was implemented in this docs-only pass.

## 3. Kaponiera named encounters — WebGPU high

- **Left-turn completion: OK for a natural sample.** `kap-south-039.png` through `046.png` show car ID 41 turning
  left through the southern box, from `(−1496, 241)` towards `(−1521, 216)` and leaving it. It does not stop in
  the box. The grey/blue car is visible across the centre of the frames; the red bus entering the foreground is
  a different actor. **No tram is within 30 m during the turn.** This verifies a completed left turn only;
  a left-turner turning with a tram approaching and the exact one-second forecast-gap interaction remain
  **not verified**.
- **Tram passing a car stopped at the crossing: not verified.** The natural watches found stopped cars and
  passing trams, but did not establish the required close passing pair in legible frames. `kap-north-180.png`
  shows stopped cars at the central conflict and a moving tram farther east; they are not the named pair.
  Keep this check and the approximately 1 s forecast-gap case open. No actors were staged to manufacture it.

## 4. Overhead clearance framing

**OK for the static canopy/column and elevated-portal framing on WebGPU high and WebGL2 low.** A tram
pantograph is visible only in the WebGL2 canopy frame; WebGPU pantograph clearance remains **not verified**.

- **Rynek Łazarski canopy columns:** eye `(−2158, 4.2, 1558)` → look `(−2172, 3.2, 1574)`.
  Screenshots: `{webgpu,webgl2}-lazarski-road-columns.png`. Columns stand on the paved market side of the
  curb; the curved roadway is visibly clear.
- **Raised tram canopy:** eye `(3255, 4.5, 2318)` → look `(3274, 5.5, 2324)`.
  Screenshots: `{webgpu,webgl2}-tram-canopy-6m.png`. The roof underside, columns, tram roofs and contact
  wires are framed. The pantograph is visible only on WebGL2, without visible canopy penetration there;
  do not infer the WebGPU pantograph verdict from its roof/wire view.
- **Elevated railway portals:** eye `(−1340, 12, 118)` → look `(−1356, 14, 130)`.
  Screenshots: `{webgpu,webgl2}-viaduct-portal.png` and `{webgpu,webgl2}-viaduct-portal-wide.png`.
  Crossbeams/droppers follow the elevated rail deck above its catenary rather than cutting through it.

These are visual framing checks of the earlier fixes, not new measurements of the 25 mm pantograph/beam margin.
`webgl2-tram-canopy-6m-under.png` is excluded: a passing tram obstructs that closer camera. The usable wider frame
above shows the subject. The market aerial view is likewise excluded because a building obscures the columns.
The documented Główny hall / ramp track overlaps in [the earlier audit](overhead-clearance-2026-11-14.md) were
outside this pass's fix scope.

## Changes and remaining checks

Only this record and `docs/backlog.md` change. No commit was made. With no code fix, the full test suite was not
rerun; diff whitespace checks validate the documentation edits. Remaining checks include lead-car head views,
the head-position sign question, incomplete mast/anchor framing, head 9 arm clearance, Górna Wilda's left stay,
signal stays crossing railway portals, WebGPU canopy/pantograph clearance, occupied-stop admission, Kaponiera's
stopped-car passing pair and left turn with a tram approaching / forecast-gap case, and the unobserved Starołęka
line 13 direction. Boarding and the Starołęka rendered corridor are recorded as defects with diagnosed causes.
Review round 1 corrections are documentation only; no new browser checks or code fixes were performed.
