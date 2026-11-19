# Data-edge tram buffer stops and pole–outskirts clearance (2026-11-19)

Branch `poznan` at `b4d0aae` (working tree). Follow-up to
[the Starołęka rails record](staroleka-rails-2026-11-17.md): the rails, wire and poles continue to the OSM snapshot
edge, but the ends had no buffer stop, and the outskirts poles had never been checked against the generated outskirts
buildings.

## 1. Buffer stops at the data-edge dead ends

### Finding them at build time

`layoutTramInfrastructure` already loads every `kind: 'tram'` chain of `GEO.rail`. The geodata build cuts a chain at
every switch and crossing, so two chain endpoints at the same coordinates are one junction, not two ends. The rule is
therefore:

- take both endpoints of every tram chain;
- keep only endpoints **outside** the detail box `[-9119.5, 4490.7] × [-2830.8, 2844.2]`, toward the OSM data edge;
- drop an endpoint when another tram chain's endpoint lies within `BUFFER_JOIN` **1.5 m** (a switch the geodata cut).

On the 2026-11-17 snapshot there are **24 outside-box tram endpoints**. Two are a switch: rail 848 ends at
(4468.2, 2884.4) and rail 1013 starts at exactly that point, so neither is a dead end. The other **22 are dead ends**
and each gets one buffer stop, 0.5 m past the last rail piece (`BUFFER_SETBACK`). The tram graph stops a tram with its
nose about 1 m short of the end, so the prop is never touched.

| edge | count | chains (rail index, x, z, outward direction) |
|---|---|---|
| south | 11 | 553 (−3568.1, 3037.2, SW); 617 (−3605.1, 3022.9, NW); 664 (2191.8, 3091.9, SW); 844 (4458.4, 2886.7, SE); 1067 (−1887.7, 3600.9, SE); 1068 (−1889.3, 3597.7, SE); 1069 (1504.1, 3539.3, SW); 1097 (215.6, 2991.6, E); 1098 (214.6, 2995.4, E); 1200 (624.6, 3125.0, S); 1201 (628.3, 3126.8, S) |
| north | 8 | 716 (−112.0, −2930.7, NW); 718 (−118.3, −2962.6, N); 987 (−944.5, −3050.2, N); 988 (−949.3, −3050.6, N); 989 (875.1, −3043.3, N); 1070 (891.0, −3124.9, N); 1071 (−1550.7, −3650.3, NE); 1072 (−1581.6, −3676.9, N) |
| east | 3 | 541 (4676.5, −179.2, E); 973 (4641.7, −131.8, E); 1013 (4561.6, 2826.2, NE, no route) |

The Starołęka pair (1200/1201) is included, as are the other routed lines. The four **interior** depot stubs
(around −2690, 2266 and −5826, 2250) keep their old look: they are mapped track ends inside the detail box, not
data-edge ends. The route-less 1013 fragment's far end is included because it is the same kind of data-edge dead end.

By `districtAt` (the osiedle of the end, outside the box too): Starołęka-Minikowo-Marlewo 3 (1098, 1200, 1201),
Antoninek-Zieliniec-Kobylepole 3 (541, 973, 1013), Chartowo 1 (844), Żegrze 1 (664), Górczyn 2 (553, 617), Wilda 2
(1067, 1068), Rataje 2 (1069, 1097), Nowe Winogrady Południe 3 (716, 718, 987), Nowe Winogrady Wschód 2 (989, 1070),
Winiary 3 (988, 1071, 1072).

### Prop

Two instanced meshes under the existing `TramInfrastructure` culling root, built once with the rest of the layout:

- `TramBufferStops`: a 2.4 × 0.4 × 0.16 m beam at y 0.74, red/white bands every 0.4 m in a `colorNode`. The stripe
  pulse is box-filtered with `fwidth` and fades to its mean once a band is under a pixel, like the ballast sleepers.
- `TramBufferStopFrames`: two 0.14 × 0.9 m posts 1.8 m apart on 0.34 × 0.08 × 0.44 m feet, on the existing
  `steelMat` (no new pipeline).

60 triangles per stop (five boxes), 1,320 triangles for all 22. The beam and frame are two draws of 22 instances; the
22 instances are below the 64-instance chunk threshold, so scene culling leaves them whole. No colliders: every prop is
outside the detail box, where ground modes never go. No runtime work and no new module (`js/tram-infra.js` only), so no
modulepreload count changes.

