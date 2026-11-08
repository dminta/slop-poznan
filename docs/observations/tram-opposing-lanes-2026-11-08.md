# Tram opposing lanes: short-stub pass (2026-11-08)

> A later crossing-track pass on the same day took the default report to **42 runs / 40 lanes / 385 m**
> (`--all` 56 / 52 / 585), and the station-profile pass at the end brings it to **42 / 40 / 377 m**
> (`--all` 56 / 52 / 577). The final same-direction strip pass clears the two constant-shift cases, so the report is
> **40 / 38 / 293 m** (`--all` 55 / 51 / 498). The short-stub measurements below are the state before those passes.

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

## Crossing-track pass

The audit samples the tram centreline at one metre, so it also lists a tram curving across a lane at a junction where
the track is nowhere parallel to the edge. `opposingRuns` cannot see that case: it skips a piece with
`|dot| < 0.95`, and the audit's own rows therefore include junction crossings that are layout proxies rather than
cars and trams running side by side.

The second pass walks the used street-track chains near a non-shared edge in track metres (`crossingRuns`). It takes
the five-metre-or-more runs whose track runs across or against the edge (`dot < 0.5`), reuses `laneShiftChoices` for
the lateral intervals, and moves all lanes together only when:

- the shift is at least 0.5 m and stays on the car part of the carriageway on the edge's own side of the centreline;
- `laneOpen` passes;
- **every** used track, same-direction included, is then more than 2.3 m from every lane (no lane is merely moved
  from an opposing track onto its partner);
- the moved edge keeps its placed stop lines, as in the short-stub pass.

Only one edge qualifies: the 10.3 m Pułaskiego stub at `−1216.6, −591.4`. Its lane moves from −1.94 to −4.51 m
(2.56 m) and the audit's 5 m run (track 56, chain 582) disappears. The default report is now:

```
{"segments":42,"lanes":40,"length":385,"skipped":{"segments":14,"lanes":12,"length":200},"clearance":2.3,"minimum":5,"all":false}
```

`--all` is **56 runs / 52 lanes / 585 m**. The remaining 42 runs are 36 short stubs (34 lanes, 240 m), the three
curved runs on Roosevelta/Winogrady (41 m) and the three constant-shift cases (104 m). Edge and lane counts stay at
8,707 / 11,568 (442.1 lane-km), and paint keeps the moved offset.

### Rejected in this pass

- **Every crossing track, not only oncoming pieces**: this cleared far more rows (including Wierzbięcice 7930), but
  it moved about 90 edges, several of them merely away from a same-direction track. `shared-tram-lanes.test.cjs`
  found dozens of new >15° straight connectors, and the reverse edge of a two-way pair could move without changing
  the audited direction. Rejected.
- **Accepting a residual under the audit's 5 m floor**: at 28 Czerwca 1956 roku (5523) a +1.25 m shift removes the
  audited 5 m run but leaves a 1.5 m body overlap on the neighbouring chain. The audit would stop listing it while
  cars still cross the rails, so the move is not applied.
- **Wierzbięcice 7930, Głogowska 4257, 4677 and the curved runs**: still no constant offset clears the track pair
  inside the curbs. 7930's same-direction track sits where the +4.12 m move would land; 4257's +2.34 m makes a 22.4°
  connector (base limit 19.3°); 4677 would need 3.71 m against a 3.70 m curb allowance. These keep their listed runs;
  4257 is fixed by the station-profile pass below, the others still need geometry the curbs do not offer.
- **Moving the Rynek Jeżycki stubs** (4336/4337/5758): unchanged from the short-stub pass; the earlier eight-seed
  audit raised Jeżyce's overlap pairs and added a deadlock.

### Verification

- `node --test tests/tram-clearance.test.cjs tests/shared-tram-lanes.test.cjs tests/opposing-tram-audit.test.mjs`:
  all pass, including the updated totals, the Pułaskiego regression and the no-new-steep-connector check.
