# Lighter heavy props: hydrants, lamp masts and the rest of the instanced street furniture (2026-11-11)

The 2026-11-11 draw-call audit found `StreetDetails` at 164 draws for 2.27 M submitted triangles and noted that
hydrants alone are 1.37 M built triangles and that hydrants plus lamp masts would be > 7 M if baked. This change
reduces the geometry of the highest-triangle street furniture where the removed detail is below a pixel at street
viewing distances: lamp masts, hydrants, gas lanterns, bollards and advertising columns. It does not change placement,
footprints, colliders, materials, draw calls or the instancing structure.

## Method

- **Harness:** `.agent-task/perf-harness/` (scratch, not production). `make-perf-main.mjs` regenerates the
  instrumented `perf-main.js` from the tree's `js/main.js` and imports the production modules directly; `run-perf.mjs`
  drives headless Chrome (`WebGPU`, 1280 × 720) and `compare-shots.mjs` does the pixel diff. The baseline is a pristine
  `git archive 586fbcc` tree in `.agent-task/baseline/` served on its own port.
- **Inventory and submitted triangles:** every mesh gets an `onBeforeRender` hook after the build. A draw is counted
  in the scene or shadow bucket from the camera type, and the triangle count is `geometry triangles × instance count`.
  The animation loop captures one real frame on request (calling `renderPipeline.render()` outside the loop only draws
  the final quad in this three.js build). Chunked meshes aggregate by (root, triangles/instance, material colour,
  instanced/plain), which is enough to identify every furniture kind. Shadow stand-ins share one black material, so
  the baked prop cells are reported as one aggregate.
- **Views:** Rynek street `(0, 10, 140) → (0, 9, 0)`, 60° and Centrum drone `(-1150, 320, 900) → (-1100, 0, 0)`, 55°.
  `sim=0`, camera frozen, traffic and trams not updated. The triangle counts are deterministic across runs.
- **CPU / frame time:** 4 s after a 3 s settle, at 60 Hz and at 6× CDP CPU throttle. Two high-tier runs are reported
  because renderer CPU has 10–20 % run-to-run spread at 6×; draw calls and triangles do not vary.
- **Deterministic screenshots:** `?detsky=1&sim=0` freezes the sky (`sky.cloudSpeed = 0` plus a PMREM re-bake), hides
  trees, traffic and trams, and hides the HUD. SSR and bloom stay on at high, so the comparison includes the
  production look. A second baseline run is bit-identical (0 pixels on the 2 m hydrant and the Rynek street).
- **Views for the close-ups:** the hydrant nearest Stary Rynek at 2 m, 10 m and 40 m; a second hydrant at 2 m; the
  nearest LED mast at 12 m; the nearest advertising column at 4 m.

## Inventory (before / after, built geometry)

The browser build (full landmark/bridge colliders) has 23,193 LED masts, 5,144 hydrants, 1,074 gas lanterns, 1,981
bollards, 725 post boxes, 634 parking machines, 210 kiosks, 186 flower stands and 341 advertising columns. `before`
is `586fbcc`; `after` is this change. The built total over all 31 instanced `StreetDetails` meshes is
**10,215,136 → 5,790,706 triangles (−43.3 %)**.

