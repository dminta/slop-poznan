# Zebra and tram-ballast visibility — 2026-10-30

The remaining Phase 15.8 report that ballast covers zebras does not reproduce in the current scene. Existing
commits `8274083` (leave the trackway unpainted) and `16960f3` (keep ballast off carriageways and lanes) already
remove the conflict. This follow-up adds regression coverage and closes the stale backlog entry; it changes no
production geometry or materials.

## Geometry measurement

Two independent headless audits built the real city grid, its live plaza/park exports, street furniture, road
network, pedestrian crossings, road paint and tram layout. Building, landmark and bridge colliders were omitted
in this variant. Both found 2,411 crossings, 2,563 emitted zebra quads, 7,760 raised tram beds and zero overlap.

The committed regression reads the paint builder's Float32 position and pattern attributes. It clips each whole
zebra quad against nearby bed rectangles, including the rendered bed's 0.01 m extension at each end. This checks
the whole band, including stripe gaps, and detects narrow intersections without relying on sampling. Road paint
is at y = 0.012 m; raised tram ballast reaches y = 0.14 m, so horizontal overlap would bury the marking.

A positive control calls the same builder with no rail-clearance callback. On the same crossings it produces
68.496325 m² of summed quad/bed intersection area, proving the test can detect the reported failure. This number
includes gaps between stripes and may count intersecting beds separately; it is not unique hidden white-paint
area. A temporary diagnostic variant reducing the rail cut to 1 m also failed the overlap assertion. The current
zero result needs neither qualification about gaps nor area deduplication.

## Full-scene browser checks

Chrome loaded the current CDN modules through temporary local servers, once with the default WebGPU backend
and once with `forceWebGL: true`. All production builders ran, including buildings, landmarks and bridges.
Before static culling, a temporary audit transformed actual `TramBallast` top-face vertices by their instance
and world matrices, then clipped actual `RoadMarkings` zebra quads against those rectangles.

| Backend | Zebra quads | Raised tram beds | Overlap | Minimum horizontal gap |
|---|---:|---:|---:|---:|
| WebGPUBackend | 2,563 | 7,760 | 0 m² | 0.386204 m |
| WebGLBackend | 2,563 | 7,760 | 0 m² | 0.386204 m |

Both scenes rendered at least 60 loop frames. Temporary console warning/error and uncaught-error/rejection
capture recorded no messages during these checks. The UI's static WebGPU label was not used to identify the
backend; the initialized renderer reported its backend class.

Midday visual inspection covered Święty Marcin / aleja Niepodległości near `−1105, 132` on WebGPU and the
closest-gap crossing at Wierzbięcice / Królowej Jadwigi near `−853, 797` on WebGL2. The zebras were visible beside
the unpainted track corridor; the light bars inside the track beds are procedural concrete sleepers.

These are geometry audits and rendered spot checks, not an exhaustive visual inspection from every camera,
distance and lighting preset. The CPU geometry audit does not model the marking shader's subpixel widening.
No traffic, pedestrian routes, ground collision or signal behavior changed. Diagnostic servers and hooks lived
only in temporary files, outside the application source.

## Validation

`node --test tests/zebra-visibility.test.cjs tests/road-paint.test.cjs`: 5/5.

`node --test tests/`: 290/290, 36.60 s.
