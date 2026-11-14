# Taczaka / Pasaż Różowy pedestrian cluster regression, 2026-11-14

Bisected and fixed on `agy-taczaka` from `f08835b`.

## Bisect and root cause

- **Bisect (`5e6a68e..f08835b`):** `59ee496` (*Clip surfaces and height queries to the tram track corridors*) is the first commit where the Centrum overlap audit (`seeds 4242,77`, 3 min) produces the 3 clusters at Stanisława Taczaka `(-785.4, 336.2)` / `(-788.4, 335.4)` (longest `14 s`, biggest `5`).
- **Route-graph check (`15f9359` vs `59ee496`):** `5,337` crosswalks, `3,613` pedestrian-way tracks, `52` Centrum crosswalks, `830` Centrum sidewalk tracks, and all `8` tracks and corner links within `40 m` of `(-786, 336)` are identical. `59ee496` only made `blockAt` / `isBlockAt` return `null` inside `inTramSurfaceCut(x, z)`, shifting the seeded pedestrian sequence on Centrum tram corridors and putting 4–5 walkers simultaneously into an **already-existing latent pocket** (which already showed `13–20 s` overlapping pairs at `5e6a68e`).
- **Mechanism:** `way:88` (Pasaż Różowy, `w = 8 m`, `(-786.8, 335.8) -> (-787.3, 337.6)`) is a `1.87 m` dead-end stub whose four parallel tracks (`way:88:±1:1.7|2.8`) are joined by twelve `1.1–5.6 m` corner links (`corner:way:88:*`), with its only external connection to `way:159:-1:2.8` (`11.25 m`, `12.58–14.46 m` corner links). Walkers arriving from `way:159` or spawned on `way:88` hit the dead end and `next()` routes them across the `1.1–5.6 m` internal links toward north/west goals instead of back southeast to `way:159`. Because `1.87 m < 2 * PED_LANE_RAMP` (`3.0 m`), opposing flows cannot separate, and converging `1.1 / 3.4 / 4.5 / 12.6 m` links share `corner:way:88:*` `routeKey`s, stacking 4–5 bodies within `0.5 m` at `entrance` / `queue` for `10–14 s` until `PED_STUCK_TIME` (`20 s`) re-places them.

## Fix

In `js/pedestrian-routes.js` (`wayHasExit` + `next()`):

- Do not enter a dead-end pedestrian-way stub shorter than `3 m` (`2 * PED_LANE_RAMP`, where opposing lanes cannot separate) whose external links only return to the entry way (`!wayHasExit(target.edge, track.edge)`).
- If a walker spawns inside such a stub and an external link exists from its current track end, skip internal same-way links so it exits.
- Pinned by a unit test in `tests/pedestrian-streets.test.cjs`.

## Verification

- **Eight-district overlap audit (`node tools/audit-ped-overlaps.mjs --minutes 3 --seeds 4242,77`), `f08835b` → fix:**
  - Clusters: **3 → 0** (longest **14 s → 0 s**, biggest **5 → 0**).
  - Mean overlapping pairs/s: **5.82 → 6.02** (Centrum `13.25 → 14.90` from the `Math.random()` draw shift onto Święty Marcin; the other seven districts are unchanged).
  - Mean crosswalk entries/min: **107.5 → 106.7** (Centrum `87.9 → 82.0`, Stare Miasto `120.2 → 114.2`).
  - Spawns: **5,440 (554 within 0.5 m) → 5,440 (554 within 0.5 m)**.
- **`--ped-rooms` (`node tools/bench-traffic.mjs --ped-rooms --minutes 3 --seed 4242`), `f08835b` → fix:**
  - Total (7 districts): **25,811 / 367,553 → 23,791 / 367,682** (**-2,020 ped-s**).
  - Centrum: **16,608 / 53,287 → 14,588 / 53,416** (**-2,020 ped-s**, -12.2 %).
  - Jeżyce (`902`), Łazarz (`1,151`), Kaponiera (`1,739`), Stare Miasto (`510`), Rataje (`1,471`), Wilda (`3,430`) are bit-identical.
- **Car traffic flow (`node tools/bench-traffic.mjs --only jezyce,centrum --minutes 5 --seed <s >`, 8 seeds `1, 4242, 7, 99, 2, 3, 5, 11`), `f08835b` → fix:**
  - Jeżyce: **bit-identical** across all 8 seeds.
  - Centrum: `held > 120 s` **0 → 0** and `deadlocks` **0 → 0** across all 8 seeds; mean speed `14.25 → 14.34 km/h` (+0.09 km/h), stopped `33.91 → 33.69 %` (-0.22 %), `held > 60 s` `0 → 6` (longest `103 s` on seed 11, from the `Math.random()` draw shift).
- **Tests:** `node --test tests/` passes (623 / 623 after adding the new test — re-verified below).

## Coordinator check

`wayHasExit` is cached per (way, entry way) pair, since the route graph is fixed once built and `next()` runs on
every track change. Centrum audit rerun with the cache gives the same numbers (0 clusters, 14.9 pairs/s, 82 entries/min).
Full `node --test tests/` passes 623/623.
