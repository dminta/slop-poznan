# Signal–tram swept-envelope clearance audit — 2026-11-14

Headless geometric audit of every signal pole, overhead mast, cantilever arm, S-1/pedestrian head, span stay, and the
Górna Wilda traction-pole span placed by `js/street-details.js` against the articulated tram swept envelope and
catenary wires from `js/tram-infra.js`, `js/trams.js` and `js/actor-models.js`.

**Result:** **0 clashes** (lateral or vertical). No game code was changed.

## Method and sources

1. **Headless world build** (reusing `tools/audit-signal-heads.mjs`): loads `city-config.js`, `geodata.js`, `road-network.js`,
   `city-grid.js`, `street-details.js`, `pedestrian-routes.js`, `tram-infra.js`, and `traffic.js` (`configureSignals`)
   with inert three.js/TSL stubs, then runs `addRuntimeSignalHeads(network, pedRoutes, supports)` with
   `supports = [...tramLayout.poles, ...railLayout.masts]`.
   - Note: the current tree has **201** historical approaches (`A/B/C/D = 190/0/0/11`), **1,291** vehicle heads,
     **94** overhead heads (**63** cantilever with **19** new 6.2 m masts + **44** extensions; **31** span with
     **29** new 10 m masts + **31** extensions, including **1** traction-pole span), **2,008** ordinary signal poles,
     and **1,937** pedestrian heads. (The 2026-11-08 record had 167 approaches and 48 cantilever / 27 span heads.)
2. **Tram swept envelope**:
   - **Tracks**: all **669** `GEO.rail` chains with `kind: 'tram'` (`js/tram-infra.js:105` `loadTracks`) and all **846**
     directed edges in `buildTrackGraph(GEO.rail)` (`js/trams.js:212`).
   - **Body cross-section & heights** (`js/actor-models.js` & `js/trams.js`):
     - `TRAM_HALF_WIDTH = 1.2` m (`js/trams.js:45`; `TRAM_PROFILE` max `|x| = 1.2` m, `y ∈ [0.3, 3.18]` m, `js/actor-models.js:3480-3481`).
     - Roof equipment fairing: top `3.37` m (`TRAM_ROOF + 0.12 + 0.07`, `js/actor-models.js:3542`).
     - Cab mirror/camera arms: `|x| = 1.425` m (`1.4 ± 0.025` m) at `y = 2.5 ± 0.065` m (`js/actor-models.js:3549-3552`).
     - Pantograph collector strip: `TRAM_PANTOGRAPH_HEAD = 5.77` m (`js/actor-models.js:3485`), `0.05` m thick → top **`5.795` m**,
       width `1.3` m with horns to `±0.93` m (`js/actor-models.js:3520-3523`).
   - **Curve overhang** (`js/trams.js:102-143`, `858-882`):
     - `TRAM_MODELS` defines 8 unique section lengths: `4.3, 4.4, 5.6, 5.8, 7.6, 8.2, 8.25, 11.8` m (`gamma` 3 sections,
       `tramino` 5, `combino` 5).
     - `poseSections` poses each section on the **chord** between its front and rear ends on the track (`uf` and `uf - len`),
       not pivoted on internal bogies (`bogies` in `TRAM_MODELS` are visual skirt frames only, `js/actor-models.js:3543`).
     - On a curve of radius $R$, a chord of length $L$ shifts inward by the versine $R - \sqrt{R^2 - (L/2)^2} \approx L^2/(8R)$,
       sweeping inward up to `0.84` m past `TRAM_HALF_WIDTH` on tight curves in the dataset. The audit samples all 8 section
       lengths at `0.5` m stations along every edge and across switches (`434,413` curved section rectangles) plus all
       straight track segments (`TRAM_HALF_WIDTH = 1.2` m).
   - **Tram catenary** (`js/tram-infra.js:30-31`, `1718-1744`): contact wire `WIRE_Y = 5.8` m, span wires at
     `SPAN_Y + 0.15 = 6.75` m, cantilever arms at `6.6` m (stay top `7.5` m), poles `h = 7.6` m.
