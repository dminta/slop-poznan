# Tram canopy clearance, 2026-11-17

The headless audit builds the furnished city, including landmark, building, canopy and bridge colliders, then runs the
real street-furniture, tram and railway layouts. `node tools/audit-canopy-clearance.mjs --json` lists every recorded
hit with canopy kind, prop kind and coordinates. A hit is a pole/trunk footprint circle overlapping the oriented deck
with its top above the underside, or a tram arm/span segment crossing it at 6.6 m. Trees are treated as tall; the
audit tests trunks, not crowns. Lamp scale and pole heights come from placement, and park-lamp height from its model.
Signal masts are below the mapped tram decks. Opposing tracks may emit separate arm entries at the same pole.

| Canopy / prop | Before | After |
| --- | ---: | ---: |
| tram / LED lamp | 7 | 0 |
| tram / tree, signal or park lamp | 0 | 0 |
| tram / traction pole | 8 | 0 |
| tram / traction arm | 14 | 0 |
| western overlapping roof / LED lamp | 3 | 0 |
| western overlapping roof / traction pole | 8 | 0 |
| western overlapping roof / traction arm | 11 | 0 |
| platform / rail mast | 37 | 37 |
| platform / LED lamp | 13 | 13 |
| platform / tram pole, arm | 8, 8 | 8, 8 |
| other roofs / LED lamp | 9 | 9 |
| other roofs / tram pole, arm, span | 1, 0, 1 | 1, 0, 1 |
| other roofs / rail mast | 1 | 1 |

A `roof` deck overlapping a mapped `tram` deck participates in the same keep-out; this identifies the western loop
roof without relying on its index. Tall LED poles are relocated or dropped by the existing shelter-placement repair,
with the arm checked as well as the pole. A shared keep-out also protects these decks from new tree trunks. The
full-world fixture had no tree conflicts before; a reduced fixture without landmark and bridge walls loses three trees.

Contact wire remains at 5.8 m. At covered support stations, a short dropper connects it to the 6.1 m deck underside
instead of emitting the traction pole and elevated arm. The 23 deck hangers reuse the existing instanced wire mesh,
without a new draw call. The furnished fixture retains the same 190 runtime heads and support records as the
lamp-only baseline, and the audit found no missing traction anchors; the signal placement regression also validates
reused anchors. No pole or arm entries remain within the selected decks. Platform railway
masts, tram supports and other roof conflicts listed above were outside this change and need a separate survey.

The night frame shows the platform remains very dark under the roof. Existing advertising and adjacent lamps do not
provide convincing canopy lighting; dedicated fixtures need separate design and review.

Headless Chrome, WebGPU high, 1280 × 720, DPR 1, seed 4242, same poses in each pair, midday unless noted; HTTP 8330,
CDP 9530. No page console warnings or errors were recorded. Chrome reported headless macOS display-link errors.
Moving actors differ. The first image in each pair is after the initial lamp-only pass, before deck hangers:

- Piaśnicka Rynek aerial: `/tmp/cx-canopy-poles/shots/review2-before-pias.png` and
  `/tmp/cx-canopy-poles/shots/review2-after-pias.png`; eye `(3245,35,2298)`, target `(3274,6,2324)`, FOV 55°.
- Osiedle Lecha aerial: `/tmp/cx-canopy-poles/shots/review2-before-osiedle.png` and
  `/tmp/cx-canopy-poles/shots/review2-after-osiedle.png`.
- Western loop aerial: `/tmp/cx-canopy-poles/shots/review2-before-west.png` and
  `/tmp/cx-canopy-poles/shots/review2-after-west.png`.
- Piaśnicka Rynek street: `/tmp/cx-canopy-poles/shots/review2-before-street.png` and
  `/tmp/cx-canopy-poles/shots/review2-after-street.png`.
