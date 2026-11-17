# Canopy lighting, 2026-11-17

The 458 soffit luminaires cover 40 decks: all `platform` and `tram` records, and `roof` records at least 30 m long
and no more than 10 m wide, a geometric proxy for long covered walkways. In this snapshot the selected indices are
1, 6, 7, 9, 10, 12, 15, 18, 19, 21, 25, 29, 32, 33, 45, 49, 52, 56, 62, 64, 65, 67, 68, 74, 76, 80,
83, 87, 88, 95, 102, 104, 105, 108, 122, 128, 129, 164, 190 and 205. This includes Piaśnicka, Dworzec Zachodni,
Główny, Komedy and the two Ławica roofs that lost lamps. The broad geometric proxy also covers other long roofs;
these have not all been surveyed for actual public access. One row is centred on narrow decks, two at ±30% of width
on decks at least 14 m wide. Nominal spacing is at most 7.5 m. Sites shift by up to 1.5 m along their row to keep
their centres at least 1 m from column centres; all 458 survive. Fixtures sit just below the underside and do not collide.

The shared street point-light pool supplies the floor light: fixture sites compete with other point sites for the
existing 48 lights. No light is created per fixture or per frame; at dense sites the pool can leave distant fixtures
without a light. The fixture emissive fades with the street-lamp shader's smoothstep, and is off at midday. Point lights
also illuminate the underside and nearby objects; the warm pools are a visual approximation, not photometric data.
A same-scene WebGPU frame comparison at the #10 under-deck pose, alternately hiding/showing the fixture mesh, added
one scene draw (successive call increments 21 off, 22 on); the fixtures do not cast shadows. Ten batches of 100
`streetDetails.update` calls at the Piaśnicka pose measured roughly 0.043–0.049 ms/update baseline and
0.042–0.046 ms/update with the sites, under concurrent workloads. These timings do not measure GPU frame time.

Three alternating `tools/bench-boot-headless.mjs` pairs against `poznan` measured total 11512.7 → 11463.9,
11410.8 → 11229.7 and 10985.9 → 10850.8 ms (median paired −135.1 ms). The tool does not build canopies or pass their
sites to street details, so these noisy totals do not measure the new fixture build cost. Other tests and Chrome ran
concurrently; no small boot or frame-cost conclusion is justified.

Headless Chrome WebGPU high, 1280 × 720, DPR 1, seed 4242, HTTP 8350, CDP 9550; moving actors can differ.
Midnight baseline is the pre-change HEAD. Best before/after pairs:

- Dworzec under: `/tmp/cx-canopy-lights/shots/before-night-under.png`, `/tmp/cx-canopy-lights/shots/after-night-under.png`.
- Dworzec aerial: `/tmp/cx-canopy-lights/shots/before-night-platform.png`, `/tmp/cx-canopy-lights/shots/after-night-platform.png`.
- Piaśnicka under: `/tmp/cx-canopy-lights/shots/before-night-pias.png`, `/tmp/cx-canopy-lights/shots/after-night-pias.png`;
  eye (3243, 3, 2312), target (3300, 5, 2341), FOV 55°.

The other #10 poses match the clearance record. Midday, golden and twilight after frames are `after-midday-under.png`,
`after-golden-under.png`, `after-twilight-under.png` in the same directory. WebGL2 high and WebGPU low midnight
frames are `webgl-night-under.png` and `low-night-under.png`; the aerial frames are `webgl-night-platform.png` and
`low-night-platform.png`. The midday housing is unlit. No page-console warnings
or errors were captured; Chrome logged macOS headless display-link errors. Visual approval remains outstanding.

## Review follow-up

The initial fixture layout placed 42 sites within 0.5 m of column centres. Row shifts clear every fixture centre by
at least 1 m; the regression tests the 0.5 m minimum and deck footprint. The Piaśnicka globe at (3246.47, 2316.58)
was below the 6.1 m soffit, so the earlier height-gated audit did not report it. The park-lamp placer ran before the
tram keep-out existed and did not query deck footprints. It now rejects globe footprints under tram and platform decks,
including those shorter than the clearance; the full-world audit checks that independently.

The original point-light intensity 50 made #10 read like an indoor hall. The review version uses 25 and reduces the
emissive gain from 2.1 to 1.6, retaining a visible warm wash while lowering the floor illumination. WebGPU high,
same poses and setup as above: revised midnight frames are `review1-night-under.png`, `review1-night-platform.png`
and `review1-night-pias.png` in `/tmp/cx-canopy-lights/shots/`. Moving vehicles and their lights differ. No new
page-console warnings or errors were recorded; the server and browser were stopped after capture.
