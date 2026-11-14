# Mainline railway tree clearance, 2026-11-14

## Scope and measurement

`node tools/audit-rail-trees.mjs` builds the full headless furnished world through
`audit-tree-clearance.mjs`: landmark and generic-building colliders, live city-grid park/plaza sites and lamps,
bridges, street details, and the real tram layout. It collects the sites passed to `createTreeField` and independently
builds `layoutRailInfrastructure(details.roadNetwork)`. No browser was opened; appearance remains for the coordinator
to inspect.

`--before` loads the three tree placers (`city-grid.js`, `buildings.js`, `street-details.js`) from baseline `eed1a16`,
with the same current harness, configuration and railway builder. The committed geodata is unchanged.

The mainline ballast foot is **5 m wide**, its top 4 m, in `tram-infra.js`. `RAIL_BED_W` now lives in
`city-config.js` so placement and rendering share it. The audit reports both the complete mainline geodata corridors
(2,198 segments) and the actually emitted ballast rectangles (13,612 ordinary pieces plus 431 viaduct pieces; this layout has no flush level-crossing pieces). Rendered rectangles include the
builder's 1 cm extension at each end and the horizontal projection of pitched-bed thickness. Raised viaduct ballast
uses its 4 m top width and 2.5 cm end extension; flush crossing rails use their 1.575 m outer envelope and 1.5 cm
end extension. These additional rail pieces are audited as well. Road/tram/land cuts can remove bed pieces, whereas existing prop keep-outs
intentionally follow complete geodata centrelines, including those gaps. Tram tracks are excluded from this audit.

A footprint is a conservative circle around the canopy, using `SPECIES_CROWN_R`, the seeded `treeSpecies`
reassignment and both horizontal instance scale factors from `createTreeField`. The larger of the two scaled crown
axes determines the circle; squeezing one axis does not justify shrinking both. This tests a canopy envelope, not
each individual leaf or animation frame. The corridor trunk-envelope check uses the circumscribed radius of the real
`0.56 * scale` square collider. A separate separating-axis test checks that actual square against rendered beds/rails. The rendered-bed intersection is an independent circle/rectangle distance check;
it runs for every collected tree, including trees outside the geodata-overlap list.

Niska is explicitly defined as `x = -1451…-1191`, `z = -963…-573`: the bounding box of the two reported runs plus
50 m on every side. Counts describe this neighbourhood, not street-name attribution.

## Tree placers and their checks

| Placer | Previous railway rule | New rule |
|---|---|---|
| `city-grid.js` plaza and Teatr Polski planter trees | 2 m centreline keep + 1.7 m planter radius; final 0.4 × scale trunk check | Check the crown before emitting the planter; retain the planter and old tram checks |
| `city-grid.js` full park blocks | Final `clearOfRails` with 0.4 × scale trunk allowance, before trunk colliders | Same shared predicate with the crown envelope |
| `city-grid.js` partial-park lawns | Same final trunk-only filter | Same shared crown predicate |
| `buildings.js` `populateLeftoverSlabs` | No railway check at its source | Shared tree predicate before appending a site |
| `street-details.js` mapped OSM and surveyed Teatr Polski garden trees | 2 m + 0.4 × scale; no mainline canopy check | Check the actual mapped site's crown after assigning its curb squeeze, before emitting its record or collider |
| `street-details.js` procedural narrow/wide curb rows and shifted candidates | 2 m + 0.4 × scale | Check the same species and squeezed instance envelope at every candidate and final placement |
| `street-details.js` park-site ingestion | Wall/OSM replacement checks, trusting upstream rail filtering | Also check rails defensively, removing rejected upstream trunk colliders |

A repository-wide search for `createTreeField`, tree-site arrays and their appenders found no other individual-tree
placer. `outskirts.js` depicts distant forest/garden/street-tree colour procedurally in its land-use shader; it does
not emit individual trunks/crowns. Building yards likewise use ground surfaces, not another tree field. Landmark
models emit no separate trees: the nine surveyed garden crowns enter the mapped site path. The full-world baseline
emits no leftover-slab tree sites; that source is still guarded for future input changes.

## Before and after

| Measure | Baseline `eed1a16` | Fixed |
|---|---:|---:|
| All emitted trees | 119,207 | 118,268 |
| Trees in the Niska neighbourhood | 112 | 92 |
| Canopy envelopes reaching full mainline corridors | 939 | 0 |
| Conservative trunk envelopes reaching full mainline corridors (subset of canopy cases) | 1 | 0 |
| Actual square trunk colliders intersecting rendered beds/rails | 0 | 0 |
| Envelopes reaching actually rendered ballast | 938 | 0 |
| Niska corridor / rendered-bed overlaps | 20 / 20 | 0 / 0 |

| Source | Baseline emitted | Corridor overlaps / rendered overlaps | Removed | Fixed emitted |
|---|---:|---:|---:|---:|
| OSM mapped | 32,853 | 4 / 4 | 4 | 32,849 |
| Surveyed garden sites | 9 | 0 / 0 | 0 | 9 |
| Plaza planters | 142 | 0 / 0 | 0 | 142 |
| Park sites | 59,051 | 30 / 30 | 30 | 59,021 |
| Narrow street rows | 22,491 | 668 / 668 | 668 | 21,823 |
| Wide street rows | 4,661 | 237 / 236 | 237 | 4,424 |

