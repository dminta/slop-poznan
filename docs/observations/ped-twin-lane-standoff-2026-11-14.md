# Twin-lane U-turn stand-off follow-up, 2026-11-14

Investigated on `agy-ped-twin` (`3b6ec32`). Every tested candidate in `js/traffic.js` either shifted a cluster, raised overlapping pairs/s or raised Centrum `--ped-rooms` freeze seconds, so **no game code is changed** and the working tree keeps the baseline.

## Baseline (`3b6ec32`)

```
node tools/audit-ped-overlaps.mjs --minutes 3 --seeds 4242,77
node tools/bench-traffic.mjs --ped-rooms --minutes 3 --seed 4242
```

- **Overlap audit (8 districts, 3 min, seeds 4242 & 77):** **3 clusters** (longest **14 s**, biggest **5**, all in Centrum at Stanisława Taczaka `(-785.4, 336.2)` / `(-788.4, 335.4)`), **5.82** mean overlapping pairs/s, **107.5** mean crosswalk entries/min, **5,440** spawns (**554** within 0.5 m of a body).
  - Centrum + Poznań Główny screen (4 runs): mean **11.10** pairs/s, **90.4** entries/min.
  - Named stand-offs: Most Dworcowy / Głogowska `(-1558.44, 575.12)` 20 s and `(-1558.26, 574.65)` 18 s (seed 4242), `(-1557.88, 575.14)` 19 s (seed 77); Wolne Tory / Rondo Szczęśliwej Podróży `(-1277.54, 720.88)` and `(-1277.47, 720.98)` 20 s (seed 77); Bałtyk `(-1487.46, 234.63)` 20 s (Kaponiera 4242); Święty Marcin `(-710.72, 238.75)` 19 s (Centrum 4242).
- **`--ped-rooms` (7 districts, 3 min, seed 4242):** **25,811 ped-s** of **367,553** sampled (longest **20.1 s**): Jeżyce **902** / 53,312 (longest 17.9 s `entrance`), Łazarz **1,151** / 52,777 (20.1 s `queue`), Centrum **16,608** / 53,287 (20.1 s `queue`; `queue` 77%, `entrance` 20%, `curbQueue` 2%), Rondo Kaponiera **1,739** / 52,037 (20.1 s `entrance`), Stare Miasto **510** / 53,626 (19.9 s `entrance`), Rataje **1,471** / 52,382 (20.1 s `curbQueue`), Wilda **3,430** / 50,132 (20.1 s `merge`).

## Per-second trace (`dworzec`, seed 4242, `t = 118..133 s`)

At Most Dworcowy / Głogowska `(-1558.4, 575.1)` four walkers lock each other at `entrance` (`v = 0.00`, `cause = entrance`) until `PED_STUCK_TIME` (20 s) re-places them:

1. `#120` at `(-1558.26, 574.65)` on the `1.10 m` U-turn `(-1558.52, 575.07) -> (-1558.16, 574.03)` (`t = 0.48/1.10`, `dir = 1`, `lane = 0.11`) wants the southern `4.78 m` sidewalk: blocked by `#105` (`0.34 m < QUEUE_GAP` 0.62 m from `enterX, enterZ`).
2. `#105` at `(-1557.84, 574.14)` on the southern `4.78 m` sidewalk (`t = 0.34/4.78`, `dir = -1`, `lane = 0.00`) wants the reversed `1.10 m` U-turn: blocked by `onNext >= capacity` (`capacity = 2`) because `routeKey` is `corner:-15540,5766|-15585,5751`, which also counts `#36`, `#191`, `#21` queued on the `4.49 m` northern approach link.
3. `#295` at `(-1558.11, 575.11)` on the northern `4.78 m` sidewalk (`t = 0.40/4.78`, `dir = -1`, `lane = -0.09`) wants `#120`'s `1.10 m` U-turn: blocked by `#120` (`0.48 m < QUEUE_GAP`).
4. `#36` at `(-1558.48, 575.17)` on the `4.49 m` approach link (`t = 4.39/4.49`, `dir = 1`, `lane = 0.02`) wants the northern `4.78 m` sidewalk: blocked by `#295` (`0.41 m < QUEUE_GAP`).

