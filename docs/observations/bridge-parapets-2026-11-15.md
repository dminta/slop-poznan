# Bridge parapets and lamps on car lanes, 2026-11-15

User report: on ul. Bolesława Krzywoustego (Rataje) light concrete balustrade panels with 8.2 m lamp posts stood on
the carriageway. From above they ran diagonally across both one-way carriageways near x 1780–1900, z 1760–1830, and a
driver saw a segmented white wall with lamps in the middle of the road. They are the overpass balustrade of
`js/bridges.js` (`buildOverpass`). Baseline: `84a1443`.

## Method

`node tools/audit-bridge-parapets.mjs` (harness `tests/helpers/bridge-parapets.cjs`) builds every bridge with the
shared three.js stub. A recording `InstancedMesh` and a recording balustrade panel geometry capture each member's
matrix. Members standing on the street are classified by their box:

- **lamp**: a post over 5 m tall and under 0.3 m across;
- **parapet**: within 0.25–2.5 m of the street (railings, posts, kerbs, copings);
- **panel**: an overpass balustrade panel;
- **structure**: anything taller (arch hangers).

Every parapet collider is checked too. Each item is sampled along its long axis every 0.25 m against the lane
centrelines the network paints: every `paintEdges` lane with its lane shift, plus 8 chords of every junction turning
curve. An item overlaps where it comes within 1.8 m plus its own half thickness of a lane, i.e. into a 3.6 m lane
envelope. The lanes come from `buildRoadNetwork([], [])`. `--boot` uses the boot network instead (city-grid sidewalks
and street furniture) and gave identical rows before and after the fix. `--before 84a1443` runs the old
`js/bridges.js` against the same geodata and lanes.

## Root cause

1. **Curved links on one straight axis.** `bridgeStructures` merges a name's parallel links into one structure on
   the straight chord of its longest link, with the lateral extent taken from each link's endpoint midpoint. The two
   Krzywoustego carriageways are long arcs:
   - westbound (2228.8, 2152.6) → (1819.4, 1783.7): 551 m, bows **29.3 m** off its chord;
   - eastbound (1808.2, 1802.8) → (2163.9, 2105.7): 467 m, bows **21.4 m** off its chord.

   The corridor was 9.8 m + the median wide around the chord, so the balustrade lines (at W/2 + 2.15 m) ran
   diagonally over both roadways at the ends, where the arcs leave the chord.
2. **Crossings found only in `ROADS`.** `parapetPieces` cut the line only where a `GEO.roads` piece crossed it. The
   network lays its lanes on `GEO.roadGraph` links, and the two can differ. Under Wiadukt Dolna Wilda the Rondo Józefa
   Vogla link runs (−783.4, 2808) → (−772.5, 2762.8) across both balustrades, but its `ROADS` piece there is a single
   point. That left 16 m of balustrade, with lamps, over its two lanes. The test also needed the two centrelines to meet
   on the line itself, so a street ending just beside the line did not count.

## Fix (`js/bridges.js`)

- **Curved groups in sections.** A group with any link more than `CURVE_TOL` 0.5 m off its chord becomes one structure
  per straight section of its axis link (Douglas–Peucker at 0.5 m, `curvedSections`).
  - Every link is sampled every 2 m. Each sample goes to the nearest section, so a section's corridor holds both
    carriageways beside it (tram strips shifted as before).
  - Sections carry `joinStart`/`joinEnd` and the tangent of half their turn. The overpass balustrade runs through a
    joint out to the mitre and is trimmed 2 m only at the real ends. Joined sections under 15 m are still built.
  - Straight groups keep the old single-axis code path exactly.
  - 0.5 m is under a third of the 1.65 m between a 9.8 m one-way link's outer lane envelope (5.4 m off its
    centreline) and the balustrade (7.05 m).
  - Krzywoustego became 8 sections on the main pair (52–76 m each, 3° turns) plus its two straight structures. Only
    Krzywoustego, Dworcowa and one unnamed 12.8 m link qualify.
- **Crossings from both street sources.** The line is cut where it enters the roadway of any `ROADS` piece **or**
  `GEO.roadGraph` link at more than ~20° to it, plus 3 m along the line.
  - The roadway is a capsule of the half width (tram strip included) round each segment, which also catches a street
    ending beside the line.
  - Segments are bucketed in 64 m cells.
- **Tracks just past a line end.** A tram/rail track that crosses the line just past its end now cuts that end within
  its margin. Without this, Dworcowa's new 4.8 m second section kept a collider 1.88 m from a rail
  (`tests/track-parapets-crossings.test.cjs` requires 2.0 m).
- Colliders are still emitted per drawn piece (`addBridgeCollider`), so the collider ↔ visual pairing is unchanged.

## Results

