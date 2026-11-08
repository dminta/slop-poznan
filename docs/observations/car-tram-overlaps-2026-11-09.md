# Moving-tram gate at short links (2026-11-09)

The [2026-11-08 short-link record](car-tram-overlaps-2026-11-08.md) was measured before later world changes (the west
detail box, OSM building recovery and street trees), which shift the seeded spawn and route order. Re-measured on the
current tree, the same default seed-4242 audit starts at **16 pairs** (Jeżyce 10, Kaponiera 5, Stare Miasto 1) and the
eight seeds at **77** (moving 55, stopped 22). Kaponiera's remaining cluster is again the short-link curve knot at
(−1383…−1387, −216).

### Change

The tram-side road gate in `drive()` ran only while the tram was stopped or already gated. A tram that was still rolling
swept only for bodies already in its path, so a car committed to a conflict could cross into the path after the sweep
found it clear. The gate now runs every frame and counts a car already committed to the conflict:

- `entering`: committed on the approach lane and taking the conflicting move;
- `tail`: a vehicle whose rear is still on the connector over the conflict;
- `unable`: on a short link, with `speed² > 2b(len − s − half)`;
- `arriving`: on a connector into a short link, with `speed² > 2b(connector remaining + link − half)`.

Only committed cars count; a car that can still stop before the link does not hold the tram. The stopped/restarting
gate keeps its earlier behaviour and exemptions, and `ROAD_GATE_REACH` stays 8 m.

### Results

Default seed 4242, five minutes, 15 fps:

| District | Pairs base → final | Remaining |
|---|---:|---|
| Jeżyce | 10 → 5 | stopped shared-lane touches, no moving entry |
| Kaponiera | 5 → 1 | 22:1 at (−1386, −217), 15 pair-frames |
| Stare Miasto | 1 → 0 | — |
| Centrum | 0 → 0 | — |
| **Total** | **16 → 6** | |

Eight seeds (1, 4242, 7, 99, 2, 3, 5, 11), five minutes, 15 fps, all seven districts:

| District | Base | Final | Moving base → final | Stopped base → final |
|---|---:|---:|---:|---:|
| Jeżyce | 39 | 35 | 25 → 23 | 14 → 12 |
| Kaponiera | 11 | 8 | 10 → 6 | 1 → 2 |
| Centrum | 10 | 7 | 6 → 5 | 4 → 2 |
| Stare Miasto | 17 | 4 | 14 → 3 | 3 → 1 |
| **Total** | **77** | **54** | **55 → 37** | **22 → 17** |

Benchmark, default seed 4242:

| Scope | Metric | Base | Final |
|---|---|---:|---:|
| All districts | mean km/h | 14.8 | 15.4 |
| All districts | stopped | 35.1 % | 33.5 % |
| All districts | worst wait | 88 s | 112 s |
| All districts | held > 120 s | 0 | 0 |
| All districts | deadlocks | 1 | 0 |
| Kaponiera | mean km/h | 12.5 | 13.7 |
| Kaponiera | stopped | 50.7 % | 47.1 % |
| Kaponiera | worst wait | 88 s | 112 s |

The worst wait rises but stays under the 120 s bound; the deadlock and the district means improve.

### Rejected variants

- **Unheld-curve arrival forecast at the short-link entry** (compare the rolling tram's time to the conflict with the
  car's link, exit and body). The eight-seed total stayed 54, but the pairs moved (Jeżyce 38 → 35, Centrum 4 → 7) and
  the default Jeżyce count fell 9 → 5 only because the rest of the run changed. Not kept.
- **1.5 m gate standoff** instead of 0.5 m before a road conflict. It removed one seed-1 Kaponiera graze but raised the
  eight-seed total to 60 (Centrum 4 → 10), so the 0.5 m standoff stays.
- **Projected entry speed in `canStandOn`** (accelerate along the connector before judging the link). Kaponiera ended
  at 3 pairs, Centrum gained one, the mean fell 12.5 → 11.3 km/h and switch waits rose 8.5 → 40.9 s. Not kept.
- **The old `enter` hard stop for a car refused by the guard.** Alone it did not change the default audit; the moving
  gate removes the entry race without snapping a car to zero.

### What remains

- The default Kaponiera 22:1 contact is a 15-pair-frame side graze at the same curve after the car was already on its
  connector. By the time its braking distance exceeds the remaining link the tram's front is past the conflict's near
  edge, so neither the car-side entry guard nor the tram gate can stop the entry. It is 1 pair instead of 5, and the
  car-side race is gone.
- 54 contacts over eight seeds remain, dominated by stopped cars touching a stopped tram in a shared Jeżyce lane
  (35 pairs); lane geometry is unchanged.
- `tools/audit-tram-opposing-lanes.mjs` is unchanged: 42 runs / 40 lanes / 377 m.

No browser check was run. The visible change is a tram waiting a few seconds longer for a car already crossing its
conflict; the rendered tram/car spacing still needs a WebGPU and WebGL2 look.

