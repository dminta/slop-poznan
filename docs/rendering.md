# Rendering

## Map
- `js/main.js` owns renderer creation, the order of the start-up passes (culling setup, instance-matrix swap, shader precompile, warm-up frame) and the scene pass: MRT, SSR, and the hand-off to `createPostProcessing`.
- `js/lighting.js` (`LightingSystem`) owns the sky, sun and shadows, the hemisphere light, the IBL bake, the aerial fog and the time-of-day presets. `js/post-processing.js` owns the camera "look" for each preset: exposure, white balance, contrast, saturation, bloom and vignette.
- `js/tsl-materials.js` holds the shared TSL materials and helpers, plus `cityUniforms`, the live uniforms that the presets drive. Many modules (boroughs, city-grid, street-details, actor-models, trees, pedestrians) also build their own node materials inline.
- `js/scene-culling.js` runs once after the city is built and rewrites the static scene graph (see Culling).

## Renderer and the WebGL2 fallback
- `WebGPURenderer` is created with `antialias` (MSAA), `reversedDepthBuffer: true`, pixel ratio fixed at 1, shadows on, and `ClusteredLighting`. three.js is `@dev` from jsDelivr, so APIs can drift. `lighting.js` already has to cope with this: `SunLight.registerNode` exists only on newer builds, and older builds go through `renderer.library.addLight`.
- Use `renderer.backend.isWebGPUBackend` to branch per backend. On the WebGL2 fallback, `renderer.backend.device` is undefined. `lighting.js` then assumes a 4096 texture limit, which gives 2048 shadow tiles.
- **Instance-matrix swap (WebGPU only):** after `setupSceneCulling`, `main.js` replaces the `instanceMatrix` of every InstancedMesh in the scene with a `StorageInstancedBufferAttribute`. Small instanced meshes otherwise keep their matrices in uniform buffers, and three.js re-uploads those on every draw of every pass. Consequences:
  - Do not swap on WebGL2. Commit "Fix instanced geometry on the WebGL2 fallback" reverted an unconditional swap that broke transforms there.
  - Code that updates instances later must read `mesh.instanceMatrix` again each time instead of caching the original attribute (see `rebuild()` in `trees.js`).
  - The swap covers only InstancedMeshes that are already in the scene when it runs. Create a mesh before that point if you want it swapped.
- **Reversed depth:** a custom `vertexNode` that has to sit on the far plane writes clip `z = 0`, not `z = w`. The SkyMesh patch in `LightingSystem` shows how.
- Leave `scene.background = null`. Setting a Color forces a clear inside `Background.update`, which wipes cascade 0 while cascade 1 renders. The sky is the `SkyMesh` dome, scaled to 200 km so the camera stays inside it anywhere over the harbour.

## Time of day (lighting state)
- There are four presets: `golden`, `midday`, `twilight`, `midnight`. Each id must exist in three places, which must stay in sync: `TIME_PRESETS` in `lighting.js`, `LOOKS` in `post-processing.js`, and the `data-time` buttons in `index.html`. `selectTime` in `main.js` applies both systems. Golden hour is the default and the fallback.
- `applyPreset` pushes sun, hemisphere, fog and sky values, plus `cityUniforms` (sun and sky colours, sun direction, `uInteriorGlow`, `uRoadWetness`, `uCanyonBounce`), and then re-bakes the PMREM environment. The bake reuses one render target, so `scene.environment` and the fog's `pmremTexture` keep the same texture identity. Keep that render-target reuse.
- **The night signal is `cityUniforms.uInteriorGlow`** (about 0.24 at midday, 1.55 at midnight). `nightFactor` only blends the sky. Shaders derive night with `smoothstep(lo, hi, cityUniforms.uInteriorGlow)`, for example `nightFactorNode` in `boroughs.js` and the lamp glows in `street-details.js`. CPU code reads `.value` with a fallback of 0.48 (`street-details.js`, `traffic.js`, `controllers.js`). When something needs to fade in at dusk, follow the same pattern. When the CPU and a shader must agree, use the same smoothstep range on both sides; a comment in `street-details.js` pairs the two. The audio system keys night off `activePresetId === 'midnight'`.
- Fog is `scene.fogNode` (`createAerialFogNode`), not `scene.fog`. `scene.fog` is still updated, but the node replaces it once the env map exists. Additive and emissive sprites set `fog: false`, because fog would add its own colour.
- Shadows: `SunLight` with 2-cascade CSM, 3072² tiles (an 8192×4096 atlas cost about 20% fps). `LightingSystem.update` stretches `shadow.camera.far` from 300 m to 720 m with altitude. The cull distances in `scene-culling.js` (`CULL_MIN`, `PROXY_CELL`) assume this reach of about 300 m. If you change the cascade far plane, revisit those constants too.
- Dynamic lights (streetlights, store spots, police lights, headlights) come from fixed pools created at build time. A pool light is "off" when its intensity is 0 and it is parked at y = -1000. To add a light, add it to a pool and change only its intensity and position at runtime; do not create lights per frame.

