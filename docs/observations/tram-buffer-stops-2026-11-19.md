# Data-edge tram buffer stops and pole–outskirts clearance (2026-11-19)

Branch `poznan` at `b4d0aae` (working tree). Follow-up to
[the Starołęka rails record](staroleka-rails-2026-11-17.md): the rails, wire and poles continue to the OSM snapshot
edge, but the ends had no buffer stop, and the outskirts poles had never been checked against the generated outskirts
buildings.

## 1. Buffer stops at the data-edge dead ends

### Finding them at build time

`layoutTramInfrastructure` already loads every `kind: 'tram'` chain of `GEO.rail`. The geodata build cuts a chain at
every switch and crossing, so two chain endpoints at the same coordinates are one junction, not two ends. The rule is
therefore:

- take both endpoints of every tram chain;
- keep only endpoints **outside** the detail box `[-9119.5, 4490.7] × [-2830.8, 2844.2]`, toward the OSM data edge;
- drop an endpoint when another tram chain's endpoint lies within `BUFFER_JOIN` **1.5 m** (a switch the geodata cut).

On the 2026-11-17 snapshot there are **24 outside-box tram endpoints**. Two are a switch: rail 848 ends at
(4468.2, 2884.4) and rail 1013 starts at exactly that point, so neither is a dead end. The other **22 are dead ends**
and each gets one buffer stop, 0.5 m past the last rail piece (`BUFFER_SETBACK`). The tram graph stops a tram with its
nose about 1 m short of the end, so the prop is never touched.

| edge | count | chains (rail index, x, z, outward direction) |
|---|---|---|
| south | 11 | 553 (−3568.1, 3037.2, SW); 617 (−3605.1, 3022.9, NW); 664 (2191.8, 3091.9, SW); 844 (4458.4, 2886.7, SE); 1067 (−1887.7, 3600.9, SE); 1068 (−1889.3, 3597.7, SE); 1069 (1504.1, 3539.3, SW); 1097 (215.6, 2991.6, E); 1098 (214.6, 2995.4, E); 1200 (624.6, 3125.0, S); 1201 (628.3, 3126.8, S) |
| north | 8 | 716 (−112.0, −2930.7, NW); 718 (−118.3, −2962.6, N); 987 (−944.5, −3050.2, N); 988 (−949.3, −3050.6, N); 989 (875.1, −3043.3, N); 1070 (891.0, −3124.9, N); 1071 (−1550.7, −3650.3, NE); 1072 (−1581.6, −3676.9, N) |
| east | 3 | 541 (4676.5, −179.2, E); 973 (4641.7, −131.8, E); 1013 (4561.6, 2826.2, NE, no route) |

The Starołęka pair (1200/1201) is included, as are the other routed lines. The four **interior** depot stubs
(around −2690, 2266 and −5826, 2250) keep their old look: they are mapped track ends inside the detail box, not
data-edge ends. The route-less 1013 fragment's far end is included because it is the same kind of data-edge dead end.

By `districtAt` (the osiedle of the end, outside the box too): Starołęka-Minikowo-Marlewo 3 (1098, 1200, 1201),
Antoninek-Zieliniec-Kobylepole 3 (541, 973, 1013), Chartowo 1 (844), Żegrze 1 (664), Górczyn 2 (553, 617), Wilda 2
(1067, 1068), Rataje 2 (1069, 1097), Nowe Winogrady Południe 3 (716, 718, 987), Nowe Winogrady Wschód 2 (989, 1070),
Winiary 3 (988, 1071, 1072).

### Prop

Two instanced meshes under the existing `TramInfrastructure` culling root, built once with the rest of the layout:

- `TramBufferStops`: a 2.4 × 0.4 × 0.16 m beam at y 0.74, red/white bands every 0.4 m in a `colorNode`. The stripe
  pulse is box-filtered with `fwidth` and fades to its mean once a band is under a pixel, like the ballast sleepers.
- `TramBufferStopFrames`: two 0.14 × 0.9 m posts 1.8 m apart on 0.34 × 0.08 × 0.44 m feet, on the existing
  `steelMat` (no new pipeline).

60 triangles per stop (five boxes), 1,320 triangles for all 22. The beam and frame are two draws of 22 instances; the
22 instances are below the 64-instance chunk threshold, so scene culling leaves them whole. No colliders: every prop is
outside the detail box, where ground modes never go. No runtime work and no new module (`js/tram-infra.js` only), so no
modulepreload count changes.

