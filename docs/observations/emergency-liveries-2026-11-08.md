# Emergency-service liveries: Policja, PRM and PSP (2026-11-08)

The three generic emergency colour bands in `js/actor-models.js` were replaced with the statutory Polish markings for
Policja, Państwowe Ratownictwo Medyczne (PRM) and Państwowa Straż Pożarna (PSP). The work stays inside the existing
instanced car material: `carState.w` still selects the livery, the body classes keep one material and one near/far
instanced mesh each, and no mesh, draw call or per-livery geometry was added. The base paints are shared through
`EMERGENCY_PAINT`; one expanded text atlas and one four-cell RGBA badge atlas supply every word and symbol.

## Sources checked

- **Policja:** Rozporządzenie Ministra Infrastruktury z dnia 3 stycznia 2022 r. zmieniające rozporządzenie w sprawie
  warunków technicznych pojazdów oraz zakresu ich niezbędnego wyposażenia, Dz.U. 2022 poz. 122, §31 and §36. Silver
  body; reflective blue band with white rectangular reflectors at its upper and lower edges; white reflective
  `POLICJA` on both sides; optional police star, front/rear `POLICJA`, and fluorescent yellow-green reflective
  stripes on the upper and lower body. The regulation keeps pre-2022 cars legal (§31(3)), so the change does not
  repaint existing vehicles.
- **PRM:** Rozporządzenie Ministra Zdrowia z dnia 3 stycznia 2023 r. w sprawie oznaczenia systemu Państwowe
  Ratownictwo Medyczne oraz wymagań w zakresie umundurowania członków zespołów ratownictwa medycznego, Dz.U. 2023
  poz. 118, Annex 2, part I. Yellow body (CMYK 10/0/90/0, RAL 1016 class); three reflective stripes (red around the
  roof, blue directly above the lower red stripe, red between the window line and the wheel arches); red `AMBULANS`
  with a mirrored front version; 40 cm red `P`/`S` roundel; the PRM system graphic. The 2023 red-blue-red scheme is
  the one requested and modelled; the December 2025 amendment that would change the three lower bands to red-red-red
  is not applied.
- **PSP:** §27 of the vehicle-condition regulation (consolidated Dz.U. 2024 poz. 502) and Komenda Główna PSP order
  no. 14 of 26 July 2002 on uniform vehicle marking. Signal-red body (RAL 3000 class), white bumpers/fenders,
  a reflective distinguishing band, white `STRAŻ` on the front doors, white operational numbers and the optional
  `998`/`112` alarm number on the body.
- **Police presentation:** Policja.pl, “POLSECURE 2022: prezentacja nowego oznakowania radiowozów polskiej Policji”
  (22 April 2022) and the follow-up “Pierwsze nowe radiowozy w nowych barwach trafiły na Warmię i Mazury”
  (29 November 2022), which show the silver/blue/fluorescent pattern and the 2022 legal change.

## Implemented markings

`EMERGENCY_PAINT` is `[null, 0xc7ccd1, 0xf2e11c, 0xab1017]` and is consumed by `traffic.js`; the material paints the
rest from object-space position and normal. All heights below are metres above the road.

- **Policja, estate (livery 1):** silver `#c7ccd1`; blue `#1d3f8f` band at 0.70–0.90 m with white `#f4f6f8`
  rectangular reflectors at 7 cm pitch along both edges; white `POLICJA` inside the band on both sides; white
  `POLICJA` on the rear band; a 13 cm eight-point police star with the blue centre and white `POLICJA` on the front
  door; fluorescent yellow-green `#c8f000` rails at 0.94–1.00 m and 0.18–0.24 m and across the front and rear. The
  base paint stays silver, so the band and lettering are the only strongly coloured surfaces.
