# Courtyard slab geometry audit — 2026-11-14

Headless exact-geometry audit of every courtyard / yard / lawn slab built by `js/buildings.js` (`allBlocks[i].yards` after `clipYard`, the exact list passed to `yardInst`), replacing `yardFitsBlock`'s 2 m perimeter probes with exact polygon-to-segment and polygon-to-polygon measurements.

## Method

`tools/audit-courtyards.mjs` loads `js/city-config.js`, `js/city-grid.js` and `js/buildings.js` via `loadModule` with inert Three.js/TSL/roof/balcony stubs, runs `buildCityGrid` and `buildCityBlocks`, and inspects every slab `{ x0, x1, z0, z1, ry }` in `allBlocks`:

1. **Roadway carriageways:** exact minimum distance from the 4-corner slab rectangle to every `LANE_GUIDE` segment minus its half-width, indexed with `half + 20 m` cell padding (avoiding `GUIDE_GRID`'s `half + 4 m` cell-boundary cutoff in `js/city-config.js:649`). Threshold: `< 4.6 m` (`YARD_ROAD_KEEP`).
2. **Pedestrian corridors and rail/tram tracks:** exact minimum distance from the slab rectangle to `PEDESTRIAN_WAYS` corridors (minus `w * 0.5`) and `GEO.rail` centrelines. Threshold: `< 0.5 m` (overlap is `0 m` or `<= 0 m`).
3. **Block curb island:** exact check against `BLOCKS[srcBlockId].poly` (all 4 slab corners inside `poly`, no proper edge–edge intersection, no `poly` vertex strictly inside the slab).
4. **Named areas:** blocks along `Podgórna`, `Strzelecka` and `Plac Wiosny Ludów` are identified by matching `ROADS` polylines with those names within `15 m` of `BLOCKS[i].poly`, plus `KUPIEC_BLOCK = 792` (`Kupiec Poznański`).

**Command to rerun:**

```sh
node tools/audit-courtyards.mjs
```

Supports `--json`, `--top N` (default `10`) and `--near x,z,r`.

## City-wide counts

- **Slabs audited:** **19,581**
- **Violations:** **1** total
  - Roadway carriageway `< 4.6 m`: **0**
  - Pedestrian corridor `< 0.5 m`: **0**
  - Rail/tram track `< 0.5 m`: **1**
  - Outside block curb island: **0**

### Violation (1)

| Block | District | Centre `(x, z)` | Size / `ry` | Road | Ped | Rail | Curb outside |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `1257` (`Łazarz_-2757_2320`) | Łazarz | `(-2757.62, 2309.3)` | `11 × 17 m`, `-0.3735 rad` | `66.8221 m` | `—` | **`0 m`** | `false` (`0 m`) |

**Cause (`js/buildings.js`, `yardFitsBlock`, lines 2958–2981):** `yardFitsBlock` samples the slab perimeter at `<= 2 m` spacing (`nu = 6`, `nv = 9`, giving `du = 1.833 m` and `dv = 1.889 m` on this `11 × 17 m` slab) plus a `3 × 3` interior grid (`2.75 × 4.25 m` spacing). At Zajezdnia Głogowska (block `1257`), three parallel tram depot tracks (`(-2773.8, 2298.8)–(-2680.1, 2336.4)`, `(-2773.1, 2305)–(-2674.8, 2344.2)` and `(-2775.7, 2310.4)–(-2689, 2345.5)`) cut directly across the slab (`railDist = 0 m`), yet all 43 probes straddle the three tracks; the closest probe (`inner`) stands at `0.5085 m`, just above the `0.5 m` threshold. Thus a 2 m probe spacing in `yardFitsBlock` **does** miss a track edge that the exact polygon check catches.

### Closest 10 slabs city-wide

**To roadway carriageway (min `4.6005 m`, all ≥ `4.6 m`):**

| Rank | Block | District | Centre `(x, z)` | Distance |
| --- | --- | --- | --- | --- |
| 1 | `1825` (`Junikowo_-6754_1676`) | Junikowo | `(-6759.06, 1679.32)` | `4.6005 m` |
| 2 | `1370` (`Żegrze_2072_2716`) | Żegrze | `(2087.27, 2708.45)` | `4.6013 m` |
| 3 | `1595` (`Ławica_-6848_-286`) | Ławica | `(-6853.96, -296.17)` | `4.603 m` |
| 4 | `40` (`Sołacz_-3539_-2744`) | Sołacz | `(-3540.75, -2744.61)` | `4.6031 m` |
| 5 | `1949` (`Grunwald Południe_-4549_2450`) | Grunwald Południe | `(-4654.76, 2495.54)` | `4.6039 m` |
| 6 | `1480` (`Krzyżowniki-Smochowice_-7273_-2529`) | Krzyżowniki-Smochowice | `(-7273.9, -2528.33)` | `4.6059 m` |
| 7 | `768` (`Stare Miasto_-872_271`) | Stare Miasto | `(-896.28, 358.32)` | `4.6075 m` |
| 8 | `1621` (`Grunwald Północ_-4137_-127`) | Grunwald Północ | `(-4158.18, -151)` | `4.6101 m` |
| 9 | `1595` (`Ławica_-6824_-283`) | Ławica | `(-6830.85, -291.4)` | `4.6102 m` |
| 10 | `23` (`Nowe Winogrady Południe_394_-2658`) | Nowe Winogrady Południe | `(394.34, -2657.09)` | `4.6111 m` |

**To pedestrian corridor (min `0.5104 m`, all ≥ `0.5 m`):**

| Rank | Block | District | Centre `(x, z)` | Distance |
| --- | --- | --- | --- | --- |
| 1 | `668` (`Stare Miasto_-19_61`) | Stare Miasto | `(-25.08, 60.11)` | `0.5104 m` |
| 2 | `668` (`Stare Miasto_-49_29`) | Stare Miasto | `(-50.24, 34.89)` | `0.5202 m` |
| 3 | `494` (`Warszawskie-Pomet-Maltańskie_3314_-386`) | Warszawskie-Pomet-Maltańskie | `(3314.83, -387.75)` | `0.8758 m` |
| 4 | `768` (`Stare Miasto_-772_307`) | Stare Miasto | `(-750.81, 279.82)` | `1.3423 m` |
| 5 | `23` (`Nowe Winogrady Południe_394_-2658`) | Nowe Winogrady Południe | `(394.34, -2657.09)` | `3.2578 m` |
| 6 | `939` (`Wilda_-444_1241`) | Wilda | `(-387.56, 1209.04)` | `4.2582 m` |
| 7 | `81` (`Nowe Winogrady Południe_433_-2514`) | Nowe Winogrady Południe | `(433, -2514.2)` | `4.7147 m` |
| 8 | `666` (`Stare Miasto_66_14`) | Stare Miasto | `(66.15, 13.68)` | `4.8976 m` |
| 9 | `838` (`Stare Miasto_-166_749`) | Stare Miasto | `(-207.43, 699.66)` | `4.9045 m` |
| 10 | `633` (`Stare Miasto_-48_-60`) | Stare Miasto | `(-47.99, -60.08)` | `4.9142 m` |

**To rail/tram track (1 violation at `0 m`, next closest `0.5022 m`):**

| Rank | Block | District | Centre `(x, z)` | Distance |
| --- | --- | --- | --- | --- |
| 1 | `1257` (`Łazarz_-2757_2320`) | Łazarz | `(-2757.62, 2309.3)` | **`0 m`** |
| 2 | `849` (`Wilda_-1709_756`) | Wilda | `(-1448.65, 705.16)` | `0.5022 m` |
| 3 | `849` (`Wilda_-1576_775`) | Wilda | `(-1459.38, 758.58)` | `0.5511 m` |
| 4 | `890` (`Łazarz_-1784_2386`) | Łazarz | `(-1948.03, 2377.53)` | `0.5569 m` |
| 5 | `1257` (`Łazarz_-2718_2304`) | Łazarz | `(-2715.88, 2314.49)` | `0.7522 m` |
| 6 | `1896` (`Junikowo_-5473_2088`) | Junikowo | `(-5482.55, 2068.04)` | `0.7694 m` |
| 7 | `1257` (`Łazarz_-2701_2310`) | Łazarz | `(-2701.88, 2320.54)` | `0.8016 m` |
| 8 | `849` (`Wilda_-1576_844`) | Wilda | `(-1473.44, 828.8)` | `0.8233 m` |
| 9 | `1257` (`Łazarz_-2736_2309`) | Łazarz | `(-2735, 2307.75)` | `1.4216 m` |
| 10 | `1850` (`Junikowo_-5890_2242`) | Junikowo | `(-5789.6, 2178.6)` | `1.9102 m` |

## Named areas (Podgórna, Strzelecka, Plac Wiosny Ludów, Kupiec Poznański)

- **Blocks matched:**
  - `Podgórna`: `[704, 715, 766, 770, 792]` (68 slabs)
  - `Strzelecka`: `[792, 799, 802, 806, 817, 827, 829, 838, 852, 865, 868, 877, 907, 909, 910, 914, 939, 943, 949]` (545 slabs)
  - `Plac Wiosny Ludów`: `[704, 766, 770, 792, 798, 799, 802, 806]` (103 slabs)
  - `Kupiec Poznański`: `[792]` (13 slabs)
- **Total unique slabs in named areas:** **617 slabs**, **0 violations**.
- **Closest named-area clearances:**
  - Roadway: `4.856 m` (block `806` at `(-114.66, 514.18)`, Strzelecka / Plac Wiosny Ludów)
  - Pedestrian corridor: `4.2582 m` (block `939` at `(-387.56, 1209.04)`, Strzelecka)
  - Rail/tram track: `7.4899 m` (block `914` at `(74.59, 896.68)`, Strzelecka)
- **Kupiec Poznański (block `792`, 13 slabs):** min roadway `6.5358 m` (`Stare Miasto_0_456` at `(1.45, 455.33)`), min rail `8.1264 m` (`Stare Miasto_89_414` at `(79.77, 472.53)`), all 13 inside curb island.

## Limits

- Headless Node audit with inert Three.js/TSL rendering stubs; checks the final `blk.yards` geometry records against `LANE_GUIDE`, `PEDESTRIAN_WAYS`, `GEO.rail` and `BLOCKS[i].poly`, not rendered WebGPU/WebGL2 appearance or z-fighting.
- `GUIDE_GRID` in `js/city-config.js:649` pads segments by `half + 4 m` (less than `YARD_ROAD_KEEP = 4.6 m`), which did not cause any violation here (confirmed by the audit's `half + 20 m` index) but remains a latent cell-boundary blind spot in `roadClearance`.
