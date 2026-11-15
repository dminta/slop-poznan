# Shop-sign atlas mip isolation — 2026-11-15

The grazing-angle backlog check found a real filtering defect: the automatic mip chain of the 3612 × 400 atlas
can mix unrelated shop designs. The fix keeps one atlas, one material and one `ShopSigns` instanced draw, with
512 × 96 artwork, an 8 px background gutter and explicit isotropic LOD limited to 0–4.

## Measurement before changing production

Served this worktree with `python3 -m http.server 8160`; headless Google Chrome 157.0.8103.79 on macOS used
`--headless=new --enable-unsafe-webgpu --use-angle=metal`, CDP port 9360. Both the default WebGPU path and
`?backend=webgl` were exercised with `?quality=low`, 1280 × 720 CSS px, DPR 1 (960 × 540 internal rendering).
`Network.setCacheDisabled({cacheDisabled:true})` was enabled before each navigation.

The CDP harness found the live `CameraSystem` using `Runtime.queryObjects` and temporarily replaced its update
method for fixed eye/look framing. No inspection hook was added to production. Target: the APTEKA fascia at
world **(−1064.091, 4.680, 164.344)** on Św. Marcin, `signCell = (2, 0)`. Horizontal facade normal is approximately
(0.090579, −0.995889). Cameras stay at fascia height, looking at the same sign centre:

| Distance / angle from facade normal | Eye (x, y, z), metres |
|---|---|
| 20 m / 75° | (−1044.383, 4.680, 160.939) |
| 40 m / 80° | (−1024.231, 4.680, 160.995) |
| 80 m / 85° | (−984.091, 4.680, 164.619) |

Exact unrounded poses are retained in `.agent-task/views.json`. Each view was captured at `midday` and `midnight`,
on both backends, before and after. The camera poses are matched; NPCs and tree wind continue to animate.
Some lettering is occluded by foliage or subpixel at 80 m, so screenshots alone cannot attribute edge RGB to a
particular neighbouring cell. The deterministic footprint check below establishes the defect and the fix.
The earlier Półwiejska/Rybaki scout frames were occluded and are not validation evidence.

The original observation claimed an extra 2 px inset into the artwork, but production actually mapped the full
512 × 96 tile. Even an extra 2 px inset would not isolate the coarsest automatic levels.

## Deterministic filtering check

`.agent-task/mip-check.mjs` computes a one-dimensional box-reduction reference, then bilinearly samples both
artwork edges of every cell. It measures the sample weight outside that cell, separately in x and y.
The result is a footprint calculation, not measured screenshot RGB; Chrome's NPOT mip-reduction kernel need
not match this box reference bit for bit. Nonzero weights demonstrate that the original atlas is not isolated.

| Mip | Original worst neighbour weight, x / y | Fixed x / y | Selectable after fix |
|---|---|---|---|
| 0–2 | 0 / 0 | 0 / 0 | yes |
| 3 | 38.79% / 37.50% | 0 / 0 | yes |
| 4 | 47.22% / 46.88% | 0 / 0 | yes |
| 5 | 43.80% / 44.00% | 38.84% / 37.50% | **no** |

The task's “mip >= 2” warning is conservative: the old 516 × 100 cells align through level 2, where the gutter
is exactly half a mip texel. Level 3 is the first demonstrated isotropic contamination. Anisotropic sampling
also expands the footprint; the original anisotropy was 4. Padding alone cannot isolate a full automatic chain,
which ultimately reduces all 28 designs to one pixel.

## Fix and cost

`buildings.js` changes the gutter from 2 to **8 px**. A cell is now **528 × 112**, and the atlas is **3696 × 448**.
Every dimension and cell origin is divisible by 16. Through mip 4 each reduction box stays within one cell;
at level 4 the 8 px gutter places the artwork edge at the first cell-local texel centre. Bilinear samples at
any interior UV therefore use only that cell. Trilinear filtering blends two safe levels.

The shader computes `log2(max(1, max(fwidth(uv * artworkSize))))` and caps it at **4**, then uses TSL
`texture(...).level(signLod)`. `fwidth` is conservative on diagonal screen orientations. Anisotropy is **1** so
extra taps cannot extend the proved footprint. Mipmaps remain enabled; the coarse mixed levels are never sampled.
The canvas and normal texture upload lifecycle are retained on both backends.

| Resource | Before | After |
|---|---:|---:|
| Level-0 pixels | 1,444,800 | 1,655,808 (+14.6%) |
| RGBA8 bytes including complete mip chain | 7,705,056 | 8,830,824 |
| Texture footprint | 7.35 MiB | 8.42 MiB |
| Sign textures / materials / draws | 1 / 1 / 1 | 1 / 1 / 1 |
| Per-instance data and streaming CPU work | unchanged | unchanged |

This is a small bounded sampler change rather than a new texture representation or multi-sample shader.
The tradeoff is softer grazing lettering from isotropic filtering; beyond mip 4 the cap can alias fine text.
The 32 × 6 artwork mip remains available, and the full-size close artwork is unchanged. This was a still-frame
check, not a temporal shimmer benchmark.

## Verification and evidence

- `node --test tests/`: **631 passed, 0 failed**, 118.35 s.
- Focused shop-sign / city-text suites: **8 passed**. The new regression enumerates reduction/bilinear support
  for all cells and selectable mip levels, including UV boundaries, and checks that the material uses the capped
  sampler without anisotropic taps. No source-slice marker or shared TSL module changed.
- Before/after screenshots: `.agent-task/shots/{before,after}-{webgpu,webgl2}-sw-marcin-{20m-75deg,40m-80deg,80m-85deg}-{midday,midnight}.png`.
  The 24 frames use identical camera poses and viewport settings. The repeated WebGL2 baseline supplied the original
  HEAD `buildings.js` through CDP Fetch while serving the remaining worktree normally; production files were not
  reverted on disk. The initial baseline was captured before editing production.
- All four before/after backend runs had **zero page exceptions, shader warnings or warning/error-level console
  and browser log messages**. WebGPU and WebGL2 both displayed the same cell designs and lit night fascias;
  the fixed grazing lettering is softer, as expected from isotropic sampling.
- Drivers, full console events and raw mip rows are in `.agent-task/`; see `.agent-task/REPORT.md` for the completed
  backend checks and cleanup. Screenshots are scratch artifacts excluded from git.