- Midnight: `/tmp/cx-canopy-poles/shots/review2-before-night.png` and
  `/tmp/cx-canopy-poles/shots/review2-after-night.png`.

The audit does not check tree crowns, railway cantilevers, contact wires, lamp-arm geometry or signal heads outside the
mast footprint. The lamp placement check does cover the LED arm. No WebGL, real-device or additional time-of-day checks
were made. Screenshot review remains required before merge.

The initial lamp-only pass measured a noisy +239.1 ms median paired `buildStreetDetails` change over five interleaved
headless furnished-fixture pairs, with other tests running during part of the sample. Its raw runner and samples are at
`/tmp/cx-canopy-poles/audit.mjs` and `/tmp/cx-canopy-poles/timings.txt`.

After adding the aggregate bounds prefilter and overlapping western roof, five alternating headless furnished-fixture
pairs measured `buildStreetDetails` at 4277.1, 4115.9, 4021.0, 4103.6 and 4393.8 ms for the lamp-only version,
and 4101.8, 4217.1, 4116.1, 4257.9 and 4199.3 ms for the revised version. The median paired difference was +95.1 ms,
with pairs ranging from −194.5 to +154.3 ms. This comparison includes the extra roof and changed traction layout as
well as the prefilter, and is not a controlled browser boot benchmark. Runner, reconstructed baseline sources and raw
samples are in `/tmp/cx-canopy-poles/review2-timing.mjs`, `review1-js/` and `review2-timings.txt` under that directory.

## Remaining decks follow-up

The previous audit hits are listed below, with deck index, kind, centre and every prop position (x, z in metres,
rounded to 0.1). Arm and span positions are their starting endpoints; the JSON audit retains both endpoints. The
mapped platform #10 is the tram platform by Dworzec Zachodni / Zachodnia, beside Poznań Główny. Platforms #1, #6,
#12, #15, #18, #19 and #80 are in the main station complex; #29 and #49 are Garbary. Roof #81 is beside Most
Dworcowy in the station complex. Roof #33 is alongside Aleja Krzysztofa Komedy; #38, #52, #67 and #106 are at
Ławica. Roof #16 is in the Starołęka area. GEO does not identify the exact function of these ordinary roofs.

- #1 platform, centre (-1580.5, 800.3): 13 rail-mast: (-1550.4, 632.9); (-1556.8, 663.4); (-1567.8, 718.4);
  (-1578.8, 773.4); (-1589.8, 828.4); (-1600.7, 883.4); (-1612.0, 938.3); (-1545.7, 648.6); (-1556.4, 702.1);
  (-1567.1, 755.6); (-1577.7, 809.1); (-1588.7, 862.5); (-1599.7, 916.0).
- #6 platform, centre (-1603.7, 826.7): 5 rail-mast: (-1583.9, 714.1); (-1583.9, 747.6); (-1594.6, 801.2);
  (-1605.4, 854.9); (-1616.0, 908.5).
- #10 platform, centre (-1627.9, 851.9): 10 led-lamp: (-1639.4, 885.3); (-1632.6, 852.3); (-1625.8, 819.3);
  (-1615.7, 814.5); (-1622.3, 847.1); (-1628.9, 879.7); (-1628.6, 898.2); (-1622.6, 868.4); (-1616.6, 838.5);
  (-1610.6, 808.7).
- #10 platform, centre (-1627.9, 851.9): 8 tram-pole: (-1623.7, 807.7); (-1629.6, 837.0); (-1635.5, 866.3);
  (-1641.3, 895.6); (-1634.3, 908.0); (-1628.4, 878.5); (-1622.6, 849.0); (-1616.7, 819.5).
- #10 platform, centre (-1627.9, 851.9): 8 tram-arm: (-1623.7, 807.7); (-1629.6, 837.0); (-1635.5, 866.3);
  (-1641.3, 895.6); (-1634.3, 908.0); (-1628.4, 878.5); (-1622.6, 849.0); (-1616.7, 819.5).
