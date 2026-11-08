# Industrial tagging supplement — 2026-11-08

Follow-up to [the non-residential audit](non-residential-audit-2026-11-08.md), §F and recommendation 9: the building
snapshot only asked for `building=*`, so cooling towers, chimneys, silos, storage tanks, works and power/substation
sites were missing from the input. EC Garbary (block 266) had only two small halls, ZNTK's `building=ruins` had no
category and Termy Maltańskie's unnamed `building=yes` was indistinguishable from background stock.

## Input

`tools/data/q_poz_industry.overpassql` asks for `man_made=cooling_tower|chimney|storage_tank|silo|works` and
`power=plant|substation` in the padded box 52.380–52.437 N, 16.875–17.005 E, with ways and multipolygon relations.
`tools/data/poz_industry.json` was fetched with `tools/overpass.sh` on 2026-11-08 (401 elements, 0.33 MB):

| tag | elements |
|---|---:|
| `power=substation` | 324 (including 23 `man_made=street_cabinet` kiosks) |
| `man_made=storage_tank` | 62 |
| `man_made=works` | 6 |
| `man_made=chimney` | 4 |
| `man_made=silo` | 3 |
| `power=plant` | 2 |

Inside the detail box the snapshot contributes 348 entries: 284 substations, 56 storage tanks, 2 silos, 4 works,
1 plant and 1 chimney. There is no `man_made=cooling_tower` in the box. Karolin's two `building=industrial
industrial=cooling` towers and 204 m chimney lie outside the detail box and remain in `js/satellite-sites.js`; EC
Garbary has no mapped tower at all in the 2026-10-28 building snapshot.

## Pipeline changes

`tools/poz-buildings.mjs` now loads both snapshots and deduplicates a way that is also a relation's outer member.

- **Built outlines vs sites.** Chimneys, cooling towers, silos and storage tanks join the 1 m building mask because
  they are real volumes. `power=plant|substation` and `man_made=works` polygons are sites: they classify their block
  but are not counted as built mass (a landuse ring is not a building).
- **Use classes.** `buildingUse` now returns 1 hospital/clinic, 2 university, 3 retail, 4 industrial, 5 rail/depot,
  6 sport/arena, 7 utility and 8 leisure/water park. The existing campus rule is unchanged; the other programmes need
  a dominant footprint share (≥ 40 % of all tagged uses). `building=ruins` on ZNTK is industrial, the EC Garbary
  generator halls are utility, and `addr:street=Termalna` is leisure.
- **`GEO.industry`.** Every industrial element inside the detail box becomes
  `{ kind, x, z, w, d, h, area, block }`, with `height` from OSM, `building:levels × 3.4 m`, or a kind default.
  `GEO.blockStats` keeps its four-field tuple; the fourth field now accepts programmes 0–8.
- **Runtime.** `js/buildings.js` draws mapped chimneys and cooling towers as one instanced cylinder and one instanced
  lathe (two draws), with player colliders to the tower top. EC Garbary's missing 65 m chimney and 55 m cooling tower
  are a curated fallback at `(740, −930)` and `(655, −875)`, in the free yard checked against generated footprints and
  the road graph; each is skipped when OSM has a structure of the same kind within 250 m.

The layouts still use `SPECIAL_SITES` and the morphology classifier rather than the new programmes. A blanket
programme-4 override looked tempting for ZNTK, but it also caught mixed block 817 and cut city-wide balconies from
14,609 to 10,412; programmes 3/5/6/7/8 remain classification data until building anchors (backlog item 3).

## Programmes after the pass

| programme | blocks |
|---|---:|
| 0 none | 1,093 |
| 1 hospital/clinic | 13 |
| 2 university | 24 |
| 3 retail | 144 |
| 4 industrial | 55 |
| 5 rail/depot | 8 |
| 7 utility | 63 |
| 8 leisure/water park | 18 |

## Measured sites

The audit's 2 m raster over the generated city, current block ids (the audit's #847 moved to #848 with the railway
island pass):

| Site | Block | Programme | OSM outline coverage | Generated block share | Max height |
|---|---:|---:|---:|---:|---:|
| EC Garbary | 266 | 7 utility | 31.2 % | 8.2 % | 27.0 m |
| ZNTK Robocza | 848 | 4 industrial | 21.3 % (three ruins 12.1 / 31.0 / 26.3 %) | 24.5 % | 11.4 m |
| Termy Maltańskie | 613 | 8 leisure | 20.4 % | 4.2 % | 11.4 m |

EC Garbary keeps two 1,500 m²+ utility halls at 15–27 m; ZNTK keeps eight or more hall parts ≥ 1,800 m² at 7.4–11.4 m;
Termy keeps its 14,336 m² `addr:street=Termalna` envelope and a 2,866 m² recreation hall at 11.4 m. The Termy envelope
still splits across several lot rects of the 96 ha Malta block, so only a fifth of the outline is covered; the rest of
the block's park and frontage stock is unchanged.

## Tests

- `tests/buildings-density.test.cjs`: 13/13 pass, including three new regressions:
  block 266 (utility halls, chimney ≥ 55 m, cooling tower ≥ 45 m), block 848 (programme 4, ≥ 8 hall parts ≥ 1,800 m²,
  max 16 m) and block 613 (programme 8, Termalna envelope, ≥ 15 % coverage at 8–25 m).
- `node --test tests/*.cjs`: 445/445 pass.
- `node --test tests/geodata.test.mjs`: passes; the fresh offline build matches the committed `js/geodata.js` and now
  also checks the industry key and programmes 0–8.
- `node --max-old-space-size=8192 tools/build-poznan.mjs`: 42.8 s, 2.56 MB output, `industry` 30 KB / 348 entries.
- No browser render check was run: the two new instanced meshes and the EC Garbary fallback need the visual pass listed
  in the backlog (WebGPU and WebGL2, free camera and street level, tower colliders and z-fighting).

## Limitations

- The snapshot is an OSM extract, not a survey: EC Garbary's towers are curated because OSM has no outline for them.
  The chimney and cooling tower heights are plausible plant values, not measured.
- `man_made=works` and `power=plant` rings are large landuse sites; only their programme weight is used, never their
  area as built mass.
- Karolin is outside the detail box, so its towers and chimney are not in `GEO.industry`; `satellite-sites.js` owns
  that skyline.