- **PRM, van (livery 2):** yellow `#f2e11c`; red `#c8161e` lower stripe at 0.88–1.03 m and blue `#1f4fbf` stripe at
  1.03–1.18 m, both wrapping the rear doors; red roof stripe at 2.28–2.43 m above the glass line; red `AMBULANS`
  (24 cm box) on the cargo box, `ZESPÓŁ RATOWNICTWA MEDYCZNEGO` (7.5 cm box) below it and a red mirrored `AMBULANS`
  on the front panel where the body has a front-facing surface; a 40 cm red `P` roundel on the front door; a 50 cm
  star of life on the cargo box and on the rear doors; the existing red/yellow rear chevrons.
- **PSP, fire truck (livery 3):** signal red `#ab1017`; white reflective band at 1.05–1.30 m with yellow `#f2c81a`
  rails at 0.95–1.03 m and 1.32–1.40 m; white `STRAŻ` in a 22 cm box on the front door; white `998` (18 cm box) on
  the rear doors; a 24 cm red/gold PSP flame shield on the locker band; the existing red/white rear chevrons. The
  silver roller-shutter lockers keep their shutters where no livery paint applies.

Text is one `carLetteringTexture()` sample for both main and secondary marks; the badge is one
`emergencyBadgeTexture()` sample from a 512 × 128 four-cell atlas (Policja star, PRM star of life, PSP shield, PRM
`P`). The material selects the cell from `carState.w`, so the whole fleet still shares one pipeline per body class.
`drawPoliceStar`, `drawPrmBadge`, `drawPspBadge` and `drawPrmTeamBadge` are exported for the headless tests.

## Verification

- `node --test tests/vehicle-models.test.cjs` — 13/13 pass. New checks cover the statutory base colours, the six
  lettering rows (`POLICJA`, `AMBULANS`, `STRAŻ`, `998`, the PRM team name), the four badge drawings, and the shader
  tokens for the bands, reflective blocks, fluorescent rail, medical stripes and badge atlas.
- `node --test tests/*.cjs` — 433/433 pass.
- `node --test tests/` — 447/447 pass (including the geodata rebuild and the `.mjs` tools).
- Browser: Chrome 157.0.8103.39 headless, 1280 × 800. A temporary shader harness (not committed) instantiated the
  estate, van and fire truck with `carState.w` 1/2/3 and rendered a three-quarter group plus side, front, rear and
  close-up views. It ran on WebGPU and with `?backend=webgl` (WebGL2 confirmed by the renderer backend). The full app
  also booted on both backends with no console, shader or TSL errors. View checks confirmed: silver/blue Policja band
  with white blocks and readable `POLICJA` on both sides and the rear; yellow PRM body with the red/blue/red stripes,
  `AMBULANS`, the long team name, `P` roundel, star of life on the cargo box and rear doors, and red/yellow chevrons;
  red PSP truck with the white band, yellow rails, `STRAŻ` on the door, `998` on the rear doors, the flame shield and
  red/white chevrons. No z-fighting or missing decal was seen on either backend.
- The silver police body, yellow ambulance body and red truck body are the base paints; the unchanged per-instance
  `plateCode` still draws each car's own PO/PY/PZ registration.

## Limits

- The model uses the 2023 PRM red-blue-red scheme. If the 2025 red-red-red amendment is confirmed as the desired
  target, `prmRed`/`prmBlue` and the stripe heights are the only tuning points.
- The front mirrored PRM `AMBULANS` is painted only where the body class offers a front-facing panel; on the
  high-roof van the front face above the grille is the bonnet top, so the marking is deliberately absent there rather
  than stretched over the hood. The side `AMBULANS` remains the primary readable mark.
- No PSP operational-number generator was added: the fire truck shows the generic `998` and the shield. A real
  three-digit prefix + letter + two-digit suffix (`491[P]42` style) could be carried on the lockers when the fleet
  needs individual identities.
- The focus is the vehicle body. The existing blue-only light bars are unchanged, so the 2022 “30 LED” police light
  count is not modelled.
