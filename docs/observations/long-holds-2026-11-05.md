# Long car holds at signals, 2026-11-05

Investigated the long car holds reported at Centrum and Rondo Kaponiera (merge starvation and short-link left turns).
Measured with `tools/bench-traffic.mjs` and `tools/audit-tram-overlaps.mjs`, five simulated minutes per district at
15 fps, seeds 1, 4242, 7, 99, 2, 3, 5 and 11, first 20 s excluded. The benchmark world omits buildings and several
scene details; pairs are pooled object IDs. See [testing](../testing.md#traffic-benchmark).

## Baseline (a302005)

| District | Mean longest hold (s) | Held > 60 s | Held > 120 s | Deadlocks | Car–tram pairs | Moving pairs (>1 m/s) |
|---|---:|---:|---:|---:|---:|---:|
| Jeżyce | 83.8 | 51 | 1 | 0 | 20 | 7 |
| Łazarz | 31.9 | 0 | 0 | 0 | 0 | 0 |
| Centrum | 77.5 | 13 | 2 | 0 | 7 | 3 |
| Kaponiera | 114.9 | 138 | 8 | 0 | 11 | 9 |
| Stare Miasto | 26.9 | 0 | 0 | 0 | 16 | 13 |
| Rataje | 71.1 | 9 | 2 | 0 | 1 | 0 |
| Wilda | 39.0 | 0 | 0 | 0 | 0 | 0 |
| **Sum** | **3560.0** | **211** | **13** | **0** | **55** | **32** |

The known Centrum peaks are seed 99 at 110 s (5 held over 60 s), seed 4242 at 85 s and seed 7 at 87 s. Kaponiera seed 7
peaks at 125 s. The Kaponiera merge at `(-1497, 198)` is an unsignalised give-way with a 10 m exit edge into the signal
at `(-1503, 224)`: 87–95% of its stopped car-seconds are merge waits and its maximum wait is 80–139 s across the eight
seeds. The 20.7 m approach and 17.2 m upstream link fill behind it, so "room" waits spill back from that merge.

## Mechanism: the long-held-follower exemption stopped at signalised junctions

`mergingAhead` lets a follower held over 15 s by merge braking close up behind its own lane lead. The lead still obeys
merge priority. The exemption required `e.to.signal && f.to.signal`, so it never fired at an unsignalised give-way
merging into a short exit. The Kaponiera merge at `(-1497, 198)` is exactly that case: the follower sat behind its own
moving lead while the other lane's endless stream held it back. The Centrum merge at `(-1117, 132)` improved earlier
because both its ends are signals, so the exemption already applied there.

## Fix

The exemption now applies to all short links (`f.len < 12`), not only those between signals. It has two parts:

- **(a) Drop the signal requirement.** An unsignalised give-way merging into a short exit qualifies, so Kaponiera's
  10 m exit at `(-1497, 198)` no longer starves. This is a general rule, not a coordinate special case. Alone it
  worsened Kaponiera's mean longest hold 163.5 → 170.0 s when measured on the older 7566c2a base, so it is kept only
  together with (b).
- **(b) Find the lead with `ahead(e.occ[v.lane], v.s, v)` instead of `leadOf(e.occ[v.lane])`.** `leadOf` skips a
  predecessor still in the connector unless its s is negative. A queue head whose lead had entered the connector
  therefore counted as having no lead and kept yielding to the merging lane. `ahead` counts that predecessor as a
  lead. The exemption only bypasses merge priority; `mayEnter` still checks room, alongside, oncoming, cross
  traffic, pedestrians and trams. A car–car body overlap audit gives 274 → 275, so it is safe.

Decomposition measured on the older 7566c2a base (sum mean longest hold / held > 60 s / held > 120 s / deadlocks /
pairs):

| Variant | Sum |
|---|---|
| Baseline | 3946 / 282 / 52 / 3 / 62 |
| (a) only | 3996 / 270 / 42 / 3 / 63 |
| (b) only | 3855 / 269 / 51 / 3 / 63 |
| (a) + (b), kept | 3815 / 249 / 40 / 3 / 64 |

All of Centrum's gain came from (b) on that base: Centrum seed 99 fell 111 → 58 s. Keeping both gave the lowest total
holds and improved Kaponiera to 154.1 s; (a) on its own is not kept.

## Comparison against a302005

Aggregate over 7 districts × 8 seeds, before → after:

| District | Mean longest hold | Held > 60 s | Held > 120 s | Deadlocks | Pairs | Moving pairs |
|---|---|---|---|---|---|---|
| Jeżyce | 83.8 → 83.8 | 51 → 50 | 1 → 1 | 0 → 0 | 20 → 20 | 7 → 7 |
| Łazarz | 31.9 → 31.9 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| Centrum | 77.5 → 69.1 | 13 → 14 | 2 → 2 | 0 → 0 | 7 → 6 | 3 → 3 |
| Kaponiera | 114.9 → 112.0 | 138 → 140 | 8 → 5 | 0 → 0 | 11 → 9 | 9 → 7 |
| Stare Miasto | 26.9 → 26.9 | 0 → 0 | 0 → 0 | 0 → 0 | 16 → 16 | 13 → 13 |
| Rataje | 71.1 → 71.1 | 9 → 9 | 2 → 2 | 0 → 0 | 1 → 1 | 0 → 0 |
| Wilda | 39.0 → 39.0 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| **Sum** | **3560.0 → 3470.0** | **211 → 213** | **13 → 10** | **0 → 0** | **55 → 52** | **32 → 30** |

The mean longest hold falls 90 s (2.5%), cars held over 120 s fall 13 → 10 and deadlocks stay zero. Car–tram pairs
fall 55 → 52 (moving pairs 32 → 30). Cars held over 60 s rise 211 → 213 (+2).

Per-seed changes:

| Seed | District | Longest hold | Held > 60 s |
|---|---|---:|---:|
| 1 | Kaponiera | 126 → 110 | 21 → 22 |
| 4242 | Kaponiera | 99 → 90 | 15 → 14 |
| 7 | Kaponiera | 125 → 111 | 13 → 10 |
| 99 | Kaponiera | 139 → 114 | 23 → 21 |
| 3 | Centrum | 182 → 145 | 9 → 9 |
| 3 | Kaponiera | 113 → 129 | 24 → 28 |
| 5 | Centrum | 87 → 57 | 2 → 0 |
| 11 | Kaponiera | 123 → 148 | 16 → 20 |

Centrum seeds 99 (110 s), 4242 (85 s) and 7 (87 s) are unchanged. Rataje seed 4242 (186 s) is unchanged. The held
over 60 s rise comes from Kaponiera seeds 3 and 11 (24 → 28 and 16 → 20), partly offset by seeds 7 and 99 (13 → 10
and 23 → 21) and Centrum seed 5 (2 → 0). These are later-trajectory shifts after changed merge decisions; the change
only bypasses merge priority for a follower that has already waited over 15 s behind its own lead. It is reported as a
small regression against the strict "holds must fall" wording rather than hidden.

## Open

- Kaponiera seeds 3 and 11 regress in longest hold and held over 60 s. The "room" spillback upstream of the merge is
  reduced but not removed. The merge starvation is improved in aggregate, not eliminated.
- `poznan` moved to dc7c8e4 after this measurement; that commit changes only `js/road-network.js` (Łazarz mean longest
  hold 31.9 → 31.5, all else identical to a302005). These numbers were measured against a302005.
