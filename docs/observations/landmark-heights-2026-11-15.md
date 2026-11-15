# Landmark heights browser check, 2026-11-15

Targeted headless Chrome walkthrough of the landmark-height and silhouette check in [`backlog.md`](../backlog.md#world-and-landmarks), at `82181df` on branch `agy-landmark-shots`. Covers Iglica, Delta, Brama Poznania, Zamek Królewski, Teatr Wielki (portico and Pegasus), and Fara (front gable/cross from Świętosławska) on both WebGPU and WebGL2 (`?backend=webgl`).

## Environment and method

- Google Chrome 157.0.8103.79 (`--headless=new --enable-unsafe-webgpu --enable-features=WebGPU --use-angle=metal`, 1280 × 720 desktop viewport), served via `python3 -m http.server 8190` with `Network.setCacheDisabled: true`.
- Driver: `.agent-task/capture-landmarks.mjs` via CDP, using `CityMapSystem.onTeleport` and a page-local `CameraSystem.prototype.update` hook (`window.__debugCamera`), with player entity meshes hidden and `midday` (`Południe`) lighting selected.
- No production file under `js/`, `css/`, `tools/`, `index.html`, or `tests/` was modified.
- Screenshots are stored in `.agent-task/shots/` (git-ignored) and indexed in `.agent-task/shots/INDEX.md`. Every cited image was opened and inspected directly.

## Verdict summary

| Landmark | Verdict | Notes |
|---|---|---|
| **Iglica (Pawilon 11 MTP)** | **OK** | Full 70.0 m spire (13.0 m rotunda + lattice + mast/star) framed top to bottom from MTP avenue and aerial view on WebGPU and WebGL2 (`0` console errors). |
| **Biurowiec Delta** | **OK** | Full 43.5 m 11-storey triangular block + roof plant and 23.0 m 6-storey west wing framed from Towarowa/Składowa and above on WebGPU and WebGL2. |
| **Brama Poznania ICHOT** | **OK** | Corrected 16.3 m concrete monolith and diagonal glazed slit framed from east bank and above on WebGPU and WebGL2. |
| **Zamek Królewski** | **OK** | Full 43.0 m tower (with 30.0 m lower terrace), 21.0 m lower wing, and 28.0 m main palace block framed from Ludgardy lawn and above on WebGPU and WebGL2. |
| **Teatr Wielki (portico / Pegasus)** | **OK** | Six Ionic portico columns, 21.3 m pediment, and rearing bronze Pegasus (24.0 m wing tip) clearly readable from front square and above; 31.7 m fly tower and copper dome visible from above on WebGPU and WebGL2. |
| **Fara (Świętosławska)** | **OK** (minor geometry note) | North front, 37.8 m front gable, and 40.0 m finial/cross read cleanly down ul. Świętosławska between flanking kamienice on WebGPU and WebGL2; the 40.0 m cross is modelled as a `1 × 2.2 × 1 m` sandstone post rather than a cruciform cross. |

## Height comparison (world data vs. documented reference)

| Landmark | `GEO.landmarks.h` | Modelled `fitToSite` top | Documented real height | Street-shot pixel span (1280×720) | Comparison object in frame |
|---|---|---|---|---|---|
| **Iglica** | `64 m` | `70.0 m` (`js/landmarks-dworzec.js:321`) | `70.0 m` (Grupa MTP; `landmark-heights-2026-11-03.md`) | `447 px` (`y = 607 → 160 px`) | Pawilon 11 rotunda roof `13.0 m` (`103 px`) |
| **Delta** | `37.4 m` | `43.5 m` (`js/landmarks-towers.js:415`) | `43.5 m` (Ataner / Sipińscy) | `229 px` (`y = 490 → 261 px`) | Delta 6-storey west wing `23.0 m` (`124 px`; ratio `42.48 m`) |
| **Brama Poznania** | `18 m` | `16.3 m` (`js/landmarks-heritage.js:504`) | `16.3 m` (AD Artis / Architektura Murator) | `173 px` (`y = 451 → 278 px`) | Glazed viewing slit `15.7 m` (`166 px`; ratio `16.36 m`) |
| **Zamek Królewski** | `43 m` | `43.0 m` (`js/landmarks-heritage.js:477`) | `43.0 m` apex, `30.0 m` terrace (`mnp.art.pl`) | `507 px` (`y = 569 → 62 px`) | Lower viewing terrace `30.0 m` (`381 px`) |
| **Teatr Wielki** | `27 m` | `31.7 m` fly tower, `24.0 m` Pegasus (`js/landmarks-centrum.js:216,226`) | `31.7 m` fly tower, `21.3 m` pediment, `23.7–23.9 m` Pegasus (GUGiK lidar) | `298 px` to Pegasus (`y = 516 → 218 px`) | Portico pediment apex `21.3 m` (`267 px`; ratio `23.77 m`) |
| **Fara** | `40 m` | `40.0 m` cross, `37.8 m` gable (`js/landmarks-heritage.js:405`) | `37.8 m` gable, `39.0–39.2 m` cross (GUGiK lidar) | `328 px` (`y = 534 → 206 px`) | Front gable apex `37.8 m` (`312 px`; ratio `39.74 m`) |

Note on `GEO.landmarks.h`: the snapshot in `js/geodata.js` still carries pre-correction `h` values for Iglica (`64`), Delta (`37.4`), Brama Poznania (`18`), and Teatr Wielki (`27`), while `fitToSite` in `js/landmarks-*.js` scales each model to the corrected heights (`70`, `43.5`, `16.3`, `31.7`).

## Detailed observations

### 1. Iglica (Pawilon 11 MTP) — OK
- Street-level view along the open MTP fairground avenue (`eye = [-1700, 1.65, 455]`, `fov = 60°`; `iglica-street-webgpu.png`, `iglica-street-webgl2.png`) frames the entire 16-sided white rotunda, glass band, set-back upper drum, concave 14-panel steel lattice spire, mast, and gold star at 70.0 m without obstruction.
- Aerial view (`iglica-aerial-webgpu.png`) confirms the rotunda's four recessed glazed portals and the spire proportions relative to surrounding MTP exhibition halls.

### 2. Biurowiec Delta — OK
- Street-level view from across the Towarowa / Składowa intersection (`eye = [-1175, 1.65, 470]`, `fov = 52°`; `delta-street-webgpu.png`, `delta-street-webgl2.png`) frames both the 11-storey triangular block with its 43.5 m roof plant and the 6-storey 23.0 m west wing top to bottom.
- Aerial view (`delta-aerial-webgpu.png`) shows the two bare-concrete stair towers on the NNW face, the roof plant storey, and adjacent Towarowa brick buildings.

### 3. Brama Poznania ICHOT — OK
- Street-level view from the east bank (`eye = [1265, 1.65, -430]`, `fov = 55°`; `brama-street-webgpu.png`, `brama-street-webgl2.png`) frames the 16.3 m concrete monolith and diagonal glazed slit cleanly next to the neighbouring 4-storey building.
- Aerial view (`brama-aerial-webgpu.png`) shows both concrete halves, the glazed viewing slit with interior walkways, and the Cybina river channel.

### 4. Zamek Królewski — OK
- Street-level view from the Ludgardy lawn (`eye = [-240, 1.65, -15]`, `fov = 62°`; `zamek-street-webgpu.png`, `zamek-street-webgl2.png`) frames the full 43.0 m square tower with sandstone corner quoins, the 30.0 m lower viewing terrace with dark metal railings, the glazed top terrace, hipped red roof, and the lower wing.
- Aerial view (`zamek-aerial-webgpu.png`) confirms the 28.0 m main palace block with buttresses and the 21.0 m lower wing alongside the 43.0 m tower.

### 5. Teatr Wielki (portico and Pegasus) — OK
- Street-level front-square views (`teatr-street-webgpu.png`, `teatr-street-webgl2.png`, plus close-up `teatr-portico-pegasus-webgpu.png`) clearly show the stair podium, all six Ionic portico columns with capitals, the entablature, the 21.3 m triangular pediment, and the rearing bronze Pegasus (`scale = 0.68`, wing tip at 24.0 m) on the roof.
- Aerial view (`teatr-aerial-webgpu.png`) shows the portico and Pegasus in front of the green copper auditorium dome (25.6 m) and the 31.7 m zinc-roofed stage fly tower.

### 6. Fara (from ul. Świętosławska) — OK (minor geometry note)
- Street-level view looking south down ul. Świętosławska (`eye = [20, 1.65, 152]`, `fov = 56°`; `fara-street-webgpu.png`, `fara-street-webgl2.png`) frames the baroque north facade cleanly between the flanking kamienice: portal, lower-tier niche statues, upper storey, 37.8 m front gable, and 40.0 m finial all read clearly against the sky.
- Aerial view (`fara-aerial-webgpu.png`) shows the front gable and finial in front of the 37.0 m nave roof ridge and side aisles.
- **Minor geometry note:** In `js/landmarks-heritage.js:393`, the 40.0 m front cross is modelled as a single `1 × 2.2 × 1 m` sandstone box (`box(obj, 1, 2.2, 1, M.sandstone, 0, F.frontUpper + 4.8, fz - 0.2)`), so it reads as a rectangular post/obelisk finial rather than a cruciform cross.
