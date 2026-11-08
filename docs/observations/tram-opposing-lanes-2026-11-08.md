# Tram opposing lanes: short-stub pass (2026-11-08)

`tools/audit-tram-opposing-lanes.mjs` at the parent commit listed **47 runs / 45 lanes / 417 m** of used
street-running track with an opposing car lane closer than 2.3 m (14 runs / 12 lanes / 200 m went to `skipped`, and
`--all` totalled 61 / 57 / 617 m). The runs fell into the groups the backlog named: 41 short junction/shared-tram
stubs, three tracks curving across a straight run (Roosevelta 1840 and Winogrady 4100) and three constant-shift cases
(4257, 4677 and the skewed Wierzbięcice 7930).

## Geometry

- `js/trams.js` `mapTramsToRoads` does not choose the lanes; it samples every metre and records a lane when its
  centre line is within `ROAD_OVERLAP` 2.3 m of the track. The audit therefore reports the road-network lane offsets,
  not a separate tram-side fit.
- `js/road-network.js` `lanesOf` gives every directed edge one constant set of lane offsets. `clearOpposingTracks`
  already moved all lanes together where an oncoming track stayed inside 2.3 m for 10 m or more, after the stop lines
  were placed, then re-placed the moved edges at bends and their neighbours.
- Most remaining stubs have no lateral room: the track pair is closer than the 4.6 m two lane bodies need, or the
  track sweeps across the whole 3.25 m half roadway (Centrum 6020/6034, the narrow Fredry and Głogowska stubs).
  Moving those lanes would put a car under the same-direction track or past the curb; they remain junction-proxy
  cases. The Rynek Jeżycki cluster (4336/4337/5758) is excluded for the traffic regression recorded on 2026-11-05.

## Change

`clearOpposingTracks` now has a second pass for the audit's own 5 m minimum:

- a 10 m-or-more close run keeps the old move and its stop-line re-placement, so the 3015/3201 moves and every
  existing connector are unchanged;
- an edge with no long run gets a 5–10 m stub move, targeting `OPPOSING_MARGIN` 0.6 m beyond the audit and ignoring
  moves under 0.5 m. Those stubs keep their placed stop lines: re-placing a bend neighbour changed a 9 m move into two
  new >15° straight connectors (18.1° and 16.2°) without changing the cleared run (Głogowska at `−1604, 659`);
- the side, car-carriageway, `laneOpen` and same-direction-track checks are the same as in the long pass.

## Results

`node tools/audit-tram-opposing-lanes.mjs` now prints:

```
{"segments":43,"lanes":41,"length":390,"skipped":{"segments":14,"lanes":12,"length":200},"clearance":2.3,"minimum":5,"all":false}
```

`--all` is **57 runs / 53 lanes / 590 m** (43 + the 14 skipped). The pass cleared the 5 m edge at `−838, 1662`, the
6 m edge at `379, −1965` and the 5/8 m pair at `−955, 1791` / `−877, 1700`. At `−2090, −1632` the 9 m run only becomes
a 6 m one: the skewed track crosses the moved lane again, so that short stub stays listed.

The remaining 43 runs are:

| Group | Runs | Lanes | Length | Examples (world metres) |
|---|---:|---:|---:|---|
| Short junction/shared stubs | 37 | 35 | 245 m | 4336/4337 and 5758 at Rynek Jeżycki; Fredry 197/424 at `−850, 0…30`; Centrum 6020/6034 at `−1137, 154` |
| Track curving across a straight run | 3 | 3 | 41 m | Roosevelta 1840 at `−1363, −341 → −1352, −380`; Winogrady 4100 at `−708, −1476 → −696, −1500` |
| Constant shift cannot work | 3 | 3 | 104 m | Głogowska 4257; the 4677 link at `−35, 520`; Wierzbięcice 7930 |

The curved runs and the three constant-shift cases still have no constant offset that clears the track pair inside
the curbs. Wierzbięcice 7930 would need a per-station lateral profile: its opposing track runs from −0.8 to +3.6 m
across the 78 m edge while the same-direction track runs +1.9 to +7.0 m.

## Rejected variants

- **Moving the Rynek Jeżycki stubs** (4336/4337/5758): the earlier eight-seed audit raised Jeżyce's overlap pairs
  20 → 21 and moving pairs 7 → 13 and added a deadlock. The short-stub pass leaves that cluster alone.
- **Loose two-way detection** (treat every two-way track as oncoming for 5–10 m stubs): the audit reached 42 / 40 /
  385 m, but it added a 9 m Rynek run and ten new >15° straight connectors at `−2183, −48`, `−1208, −158` and
  `−916, −40`. Rejected.
- **Extra margin on long runs**: applying the 0.6 m margin to the 10 m-or-more moves pushed Głogowska 3015 from
  +0.66 m to +1.26 m and made its straight connector 18.1° / 16.2° against the base's 19.3° limit check. The margin
  stays on short stubs only.

## Verification

- `node --test tests/shared-tram-lanes.test.cjs tests/tram-clearance.test.cjs tests/opposing-tram-audit.test.mjs`:
  12 pass, including the new totals, the Rynek clearance, the two-lane carriageway and the no-new-steep-connector
  check.
- `node --test tests/traffic*.test.cjs tests/tram-road-proxies.test.cjs`: 82 pass.
- `node --test tests/traffic-flow.test.mjs`: 3 pass. Seed 1 has no deadlock at Jeżyce or Centrum, a car held under
  120 s and over 12 km/h mean; seed 4242 keeps its bounded pedestrian-box cycle (`held120 ≤ 1`); the five-minute
  Jeżyce car-tram overlap audit stays at the 9-pair bound.
- Full `node --test tests/*.cjs` is run with the change; no browser check was made of the new lane paint. The paint
  regression still sees the corrected offsets because the short moves do not re-place the edges.