Neither yields because `entrance` blocks on any stopped body within `QUEUE_GAP` regardless of direction, `onNext` counts all corner links sharing `corner:<line>` instead of the target segment, and `PED_LANE_RAMP` (1.5 m) fades `lane` to `0` at track ends so `#120` and `#295` sit `0.48 m` apart (`< 0.50 m`). The same `corner:<line>` `onNext` sharing also locks the Centrum `(-785.4, 336.2)` Taczaka / Pasaż Różowy 13-ped pocket (`t = 60..65 s`), where both `1.10 m` U-turns between `way:88:-1:1.7` and `way:88:-1:2.8` (`1.87 m`, `3/3` full) are empty yet reported `onNext >= 2` from walkers on `3.4–12.6 m` approach links.

## Candidates tried and rejected

All runs are 3 min, seeds `4242,77` unless noted.

| Candidate | Scope | Clusters (longest / biggest) | pairs/s | entries/min | Notes / rejection |
|---|---|---|---|---|---|
| Baseline (`3b6ec32`) | full 8 districts | 3 (14 s / 5) | 5.82 | 107.5 | Centrum `--ped-rooms` 16,608; 7-district 25,811 |
| Baseline (`3b6ec32`) | `centrum,dworzec` | 3 (14 s / 5) | 11.10 | 90.4 | Most Dworcowy 20/18/19 s, Wolne Tory 20 s |
| Segment-exact `onNext` (`sameSeg`) on all links | `centrum,dworzec` | 9 (19 s / 7) | 14.68 | 87.4 | Dworzec 8.0 / 9.0, but 6–7 peds pack converging `4.5–5.6 m` links in Centrum |
| `sameSeg` on `< 2 m` links + `stuck > 1` oncoming-exit swap | `centrum,dworzec` | 4 (21 s / 6) | 12.52 | 87.2 | New `6 s` cluster at `(-1582.7, 562.6)` in Dworzec 77; pushes into full pockets |
| `sameSeg` on `< 2 m` links + exit-only swap (`p.len < 2 && nt.len >= 2`) | `centrum,dworzec` | 3 (21 s / 6) | 12.45 | 87.2 | Same `(-1582.7, 562.6)` cluster; `sameSeg` on `1.4 m` links still over-admits |
| Exit-only swap (`p.len < 2 && nt.len >= 2`, `stuck > 1`) alone | `centrum,dworzec` | 3 (14 s / 5) | 10.98 | 90.6 | Dworzec 4242 `8.6 -> 8.1` (`18 s` gone), Centrum & Wolne Tory `20 s` unchanged |
| Short-link box guard (`nt.len < 2 * QUEUE_GAP` checks `legBlocked(next + 1)` incl. `on >= cap`) | full 8 districts | **1** (8 s / 4) | **5.24** | 106.3 | Clears all 3 Centrum clusters, Dworzec 4242 `20 s` & Wolne Tory `20 s`; adds Wilda `8 s` cluster at `(-76.3, 1759.6)`, Stare Miasto `20 s` pairs, and Centrum `--ped-rooms` **16,608 → 17,051** (+443) |
| Short-link box guard without `on >= cap` on `next + 1` + exit swap | `centrum,dworzec` | 2 (16 s / 4) | 9.23 | 88.8 | Dropping `on >= cap` lets walkers enter `1.1 m` links into full `1.87 m` `way:88` pockets |
| Short-link box guard (with `on >= cap`) + exit swap (`p.len < 2 * QUEUE_GAP && nt.len >= 2`) | `centrum,dworzec,wilda` | 1 (8 s / 4) | 7.92 | 96.6 | Same Wilda `8 s` cluster; Dworzec 4242 `0.6/1.1 \| 0.6/1.1` 19 s pair returns |
