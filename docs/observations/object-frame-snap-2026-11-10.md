# Object-frame snap investigation — 2026-11-10

> Measured at `42329c3`, before `564975e` (length-weighted pedestrian street spawns, which reshuffles seeded draws in
> districts with pedestrian streets) and `5e6a68e`. [Re-measured and closed at `5e6a68e`](#closed-at-5e6a68e) below.

The 2026-11-09 alignment record predates the current dense-district legacy layout. A headless build using the fixture
from `tests/buildings-density.test.cjs` now finds 4,573 details in framed Stare Miasto, Jeżyce, Wilda and Łazarz
blocks; 4,569 are within 2° of a frame and four are 5–10° away. The earlier 5,003 / 4,871 / 132 counts no longer
describe this build. The current legacy filter excludes all four mapped objects of block 877, whose area is below the
industrial exception threshold. The historical loss of 34 stations therefore cannot be reproduced by rotating those
objects in the current layout.

A diagnostic build changed only the threshold in the source passed to the test harness, without changing the source
file. The 3°, 4° and 5° thresholds each produced 4,569 on-frame details; 6° produced 4,570. These are detail counts,
not counts of distinct objects, and the wider probes had no frontage, pavement or overlap guards. They do not
establish that a wider threshold is safe in other districts. The earlier blanket wider snap remains rejected for the
historical layout; these probes are not a guarded implementation.

No per-object guard was implemented, and frontage station counts per district and other-district effects were not
measured. Keep the 3° default pending those comparisons. The scratch harness (`.agent-task/measure.cjs` in the Codex
worktree, not committed) loads `js/buildings.js` through the `tests/buildings-density.test.cjs` fixture with the
threshold substituted and counts central framed details by their distance to the nearest frame.

## Closed at 5e6a68e

Re-running the same harness (the `tests/buildings-density.test.cjs` fixture with the threshold substituted) on
`5e6a68e` gives the same counts: 4,573 central framed details, 4,569 within 2° of a frame, 4 at 5–10° and none over
10°, at 3°, 4° and 5°; 6° aligns one more. With only four details off-frame there is nothing for a wider or guarded
snap to gain, so `OBJECT_FRAME_SNAP` stays 3° and the backlog item is closed.
