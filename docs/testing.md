# Testing and local development

No package.json, no npm, no dependencies. The tests use only Node built-ins (`node:test`, `node:assert/strict`, `node:vm`). Verified on Node v26.12.1. Node 22+ is needed because importing `js/*.js` as ESM without a package.json depends on Node's automatic module-syntax detection.

## Commands (verified)

- Full suite: `node --test tests/`. 113 tests, about 11 s. Nearly all of that is `tests/geodata.test.mjs`, which runs the full `tools/build-geodata.mjs` in a temp copy of the repo with `--max-old-space-size=8192`.
- Quick loop that skips the geodata rebuild: `node --test tests/*.cjs` (about 0.2 s).
- One file: `node --test tests/cameras.test.cjs`. Running `node tests/cameras.test.cjs` directly also works.
- By test name: `node --test --test-name-pattern="police" tests/`
- Serve the app: `python3 -m http.server 8000` from the repo root, then open `http://localhost:8000/`. Any static server works. There is no build step, and `.js` is served as `text/javascript`. Three.js loads from jsDelivr (`three@dev`) through the import map in `index.html`, so the page needs network access. `localhost` counts as a secure context, which WebGPU requires.
- `.gitignore` contains only `.DS_Store`. Nothing is generated except `js/nyc-geodata.js`, which is committed.

## No rendering tests

No test runs a browser, WebGPU, TSL shader compilation or a screenshot comparison. Tests that touch shader or scene code (`facade-projection`, `smoke-texture`, `vehicle-lights`) re-implement or stub the TSL nodes and check only the math. Any change to geometry, materials, TSL nodes, lighting, post-processing or culling has to be checked by hand: serve the app and look in a WebGPU browser. `WebGPURenderer` falls back to WebGL2 when WebGPU is unavailable, and `js/main.js` branches on `renderer.backend.isWebGPUBackend` (for example for instanced attributes). If you touch that kind of code, check the fallback too. Watch the browser console, because shader and node errors show up only there.

## Three ways tests reach production code

Know which one covers the code you are editing. Two of them are coupled to the exact source text.

1. **`loadModule(source, { imports, globals, filename })`** from `tests/helpers/module.cjs`. It reads a whole `js/*.js` file, rewrites its static `import`/`export` declarations, and runs it in a `vm` context. Used by cameras, controllers, nyc-map, touch-controls and vehicle-lights tests, and by the benchmark.
2. **Slicing source text.** The test cuts out a function or block with a regex or `indexOf` and runs it in `vm.runInNewContext` with hand-built context variables:
   - `traffic*.test.cjs` match `^  function NAME(` through `\n  }` (two-space indent) in `js/traffic.js`, plus a block that starts at `    const pl = entity` and ends at `    } : null;`.
   - `teleports.test.cjs` runs the part of `js/main.js` from `  function teleportTo(` to `  const openMapBtn`.
   - `facade-projection` and `smoke-texture` slice `js/tsl-materials.js` between markers: `const facadeNormalVertex =`, `function facadeCell(`, `let bayWidth`, `const evaluateApartmentInterior`, `const rayWorld =`, `// Slab intersection`, `let _smokeCloudTexture =`, the next `/**`, and the literal text of the `hash` arrow function.

   If you rename, re-indent, reorder or reformat around these markers, the tests break. So do new free variables in a sliced block that the test context does not provide. When that happens, update the test's markers and context in the same change. Keep the tested behaviour as it is.
3. **Real ESM import.** `teleports.test.cjs` runs `await import('../js/city-config.js')`, and `geodata.test.mjs` imports a freshly built `nyc-geodata.js`. **`js/city-config.js` and `js/nyc-geodata.js` must import nothing beyond each other or other Node-loadable relative files.** A bare specifier such as `'three/webgpu'` cannot be resolved in Node, so adding one breaks these tests.

## loadModule: supported module syntax (hard constraint for js/ authors)

Each module that a `loadModule` test or the benchmark loads (cameras, controllers, nyc-map, touch-controls, vehicle-lights, pedestrians) must use only these forms. Use them across `js/` anyway, so a module can get tests later:

- `import * as NS from 'spec';` and `import { a, b as c } from 'spec';`. Multi-line braces are fine. The statement must start at column 0 and end with `;`.
- `export { a, b as c };` at column 0 with a `;`. Multi-line is fine. This is the house style: one export list at the end of the file.
- `export const|let|var|function|class name`. Only the first name is exported: `export const a = 1, b = 2;` silently drops `b`.

