# Browser checks: black locust wind motion in a strong-gust phase — 2026-11-19

Completion of the outstanding black locust wind browser check from [browser-checks-props-2026-11-17.md](browser-checks-props-2026-11-17.md#5-black-locust-wind--plausible-amplitude-small-not-resolved-for-strong-gusts) at `bc9a2d2` (`poznan`). No production `js/`, `css/`, `tools/` or `index.html` file was modified.

## 1. Wind and gust math (`js/tsl-materials.js`, `js/trees.js`)

In `createTreeMaterial` (`js/tsl-materials.js:1632–1690`), `positionNode` drives all trees with `time` (`renderer._nodes.nodeFrame.time` in seconds) after `instanceMatrix` (`p = positionLocal`, `g = positionGeometry` in unscaled tree-model metres):

| Term | Formula | Period / wavelength | Target & weighting | Peak amplitude (at `g.y = 11 m`, `aTree.z = 1`) |
|---|---|---|---|---|
| `gust` | `0.5 * sin(0.5 * time - dot(p.xz, TREE_WIND) * 0.045) + 0.5` | `T_gust = 4*pi = 12.5664 s`; `lambda = 139.63 m` along `TREE_WIND = (0.86, 0.51)` (`11.11 m/s`) | City-wide rolling gust field | `[0.0, 1.0]` |
| `strength` | `gust^2 * 0.7 + 0.3` | `12.5664 s` (broad trough, sharper peak) | Scales `sway`, `bob`, `flutter` | `0.30` (trough) .. `1.00` (peak) |
| `lean` | `(sin(0.85 * time + phase) * 0.45 + 0.55) * strength * 0.2` | `T_lean = 2*pi/0.85 = 7.3920 s` | Downwind XZ (`TREE_WIND`), `bend = (g.y / 11.0)^2` | `+0.006 m` (trough min) .. `+0.200 m` (peak max) |
| `rock` | `sin(0.67 * time + phase * 1.7) * 0.06 * strength` | `T_rock = 2*pi/0.67 = 9.3779 s` | Cross-wind XZ, `bend = (g.y / 11.0)^2` | `+/-0.060 m` at `strength = 1` |
| `bob` | `sin(2.1 * time + 0.9*g.x + 0.7*g.z + phase) * 0.05 * aTree.z * strength` | `T_bob = 2*pi/2.1 = 2.9920 s` | Vertical (`+y`), bark + leaves via `aTree.z` | `+/-0.050 m` at `strength = 1` (`+/-0.015 m` at `0.3`) |
| `flutter` | `sin(8.0 * time + 37.0*aTree.w + 2.0*g.y) * 0.03 * isLeaf * aTree.z * (strength + 0.25)` | `T_flutter = 2*pi/8.0 = 0.7854 s` (`1.273 Hz`) | Leaf cards only (`isLeaf = aTree.x = 1`; `0` on bark), along `normalLocal` | `+/-0.0375 m` at `strength = 1` (`+/-0.0165 m` at `0.3`) |

In `js/trees.js` (`swayWeight`, `addTube`, `addCard`), `aTree.z` rises monotonically along the skeleton (`0` on the trunk, `0.18 * t` on scaffold limbs, `0.18 + 0.4 * t` on branches, `0.58 + 0.4 * t` on twigs, and `0.80..1.00` from base to tip of each leaf card), so branches and attached leaf cards share the continuous `sway + bob` field while only leaf cards receive `flutter`. Because `T_gust = 12.5664 s` and `T_lean = 7.3920 s` are incommensurate, consecutive gust peaks land at different `lean` phases: for our target tree, the peak at `t = 20.84 s` had `gust = 1.0` with low `lean` (`~0.045 m`), whereas the peak at `t = 33.41 s` aligned `gust = 1.0` with near-maximum `lean` (`0.192–0.198 m`).

## 2. Environment, framing and target tree

- **Browser:** headless Google Chrome (`--headless=new --enable-unsafe-webgpu --use-angle=metal --window-size=1280,720`, Apple M5 Pro, `ANGLE Metal Renderer: Apple M5 Pro`, CSS viewport `1280 × 577`, cache disabled), served over an ephemeral local HTTP server (`http://127.0.0.1:8390/`) with an in-memory `main.js` camera-pin and `nodeFrame.time` readout hook; no source file on disk changed.
- **Target black locust:** `Trees_robinia_v1_lod0_0,0`, slot `0`, at Stary Rynek `(10.500, 0.790, 94.100)` (`sx = 0.8896`, `sy = 0.9136`, `aTreeData.w = 3.79043` → `species = 3`, `rnd = 0.79043`, `phase = 4.966 rad`). Nearest neighbor tree is `22.0 m` away, leaving the planter base, lower trunk, scaffold limbs, bare upper bark stems and outer pinnate foliage clusters completely isolated against the square paving, Ratusz spire, Domki Budnicze, Wieża Wójtowska, Stary Rynek kamienice and clear sky.
- **Spatial gust phase at `(10.5, 94.1)`:** `dot(p.xz, TREE_WIND) * 0.045 = 2.5659 rad`. Gust peaks (`gust = 1.0`, `strength = 1.0`) occur at `t = 8.27 + 12.5664 * k` s (`20.84 s`, `33.41 s`); calm troughs (`gust = 0.0`, `strength = 0.30`) occur at `t = 14.56 + 12.5664 * k` s (`14.56 s`, `27.12 s`, `39.69 s`).
- **Camera & lighting:** `eye = (3.5, 4.4, 108.5)`, `look = (10.5, 6.0, 94.1)`, `fov = 46°` (`16.01 m` horizontal distance, vertical tree scale `~44 px/m`), `midday` (`Południe`, `sunDir = (-0.143, 0.868, 0.475)`), HUD hidden. Screen `+x` (`(0.899, 0, 0.437)`) aligns `0.996` with `TREE_WIND = (0.86, 0.51)`, projecting downwind lean almost purely left-to-right in screen pixels.
- **Console status:**
  - **WebGPU high (`/?quality=high`):** **0 errors, 0 warnings** (`1280 × 577` canvas, DPR `1`).
  - **WebGL2 low (`/?backend=webgl&quality=low`):** **0 errors, 0 warnings** (`960 × 432` internal buffer at `0.75×` pixel ratio, upscaled to `1280 × 577`).

## 3. Sampled sequences and phases

All displacements below are measured relative to the calm-trough baseline `cycle_02.png` (`gust = 0.000`, `strength = 0.300`, `lean = 0.0061 m`).

| Backend / tier | Sequence | Frames | Shader `time` span | `gust` range | `strength` range | `lean` range (at `11 m`) |
|---|---|---:|---|---|---|---|
| **WebGPU high** | Full cycle (`cycle_00..31`) | 32 | `13.641–27.889 s` (`14.25 s`) | `0.000–0.999` | `0.300–0.998` | `0.0061–0.1342 m` |
| **WebGPU high** | Peak-gust burst (`peak_00..17`) | 18 | `32.272–35.572 s` (`3.30 s`) | `0.734–1.000` | `0.677–1.000` | `0.0379–0.1976 m` |
| **WebGPU high** | Calm-trough burst (`calm_00..11`) | 12 | `38.955–40.988 s` (`2.03 s`) | `0.000–0.102` | `0.300–0.307` | `0.0431–0.0601 m` |
| **WebGL2 low** | Full cycle (`cycle_00..31`) | 32 | `13.700–27.953 s` (`14.25 s`) | `0.000–0.997` | `0.300–0.996` | `0.0061–0.1341 m` |
| **WebGL2 low** | Peak-gust burst (`peak_00..17`) | 18 | `32.343–38.022 s` (`5.68 s`) | `0.164–1.000` | `0.319–1.000` | `0.0090–0.1973 m` |
| **WebGL2 low** | Calm-trough burst (`calm_00..11`) | 12 | `39.034–42.721 s` (`3.69 s`) | `0.000–0.473` | `0.300–0.456` | `0.0328–0.0601 m` |

## 4. Separated measurements: landmark control, trunk, bare upper branches, and foliage tips

ROIs in `1280 × 577` image coordinates (verified on coordinate-grid overlays):
- `static_ratusz` `(255, 18, 325, 130)`: Ratusz spire/tower control (2D sub-pixel NCC).
- `trunk_low` `(626, 445, 654, 488)`: lower bole directly above the green planter (`g.y ≈ 0.4–1.3 m`, `bend ≈ 0.001–0.014`, `aTree.z = 0`).
- `trunk_top` `(630, 200, 645, 235)`: upper trunk cylinder below the first limb split (`g.y ≈ 7.1–7.9 m`, `bend ≈ 0.42–0.52`, `aTree.z = 0`).
- `upper_limb` `(634, 146, 658, 182)` and `upper_limb_tip` `(640, 114, 662, 138)`: bare ascending scaffold limb and top bare bark stem silhouetted against pure blue sky with zero leaf cards inside the ROI (`g.y ≈ 8.4–10.3 m`, `bend ≈ 0.58–0.88`).
- `foliage_top` `(664, 28, 712, 88)`, `foliage_right` `(692, 84, 752, 158)`, `foliage_left` `(522, 122, 582, 192)`: outer pinnate leaf-card clusters against pure blue sky (`g.y ≈ 10.8–12.4 m` at top, `aTree.z = 0.8–1.0`, `isLeaf = 1`).

### WebGPU high (`/?quality=high`)

| Region | Full cycle (`14.25 s`) | Peak-gust burst (`strength → 1.00`, `lean → 0.198 m`) | Calm-trough burst (`strength ≈ 0.30`) |
|---|---|---|---|
| `static_ratusz` (control) | `max\|dx\| = 0.000 px`, `max\|dy\| = 0.003 px` | `max\|dx\| = 0.000 px`, `max\|dy\| = 0.003 px` | `max\|dx\| = 0.000 px`, `max\|dy\| = 0.003 px` |
| **(a) `trunk_low`** (anchored) | `dx = [+0.00, +0.10] px` (`span 0.10 px`) | `dx = [+0.03, +0.23] px` (`span 0.20 px`) | `dx = [+0.03, +0.08] px` (`span 0.05 px`) |
| **(b) `trunk_top`** (bark only) | `dx = [+0.00, +2.00] px` (`max_step 0.82 px`) | `dx = [+0.10, +3.28] px` (`span 3.19 px`, `max_step 0.63 px`) | `dx = [+0.51, +1.00] px` (`span 0.49 px`) |
| **(b) `upper_limb`** (bare bark) | `dx = [+0.00, +3.86] px` (`max_step 0.92 px`) | `dx = [+0.95, +5.84] px` (`span 4.89 px`, `max_step 0.88 px`) | `dx = [+1.25, +1.88] px` (`span 0.63 px`, `max_step 0.20 px`) |
| **(b) `upper_limb_tip`** (bare bark) | `dx = [+0.00, +4.14] px` | `dx = [+1.01, +4.13] px` | `dx = [+1.14, +1.65] px` |
| **(c) `foliage_top`** (leaf cards) | `dx = [-0.01, +4.89] px`, `dy span 2.61 px`, `adj ΔRGB>24 = 12.74%` | `dx = [+1.45, +7.18] px`, `dy span 2.30 px`, `adj ΔRGB>24 = 11.68%` | `dx = [+1.51, +2.28] px`, `dy span 1.08 px`, `adj ΔRGB>24 = 7.16%` |
| **(c) `foliage_right`** (leaf cards) | `dx = [-0.20, +1.72] px`, `adj ΔRGB>24 = 23.97%` | `dx = [+0.38, +3.01] px`, `adj ΔRGB>24 = 26.96%` (max `32.34%`) | `dx = [+0.41, +0.90] px`, `adj ΔRGB>24 = 15.80%` |
| **(c) `foliage_left`** (leaf cards) | `dx = [-0.67, +1.37] px`, `adj ΔRGB>24 = 21.16%` | `dx = [-0.22, +2.04] px`, `adj ΔRGB>24 = 20.75%` (max `23.71%`) | `dx = [-0.44, +0.91] px`, `adj ΔRGB>24 = 14.19%` |

### WebGL2 low (`/?backend=webgl&quality=low`)

| Region | Full cycle (`14.25 s`) | Peak-gust burst (`strength → 1.00`, `lean → 0.197 m`) | Calm-trough burst (`strength ≈ 0.30–0.46`) |
|---|---|---|---|
| `static_ratusz` (control) | `max\|dx\| = 0.000 px`, `max\|dy\| = 0.002 px` | `max\|dx\| = 0.000 px`, `max\|dy\| = 0.002 px` | `max\|dx\| = 0.000 px`, `max\|dy\| = 0.002 px` |
| **(a) `trunk_low`** (anchored) | `dx = [+0.00, +0.06] px` (`span 0.06 px`) | `dx = [+0.00, +0.10] px` (`span 0.10 px`) | `dx = [+0.00, +0.04] px` (`span 0.03 px`) |
| **(b) `trunk_top`** (bark only) | `dx = [-0.06, +2.03] px` (`span 2.10 px`) | `dx = [-0.16, +3.04] px` (`span 3.20 px`, `max_step 0.83 px`) | `dx = [+0.20, +1.03] px` (`span 0.83 px`) |
| **(b) `upper_limb`** (bare bark) | `dx = [+0.00, +3.64] px` (`max_step 0.75 px`) | `dx = [-0.01, +5.47] px` (`span 5.48 px`, `max_step 0.97 px`) | `dx = [+1.09, +1.68] px` (`span 0.59 px`, `max_step 0.20 px`) |
| **(b) `upper_limb_tip`** (bare bark) | `dx = [-0.01, +3.75] px` | `dx = [-0.15, +4.70] px` | `dx = [+0.69, +1.88] px` |
| **(c) `foliage_top`** (leaf cards) | `dx = [-0.76, +4.66] px`, `dy span 3.04 px`, `adj ΔRGB>24 = 7.23%` | `dx = [+0.26, +6.85] px`, `dy span 3.53 px`, `adj ΔRGB>24 = 7.57%` | `dx = [+1.35, +2.22] px`, `dy span 0.95 px`, `adj ΔRGB>24 = 4.29%` |
| **(c) `foliage_right`** (leaf cards) | `dx = [+0.00, +2.54] px`, `adj ΔRGB>24 = 14.24%` | `dx = [+0.23, +3.43] px`, `adj ΔRGB>24 = 17.09%` (max `23.99%`) | `dx = [+0.54, +1.35] px`, `adj ΔRGB>24 = 10.62%` |
| **(c) `foliage_left`** (leaf cards) | `dx = [-0.68, +1.85] px`, `adj ΔRGB>24 = 14.28%` | `dx = [-0.26, +2.54] px`, `adj ΔRGB>24 = 15.43%` (max `20.48%`) | `dx = [+0.22, +0.78] px`, `adj ΔRGB>24 = 10.61%` |

## 5. Visual findings and backend comparison

- **Lower trunk vs upper limbs vs foliage tips:** Calm-vs-peak RGB overlays and `|peak − calm| × 4` difference maps confirm the root collar and planter stay anchored (`≤ 0.23 px`), bark displacement grows smoothly as `(g.y / 11)^2` up the trunk (`~3.2 px` at `trunk_top`) and bare upper scaffold limbs (`+5.84 px` WebGPU high / `+5.48 px` WebGL2 low at `upper_limb`), and outer foliage tips reach `+7.18 px` / `+6.85 px` horizontally while adding vertical `bob` (`2.30–3.53 px` span) and `1.27 Hz` independent leaf-card `flutter`.
- **Strong-gust amplification of leaf flutter:** Comparing matched burst intervals, frame-to-frame foliage pixel change (`||ΔRGB|| > 24`) increases substantially from calm trough to peak gust (`7.16% → 11.68%` on `foliage_top`, `15.80% → 26.96%` on `foliage_right`, `14.19% → 20.75%` on `foliage_left` on WebGPU high; `4.29% → 7.57%`, `10.62% → 17.09%`, `10.61% → 15.43%` on WebGL2 low).
- **Continuity and shadows:** Across all 62 captured frames per backend, all limb/branch/twig junctions stay connected with smooth frame-to-frame steps (`max_step ≤ 0.97 px` on `upper_limb` in peak burst) and zero popping, card detachment, or tearing. On WebGPU high, the dappled crown shadow on the Stary Rynek paving visibly sways in lockstep with the crown. On WebGL2 low, wind kinematics match WebGPU high; lower raw `adj ΔRGB>24` percentages reflect the `0.75×` render scale (`960 × 432` upscaled) softening fine leaf edges, and tree shadows are omitted (`shadowCasters: false`) as designed for the `low` tier.
