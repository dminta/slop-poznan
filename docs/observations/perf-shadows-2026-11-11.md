# Re-rendering the sun shadow cascades less often (2026-11-11)

## Question

After the draw-call work the sun shadow pass is still **44 % of all draws** at high Rynek (610 of 1,381), 50 % at the
Centrum drone view (1,324 of 2,635) and 29 % on low Rynek (267 of 934). The sun only moves when the time-of-day preset
changes, and almost every shadow caster is static (frozen matrices), so re-rendering both cascades every frame is mostly
redundant. Can the cascades be refreshed only when needed, without visible popping, swimming, lagging dynamic shadows or
stale shadows after a time-of-day change or a teleport?

## What the pinned three.js does

The app pins `mrdoob/three.js@0a980dc` (see `index.html`). The relevant path is
`SunLight` → `SunLightNode` → `SunShadowNode` + `SunLightShadow`:

- `LightShadow` has `autoUpdate` (default `true`) and `needsUpdate` (default `false`). `ShadowNode.updateBefore`
  renders only when `shadow.needsUpdate || shadow.autoUpdate`; one render call can cover every camera in a frame. The
  flags gate the **whole** shadow node, not one cascade.
- `SunLightShadow` owns 2 cascade cameras and a **2 × 1 atlas** (`mapSize` per tile, `_frameExtents = (2, 1)`). Its
  `updateMatrices()` fits each cascade to the view frustum, snaps the centre to the texel grid, and writes the cascade
  matrices, frustum, viewports and fade-band data. There is no per-cascade dirty flag.
