# Starołęka: trams ran past the rendered rails (2026-11-17)

Branch `cc-staroleka-rails` from poznan 672d77e. Evidence: [browser-checks-2026-11-16.md](browser-checks-2026-11-16.md) (Starołęka).

## Cause and scope (headless)

`layoutTrackRails`, the contact-wire loop and the pole search in `js/tram-infra.js` tested `isLand`, whose raster covers only
the detail box `[-9119.5, 4490.7] × [-2830.8, 2844.2]`. The OSM extract keeps whole tram chains that touch the box, so
**11.49 km of tram track lies outside it, 11.38 km of it on a route**. Inside the box no tram piece was lost (0 m dropped
for water or land). The gap was citywide, not only Starołęka:

| rail chains (routes) | outside the box |
|---|---|
| 1200 / 1201 (lines 7, 12, 13; Starołęka, x 625–664, z 2847–3124) | 282 m each |
| 1067 / 1068 (2, 9, 10, 19; SW, x −1888..−1456, z to 3599) | 874 / 867 m |
| 1069 (1, 3, 17; x 1506–2369, z to 3537) | 1146 m |
| 844 / 848 (1, 16, 18; SE, x 3801–4466, z to 3157) | 925 / 930 m |
| 1097 / 1098 (1, 7, 11; x −491..213, z to 2995) | 703 / 723 m |
| 664, 553, 617 (south, x 2193–2373 and −3603..−3336) | 308 / 303 / 331 m |
| 1071 / 1072, 716 / 718, 987 / 988, 989, 1070 (north, z −3675..−2831) | 874 / 879, 452 / 456, 220 / 220, 215, 296 m |
| 541, 973 (east edge, x 4492–4674, z about −170) | 184 / 168 m |
| 1013 (no route, x 4470–4560, z 2828–2885) | 115 m, no route; laid too since the check is per piece |

Real geometry: ways 1533059210 / 1533059211 (the extension) end at (623, 3122), where the OSM snapshot ends
(lat 52.380). The route relations (e.g. 5744748, 90155) list about 35–40 member ways beyond that with no geometry in
`tools/data`, so the real lines continue south to Starołęka PKM. The z ≈ 3125 end is the data edge, not the real terminus;
I could not fetch more (Overpass returned nothing). The extension follows the real mapped track.

## Fix: option (a)

`trackGround(x, z)` (outside the box: inside an `OUTSKIRTS` ring and in no `OUTSKIRTS_HOLES` ring; inside: `isLand`) replaces `isLand` in `layoutTrackRails`, `clearSpot`, `march` and the wire
loop. Rails, grooves, wires, poles, spans and arms are laid on outskirts ground. No tools or geodata change: `js/geodata.js`
is byte-identical, so no output hashes moved. Reasons for (a) over (b): the lines really run there, ending routes at the box
edge would invent a terminus mid-street and cut line 13/12 short, and (a) is a small change in one file. Heights: outskirts land top is −0.02,
the rail head top 0.016 (foot buried), so there is no bed to z-fight and trams (y 0) neither float nor sink. Trams reaching the data edge treat it as a dead end (they brake, wait and respawn); rails end at the OSM snapshot edge; no buffer stop, no end treatment. Stops and platforms still need raster land; the
mainline railway outside the box is unchanged (still dropped).

## Tests

- `tests/tram-infra.test.cjs`: every routed tram track has rail pieces along ≥ 99.5 % of its length, > 11 km of routed
  track outside the box, rails reach z 3100 at Starołęka, and a pole/arm/span end lies within 45 m of every 10 m sample of
  routed track outside the box (> 1000 samples). It fails on the old code (rail 541: 2946 of 3130 m, …) and passes now.
- `node --test tests/`: 677 pass, 0 fail.
- `node tools/accept-traffic.mjs --base poznan --jobs 4` (20 fresh seeds): every metric identical to the baseline
  (diff 0, CI [0, 0], all `within noise`; car–tram 69 → 69, holds > 120 s 15 → 15, deadlocks 0 → 0, max wait 2158 → 2158,
  km/h 303.1 → 303.1); no new deadlock pattern; exit 0. Expected: poles are not road-network obstacles and the tram graph is untouched.

## Cost