## Post-processing chain (`main.js` → `post-processing.js`)
- The scene pass MRT writes `output`, `normal` (view space) and `metalRough`. The `metalRough.r` channel is metalness, and it is zeroed when roughness is 0.75 or higher or the surface is beyond about 360 m (`ssrFade`), so SSR spends rays only on nearby glossy pixels. Half-resolution SSR is masked again by roughness before it is added to the scene colour.
- `normal` and `metalRough` use `MaterialBlending`. **Transparent decals, effects and sprites must set `mat.mrtNode`**, normally to `_transparentEffectMRT` in `tsl-materials.js` (all zeros, alpha 0). That way they leave the G-buffer of the surface underneath intact and SSR keeps reflecting it. `createContactShadowMaterial` shows the other choice: it writes `metalRough` with alpha, to switch SSR off under cars.
- `storeMultisampledColorBuffer = false`: the MSAA colour attachments are only resolved. Depth stays stored because SSR reads it.
- Grading runs in scene-linear HDR, and `RenderPipeline` applies ACES and the colour-space conversion exactly once, after the graph. Exposure is applied before bloom so the bloom threshold tracks exposed brightness. The bloom input is peak-clamped to 8 while preserving hue. Keep `renderer.toneMappingExposure = 1` and put exposure changes in `LOOKS`. History: AgX was tried and reverted to ACES.

## TSL conventions (`tsl-materials.js`)
- Import from `three/webgpu` and `three/tsl` as native ES modules, the same way the existing files do.
- **One shader per material family.** Pass style parameters as `uniform(...)`, not as JS constants baked into the graph, so every style compiles to the same pipeline. Cache material instances by option key (`_curtainWallCache`, `_preWarCache`, `_carPaintCache`, `_billboardCache`). Each distinct graph adds a pipeline to the compile at load time.
- Build expensive shared sub-graphs once and reuse the node in every output (`colorNode`, `roughnessNode`, `normalNode`, `emissiveNode`). For example, `facadeCell` and `evaluateApartmentInterior` are evaluated once and shared by the curtain-wall outputs.
- Wrap helpers that take derivatives in `Fn` (`bumpNormal`, `lineAA`, `gridLine`) so the argument is evaluated once before `dFdx` or `fwidth`.
- **Anti-aliasing:** procedural stripes and grids use `filteredPulse`, `lineAA` or `gridLine` with an `fwidth` footprint. Past about a pixel per period, they fade to mean coverage. Interiors and lamps also fall back to their mean (the `fwNode` argument), and bump detail fades with distance and footprint. Apply the same treatment to new repeating patterns, or they shimmer at distance and grazing angles.
- **Facade projection frame:** walls choose their texture axis from `facadeWorldNormal` and `facadeAlongZ`, a flat-interpolated varying computed in the vertex shader from `modelNormalMatrix * normalLocal`. Do not use `normalWorldGeometry` to choose the axis. Its view-space round trip flips the dominant axis on 45° walls as the camera turns, which flickered One WTC's diagonal glass. With `boxLocal` (instanced boxes from `createFacadeBoxes`, which may be rotated about +y), the walls are told apart by `normalGeometry` instead.
- `tests/facade-projection.test.cjs` slices the source text of `tsl-materials.js` by literal anchors and evaluates that text numerically. The anchors are `const facadeNormalVertex =` … `const facadeAlongZ =` … `.setInterpolation(…);`, the body of `function facadeCell(` up to `let bayWidth`, and `const rayWorld =` (inside `evaluateApartmentInterior`) up to `// Slab intersection`. Keep these anchors. Inside those slices, use only the functions that the test's sandbox stubs (`normalize`, `varying`, `abs`, `sign`, `step`, `max`, `mix`, `vec3`, `dot`); if you need more, extend the stubs.
- `tests/smoke-texture.test.cjs` likewise slices from `let _smokeCloudTexture =` to the next `/**`, and checks the baked bytes and the exact hash counts. If you change the smoke bake, update the expected counts on purpose.
- Use `canyonSkyAONode()` as the `aoNode` for street-level city surfaces, and read sun and sky colours from `cityUniforms` so they follow the presets.

