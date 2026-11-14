# Stop-line fallback overhead signal sightlines — 2026-11-14

Geometric line-of-sight audit of every stop-line fallback overhead signal head (`!h.band`, where `findOverhead` or `findSpan` in `js/street-details.js` falls back to the support's longitudinal position instead of the `-8` / `-10.5 m` visibility band).

## Count and scope

- **Current fallback count: 8** (7 cantilever, 1 span) out of 94 total overhead heads (63 cantilever, 31 span).
- The backlog's earlier figure of 15 (13 at `+1.75 m`, two reused poles at `0.03` and `-0.82 m`) predates the 2026-11-08 span-wire fallback pass ([`missing-signal-heads-2026-11-08.md`](missing-signal-heads-2026-11-08.md)), which replaced part of that set with `-8` / `-10.5 m` span heads and brought the stop-line fallback count down to 8 (`overheadException: 7`, `spanException: 1`).
- **Rerun command:** `node tools/audit-fallback-head-sight.mjs` (reuses the headless world build from `tools/audit-signal-heads.mjs`; omits building, landmark and bridge colliders, matching the signal audit fixture).

## Code sources for every geometric parameter

| Parameter | Value | Source |
|---|---|---|
| Overhead head centre height (`OVERHEAD_Y`) | `5.30 m` | `js/street-details.js:622` |
| S-1 lamp pitch (`S1_PITCH`), lens radius (`S1_R`) | `0.27 m`, `0.10 m` | `js/street-details.js:304-305` |
| Lamp centre heights (bottom / mid / top red) | `5.03 / 5.30 / 5.57 m` | `js/street-details.js:306, 622` |
| Stop-line clearance (`stopAt` `s0`) | `1.00 m` before edge end (`e.len`) | `js/traffic.js:926` |
| Stopped car following gap (`CAR_DRIVER.s0`) | `2.00 m` bumper-to-bumper | `js/traffic.js:60, 920-923` |
| Stopped bus following gap (`BUS_DRIVER.s0`) | `2.50 m` bumper-to-bumper | `js/traffic.js:61` |
| Saloon / player taxi (`BODY_SPECS.saloon` / `taxi`) | `L = 4.60 m` (`zFront = 2.30`), `roof = 1.435 m`, `halfWidth = 0.889 m` | `js/actor-models.js:238-259, 532, 541-547`; `js/controllers.js:637` |
| Crossover (`BODY_SPECS.crossover`, tallest common car) | `L = 4.46 m` (`zFront = 2.23`), `roof = 1.665 m`, `halfWidth = 0.925 m` | `js/actor-models.js:380-401, 541-547` |
| Standard bus (`BUS_SPEC`) | `L = 12.00 m` (`zFront = 6.00`), `roof = 3.005 m` (`2.96 + 0.045`), `halfWidth = 1.275 m` | `js/actor-models.js:2394-2410` |
| Articulated bus (`BUS_18_SPEC`) | `L = 18.00 m` (`halfL = 9.00`), `roof = 3.005 m`, `halfWidth = 1.275 m` | `js/actor-models.js:2721-2722`; `js/traffic.js:529` |
| Player POV camera (`pov`, `entity.type === 'car'`) | `fwdOffset = 0.55 m` (`1.75 m` back from `zFront`), `eyeY = 1.52 m` (above `1.435 m` taxi roof → no own-roof cutoff) | `js/cameras.js:287-289` |
| Seated saloon driver (sensitivity check) | `z = -0.20 m` (`2.50 m` back from `zFront`, ahead of B-pillar `-0.28`), `eyeY = 1.15 m`; windscreen top `roofFront = 0.02 m` (`0.22 m` ahead), `cabinTop(|x|=0.35) = 1.412 m` → `50.0°` cutoff | `js/actor-models.js:256-266, 690-695` |

A head is counted **visible** when the 3-D segment from the driver's eye `(sEye, eyeY, lEye)` to the top (red) lamp centre `(headAlong, 5.57 m, headLat)` clears every queued vehicle's `[sRear, sFront] × [0, roof] × [laneLat - halfWidth, laneLat + halfWidth]` box and does not exceed the eye model's own-roof pitch cutoff.

## The 8 fallback heads

| # | Kind | Existing support | Head `(x, z)` | Junction `(x, z)` | Along P-14 | Lateral (over lane) | Lanes | Edge len |
|---:|---|---|---:|---:|---:|---:|---:|---:|
| 1 | cantilever | yes | `(-3242.015, 1727.004)` | `(-3242.70, 1723.60)` | `+1.750 m` | `+1.800 m` (lane 1 @ `+1.80 m`) | 2 (`-1.80, +1.80`) | `10.00 m` |
| 2 | span | no | `(-2722.295, 2056.763)` | `(-2714.32, 2066.08)` | `+1.750 m` | `+3.550 m` (lane 1 @ `+5.05 m`) | 2 (`+1.45, +5.05`) | `10.00 m` |
| 3 | cantilever | yes | `(3032.680, 2200.610)` | `(3028.60, 2200.10)` | `+1.750 m` | `+1.800 m` (lane 0 @ `+1.80 m`) | 1 (`+1.80`) | `10.00 m` |
| 4 | cantilever | yes | `(-3097.934, -119.952)` | `(-3102.80, -121.75)` | `+1.750 m` | `+1.625 m` (lane 0 @ `+1.63 m`) | 1 (`+1.63`) | `10.00 m` |
| 5 | cantilever | yes | `(2529.623, 2694.580)` | `(2536.10, 2684.00)` | `+0.031 m` | `0.000 m` (lane 0 @ `0.00 m`) | 1 (`0.00`) | `10.00 m` |
| 6 | cantilever | no | `(902.777, 1986.645)` | `(898.30, 1987.80)` | `+1.750 m` | `+1.625 m` (lane 0 @ `+1.63 m`) | 1 (`+1.63`) | `10.00 m` |
| 7 | cantilever | no | `(86.808, 1057.877)` | `(84.80, 1062.80)` | `+1.750 m` | `+1.625 m` (lane 0 @ `+1.63 m`) | 1 (`+1.63`) | `10.00 m` |
| 8 | cantilever | yes | `(2196.765, -2125.543)` | `(2195.90, -2127.20)` | `+1.750 m` | `+1.800 m` (lane 0 @ `+1.80 m`) | 1 (`+1.80`) | `8.08 m` |

## Cross-check against 2026-11-14 browser screenshots

In [`browser-checks-2026-11-14.md`](browser-checks-2026-11-14.md#5-overhead-signal-heads--partial), heads #1 (`-3242.0, 1727.0`) and #2 (`-2722.3, 2056.8`, Głogowska/Hetmańska) were verified visible from `1.5 m` eye height `20 m` back over a car. Our 3-D ray check at `sEye = headAlong - 20 m`, `eyeY = 1.50 m` over a `crossover` (`1.665 m` roof) at position 1 reports **VISIBLE** for both.

## Visibility table (positions 1–6, every lane)

In all 8 heads and every lane, **positions 2–6 over a queue of cars (`crossover` 1.665 m)** are **visible** under both `pov` and `seated` eye models (elevation `6°–24°`), and **positions 2–6 directly behind a `12 m` or `18 m` bus (`3.005 m` roof)** in the same lane are **blocked** by that bus's roof (`bus12@pos(k-1)` / `bus18@pos(k-1)`).

| # | Lane | `pov` pos 1 (`eyeY=1.52`) | `seated` pos 1 (`50.0°` cutoff) | `pov` / `seated` pos 2–6 (cars) | `pov` / `seated` pos 2–6 (`bus12` / `bus18` in front) |
|---:|---|---|---|---|---|
| 1 | 0 (adj) | **OK** (`35°`) | **OK** (`35°`) | **OK** (`6°–20°`) | **blocked** by `bus12`/`bus18` at `pos-1` |
| 1 | 1 (under) | **OK** (`42°`) | **OK** (`40°`) | **OK** (`6°–21°`) | **blocked** by `bus12`/`bus18` at `pos-1` |
| 2 | 0 (adj) | **OK** (`39°`) | **OK** (`38°`) | **OK** (`6°–20°`) | **blocked** by `bus12`/`bus18` at `pos-1` |
| 2 | 1 (under) | **OK** (`40°`) | **OK** (`39°`) | **OK** (`6°–21°`) | **blocked** by `bus12`/`bus18` at `pos-1` |
| 3 | 0 (under) | **OK** (`42°`) | **OK** (`40°`) | **OK** (`6°–21°`) | **blocked** by `bus12`/`bus18` at `pos-1` |
| 4 | 0 (under) | **OK** (`42°`) | **OK** (`40°`) | **OK** (`6°–21°`) | **blocked** by `bus12`/`bus18` at `pos-1` |
| 5 | 0 (under) | **OK** (`56°`) | **blocked** (`51.4° > 50.0°`, own-roof) | **OK** (`7°–24°`) | **blocked** by `bus12`/`bus18` at `pos-1` |
| 6 | 0 (under) | **OK** (`42°`) | **OK** (`40°`) | **OK** (`6°–21°`) | **blocked** by `bus12`/`bus18` at `pos-1` |
| 7 | 0 (under) | **OK** (`42°`) | **OK** (`40°`) | **OK** (`6°–21°`) | **blocked** by `bus12`/`bus18` at `pos-1` |
| 8 | 0 (under) | **OK** (`42°`) | **OK** (`40°`) | **OK** (`6°–21°`) | **blocked** by `bus12`/`bus18` at `pos-1` |

## Conclusion

- Under the game's actual first-person car camera (`js/cameras.js:288-289`, `eyeY = 1.52 m`), **all 8** stop-line fallback heads are **visible** at position 1 and through a full 6-car queue (`crossover` `1.665 m` roof).
- Under a seated saloon driver (`50.0°` own-roof cutoff), 7 of 8 pass at position 1 and only **head #5** `(2529.623, 2694.580)` at `along = +0.031 m` exceeds `50.0°` (`51.4°`). Moving any head *back* (`along < 0`) would place it behind position 1 (`sEye = -2.75 m` / `-3.50 m`), making position 1 worse rather than better.
- Behind a `3.005 m` bus directly in front in the same lane, a `5.30 m` stop-line signal is geometrically occluded at positions 2–6 (even a `-10.5 m` strict-band head is occluded behind a `12 m` bus at pos 3+ or an `18 m` bus at pos 2+).
- **No game code was changed.** Remaining work is limited to optional browser visual confirmation of the remaining 6 fallback heads (`#3`–`#8`).
