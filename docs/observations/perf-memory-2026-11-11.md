# Memory diet: landmark canvases and build-time data (2026-11-11)

**Retained on `poznan` (user decision, 2026-11-11):** only the Śródka mural, the tram-stop name-plate atlas and the
tram cab destination atlas were downscaled (GPU 37.3 → 9.4 MB of the 55.9 → 14.0 MB below). The street name-plate
atlases stay at full size, because the halved plates were visibly blurred in the 1.4 m close-up, and `releaseBuildData()`
was rejected: ~20 MB of JS heap (~2 %) did not justify nulling `GEO` / `BLOCKS` fields that runtime code might still
read. The rest of this record describes the full experiment as measured.

## Question

The [older-device audit](perf-older-devices-2026-11-11.md) found 903 MB of JS heap after a forced GC (1.15 GB peak),
412.5 MB of GPU memory, three procedural canvases of 17.3 / 14.4 / 12.9 MB and 30,259 tree LOD meshes holding three
copies of the instance data. This record measures how much of that can be released without a visible or behavioural
change: downscale the oversized canvases, drop the raw geodata and per-block layout data after the world is built, and
check whether the dormant tree LOD buffers can be shared.

No production behaviour, geometry or draw distance changed. The only visible target was texture resolution; the browser
screenshots below are the review.

## Method

Headless Chrome 157 on an Apple-silicon Mac (WebGPU, `--enable-unsafe-webgpu`), 1280 × 720, `pixelRatio` 1, serving this
worktree on port 8112. The harness is `.agent-task/perf-harness/` (the audit's `perf.html` / `run-perf.mjs`, with the
module paths refreshed for the current layout and `releaseBuildData()` added to its `perf-main.js` copy). Each run builds
the production modules unchanged apart from the URL-switch copy of `main.js`.

- `jsHeapMB` is `performance.memory.usedJSHeapSize` after `HeapProfiler.collectGarbage`, read by the harness after the
  first 20 frames. The `[init]` heap marks are the unforced phase readings.
- GPU memory is `renderer.info.memory` (`total`, `texturesSize`, `attributesSize`, `storageAttributesSize`).
- Canvas MB are `width × height × 4` with a ×4/3 mip factor, i.e. the same accounting as the audit, not an allocator.
- Screenshots are `Page.captureScreenshot` of the canvas from frozen cameras; the before/after cameras, exposure and
  preset are identical. Pixel differences are mean absolute RGB error over the sign/wall crop, plus the share of pixels
  whose largest channel error is over 24/255.
- Heap retainers: a Chrome heap snapshot before and after, aggregated by node self size ("before" summary below), and a
  page-side reachable-size walk of the named roots (`GEO`, `city-config`, `cityBlocks`, `network`, `streetDetails`,
  `cityGrid`, `trafficSystem`, `mapSystem`) to attribute the change. The walker double-counts objects shared by two
  roots, so only per-root deltas are used, not their sum.
- The machine was running other agents' benchmark processes; load and peak-heap readings are noisier than the post-GC
  heap. The observation below states which numbers are stable and which are run ranges.

## Changes

### Canvas textures

| Texture | Before | After | GPU before | GPU after |
|---|---|---:|---:|---:|
| Śródka mural (`landmarks-heritage.js` `MURAL_PX`) | 2048 × 1383 (≈1 cm/texel) | 1024 × 692 (≈2 cm/texel) | 14.41 MB | 3.60 MB |
| Tram stop name-plate atlas (`tram-infra.js` `PLATE_CELL`) | 2048 × 1664, 256 × 128 cells | 1024 × 832, 128 × 64 cells | 17.33 MB | 4.33 MB |
| Street name-plate atlas, small (`street-details.js` `PLATE_SIZES.small`) | 1440 × 1764, 180 × 126 cells | 720 × 882, 90 × 63 cells | 12.92 MB | 3.23 MB |
| Street name-plate atlas, large (`PLATE_SIZES.large`) | 2048 × 536, 256 × 134 cells | 1024 × 268, 128 × 67 cells | 5.58 MB | 1.40 MB |
| Tram cab destination atlas (`actor-models.js`) | 448 × 2496, 64 px rows | 224 × 1248, 32 px rows | 5.69 MB | 1.42 MB |
| **Total** | | | **55.93 MB** | **13.98 MB** |

