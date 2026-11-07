# Street-tree placement clearances, 2026-11-06

Baseline: `7c425a8`, before the placement change. No commit was made for this work.

`node tools/audit-street-tree-clearance.mjs` builds the real city grid, generic buildings, street furniture,
finished road network and pedestrian crossings through the VM test harness, with inert rendering. `--full` reuses
`audit-tree-clearance.mjs` to include landmark/bridge walls, building-cut park surfaces and leftover-slab population.
Both use production crossing constants (4.3 m band, 4 m reach, 1.75 m setback). The old tree fixtures hardcoded
3 m reach and 1.5 m setback; upgrading those adds one baseline street tree, 18,152 → 18,153.

| Fixture / measurement | Before | After |
|---|---:|---:|
| Landing-zone trunks, either fixture | 655 | 0 |
| Painted zebra-band trunks, either fixture | 5 | 0 |
| Lane-clearance trunks, either fixture | 25 | 0 |
| Off-island trunks, either fixture | 8 | 0 |
| Full scene street trees | 18,109 | 18,056 |
| Full scene total trees | 50,022 | 49,969 |
| Full scene moved / dropped | — | 1,045 / 53 |
| Tree-test fixture street trees | 18,153 | 18,101 |
| Tree-test fixture total trees | 50,100 | 50,048 |
| Tree-test fixture moved / dropped | — | 1,047 / 52 |
| Minimum lane distance, full untrimmed runs | 0.0251 m | 1.2009 m |

The historical backlog's 652 / 5 / 31 / 8 is not exactly reproduced: this checkout gives **+3 landing, 0 zebra,
−6 lane, 0 island** violations. The historical row does not preserve its executable audit or lane/landing geometry.
This audit pins explicit semantics and current builder inputs instead of copying that result. It reproduces both
named lane conflicts at (2044, 1701.6) and (1388, 957.1). Using only trimmed lane runs counts 18 violations with
minimum 0.240 m; the stronger full-run test counts 25 with minimum 0.025 m. Omitting generic building obstacles
still counts 25. In the full fixture, retaining the old hardcoded crossing constants gives 644 landings and
18,108 street trees, compared with 655 and 18,109 using production constants. These scope differences matter;
the old 0.16 m minimum and 31-lane count are retained only as historical observations.

Landing counts call the real `clearOfCrosswalks` with the trunk half-width. Zebra tests intersect the trunk box
against the entire 4 m crossing band, including stripe gaps and rail cutouts (conservative for actual white paint).
Lane tests measure each distinct trunk against the finished lanes' full node-to-node segments, including the
stop-line setbacks, at max(1.2 m, 0.9 m car half-width + circumscribed trunk radius). Island tests require each
trunk corner to belong to the centre's block. A trunk may count in more than one category.

