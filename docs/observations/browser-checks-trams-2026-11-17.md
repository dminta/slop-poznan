# Browser checks of trams and tram infrastructure — 2026-11-17

Inspection of `c02f9ff` on `cc-browser-trams`. No `js/`, `tools/` or test file changed; only this record and
`docs/backlog.md`. Follow-up to [browser-checks-2026-11-16.md](browser-checks-2026-11-16.md),
[tram-loop-boarding-2026-11-16.md](tram-loop-boarding-2026-11-16.md) and
[car-tram-jezyce-4660-reserve-2026-11-16.md](car-tram-jezyce-4660-reserve-2026-11-16.md).

**Results in one paragraph.** (1) The pantograph **is** visible on WebGPU high under a raised 6.1 m canopy; no defect,
and the 2026-11-16 miss was not reproduced (cause unproven). Side finding: the high-tier (SSR) canopy underside shows a ghost
reflection that the WebGL2 low frame does not. Resolved: [canopy SSR follow-up](canopy-ssr-2026-11-17.md). (2) An occupied boarding stop was observed end to end: follower held outside for ~30 s,
admitted 10 s after the leader moved off, then dwelt. (3) At Kaponiera a tram passed in front of a stopped car
(gap 2.7 m) and the frames show a left-turner just after it cleared a braking tram's path (the close crossing itself is inferred from
the log, not framed); the tram reaches the −9 m/s² cap for such gates. (4) Starołęka
line 13 southbound is confirmed to run on coarse road/lawn past the box edge at z ≈ 2844; about 9–10 southbound passages per
5 min cross it. (5) Zawady arrival, Zawady departure and Ogrody dwells show open doors and clear switches; open doors
are barely readable in some lighting (Zawady Tramino). A car on the Jeżyce stubs held for the reservation and crossed after the tram stopped
for it. No car inside a tram body and no tram nose in a switch was seen.

## Environment

- Headless Chrome 157 (`--headless=new --enable-unsafe-webgpu --use-angle=metal`), HTTP **8260**, CDP **9460**, profile
  `/tmp/cc-browser-trams/chrome`; `Network.setCacheDisabled(true)` on every connection, scratch server sends
  `Cache-Control: no-store`. Server and Chrome were killed at the end.
- 1280 × 720, DPR 1, midday, WebGPU **high** (`WebGPUBackend`) except `pano-webgl2-*` (`?quality=low&backend=webgl`,
  `WebGLBackend`). `Math.random` is an LCG seeded 4242 at navigation.
- Harness `/tmp/cc-browser-trams/` (`server.mjs`, `cdp.mjs`, `pano.mjs`, `room2.mjs`, `kap1/2/3.mjs`, `star1/2/3b.mjs`,
  `dwell2/3.mjs`, `jez.mjs`, `ovl.mjs`): the 2026-11-17 signals pass's in-memory-patched `main.js` (disk untouched) that
  pins the camera, hides the player and HUD and exposes `H = {scene, renderer, trafficSystem, tramSystem, …}` plus
  `advance(s)`, a fixed 0.05 s production step of the tram and traffic systems. Searches advance the simulation with the
  camera pinned at the focus (trams and cars respawn near it, `TRAM_RADIUS` 900 m); on a hit the script freezes the
  trigger and takes a shot sequence, re-pinning the camera on the subject in hops of at most 90 m (a focus jump over
  140 m respawns every tram, `js/trams.js:1950`). Sequences are not repeatable seed for seed because frame times enter
  the first frames, so each is cited by its own log. The patched render loop also advances the simulation between `advance()` steps, so
  logged times, speeds and rates are approximate (accelerations computed from them are artefacts, see §3).
- **All screenshots are in `/tmp/cc-browser-trams/shots/`** (392 files); names are relative to it. Cited frames were
  opened individually or in labelled contact sheets (`/tmp/cc-browser-trams/sheet-*.png`, not cited as evidence) and
  re-opened at full resolution where a verdict depended on pixels. Logs are `/tmp/cc-browser-trams/*.json`.
- Console: **0 errors, 0 warnings** (888 `info`, 111 `log`) across every boot and capture on both backends
  (`/tmp/cc-browser-trams/console.jsonl`); no WebGPU validation or shader messages.
- "Gap" below is the exact oriented-rectangle distance between a car footprint and a tram section (0 = touching),
  computed in the page from `section.x/z/heading/halfLength/halfWidth`; "front dist." is the tram nose to the car centre.

## 1. Pantograph under a raised canopy