- #12 platform, centre (-1612.1, 1060.4): 11 rail-mast: (-1594.5, 987.1); (-1605.0, 1038.6); (-1615.4, 1090.1);
  (-1625.9, 1141.6); (-1633.0, 1149.6); (-1621.8, 1095.1); (-1610.7, 1040.6); (-1599.1, 984.6); (-1624.3, 1107.2);
  (-1595.6, 992.0); (-1606.8, 1047.0).
- #15 platform, centre (-1555.4, 774.6): 2 led-lamp: (-1544.9, 726.7); (-1552.9, 771.7).
- #16 roof, centre (782, 2836.5): 2 led-lamp: (762.0, 2842.7); (794.0, 2842.7).
- #18 platform, centre (-1479.1, 392): 2 rail-mast: (-1481.7, 381.4); (-1482.3, 384.7).
- #19 platform, centre (-1391.2, 526.7): 2 rail-mast: (-1392.8, 566.1); (-1383.7, 499.5).
- #29 platform, centre (228.3, -860): 2 rail-mast: (192.0, -872.7); (244.8, -858.7).
- #33 roof, centre (1282.4, 1392): 3 led-lamp: (1247.4, 1405.1); (1276.7, 1396.5); (1306.0, 1387.8).
- #38 roof, centre (-7122.5, -695.8): 1 led-lamp: (-7130.9, -692.7).
- #49 platform, centre (231.8, -873.2): 2 rail-mast: (256.4, -865.3); (203.0, -879.4).
- #52 roof, centre (-7369.1, -686): 1 led-lamp: (-7366.7, -688.9).
- #67 roof, centre (-7304.4, -682.1): 1 led-lamp: (-7306.1, -685.7).
- #80 platform, centre (-1514.7, 715.4): 1 led-lamp: (-1513.7, 714.1).
- #81 roof, centre (-1408.1, 620.6): 1 rail-mast: (-1402.7, 615.8).
- #106 roof, centre (-7221.6, -693.6): 1 led-lamp: (-7228.1, -696.9).
- #184 roof, centre (-389, 221.7): 1 tram-pole: (-386.5, 226.6).
- #184 roof, centre (-389, 221.7): 1 tram-span: (-386.5, 226.6).