MB include the mip chain (×4/3). The atlas cells are now 3.5–6.25 mm per texel on 0.32–0.8 m signs, and the mural is
~2 cm per texel on its 20.2 m wall. `generateMipmaps` stays on for all of them: every one is minified at distance, and
the atlas shaders sample inside their tiles.

Full procedural-texture inventory (MB are with mips unless noted):

| Module | Texture | Size | MB | Action |
|---|---|---|---:|---|
| `landmarks-heritage.js` | Śródka mural | 2048 × 1383 → 1024 × 692 | 14.41 → 3.60 | halved |
| `tram-infra.js` | tram stop plates | 2048 × 1664 → 1024 × 832 | 17.33 → 4.33 | halved |
| `street-details.js` | street plates, small / large | 1440 × 1764 / 2048 × 536 → 720 × 882 / 1024 × 268 | 12.92 + 5.58 → 3.23 + 1.40 | halved |
| `actor-models.js` | tram cab destinations | 448 × 2496 → 224 × 1248 | 5.69 → 1.42 | halved |
| `buildings.js` | shop-sign atlas | 3612 × 400 | 7.35 | kept (512 × 96 tiles, read close up) |
| `buildings.js` | scaffold wraps ×4 | 512 × 512 each | 5.32 total | kept (advert text) |
| `trees.js` | leaf atlas (`DataTexture` + custom mips) | 2048 × 1024 | ~10.7 | kept (foliage silhouettes) |
| `outskirts.js` | land use / zone (`DataTexture`) | 1024 × 1024 RGBA / 1024 × 1024 R8 | ~5.3 + 1.0 | kept (26 m terrain cells) |
| `tsl-materials.js` | land / park mask, water wave | 1020 × 710 / 510 × 355 R8, 256 × 256 RGBA16F | ~0.7 / 0.17 / 0.65 | kept (shader masks) |
| `traffic.js` | bus destination | 512 × 256 | 0.67 | kept |
| `actor-models.js` | car plate / lettering / crest / taxi / emergency | 1792 × 114, 512 × 384, 192 × 256, 256 × 112, 512 × 128 | ~0.78 / 1.0 / 0.25 / 0.14 / 0.33 | kept (small and text-critical) |
| `controllers.js` | taxi stripe ×2 / player plate | 1111 × 96 each, 1040 × 228 | 0.54 each / 1.21 | kept |
| `street-details.js` | pedestrian figure / poster | 128 × 256 / 512 × 256 | 0.17 / 0.67 | kept |
| `street-details.js` | signal state (`DataTexture`) | `SIGNAL_PLANS.length` × 1 RGBA | <0.01 | kept |

Only the five textural atlases large enough to dominate the texture budget were changed; the rest are either small,
read at point-blank range (plates, lettering, storefronts) or an intentionally low-resolution terrain/shader mask.


The canvas source is deliberately kept as `texture.image`. three.js WebGPU reads `texture.image` when
`texture.version` changes and when the device is re-created; clearing it would leave the texture blank on re-upload
("Renderer: Texture marked for update but image is undefined"). The five downscaled canvases retain about 11 MB of
CPU-side pixels instead of about 42 MB. The 3612 × 400 shop-sign atlas (512 × 96 tiles) and the 2048 × 1024 tree leaf
atlas were left alone: both are read close up and halving either loses visible detail.

`paintMural` keeps its composition at the smaller size: the raw pixel constants of the 2048-wide design are multiplied
by `d = W / 2048`, while every metre-based coordinate still uses `px = W / wallW`. The sky, gables, gateway, cat and
pigeons therefore occupy the same part of the wall; only their texel count halves.

### Build-time-only data

`releaseBuildData(targets)` in `city-config.js` is called once from `main.js` after `setupSceneCulling`, before the first
frame. Tests and tools that do not call it keep every field. It releases:

- Raw `GEO` fields: `land`/`landHoles`, `water`, `outskirts`/holes, `districts`, `labels`, `roads`, `roadGraph`, `rail`,
  level crossings, tram routes/stops, plazas, pedestrian ways, blocks and all `block*` tables, `industry`, `canopies`,
  `aeroway`, `trees`, `landmarks`, `frame`. `GEO.parks` stays because `city-map.js` builds its parkland `Path2D` layers
  lazily on the first radar frame, after this call.
