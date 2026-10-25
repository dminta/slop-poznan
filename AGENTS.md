# Slop New York

A no-build three.js Manhattan simulation (WebGPURenderer + TSL). `index.html` loads native ES modules from `js/`; three.js is
`three@dev` from jsDelivr via the import map, so APIs can drift between visits. Served as static files (GitHub Pages).

## Commands
- Tests: `node --test tests/` (~11 s, mostly the geodata rebuild); quick loop: `node --test tests/*.cjs` (<1 s). Node 22+.
- Serve: `python3 -m http.server 8000` from the repo root, then open `http://localhost:8000/` in a WebGPU browser (needs network
  for three.js).
- Rendering, shaders, lighting, culling and audio have no automated coverage: verify them in the browser and watch the console.

## Repo-wide rules
- **New `js/*.js` module**: add `<link rel="modulepreload" href="./js/<name>.js" />` to `index.html` (after the import map,
  before the stylesheet) and bump the preload count in `tests/boot.test.cjs` in the same commit.
- **Module syntax** in `js/`: column-0 `import * as X from '...';` / `import { a } from '...';` and a single `export { ... };`
  list at the end of the file (or `export const|function|class`). The vm test harness rejects other forms (default imports
  and exports, side-effect imports, `import.meta`, top-level `await`); details in `docs/testing.md`.
- **Source-sliced tests**: some tests cut functions out of `traffic.js`, `main.js` and `tsl-materials.js` by exact text and
  indentation. When you rename, re-indent or add free variables there, update the test markers and stubs in the same change.
- **`js/nyc-geodata.js` is generated**: change `tools/` or `tools/data/` and rebuild (`docs/geodata.md`).
- **CSS**: when `css/style.css` changes, bump its `?v=YYYYMMDD-<slug>` query in `index.html`.
- **Shared state** flows through constructor injection from `main.js`, static imports and exported singletons
  (`cityUniforms`); keep `window` free of app globals.
- **Hot paths** (per-frame code) reuse scratch objects and fixed pools; lights and instanced meshes are created at build time
  and toggled at runtime.

## Style
- 2-space indent, single quotes, semicolons, no trailing commas; comments wrap near 120 columns and explain *why*, often with
  measured numbers. SI units; heading 0 faces +z (grid south).
- `PascalCase` classes, `camelCase` functions, `UPPER_SNAKE` constants and data tables, `_` prefix for private/scratch/cached
  fields; `build*` for scene builders, `create*` for factories and materials. UI writes DOM through `textContent` /
  `createElement` / `replaceChildren`.
- Commits: one imperative, sentence-case subject, no prefix, no trailing period, usually no body
  (e.g. "Fix invisible walls around buildings and corner collisions").

## Docs
- `docs/architecture.md` — read before changing `index.html`, `main.js` boot or the game loop, travel modes, input
  (keyboard/touch/gamepad), cameras, teleports, persistence, the map UI or HUD/CSS.
- `docs/rendering.md` — read before touching TSL materials, lighting or time of day, post-processing/SSR, scene culling,
  instanced meshes or the WebGPU/WebGL2 renderer setup.
- `docs/world.md` — read before changing city-grid, boroughs, buildings, fire escapes, landmarks, street details, trees, the
  road network or road paint, or adding props, landmarks or colliders.
- `docs/geodata.md` — read before touching `tools/`, `tools/data/`, `js/nyc-geodata.js` or the world coordinate frame.
- `docs/actors.md` — read before changing traffic, pedestrians, vehicle/person models, vehicle lights, spawning, player–traffic
  collisions or car/bicycle coasting.
- `docs/audio.md` — read before changing `js/audio-*.js`, adding a sound, or renaming fields on cars, peds, controller entities
  or `streetDetails.audioSignals` (audio reads them directly and breaks silently).
- `docs/testing.md` — read before writing or debugging tests, or running the pedestrian benchmark.