| | before (`84a1443`) | after |
|---|---|---|
| structures | 38 | 47 |
| standing members (parapet / panel / lamp / structure) | 511 / 974 / 112 / 63 | 526 / 956 / 108 / 63 |
| colliders | 209 | 212 |
| members on a lane, city-wide | **210** (9 parapet, 186 panel, 15 lamp) | **4** (2 parapet, 2 panel, 0 lamp) |
| of them Krzywoustego | **184** (5 parapet, 166 panel, 13 lamp) | **0** |
| colliders on a lane | 32 | 2 |

Before the fix, the worst rows were:

| bridge | member | at | depth | length |
|---|---|---|---|---|
| Krzywoustego | parapet line | (1849.6, 1801.4) | 2.00 m | 287.6 m |
| Krzywoustego | junction end | (2210.2, 2165.8) | 1.99 m | 34.1 m |
| Wiadukt Dolna Wilda | parapet | (−773.9, 2776.1) | 1.99 m | 16.7 m |
| Wiadukt Dolna Wilda | parapet | (−785.3, 2805.2) | 1.99 m | 16.2 m |

Members per bridge that changed (parapet / panel / lamp):

| bridge | before | after | why |
|---|---|---|---|
| Bolesława Krzywoustego | 19 / 521 / 40 | 31 / 528 / 40 | now follows both arcs; no panel or lamp is on a lane |
| Wiadukt Dolna Wilda | 2 / 112 / 10 | 6 / 92 / 6 | new gaps where Rondo Vogla and Dolna Wilda pass under |
| Most Dworcowy | 18 / 85 / 5 | 18 / 82 / 5 | cuts slightly wider at street ends |
| Wiadukt Hetmański | 4 / 18 / 2 | 3 / 17 / 2 | a 2.4 m stub between two cuts dropped below the 2 m minimum |
| Dworcowa | 1 / 4 / 0 | 1 / 3 / 0 | sectioned, rail cut |

All other bridges are unchanged: Chrobrego, Lecha, Mieszka I, Rocha, Królowej Jadwigi, Jordana, Berdychowskie,
Kładka Bramy Poznania, Teatralny, Uniwersytecki, Wyszyńskiego, Hlonda, Panny Marii, Bukowska, Słowiańska, Santocka,
Słupska, Świętego Wincentego and Ganowicza.

### Residual (pinned in `tests/bridge-parapets.test.cjs`)

- **Dworcowa slip road off Most Uniwersytecki**, (−1423.5, 122.7): one parapet piece and two panels on a turning curve,
  1.94 m deep over 4.8 m. Before the fix it was 1 parapet and 3 panels.
  - The network merges the junctions joined by links under 14 m and moves the Dworcowa mouth 11 m west of the link's
    own node. A curve from Most Uniwersytecki into the slip road then swings 6 m off the parent link's axis, through
    the gore-side balustrade.
  - Bridges are built before the network (main.js: their colliders keep street trees off the parapets), so they cannot
    see that curve.
- **Most Dworcowy**, (−1363.1, 614.5): a turning curve grazes one railing by 0.07 m.

Two general alternatives cut too much and were dropped:

- a disc round every merged junction cluster: 0 overlaps, but panels fell 957 → 662. Wiadukt Dolna Wilda, Most
  Uniwersytecki, Most Dworcowy, Wiadukt Ganowicza, Most Teatralny, Wyszyńskiego, Santocka and Słupska lost all their
  members;
- widening every street capsule by the 2.15 m footway: 86 more panels removed, with a 0.54 m Dworcowa residual left.

## Cost and hashes

- **Headless bridge build** (stub three.js, 5 alternating runs each):
  - before: 203.6 ms median;
  - after, unindexed: 316 ms;
  - after, with the 64 m segment index: **120.7 ms** median (the old full `ROADS` scan for every line is gone too).
- **`node --expose-gc tools/bench-boot-headless.mjs --gc`**, 3 interleaved runs each:
  - before (main checkout at `84a1443`): 12,067 / 11,648 / 11,759 ms;
  - after: 11,516 / 11,620 / 11,543 ms;
  - heap 614.2 MB in all six.

  That bench does not build bridges, so these numbers are noise.
- **`--hashes`**: all 24 hashes are identical before and after. No hashed output takes bridge geometry or colliders.
  The bridge colliders reach street trees and name plates only in the browser build, through `allColliders`.
- **`node --test tests/`**: 626 pass (Node 26.13.1).

## Not checked

The appearance of the sectioned Krzywoustego balustrade and of the new gaps on Wiadukt Dolna Wilda needs a browser
look. In particular, the joints between sections and the width steps where a section's corridor changes. At a joint
the lines are mitred through: on the 33 m corridor the outer gap of about 1.0 m closes and the inner lines overlap by
as much.

## Rerun

```
node tools/audit-bridge-parapets.mjs                     # after: 4 rows, exit 1 while any remain
node tools/audit-bridge-parapets.mjs --before 84a1443    # before: 210 rows
node tools/audit-bridge-parapets.mjs --boot              # boot network, same rows
node tools/audit-bridge-parapets.mjs --name Krzywoustego --json
node --test tests/bridge-parapets.test.cjs
```