All 22 LED poles were 7.1 m tall, above the 5.0 m platform or 4.6 m roof clearance (6.1 m at #10). The indexed
keep-out now tests every deck against the actual lamp height and arm. A support station is attached to a deck only
when the track station lies within it and its underside is above the 5.8 m wire; overlapping decks use the highest
qualifying underside. The mast search stops at decks, so arms and spans cannot cross a nearby low roof. The earlier
tree keep-out is retained: extending it to unrelated station and ordinary roofs incorrectly removed existing
planter trees.

At #184, near Aleje Karola Marcinkowskiego, the nearest tram centreline is 10.28 m from the roof centre, outside
its 10 by 8.9 m rectangle; the offending pole and span crossed its edge, rather than the track running underneath.
A cantilever from the existing pole carries the crossing without lowering the 5.8 m contact wire. The audit now
reports 37 platform railway masts
and one station roof railway mast only; their placement is unchanged pending a railway-specific survey. All 22 LED,
nine tram-pole, eight arm and one span hits are gone. There are 31 deck hangers and no missing runtime signal
supports.

A comparison against 1d80ccb projects every recorded support crossing onto its track, sorts the positions by arc
length, and compares the largest gap between successive supports on each track. No track has a larger gap; the
city-wide maximum remains 90.81 m. End-of-track distances are excluded. Raw support captures and the comparison
script are in /tmp/cx-platform-poles/.

Headless Chrome WebGPU high, midday, 1280 × 720, DPR 1, HTTP 8340 and CDP 9540: same-pose before/after frames are
/tmp/cx-platform-poles/shots/before-platform.png and /tmp/cx-platform-poles/shots/after-platform.png (#10 aerial),
before-under.png and after-under.png (#10 underneath), before-roof-close.png and review-after-roof-close.png
(#184, final single-pole layout),
and before-other.png and after-other.png (#33). These filenames share the same shots directory. Chrome emitted macOS
headless display-link errors; page console reported no warnings or errors (log in /tmp/cx-platform-poles/console.jsonl).
Moving actors differ.
Screenshots require user review.

The final `node --test tests/` run passed 682/682 tests.

Three alternating headless boot pairs against `poznan` (same 1d80ccb baseline) measured total milliseconds
10799.0 → 10693.2, 10643.1 → 10637.1 and 10669.7 → 10738.8; median paired change −5.9 ms. The corresponding
`streetDetails` times were 3894.1 → 3874.6, 3828.3 → 3953.6 and 3964.6 → 3994.8 ms; median paired change +30.2 ms.
The first pair overlapped the final Chrome check, and three samples are too few to establish a small performance change.
Raw JSON files are `/tmp/cx-platform-poles/final-boot-{before,after}-{1,2,3}.json`.

## Review follow-up: lamp loss and night appearance

Of the 22 original deck-piercing LED lamps, **18 were dropped**, not moved: all 10 at Dworzec Zachodni #10,
three at Główny #15/#80, three at Komedy #33, and two at Ławica (#52 and #67). Around #10 the lamp count fell
from 15 to 5 within 60 m and from 6 to 1 within 30 m; around Główny #15/#80 none remain within 60 m. No replacement
lighting was added under these decks.

Four of the 22 were moved: #16 at (762.0, 2842.7) → (755.5, 2842.8) and (794.0, 2842.7) → (811.5, 2842.6),
#38 at (−7130.9, −692.7) → (−7131.5, −683.2), and #106 at (−7228.1, −696.9) → (−7238.5, −697.6).
A fifth LED
moved 1.0 m from (−1428.4, 135.8) to (−1428.6, 136.8): its pole footprint did not hit roof #202, so the original
pole-footprint audit did not list it, but the placement check found its projecting arm within the roof clearance.

The #184 relocation initially made two poles only 3.5 m apart. A short cantilever from the existing pole at
(−378.8, 229.1) now follows the same crossing to the former second pole position; the second pole is removed.
The full-world support-crossing comparison against the two-pole layout finds no increase in any track's maximum gap;
the city-wide maximum remains 90.81 m. The canopy audit still leaves only the 38 railway-mast hits.

Headless Chrome, WebGPU high, 1280 × 720, DPR 1, midnight, same poses as the daytime #10 frames, HTTP 8340 and
CDP 9540, with no page-console warnings or errors. The aerial pair is
`/tmp/cx-platform-poles/shots/before-night-platform.png` and `/tmp/cx-platform-poles/shots/after-night-platform.png`;
the under-deck pair is `/tmp/cx-platform-poles/shots/before-night-under.png` and
`/tmp/cx-platform-poles/shots/after-night-under.png`. The after frame is markedly darker under the canopy; advertising
panels and nearby street lighting leave much of the platform and tracks dark. The before under-deck view also contains
a moving tram, so its illumination is not an isolated measurement of the removed lamps. Replacement canopy lighting
needs separate design and review.

After the pole simplification, `node --test tests/` passed 682/682. The clearance regression also checks that one
nearby pole remains and carries a cantilever at #184; the full audit's hanger lookup uses the layout's `SPAN_Y`.

## Railway mast survey, 2026-11-18; headless classification

The baseline audit records 37 platform and one station-roof mast hits. These are footprint-circle hits against the rendered oriented rectangle; source-ring membership below tests the mast centre, so an outside centre can still have an intersecting footprint. The track IDs are indexes into GEO.rail, not OSM way IDs. Distances use every mainline GEO.rail segment, including layout cuts. Support IDs are captured at the actual railway layout's mark sites, including all crossings of an arm or portal and the initiating track; a shared mast receives the union of its attached structures.

Lengths below are exact line/polygon intersection lengths for the stored, rounded GEO.rail centrelines, summed per track. Rectangle coordinates use the stored rounded centre, dimensions and angle; original rings use the unrounded projected OSM snapshot. Each source roof was matched uniquely by rounded area and rectangle bounds. The <1 ratio for #12 is a rounding artifact. The OSM ring is a roof footprint, not a platform surface. The input snapshots do not contain platform polygons or edges for these sites, so no mast-to-platform-edge gap can be derived. On-platform classifications are provisional, not a claim that the exact platform boundary has been surveyed.

| Deck | OSM roof way | Rectangle / source area (m²); ratio | Rail track: length in rectangle / source ring (m) | Mast centres in source ring |
| ---: | ---: | --- | --- | --- |
| 1 | 423454695 | 3604.6 / 3322; 1.085 | none / none | 11 / 13 |
| 6 | 260857411 | 2389.2 / 2347; 1.018 | none / none | 5 / 5 |
| 12 | 686717766 | 1330.6 / 1339; 0.994 | none / none | 11 / 11 |
| 18 | 263320509 | 878.8 / 882; 0.996 | 194: 90.6 / 90.6 | 2 / 2 |
| 19 | 1097786439 | 995.5 / 857; 1.162 | 376: 12.3 / 0.0 | 2 / 2 |
| 29 | 431366877 | 610.6 / 610; 1.001 | none / none | 2 / 2 |
| 49 | 917142540 | 373.1 / 369; 1.011 | none / none | 2 / 2 |
| 81 | 1097786440 | 250.4 / 249; 1.006 | none / none | 1 / 1 |

**Wire heights.** The platform slabs span 5.0–5.4 m and #81 spans 4.6–5.0 m. The nominal contact and messenger wires are at 5.6 and 7.0 m above rail elevation. A slab intersection requires the actual wire height to be between the underside and roof top, not merely above the underside. The rendered wires use straight chords over up to three railway pieces, which can differ from the centreline. The scratch audit clips those actual chords in plan against each deck. On #18, track 194 has 90.6 m of wire-chord overlap and rail elevation along the clipped chords spans 1.61–2.73 m: contact height is 7.21–8.33 m and messenger 8.61–9.73 m. On #19, track 376 has 15.7 m of wire-chord overlap and clipped-chord rail elevation spans 2.89–3.80 m: contact is 8.49–9.40 m and messenger 9.89–10.80 m. Both are above the 5.4 m roof. The other six rectangles have no rendered mainline wire-chord overlap. This check does not test cantilevers, wire radius at slab boundaries, or the shape of the real-world catenary.

| Station / deck | Mast x, z (m) | Top / underside (m) | Nearest rail ID, distance (m) | Supported rail IDs | Mast centre in OSM roof ring | Platform edge gap |
| --- | --- | --- | --- | --- | --- | --- |
| Poznań Główny / 1 | -1550.4, 632.9 | 8.2 / 5.0 | 415, 2.63 | 267, 415 | no | unavailable |
| Poznań Główny / 1 | -1556.8, 663.4 | 8.2 / 5.0 | 415, 2.60 | 415 | no | unavailable |
| Poznań Główny / 1 | -1567.8, 718.4 | 8.2 / 5.0 | 415, 2.60 | 415 | yes | unavailable |
| Poznań Główny / 1 | -1578.8, 773.4 | 8.2 / 5.0 | 415, 2.60 | 415 | yes | unavailable |
| Poznań Główny / 1 | -1589.8, 828.4 | 8.2 / 5.0 | 415, 2.60 | 415 | yes | unavailable |
| Poznań Główny / 1 | -1600.7, 883.4 | 8.2 / 5.0 | 415, 2.85 | 415 | yes | unavailable |
| Poznań Główny / 1 | -1612.0, 938.3 | 8.2 / 5.0 | 415, 2.85 | 415 | yes | unavailable |
| Poznań Główny / 1 | -1545.7, 648.6 | 8.2 / 5.0 | 521, 2.85 | 521 | yes | unavailable |
| Poznań Główny / 1 | -1556.4, 702.1 | 8.2 / 5.0 | 521, 2.85 | 521 | yes | unavailable |
| Poznań Główny / 1 | -1567.1, 755.6 | 8.2 / 5.0 | 521, 2.85 | 521 | yes | unavailable |
| Poznań Główny / 1 | -1577.7, 809.1 | 8.2 / 5.0 | 521, 2.60 | 521 | yes | unavailable |
| Poznań Główny / 1 | -1588.7, 862.5 | 8.2 / 5.0 | 521, 2.60 | 521 | yes | unavailable |
| Poznań Główny / 1 | -1599.7, 916.0 | 8.2 / 5.0 | 521, 2.60 | 521 | yes | unavailable |
| Poznań Główny / 6 | -1583.9, 714.1 | 8.2 / 5.0 | 253, 2.60 | 253 | yes | unavailable |
| Poznań Główny / 6 | -1583.9, 747.6 | 8.2 / 5.0 | 267, 2.85 | 267 | yes | unavailable |
| Poznań Główny / 6 | -1594.6, 801.2 | 8.2 / 5.0 | 267, 2.85 | 267 | yes | unavailable |
| Poznań Główny / 6 | -1605.4, 854.9 | 8.2 / 5.0 | 267, 2.85 | 267 | yes | unavailable |
| Poznań Główny / 6 | -1616.0, 908.5 | 8.2 / 5.0 | 267, 2.60 | 267 | yes | unavailable |
| Poznań Główny / 12 | -1594.5, 987.1 | 8.2 / 5.0 | 67, 2.60 | 67 | yes | unavailable |
| Poznań Główny / 12 | -1605.0, 1038.6 | 8.2 / 5.0 | 67, 2.60 | 67 | yes | unavailable |
| Poznań Główny / 12 | -1615.4, 1090.1 | 8.2 / 5.0 | 67, 2.60 | 67 | yes | unavailable |
| Poznań Główny / 12 | -1625.9, 1141.6 | 8.2 / 5.0 | 67, 2.60 | 67 | yes | unavailable |
| Poznań Główny / 12 | -1633.0, 1149.6 | 8.2 / 5.0 | 82, 2.60 | 82, 132, 253, 254, 256, 264, 267, 367, 442, 521 | yes | unavailable |
| Poznań Główny / 12 | -1621.8, 1095.1 | 8.2 / 5.0 | 82, 2.60 | 82, 132, 521 | yes | unavailable |
| Poznań Główny / 12 | -1610.7, 1040.6 | 8.2 / 5.0 | 82, 2.60 | 82, 132, 521 | yes | unavailable |
| Poznań Główny / 12 | -1599.1, 984.6 | 8.2 / 5.0 | 407, 2.75 | 83, 132, 407, 521 | yes | unavailable |
| Poznań Główny / 12 | -1624.3, 1107.2 | 9.6 / 5.0 | 82, 2.67 | 82, 132, 253, 254, 256, 264, 267, 367, 442, 521 | yes | unavailable |
| Poznań Główny / 12 | -1595.6, 992.0 | 9.6 / 5.0 | 67, 2.70 | 67, 271, 441 | yes | unavailable |
| Poznań Główny / 12 | -1606.8, 1047.0 | 9.6 / 5.0 | 67, 2.78 | 67, 270, 271, 441 | yes | unavailable |
| Poznań Główny / 18 | -1481.7, 381.4 | 9.6 / 5.0 | 514, 2.78 | 16, 171, 514, 519 | yes | unavailable |
| Poznań Główny / 18 | -1482.3, 384.7 | 8.2 / 5.0 | 194, 2.85 | 194 | yes | unavailable |
| Poznań Główny / 19 | -1392.8, 566.1 | 8.2 / 5.0 | 376, 2.60 | 376 | yes | unavailable |
| Poznań Główny / 19 | -1383.7, 499.5 | 8.2 / 5.0 | 376, 2.60 | 376 | yes | unavailable |
| Garbary / 29 | 192.0, -872.7 | 8.2 / 5.0 | 0, 2.60 | 0 | yes | unavailable |
| Garbary / 29 | 244.8, -858.7 | 8.2 / 5.0 | 0, 2.60 | 0 | yes | unavailable |
| Garbary / 49 | 256.4, -865.3 | 8.2 / 5.0 | 2, 2.60 | 2 | yes | unavailable |
| Garbary / 49 | 203.0, -879.4 | 8.2 / 5.0 | 2, 2.60 | 2 | yes | unavailable |
| Poznań Główny / 81 | -1402.7, 615.8 | 8.2 / 4.6 | 376, 2.60 | 376 | yes | unavailable |

**Classification and next steps.** These classify the mapped geometry, not verified real-world construction:

- **#1: mixed (c/a).** Eleven mast centres lie inside the original roof ring; two lie outside it but hit the rectangle. No rail centreline lies inside either shape. Treat the eleven as possible platform masts through roof openings, pending platform/photographic verification; use the source ring for the two overbuild hits.
- **#6, #12, #29, #49 and #81: provisional (c).** Every hit centre is in the source roof ring and no railway centreline enters the deck. A source-ring roof alone will not remove these intersections. Confirm the platform edges and actual mast/roof arrangement before accepting openings or adding collars; #81 is classified as a roof by proximity/tags, not necessarily a platform canopy.
- **#18: geometric (b), with an elevation caveat.** Track 194 lies within both the original roof ring and the rectangle. Its simulated rail and wires are elevated well above the slab, so the overlapping plan view does not establish a real roof over a running track; verify the source geometry and track elevation against the station before raising a roof or accepting a physical crossing. Its two mast centres are in the original ring.
- **#19: mixed (a/c).** Rectangle overbuild puts 12.3 m of track 376 under the deck in plan, while the source ring contains none; both mast centres nevertheless lie in the source ring. Use the original ring for the overbuild and separately verify whether those masts belong in roof openings.

Estimated effort: source-ring geometry requires a moderate generator, renderer and clearance-audit change plus regeneration and browser review (roughly 1–3 days); it is not implemented by the present rectangular canopy generator. Platform/source and station imagery review is a separate small survey (hours, dependent on sources); accurately modeling openings/collars or a high station roof and its catenary is a larger rendering and placement task (roughly 1–3 days each after design). These are estimates, not a prescribed relocation rule.

General Polish practice includes portal and cantilever supports ([PKP PLK Iet-107](https://www.plk-sa.pl/files/public/user_upload/pdf/Akty_prawne_i_przepisy/Instrukcje/Wydruk/Iet/WCAG_Iet-107.pdf)) and canopy-mounted wiring ([3 kV DC support construction](https://transportszynowy.pl/kolej/siectrakckolkonstrukcje)); these sources do not identify the actual supports at these locations.


### Decision (2026-11-18)

The user accepts railway masts passing through openings in platform and station roofs. The audit now reports mast
centres inside their original OSM roof ring as accepted openings, separate from its hit totals. If the ring cannot be
matched, it accepts only a centre inside a track-free deck rectangle at least 2.5 m from every rail centreline. Of
the original 38 hits, 36 qualify, including both #18 and both #19 masts and the #81 roof mast. The two #1 masts
outside their source ring remain hits. Track 194 under #18 and the #19 rectangle overbuild remain survey notes;
accepting the mast openings does not resolve either geometry. No placement or rendering change was made.