3. **Signal items & sag** (`js/street-details.js:307-315, 615-697`):
   - Ordinary poles (`h = 4.2` m, `r = 0.055` m), ordinary S-1 heads (`S1_Y = 3.55` m, `0.18` m facing offset, `0.30` m
     or `0.54` m backplate width), pedestrian heads (`PED_Y = 2.45` m, `0.17` m offset), cantilever masts (`h = 6.2` m,
     `r = 0.08` m), cantilever arms (`y = 5.55` m, `r = 0.045` m), cantilever & span S-1 heads (`OVERHEAD_Y = 5.3` m),
     span masts (`h = 10` m, `r = 0.08` m), and span stays (`topY = 10` m ordinary, `7.2` m Górna Wilda traction span,
     `r = 0.018` m).
   - `addSpanWires` (`js/street-details.js:682-687`) draws straight rods with **0 sag**.

## Results

### Lateral clearance from the tram swept envelope

| kind | count | min lateral clearance (m) | clashes | mirror-arm range (`≤ 0.225 m` at `y ≈ 2.5 m`) |
|---|---:|---:|---:|---:|
| Ordinary signal poles (`4.2 m`) | 2,008 | **0.8730** | 0 | 0 |
| Ordinary S-1 heads (`3.55 m`) | 1,197 | **0.5995** | 0 | 0 |
| Pedestrian heads (`2.45 m`) | 1,937 | **0.6637** | 0 | 0 |
| Cantilever masts (`6.2 m`) | 19 | **7.8022** | 0 | 0 |
| Cantilever arms (`5.55 m`) | 63 | **0.8805** | 0 | — |
| Cantilever S-1 heads (`5.3 m`) | 63 | **0.5083** | 0 | — |
| Span masts (`10 m`) | 29 | **1.2834** | 0 | 0 |
| Span S-1 heads (`5.3 m`) | 31 | **0.7750** | 0 | — |

### Vertical clearance where stays, arms, or heads cross a track

- **Cantilever arms (`y = 5.55` m) crossing swept envelope:** **0** (all stay horizontally ≥ `0.8805` m clear).
- **S-1 heads (`y = 5.3` m / `3.55` m) crossing swept envelope:** **0** (all stay horizontally ≥ `0.5083` m clear).
- **Span stays crossing a tram track / swept envelope:** **23** stays (all **0** sag, bottom at `topY - 0.018` m):
  - **Stays below `5.8 m` contact wire:** **0**.
  - **Min vertical clearance above tram roof (`3.18` m):** **4.002 m** (Górna Wilda, `topY = 7.2` m; ordinary spans: `6.802` m).
  - **Min vertical clearance above pantograph collector top (`5.795` m):** **1.387 m** (Górna Wilda; ordinary spans: `4.187` m).
  - **Min vertical clearance above contact wire (`5.80` m):** **1.382 m** (Górna Wilda; ordinary spans: `4.182` m).
  - **Min vertical clearance above tram span wire (`6.75` m):** **0.432 m** (Górna Wilda, 3D distance `0.450` m; ordinary spans: `3.232` m).

### Worst 10 per kind (coordinates in world metres)

**Ordinary signal poles (min 0.8730 m):**
1. `0.8730 m` at `(-1275.64, -577.39)` (trackDist `2.2408 m`, curveOverhang `0.1678 m`)
2. `0.9436 m` at `(-1206.96, 635.64)` (trackDist `2.8648 m`, curveOverhang `0.7212 m`)
3. `1.0309 m` at `(259.83, -245.60)` (trackDist `2.4265 m`, curveOverhang `0.1956 m`)
4. `1.0541 m` at `(70.62, 861.37)` (trackDist `2.2541 m`, curveOverhang `0 m`)
5. `1.1243 m` at `(887.62, -2148.91)` (trackDist `2.6627 m`, curveOverhang `0.3384 m`)
6. `1.2500 m` at `(2639.47, 2595.13)` (trackDist `2.4754 m`, curveOverhang `0.0254 m`)
7. `1.3654 m` at `(-6384.02, 2584.50)` (trackDist `2.8067 m`, curveOverhang `0.2412 m`)
8. `1.3850 m` at `(-1129.41, 158.04)` (trackDist `3.1181 m`, curveOverhang `0.5330 m`)
9. `1.4178 m` at `(1988.05, -28.64)` (trackDist `2.6178 m`, curveOverhang `0 m`)
10. `1.4449 m` at `(2475.90, 2704.56)` (trackDist `2.6449 m`, curveOverhang `0 m`)

