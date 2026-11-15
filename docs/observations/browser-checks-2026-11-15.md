# Browser checks, 2026-11-15

Targeted headless Chrome walkthrough of the remaining signal-head checks in [`backlog.md`](../backlog.md#signals-traffic-and-audio), at `a397f13` on branch `agy-signal-shots`. Covers the remaining stop-line fallback overhead heads and the Most Teatralny pole-mounted heads on both WebGPU and WebGL2 (`?backend=webgl`).

## Environment and method

- Google Chrome 157 (`--headless=new --enable-unsafe-webgpu --enable-features=WebGPU --use-angle=metal`, 1280 × 720 desktop viewport), served via `python3 -m http.server 8170` with `Network.setCacheDisabled: true`.
- Driver: `.agent-task/capture-signals.mjs` via CDP, using `CityMapSystem.onTeleport` and a page-local `CameraSystem.prototype.update` hook (`window.__debugCamera`), with player meshes hidden and `midday` lighting selected.
- No production file under `js/`, `css/`, `tools/`, `index.html`, or `tests/` was modified.
- Screenshots and per-shot Most Teatralny state JSON logs are stored in `.agent-task/shots/` (git-ignored) and indexed in `.agent-task/shots/INDEX.md`. Every cited image was opened and inspected directly.

## Verdict summary

| Check | Verdict | Notes |
|---|---|---|
| Stop-line fallback overhead heads (`-3098, -120`, `2530, 2695`, `903, 1987`, `87, 1058`, `2197, -2126`) | **OK** | All 5 current remaining fallback heads visible from `pov` (`eyeY = 1.52 m`, `fov = 68°`) at position 1 and ~20 m back in both red and green phases on WebGPU and WebGL2. Note: `(3032.68, 2200.61)` from `fallback-head-sight-2026-11-14.md` now has `-15 m` / `-10.5 m` band heads on `a397f13`, bringing total fallback heads from 8 to 7. |
| Most Teatralny pole-mounted vehicle heads (`-1403.68, -250.40`, `-1355.53, -217.33`, `-1359.58, -201.85`) | **OK** | All 3 pole-mounted S-1 heads face their approaching drivers and match `updateSignal` state on WebGPU and WebGL2: Franklina Roosevelta (`plan 274`, `group0`) displays lit red matching `phase0: "red"`; Most Teatralny right curb and left repeater (`plan 381`, `disabled: true` after route pruning) are unlit matching `phase0: "off"`. |

## Detailed observations

### 1. Remaining stop-line fallback overhead heads — OK

On `a397f13`, `tools/audit-fallback-head-sight.mjs` reports 7 stop-line fallback heads (95 total overhead heads). Head `#3` in [`fallback-head-sight-2026-11-14.md`](fallback-head-sight-2026-11-14.md#the-8-fallback-heads) at `(3032.680, 2200.610)` is no longer a fallback (`runtimeHeads` near `(3032.68, 2200.61)` now places `-15 m` and `-10.5 m` `band: true` heads). With `(-3242, 1727)` and `(-2722, 2057)` already verified on 2026-11-14, the remaining 5 fallback heads were inspected from `pov` (`eyeY = 1.52 m`, `fov = 68°`) at position 1 (`2.75 m` before the stop line, pitched up to center the head) and `20.0 m` back along the approach lane, during both red and green phases on WebGPU and WebGL2:

- **`(-3097.93, -119.95)`** (`-3098_-120-{webgpu,webgl2}-{pos1,queue20m}-{red,green}.png`): Cantilever S-1 head clearly visible at position 1 and from 20 m back (including above a crossing tram on red); red and green lenses match phase on both backends.
- **`(2529.62, 2694.58)`** (`2530_2695-{webgpu,webgl2}-{pos1,queue20m}-{red,green}.png`): Cantilever S-1 head at `along = +0.031 m` clearly visible at position 1 when pitched up and from 20 m back directly above a queued grey saloon at the stop line on red; red and green lenses match phase on both backends.
- **`(902.78, 1986.65)`** (`903_1987-{webgpu,webgl2}-{pos1,queue20m}-{red,green}.png`): Cantilever S-1 head clearly visible at position 1 and from 20 m back; red and green lenses match phase on both backends.
- **`(86.81, 1057.88)`** (`87_1058-{webgpu,webgl2}-{pos1,queue20m}-{red,green}.png`): Cantilever S-1 head clearly visible at position 1 and from 20 m back (above a car at the stop line on WebGPU red and above a crossing tram on WebGL2 green); red and green lenses match phase on both backends.
- **`(2196.77, -2125.54)`** (`2197_-2126-{webgpu,webgl2}-{pos1,queue20m}-{red,green}.png`): Cantilever S-1 head clearly visible at position 1 and from 20 m back; red and green lenses match phase on both backends.

### 2. Most Teatralny pole-mounted heads — OK

All 3 pole-mounted vehicle heads near Most Teatralny (`node -1373, -213`) were framed from the approaching driver's direction (`fov = 45°`, `eyeY = 2.2 m`) with the live `updateSignal(elapsed, SIGNAL_PLANS[index])` state logged to JSON next to each shot:

- **Franklina Roosevelta north approach** (`-1403.68, -250.40`, `plan 274`, `group0`): An initial 10 m camera was obstructed by an advertising column; retaken at 5.5 m (`mt-roosevelta-n-webgpu.png`, `mt-roosevelta-n-webgl2.png`). The S-1 housing faces the approaching driver squarely and displays a lit top red lens on both backends, matching `expectedPhase: "red"` (`mt-roosevelta-n-webgpu.json`, `mt-roosevelta-n-webgl2.json`).
- **Most Teatralny right-curb pole** (`-1355.53, -217.33`, `plan 381`, `group0`): Framed at 10 m (`mt-teatralny-right-webgpu.png`, `mt-teatralny-right-webgl2.png`). The S-1 housing faces the approaching driver cleanly and all three lenses are unlit, matching `disabled: true` / `expectedPhase: "off"` (`mt-teatralny-right-webgpu.json`, `mt-teatralny-right-webgl2.json`).
- **Most Teatralny left-curb repeater** (`-1359.58, -201.85`, `plan 381`, `group0`): Framed at 10 m (`mt-teatralny-left-webgpu.png`, `mt-teatralny-left-webgl2.png`). The S-1 housing faces the approaching driver cleanly and all three lenses are unlit, matching `disabled: true` / `expectedPhase: "off"` (`mt-teatralny-left-webgpu.json`, `mt-teatralny-left-webgl2.json`).