Verified to throw `Unsupported module syntax` or a SyntaxError:

- default imports
- side-effect `import 'x';`
- an import with no semicolon
- an indented import or export
- `export default`
- `export async function`
- `export function*`
- `export const { a } = ...`
- `export { a } from` and `export * from`
- `export { a }` with no `;`
- `import.meta`
- top-level `await`

Any line inside a template literal that starts with the word `import` or `export` also throws. Dynamic `import()` loads, but calling it rejects inside the vm.

Behaviour to know when writing a test:

- Every imported specifier needs a key in `imports`, even if the code under test never uses it (`Missing import stub: X`). Pass `{}` for unused ones. Keys match the exact specifier string, such as `'three/webgpu'`, `'three/tsl'` or `'./city-config.js'`.
- An imported name missing from a stub becomes `undefined` without an error, so stub every name the exercised path calls.
- `globals` becomes the vm global object. Nothing from Node leaks in: `window`, `document`, `performance`, `setTimeout` and so on are `undefined` unless you pass them. `console.log` exists but prints nothing, so pass `globals: { console }` when debugging.
- Objects and arrays created inside the module come from another realm. `assert.deepEqual(moduleArray, [1, 2])` fails even when the values match. Copy them first (`{ ...result }`, `[v.x, v.y]`, `.slice()`) or compare fields, as the existing tests do.
- The code runs in strict mode inside a function wrapper and returns only the exported bindings. To test methods without building scenes, tests often call `Object.create(Class.prototype)` and set only the fields they need (see `tests/controllers.test.cjs`).

## Writing a new test

- Name it `tests/<area>.test.cjs` so `node --test tests/` picks it up. Use `require('node:test')` and `require('node:assert/strict')`. Read the source with `readFileSync(join(__dirname, '../js/x.js'), 'utf8')` and pass it to `loadModule`. Model it on `tests/vehicle-lights.test.cjs` (a tiny `SpotLight`/`Vector3` stub for `'three/webgpu'`) or `tests/cameras.test.cjs` (`window`/`document` globals with event-target fakes).
- Stub only the Three.js surface the path touches, as small classes. Do not try to load real three.js in tests, because the repo has no local copy.
- Use `.mjs` only when you need real ESM or child processes (`import.meta.url`, `spawnSync`, `await import`), as `geodata.test.mjs` and `overpass.test.mjs` do. `overpass.test.mjs` tests `tools/overpass.sh` with a fake `curl` on `PATH` in a temp dir. Tests write only to `os.tmpdir()`, never into the repo.

## Coupled checks in tests/boot.test.cjs

- **To add a new `js/*.js` module**, also add `<link rel="modulepreload" href="./js/NAME.js" />` to `index.html`. Keep that exact attribute order and the self-closing ` />`, and place it after the import map and before the stylesheet. Then bump the expected preload count in `boot.test.cjs`, which is currently 31, one per file in `js/`. Commit `dee83c2` is the template.
- Relative imports must be `./name.js` paths that resolve to a preloaded URL.
- `index.html` must contain exactly two `<script>` tags (the import map and `./js/main.js`).
- `three` and `three/webgpu` must map to the same URL.
- Each `data-teleport="key"` button in `index.html` must have exactly one matching key in `TELEPORT_LOCATIONS` (`js/city-config.js`), and the reverse. The destination must be on a road and not inside a block.

## Pedestrian benchmark

`node tools/benchmark-pedestrians.mjs /abs/path/to/three/build/three.core.js` (or set `THREE_CORE_PATH`). You need a local three.js build, because the repo has none (any npm `three` package's `build/three.core.js` works). Verified run: about 7 s. It prints JSON with the ms per frame for 340 rigs, before and after, plus the reduction percentage. It first asserts that deferring the pose solve for hidden rigs gives bit-identical gait and poses, so it doubles as a correctness check after `PersonRig` changes. It loads `js/pedestrians.js` through `loadModule` with stubs only for `'three/webgpu'`, `'three/tsl'` and `'three/addons/utils/BufferGeometryUtils.js'`. It also builds its baseline by replacing the literal `if (updatePose) this.solve();`. If you add an import to `pedestrians.js`, add a stub here. If you change that line, update the replacement.