| prop | instances | tris/instance before → after | built before | built after | saved |
|---|---:|---:|---:|---:|---:|
| LED mast + luminaire | 23,193 | 284 → **120** | 6,586,812 | 2,783,160 | −3,803,652 |
| hydrant body | 5,144 | 266 → **186** | 1,368,304 | 956,784 | −411,520 |
| hydrant band | 5,144 | 20 → 20 | 102,880 | 102,880 | 0 |
| gas lantern | 1,074 | 268 → **176** | 287,832 | 189,024 | −98,808 |
| gas lantern glass | 1,074 | 16 → 16 | 17,184 | 17,184 | 0 |
| bollard | 1,981 | 88 → **56** | 174,328 | 110,936 | −63,392 |
| bollard ring | 1,981 | 16 → 16 | 31,696 | 31,696 | 0 |
| advertising column frame | 341 | 384 → **246** | 130,944 | 83,886 | −47,058 |
| column poster drum | 341 | 40 → 40 | 13,640 | 13,640 | 0 |
| post box body | 725 | 52 → 52 | 37,700 | 37,700 | 0 |
| post box post + slot | 725 | 44 → 44 | 31,900 | 31,900 | 0 |
| post box band | 725 | 2 → 2 | 1,450 | 1,450 | 0 |
| parking machine | 634 | 24 → 24 | 15,216 | 15,216 | 0 |
| parking P panel / screen | 634 | 2 / 2 | 2,536 | 2,536 | 0 |
| press kiosk | 210 | 24 → 24 | 5,040 | 5,040 | 0 |
| kiosk sign band / glass | 210 | 12 / 4 | 3,360 | 3,360 | 0 |
| flower stand / shelf | 186 | 24 / 24 | 8,928 | 8,928 | 0 |
| tree pit curb | 34,344 | 12 → 12 | 412,128 | 412,128 | 0 |
| tree pit soil | 34,344 | 12 → 12 | 412,128 | 412,128 | 0 |
| tree grates (+ flower shelf key) | 5,564 | 24 → 24 | 133,536 | 133,536 | 0 |
| S-1 signal housing | 1,291 | 96 → 96 | 123,936 | 123,936 | 0 |
| S-1 lenses (3 × 16) | 1,291 | 48 → 48 | 61,968 | 61,968 | 0 |
| pedestrian signal housing | 1,937 | 48 → 48 | 92,976 | 92,976 | 0 |
| pedestrian signal panels | 1,937 | 4 → 4 | 7,748 | 7,748 | 0 |
| signal poles | 2,292 | 40 → 40 | 91,680 | 91,680 | 0 |
| signal backplates / borders | 594 | 12 / 12 | 14,256 | 14,256 | 0 |
| name plates: faces / backs | 222 | 2 / 12 | 3,108 | 3,108 | 0 |
| LED lenses + plate faces (shared key) | 23,415 | 2 → 2 | 46,830 | 46,830 | 0 |

## What changed

- **LED mast + luminaire (284 → 120 triangles):** the taper shaft and the base flange are open where their caps are
  hidden inside the other part; the base keeps its visible top cap. The 2.8 m bent arm uses a 6 × 4 tube instead of
  12 × 8 (192 of the old 284 triangles). The shaft keeps its 10-sided silhouette and the luminaire housing is
  untouched. The arm is 8.6 m up and 5.5 cm thick; the faceting is below a pixel at the 10–12 m viewing distance of
  the fixture. The same geometry feeds the direct chunks and the instanced shadow stand-in.
- **Hydrant (266 → 186):** the barrel and upper ring are open at their hidden ends (foot flange top, band and dome
  cover them); the 26 cm dome keeps 10 radial sides but 3 height rings instead of 5; the operating nut and the side
  outlet keep their caps. The outline and band are unchanged.
- **Gas lantern (268 → 176):** the 2.55 m shaft and collar are 8-sided and open inside the base/lantern; the 4 cm
  finial is a 6 × 4 dome. The four-sided glass lantern is untouched.
- **Bollard (88 → 56):** the post is open inside the pavement and the cap; the cap has 3 height rings instead of 4.
- **Advertising column frame (384 → 246):** the plinth and cornice are 14-sided (was 16) and the 0.55 m dome has 4
  height rings (was 6); the 20-sided poster drum is untouched because its curve is what reads up close.
- No LOD, mesh split, instanced-buffer change or scene-culling change was added. Draw calls, materials, footprints,
  colliders and instance matrices are unchanged.

## Before / after at the two views