**Cantilever masts 6.2 m (min 7.8022 m):**
1. `7.8022 m` at `(-3237.09, 1720.53)` (trackDist `9.8109 m`, curveOverhang `0.8087 m`)
2. `9.7844 m` at `(3172.49, -96.77)` (trackDist `11.1438 m`, curveOverhang `0.1594 m`)
3. `10.9621 m` at `(1242.69, 1000.64)` (trackDist `12.8037 m`, curveOverhang `0.6416 m`)
4. `12.4085 m` at `(-2427.60, 2195.43)` (trackDist `13.6085 m`)
5. `13.2673 m` at `(895.99, 1981.97)` (trackDist `14.4673 m`)
6. `13.8634 m` at `(894.75, 1984.15)` (trackDist `15.0634 m`)
7. `14.0910 m` at `(91.46, 1068.63)` (trackDist `15.2910 m`)
8. `15.8564 m` at `(-3216.03, 1667.40)` (trackDist `17.0564 m`)
9. `16.2954 m` at `(-2825.55, 599.73)` (trackDist `17.4954 m`)
10. `16.3255 m` at `(-1167.72, 682.32)` (trackDist `17.5255 m`)

**Cantilever arms (min 0.8805 m):**
1. `0.8805 m` at `(-3242.02, 1727.00)` (trackDist `2.6037 m`, curveOverhang `0.4782 m`)
2. `1.6335 m` at `(-3243.32, 1721.11)` (trackDist `3.7155 m`, curveOverhang `0.8370 m`)
3. `2.1709 m` at `(3032.68, 2200.61)` (trackDist `3.5347 m`, curveOverhang `0.1188 m`)
4. `2.6681 m` at `(1248.97, 1007.56)` (trackDist `4.7035 m`, curveOverhang `0.7903 m`)
5. `4.3751 m` at `(86.81, 1057.88)` (trackDist `5.6201 m`)
6. `4.8060 m` at `(-3097.93, -119.95)` (trackDist `6.0510 m`)
7. `4.9291 m` at `(-1549.80, 552.58)` (trackDist `6.1741 m`)
8. `5.2375 m` at `(-5656.16, 2178.64)` (trackDist `6.4825 m`)
9. `5.4124 m` at `(902.78, 1986.65)` (trackDist `6.6574 m`)
10. `5.5672 m` at `(-4866.33, 1447.56)` (trackDist `6.8122 m`)

**Cantilever S-1 heads (min 0.5083 m):**
1. `0.5083 m` at `(-3242.08, 1727.17)` (trackDist `2.1598 m`, curveOverhang `0.4515 m`)
2. `1.4868 m` at `(-3243.17, 1721.20)` (trackDist `3.5235 m`, curveOverhang `0.8367 m`)
3. `1.7495 m` at `(3032.83, 2200.71)` (trackDist `3.0655 m`, curveOverhang `0.1160 m`)
4. `2.5214 m` at `(1249.04, 1007.39)` (trackDist `4.5178 m`, curveOverhang `0.7964 m`)
5. `3.9538 m` at `(86.92, 1057.74)` (trackDist `5.1538 m`)
6. `4.3949 m` at `(-3097.76, -119.91)` (trackDist `5.5949 m`)
7. `4.4999 m` at `(-1549.63, 552.56)` (trackDist `5.6999 m`)
8. `4.9885 m` at `(902.96, 1986.66)` (trackDist `6.1885 m`)
9. `5.1473 m` at `(-5656.27, 2178.49)` (trackDist `6.3473 m`)
10. `5.4676 m` at `(-4866.42, 1447.40)` (trackDist `6.6676 m`, backplate)

