# Shop-sign atlas — 2026-11-08

The backlog asked to check the new storefront signs and consider an atlas if the measurements justify it. They did:
`buildCityBlocks` used to create **26 instanced meshes**, one 512 × 96 canvas texture and one material per sign
design, so the whole city paid 26 sign draw calls and 26 texture bindings for the same ~750 signs visible around the
centre. The signs now share **one 3612 × 400 atlas and one `ShopSigns` instanced mesh**, with a per-instance
`signCell` attribute selecting the tile in the TSL sign shader.

## Implementation

- 28 designs in a 7 × 4 grid: the former 26 Polish shop names plus text-only **ŻABKA** and **BIEDRONKA** (company
  colours, no logos). The grid is exactly full, so there is no unused cell.
- Each 512 × 96 px tile sits in a 516 × 100 px cell with a 2 px background-coloured gutter. The shader samples 2 px
  inside the tile, so bilinear and mip filtering fade into the tile's own background instead of a neighbour. Text,
  border and font are unchanged from the separate textures.
- `js/buildings.js` creates one `CanvasTexture` and one `MeshBasicNodeMaterial` whose `colorNode` samples the atlas at
  `uv() * tileSize + cellOrigin + gutter`. The existing `plateCell` pattern in `street-details.js` and `tram-infra.js`
  uses the same flip-Y cell mapping.
- The sign pool is one `InstancedMesh` of `MAX_AWNINGS` 1,800 instances (at most one sign per awning), not 26 pools
  of 134. The streaming update writes the matrix and a `signCell` vec2 per sign, then uploads only the used prefix
  through two `flagRange` calls instead of 26.
- The streamed sign mesh is still `frustumCulled = false`, like the other building-detail pools, so scene culling
  leaves it alone and the mutable instance data is safe.

## Draw calls and meshes

A one-off headless harness wrapped the three.js constructors while running the real `buildCityBlocks` (the same
inert-three `loadModule` setup as `tests/buildings-density.test.cjs`). It counts the instanced meshes the builder
creates, before and after this change:

| metric | before | after |
|---|---:|---:|
| instanced meshes from `buildCityBlocks` | 39 | **14** |
| sign instanced meshes / draw calls | 26 | **1** |
| sign textures / materials | 26 / 26 | **1 / 1** |
| sign instance slots | 26 × 134 = 3,484 | **1,800** |
| streaming upload ranges per refill | 26 | **2** |

The old per-theme capacity was never full in the measured streams (the busiest theme at Stary Rynek held 39 of 134),
so no sign is dropped by the tighter total capacity. The sign count equals the awning count: at most one sign per
awning, capped at `MAX_AWNINGS`.

The same harness queried the real quadtree and hashed each awning exactly as the production update does:

| focus | signs in the 560 m stream | old sign draws (of 26 themes) | new sign draws |
|---|---:|---:|---:|
| Stary Rynek | 758 | 26 | **1** |
| Jeżyce / Kraszewskiego | 371 | 26 | **1** |
| Łazarz / Głogowska | 273 | 26 | **1** |
| Wilda / Górna Wilda | 346 | 26 | **1** |
| Śródka | 238 | 26 | **1** |
| Winogrady | 46 | 23 | **1** |

All 26 old themes had at least one instance at the five dense foci, and all 28 new themes are used there. Winogrady
is the sparse case: 23 old themes and 25 new themes, but the new mesh still issues one draw. The earlier browser
observation recorded +21 calls rather than +25, so the exact saving depends on how many zero-count themes the
renderer skips; this change removes that dependence entirely.

## Texture and buffer cost

| item | before (26 designs) | after (28 designs) | same 28 designs separate |
|---|---:|---:|---:|
| atlas / textures | 26 × 512 × 96 | **3612 × 400** | 28 × 512 × 96 |
| level-0 RGBA8 texels | 1,277,952 | **1,444,800** | 1,376,256 |
| level-0 RGBA8 bytes | 5,111,808 (4.88 MiB) | **5,779,200 (5.51 MiB)** | 5,505,024 (5.25 MiB) |
| instance matrices | 222,976 B | **115,200 B** | — |
| per-instance cells | — | **14,400 B** | — |
| sign instance buffers | 222,976 B | **129,600 B (−41.9 %)** | — |

The atlas is 5.0 % larger than 28 separate tiles because of the gutters, and 12.9 % larger than the old 26-tile set
because it also adds two designs. In exchange it binds one texture, one material and one draw instead of 26, and the
instance buffers shrink by ~91 KiB because the old per-theme pools over-allocated 3,484 slots for at most 1,800
signs. The extra per-sign CPU work is one `setXY` on a vec2 attribute; the removed work is the 26-entry counter
lookup and 26 update-range calls.

## Verification

- `node --test tests/shop-signs.test.cjs tests/city-text.test.cjs`: 7/7 pass. The new test pins the 7-column,
  512 × 96 px tile, the 2 px gutter, the `signCell` attribute, the single `ShopSigns` mesh and the absence of the
  per-theme `signInsts` array. The existing text test still finds 28 unique shop names.
- `node --test tests/*.cjs`: 456/456 pass (82.6 s), including the city rebuild, density, traffic and signal suites.
- `node --test tests/`: 471/471 pass (125.4 s), including the geodata rebuild and the `.mjs` audits.
- No production shader was compiled here: the TSL graph mirrors the already-shipped `plateCell` atlas materials, but
  WebGPU/WebGL2 street-level appearance still needs the browser check now listed in the backlog.

## Remaining check

Walk or drive past shop frontages on WebGPU and WebGL2, including dusk: confirm that each fascia shows its intended
name (no neighbour bleeding at grazing angles), that ŻABKA/BIEDRONKA read correctly, and that the pooled spot-light
colours still match the sign above each awning. The headless suites cannot validate texture filtering or shader
compilation.