**Verdict: the pantograph is visible on WebGPU high at the same relative pose (not the same pose: different tram and place) where WebGL2 shows it. No defect.**

Canopy: the 6.1 m tram canopy at Piaśnicka Rynek, centre `(3274.2, 2324.1)`, 87.8 × 23.5 m (`GEO.canopies`, kind `tram`).
The scripts advance until a tram's mid section stands under the deck, then pin relative to that section.

- WebGPU, tram 3 (Gamma, line 18, mid section `(3264.7, 2317.1)`): `pano-webgpu-back.png` (10 m behind the mid
  section, 4.5 m up) shows the single-arm pantograph rising from the roof to the contact wire under the deck.
  `pano-webgpu-side.png` (9 m to the side) shows the whole arm: base on the roof, knee, head at the wire.
- WebGL2, tram 4 (Gamma, line 1, mid section `(3240.5, 2310.2)`): `pano-webgl2-back.png`, the same relative pose on a different tram in a different place, shows the
  same pantograph. `pano-webgl2-side.png` is blocked by a canopy column and is not evidence.

The pantograph exists only on the mid section of each tram (`pantograph: true` on `gammaMid`, `traminoMid`,
`combinoMid`, `js/trams.js:109–136`; geometry `buildTramPantograph`, `js/actor-models.js:3510`), and the meshes are
`frustumCulled = false` (`js/trams.js:988`), so culling and LOD are ruled out in code and by the frames. Why the
2026-11-16 WebGPU frame lacked it is **not resolved**: a nose or rear section in frame is the likely reason, not proven.

**New observation (not investigated).** On the high tier the canopy underside is a mirror: `pano-webgpu-back.png` and
`pano-webgpu-side.png` show semi-transparent ghost images of the platform, street and buildings in the deck, while
`pano-webgl2-back.png` (WebGL2 **low**, which has no SSR, `docs/rendering.md` ~127) shows a flat grey deck, so it is not
shown to be WebGPU-specific; WebGL2 high was not checked. Likely cause: the canopy roof material
`roughness: 0.5, metalness: 0.42` (`js/canopies.js:48`), under the 0.75 SSR roughness mask. Added to the backlog.

Resolved: [canopy SSR follow-up](canopy-ssr-2026-11-17.md).

## 2. Occupied boarding stop

**Verdict: observed end to end. A follower is held outside, then admitted after the leader departs.**

Stop *Aleje Marcinkowskiego*, leader at `(−354.6, 151.4)`. Frames are `room-mk-NN-tT.png` (T = simulation seconds); camera
`(CX+14, 70, CZ+14)` over the midpoint of the pair, fixed for the whole sequence. Tram 17 (line 3) is the follower, tram 13
(line 20) the leader; states from `room-mk.json`. The log row for `room-mk-01-t21` tracked the wrong ids (18 and 14) and is
not evidence.

| Shot | t (s) | Follower 17 | Leader 13 |
|---|---|---|---|
| `room-mk-00-t20` | 20 | `(−340.7, 199.6)`, 0 m/s, `waitReason 'room'` (the vertical tram at bottom centre, on the straight approach below the curve) | at the stop, doors open, dwell 20.7 s (the tram at the top) |
| `room-mk-14-t38` | 38 | still `'room'` | doors closed, dwell 1.8 s |
| `room-mk-18-t46` | 46 | still `'room'` | left the stop, 4.7 m/s, `(−348.2, 132.8)`, 19 m ahead of it |
| `room-mk-21-t52` | 52 | `'curve'`, 2.4 m/s, on the curve entering the stop | 4 m/s, 45 m up the line |
| `room-mk-26-t62` | 62 | `'stop'`, 4.2 m/s, braking for the stop | 5 m/s, further away |
| `room-mk-30-t70` | 70 | at the stop, doors open, dwell 20.6 s | gone |

The follower stood 49 m (centre to centre) behind the dwelling leader for at least 28 s (`'room'` from t20 to t48);
it was released 10 s after the leader moved off (t40) and 12 s after its doors closed (`'curve'` from t50), which fits
the documented reservation of the tram's full length plus 2 m beyond the platform (`docs/actors.md` "Trams reserve
space"). In `room-mk-18` the lower-left tram is a third tram (not tracked), not the follower. The frame at
t46 does not show the leader at the stop, which the log confirms.

An earlier run (`room-teatralny-*`, Most Teatralny) held its follower 107 m from the leader; the harness then lost both trams
at t248, most likely the retirement of a tram stuck over 90 s and out of view (`js/trams.js:1981–1982`, not proven). It is
not cited.