The fix retains the original wall-placement search, then moves invalid trees in deterministic 0.4 m steps along
the same curb up to ±6 m before dropping them. Every replacement rechecks walls, rails, poles, plazas and all new
clearances. Unchanged trees, including future trees in the curb iteration, are reserved before any replacements.
A 4 m spatial hash rejects replacement sites within 3.5 m of unchanged or already moved trees. This preserves the
baseline's **0.372703 m** existing closest pair; the minimum for a moved tree is **3.551308 m** in both fixtures.
The first revision's 0.02 m moved-tree overlap is gone. Every trunk's four corners are checked with
`blockAt` (overlapping blocks can take priority at a corner inside a block's bounds).

Placement is deliberately stricter than the audit: it excludes zebra bands at **every non-shape node arm before
route pruning**, uses **r × √2** for landing checks and a **2.15 m** zebra half-band. The audit uses retained
crossings, landing radius r and the 2 m painted half-band. Of the smaller fixture's **1,099** changed original
sites, **410** had no audit violation and are affected by the stricter placement rule.

The furnished-network snapshot is built after other furniture, before trees; trees still add no traffic
footprints. `main.js` injects the returned `roadNetwork` into `createTrafficSystem`, avoiding the duplicate network
build; the benchmark world does the same. The optional fourth argument retains the builder fallback when omitted.
The index and caches are used only while building. `trees.js`, tree geometry, species assignment and frame updates are unchanged.

Park-tree records have identical before/after SHA-256 hashes: `e607bf98…` in the smaller fixture and `30a36cc0…`
in the full fixture. Furniture/grid traffic footprints retain hash `ca1c9db7…` in both fixtures. Park-paving code
and its tests were not edited.

## Deliberately changed pins

All changes in `tree-distribution.test.cjs` follow street-tree movement/removal and the one-tree correction from
using production crossing constants; species are still selected deterministically from positions.

| Pin | Before | After | Reason |
|---|---|---|---|
| Street trunk count (`street-tree-colliders`) | 18,152 | 18,101 | +1 corrected fixture constant, −52 dropped trees |
| Original species counts | 18,698 / 22,658 / 8,743 / 0 | 18,695 / 22,614 / 8,739 / 0 | Removed trees and corrected fixture |
| Assigned species counts | 17,932 / 21,753 / 8,385 / 2,029 | 17,928 / 21,715 / 8,385 / 2,020 | Position-based locust reassignment changes on moved sites |
| Tree site SHA-256 | `b960c4a3…` | `dd5faf6f…` | Moved/dropped sites, including position-derived yaw |
| Street collider SHA-256 | `ca424611…` | `8cb2524d…` | Corresponding trunk boxes move/disappear |
| Mesh allocation before locust assignment | 13,852 | 13,848 | Species/variant/200 m cell groups change |
| Mesh allocation after locust assignment | 16,797 | 16,791 | Position-based species and cell groups change |

The park/grid collider hash remained `2c975335…` at this stage; the later Chartowo lamp move changes it to
`c5b4e900…` (below). Full hashes are in the tests. Other test
edits supply the real `buildRoadNetwork` dependency; they do not change expectations. The real-world zero-count
and moved-spacing assertions reuse the city already built by the distribution fixture.
The small new audit regression independently distinguishes the four violation kinds on synthetic geometry, and
retains the historical counts as a pinned record. Baseline replay and the full fixture
remain tool operations. Existing distribution hashes pin determinism and unchanged park colliders; the new small
traffic-factory slice checks injected-network identity and exactly one fallback build.

## Chartowo lamp pin (2026-11-07)

Cutting the Bolesława Krzywoustego corridor from block 1304 (see `docs/world.md`) moved three park lamps inward off
the new cut curb: `2450.46, 2503.0`, `2532.4, 2617.6` and `2512.2, 2590.3`. The park count stays 2,332 and all park
poles now clear the cut curb by at least 0.54 m. The park/grid collider SHA-256 changes from `2c975335…` to
`c5b4e900…`; the tree-site, street-collider and species pins are unchanged.

## Validation

`node --test tests/`: **415 passed, 0 failed**, **62.68 s** wall time. This includes the real-world clearance and
spacing assertions on the existing distribution fixture, geodata rebuild, traffic-flow regressions, park paving,
and wall/rail clearances. The audit-category test takes **1.09 ms**; both new small test files together take
**87 ms** including process setup. No additional city is built for these tests. The earlier standalone city-build
version took 10.39 s here and has been removed. `git diff --check` passes.

Both full and smaller fixtures were also audited with `reuseNetwork: false`, independently rebuilding the finished
network: **5,481 nodes / 8,512 edges / 2,397 crossings**, with zero violations. The site hash is `dd5faf6f…` and the
street-collider hash `8cb2524d…`.
No browser rendering or frame-time measurement is implied.

## Build cost after network reuse

Three warmed, alternating-order pairs compare the original `7c425a8` street builder with the final builder in the
same furnished fixture. A prebuilt network is injected into the final builder's imported network factory, cancelling
the one network build now common to both boot paths. Rendering/tree-field construction is inert; these are headless
placement/furniture costs, not browser load or frame times. Both builders were warmed before sampling.

| Sample | Original (ms) | Final (ms) | Added (ms) |
|---|---:|---:|---:|
| 1 | 5,233 | 5,591 | 358 |
| 2 (reverse order) | 5,195 | 5,497 | 302 |
| 3 | 5,161 | 5,658 | 497 |

Builder medians are **5,195 → 5,591 ms (+396 ms, +7.6%)**; the median paired increment is **358 ms**. The requested
200 ms target was not reached on this host. The duplicate network build is eliminated, and no per-frame work was
added. A 16 m block-boundary index and per-curb `blockAt` memoisation were
tried and removed in review: the index cost about 63 ms to build and saved about 10 ms, the memo saved nothing, and
the lane/crossing keepout index went back to 64 m cells (16 m cost about 31 ms more). Both variants produce
byte-identical sites; review measured the remainder at about +0.25–0.35 s, mostly `blockAt`. The initial revision's +1.373 s / +37% measurement included the duplicate build
and is superseded. The original source can be obtained with `git show 7c425a8:js/street-details.js`.