## Recipe: add a material
1. Write a `create…Material(opts)` in `tsl-materials.js` (or next to its only user), add it to the `export { … }` list, and cache it by its options.
2. Make per-style values uniforms. Use `cityUniforms` for anything that depends on time of day, and `uInteriorGlow` for night behaviour.
3. If it is transparent or additive, set `mrtNode = _transparentEffectMRT`, `depthWrite: false`, and `fog: false` when it is additive.
4. If it moves vertices (`positionNode`) or cuts holes (alpha test or alpha map), it cannot get a shadow stand-in (see `proxyableMaterial`). It then keeps casting shadows itself, at full cost.
5. Run the app and confirm that the compile step has no `[compile]` warnings in the console.

## Instancing and upload budgets
- For pooled or streamed instanced meshes (building detail inside `STREAM_RADIUS`, trees, fire escapes, traffic, pedestrians), allocate the full capacity once and set `mesh.count`. Upload only the active prefix through a local `flagRange` helper: `clearUpdateRanges()`, then `addUpdateRange(0, count * itemSize)`, then `needsUpdate = true`. Copies of that helper live in `buildings.js`, `traffic.js` and `fire-escapes.js`. Do the same for custom per-instance attributes and for `instanceColor`.
- Prefer static usage plus update ranges over `DynamicDrawUsage`. three.js re-uploads a dynamic attribute in every render pass: two shadow cascades plus the scene pass, about 7 MB per frame for trees.
- Static per-instance data must live in `InstancedBufferAttribute`s on the geometry (like `box` and `faces` in `createFacadeBoxes`) or in `instanceColor`. Chunking copies only these. Storage buffers indexed by `instanceIndex` would point at the wrong data after chunking.
- Trees run their own cell culling and LOD in `trees.js`: one hidden group per cell, levels set from `scene.onBeforeRender`, and matrices frozen. They are not handled by `scene-culling.js`.

## Culling (`scene-culling.js`): registering new static geometry
- `setupSceneCulling` walks only the roots that `main.js` lists by group name: `ManhattanCityGrid`, `ManhattanCityBlocks`, `ManhattanStreetDetails`, `ManhattanLandmarks`, `Boroughs`. Put new static city geometry under one of these groups, or add the new group's name to that list.
- What it does, by threshold:
  - Instanced meshes with ≥ 64 instances, ≥ 40k triangles in total and a bounding radius of at least 1.5 km are split into spatial chunks with a distance cull. The distance comes from the 90th-percentile instance size, and `MeshBasicNodeMaterial` glows get 3×.
  - Meshes that would get a cull distance over 2 km are chunked into 1 km cells, frustum culling only.
  - Opaque shadow casters with ≥ 20k triangles and a radius over 600 m get position-only stand-ins on `SHADOW_PROXY_LAYER`, a layer only the cascade cameras render. The originals get `castShadow = false`.
- **The originals are removed from the scene and replaced.** Any reference a builder holds to such a mesh goes stale. Shadow stand-ins are baked world-space copies and never follow later edits to the original.
- Anything that changes after the build must stay out of this pass: moving parts, re-filled pools, `count < capacity`. Ways to opt out: set `frustumCulled = false`, keep it outside the roots (traffic and pedestrians live under `ManhattanTrafficAndPedestrians`), or set `visible = false` on the mesh itself at setup time. Meshes with `count !== instanceMatrix.count` are skipped as well.
- Chunks and stand-ins set `userData.sharesPipelineWith` to a representative, so `precompileShaders` and the warm-up frame compile one object per pipeline. If you build a family of meshes that share a material, mark them the same way (`trees.js` does). `precompileShaders` skips stand-ins, which compile in the warm-up frame instead.

## Start-up compile and warm-up
- The order matters. First an empty `renderPipeline.render()` with `scene.visible = false`, which configures the MSAA and depth formats of the scene target. Then `compileAsync` over 16 parallel workers, with the scene pass's render target and MRT bound. Then the first loop frame runs with frustum culling off and `updateSceneCulling` skipped, so the shadow-pass pipelines compile behind the loading screen.
- Objects or materials that first appear after this point compile on first sight and cause a hitch. Create them during the build, visible or in their pool, so these passes see them.
- The `[init] …` timings logged once at start-up (`markInit`) are the regression signal for load time.
