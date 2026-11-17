# Browser checks: street props, colliders, park lamps and trees — 2026-11-17

Inspection of `c02f9ff` on `cc-browser-props`. No file under `js/`, `css/`, `tools/`, `index.html` or `tests/` changed.
Fourteen shelter-intrusion defects (props, lamp masts and street trees standing inside tram shelters; a parking machine and a hydrant
were found first) are in §1; what did not resolve is marked
**not resolved** and collected at the end.

## Environment and method

- Headless Chrome 157 (`--headless=new --enable-unsafe-webgpu --use-angle=metal`), Apple M5 Pro, WebGPU high, 1280 × 720,
  DPR 1, midday unless a shot says midnight. HTTP **8270**, CDP **9470**, profile `/tmp/cc-browser-props/chrome`.
  `Network.setCacheDisabled(true)`; the scratch server sends `Cache-Control: no-store`.
- Harness (scratch, not in git): `.agent-task/h/` (`server.mjs`, `cdp.mjs` and one script per check). `server.mjs`
  serves the worktree and rewrites only the in-memory `/js/main.js` response to expose `globalThis.H = {scene, renderer,
  cameraSystem, controllerManager, trafficSystem, tramSystem, streetDetails, tramInfra, tramLayout, ...}`, a frame
  `budget` gate and a `pin = {eye, look, fov}` camera override. Nothing on disk changed. The HUD is hidden by a scratch
  `<style>` for every shot except the perf runs.
- `Math.random` is seeded (LCG, 4242) on navigation, so every run starts from the same traffic.
- Shots are in **`/tmp/cc-browser-props/shots/`** (names below are relative to it). Contact sheets (`sheet-*.png`,
  `locust-*-sheet.png`) tile the cited single shots with their file names stamped in the corner; the singles are the
  evidence. Every cited shot was opened.