Full frame: `renderer.info.render` with `autoReset = false`, one representative run per arm. Draws are
scene + shadow + post for the frame; the scene/shadow split is the sum of the per-draw hooks. CPU is renderer CPU
inside `renderPipeline.render()`; the high rows give two runs. GPU is the median timestamp query; it is a ratio, not
an absolute time.

| Arm | View | Scene tris | Shadow tris | Total tris | Draws | Render CPU 60 Hz | Render CPU 6× | Frame 6× | GPU p50 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| high before | Rynek | 6,415,912 | 4,568,837 | 10,979,956 | 1,454 | 10.14 / 9.40 | 81.28 / 68.16 | 88.0 / 73.9 | 30.3 / 33.6 |
| high after | Rynek | 5,410,842 | 4,288,587 | **9,694,636 (−11.7 %)** | 1,454 | 11.62 / 9.79 | 86.59 / 69.58 | 93.4 / 75.5 | 33.2 / 37.1 |
| high before | Centrum drone | 8,435,434 | 5,528,069 | 13,958,838 | 2,726 | 19.32 / 17.52 | 125.36 / 115.89 | 126.0 / 123.7 | 52.6 / 51.3 |
| high after | Centrum drone | 7,199,664 | 4,918,771 | **12,113,770 (−13.2 %)** | 2,726 | 21.82 / 17.53 | 142.94 / 114.63 | 153.1 / 122.2 | 54.8 / 51.9 |
| low before | Rynek | 6,335,106 | 3,178,965 | 9,509,260 | 1,002 | 7.53 | 57.57 | 63.5 | 8.2 |
| low after | Rynek | 5,330,036 | 3,052,303 | **8,377,528 (−11.9 %)** | 1,002 | 7.52 | 54.64 | 60.4 | 8.4 |
| low before | Centrum drone | 7,264,252 | 3,147,125 | 10,406,694 | 1,374 | 9.70 | 65.53 | 71.6 | 7.7 |
| low after | Centrum drone | 6,028,482 | 2,889,007 | **8,912,806 (−14.4 %)** | 1,374 | 9.30 | 63.73 | 69.3 | 7.7 |

Draw calls are identical in every row. Renderer CPU and 6× frame time move within the run-to-run spread at 60 Hz
(the work is per draw, and the draw count did not change); there is no CPU regression to attribute to the geometry.
GPU memory is 390.3 → 389.1 MB high, 223.3 → 223.2 MB low (the geometries are citywide instanced meshes, so the
1.5 M triangle cut is mostly vertex work, not retained memory). Boot is 11.09 s before / 10.79–11.03 s after at high,
10.56 s / 11.66 s at low (run noise). The scene + shadow columns come from the per-draw hooks and differ from the
`renderer.info` total by < 5k triangles (draw-range edge cases); the total column is the renderer's own count.

### StreetDetails only

The counts below isolate the `StreetDetails` root plus the prop shadow stand-ins its geometry feeds. `proxy shadow`
includes the instanced mast stand-in (601 / 3,196 instances) and the merged baked prop cells, which also carry
unchanged cheap CityGrid/TramInfrastructure props; the remaining shadow triangles are trees, buildings, landmarks and
traffic, which this change does not touch.

| Arm | View | Scene | Direct shadow | Proxy / baked shadow |
|---|---|---:|---:|---:|
| high before | Rynek | 2,392,186 | 70,564 | 950,046 |
| high after | Rynek | **1,387,116 (−42.0 %)** | **51,204 (−27.4 %)** | **689,156 (−27.5 %)** |
| high before | Centrum drone | 2,785,942 | 63,116 | 1,762,145 |
| high after | Centrum drone | **1,550,172 (−44.4 %)** | **45,996 (−27.1 %)** | **1,169,967 (−33.6 %)** |
| low before | Rynek | 2,392,186 | — | 525,714 |
| low after | Rynek | **1,387,116 (−42.0 %)** | — | **399,052 (−24.1 %)** |
| low before | Centrum drone | 2,785,942 | — | 640,456 |
| low after | Centrum drone | **1,550,172 (−44.4 %)** | — | **382,338 (−40.3 %)** |