- `SunShadowNode.renderShadow()` calls `renderer.clear()` **once**, then renders each cascade into its viewport of the
  atlas. `renderer.clear()` clears the whole render target: the WebGPU backend's clear is a render-pass `loadOp:
  Clear`, not a scissor-limited clear. Rendering one tile without the clear keeps stale depth from moving casters
  (ghost shadows), because the depth test never overwrites fragments that are farther than the old ones.
- The atlas tile viewport is inset by `(ceil(radius) + 1) / mapSize` texels on every side, and the fitted radius is
  padded by `1 / (1 - 1 / resolution)`, where `resolution = mapSize * (1 - 2 * inset)`. Shadow matrices and filters
  therefore work in **tile-local** coordinates.

## Strategy

`CadencedSunShadowNode` in `js/lighting.js` subclasses `SunShadowNode` and makes three changes:

1. **One depth map per cascade instead of the atlas.** The shader graph copies the addon's two-cascade walk, PCF filter,
   fade bands and texel-snapped matrices, but samples each cascade from its own depth texture. Two `mapSize²` maps use
   the same depth storage as the old `2 × mapSize` atlas (and are depth-only on WebGPU, dropping the old colour
   attachments), and each can be cleared and rendered on its own.
   The matrices keep the atlas's inset projection and viewport so the image matches the baseline to float rounding.
2. **Cadence.** The near cascade renders every frame: the player, traffic, trams and pedestrians cast into it and must
   not lag. The far cascade renders every second frame (`SHADOW_FAR_STRIDE = 2`). The far cascade covers roughly
   80–300 m at street level and far more with altitude; a one-frame lag of a moving caster there is 0.2–1 m at most.
3. **Consistent stale tiles.** When a cascade is skipped, `renderShadow` restores the matrix it was rendered with. The
   shader then samples the cached tile in place; it is never re-projected onto a newer fit, which is what would make
   static shadows swim. A time-preset or quality change calls `reset()`, and a snapped-centre jump over 25 m (a teleport
   or a camera-preset change) refreshes the far cascade immediately. At the defaults a still or slowly moving camera
   never jumps that far; a full-speed helicopter covers ≈0.9 m per frame.

`planShadowCascades({ frame, farStride, reset, jump })` is the pure decision function; `tests/lighting.test.cjs` pins
the stride, reset and jump behaviour.

The scene-culling contract is unchanged: `scene-culling.js` still gets `shadow.getCamera(i)` / `getViewportCount()` and
puts the building and prop stand-ins on `SHADOW_PROXY_LAYER`; only the render-target layout and the far cadence differ.

## Measurements

Harness: `.agent-task/perf-harness/` (perf island, not production). `perf.html` + `perf-main.js` are a copy of the
current `js/main.js` with URL switches, per-frame `renderer.info` sampling, per-cascade draw counters around
`renderer.render`, frozen camera/path hooks and manual fixed-step frames; production `js/` modules are imported
directly. Headless Chrome 157 on an Apple M5 Pro, 1280 × 720, `devicePixelRatio` 1, WebGPU unless stated, golden
preset, dark page (`?clean=1`) and frozen clouds (`?detsky=1`). Baseline is a `git archive` of `586fbcc` served from
`/tmp/slop-poznan-shadows-base` on port 8124 with the same harness; the worktree runs on 8123. A fixed PRNG seed and a
clock reset make traffic, pedestrians and props identical across boots; `?hidetrees`/`?hidepeds` isolate shadow pixels
from leaf-wind and walk-cycle noise. Each sample is 3–4 s after a 2 s settle; 6× runs apply
`Emulation.setCPUThrottlingRate 6` after boot.

### Per-cascade draws (high, one frame with both cascades)

| View | Near | Far | Shadow total | Share of all draws |
|---|---:|---:|---:|---:|
| Rynek, street | 224 | 390 | 615 | 44 % |
| Centrum, drone 320 m | 227 | 1,114 | 1,341 | 51 % |
| Low Rynek | 93 | 170 | 263 | 28 % |
| Low Centrum drone | 89 | 403 | 492 | 38 % |

The far cascade is 63–83 % of the shadow pass, so halving it is the largest safe saving.

### 60 Hz (WebGPU, 1280 × 720)

Draws are all passes (scene + shadow + post); `render` is the CPU time inside `renderPipeline.render()`; `gpu` is the
summed three.js timestamp query (compare rows, not absolute values). Baselines and new runs are separate boots on the
same machine.

| Tier / view | Draws before → after | Shadow before → after | Render CPU before → after | Frame p50 / p95 | GPU before → after |
|---|---|---:|---:|---:|---:|
| High Rynek, still | 1,385 → **1,194** (−14 %) | 615 → **422** (−31 %) | 9.41 → **7.96** ms (−15 %) | 16.7 / 16.7 | 32.7 → 33.6 |
| High Rynek, walking 1.4 m/s | 1,363 → **1,159** (−15 %) | 595 → **393** (−34 %) | 8.69 → 8.07–9.23 ms (two runs) | 16.7 / 16.7 | n/c |
| High Rynek, 15 m/s | 1,388 → **1,192** (−14 %) | 613 → **417** (−32 %) | 9.62 → **8.12** ms (−16 %) | 16.7 / 16.7 | 33.3 → 32.0 |
| High Centrum drone, still | 2,644 → **2,087** (−21 %) | 1,341 → **784** (−42 %) | 16.63 → **13.41** ms (−19 %) | 16.7 / 16.8 | 52.5 → 49.1 |
| High Centrum drone, 60 m/s | 2,580 → **2,015** (−22 %) | 1,350 → **789** (−42 %) | 17.08 → **13.96** ms (−18 %) | 16.7 / 16.8 | 52.3 → 50.3 |
| Low Rynek, still | 929 → **847** (−9 %) | 263 → **180** (−32 %) | 7.28 → **5.90** ms (−19 %) | 16.7 / 16.7 | 7.13 → 7.17 |
| Low Rynek, 15 m/s | 925 → **845** (−9 %) | 261 → **181** (−31 %) | 7.07 → **6.41** ms (−9 %) | 16.7 / 16.8 | 6.54 → 7.11 |
| Low Centrum drone, still | 1,305 → **1,094** (−16 %) | 492 → **286** (−42 %) | 8.72 → **8.37** ms (−4 %) | 16.7 / 16.7 | 9.03 → 7.41 |
| Low Centrum drone, 60 m/s | 1,244 → **1,023** (−18 %) | 514 → **294** (−43 %) | 8.68 → 8.73 ms (noise) | 16.7 / 16.7 | 8.73 → 5.71 |

Every second frame keeps both cascades; odd frames keep only the near one. The averaged draw count above is therefore
lower than the per-frame `p50` (for example High Rynek still averages 1,194 with a 1,390-draw every-second-frame peak).

The there-and-back scene split (`?sunshadows=0` boots) is unchanged within actor-visibility noise: high Rynek 773 → 766
scene draws, high drone 1,302 → 1,309, low Rynek 663 → 663, low drone 811 → 816. The reduction is entirely in the
far cascade.

GPU timestamps do not move consistently: this Mac is not GPU-bound in these views, and the summed query varies by
1–2 ms between boots (the walking run was recorded under shared-machine load and is marked n/c). The saving is draw
submission and renderer CPU, which is the wall on slow CPUs.

### 6× CPU throttle

| Tier / view | Draws before → after | Render CPU before → after | Frame p50 before → after | Frame p95 before → after |
|---|---|---:|---:|---:|
| High Rynek, still | 1,381 → **1,191** | 76.3 → **57.4–59.8** ms (−22 to −25 %) | 99.9 → **66.7–83.2** ms | 100.1 → **70.4–83.4** ms |
| High Rynek, 15 m/s | 1,361 → **1,178** | 69.1 → **58.6–60.6** ms (−12 to −15 %) | 83.3 → **66.7** ms | 83.4 → 69.2–83.4 ms |
| High Centrum drone, still | 2,671 → **2,072** | 143.1 → **91.3–107.3** ms (−25 to −36 %) | 150.1 → **116.6–116.7** ms | 183.3 → **133.3–150.1** ms |
| Low Rynek, still | 922 → **835** | 55.9 → 59.3 ms | 66.7 → 66.7 ms | 83.3 → 83.4 ms |
| Low Centrum drone, still | 1,295 → **1,107** | 66.2 → 67.2 ms | 83.3 → 83.3 ms | 83.4 → 100.1 ms |

The high-tier renderer CPU and frame times improve clearly. The low 6× runs are **noise-dominated and show no gain**
(the same machine was shared with other browser runs; prior audit data already found the low scene not draw-limited at
6×). The low tier's 60 Hz numbers are consistent across four views, so the draw saving is real there; it does not
translate into 6× CPU time on this Mac.

### Memory and boot

| Metric | Before | After |
|---|---:|---:|
| GPU memory, high | 403.7 MB | **331.7 MB (−72.0 MB)** |
| GPU memory, low | 228.9 MB | **220.9 MB (−8.0 MB)** |
| Textures / attributes / storage, high | 253.6 / 109.2 / 36.0 MB | **181.6** / 109.2 / 36.0 MB |
| Shader programs, high / low | 287 / 267 | 287 / 267 |
| Render targets, high / low | 17 / 4 | 18 / 5 |
| Shadow map | 6144 × 3072 (2048 × 1024 low) | 2 × 3072² (2 × 1024² low) |

The WebGPU maps are **depth-only** (no colour attachment), which the shadow pass never samples. That removes the two
RGBA8 shadow colour textures: −72 MB on high (two 3072²) and −8 MB on low (two 1024²). The old atlas had a colour
attachment, so this is a real saving rather than a trade; the depth storage is the same. The WebGL2 fallback keeps a
colour attachment because the addon's depth-only framebuffer path is not used there. Boot `[init]` phases (blocks,
traffic, culling, compile, warm-up) stay within the run-to-run noise of the shared machine; no new shader programs are
compiled because the cascade shader is the same graph.

## Visual correctness

Deterministic frame sequences, 12–30 consecutive manual fixed-dt frames per view, compared with the every-frame
baseline. `max` is the largest per-channel difference (0–255), `mean` the mean absolute RGB difference, and `px>4` /
`px>16` the number of pixels above those levels. The baseline is a separate boot of `586fbcc` with the same seed and
frames.

| Comparison | max | mean | px > 4 | px > 16 |
|---|---:|---:|---:|---:|
| High Rynek still, traffic, trees hidden | 0 | 0 | 0 | 0 |
| High Rynek still, no traffic, full pipeline incl. SSR | 0 | 0 | 0 | 0 |
| High Rynek drive 27 m/s, cars/trams/peds | 11 | 0.000004 | 1 | 0 |
| High Rynek drive 27 m/s, peds hidden (cars/trams) | 11 | 0.000004 | 1 | 0 |
| High Centrum drone still, traffic | 133 | 0.0056 | 382 | 12 |
| High Centrum drone fly 60 m/s, traffic | 131 | 0.0097 | 1,086 | 15 |
| High Centrum drone still, static scene | 54 | 0.0060 | 390 | 6 |
| High Centrum drone still, midnight | 39 | 0.0008 | 69 | 13 |
| High Centrum street still | 11 | 0.00002 | 9 | 0 |
| High Centrum street drive 21 m/s | 106 | 0.0001 | 10 | 6 |
| Low Rynek still | 0 | 0 | 0 | 0 |
| Low Rynek drive 27 m/s | 1 | 0.00001 | 1 | 0 |
| Low Centrum drone still | 21 | 0.0009 | 21 | 7 |
| WebGL2 high Rynek still | 0 | 0 | 0 | 0 |
| Time preset Rynek → midnight (3 frames) | 0 | 0 | 0 | 0 |
| Camera jump Rynek → Centrum drone (3 frames) | 22 | 0.0019 | 28 | 1 |
| …back to golden (3 frames) | 10 | 0.0028 | 15 | 0 |

The Rynek still views are **exactly** the every-frame baseline, including with moving cars, trams and pedestrians, and
on the WebGL2 fallback; the Rynek drive view differs on one pixel at level 11. The remaining Centrum-drone residue is a
few hundred pixels on shadow edges (0.04 % of the frame above level 4, 0.002 % above level 16) and comes from the
separate maps' float-rounded projection; the same still image is stable from frame to frame. The moving-drone difference is the intended one-frame far-cascade lag: it stays under
0.01 mean and 15 pixels above level 16 even at 60 m/s. Time-of-day changes and camera jumps are exact or within the same
rounding residue on the first frame, so no stale shadow follows a teleport or preset change.

To check temporal behaviour rather than only distance to the baseline, consecutive-frame differences were computed for
the new and baseline sequences. At Rynek drive (27 m/s), Centrum drive (21 m/s) and the drone fly (60 m/s), the new
sequence's mean/max frame-to-frame difference is identical to the baseline's (for example drone fly mean 6.050 vs 6.050,
max 6.148 vs 6.148, max pixels above 16 137,482 vs 137,472). The drone still sequence is slightly quieter (0.0038 vs
0.0040 mean per frame). There is no popping or 30 Hz stepping visible in the sequence statistics.

A stride experiment showed stride 3 and 4 remain close (`Centrum drone still: mean 0.0049 / 0.0085, max 233 / 919
pixels above 4`), but they update far dynamic shadows at 20 / 15 Hz; stride 2 was kept as the conservative choice within
the task's 2nd–4th-frame window.

## Rejected variants

- **Whole-pass `shadow.autoUpdate = false` + `needsUpdate`.** This is the only switch the addon exposes, and it stops
  both cascades. With a still or slowly moving camera the near cascade still has moving cars, trams and pedestrians:
  freezing it visibly freezes their shadows. The near cascade is 224–236 draws at high street level, so skipping it
  would be the larger win but fails the dynamic-shadow requirement.
- **Per-cascade refresh inside the 2 × 1 atlas.** The addon renders both cascades in one `renderShadow`; the only clear
  is `renderer.clear()`, which clears the whole atlas (WebGPU `loadOp: Clear`, no scissor-limited clear in this
  renderer). Rendering only one tile without the clear leaves the previous depth of moving casters in the other tile
  and in the updated tile's uncovered pixels (ghost shadows); clearing the atlas forces both cascades to render.
  Rejected.
- **Static/dynamic caster split (cached static map, dynamic casters drawn on top).** With one depth map the dynamic pass
  cannot clear last frame's dynamic depth without also clearing the cached static depth. Options were a second dynamic
  depth map (+36 MB per 3072² cascade, +72 MB for both, plus a second filter graph), copying the static map back every
  frame (~72 MB/frame of depth traffic at 60 Hz), or a per-tile depth clear the renderer does not provide. Not worth it
  once the near cascade updates every frame and the far lag is subpixel at 80 m or more.
- **"Only when the fitted frustum changed" as the whole policy.** Static shadows are view-independent: the map stores
  light-space depth, so camera motion alone does not invalidate them, and the restored matrix keeps them in place. But
  dynamic casters do change every frame, and the texel-snapped fit changes on almost every moving frame, so a pure
  fit-change gate degenerates to every frame while moving. The useful parts (teleport/reset detection and the far
  stride) are kept; the near cascade stays every frame for the actors.
- **Stride 3 or 4.** Measured diffs stay small (see above), but dynamic shadows in the far cascade would step at 20 / 15
  Hz. Stride 2 is the safer point with 63–83 % of the shadow pass still halved.

## What still does not move

The near cascade is still rendered every frame (224–236 draws high, 76–93 low), and it is 17–37 % of the shadow pass;
only a correct dynamic-caster path can reduce it. The scene pass is unchanged, the shadow stand-ins are unchanged, and
the low tier remains draw-bound at 6× on this Mac with no measurable CPU gain there.

## Checks run

- `node --test tests/` — 536 pass, 0 fail; `node --test tests/*.cjs` — 520 pass, 0 fail. The new cadence test is in
  `tests/lighting.test.cjs`.
- Browser boots: WebGPU high and low, WebGL2 (`?backend=webgl`), golden / midnight presets, full SSR+bloom and
  SSR/bloom off, with time-preset changes and camera jumps. No `error`, `warning` or `pageerror` console entries, no
  `[compile]` warnings.
- Deterministic still and moving frame sequences with per-frame pixel diffs (above), plus consecutive-frame diffs for
  popping/swimming.
- GPU memory, render targets and shader-program counts before and after; boot `[init]` phases.

Not measured: a real phone, an integrated-GPU laptop, thermal throttling, or the low tier's 6× CPU on an unloaded
machine. The far-cascade cadence is per frame, so far dynamic shadows update at half the display rate (30 Hz at 60 fps,
15 Hz on a 30 fps display); the captured sequences are 60 fps. GPU timestamps are summed query results and are only used
for row-to-row comparison.

## Reproduction

```sh
# worktree, port 8123; baseline is a git archive of 586fbcc with the same harness on port 8124
python3 -m http.server 8123
python3 -m http.server 8124   # in /tmp/slop-poznan-shadows-base

node .agent-task/perf-harness/run-shadows.mjs '{
  "port": 8123,
  "query": "quality=high&clean=1&detsky=1&manual=1&sim=0&ssr=0&bloom=0&hidetrees=1",
  "steps": [
    {"kind": "sequence", "label": "drive",
     "start": {"x": 0, "y": 10, "z": 180, "lx": 0, "ly": 6, "lz": 0, "fov": 60},
     "path": {"move": [0, 0, -0.45]}, "frames": 30, "dt": 16.6667, "sim": true,
     "shots": "/tmp/new-drive", "every": 1}
  ]
}'
```

`run-shadows.mjs` also takes `port`, `cpuAfterBoot`, `query` and `measure` / `jump` steps; `?farstride=N` overrides
the far cadence for A/B experiments. The harness and the `shots/`, `measure/` outputs under `.agent-task/` are scratch
files, not part of the site.