- Collision numbers come from the real `ThirdPersonControllerManager` driven in the page (`keys.forward = 1`, 0.05 s
  steps, person capsule 0.48 m, car OBB 0.86 × 2.23 m), not from the headless audit. A player mesh is shown in the shots
  (the harness's default hiding was switched off).
- **Console: 0 errors, 0 warnings** over every run (`/tmp/cc-browser-props/console.jsonl`; only `info`/`log` boot lines,
  each repeated on every CDP reconnect). No shader, WebGPU validation or draw error.

## 1. Tram shelters at Dworzec Zachodni and Żniwna — OK, plus 14 shelters with something standing in them

Shelter local frame as in `stopFurnitureColliders` (`js/tram-infra.js:1745`): +x along the shelter, +z the open front,
back glass at z = −0.62. The six named diagonal shelters from `H.tramLayout.stops`:

| id | stop | world (x, z) | yaw | len | notes |
|---|---|---|---|---|---|
| sh0-dz | Dworzec Zachodni | −1715.23, 760.96 | 43.9° | 4.4 | island platform, tram track in front |
| sh1-dz | Dworzec Zachodni | −1695.21, 753.74 | 223.9° | 3.2 | same island, opposite side |
| sh2-zn | Żniwna | −521.04, −1750.56 | 224.3° | 4.4 | on a pavement against a shopfront, no platform |
| sh3-zn | Żniwna | −490.63, −1806.34 | 42.3° | 4.4 | on a pavement |
| sh4-dz | Dworzec Zachodni | −1618.42, 828.27 | 258.7° | 4.4 | on the viaduct deck behind a mesh fence |
| sh5-dz | Dworzec Zachodni | −1637.99, 878.92 | 78.7° | 4.4 | under the platform canopy |

**Walking player** (shots `sh{N}-{dz|zn}-{overview,back,left,right,frontOpen,bench}.png`, sheets `sheet-sh{N}-{dz|zn}.png`;
numbers in the shelter frame, start → end after 8 s of walking):

| trial | start | end, all six | reading |
|---|---|---|---|
| back | (0, −4) | z = −1.135 (x 0, or 0.38–0.43 on sh2, sh4) | 0.48 m from the glass plane at −0.655: stops at the back glass |
| left end | (−6, 0) | x = −2.665 (−2.069 on the 3.2 m shelter), z = 0.32 | stops 0.48 m from the end glass; the 0.32 m z slide is probably the ticket machine just beyond the left end (not isolated) |
| right end | (6, 0) | x = 2.68 (2.08 on 3.2 m), z = 0 | stops at the advert end |
| open front | (1.7, 4.5) (sh1: (1.2, 4.5)) | (1.673, −0.096) (sh1: (1.314, 0.009)) | walks in through the open front, stops beside the bench end |
| bench | (−0.3, 4.5) | z = 0.30 | stops 0.48 m from the bench front (−0.18) |

These match the 2026-11-14 headless audit (same stop distances). What the shots show:
`sh0-dz-back.png` (the player behind the glass, the bench seen through the tinted pane), `sh0-dz-left.png` and
`sh0-dz-right.png` (the player at the end glass and the advert), `sh0-dz-bench.png` (hands at the bench, glass behind),
`sh0-dz-frontOpen.png` (inside the shelter beside the bench end). The same five frames for the other five shelters are
in the sheets above. `sh0-dz-back-top.png` is a plan view: the player stands against the rear roof edge. The roof hides
the interior from above, so the other top views (`sh*-*-top.png`) show nothing useful; ignore them.

**Driven car** (`sh{N}-*-car-{back,frontCenter,frontOpen}.png`; the car stays at the platform / kerb): the taxi is
stopped by the glass from behind at local z = −2.972 on sh0, sh1, sh5 (−2.893 / −2.937 on sh2 / sh3 after a slide),
i.e. the nose 0.09 m short of the glass plane. `sh0-dz-car-back.png`: the car approaches from the carriageway behind the
island and its nose ends **0.108 m past the platform's back kerb** (platform z from −0.85 to +1.75, `TramPlatforms`
instances), so the bumper overhangs the kerb top in the frame; cosmetic, no collider is wrong. From the front on the
platform shelters the car drives onto the platform over the rails and stops with its nose at the bench
(local z = 2.05 on sh0, sh1, sh3, sh4, sh5): `sh0-dz-car-frontCenter.png`. On the pavement shelter sh2 it stops at the
kerb 4.19 m out: `sh2-zn-car-frontCenter.png` (cars cannot mount the pavement; not a shelter collider). The 3.2 m shelter
is too narrow for the car at x = 1.673 (stops at z = 2.972, no frame cited).

**Not resolved:** the car's back approach to sh4 (the start point is inside the viaduct structure: it ended at
(−2.84, −11.08) and `sh4-dz-car-back.png` looks along the fence). sh1's car-front shots were not opened.

### Defects found while framing the shelters (14 shelters, after review round 1)

- **A parking machine stands inside the shelter at Dworzec Zachodni (−1637.99, 878.92).** A grey parking-machine cabinet
  (the 0.36 × 1.45 × 0.26 m body plus 0.4 × 0.12 × 0.32 m head, `StreetDetails` instance at local (−1.45, 0.32)) is
  planted in the shelter's footprint, in front of the left end of the bench: `intrude-dz-parkomat-wide.png`,
  `intrude-dz-parkomat-front.png`, `intrude-dz-parkomat-walk.png` (also `sh5-dz-overview.png`, `sh5-dz-frontOpen.png`,
  `sh5-dz-bench.png`). The parking-machine placer evidently does not look at stop furniture. The player walking in from the front at
  x = −1.45 slides round it and ends at (−0.75, 0.30).
- **A hydrant stands in the open front of the shelter at Żeromskiego (−2961.0, −791.4).** The 0.3 × 1.26 × 0.32 m
  `StreetDetails` hydrant is at local (1.76, 0.28), inside the right-hand third of the shelter's footprint, next to the
  advert panel: `intrude-zeromskiego-wide.png`, `intrude-zeromskiego-front.png`, `intrude-zeromskiego-walk.png` (walking
  in from the front at x = 1.76 stops at z = 0.96).

