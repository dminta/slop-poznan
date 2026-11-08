# Non-residential building profiles — 2026-11-08

Follow-up to [the non-residential audit](non-residential-audit-2026-11-08.md), recommendation 1: `js/buildings.js` had
residential profiles plus `HOSPITAL`, `UNIVERSITY` and `FAIRGROUND`, so malls, retail parks, industrial halls, depots,
stadiums and utility plants fell back to their district's kamienice, villas or panel slabs. The audit measured Posnania
as 31 lots of 23 m kamienice (44% of its OSM outline covered), Castorama as 11-storey blocks (31 m) and the ZNTK halls as
27 m kamienice. This record covers the seven new layouts, their block classifier and the measured silhouettes.

## Profiles and layouts

`LAYOUTS` gains `mall`, `retail`, `industrial`, `depot`, `stadium`, `arena` and `utility`; `KIND_SHARE` gains `mall`
0.75, `retail` 0.6, `industrial` 0.55, `depot` 0.5, `stadium` 0.25, `arena` 0.6 and `utility` 0.45.

| Profile | Layout | Height | Roof / detail | Lot coverage |
| --- | --- | --- | --- | ---: |
| `MALL` | one broad box, glazed entrance pavilion on the main front | 3–4 storeys, 11.4–15.6 m | flat; central 9–14 m rooflight run, 5 plant units | 65–80% |
| `RETAIL_PARK` | 1–3 halls behind a front car park, aisles between | 2 storeys, 7.6 m | flat; rooflights and packaged plant | 60% |
| `INDUSTRIAL_HALL` | long hall in 18–26 m bays (0.8 m gaps), front office | 2–3 storeys, 7.6–11.4 m | gabled bays, the sawtooth/north-light rhythm | 55% |
| `DEPOT` | long halls along the lot, spaced for tracks/yards | 2–3 storeys, 7.6–11.4 m | shallow gables | 50% |
| `STADIUM` | four stands round a 104 × 68 m pitch, corners open | 6–8 storeys, 23–31 m; ends 2 lower | flat; pitch stays lawn | 25% |
| `ARENA` | two-storey podium, octagonal hall above | 5–7 storeys, 19–27 m | flat with plant | 60% |
| `UTILITY` | turbine hall and taller boiler house | 4–7 storeys, 15–27 m | flat; blank industrial walls | 45% |

The mall body is 3–4 storeys because the existing facades are 3.8–3.9 m floor-to-floor; 2 storeys would be 7.6 m,
below the 10–16 m band. Industrial and depot heights are steered to 2–3 storeys even when OSM tags the hall as one
storey, and the mall to 3–4, so a tagged shed does not collapse the volume.

## Classification

`GEO.blockStats` still carries only the campus programme, so `blockProfile` checks two additions before
`OFFICE_SITES` and the osiedle switch:

1. **Known sites** (`SPECIAL_SITES`) for uses that stats cannot name: Enea Stadion (`STADIUM`), Hala Arena (`ARENA`),
   EC Garbary (`UTILITY`), the Głogowska, Madalińskiego and Historical tram depots (`DEPOT`) and the Główna halls
   (`INDUSTRIAL_HALL`). A lot inside the site reach takes the profile exactly (`exact`: no thinning).
2. **Morphology** (`bigBoxKind`): a block of at least 1.2 ha, at least 12% built, median at most 3 storeys and mapped
   footprints averaging at least `BIG_BOX` 900 m² is a big-box or hall block, not a perimeter block. The average is
   `built × area / buildings`; it separates Poznań's 150–600 m² residential footprints from the 900–77,000 m² halls.
   An average of at least 12,000 m² with 45% built is `MALL`; 2,500 m² and up is `RETAIL_PARK` outside the industrial
   districts (Główna, Wilda, Antoninek, Starołęka) and `INDUSTRIAL_HALL` inside them; below that the district and the
   storey median pick a retail park or an industrial hall. Park blocks keep their district profile unless their
   average is large, and a small park-carved block (under 3 ha, over 30% park) stays `LOWRISE` — this is IKEA Franowo's
   20–26 m cell grid, which the existing low halls already matched.