## 2. Pole-vs-outskirts-building audit

`node tools/audit-pole-outskirts.mjs [--margin 0.3] [--band 300] [--near 60] [--top 12] [--json] [--fail-on-clash]`
builds the full furnished headless world through `tools/audit-tree-clearance.mjs`'s `runAudit({ worldOnly: true })`,
the real tram and railway layouts, and the **production** outskirts building list. The latter is the private `generateOutskirtsBuildings` plus
`buildSatelliteSiteBuildings`, exported through a source suffix; the live `city-grid.railRectClear` is passed in so
on-track buildings are filtered exactly as in the app (a first probe that kept them found 22 spurious tram-pole hits).

Checked at a **0.3 m** clearance from the pole surface (the balcony audit's threshold), requiring vertical overlap with
the building box. "Clash" means the pole surface penetrates the footprint; a positive number is the clear gap.

| class | checked | outside the box | nearest distance to a building | clashes < 0.3 m |
|---|---|---|---|---|
| tram catenary pole | 4,948 | 486 | **1.058 m** at (82.8, 2965.0), a 15.4 × 9.5 m house | 0 |
| railway mast | 1,648 | 0 | none within 60 m | 0 |
| signal pole (street details) | 1,935 | 0 | 47.6 m at (3688.7, 2708.5), IKEA Franowo part | 0 |
| street lamp / gas / column mast within 300 m of the box | 24,501 | 0 | **−53.956 m** (inside), M1 Poznań part | 17 |
| **all** | **33,032** | 486 | | **17** |

Buildings: 46,753 boxes (46,682 generated borough buildings + 71 hand-placed satellite parts). Distance buckets for the
nearest building: 17 inside, 0 at 0–0.3 m, 0 at 0.3–1 m, 3 at 1–3 m, 22 at 3–10 m, 509 at 10–60 m, 32,481 with none
within 60 m.

### The 17 clashing masts

All are street LED masts on the detail box's south edge at z 2842.42 (`x` 3564–4314), inside the hand-placed satellite
rectangles that represent the Franowo retail parks:

| satellite part | masts | deepest penetration |
|---|---|---|
| M1 Poznań (329 × 120 m, plus its 149 × 80 m glass part) | 9 | 53.956 m |
| IKEA Franowo (208.5 × 102.6 m) | 6 | 50.866 m |
| Selgros (121 × 150 m) | 2 | 7.645 m |

The rectangles are OSM footprints approximated to about a fifth of their area, and they reach into the detail box where
the last lamp row inside the box stands. This is not the "pole 2.6–16 m from a track vs a building 1.5 m off it" case
the Starołęka record anticipated: the production `railRectClear` filter already drops those buildings, and all tram and
signal poles are clear on this data. It is a satellite-footprint/box-edge interaction, so the fix is a decision: refine the
three Franowo/Selgros satellite outlines (split/trim the rectangles), or move/drop the box-edge lamp row. **Left open;
no world code changed from the audit.**

## Tests and limits

- `node --test tests/tram-infra.test.cjs`: pass. The test pins **22** buffer stops, checks each stands 0.5 m beyond a
  chain end outside the box, that no stop sits on a switch, that Starołęka and the route-less 1013 end are included,
  that interior depot stubs are not, and that both instanced meshes carry one instance per stop.
- `node tools/audit-pole-outskirts.mjs` runs in about 12 s headless and is deterministic (fixed geodata, seeded
  outskirts generators).
- The audit is a static box-vs-pole check. It does not render the scene, does not check the lamp arm or signal head
  overhang separately, and uses each street footprint's half-diagonal as the pole radius (conservative for the lamp
  cabinets' 0.45 m box). The satellite rectangles are the hand-placed approximations, so their penetrations are
  geometry-model differences, not necessarily visible gaps in the real city.

## Browser checks still open

- No rendered check was made of the buffer stops: view the Starołęka pair at z ≈ 3125 and one north (e.g. 1071 at
  −1550.7, −3650.3) and east (541 at 4676.5, −179.2) end on WebGPU high and WebGL2 low, by day and at night, from a
  low chase and a drone. Watch the console.
- Frame the Franowo box-edge lamp row and the M1/IKEA/Selgros rectangles from the south-east drone/edge view on both
  backends to judge whether the 17 buried masts are visible and how much the rectangles intrude into the box.
