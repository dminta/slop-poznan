# Pedestrian overlap cluster re-check, 2026-11-10

The task named a 7 s / 5-body cluster at the Most Dworcowy short-link/curb knot (2026-11-08 baseline). On this tree
(`poznan` at 42329c3, after the 4d14df9 layout restore) that cluster does not occur: Poznań Główny has 0 clusters in
both seeds. The layout restore moved the knot: **10 clusters, longest 26 s, biggest 6**, all in Centrum at Pasaż
Różowy (about -786, 337), a pedestrian-only street.

## Method

```
node tools/audit-ped-overlaps.mjs --minutes 3 --seeds 4242,77
node tools/bench-traffic.mjs --ped-rooms
```

## Mechanism

Pasaż Różowy is a `way` (not a road edge) cut into four 1.87 m walking tracks (`way:88:±1:1.7|2.8`) joined by 1.1-5.6 m
corner links, plus 12.6 and 13.2 m connectors from the north. `pedestrianStreetTrack()` picked a route uniformly from
`nearWalks`, so each 1.87 m fragment was as likely a spawn as a 60 m street. The first frame put 24-33 bodies (all
"spawned at 0.1 s") into a 6 x 2 m pocket whose exits are 1.1 m links of capacity 2; the 20 s recovery then re-placed
them, only for the next spawns to land there again. The tracing script showed 31 bodies within 8 m, 14 stuck, 7 queued
on one 1.87 m track.

## Fix

`js/traffic.js` `pedestrianStreetTrack()`: the pick is weighted by track length (spawn density per metre becomes even).
Test: `tests/pedestrian-streets.test.cjs` (four 1.87 m stubs plus a 60 m street take 8-14 of 100 evenly spaced draws,
instead of 80).

## Before / after (seeds 4242 + 77, 3 min, 8 districts)

| Metric | before | after |
|---|---|---|
| clusters | 10 | 0 |
| longest cluster | 26 s | 0 |
| biggest | 6 | 0 |
| overlapping pairs/s (mean) | 5.74 | 5.43 |
| crosswalk entries/min (mean) | 104.1 | 105.3 |
| ped-rooms ped-s (7 districts) | 40,056 of ~645,700 | 40,271 of ~646,200 (+0.5%) |
| ped-rooms longest hold | 20.1 s | 20.1 s |

Per-district ped-rooms ped-s, before / after: Jeżyce 2,197 / 2,428, Łazarz 2,985 / 2,789, Centrum 22,111 / 22,550,
Kaponiera 3,008 / 3,008, Stare Miasto 1,027 / 768, Rataje 2,270 / 2,270, Wilda 6,458 / 6,458.

The ped-rooms total is not improved: Centrum alone holds 22k ped-s (24% of its samples), and the pocket still freezes
walkers that route into it (dead-end turnaround through capacity-2 links, `queue` 73-81%, `entrance`), only fewer are
dropped there at spawn. The +0.5% is within the reshuffle of seeded draws (Stare Miasto -26%, Jeżyce +10%). Removing the
freeze needs the pocket geometry or the corner-link capacity rules, not the spawn pick.

## Rejected

- Weighting the goal pick (`walk()` destination in `nearWalks`) by length as well: Centrum ped-rooms **22,111 → 24,189**
  ped-s and the longest hold moved to another corner-link pocket at (-708, 242). Reverted.