`steerProfile` keeps the existing skip for the morphology kinds, returns a site-anchored profile unthinned, and keeps
hall heights in their bands. The classifier is the interim replacement for the audit's item 2 (`GEO.blockStats`
programmes) and item 3 (`GEO.blockAnchors`), which remain in the backlog.

## Measured silhouettes

The audit script (`tools/audit-nonresidential.mjs`, 2 m raster, 2026-11-08) before → after:

| Object | Block | OSM outline covered | Generated block share | Max height |
| --- | ---: | ---: | ---: | ---: |
| CH Posnania | 953 | 43.5 → 68.0% | 44.5 → 59.8% | 22.8 → 16.4 m |
| Castorama | 21 | 17.7 → 22.1% | 18.7 → 22.9% | 30.8 → 7.6 m |
| Gigamarket | 28 | 23.4 → 34.5% | 30.7 → 23.9% | 19.0 → 7.6 m |
| Miasto Wnętrz | 28 | 25.9 → 21.0% | 30.7 → 23.9% | 15.2 → 7.6 m |
| ZNTK Robocza | 847 | 25.9 → 34.2% | 23.8 → 25.6% | 27 → 11.4 m |
| EC Garbary | 266 | 0 → 31.2% | 5.2 → 8.2% | 21 → 25.9 m (mean 22.9) |
| Hale Główna 6.57 ha | 36 | 31.4 → 80.4% | 41.1 → 47.4% | 19.5 → 11.4 m |
| Hale Główna 4.46 ha | 95 | 17.1 → 29.7% | 12.0 → 11.2% | 19 → 11.4 m |
| Hale Główna 1.73 ha | 78 | 44.2 → 81.1% (hall site) | 33.7 → 51.1% | 23 → 11.1 m |
| IKEA Franowo | 1375 | 58.5 → 58.5% (kept `LOWRISE`) | 34.7 → 35.0% | 7.6 → 7.6 m |

Blocks 938 and 939 (Wilda, 40.3% and 36.4% generated) are ordinary Wilda blocks in the 2026-10-28 snapshot; the ZNTK
ruins are in block 847, which moved as above. Posnania's remaining gap is its 20-m slivers (31 lot pieces), which stay
car park/apron; the audit's anchors (item 3) are the structural fix.

The stadium and arena are implemented but still invisible in the audit: Enea Stadion 0.1% and Hala Arena 0% coverage.
Both are caused by `parkFreeCells` cutting their lots to 20 m cells before the layout sees them; the park carve-out is
backlog item 4. Block 1254 (Głogowska depot hall) also still has no lot rects; that is backlog item 5.

## Tests and checks

- `node --test tests/buildings-density.test.cjs` — 8/8 pass. The balcony sanity range moved to 14–18k stacks and
  40–52k landings because non-residential blocks no longer generate housing balconies (measured 14,609 / 43,011).
- `node --test tests/*.cjs` — 429/429 pass. Two tree-fixture pins moved by one site: street trees 18,101 → 18,102 and
  the seeded species `before`/`after` counts; the record for that deliberate pin change is this file.
- `node --check js/buildings.js` passes; no `index.html`, preload or geodata changes, so no shader or module changes were
  introduced.
- Browser smoke check (headless Chrome, 2026-11-08): the scene loaded in WebGPU and in WebGL2 (`?backend=webgl`),
  the loading overlay hid, the HUD reported 41–49 fps and the console had **0 errors** and no shader/TSL failures.
  The screenshots were taken at spawn (the app exposes no camera hook), so the aerial silhouette of Posnania,
  Castorama and the Główna halls was verified by the audit raster above, not by a targeted browser view; a manual
  camera pass over those sites remains a backlog item.