**Correction (review round 1): 14 shelters, not 2.** My first scan (`/tmp/cc-browser-props/q10.js`) skipped instanced
meshes whose geometry is wider than 1.6 m, shorter than 0.5 m, or that are named Tree/Trees (parent `Tram*`/`Trees*` too).
That dropped lamp masts (2.58 m wide because of the arm), tree pits and trees, so it only found the parking machine and the
hydrant. A rerun without those filters finds 12 more shelters (local coordinates in the shelter frame; the third hit
of the first scan, Junikowo, is a 6.3 m canopy deck overhead and is not an obstacle):

- **Parking machine, 1:** Dworzec Zachodni (−1638.0, 878.9), local (−1.45, 0.32). **Hydrant, 1:** Żeromskiego (−2961.0, −791.4),
  local (1.76, 0.28). Cause: `place()` in `street-details.js`.
- **Lamp masts through the shelter, 6:** Wilczak (843.3, −2048.1) local (0.99, 0.17); Małe Garbary (205.2, −262.7)
  (0.87, −0.18); Małe Garbary (234.1, −244.5) (−1.56, −0.10); Łomżyńska (3492.2, −106.9) (2.14, −0.13); Kórnicka
  (1314.6, 1046.2) (−0.73, 0.03); Polanka (1927.5, 1293.8) (0.08, −0.22), at the bench. Cause: the street-lamp placer.
- **Street trees with their pits inside the shelter, 6:** Łąkowa (13.9, 737.7) local (−1.30, −0.04); Uniwersytet Przyrodniczy
  (−1885.4, −2046.6) (2.27, 0.03); Most Teatralny (−1313.5, −360.8) (0.91, 0.32); Św. Leonarda (−1541.1, −2702.1)
  (1.82, 0.41); Serbska (801.8, −2556.1) (−0.46, 0.37); Budziszyńska (−5851.2, 2271.6) (1.30, −0.11). Cause: the street-tree
  and tree-pit placement.
- **Borderline:** the stop sign at Rondo Kaponiera (−1414.4, 88.4), local (1.93, 0.70), on the edge of the open front.