## 3. Kaponiera

**Verdict: both encounters observed in legible frames with real tram traffic.** The earlier left turn had no tram within
30 m. Search (`kap1.mjs`, camera focus `(−1490, 160)`, seed 4242, 1800 s, radius 130 m): 74 left-turn connector transits,
25 of them listed with a tram body within 22 m (centre distance minus half a section length), so a tram close to a
left-turner is common at this junction rather than rare.

### Tram passes a car stopped at the crossing — `kapS1-NN-tT.png`

Car 61 stands at `(−1456.3, 51.9)` (Kaponiera north, edge 5984, `waitReason 'tram'`, 0 m/s throughout); the car is the
blue one at the centre of each frame. Tram 17 (line 10) crosses in front of it:

| Shot | t (s) | Tram 17 |
|---|---|---|
| `kapS1-00-t55.3` | 55.3 | 5.7 m/s, nose 6.1 m from the car, `'car'` wait, gap 2.8 m |
| `kapS1-02-t55.8` | 55.8 | 0.9 m/s (braked 4.8 m/s in 0.5 s), nose 6.3 m |
| `kapS1-08-t57.3` | 57.3 | 1.3 m/s, `'curve'`, nose 7.0 m, gap 2.72 m |
| `kapS1-12-t58.3` | 58.3 | 2.7 m/s, nose 8.5 m from the car's centre |
| `kapS1-16-t59.3` | 59.3 | 4.1 m/s, nose 11.7 m from the car's centre |
| `kapS1-22-t60.8` | 60.8 | 6.1 m/s, nose 20 m beyond |

The tram never touches the car (minimum gap 2.72 m, constant while it passes) and the car holds until it is clear: **OK**.
`frontD` in this table is the distance from the tram's nose to the car's centre. Oddity: the tram brakes `'car'` for a car that
is already stopped and waiting for it (`'tram'`), with its nose already past the car (about 1.5 s at ≤ 1.3 m/s) before it
carries on.

### Left-turner after a braking tram's path — `kapL3-NN-tT.png`

Car 170 turns left (connector `L`) through the south-west box at `(−1500.1, 230.2)`, centred in each frame; tram 19
(line 18) comes from the east. From `kapL3.json`: at frame 00 the car is 3.1 m ahead of the nose and 3.9 m to the side,
moving away (lateral 3.9 → 5.7 → 7.8 m), and it cleared the swept path about 0.25 s before the first frame.

| Shot | t (s) | Car 170 | Tram 19 |
|---|---|---|---|
| `kapL3-00-t163.7` | 163.7 | 7.1 m/s, on the connector | 7.7 m/s, `'car'`, nose 5.0 m from the car's centre, gap 3.2 m |
| `kapL3-01-t163.9` | 163.9 | 7.7 m/s | 5.0 m/s, gap **2.21 m** (minimum) |
| `kapL3-02-t164.2` | 164.2 | 8.2 m/s | 2.3 m/s |
| `kapL3-03-t164.4` | 164.4 | 8.7 m/s | 1.7 m/s, `'curve'` |
| `kapL3-08-t165.7` | 165.7 | 10.6 m/s, leaving west | 3.4 m/s, nose 26.5 m away |

The frames show the car just after it cleared the tram's path; the crossing ahead of the nose (≈ 0.5 s earlier) is
inferred from the log, not framed; the tram then braked for a car already leaving. The 5.0 m is nose-to-car-centre
distance, not a time to conflict, so no claim is made about the ~1 s forecast gap, whose per-frame value was not read.

**Braking.** `t.acc = Math.max(-9, _acc)` (`js/trams.js:1817`) caps deceleration at 9 m/s², and speed changes only by
`speed + acc*dt` (`:1841`). The rates I computed from the logs (8.6, 9.6, 10.8 m/s²) exceed the cap because the patched
render loop updates trams between `advance()` steps: a timebase artefact. The correct reading is "≤ 9 m/s² (the cap),
reached". Real tram emergency braking is about 2.8 m/s². Headless rates (bench world, 7 districts, seeds 4242 and 7,
5 min, 20 fps, 25.5 tram-hours, moving trams):

| Deceleration | Episodes | Per tram-hour |
|---|---|---|
| below −3 m/s² | 157 | 6.2 |
| below −5 m/s² | 117 | 4.6 |
| at the cap (≤ −8.5) | 93 | 3.6 |

At-cap episodes by wait reason: room 36, car 28, switch 17, signal 9, stop 3. Wilda `(−929, 1954)` hits `'room'` about
10 times per run. Backlog bullet added (it is a late-gate question, not a cap question).