- `BLOCKS` layout inputs: `parkFootprints`, `anchors`, `objects`, `fallbackLots`, `built`, `levels`, `buildings`,
  `program`, `area`, `parkName`, `district`. `poly`, bounds, `park`/`median`, `id` and `roadCut`/`tramCut` stay for
  `blockAt` and the map. `rects`/`frames` stay because `pedestrian-routes.js` `inLot()` reads them when it builds a
  fallback link at runtime.
- `cityBlocks.allBlocks` build fields: `yards`, `maxH`, `front`, `corner`, `rynekSides`, `district`, `srcBlockId`,
  min/max bounds and world corners. `footprints` (the map's building layer), `cx`/`cz`, `ry`, cornices, chimneys,
  skylights, HVAC, balconies, awnings and scaffolds stay. `footprintsByBlock` and `industryStructures` are dropped.
- The builders' return-only arrays: `cityGrid` sidewalks/footprints/colliders/prop-colliders/cut plazas, and
  `streetDetails` footprints, `runtimeHeads` (the start-up signal audit) and `treePlacement`. The objects themselves
  stay where the runtime still needs them (colliders are in `allColliders`).
- `trafficSystem.network.paintEdges`, the pre-traffic paint snapshot consumed by `road-paint.js` and `tram-infra.js`.

Everything the runtime reads is kept: player/building colliders, pedestrian routes (including the lazy `inLot` inputs),
the road/traffic graph, the tram graph and stop list, map/radar data, audio signals, teleport and landmark lists.

### Tree LOD buffers

No change. At the Rynek street view the tree field has 30,259 `InstancedMesh` objects, 356,682 allocated instance slots
(118,894 for each of the three LODs) and only 5,390 active instances (28 LOD0, 984 LOD1, 4,378 LOD2). The allocations
are 21.77 MB of instance matrices plus 5.44 MB of `aTreeData` foliage data. The three copies cannot share a buffer: each
LOD mesh needs a contiguous active prefix, and any tree may need any level as the camera moves, so every LOD mesh must
reserve capacity for every tree of its cell/species/variant. Shrinking the dormant capacities or reallocating on level
changes would trade the memory for per-frame allocation and upload hitches. Left as is.

## Results

Baseline (this worktree, default WebGPU, Rynek street view):

| Metric | Baseline | After |
|---|---:|---:|
| JS heap after forced GC | 903.8 MB | **876.0–884.6 MB** (final run 883.9) |
| JS heap peak during load (`[init]` warm-up) | 1159 MB | 1129–1206 MB (final run 1172) |
| GPU memory total | 412.5 MB | **370.5 MB** |
| GPU textures | 281.7 MB | **239.7 MB** |
| GPU vertex attributes | 94.2 MB | 94.2 MB |
| GPU storage / programs / uniform / index | 31.5 / 3.6 / 1.4 / 0.7 MB | 31.5 / 3.6 / 1.4 / 0.7 MB |
| Material textures seen by the harness | 14, 66.5 MB | 14, **28.9 MB** |
| Textures / render targets / programs | 53 / 17 / 290 | 53 / 17 / 290 |
| Draw calls / triangles (Rynek) | 1553 / 7.82 M | 1550–1571 / 7.83–7.88 M |
| Load to 20 frames | 17.7 s | 17.0–21.6 s (final run 18.1 s, machine under load) |

The stable result is the post-GC heap (−19 to −28 MB) and the deterministic GPU texture saving (−42.0 MB). The peak and
load readings move with the other processes on the machine; the baseline run itself recorded 1159 MB while the audit
recorded 1.15 GB, and the after runs ranged from 1129 to 1206 MB; the final 18.1 s run recorded 1172 MB, within
~1% of the baseline peak. No geometry, instance count, material count or draw
distance changed, so the small draw/triangle differences are traffic and frame-sampling variance.

Per-root reachable-size estimate (page-side walk; shared objects count in each root, so do not sum the deltas):

| Root | Before | After | Released |
|---|---:|---:|---:|
| `GEO` | 10.95 MB | 0.47 MB | 10.5 MB (raw geodata; `parks` kept) |
| `cityBlocks.allBlocks` | 59.15 MB | 46.45 MB | 12.7 MB (build-only block fields) |
| `cityBlocks` (all fields) | 71.60 MB | 58.91 MB | 12.7 MB |
| `trafficSystem` / `network` | 27.50 / 23.45 MB | 21.0 / 17.1 MB | 6.4 MB (`paintEdges`) |
| `streetDetails` | 37.20 MB | 26.6 MB | 10.6 MB (runtime head audit, footprints, tree placement) |
| `cityGrid` | 8.90 MB | 0 MB | 8.9 MB (return-only arrays) |
| `mapSystem` | 115.59 MB | 96.3 MB | 19.3 MB (mostly the shared `allBlocks`) |
| `city-config` namespace | 19.60 MB | 18.94 MB | 0.7 MB (block layout fields) |

The before heap snapshot's largest self-size classes were `system / JSArrayBufferData` 306.3 MB, `(object elements)`
115.5 MB, `heap number` 113.9 MB, `Object` strings 94.0 MB, `NodeData` strings 39.3 MB and `Array` strings 28.3 MB.
The scene graph (40k `InstancedMesh`, 37.9k `BufferGeometry`, 138k `Matrix4`, 147k `Vector3`) and its geometry buffers
still dominate; this diet cannot move them without changing the scene representation.

## Visual check

Screenshots are in `.agent-task/shots-before/` and `.agent-task/shots-after/` (scratch, not committed). The cameras are
frozen at a street view and a close-up for each downscaled sign/mural; the tram LED display was also captured at
`time=midnight`.

| View | Mean absolute RGB error | Pixels > 24/255 | Result |
|---|---:|---:|---|
| Mural, 12 m street view (wall crop) | 0.77/255 | 0.8% | Composition and all figures unchanged |
| Mural, 5 m close-up (wall crop) | 1.28/255 | 1.2% | Cat, pigeons, window figures and lane still read |
| Large street plate, 2.2 m (sign crop) | 4.07/255 | 8.6% | Text crisp; close-up is softer at the edges |
| Small street plate, 1.4 m (sign crop) | 3.98/255 | 9.0% | "Mostowa / STARE MIASTO" still crisp |
| Tram stop plate, 2.2 m (sign crop) | 3.02/255 | 4.7% | "TRAMWAJ" band and stop name still read |

The small non-zero floor is antialiasing and the moving traffic/pedestrians in the background. The mural's 2048 → 1024
halving is the strongest test: at 12 m the wall differs by less than one 8-bit level on average, and the close-up only
loses texel-level noise in the paint. The street plates are the only place where a close-up is visibly softer, at
0.8 m from a 0.67 m sign; at their normal 2–5 m viewing distance they are unchanged. No downscaled landmark texture
has emissive content; the tram cab LED display was checked at midnight and still shows the line and terminus.

## Checks run

- `node --test tests/*.cjs`: 486 pass, 0 fail.
- `node --test tests/`: 502 pass, 0 fail (`.agent-task/tests-full-final.log`).
- Browser perf run, `?gc=true`: no console errors, no `[compile]` warnings, 20+ frames after load, map/radar rendering
  through the first frames (the minimap exercises the lazy park layers and `GEO.parks` retention).
- Production `index.html` boot: loading overlay hidden at 17.7 s, 56 fps two seconds later, no page or console errors
  (`.agent-task/production-check.json`; a repeat on the same busy machine took 19.5 s and 48 fps, still error-free).
  The full map was opened and rendered after the release with no errors
  (`.agent-task/map-check.json`, `.agent-task/map-after.png`); its parkland layer is drawn from the kept `GEO.parks`.
- Before/after screenshots and pixel diffs as above.

## Limits and what was not changed

- No real phone or low-memory device was tested. The GPU numbers are headless Apple-silicon numbers from
  `renderer.info.memory`, not an allocator trace.
- The heap snapshot gives class-level self sizes for the before state; the after comparison uses the targeted root walk.
  A full dominator tree was not computed, and shared roots make the per-root table additive only within a row.
- The peak-heap and load-time ranges include other agents' benchmarks running on the same Mac.
- Tree LOD buffers (27.2 MB allocated, 5,390 active) were measured and left unchanged for the reason above.
- The 3612 × 400 shop-sign atlas and 2048 × 1024 tree leaf atlas were not downscaled; both are read close up.
- The canvas sources stay referenced for three.js re-upload; only their pixel dimensions were reduced.