The lamp masts alone submit 1,503,780 → 635,400 scene triangles at Rynek and 1,938,584 → 819,120 at the drone
(5,295 and 6,826 instances); their instanced shadow stand-in is 170,684 → 72,120 and 907,664 → 383,520. Hydrants
submit 36,974 → 25,854 scene and 64,372 → 45,012 direct shadow at Rynek; 21,014 → 14,694 and 56,924 → 39,804 at the
drone. The gas lanterns submit 287,832 → 189,024 scene at both views; the column frames 24,960 → 15,990 (Rynek) and
31,104 → 19,926 (drone); the bollards 48,928 → 31,136 (Rynek). The position-baked prop shadow set is 1,209,256
triangles citywide, down from 1.42M, i.e. ~44 MB if every cell were uploaded.

## Deterministic screenshots

`?detsky=1&sim=0`, 1280 × 720, high tier, WebGPU unless marked. A second baseline run is 0 pixels on both the 2 m
hydrant and the Rynek street.

| View | Diff pixels | % of frame | Max channel | Mean channel |
|---|---:|---:|---:|---:|
| hydrant 2 m | 195 | 0.021 % | 179 | 0.059 |
| hydrant 2 m (second hydrant) | 384 | 0.042 % | 186 | 0.073 |
| hydrant 10 m | 7 | 0.001 % | 107 | 0.004 |
| hydrant 40 m | 7 | 0.001 % | 52 | 0.002 |
| mast 12 m | 193 | 0.021 % | 233 | 0.035 |
| advertising column 4 m | 171 | 0.019 % | 100 | 0.047 |
| bollard 2 m | 105 | 0.011 % | 93 | 0.019 |
| gas lantern 5 m | 76 | 0.008 % | 94 | 0.014 |
| Rynek street | **0** | 0 | 0 | 0 |
| WebGL2: hydrant 2 m | 214 | 0.023 % | 179 | 0.060 |
| WebGL2: hydrant 10 m | 330 | 0.036 % | 214 | 0.043 |
| WebGL2: Rynek street | **0** | 0 | 0 | 0 |

The diffs are single-pixel anti-aliasing changes on the dome/band and bend silhouettes; no surface colour, shadow
outline or material changed. The street view is bit-identical on both backends.

## Checks

- `node --test tests/*.cjs`: 519 passed, 0 failed (2026-11-11). `node --test tests/`: 535 passed, 0 failed.
- **Footprints and colliders unchanged:** the canonical hash over `streetDetails.colliders` (95,305 entries) is
  `edaeca01` before and after; `streetDetails.footprints` (35,547 entries) is `8dc7d027` before and after. The
  placement hash over every instanced matrix group is identical for all 123 groups; the only signature change is the
  column frame bounding box (1.32 → 1.29 m across, from the 14-gon), with the same matrix hash `60c71ddd`.
- **Console:** no errors or warnings in WebGPU or WebGL2, high or low, in the measurement or screenshot runs.
- **Draw calls:** 1,454 high / 1,002 low in both arms; scene/shadow/post split unchanged.
- The full `[init]` log and the raw run JSONs are in `.agent-task/base*.json`, `.agent-task/candidate*.json` and
  `.agent-task/shots*/`.

## Limits

- Headless Chrome on an Apple-silicon Mac: GPU timestamps are query ratios, and 6× CPU is a synthetic JS throttle,
  not a phone. CPU was not expected to improve and did not measurably do so.
- The per-draw accounting splits by camera type, so the two shadow cascades are summed; the merged prop shadow
  stand-ins are one aggregate because they share a position-only black material.
- No real phone, thermal soak, visual review on a second display or iOS Safari run. The WebGPU and WebGL2
  screenshots above are the browser evidence.