Further left-turn events found by the same search and not cited: `kapL1` (car 42, tram 8 and 10 passing on parallel
tracks 11–13 m away at 15 m/s) and `kapL2` (car 80, tram 13 within 1.5–4.8 m by section centre); `kapL2` has no
oriented-rectangle gap, so it is not evidence.

## 4. Starołęka line 13 southbound

**Verdict: confirmed.** Line 13 southbound (destination `Starołęka PKM`) runs onto the coarse outskirts surface after the detail box edge (mostly the grey coarse road, partly grass and sidewalk strips).

- Rails end at **z = 2846.09** (`tramLayout.pieces` near x = 650; poles end at 2819.2); the
  paved detail box ends at the same line (the sharp horizontal edge in the top-down frames).
- `star13top-01-t19.9.png`, `-02-t20.9.png`, `-03-t21.9.png` (camera `(655, 75, 2850)` straight down, screen up = south):
  tram 17 (line 13, `Starołęka PKM`, 13.5 m/s, front z 2850.6 / 2864.7 / 2878.8) crosses the edge and continues on
  the coarse road/lawn with no rails or wires; the lower half of each frame, inside the box, shows rails. Tram 17 is the
  lower tram in `-01` (its front about 6 m past the edge), the right one of the pair in `-02` (the other is an
  opposite-direction tram, not identified) and the upper-right one in `-03`. Its log is in
  `star13top.json`; `star13top-00-t18.9.png` shows tram 17 (front z 2836.6) still inside, on rails.
- The oblique frames `star13-00-t18.9.png`, `-03-t21.9.png`, `-05-t23.9.png` (eye `(684, 13, 2842)`) show trams on the
  coarse road/lawn south of the edge with no rails; the trams there are not tram 17 (it is in the box at t18.9) and are unidentified.
  The same run's tram log (`star13.json`) tracked the wrong tram id for 17 frames before the harness was fixed.
- **How many run off the rails** (`star2.mjs`, focus `(658, 2800)`, 1500 s, 0.05 s steps, front crossing z = 2848):

| 5 min window | southbound crossings | northbound | line 13 southbound |
|---|---|---|---|
| 0–300 s | 10 | 15 | 2 |
| 300–600 s | 10 | 12 | 5 |
| 600–900 s | 10 | 10 | 3 |
| 900–1200 s | 7 | 8 | 1 |
| 1200–1500 s | 10 | 10 | 1 |

Mean **9.4 southbound and 11 northbound passages per 5 min** (lines 1, 7, 11, 12, 13), **2.4 line 13 southbound**. At any
30 s sample 1–8 trams (mean ≈ 5) stand beyond z = 2851. The focus sits at the box edge, so trams respawn around it and the
numbers overstate what a player elsewhere would see; use them as an order of magnitude.

## 5. Dwells and the Jeżyce reservation

### Zawady arrival, Zawady departure and Ogrody dwells (WebGPU high)

**Verdict: all three dwell with open doors and depart; no nose in a switch.**

| Platform | Tram | Dwell left at first frame | Doors | Shots |
|---|---|---|---|---|
| Zawady arrival, front at `(1638.7, −505.9)` | 11, line 5, `Zawady` (Tramino by livery) | 29 s | open t37–t62, closed t64, moving by t68 | `zawadyA3-00-t38`, `-10-t62`, `-12-t66`, `-14-t70` (door close-ups); `zawadyAer-00-t37`, `-10-t61`, `-12-t65` (aerial) |
| Zawady departure, tram centre `(1657.1, −561.7)` | 17, line 5 (Tramino by livery) | 24.7 s | open t18–t38, closed t40, departs t44 | `zawadyD-00-t18`, `-08-t38`, `-10-t42`, `-13-t48` |
| Ogrody `(−3480.1, −872.9)` | 9, line 8, `Miłostowo` (Combino by livery) | 27.7 s | open t60.8–t84.8, closed t86.8, departs t88.8 | `ogrody-00-t60.8`, `-09-t82.8`, `-11-t86.8`, `-14-t92.8` |

At the Zawady arrival stop the nose stands 4.7 m before the switch fan at `(1641.9, −509.3)`: `zawadyAer-10-t61.png` shows
the nose, the rails and the shelter with the switch fan clear ahead of the nose. The door close-ups
face the platform side (the doors are on the right-hand side) and show the platform edge and the *Zawady* stop sign
(`zawadyD-00-t18`).