Of the 30 removed park trees, 25 came from full park beds (`y = 0.41`) and 5 from partial-park lawns (`y = 0.22`).
All Niska overlaps were narrow procedural street trees. One wide street tree at `(-1973.127, 2247.928)` overlaps the complete corridor but no emitted bed. It still fails
the shared complete-corridor policy. Adding the raised viaduct beds to the initial ground-bed-only audit raises
the rendered baseline from 932 to 938; all six additional cases were already among the 939 corridor overlaps.

Exact `(x, z)` site-record comparison: **939 removed, 0 added, 0 moved, 118,268 unchanged**, including every stored
species, scale, squeeze, pit and source field. The removed-coordinate set equals the baseline corridor-overlap set;
no additional non-overlapping site was removed. Niska loses exactly the 20 reported canopy-envelope cases.

Worst examples (distance is trunk centre to nearest mainline centreline, in metres):

| Source / case | x | z | Distance | Crown radius | Envelope penetration past bed edge |
|---|---:|---:|---:|---:|---:|
| Full park, deepest city-wide | 1447.186 | 2688.426 | 3.772 | 6.852 | 5.580 |
| Full park | 1437.389 | 2691.062 | 3.521 | 5.931 | 4.909 |
| Wide street, worst wide row | 2302.570 | -2258.937 | 3.725 | 5.452 | 4.228 |
| Narrow street, worst narrow row | 1778.801 | -677.057 | 3.074 | 3.523 | 2.949 |
| OSM, worst mapped point | -2795.200 | -1332.900 | 5.037 | 3.942 | 1.404 |
| Niska, worst local case | -1303.231 | -743.223 | 3.447 | 3.361 | 2.414 |
| Niska, next local case | -1266.484 | -650.527 | 3.210 | 2.861 | 2.151 |
| Wide street, sole circular trunk-envelope case | 3155.864 | -1288.750 | 2.784 | 3.873 | 3.589 |

All examples in this table reach actual emitted beds with their canopy envelopes. The sole circular trunk-envelope
case has 0.284 m from its centre to the bed edge, but its square collider projects only 0.237 m along the track
normal: the square clears the bed. The circular-envelope flag is conservative, not a physical trunk collision. Worst-case penetration is a
conservative circular-envelope measurement, not a measured leaf intersection.

## Fix and determinism

`clearOfRails(x, z, radius, tree)` retains its existing three-argument prop/tram contract. With a tree record it also
requires the mainline centreline distance to exceed `RAIL_BED_W / 2 + crownRadius + 0.01 m` (or the trunk allowance
if larger). The extra centimetre covers the rendered bed's end extension. It reuses the existing 32 m rail-segment
index and changes no roads, tracks, signals, lamps, RNG draws or species assignment. All placers use position hashes;
no sequential RNG stream is advanced by rejection. No trees are moved.

The complete-centreline rule is intentionally conservative at road cuts and track ends, matching the existing
rail keep-out policy; it also prevents planting in a rail gap that still carries flush crossing rails or a viaduct.
It changes only candidates within the mainline bed-and-crown envelope. The audit reports rendered-piece counts
separately so those conservative cases are not claimed as visible ballast overlaps.

## Reproduction and verification

```sh
node tools/audit-rail-trees.mjs --before
node tools/audit-rail-trees.mjs
node --test tests/rail-trees.test.cjs
node --test tests/
```

The audit emits every offending tree's coordinates, source, centreline distance, canopy radius, penetration,
trunk/canopy flags, rail index and Niska membership. `--sites output.json` additionally writes the collected site
records without collider objects, for exact record comparison. A nonzero overlap count exits with status 1.
`tests/rail-trees.test.cjs` pins zero overlaps after the fix and verifies the baseline catches Niska, mapped trees,
park trees and the conservative trunk-envelope case. Existing distribution/collider pins are re-derived from their own reduced fixture;
its omissions and build order differ from this audit, so its totals are not substituted for full-world counts.

## Existing test pins

The reduced distribution/collider fixture emits **119,355 → 118,413** trees: 942 removals, comprising 909 street
trees (including four mapped trees) and 33 grid park trees. Surveyed OSM park trees stay **25,623**; OSM total drops
**32,875 → 32,871** and the street-tree collider pin drops **34,469 → 33,560**. Its larger removal count reflects its
missing landmark/bridge walls and park building cutouts, not RNG drift.

`tree-distribution.test.cjs` re-derived pins:

- Input species totals: `[45762, 49589, 22023, 1981]` → `[45659, 48825, 21948, 1981]`.
- Rendered assigned species: `[43887, 47528, 21109, 6831]` → `[43792, 46791, 21035, 6795]`.
- Site hash: `474fb97b…` → `db1bd4ef…`, from the removed site records.
- Grid prop-collider hash: `6e27b564…` → `17d37d07…`, from the rejected park trunk colliders.
- Street-detail collider hash: `911857fc…` → `cae2ec17…`, from the rejected procedural/mapped street trunks.
- Occupied species/variant/cell mesh slots: **25,479 → 25,323** before reassignment and
  **30,369 → 30,155** after reassignment; removing the last tree in a slot empties that slot.

The nine garden sites, plaza planters, surveyed park-tree collider count and surviving tree transforms retain
their existing assertions. No geodata, preload, map, persistence, CSS or renderer setting changed.

Full verification: `node --test tests/` **622 passed, 0 failed** (193.5 s in the final expanded-audit run). The expanded rail audit also checks
viaduct ballast, flush crossing rails, pitched bed projections and actual square trunk colliders; its focused
regression also passes independently (1/1). `git diff --check` and JavaScript syntax checks pass.
