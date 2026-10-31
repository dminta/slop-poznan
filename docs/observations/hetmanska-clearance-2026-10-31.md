# Hetmańska/Dmowskiego tram clearance — 2026-10-31

## Defect and correction

The earlier [inspection](krucza-hetmanska-2026-10-31.md) confirmed a 47.5 m² six-vertex curb island near
`−2446, 2204` (current block 1235) crossing the tram corridor. Two adjacent pieces of rail 570, spanning
7.991974 m, took ground height 0.22 m instead of zero. Rail tops consequently jumped from 0.016 to 0.236 m.
The actual raised curb/slab also occupied the rail heads, so lowering rails alone would bury them.

The local correction selects the empty island by the surveyed point rather than its generated index. It
collects nearby real tram segments and cuts their standard 2.2875 m clearance quads from the curb and inset
sidewalk. `blockAt` excludes the same quads, including their extended ends, so all existing ground consumers
see the rendered surface. The opposite track also crosses the island: every part lies inside the combined
corridors, leaving no raised remnant. Neighbouring sidewalks remain raised. No generated data changes.

## Deterministic regression

`node --test tests/hetmanska-clearance.test.cjs` runs real city-grid, street-furniture, road-network,
pedestrian-route and tram-layout code through the documented headless harness. It records actual curb and
sidewalk extrusion, not only the height helper. Its original-world replay loads city-config without the local
correction, retaining the original `blockAt` and original furniture placement rules.

- The initial tests failed on 7.991974 m of raised rail and an actual slab covering a rail head near
  `−2449.91, 2201.86`.
- After the fix: raised rail **7.992 → 0 m**, conflicting curb **47.5 → 0 m²**. The three original nearby
  rail pieces remain, flush and without added ballast. Sampling checks the centreline and both rail heads.
- `blockAt(−2446, 2204)` returns street ground; a neighbouring island retains its rendered slab and raised query.
- All road-bounding sidewalks, grid footprints, bare/furnished lane geometry, street-furniture footprints and
  real pedestrian crossing endpoints match the original-world replay. Numeric guards ensure the lane and
  crossing snapshots contain actual coordinates.

This variant omits building, landmark and bridge colliders; it does not measure rendered appearance or performance.

Validation: focused regression **4/4** (12.06 s); `node --test tests/` **296/296** (38.63 s), including the
unchanged Jeżyce/Centrum traffic-flow limits. `git diff --check` passes.

## Browser checks

Local Chrome, full scene, Midday, WebGPU and forced WebGL2. A temporary local HTTP wrapper serves the current
modules and instruments only the review page: it forces the backend where needed, locks the camera and reports
console warnings/errors, uncaught errors and rejected promises to a local log. No review hooks enter app sources.
The player stays at its default spawn, so the HUD/radar still describes that player rather than the review camera.

Both backends rendered at least 60 frames per checked camera with no captured warnings/errors/rejections.
Viewed the cleared track area from `−2465, 14, 2220` and from street level at `−2463, 1.3, 2195`, looking toward
`−2446, 0.2, 2204`. Spot checks show exposed continuous rails without the small raised island across them.

These are targeted geometry and boot checks. They do not establish continuous tram clearance, traffic yielding,
NPC route traversal or performance. Those broader checks remain in the backlog.
