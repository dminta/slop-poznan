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
without a new draw call. The furnished fixture retains the same 190 runtime heads and support records as the lamp-only baseline, and the audit
found no missing traction anchors; the signal placement regression also validates reused anchors. No pole or arm entries remain within the selected decks. Platform railway
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