Confirming shots (front views, the mast or trunk standing in the shelter): `polanka-lamp-front.png` (mast rising through the
roof at the bench), `malegarbary-lamp-front.png` (mast through the roof and bench line), `serbska-tree-front.png` (trunk and
pit inside the glass, in front of the bench), `lakowa-tree-front.png` (trunk and pit inside the shelter's left half). The other
eight were not framed by me. The 2026-11-14 tree audit's "0 shelter violations" needs re-checking against these.

## 2. EC Garbary chimney and cooling tower — OK

Instances from the scene: cooling tower `(655, −875)`, R = 14 m; 65 m chimney `(740, −930)`, R = 5.5 m. The person walked
straight at each centre from 10 m outside, from N, NE, E, SE, S, SW, W, NW (`.agent-task/h/industry.mjs`,
`/tmp/cc-browser-props/industry.json`): the cooling tower stops at **14.480 m** from the centre in all 8 directions, the
chimney at **5.980 m** in 7 of 8 (SW slid on after touching: min 5.980, end 15.34, tangential drift, not a pass-through).
No walk-through on either structure.

- `ind-wide-silhouette-cooling-and-chimney.png`: both silhouettes (white 55 m hyperboloid tower, red/white banded 65 m
  chimney) from the south-west, standing on the same pale apron.
- `ind-cooling-N.png`, `ind-chimney-E.png`: the player pressed against the wall; the shell meets the ground with no visible
  gap (the tower's collider is 0.067 m outside its 32-gon at y = 0; the chimney's 24-gon is about 0.047 m) and no air
  between body and wall **at ground level**. Nuance: the lathe narrows to 0.94·R at 3.3 m, which leaves about 0.45 m of air
  at head height, because the circle collider is sized to the base. On the tower the wall leans back above the player.
- Shots with the same framing from the other directions were taken (`ind-cooling-{E,S,W,NE,SW}.png`,
  `ind-chimney-{N,S,W,NE,SW}.png`) and not individually opened; the verdict rests on the two above plus the 8-direction
  numbers.

## 3. Park lamps — OK for the sampled lamps; the lawn-lamp placement itself not exercised

Sites come from `parkLampSites` (`import('/js/city-grid.js')`, **3,390** sites now). Lamps framed at 5 m on both day and
night (`lamp-<park>-<n>-{midday,midnight}.png`, all 13 pairs taken):

- **Za Cytadelą, block 212** (`lamp-b212-0-midday.png`, `-midnight.png`): the lamp at (−930.1, −1976.0) stands on a wide
  pavement beside a carriageway, base and cap intact; at night it lights the pavement with a warm pool, the globe is lit
  and the pole is dark. `lamp-b212-doccam-midday.png` (the 2026-11-14 doc's camera for the (−959.18, −1893.81) duplicate):
  **one** lamp stands on a grass median strip between the carriageways, about 1 m inside the kerb (a median, not a lawn
  in a park), clear of the kerb, the trunk beside it and the road
  (`lamp-b212-doccam-midnight.png` is its night pair; not opened). The overview `lamp-b212-overview-midday.png`
  shows lamp poles on the pavements; at that scale no doubled lamp can be told apart.
- **Park Cytadela proper** (`lamp-cyt-1-midday.png` at (94.9, −1183.9), `lamp-cyt-0-midnight.png` at (−679.3, −1562.4)):
  lamps on the pavement edge of the park's road; in `lamp-cyt-0-midnight.png` one stands beside a tree trunk with clear air
  between lamp and trunk. In `lamp-cyt-1-midday.png` a pedestrian walks on the asphalt of the park road; no road-network edge
  lies within 25 m of that lamp, so it is a pedestrian asphalt way, not a vehicle carriageway (see §6).
- **Park Jana Kasprowicza** (`lamp-kas-1-midday.png`): lamp on a wide pavement; beyond it a wide asphalt strip carrying
  pedestrians, and a second lamp across it. That strip is a park path, not a carriageway: no road-network edge lies within
  25 m of (−2839.7, 1510.2).
- **Park Nad Wartą** (`lamp-war-1-midnight.png`): lamp on the pavement with three pedestrians in its light, lawn behind.

**Not resolved:** the 122 `onLawn` lamps 1.0–1.59 m inside narrow-walk parks are the ones the backlog item is about. Only the
block-212 doc-camera lamp is a verified lawn lamp; the other sampled lamps (13 of 3,390) stand on walks. No lamp trunk
overlapped a building, tree or road in any frame opened.

**Lamp count:** not a defect. `docs/observations/park-lamps-trees-2026-11-14.md` records 3,438 sites after its fix and the
build now logs 3,390 lampposts (`[cityGrid] 296 benches, 3390 lampposts, ...`); `docs/observations/tram-bed-surfaces-2026-11-14.md:236`
already records "Grid lamps 3,438 → 3,390 (48 dropped)". Consequently the "122 `onLawn` lamps" figure above (from the 3,438-site
audit) may be stale.

## 4. Street trees vs OSM, frame rate and draw calls

**Coordinates.** Pits are the instanced `1.7 × 0.22 × 2.6 m` boxes planted by `street-details.js`. Matching each pit to
`GEO.trees` (OSM nodes):

| region | OSM nodes | pits | pits within 0.3 m of an OSM node | rest |
|---|---:|---:|---:|---|
| Centre box x −350…350, z −350…350 around the Rynek | 453 | 712 | 302 (every match is < 0.3 m: 302 within 0.3 m and within 1 m) | 410 procedural rows (nearest OSM node > 1 m) |
| Around Park Cytadela x −800…900, z −2100…−800 | 4,026 | 1,496 | 362 | 1,134 procedural rows |

(The box is centred on the Stary Rynek but is not all Stare Miasto; the 453 nodes include courtyard and park nodes, which
get no pit. The pits that match no OSM node are procedural rows by design: mapped nodes replace procedural sites within 4 m,
`osm-street-trees-2026-11-08.md`.)

**Rendered trees.** A full LOD-0 instance read at the densest 50 m disc: every OSM node within 45 m has a rendered tree at
the same (x, z): `centrum-west` disc around (−318.5, −71.5) (a street avenue about 320 m west of the Rynek, not Stare Miasto): 36 of 36 nodes, nearest rendered tree 0.000 m (56 rendered
instances); `cytadela` disc around (−599.3, −1416.1) (inside the park): 172 of 172, 0.000 m (210 rendered).
(`/tmp/cc-browser-props/trees-osm.json`.)

**Visual.**
- `trees-stare-pit-overlay.png` (no overlay in this frame despite the name; the centrum-west avenue, not Stare Miasto): the camera aims at OSM node (−318.5, −71.5) (the pit under the centre of the frame); the
  trunk stands in the middle of its curb-edged soil pit, with more pit-and-trunk pairs in the avenue behind it.
- `trees-cytadela-osmpit.png`: aims at OSM node (−694.8, −1416.3), on a street outside the park; trunk centred in its pit; the left-hand pit shows a
  second trunk in its own pit.
- `trees-cytadela-procpit.png` (a pit 4.66 m from the nearest OSM node, i.e. a procedural row tree): same pit style.
  Not opened; it is only the contrast case.
- **Not resolved: an overlay in the frame.** I tried to draw cyan rings and poles at the OSM coordinates (`trees-*-overlay-top.png`,
  `trees-*-overlay-oblique.png`) but nothing drew in the WebGPU frame (the extra `Mesh` objects were added to
  `scene` and never appeared; cause not investigated). Those four shots show no markers and prove nothing; the position
  evidence above is numeric (instance matrices) plus the two aimed shots.
- `trees-stare-overlay-top.png`: from 45 m up, the avenue rows read as straight double lines of crowns over curb-edged pits.

**Frame rate and draw calls** (`?stats=1&quality=high`, WebGPU, 1280 × 720, player on foot, chase camera; 6 s warm-up then
10 s window; `/tmp/cc-browser-props/perf.json`; the main.js patch's per-frame traversal is switched off during these
runs). Another agent's Chrome was running concurrently, so treat CPU times as an upper bound:

| view | fps (rAF) | CPU frame | draw calls | triangles | GPU memory |
|---|---:|---:|---:|---:|---:|
| Street, Stary Rynek (0, 60) (`perf-street-rynek.png`) | 60.0 (p95 16.7 ms) | 9.4 ms | 946 | 6.43 M | 348 MB |
| Street, centrum-west avenue (−314, −71) (`perf-street-centrum.png`) | 60.0 | 8.5 ms | 846 | 6.68 M | 349 MB |
| Street, Park Cytadela interior (−595, −1416) (`perf-street-cytadela.png`) | 60.0 | 7.1 ms | 754 | 11.29 M | 352 MB |
| Drone preset, player in Park Cytadela (`perf-drone-cytadela.png`) | 60.0 | 13.3 ms | 1,086 | 8.07 M | 362 MB |
| Drone preset, player at the Rynek (`perf-drone-rynek.png`) | 60.0 (p95 16.8 ms) | 14.9 ms | 1,236 | 9.94 M | 365 MB |

The frame rate is pinned to the 60 Hz vsync (no dropped frame in any window); the headroom shows as CPU frame time
(7–15 ms of 16.7). GPU time is not measured. The JS heap reads **2.78–2.89 GB of 4.19 GB** in the panel; that is not new
here (see the perf-heap records), only noted. Scene counts logged at boot: 117,964 trees (32,744 OSM mapped).
The perf `.png` files were not opened individually.

## 5. Black locust wind — plausible, amplitude small; not resolved for strong gusts

The locust at (35.8, 370.5), 20 m (`Trees_robinia_v0_lod0_0,1`, confirmed from the instance matrices), framed from
(35.8, 2, 348.5) looking at the crown. Park Chopina's trees surround it, so other crowns share the frame. Two sequences:
12 frames about 0.65 s apart (7.2 s, `locust-wind-00…11.png`) and 16 frames about 0.18 s apart (2.7 s,
`locust-burst-00…15.png`), sheets `locust-wind-sheet.png` (frames 0, 2, 4, 6, 8, 10) and `locust-burst-sheet.png`
(frames 0, 3, 6, 9, 12, 15), cropped to the crown.

- The trunk and main limbs stay put; the crown moves as one: phase correlation of the crown crop against frame 0 gives a
  drift of at most 2 px horizontally and 6 px vertically (≈ 5 cm and ≈ 15 cm at this distance) over 2.7 s.
- Leaf sprays flutter independently: 11–25 % of pixels change by more than 24 grey levels between consecutive frames (0.18 s and 0.65 s apart)
  and the whole-crop correlation peak is only 0.04–0.3, while the branch silhouette stays recognisable. In the sheets the
  leaf cards visibly shift and re-rotate, branch tips lean a few pixels, no card pops, tears or jitters between frames.
- In the 7.2 s sequence the frame-to-frame difference grows from ≈ 14 to ≈ 27 mean grey levels, the build-up of the
  `gust` term (`js/tsl-materials.js:1677`, period ≈ 12.6 s).

Verdict: foliage and branch motion looks plausible (a gentle rock plus leaf flutter). **Not resolved:** the strong-gust
phase (a full 12.6 s period was not sampled), and whether branches move independently of the foliage (the stills cannot
separate them). The frames do not show the full tree; only the crown is judged.

## 6. Pedestrians on carriageways (462cd6f)

- Visual: none seen on a carriageway in any cited frame. Pedestrians in `lamp-kas-1-midday.png` stand on the asphalt path
  discussed in §3, and the pedestrian on the park-road asphalt in `lamp-cyt-1-midday.png` (lamp at (94.9, −1183.9)) is on
  a way with no road-network edge within 25 m (queried in the page): neither is a vehicle carriageway.
- Sweep: the real simulation at nine of the visited sites (Dworzec Zachodni (−1690, 790), Żniwna (−505, −1778), EC Garbary
  (700, −900), block 212 (−953, −1928), Park Cytadela (−599, −1416), Kasprowicza (−2840, 1510), Nad Wartą (600, 2000),
  centrum-west (−318, −71), Rynek (0, 60)), 90 s of 1 s steps each, every placed pedestrian each second tested against the
  `audit-ped-roadway.mjs` "span" oracle (lane centres ± 1 m per edge) outside crosswalk rectangles: **0** offences in
  9 × 30,600 = 275,400 ped-seconds (`/tmp/cc-browser-props/peds-roadway.json`). The oracle flagged 40 of 200 sampled cars
  as on a carriageway, so it is live, but it ignores the junction connector curves. Only 17 of the 340 pedestrians were
  within 100 m of the player at the last site, so the per-site coverage is the pedestrians near the player plus the rest of the
  pool wherever it stands.

## Not resolved

- The strong-gust phase of the locust wind, and branch-against-foliage motion.
- An overlay of OSM tree points inside the rendered frame (the markers never drew); the position comparison is numeric.
- Most lamps in narrow-walk parks that were moved onto lawns: none verified (the b212 lamp is on a median); the 122 figure may be stale.
- Car approach to the viaduct-deck shelter (sh4) from behind.
- GPU frame time (the headless frame rate saturates at 60 Hz).