- `node --test tests/traffic-flow.test.mjs`: 3 pass (seed 1 no Jeżyce/Centrum deadlock, seed 4242's bounded
  pedestrian-box cycle, Jeżyce's shared-lane rear-end bound).
- Full `node --test tests/*.cjs` is run with the change; no browser check was made of the moved Pułaskiego lane.

## Station-profile pass (second pass, same day)

A constant offset cannot clear Głogowska 4257: the 20 m close run starts almost at the bend, needs +2.34 m, and a
constant move makes a 22.4° straight connector against the base's 19.3° limit. The lane instead needs to arrive at
the bend already shifted and come back on the next edge. `js/road-network.js` now carries `laneShiftAt(e, s)`, a
piecewise linear lateral shift of all lanes with `s` measured from the first stop line. It is zero at real junctions
and shared across bend stations (`bendChain`), so the stop lines, crosswalk landings and lane-to-lane curves at real
junctions keep their offsets while the lane drifts across the bend. Traffic (`lanePoint`, spawn), tram-to-road
mapping, road paint and the audit read the same profile through `laneOffset`.

The build-time solver samples a bend chain every metre, intersects the feasible shift ranges (the audit's 2.3 m from
the target track chains, the car body at least 0.95 m from the curb, and no lane closer to a same-direction track
than before) and runs forward/backward interval passes with a 0.15 m/m (8.5°) slope limit. Shared tram lanes may move
too, except within 150 m of Rynek Jeżycki. Only Głogowska 4257 qualifies:

| Edge | Place | Length | Profile | Max shift |
|---:|---|---:|---|---:|
| 6353 | Głogowska, `−3022.1, 2519.3` | 42.7 m | 0 → 2.33 m at the bend | 2.33 m |
| 4581 | Głogowska, `−2987, 2474.8` | 53.4 m | 2.34 m at the bend → 0 | 2.34 m |

The two profiles join at the bend station within 0.01 m, so the lane keeps drifting instead of stepping. The audit
row (20 m, track 84, chain 611) disappears; the default report is now:

```
{"segments":42,"lanes":40,"length":377,"skipped":{"segments":14,"lanes":12,"length":200},"clearance":2.3,"minimum":5,"all":false}
```

`--all` is **56 runs / 52 lanes / 577 m**. The remaining 42 runs are 37 short stubs (35 lanes, 252 m), the three
curved runs (41 m) and two constant-shift cases (84 m: 4677 and 7930).

### Why the other 42 stay

Every other target edge failed: either a chain end or a station had no shift that kept 2.3 m inside the curbs, or the
only valid path moved a lane closer to a same-direction track (4677). The measured cases agree with the earlier
diagnosis: on the 6.5-10 m stubs the two tracks and the curb leave no 0.5 m band for the lane (e.g. 5035: opposing
track at 0.96-1.39 m, same-direction track at 2.88 m, lane at 3.25 m, curb room to 3.70 m); on 7930 the same-direction
track is on the right and the side-of-centreline rule is on the left; and the curved runs sweep a track across every
lane, so a 2.3 m clearance would need the lane to jump sides mid-run. Moving the track itself or taking a lane away
is a different change, not a lane profile.

### Verification

- `node --test tests/opposing-tram-audit.test.mjs`: 2 pass, including the 42 / 40 / 377 totals, the absent 4257 row,
  the 6353 → 4581 continuity and the 3 m profile bound.
- `node --test tests/tram-clearance.test.cjs tests/shared-tram-lanes.test.cjs`: 12 pass, including the no-new-steep-
  connector check.
- `node --test tests/traffic-flow.test.mjs`: 3 pass (no Jeżyce/Centrum deadlock; seed 4242's bounded pedestrian box;
  the Jeżyce shared-lane rear-end bound).
- Full `node --test tests/*.cjs` is run with the change. No browser check was made of the moved 4257 lane and its
  paint.

## Same-direction strip pass (third pass, same day)

The two constant-shift cases were the 3.3 m Strzelecka carriageway (audit lane on 4677, 13 m) and the skewed 78.5 m
Wierzbięcice edge (7930, 71 m). Both run the lane between the two tracks, which no constant offset can clear: the
carriageways are narrower than the 4.6 m a car and an oncoming tram body need, and the road side-of-centreline rule
blocks the only other band. The previous passes required every used track, same-direction included, to keep 2.3 m.

That is stricter than the collision: a strip road (a separate 6.5 m formation beside the carriageway) lets a car lane
share with the **same-direction** track, while the opposing track is the one it must stay off. The constant pass now
skips the all-track test for a strip edge (`e.strip`); the opposing test, the curb bound, the side-of-centreline rule
and `laneOpen` still apply. Two lanes move:

| Edge | Place | Before → after | Cleared run |
|---:|---|---:|---:|
| 5035 | Strzelecka, `−35.3, 519.9` | 3.25 → 3.69 m | 13 m, track 4677 |
| 8549 | Wierzbięcice, `−865.0, 977.5` | 1.80 → 5.92 m | 71 m, track 7930 |

5035 moves 0.44 m and 8549 4.12 m; both stay on the car part of the carriageway and pass `laneOpen`. The default
report is now:

```
{"segments":40,"lanes":38,"length":293,"skipped":{"segments":15,"lanes":13,"length":205},"clearance":2.3,"minimum":5,"all":false}
```

`--all` is **55 runs / 51 lanes / 498 m**; 84 m (both constant-shift cases) is gone. Edge and lane counts stay at
8,707 / 11,568 (442.1 lane-km): no lane is dropped. The remaining 40 runs are the 37 short stubs (35 lanes, 252 m) and
the three curved runs (41 m).

### Rejected in this pass

- **Lane diet** (drop the close inner lane on a multi-lane stub): it cleared 16 more rows (26 / 24 / 205 m), but it
  drops lanes, so `footbridges.test.cjs` fails its 16,979-lane baseline and `shared-tram-lanes.test.cjs` fails its
  "no traffic lanes dropped" and no-steep-connector checks (a 1-lane edge connects to lane 0 of a 3-lane neighbour
  3.6 m away). Keeping the lane but moving it left or right instead has no 4.6 m band on these stubs. Not applied.
- **A shared-lane profile that follows the right-hand track**: Fredry's pair is only 1.85 m apart (below the 2.3 m
  car/tram clearance), Dąbrowskiego carries both directions on one OSM chain, and Winogrady's partner track sweeps
  7 m over 27 m (0.26 m/m, above the 8.5° limit). No shared row qualifies, so the shared lanes stay as they are.
- **Removing the lanes from the audit** (shared lanes or junction crossings): it would hide real layout proxies. The
  remaining 37 stubs and 3 curves stay listed.

### Verification

- `node --test tests/opposing-tram-audit.test.mjs`: 2 pass, including the new 40 / 38 / 293 totals, the absent 5035
  and 8549 rows and the 55 / 51 / 498 `--all` count.
- `node --test tests/shared-tram-lanes.test.cjs tests/footbridges.test.cjs tests/tram-clearance.test.cjs`: 16 pass,
  including the unchanged lane count and no-new-steep-connector checks.
- `node --test tests/traffic-flow.test.mjs`: 3 pass.
- Full `node --test tests/*.cjs` is run with the change. No browser check was made of the two moved lanes and their
  paint; both are short street stubs with no lane count change.
