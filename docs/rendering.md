# Rendering

## Map
- `js/main.js` owns renderer creation, the order of the start-up passes (culling setup, instance-matrix swap, shader precompile, warm-up frame) and the scene pass: MRT, SSR, and the hand-off to `createPostProcessing`.
- `js/lighting.js` (`LightingSystem`) owns the sky, sun and shadows, the hemisphere light, the IBL bake, the aerial fog and the time-of-day presets. `js/post-processing.js` owns the camera "look" for each preset: exposure, white balance, contrast, saturation, bloom and vignette.
- `js/tsl-materials.js` holds the shared TSL materials and helpers, plus `cityUniforms`, the live uniforms that the presets drive. Many modules (outskirts, bridges, city-grid, street-details, actor-models, trees, pedestrians) also build their own node materials inline.
- `js/scene-culling.js` runs once after the city is built and rewrites the static scene graph (see Culling).
- `js/static-matrices.js` freezes the static scene graph after the build and updates only the listed dynamic roots each frame (see Static and dynamic transforms).

## Quality tiers
- `js/graphics-quality.js` holds the two presets and the boot-time classifier. `high` is the historical look; `low` is
  for the WebGL2 fallback, old phones/laptops, weak/integrated GPUs and touch-first devices whose GPU is unknown. The
  tier is chosen once at boot ([architecture.md](architecture.md#boot-order-inside-initapp)): `?quality=low|high` wins,
  otherwise the device default. It never changes at runtime, because selecting the other attachment layout recompiles
  every scene pipeline and freezes for seconds.
- **Device default, in order:** a weak or software GPU starts low; the WebGL2 backend starts low; ≤ 4 CPU threads starts
  low; ≤ 4 GB of reported memory starts low; a strong GPU starts high and can lift a touch-first tablet out of the touch
  rule; a touch-first device with an unknown GPU starts low; everything else stays high. The reason is written once to
  `body[data-quality-reason]` (`url:low`, `gpu:apple-m5`, `gpu:intel-uhd-630`, `backend:webgl2`, `cpu:4-threads`,
  `memory:4gb`, `touch:unknown-gpu`, `default:high`) and logged once as
  `[quality] low — gpu:intel-uhd-630 (GPU: …)`. `deviceMemory` is reported only by Chromium and capped at 8 GB; Safari
  buckets `hardwareConcurrency` to 4 or 8. The GPU identity carries the decision when those values are absent or capped.
- **GPU identity:** the classifier reads the WebGPU `GPUAdapterInfo` (`vendor`, `architecture`, `device`,
  `description`, `isFallbackAdapter`) from `GPUDevice.adapterInfo` and the WebGL unmasked renderer
  (`WEBGL_debug_renderer_info`). On WebGPU it opens a temporary WebGL1 context for the unmasked string; on the WebGL2
  fallback it reads `renderer.backend.gl`. WebGL1 carries the same extension and, unlike a second WebGL2 context next to
  WebGPU, survives in headless Chrome 157. The probe is one context creation, not a render or a timed loop; it costs
  4–21 ms in the `[init] quality` phase on this Mac (0 ms on WebGL2, which reuses the backend context). Adapter
  architecture is used for the unambiguous classes (Apple M, Intel gen/xe-lpg, Mali, Adreno, software); NVIDIA
  turing/ampere and AMD rdna alone also cover entry-level or integrated parts, so those need the WebGL model. The
  renderer and adapter fields are classified separately: a weak class from either source wins over a strong one from
  the other, so a hybrid laptop whose WebGL probe lands on the iGPU is conservative (a false low, never a false high).
  The table is deliberately coarse:
  - software/fallback: SwiftShader, llvmpipe, softpipe, Microsoft Basic Render Driver, WARP, virgl/virtio/VMware → low.
  - Apple: M-series and A14+ → high; A7–A13 → low; a masked `Apple GPU` is unknown.
  - desktop: Intel HD/UHD/Iris/Xe Graphics, AMD Radeon integrated/Vega 3–11/Radeon 5xxM–8xxM, GeForce MX → low; Intel
    Arc, NVIDIA GTX 16/RTX, AMD RX 5000–9000/Radeon Pro 5000M+ → high.
  - mobile: older Mali (G31–G78 and G610/G615), Adreno 5xx/6xx and PowerVR → low; Mali-G710+/Immortalis, Adreno
    7xx/8xx and Xclipse 9xx → high.
  Sources: [GPUAdapterInfo](https://www.w3.org/TR/webgpu/#gpuadapterinfo),
  [WEBGL_debug_renderer_info](https://developer.mozilla.org/en-US/docs/Web/API/WEBGL_debug_renderer_info),
  [renderer string examples](https://deviceandbrowserinfo.com/learning_zone/articles/webgl_renderer_values), and
  [WebKit bug 278542](https://bugs.webkit.org/show_bug.cgi?id=278542) for the Safari masking. Safari reports `apple`
  for every adapter field and `Apple GPU` for WebGL, so an iPad Pro cannot be identified from script and stays low on
  the touch rule; on a non-touch Mac the same masking leaves the default high, so an old Mac needs `?quality=low`.
  `?quality=` is the escape hatch in both directions.
- **No micro-benchmark:** a 4e6-iteration integer hash was measured in headless Chrome 157 on the M5 Pro at 3.7–3.9 ms
  (1×), 15.2–16.1 ms (4× CPU throttle) and 30.5–31.8 ms (8×), with a 2–7 % within-run coefficient of variation and a
  10–20 % slower first sample before JIT warm-up. It is stable on one machine, but there is no cross-device calibration
  for JIT, thermal throttling and battery saver; a fixed 100 ms probe would block every unknown-identity boot and could
  still lower a fast device under load. The GPU table covers the known false positives, so no probe ships.
- **Post-processing:** low builds the scene pass without MRT and without the SSR pass or the bloom node; it keeps
  exposure, white balance, contrast, vibrance, vignette, ACES tone mapping, the sky and fog. Only one scene pass is ever
  built: there is no pre-created high pass waiting behind a low load.
- Materials with an explicit `mrtNode` (transparent decals, road paint, contact shadows) need the normal and metalRough
  attachments. On low, `main.js` clears their `mrtNode` once after the city is built; high leaves them alone. A material
  created after that boot-time clear would not be cleared, so create such materials during the build.
- **Shadows:** low uses 1024² tiles per cascade and a 150–360 m shadow range (`LightingSystem` receives the tier at
  construction); high keeps 3072² (2048² on smaller devices) and 300–720 m. Low also turns off shadow casting once at
  boot for trees, street furniture/props, trams and the city grid; the building and landmark shadow proxies from
  `scene-culling.js` keep casting, so large-scale building shade remains. High builds the merged small-prop stand-ins
  (`userData.propShadowProxy`); low skips building them entirely (`propShadowProxies: false`) because it disables those
  casters and does not need their ~50 MB of retained geometry.
- **Trees:** the tree field reads the tier's `trees` profile once at boot (`configureTreeQuality` in `main.js`, before
  `buildStreetDetails` plants it). Low keeps full detail to 95 m (high 105), coarse cards to 330 m (420), draws parks and
  plazas to 2200 m (3000), wide streets to 1500 m (1600) and narrow streets to 850 m (950), and caps street-level trees at
  900 m (1150). It also merges the two LOD-1 crown variants and gives every species the lime's whole-crown LOD-2 geometry:
  a cell then builds at most 13 tree meshes instead of 20, so the field allocates 20,376 meshes instead of 30,259. The
  instance buffers keep their three LOD copies per tree (356,682 instances, ~21.8 MB): every tree can become the nearest
  tree of some camera, so no capacity is removed. High keeps the historical profile (pixel-identical in the review).
  Measurements and the visual cost: [perf-trees-2026-11-11](observations/perf-trees-2026-11-11.md).
- **Resolution:** low renders at internal pixel ratio 0.75 (the canvas is 960 × 540 at a 1280 × 720 window); high stays at 1.0.
- **Populations:** low targets 180 pedestrians and half the local vehicle density, passed to `createTrafficSystem` at
  boot. The pools keep their full build-time capacity; no runtime tier change re-places actors.
- `?quality=low|high` overrides the device default for a browser review (like `?backend=webgl`); it is not persisted.
  The brand line's link reloads the page with the other value; there is no runtime switching path. The override also
  records `url:low|high` in `body[data-quality-reason]` and the boot log.

## Renderer and the WebGL2 fallback
- `WebGPURenderer` is created with `antialias` (MSAA), `reversedDepthBuffer: true`, the tier's pixel ratio (1 high, 0.75 low), shadows on, and `ClusteredLighting`. three.js is `@dev` from jsDelivr, so APIs can drift. `lighting.js` already has to cope with this: `SunLight.registerNode` exists only on newer builds, and older builds go through `renderer.library.addLight`.
- Use `renderer.backend.isWebGPUBackend` to branch per backend. On the WebGL2 fallback, `renderer.backend.device` is undefined. `lighting.js` then assumes a 4096 texture limit, which gives 2048 shadow tiles.
- `?backend=webgl` passes `forceWebGL` to the renderer constructor so a browser review can exercise the fallback on a WebGPU machine. Any other value, or no query string, keeps the default backend. It is a review switch, not a persisted setting.
- **Instance-matrix swap (WebGPU only):** after `setupSceneCulling`, `main.js` replaces the `instanceMatrix` of every InstancedMesh in the scene with a `StorageInstancedBufferAttribute`. Small instanced meshes otherwise keep their matrices in uniform buffers, and three.js re-uploads those on every draw of every pass. Consequences:
  - Do not swap on WebGL2. Commit "Fix instanced geometry on the WebGL2 fallback" reverted an unconditional swap that broke transforms there.
  - Code that updates instances later must read `mesh.instanceMatrix` again each time instead of caching the original attribute (see `rebuild()` in `trees.js`).
  - The swap covers only InstancedMeshes that are already in the scene when it runs. Create a mesh before that point if you want it swapped.
- **Pedestrian pose storage:** `PersonCrowd` enables `setPBO(true)` on its read-only pose arrays. WebGPU keeps
  storage-buffer reads; WebGL2 uses a texture for indexed bone reads. Without this flag, the fallback binds the
  pose as a per-vertex attribute and `PeopleNear` draws fail with an undersized buffer. WebGL2 compilation pads
  and replaces `pose.value.array`, so always access the current array. `end()` also invalidates the backend-created
  `attribute.pbo` texture: updating only the buffer attribute leaves rendered poses frozen. This property is a
  three.js backend dependency; recheck both draw errors and movement after CDN updates.
- **Reversed depth:** a custom `vertexNode` that has to sit on the far plane writes clip `z = 0`, not `z = w`. The SkyMesh patch in `LightingSystem` shows how.
- Leave `scene.background = null`. Setting a Color forces a clear inside `Background.update`, which wipes cascade 0 while cascade 1 renders. The sky is the `SkyMesh` dome, scaled to 200 km so the camera stays inside it anywhere over the outskirts.

## Time of day (lighting state)
- There are four presets: `golden`, `midday`, `twilight`, `midnight`. Each id must exist in three places, which must stay in sync: `TIME_PRESETS` in `lighting.js`, `LOOKS` in `post-processing.js`, and the `data-time` buttons in `index.html`. `selectTime` in `main.js` applies both systems. Golden hour is the default and the fallback.
- **The sun is computed, not tuned.** Each preset states a real moment as `when` (local Europe/Warsaw time with its UTC
  offset, e.g. `'2026-09-25T17:45+02:00'`), and `sunPosition` (NOAA equations, 52.41 N 16.93 E) turns it into
  `sunAzimuth` / `sunElevation` and the world-frame `sunDir` at import time. Keep the label's clock time equal to
  `when`. Under the horizon the Preetham sky goes black (≈ −2.3°) and a shadowing light makes no sense, so `twilight`
  (−5.6°) and `midnight` (−10.2°) raise the rendered sun to `minElevation` over the real azimuth: the afterglow, and
  the north-western glow of a midsummer night. `tests/lighting.test.cjs` checks the solar maths against Poznań's
  solstice/equinox noon elevations and sunset times, and each preset against its `when`.
- The camera far plane (`CAMERA_FAR` in `cameras.js`, 32 km) reaches the farthest outskirts corner from anywhere the
  helicopter may fly; the horizon filler beyond it is fully fogged by then.
- `applyPreset` pushes sun, hemisphere, fog and sky values, plus `cityUniforms` (sun and sky colours, sun direction, `uInteriorGlow`, `uRoadWetness`, `uCanyonBounce`), and then re-bakes the PMREM environment. The bake reuses one render target, so `scene.environment` and the fog's `pmremTexture` keep the same texture identity. Keep that render-target reuse.
- **The night signal is `cityUniforms.uInteriorGlow`** (about 0.24 at midday, 1.55 at midnight). `nightFactor` only blends the sky. Shaders derive night with `smoothstep(lo, hi, cityUniforms.uInteriorGlow)`, for example `nightFactorNode` in `outskirts.js` and the lamp glows in `street-details.js`. CPU code reads `.value` with a fallback of 0.48 (`street-details.js`, `traffic.js`, `controllers.js`). When something needs to fade in at dusk, follow the same pattern. When the CPU and a shader must agree, use the same smoothstep range on both sides; a comment in `street-details.js` pairs the two. The audio system keys night off `activePresetId === 'midnight'`.
- Fog is `scene.fogNode` (`createAerialFogNode`), not `scene.fog`. `scene.fog` is still updated, but the node replaces it once the env map exists. Additive and emissive sprites set `fog: false`, because fog would add its own colour.
- Shadows: `SunLight` with 2-cascade CSM, 3072² tiles on high (2048² where the device's texture limit is smaller) and 1024² on low. `LightingSystem.update` stretches `shadow.camera.far` from 300 m to 720 m with altitude on high; the low profile starts at 150 m and reaches 360 m. The cull distances in `scene-culling.js` (`CULL_MIN`, `PROXY_CELL`) assume a high-tier reach of about 300 m; the low tier simply draws fewer shadow casters and does not change the culling radii. If you change the cascade far plane, revisit those constants too.
- Dynamic lights (streetlights, store spots, police lights, headlights) come from fixed pools created at build time. A pool light is "off" when its intensity is 0 and it is parked at y = -1000. To add a light, add it to a pool and change only its intensity and position at runtime; do not create lights per frame.

## Post-processing chain (`main.js` → `post-processing.js`)
- The high-tier scene pass MRT writes `output`, `normal` (view space) and `metalRough`. The `metalRough.r` channel is metalness, and it is zeroed when roughness is 0.75 or higher or the surface is beyond about 360 m (`ssrFade`), so SSR spends rays only on nearby glossy pixels. Half-resolution SSR is masked again by roughness before it is added to the scene colour. The low tier skips the MRT, the SSR pass and the bloom node altogether; `createPostProcessing(renderer, sceneColor, reflections, { bloom: false })` builds only the grading graph.
- `normal` and `metalRough` use `MaterialBlending`. **Transparent decals, effects and sprites must set `mat.mrtNode`**, normally to `_transparentEffectMRT` in `tsl-materials.js` (all zeros, alpha 0). That way they leave the G-buffer of the surface underneath intact and SSR keeps reflecting it. `createContactShadowMaterial` shows the other choice: it writes `metalRough` with alpha, to switch SSR off under cars. When the page loads low, the scene pass has no MRT; `main.js` clears these `mrtNode`s once after the city is built (otherwise their fragment output has no `output` member and WGSL compilation fails). High keeps them. **The clear runs once**, so an `mrtNode` material created later would not be cleared; create such materials during the build (or extend the clear) if a future system adds them at runtime.
- `storeMultisampledColorBuffer = false`: the MSAA colour attachments are only resolved. Depth stays stored because SSR reads it.
- Grading runs in scene-linear HDR, and `RenderPipeline` applies ACES and the colour-space conversion exactly once, after the graph. Exposure is applied before bloom so the bloom threshold tracks exposed brightness. The bloom input is peak-clamped to 8 while preserving hue. Keep `renderer.toneMappingExposure = 1` and put exposure changes in `LOOKS`. History: AgX was tried and reverted to ACES.

## TSL conventions (`tsl-materials.js`)
- Import from `three/webgpu` and `three/tsl` as native ES modules, the same way the existing files do.
- **One shader per material family.** Pass style parameters as `uniform(...)`, not as JS constants baked into the graph, so every style compiles to the same pipeline. Cache material instances by option key (`_curtainWallCache`, `_preWarCache`, `_carPaintCache`). Each distinct graph adds a pipeline to the compile at load time.
- Build expensive shared sub-graphs once and reuse the node in every output (`colorNode`, `roughnessNode`, `normalNode`, `emissiveNode`). For example, `facadeCell` and `evaluateApartmentInterior` are evaluated once and shared by the curtain-wall outputs.
- Wrap helpers that take derivatives in `Fn` (`bumpNormal`, `lineAA`, `gridLine`) so the argument is evaluated once before `dFdx` or `fwidth`.
- **Anti-aliasing:** procedural stripes and grids use `filteredPulse`, `lineAA` or `gridLine` with an `fwidth` footprint. Past about a pixel per period, they fade to mean coverage. Interiors and lamps also fall back to their mean (the `fwNode` argument), and bump detail fades with distance and footprint. Apply the same treatment to new repeating patterns, or they shimmer at distance and grazing angles.
- **Facade projection frame:** walls choose their texture axis from `facadeWorldNormal` and `facadeAlongZ`, a flat-interpolated varying computed in the vertex shader from `modelNormalMatrix * normalLocal`. Do not use `normalWorldGeometry` to choose the axis. Its view-space round trip flips the dominant axis on 45° walls as the camera turns, which made diagonal glass flicker as the camera turned. With `boxLocal` (instanced boxes from `createFacadeBoxes`, which may be rotated about +y), the walls are told apart by `normalGeometry` instead.
- `tests/facade-projection.test.cjs` slices the source text of `tsl-materials.js` by literal anchors and evaluates that text numerically. The anchors are `const facadeNormalVertex =` … `const facadeAlongZ =` … `.setInterpolation(…);`, the body of `function facadeCell(` up to `let bayWidth`, and `const rayWorld =` (inside `evaluateApartmentInterior`) up to `// Slab intersection`. Keep these anchors. Inside those slices, use only the functions that the test's sandbox stubs (`normalize`, `varying`, `abs`, `sign`, `step`, `max`, `mix`, `vec3`, `dot`); if you need more, extend the stubs.
- **Facade and roof families.** Each family is one pipeline, whatever its options (only `boxLocal` and the masonry
  window ratios change the graph):
  - `createPreWarBuildingMaterial`: `masonry: 'brick' | 'ashlar' | 'plaster'` picks the street-front finish, as a
    uniform. Rear and lot-line walls stay brick. The doc comment lists the option sets for the Poznań kamienica colours.
  - `createCurtainWallMaterial`: glass.
  - `createPanelBlockMaterial`: wielka płyta slabs. It has 2.8 m storeys of panels, joints at the floor and sill lines,
    stacked loggia columns (`loggiaPeriod`) and the same night interiors. It uses the `facadeCell` contract, so it can be
    a facade material on `createFacadeBoxes` boxes. buildings.js runs it that way (`boxLocal: true`) in five colours, one pipeline;
    keep `floorHeight` at 2.8 in its options, the massing reads storey heights from them.
  - `createRoofMaterial({ kinds: ['tile', 'slate', 'copper'], kind: 'tile' | 'slate' | 'metal' | 'copper', gableColor })`: pitched roofs. The kind's look is
    carried in uniforms (`ROOF_KINDS`), so all kinds share one pipeline; `kinds` adds the per-instance `roofKind` selector that lets one
    mesh carry several kinds, while a single `kind` keeps the plain uniform set. The covering is laid out in world metres from
    `facadeWorldNormal`, with courses along the eave, so the mesh needs no uvs and instances can be scaled non-uniformly.
    The geometry needs flat per-face normals (non-indexed, or split vertices). Vertical faces render as gable-end
    render, and faces pitched under about 11° (mansard tops) drop the courses. buildings.js makes the tile, slate and copper ones for roofs.js; with one shared material their
    four pieces (and the dormer bodies) are static meshes under `CityBlocks`, so scene culling chunks them.
  - `createDormerWindowMaterial()`: the dormer panes (+1 pipeline), a white casement frame round dark glass from the
    quad's uvs (`filteredPulse`), warm at night on a hash of `instanceIndex` (chunking reshuffles which ones, harmlessly).
  - `createGableScreenMaterial()`: the Rynek's stepped and volute gable screens (+1 pipeline): render tinted by the
    per-instance `gableTint` attribute (not `instanceColor`, which would tint the white trim too), string courses,
    coping, attic windows and an oculus from the unit uvs.
  - `createLitWindowMaterial()`: warm interior glow for modelled landmark panes (+1 pipeline), driven by
    `cityUniforms.uInteriorGlow`. Each pane carries a unique seed in `uv.x` and its lit share in `uv.y` (0.45 standard,
    0.20 on churches), hashed per pane for uniform lighting with a dimmer, warm/cool mix and night fade. Unlit
    architectural glass uses plain `M.glass`.
- Use `canyonSkyAONode()` as the `aoNode` for street-level city surfaces, and read sun and sky colours from `cityUniforms` so they follow the presets. It opens up over 0–22 m (Poznań's ≈ 18–25 m roofline) and inside the parks.
- Shaders that need to know where land or parks are sample `getLandMaskTexture()` (8 m cells, 1 on land and bridge decks) or `getParkMaskTexture()` (16 m cells, each block's `park` share) through `boxUV`, built lazily from the city-config land raster and `BLOCKS` over the detail box. The water's night skyline marches the reflected ray over the land mask (ten taps) and fades out beyond the box.

## Recipe: add a material
1. Write a `create…Material(opts)` in `tsl-materials.js` (or next to its only user), add it to the `export { … }` list, and cache it by its options.
2. Make per-style values uniforms. Use `cityUniforms` for anything that depends on time of day, and `uInteriorGlow` for night behaviour.
3. If it is transparent or additive, set `mrtNode = _transparentEffectMRT`, `depthWrite: false`, and `fog: false` when it is additive.
4. If it moves vertices (`positionNode`) or cuts holes (alpha test or alpha map), it cannot get a shadow stand-in (see `proxyableMaterial`). It then keeps casting shadows itself, at full cost.
5. Run the app and confirm that the compile step has no `[compile]` warnings in the console.

## Instancing and upload budgets
- For pooled or streamed instanced meshes (building detail inside `STREAM_RADIUS`, trees, balconies, traffic, pedestrians), allocate the full capacity once and set `mesh.count`. Upload only the active prefix through a local `flagRange` helper: `clearUpdateRanges()`, then `addUpdateRange(0, count * itemSize)`, then `needsUpdate = true`. Copies of that helper live in `buildings.js`, `traffic.js` and `balconies.js`. Do the same for custom per-instance attributes and for `instanceColor`.
- Prefer static usage plus update ranges over `DynamicDrawUsage`. three.js re-uploads a dynamic attribute in every render pass: two shadow cascades plus the scene pass, about 7 MB per frame for trees.
- Vertex buffers: WebGPU allows 8 per draw, and the instance-matrix swap keeps `instanceMatrix` out of them. A street car body uses 6–7 (`position`, `normal`, `partId`, maybe `uv`, and the per-instance `paintColor`, `carState`, `plateCode`); pack new per-instance car data into those before adding an attribute (`pedestrians.js` packs its skinning for the same reason). On WebGL2 the matrix takes 4 of the 16 attribute slots.
- Static per-instance data must live in `InstancedBufferAttribute`s on the geometry (like `box` and `faces` in `createFacadeBoxes`) or in `instanceColor`. Chunking copies only these. Storage buffers indexed by `instanceIndex` would point at the wrong data after chunking.
- **Merge pieces that share a transform and material at build time.** A streetlight's LED mast and luminaire housing have the same instance matrices and `poleMetalMat`, so street-details.js merges them into one geometry: the separate housing had 904 culling chunks citywide against the mast's 90. Pitched roofs use one material for tile, slate and copper (`createRoofMaterial({ kinds })`), so each unit piece is one `InstancedMesh` with a per-instance `roofKind` float selecting the kind's uniforms; the family is 17 meshes (12 roof, 2 dormer bodies, window, 2 gable screens) → 8. The merge is exact: the kind's values are mixed with `step(roofKind, i + 0.5)` factors of 0 or 1, and a single-kind material carries no attribute.
- The pinned three.js has no `BatchedMesh` path in the WebGPU renderer (`isBatchedMesh`/multi-draw exists only in the WebGL2 backend), so `BatchedMesh` is not usable for the primary backend. Merge per material/transform instead.
- `tram-infra.js` builds its static instanced meshes once (rails, grooves, mainline ballast, rail end walls, contact and span wires, poles, arms, platforms, shelters, signs, machines) under the `TramInfrastructure` culling root. There is no tram track bed mesh: the tram rails lie flush on the asphalt or curb islands. The big ones (rails, wires, mainline beds) are made of ≤ 8 m and ≤ 30 m pieces so chunking can distance-cull them. The mainline railway shares the tram rail, wire and arm meshes and adds only `RailBallast`, `RailEndWalls` (end walls and boundary plinths) and `RailFence` (planes with a `maskNode` mesh pattern and a screen-door fade at distance; no shadows). Current headless layout counts and their measurement limits are in [world.md](world.md#tram-infrastructure). The dated scene measurements below used a different harness and remain historical baselines. Their per-instance data (`tie` on mainline rail ballast, `fence` on the rail fence, `plateCell` on the name plates) are `InstancedBufferAttribute`s, which chunking copies. Wires, rails and plates cast no shadows. The shelter glass is the only transparent part, and it uses `transparentEffectMRT` (exported from tsl-materials.js).
- Trees run their own cell culling and LOD in `trees.js`: one hidden group per cell, levels set from `scene.onBeforeRender`, and matrices frozen. They are not handled by `scene-culling.js`. The tier's LOD and draw distances come from `QUALITY_TIERS[*].trees` (see Quality tiers); the low profile additionally merges LOD meshes.

## Procedural texture budgets
- The large procedural canvases are 1024 × 832 (tram stop name plates), 1024 × 692 (Śródka mural) and 224 × 1248
  (tram cab destinations), down from 2048 × 1664, 2048 × 1383 and 448 × 2496 on 2026-11-11 (GPU 37.4 → 9.4 MB with
  mipmaps); the plaque and mural cameras showed no visible change at street distance. Keep `generateMipmaps` on: every
  one of these is minified at distance, and the mip chain is already included in those sizes (×4/3).
- Keep `texture.image` (the canvas) after upload. three.js WebGPU reads it again when `texture.version` changes or the device is re-created; dropping it logs "Renderer: Texture marked for update but image is undefined" and leaves the texture blank on re-upload. The saving comes from the pixel size, not from releasing the source. The three downscaled canvases retain about 7 MB of CPU-side pixels instead of about 29 MB.
- The 3612 × 400 shop-sign atlas (512 × 96 px tiles), the 2048 × 1024 tree leaf atlas and the street name-plate atlases
  (1440 × 1764 / 2048 × 536) are deliberately unchanged: storefront words, leaf silhouettes and plate lettering are
  read up close, and the halved plates were visibly blurred in a 1.4 m close-up (user decision, 2026-11-11).

## Culling (`scene-culling.js`): registering new static geometry
- `setupSceneCulling` walks only the roots that `main.js` lists by group name: `CityGrid`, `Airport`, `CityBlocks`, `StreetDetails`, `Landmarks`, `Outskirts`, `Bridges`, `TramInfrastructure`. Put new static city geometry under one of these groups, or add the new group's name to that list. Moving parts stay outside them: the Ratusz goats live in the unculled `LandmarksDynamic` root.
- What it does, by threshold:
  - Instanced meshes with ≥ 64 instances, ≥ 40k triangles in total and a bounding radius of at least 1.5 km are split into spatial chunks with a distance cull. The distance comes from the 90th-percentile instance size, and `MeshBasicNodeMaterial` glows get 3×. Cheap geometry gets a wider cell (`chunkCellScale`: 2× at ≤ 40 triangles per instance, 1.5× at ≤ 120): tree-pit boxes and plates are still sub-pixel at 1–2 km, while hydrants keep the tighter cell; the lamp masts get a cull distance over 2 km and take the next rule.
  - Meshes that would get a cull distance over 2 km are chunked into 1 km cells, frustum culling only.
  - Opaque shadow casters with ≥ 20k triangles and a radius over 600 m get position-only stand-ins on `SHADOW_PROXY_LAYER`, a layer only the cascade cameras render. The originals get `castShadow = false`.
  - **Cheap street props get merged shadow stand-ins before chunking (high tier only).** Under `StreetDetails`, `TramInfrastructure` and `CityGrid`, casters with 4k–300k triangles and a radius over 300 m (trees excluded; hydrants at 0.96M triangles and lamp masts at 2.8M stay direct/instanced) are baked into one position-only mesh per 500 m cell and face side, sharing the same `SHADOW_PROXY_LAYER`. The shadow pass needs depth only, so all prop geometries of a side share one draw per cell instead of one per category per 250 m chunk; the high tier keeps casting exactly the same triangles. Baked positions are 36 bytes/triangle: the current set is 1.21M triangles (down from 1.42M before the heavy-prop geometry cut), about 44 MB if every cell is ever uploaded, but only the cells the cascades actually render are uploaded (`attributes` grew 5.9 MB over eight views). The stand-ins are flagged `userData.propShadowProxy`. `main.js` passes `propShadowProxies: qualitySettings.shadowCasters`, so **low does not build them at all**: it disables those casters anyway, and skipping the bake keeps its heap unchanged. Standalone cost on high: +52 MB retained heap, +5.8 MB GPU at boot, +326 ms in the culling phase. Cell positions are filled in two passes into typed arrays; keeping them in JS number arrays first cost ~300 MB of transient boot heap.
- **Heavy street furniture is a vertex budget, not a draw budget.** The LED mast (23,193 instances) and the hydrant
  (5,144) are the largest instanced furniture meshes. Their geometry is deliberately reduced where the detail is
  sub-pixel at street distance (mast 284 → 120 triangles, hydrant 266 → 186, gas lantern 268 → 176, bollard 88 → 56,
  advertising-column frame 384 → 246), while the visible silhouettes, materials and layer/draw structure stay
  unchanged. All `StreetDetails` instanced meshes are 5.79 M built triangles, down from 10.22 M; high-tier frame
  totals fall 11.7 % at Rynek and 13.2 % at the Centrum drone with identical draw calls. See
  [perf-heavy-props-2026-11-11](observations/perf-heavy-props-2026-11-11.md).
- **The originals are removed from the scene and replaced.** Any reference a builder holds to such a mesh goes stale. Shadow stand-ins are baked world-space copies and never follow later edits to the original.
- Anything that changes after the build must stay out of this pass: moving parts, re-filled pools, `count < capacity`. Ways to opt out: set `frustumCulled = false`, keep it outside the roots (traffic and pedestrians live under `TrafficAndPedestrians`), or set `visible = false` on the mesh itself at setup time. Meshes with `count !== instanceMatrix.count` are skipped as well.
- Chunks and stand-ins set `userData.sharesPipelineWith` to a representative, so `precompileShaders` and the warm-up frame compile one object per pipeline. If you build a family of meshes that share a material, mark them the same way (`trees.js` does). `precompileShaders` skips stand-ins, which compile in the warm-up frame instead.

- Signal lenses share an RGBA8 `DataTexture`, one texel per `SIGNAL_PLANS` entry: two vehicle phases and two pedestrian
  display states. An immutable `signalIndex` instance attribute selects the texel; scene culling copies it with the
  geometry. `street-details.update` refreshes changed state from `updateSignal` even in daylight or without a camera.
  This keeps dynamic pedestrian requests and disabled signals in sync after chunking, with one extra vertex buffer
  and `4 × SIGNAL_PLANS.length` bytes per changed upload. The shader only decodes the phase and flashes green at 1 Hz.
- Storefront signs are one `InstancedMesh` (`ShopSigns`) with one 3612 × 400 canvas atlas: 28 designs in a 7 × 4 grid
  of 512 × 96 px tiles with a 2 px background gutter. The per-instance `signCell` attribute is copied by the streamed
  refill (`buildings.js` `update`), and the TSL `colorNode` maps `uv()` into the chosen tile, sampling 2 px inside the
  tile so the gutter absorbs mip bleed. The former 26 per-design meshes and textures cost 26 draw calls and 26 texture
  bindings. Each sign steps 0.75 m back from its awning centre along the block's turned wall normal, so it stays 0.15 m
  proud of the facade on angled frontage frames. The pool is `frustumCulled = false` like the other streamed detail
  meshes, so it stays out of chunking.
  [Measurement record](observations/shop-signs-atlas-2026-11-08.md).

## Static and dynamic transforms

Almost the whole scene is built once and never moves: 41,065 meshes in the 2026-11-11 audit (37,826 after the same-day
draw-call batching), of which only the player
models, the pooled vehicle lights, the animated Ratusz goats and the light pools change a transform. three.js still
walked the whole graph and recomputed the same world matrices in every render pass: `updateMatrixWorld` was 18.4% of
the frame CPU at Rynek. `js/static-matrices.js` freezes that walk after the build (`scene.updateMatrixWorld(true)` once,
then `scene.matrixWorldAutoUpdate = false`) and `main.js` calls `updateDynamicMatrices` on an explicit list of roots
before `renderPipeline.render()`.

The registry is an explicit root list, not a `staticRoot` group. The moving objects are spread over the traffic, tram,
landmark and controller systems, and several are direct scene children built by their own modules (the player's crowds
and helmet, the light pools). Re-parenting them into one group would change direct parent references and the space
matrices existing code uses, for no gain. A missing root freezes in place, so the list is part of the rendering
contract: `collectDynamicRoots` (same file) names every root, and anything that starts moving at runtime must live under
one of them.

The roots updated every frame:
- `sunLight`, `hemiLight` and `sky` (time presets re-pose the sun and re-parent the sky into the PMREM bake scene).
- `LandmarksDynamic`: the Ratusz goats and their doors (the static `Landmarks` root is frozen). This is the only
  animated landmark part; clocks, flags and water are shader- or texture-driven.
- `TrafficAndPedestrians` and `Trams`: their instanced meshes only rewrite `instanceMatrix` (which needs
  `instanceMatrix.needsUpdate`, not an object matrix update), but the pooled headlights, emergency lights and their
  targets are re-posed every frame.
- `StoreClusteredLights` and `StreetClusteredLights`: the store and streetlight spot pools move from a fixed site list
  (`buildings.js` `updateLights`, `street-details.js` `update`).
- The player's four entity roots (`PlayerPerson`, `PlayerTaxiCar`, `PlayerCyclist`, `PlayerHelicopter`), the cyclist's
  separate helmet mesh, and the player's `PersonCrowd` meshes. The skinned crowds animate through vertex attributes, so
  their object matrices never change, but they are listed because they are scene children that move with the player.

Everything else is frozen: `CityGrid`, `Airport`, `CityBlocks`, `Canopies`, `StreetDetails`, `Landmarks`, `Outskirts`,
`Bridges`, `TramInfrastructure`, `RoadMarkings`, `BusLaneMarkings`, the shadow stand-ins and the trees (which already
freeze their own cells). Streamed building detail, trees, traffic and pedestrian instances update per-instance data
only; visibility (`visible`, chunks, tree cells) is not a matrix update. Frustum culling and the shadow cascades read
`matrixWorld`, so the one freeze pass must run after `setupSceneCulling` and after the instanced-matrix swap, and any
object added to the scene after it needs `updateMatrixWorld(true)` (or must sit under a listed root). A bare `scene.add`
after the freeze never gets a world matrix.

Measured 2026-11-11, 1280 × 720 WebGPU, on this Mac. The renderer's `scene.updateMatrixWorld()` pass costs 1.3–1.7 ms
per call (43,499 objects) and 13–22 ms at `Emulation.setCPUThrottlingRate 6` across runs; the 531 objects under the 17
dynamic roots cost 0.02–0.14 ms. In a 5 s Rynek CPU profile `updateMatrixWorld` falls from 16.4% of samples to 0.3% at
60 Hz and from 10.8% to 0.38% at 6×. Alternating the automatic and frozen update inside one run, Rynek street view
renderer CPU falls
13.3/12.6 → 10.0/10.3 ms at 60 Hz and 111.3/105.6 → 85.1/80.8 ms at 6× (frame 129.9/122.7 → 102.2/95.3 ms);
Centrum drone falls 21.0/21.9 → 18.9/20.4 ms and 145.7/129.5 → 119.1/112.9 ms. The same-frame render is
pixel-identical with and without the freeze, and the change adds no draw call.

## Start-up compile and warm-up
- The order matters. First an empty `renderPipeline.render()` with `scene.visible = false`, which configures the MSAA and depth formats of the scene target. Then `compileAsync` over 16 parallel workers, with the scene pass's render target and MRT bound. Then the first loop frame runs with frustum culling off and `updateSceneCulling` skipped, so the shadow-pass pipelines compile behind the loading screen.
- Objects or materials that first appear after this point compile on first sight and cause a hitch. Create them during the build, visible or in their pool, so these passes see them.
- The `[init] …` timings logged once at start-up (`markInit`) are the regression signal for load time.
- Historical baseline, before the later traffic and infrastructure fixes (Node with the three.js build and a stub DOM, the scene builders of `initApp` and `setupSceneCulling`, no renderer; 2026-10-28): over the 8.2 × 5.7 km box the builders take ≈ 3.1 s (city-config 0.22, cityGrid 0.55, blocks 0.61, streetDetails 0.64, traffic 0.33, tramInfra 0.40 s) and leave 14.6k meshes, 474k instances and 12.4M triangles before culling (CityBlocks 133k instances, StreetDetails 86k, TramInfrastructure 195k, Outskirts 47k); culling setup 55 ms. With every distance-culled chunk in range but no frustum test, about 1.7k meshes and 8.9M triangles remain drawable from the Rynek (1.5k and 6.2M over the 6.1 × 3.7 km box, whose build took ≈ 2.0 s: 7.8k meshes, 292k instances, 7.8M triangles).

## Browser validation status

The 2026-10-29 WebGPU smoke check booted and compiled with a clean console and visible signal lenses. The WebGL2
draw-buffer error recorded then was traced to pedestrian pose storage and fixed on 2026-10-30; see the
[observation record](observations/webgl2-2026-10-30.md) for reproduction, movement checks and full-scene validation.
Detailed roof, material, culling and performance checks remain in the [backlog](backlog.md).