**Span masts 10 m (min 1.2834 m):**
1. `1.2834 m` at `(-1197.49, 625.91)` (trackDist `3.1407 m`, curveOverhang `0.6574 m`)
2. `3.7169 m` at `(-1016.88, -804.99)` (trackDist `4.9169 m`)
3. `8.5314 m` at `(-699.21, -1390.82)` (trackDist `9.7314 m`)
4. `8.6193 m` at `(-1202.15, 600.33)` (trackDist `9.8249 m`, curveOverhang `0.0055 m`)
5. `9.5294 m` at `(-2735.42, 2061.52)` (trackDist `11.4625 m`, curveOverhang `0.7331 m`)
6. `9.8652 m` at `(-1203.24, 603.50)` (trackDist `11.1134 m`, curveOverhang `0.0482 m`)
7. `10.2750 m` at `(-2701.69, 2078.25)` (trackDist `12.0354 m`, curveOverhang `0.5604 m`)
8. `10.9380 m` at `(-1709.36, -1417.34)` (trackDist `12.1380 m`)
9. `11.5204 m` at `(-1517.82, 258.75)` (trackDist `13.1423 m`, curveOverhang `0.4218 m`)
10. `11.7594 m` at `(-2699.05, 2079.69)` (trackDist `13.6729 m`, curveOverhang `0.7135 m`)

**Span S-1 heads (min 0.7750 m):**
1. `0.7750 m` at `(-1177.07, 645.13)` (trackDist `2.4650 m`, curveOverhang `0.4900 m`)
2. `0.8266 m` at `(-2704.11, 2064.03)` (trackDist `2.0266 m`)
3. `0.8747 m` at `(-1496.66, 250.85)` (trackDist `2.2507 m`, curveOverhang `0.1759 m`)
4. `0.9062 m` at `(-2722.23, 2056.60)` (trackDist `2.1062 m`)
5. `1.3340 m` at `(-460.17, 982.68)` (trackDist `2.5340 m`, **Górna Wilda traction-pole span**)
6. `1.4326 m` at `(-2084.26, 2402.45)` (trackDist `2.6334 m`, curveOverhang `0.0008 m`)
7. `1.7013 m` at `(-3014.54, -438.10)` (trackDist `2.9013 m`)
8. `1.7367 m` at `(-5422.19, 2022.97)` (trackDist `2.9367 m`)
9. `2.2229 m` at `(160.61, -2454.04)` (trackDist `3.4229 m`)
10. `2.3999 m` at `(-1040.28, -809.49)` (trackDist `4.1698 m`, curveOverhang `0.5698 m`)

**Worst 10 span stays crossing tracks (by clearance above `5.8 m` contact wire):**
1. `(-461.88, 980.28)` — Górna Wilda traction stay (`topY = 7.2 m`): `+1.382 m` above contact wire, `+1.387 m` above pantograph top, `+4.002 m` above roof, `+0.432 m` above tram span wire (`0.450 m` 3D).
2. `(-1503.15, 253.14)` — ordinary stay (`topY = 10 m`): `+4.182 m` above contact wire, `+4.187 m` above panto, `+6.802 m` above roof, `+3.232 m` above tram span wire (`3.250 m` 3D).
3. `(-1035.77, -808.73)` — ordinary stay (`topY = 10 m`): `+4.182 m` above contact wire, `+3.250 m` 3D to tram span.
4. `(-463.54, 945.12)` — ordinary stay (`topY = 10 m`): `+4.182 m` above contact wire, `+3.250 m` 3D to tram span.
5. `(-469.12, 948.08)` — ordinary stay (`topY = 10 m`): `+4.182 m` above contact wire, `+3.250 m` 3D to tram span.
6. `(-711.84, -1378.81)` — ordinary stay (`topY = 10 m`): `+4.182 m` above contact wire, `+3.250 m` 3D to tram span.
7. `(-1721.29, -1406.08)` — ordinary stay (`topY = 10 m`): `+4.182 m` above contact wire, `+3.250 m` 3D to tram span.
8. `(-1195.11, 628.16)` — ordinary stay (`topY = 10 m`): `+4.182 m` above contact wire, `+3.250 m` 3D to tram span.
9. `(-1183.09, 658.45)` — ordinary stay (`topY = 10 m`): `+4.182 m` above contact wire, `+3.327 m` 3D to tram span.
10. `(-2703.26, 2066.30)` — ordinary stay (`topY = 10 m`): `+4.182 m` above contact wire, `+3.360 m` 3D to tram span.

## Rerun

```sh
node tools/audit-signal-tram-clearance.mjs
```