## 2. Pole-vs-outskirts-building audit

`node tools/audit-pole-outskirts.mjs [--margin 0.3] [--band 300] [--near 60] [--top 12] [--json] [--fail-on-clash]`
builds the full furnished headless world through `tools/audit-tree-clearance.mjs`'s `runAudit({ worldOnly: true })`,
the real tram and railway layouts, and the **production** outskirts building list. The latter is the private `generateOutskirtsBuildings` plus
`buildSatelliteSiteBuildings`, exported through a source suffix; the live `city-grid.railRectClear` is passed in so
on-track buildings are filtered exactly as in the app (a first probe that kept them found 22 spurious tram-pole hits).

Checked at a **0.3 m** clearance from the pole surface (the balcony audit's threshold), requiring vertical overlap with
the building box. "Clash" means the pole surface penetrates the footprint; a positive number is the clear gap.

| class | checked | outside the box | nearest distance to a building | clashes < 0.3 m |
|---|---|---|---|---|
| tram catenary pole | 4,948 | 486 | **1.058 m** at (82.8, 2965.0), a 15.4 × 9.5 m house | 0 |
| railway mast | 1,648 | 0 | none within 60 m | 0 |
| signal pole (street details) | 1,935 | 0 | 47.6 m at (3688.7, 2708.5), IKEA Franowo part | 0 |
| street lamp / gas / column mast within 300 m of the box | 24,501 | 0 | **−53.956 m** (inside), M1 Poznań part | 17 |
| **all** | **33,032** | 486 | | **17** |

Buildings: 46,753 boxes (46,682 generated borough buildings + 71 hand-placed satellite parts). Distance buckets for the
nearest building: 17 inside, 0 at 0–0.3 m, 0 at 0.3–1 m, 3 at 1–3 m, 22 at 3–10 m, 509 at 10–60 m, 32,481 with none
within 60 m.

### The 17 clashing masts

All are street LED masts on the detail box's south edge at z 2842.42 (`x` 3564–4314), inside the hand-placed satellite
rectangles that represent the Franowo retail parks:

| satellite part | masts | deepest penetration |
|---|---|---|
| M1 Poznań (329 × 120 m, plus its 149 × 80 m glass part) | 9 | 53.956 m |
| IKEA Franowo (208.5 × 102.6 m) | 6 | 50.866 m |
| Selgros (121 × 150 m) | 2 | 7.645 m |

The rectangles are OSM footprints approximated to about a fifth of their area, and they reach into the detail box where
the last lamp row inside the box stands. This is not the "pole 2.6–16 m from a track vs a building 1.5 m off it" case
the Starołęka record anticipated: the production `railRectClear` filter already drops those buildings, and all tram and
signal poles are clear on this data. It is a satellite-footprint/box-edge interaction, so the fix is a decision: refine the
three Franowo/Selgros satellite outlines (split/trim the rectangles), or move/drop the box-edge lamp row. **Left open;
no world code changed from the audit.**

## Tests and limits

- `node --test tests/tram-infra.test.cjs`: pass. The test pins **22** buffer stops, checks each stands 0.5 m beyond a
  chain end outside the box, that no stop sits on a switch, that Starołęka and the route-less 1013 end are included,
  that interior depot stubs are not, and that both instanced meshes carry one instance per stop.
- `node tools/audit-pole-outskirts.mjs` runs in about 12 s headless and is deterministic (fixed geodata, seeded
  outskirts generators).
- The audit is a static box-vs-pole check. It does not render the scene, does not check the lamp arm or signal head
  overhang separately, and uses each street footprint's half-diagonal as the pole radius (conservative for the lamp
  cabinets' 0.45 m box). The satellite rectangles are the hand-placed approximations, so their penetrations are
  geometry-model differences, not necessarily visible gaps in the real city.

## Browser checks opened by this record

The [2026-11-19 browser pass](#browser-pass-2026-11-19) below closed both. The scope that was set was:

- the buffer stops at the Starołęka pair (z ≈ 3125), north 1071 (−1550.7, −3650.3) and east 541 (4676.5, −179.2),
  on WebGPU high and WebGL2 low, by day and at night, from a low chase and a drone;
- the Franowo box-edge lamp row and the M1/IKEA/Selgros rectangles from the south-east drone/edge view on both
  backends, to judge whether the 17 buried masts are visible and how much the rectangles intrude into the box.

## Browser pass, 2026-11-19

### Setup and boots

- Headless Google Chrome **157.0.8103.79** on macOS (Apple M5 Pro), flags
  `--headless=new --enable-unsafe-webgpu --use-angle=metal`, window 1280 × 720, `--disable-extensions` on the
  re-checks, background timer/renderer throttling disabled. Served by `python3 -m http.server 8240` from the worktree.
- WebGPU used `/?quality=high` (1280 × 720 internal); WebGL2 used `/?backend=webgl&quality=low` (960 × 540 internal,
  1280 × 720 CSS). `Network.setCacheDisabled({cacheDisabled:true})` was set before every navigation.
- CDP ports: **9440** for the first (pre-fix) WebGPU/WebGL2 pass, **9441** for the post-fix WebGPU pass, **9442** for
  the post-fix WebGL2 pass and **9444** for the distance-fade views. Chrome was relaunched between the heavy runs (it
  exited after each capture), each time with a fresh profile and a new boot.
- Every boot cleared `#loading-overlay` (`hidden`), reported `#hud-backend` = **WebGPU** or **WebGL2**, and produced
  the expected canvas size. Boots took 8.2–8.9 s. The six runs (pre-fix and post-fix, both backends, plus the
  distance views) had **zero page exceptions and zero warning/error-level console messages**; the four full capture
  runs also recorded no browser-log entries.
- Framing used `Runtime.queryObjects` on the live `CameraSystem`, replacing only its `update` to read
  `window.__debugCamera = { eye, look, fov }`; time presets were selected through the real `[data-time]` buttons
  (`lightingSystem.activePresetId` and the active class were checked after each switch). `Trams` and
  `TrafficAndPedestrians` were hidden and the HUD was suppressed for deterministic prop frames. No production
  inspection hook was added.
- Exact unrounded stop transforms, camera poses and Franowo poses are retained in `.agent-task/views.json`; the
  distance-view poses are under `farViews` there and in `.agent-task/far-webgpu.json` / `.agent-task/far-webgl2.json`.
  Screenshots are under `.agent-task/shots/`; the pre-fix copies cited below are in
  `.agent-task/shots/before-fix/`.

### Buffer stops

The live scene held **22 `TramBufferStops` beams and 22 `TramBufferStopFrames`**, both under `TramInfrastructure`, all
at y 0 and unit scale. The framed instances (live positions, not the rounded table) were:

| End | Beams | x | z |
|---|---|---|---|
| Starołęka pair 1200/1201 | 2 | 624.588, 628.285 | 3124.987, 3126.787 |
| north 1071 | 1 | −1550.679 | −3650.269 |
| east 541 | 1 | 4676.499 | −179.229 |
| Górczyn 553 | 1 | −3568.076 | 3037.229 |

Each was captured at midday and midnight from a 20 m low chase (eye y 1.75–1.9, look y 0.78–0.8) and a 14–18 m-high
drone, plus a 0.45 m base close-up and separate 300/600 m high views at Starołęka, on WebGPU high and WebGL2 low.

**Placement passes.** The rails end 0.5 m before each beam; no rail head passes under a beam or foot and no z-fighting
was visible. The 0.08 m feet sit on the ground: the prop base is y 0, while the outskirts carpet top is −0.02, so a
2 cm air gap exists arithmetically, but it is not visible from a 0.45 m eye at 4 m or from the 20 m chase (the foot
bottom reads flush and carries a contact shadow). The beam and frame cast clean, attached shadows; no acne or peter-
panning. The 2.4 m beam spans the 1.435 m gauge and the 1.8 m-apart posts stay outside the rail heads. There are no
trams or other actors in the prop frames (hidden for the check; the pre-fix scout that left them visible caught a tram
on the adjacent track at the Starołęka pair, which is the expected operating context).

**The first rendered pass found a real defect:** the beam rendered as a plain white bar with hairline red seams and
read as a park bench rather than a red/white buffer stop, on both backends. The `colorNode` pulse used
`phase = x * 2.5` (0.4 m period) with a half-width of `0.5`, which is the full period: the pulse was high everywhere
except the `fract` boundaries. It was corrected in `js/tram-infra.js` to `phase = x * 1.25` (0.8 m period) and a
half-width of `0.25` (50% duty), giving three 0.4 m red and three 0.4 m white bands across the 2.4 m beam. At the 20 m
chase each band is about 15 px on WebGPU high and 12 px on WebGL2 low. The fix was re-checked on both backends.

- Before: `.agent-task/shots/before-fix/webgpu-staroleka-pair-chase-midday.png`,
  `before-fix/webgl2-staroleka-pair-chase-midday.png`, `before-fix/webgpu-staroleka-pair-chase-midnight.png`,
  `before-fix/scout-base-pair-a.png` (white beam, seams only).
- After: `webgpu-staroleka-pair-chase-midday.png`, `webgl2-staroleka-pair-chase-midday.png`,
  `webgpu-staroleka-pair-base-midday.png`, `webgpu-staroleka-pair-drone-midday.png`, the same views at `midnight`,
  and `webgpu-north-1071-chase-midday.png`, `webgpu-east-541-chase-midday.png`,
  `webgpu-gorczyn-553-chase-midday.png` with their `-drone` and `webgl2-` counterparts.
- Distance: `webgpu-staroleka-pair-far300-midday.png`, `webgpu-staroleka-pair-far600-midday.png` and the WebGL2 pair
  were taken from a high eye, but the pair is at the resolution limit and the frames do not separate the `fwidth`
  fade from the ground; the 220 m `webgpu-staroleka-pair-far-midday.png` is blocked by rooftops. They are not evidence.
  The 18–40 m drone frames show no seam pop in a still; this was **not** a temporal fly-through, so motion shimmer was
  not tested.
- Night: the data-edge ends have no local lights. At midnight the beam is a dark silhouette against the lit ground
  carpet; its red/white bands are not distinguishable at 20 m, while the beam/posts silhouette is. This is a lighting
  limitation of the unlit edge, not a material failure.

The buffer-stop check **passes after the fix** (placement and appearance), so its backlog bullet is removed; the
stripe defect is fixed and re-checked rather than left open.

### Franowo box-edge lamp row

The rendered edge row runs along the south box edge at **z 2842.42**, 1.78 m inside the declared edge (BZ1 2844.2):
**341 LED masts** from x −9100.5 to 4460.5, typically about 30.8 m apart with a few longer gaps. The audit's 17 buried
masts are 15 here plus
the two Selgros ones; the first record's sentence “all … x 3564–4314” left out the Selgros pair, which is at
x **826.0** and **858.0**. The groups are:

| part | masts | x at the row | hidden row length | northward intrusion into the box |
|---|---:|---|---:|---:|
| M1 Poznań main (329 × 120 m) | 6 | 4034.2–4189.7 | 192.5 m (4010.3–4202.7) | **124.2 m** (north edge z 2720.0) |
| M1 Poznań glass part (149 × 80 m) | 3 | 4251.9–4314.1 | 100.2 m (4231.2–4331.4) | **108.5 m** (z 2735.7) |
| IKEA Franowo (208.5 × 102.6 m) | 6 | 3564.0–3718.0 | 182.2 m (3564.2–3746.4) | **88.0 m** (z 2756.2) |
| Selgros (121 × 150 m) | 2 | 826.0, 858.0 | 51.1 m (819.7–870.8) | **11.4 m** (z 2832.8) |

The last column is the box's northmost corner behind BZ1; the audit's mast penetration depths are smaller (54.0 m M1,
50.9 m IKEA, 7.6 m Selgros), because a mast sits inside the footprint but not at its deepest point.

The 17 masts are **fully enclosed, not poking through roofs**: the LED mast is 6 m high, the M1/IKEA boxes 15 m and
Selgros 10 m. No mast, arm or lamp head is visible on a roof or through a wall; the row simply disappears under each
footprint. The malls themselves read as ordinary big-box retail volumes from the air: their roofs sit on a wide paved
apron and there is no drawn box boundary, so the intrusion is not conspicuous from above. The M1 glass part is the
extreme case: its **centre** is at z 2813.5, 30.7 m inside the box, not just a corner.

What is visibly broken is the **lamp/tree row**, which is the only street-level cue at the edge:

- `webgpu-franowo-row-south-midday.png` (from the south, eye 3890, 2.6, 2892): the long 15 m M1 facade crosses the
  edge sidewalk diagonally; the lamp and tree row leads into it and the next lamps are gone. `webgl2-` repeats it.
- `webgpu-franowo-drone-south-midday.png` (eye 3820, 40, 2900): the row of trees and lamp posts runs across the open
  apron and terminates at the M1 corner; the roof covers everything beyond. At `midnight` the lit ground pools stop at
  the same corner (`webgpu-franowo-drone-south-midnight.png`).
- `webgpu-franowo-ikea-drone-midday.png` and `webgpu-franowo-row-north-midday.png`: the same at the blue IKEA box;
  `webgpu-franowo-glass-low-midday.png` shows the row ending at the M1 glass wall. `webgpu-franowo-overview-south-midday.png`
  gives the whole retail-park context.
- `webgpu-selgros-row-midday.png` and `webgpu-selgros-drone-midday.png`: the shallower Selgros case (11.4 m; 51 m of
  row and two masts hidden under its long roof).

No z-fighting or see-through was visible in the mall walls, roofs or their intersections with the lamps/trees. The
decision is still **open** and no world code was changed: refine the three satellite outlines (or split/trim them) or
move/drop the box-edge lamp row.

### Verification

- `node --test tests/`: **696 passed, 0 failed** (123.3 s); `git diff --check` clean. The shader change does not alter
  any placement or instance count, so `tests/tram-infra.test.cjs` still pins 22 beams and 22 frames.
- The console status and boot evidence above are from the same runs that produced the frames. No audio, frame-rate or
  whole-fleet pass was made.

## Follow-up, 2026-11-19: the box-edge rows stop at the satellite malls

The user chose the second option of the open decision: trim the lamp row (and the procedural tree row) instead of
changing the satellite outlines. The malls are real buildings and stay as they are. Branch `poznan` at `460b807` plus
the working tree; no commit.

### Rule and margin

`js/street-details.js` imports `satelliteClearance` from `js/satellite-sites.js` and rejects a candidate when the answer
is under `SATELLITE_KEEP` **0.45 m**:

- the LED pole centre and the luminaire centre, inside `ledCheckCandidate`, so the nominal spot, the sidewalk-offset
  fallback, the curb-slide fallback and their combination all use it;
- a procedural street-tree trunk at the initial candidate, at every ±0.4 m slide, and again in `addStreetTree` before
  the site is pushed. Mapped OSM trees are left alone: they keep their surveyed points.

The margin covers the 0.45 × 0.45 m mast footprint (0.32 m half-diagonal) and the 0.8 m luminaire's 0.4 m half-length
from the centre it is measured at, with 5 cm to spare. The rectangles approximate an OSM outline to about a fifth of
its area, so a small margin inside the drawn wall is enough. Nothing under `tools/data/` (or the rectangles) changed.

`satelliteClearance` gained an optional third argument, the query limit: sites whose coarse world-axis box is farther
than the limit are skipped. `street-details` passes 0.45 m, so the common city-centre candidate pays 13 site-box tests
instead of all 71 footprint tests; the default `Infinity` keeps the old exact answer for `outskirts.js`.
`tests/outskirts-satellites.test.cjs` compares the limited and exact answers at every part centre, corner and 0.4–60 m
offset.

### Counts

Lamp masts in the 300 m band round the detail box: **24,501 before → 24,483 after**, i.e. 18 dropped. The audit's 17
surface clashes were 9 M1 Poznań (6 main + 3 glass), 6 IKEA and 2 Selgros. The eighteenth is the Selgros mast at
x **811.5** (z 2842.63): its pole centre is 1.35 m outside the rectangle, but its luminaire over the road is
inside, which the head check catches. Per part:

| satellite part | masts dropped | how |
|---|---:|---|
| M1 Poznań main (329 × 120 m) | 6 | pole centre inside |
| M1 Poznań glass (149 × 80 m) | 3 | pole centre inside |
| IKEA Franowo (208.5 × 102.6 m) | 6 | pole centre inside (one 0.084 m outside the rectangle, still within the 0.45 m keep) |
| Selgros (121 × 150 m) | 3 | 2 pole centre inside, 1 luminaire inside |
| **total** | **18** | |

The closest surviving LED mast is at (3748.8, 2842.42), **1.177 m** from the IKEA box surface (1.402 m at the pole
centre). Audit distribution: `inside` 17 → 0, 0.3–1 m 0 → 0, 1–3 m 3 → 2, 3–10 m 22, >10 m 509; poles checked
33,032 → 33,014 (the 18 masts), other classes unchanged (4,948 tram, 1,648 railway, 1,935 signal).

Trees: **12 procedural street trees inside → 0** (6 M1 Poznań, 6 IKEA Franowo; the Selgros stretch plants none). All
12 are dropped by the new trunk rule. **0 mapped OSM trees** stand inside any satellite rectangle, so no real surveyed
data was removed. The reduced headless fixture (`tests/street-tree-colliders.test.cjs`, no landmark/bridge walls) goes
33,464 → **33,452** street trees; the full audit world has 118,162 tree sites, of which 21 lie within 30 m of a
satellite and only those 12 were inside.

### Audit gate

`node tools/audit-pole-outskirts.mjs --fail-on-clash` now exits **0**:

```
{"margin":0.3,"band":300,"nearQuery":60,"detailBox":[-9119.5,4490.7,-2830.8,2844.2],
 "poles":{"total":33014,"byClass":{"tram":4948,"rail":1648,"signal":1935,"lamp":24483},"outsideBox":{"tram":486,"rail":0,"signal":0,"lamp":0}},
 "buildings":{"total":46753,"satelliteParts":71,"generated":46682},
 "distribution":{"inside":0,"under03":0,"m03to1":0,"m1to3":2,"m3to10":22,"over10":509,"none":32481},
 "clashes":0,"clashByClass":{},"deepestPenetration":0, ...}
```

(quoted from the `--json` line; the omitted keys are the nearest rows, all positive). Before the change the same tool
reported 17 clashes, 53.956 m deep.

### Boot cost

`node tools/bench-boot-headless.mjs`, four runs each, interleaved on the same machine (baseline from a detached
worktree at `460b807`):

| tree | total ms (4 runs) | median | streetDetails ms (4 runs) | median |
|---|---|---:|---|---:|
| `460b807` | 11,007.7 / 10,806.4 / 10,983.2 / 10,930.5 | 10,956.9 | 3,990.7 / 3,938.8 / 4,008.4 / 3,923.1 | 3,964.8 |
| working tree | 10,966.3 / 10,766.7 / 10,609.3 / 10,682.3 | 10,724.5 | 3,992.2 / 3,905.0 / 3,739.9 / 3,913.8 | 3,909.4 |

The medians are 232 ms (2.1 %) lower in total and 55 ms (1.4 %) lower in `streetDetails`, inside the run-to-run spread;
there is no measurable boot regression. The coarse site-box limit keeps the common candidate path at 13 site-box tests
instead of 71 footprint tests; only candidates within 0.45 m of a site box run that site's parts.

### Tests

- `node --test tests/*.cjs`: **663 passed, 0 failed** (79 s). Includes the updated `tree-distribution` pins (species
  totals, site hash, collider digest, two mesh counts, plus the new zero-LED/zero-tree assertion), the
  `street-tree-colliders` count, the `streetlight-curb-clearance` pins (side LED 20,573 → 20,556 and total lamps
  27,580 → 27,563 in its reduced fixture; its world omits the real grid inputs and drops 17 of the 18 masts), and
  `outskirts-satellites` (the new limited-query equivalence test).
- `node --test tests/tree-distribution.test.cjs`, `node --test tests/street-tree-colliders.test.cjs` and
  `node --test tests/outskirts-satellites.test.cjs` run individually and pass.
- `node --test tests/`: **697 passed, 0 failed** (132 s).

### Limits

- No browser pass was made for this change; the row's new termination at the mall walls is unverified in a rendered
  frame. The audit and pins are static headless checks.
- The lamp head is tested at its centre with the 0.45 m margin, not as the full 0.8 × 0.32 m box; a corner of the
  housing could in principle overhang a rectangle by a few centimetres while the centre stays clear. The head is
  0.4 m long from its centre, so the two differ only within that 5 cm band.
- Trees are tested at the trunk, as the user asked; a crown may still overhang a satellite rectangle. The rectangles
  are a fifth-of-area approximation, so a crown over the drawn edge is not evidence of a crown inside the real mall.
- The audit's 0.3 m clash threshold and the new 0.45 m keep are different quantities: the audit asks whether a pole
  surface penetrates a building, the rule whether the whole pole and luminaire stand clear with a small margin.
- The unlit data edge still leaves the trimmed row and the buffer stops as silhouettes at midnight; that limitation
  is unchanged.