**Defect (minor, resolved 2026-11-19): open doorways are barely readable in some lighting (Zawady Tramino).**
See [open-doorway fix and verification](tram-doorways-2026-11-19.md). Historically, the Zawady trams are Traminos
(yellow door frames and stripe, `traminoCol`); tram models are not logged, so every model label here is inferred from
livery. The leaf area reads RGB (27, 31, 33) with doors open and (9, 21, 31) closed (`zawadyA3-10-t62` vs `-12-t66`, same
camera, a 65 × 210 px crop at `(335, 270)`), a visible but subtle change. The open-doorway colour `0x2b2622`
(`js/actor-models.js:3697`) is shared by all models, so the Zawady vs Ogrody difference (`ogrody-09-t82.8` vs `-11-t86.8`
is clearer) is lighting and viewing angle. The first Zawady set (`zawadyA-*`, `zawadyA2-*`) looked at the wrong side and
the plain section; it is not cited.

### Jeżyce reservation (browser edge ids 4691/4692, stubs `(−2056.2, −460.2) ↔ (−2046.8, −456.9)`)

The browser's edge numbering differs from the headless documents' 4684/4685. **Verdict: a car waited for the reservation
and then crossed; the hold ended when the tram stood waiting for the car, consistent with the documented release.**

`jez2-NN-tT.png`, camera 8 m / 28 m up from car 47 (white car, centre of each frame; the frame follows it):

| Shot | t (s) | Car 47 | Tram 2 (line 8) |
|---|---|---|---|
| `jez2-00-t69.7` | 69.7 | `(−2003.8, −444.2)`, edge 8998, held `'reserve'` | 4 m/s, `'car'`, nose 15 m behind, gap 12.8 m |
| `jez2-04-t71.7` | 71.7 | held | 1.9 m/s, nose 8.9 m, tram nose at the bottom right |
| `jez2-09-t74.2` | 74.2 | released (0.3 m/s) | 0.2 m/s, nose 6.5 m, gap 4.0 m |
| `jez2-12-t75.7` | 75.7 | on the connector, 3.6 m/s | 1.0 m/s |
| `jez2-15-t77.2` | 77.2 | 6.4 m/s | 1.7 m/s |
| `jez2-20-t79.7` | 79.7 | 8.1 m/s, on the connector toward the stub | 0.5 m/s, nose 32 m away |

The tram braked for the car (`'car'`) from the first frame, and the car was released at `t = 74.2 s`, once the tram stood
at ≤ 0.5 m/s; the hold lasted at least 4.5 s (it began before the trigger). The car then crossed with a minimum gap of 4.0 m.
Another sample (`jez1-*`, car 108, held ≥ 2 s at the stub entry while tram 4 dwelt 36 m away) is logged but its frames were
not examined.

**Not resolved (parallax plausible; the SUV was not measured).** In `jez2-04` and `jez2-09` a tan SUV looks to overlap the tram's right side (bottom right). That is
probably perspective: the camera is 28 m up and 8 m aside, and a 3.2 m tram roof leans outward. A separate 3000 s scan around
`(−2040, −450)` (`ovl.mjs`) found no car–tram pair under −0.3 m, but it was a different run and is not evidence about this
SUV.

## Backlog changes

Removed: the WebGPU pantograph bullet, the Kaponiera passing/left-turn bullet, the occupied-stop bullet and the unobserved
Starołęka line 13 southbound request. Kept and extended: the Starołęka corridor fix (confirmation, counts). Added: the
tram braking cap, the open-door contrast, the high-tier canopy reflection and the unmeasured forecast gap.

## Not resolved

- Why the 2026-11-16 WebGPU canopy frame lacked the pantograph.
- The exact forecast-gap value at the Kaponiera left turn. Resolved: [Kaponiera left-turn follow-up](browser-checks-kaponiera-left-turn-2026-11-19.md).
- The SUV near tram 2 in `jez2-04` / `-09` (parallax is likely; the pair was not measured).
- `jez1` frames; the WebGL2 versions of every sequence except the pantograph (Kaponiera left-turn and forecast-gap checks now also covered on WebGL2 low in [the 2026-11-19 follow-up](browser-checks-kaponiera-left-turn-2026-11-19.md)).
- Whether the canopy ghost reflection is SSR and whether WebGL2 high shows it (not investigated in this pass).
  Resolved: [canopy SSR follow-up](canopy-ssr-2026-11-17.md).
- The close left-turn crossing at Kaponiera was not framed (only the aftermath). Resolved: [Kaponiera left-turn follow-up](browser-checks-kaponiera-left-turn-2026-11-19.md).