| | before | after |
|---|---|---|
| tram rail pieces | 30,691 | 33,634 (+2,943) |
| poles / spans / arms | 4,484 / 1,886 / 990 | 4,978 / 2,012 / 1,246 |
| TramRails / Grooves / Wires instances | 89,468 / 61,382 / 23,392 | 95,354 / 67,268 / 24,313 |
| `layoutTramInfrastructure` (headless) | 563 ms | 554 ms |
| `buildTramInfrastructure` (headless, stubs) | 1,806 ms | 1,768 ms |
| browser `[init] tramInfra` (WebGPU high) | 128 ms | 121 ms |
| static tram meshes after culling | 414 | 454 (+40 chunks) |
| tram-infra instances | 253,801 | 268,141 |
| tram-infra meshes in frustum, Starołęka poses | 17–18 | 19–23 (+2 to +5 draws per pass) |

No new instanced mesh, so no new draw-call family; only more culling chunks. `renderer.info.render.calls` is cumulative
in this build and not usable, so the frustum count above is the draw estimate.

## Browser (WebGPU high, Chrome, seed 4242, HTTP cache off)

Console: no errors or warnings in either build. Before = poznan `js/tram-infra.js`, after = working tree, same poses. Shots in
`/tmp/cc-staroleka-rails/shots/` (`before-*` / `after-*`):

- corridor boundary near (658, 2855): `1a` oblique, `1b` top, `1c` low
- rail end (628, 3124): `2-end-a..d`, `2-end-tram-a..c` (a tram waiting at the buffer, line 13 to Starołęka PKM), `2a..2c`
- tram over the former gap: `3-gap-00..11` (line 7 / 13 tram from z 2835 to the end; different tram ids before and after because
  the run diverges), `3a`, `3b` lawn close-ups
- aerial: `4a`, `4b`, `4c` corridor, `4d` top-down

Before: rails and wire end at z ≈ 2846 and the tram runs on over bare coarse road and lawn. After: rails, wire and poles
continue along the coarse road to z ≈ 3123, the tram decelerates (13.8 → 6 m/s) and stops at the rail end. Wires and poles
are visible from the air; the rails read as thin lines. Not checked: every other outside-box line (only Starołęka was
viewed), sleepers (tram track has none), night view, WebGL2.

## Open

The Starołęka line ends at the OSM snapshot edge, 281 m past the box: the rails and wire simply stop; at the time there was
no buffer stop; the real loop at Starołęka PKM is outside the snapshot. Outskirts poles were not checked against outskirts
buildings (buildings keep 1.5 m off the track only).

Follow-up 2026-11-19: every data-edge dead end (22, Starołęka included) now has a buffer-stop prop, and
`tools/audit-pole-outskirts.mjs` checks the tram/signal poles against the generated outskirts buildings; 0 pole clashes at 0.3 m.
[Record](tram-buffer-stops-2026-11-19.md).

## Review round 1: Warta crossing (Most Przemysła I)

The first version treated every point outside the box as ground. The Warta there is the gap between two `OUTSKIRTS` rings
(not a hole), so rails 1097/1098 (Hetmańska line, routed) put 26+ rail pieces and 6 poles on open water at x 105–154,
z 2964–2981 (OSM ways 52076600 and 73305565 are bridges, layer 1, with no deck in the data). My earlier claim that all outside
midpoints lie on outskirts land came from a midpoint check of polyline segments and missed it; it was wrong.

Fix: `trackGround` tests real outskirts land outside the box, so poles, spans and arms never stand on water. The rail pieces
over the river (about 50 m, `layout.decks`) are laid on a plain concrete deck with steel side girders at y −0.01, flat like
the in-box bridges, with the wire across it. The user chose this over a bare crossing (round 2); the temporary
`OUTSKIRTS_WATER_SPANS` switch is gone. The test checks that no piece, pole, span or arm outside the box is off outskirts land
except the deck pieces, that those are over water and include the Most Przemysła I span, and that every routed track now has
rails along its whole length. Shots: `/tmp/cc-staroleka-rails/shots/{before,skip,deck}-w1-warta-oblique|w2-warta-top|w3-warta-low.png`
(`skip` is the rejected bare crossing, `deck` the shipped one).
