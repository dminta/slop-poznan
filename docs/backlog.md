# Poznań backlog

Updated 2026-11-15. Only remaining work, open decisions and outstanding browser checks are listed below.
Implementation details and completed measurements live in the [topic docs](../AGENTS.md#docs) and
[observation records](observations/). Original phase references refer to the [archived port plan](archive/poznan-plan.md).

## Known gaps and follow-up investigations

- **Bare-disabled signal plans (2026-11-16):** the furnished network now keeps every bare edge and disables only the
  6 plans the bare graph disables (12 Rondo Rataje, 16 Krańcowa/Główna, 129 and 130 Chartowo, 414 Byka, 474
  Wieruszowska/Grunwaldzka). They are multi-arm OSM signals whose network node is a 2-side bend of a merged complex,
  not mid-block pedestrian crossings, so they are correctly disabled; a real crossing there would need the complex's
  crosswalk layout checked in a browser. The `SIGNAL_POLE_KEEPOUT` list in street-details.js is a stop-gap: a general
  rule that also needs the turning curves would have to build the network before the furniture (~450 ms).

- **Piotrowo heights:** confirm the new rectorate against a post-completion survey; its 16.5 m model height now
  follows the documented 16.31 m above-ground portion. A28/A29 use 2024 elevation data; A30 uses PP’s 11.80 m dimension.
  Vault profiles, tagged pitch surfaces/markings and the circular lecture forecourt are implemented. See [world](world.md#piotrowo-campus-landmarks-2026-11-12-round-2) and
  [height evidence](geodata.md#piotrowo-campus-snapshot-2026-11-12).

- **Pedestrian overlap residual:** **current (`637105e`, 2026-11-15 remeasurement):** eight districts,
  3 min, seeds 4242/77: **0 clusters**, **5.56875 pairs/s**, **106.35625 crosswalk entries/min**; longest pair
  **19 s in each seed**. Seven-district `--ped-rooms`: **24,958 / 23,264 ped-s** (Centrum **15,158 / 12,326**).
  The historical 24 s Poznańskie Krzyże pair does not recur; Św. Marcin, Dworzec U-turns and separate curb/approach
  pairs remain. The isolated 4.78 m split sidewalk at `(-1558, 575)` has its two lane lines joined by 1.1 m
  U-turns at both ends; the 2026-11-10 scan found 332 closed twin tracks (249 split, 83 full; 67 under 6 m).
  The Pasaż Różowy under-3 m dead-end stub exclusion and shared same-way link keys remain the kept fixes;
  their historical measurements are in the linked records. The 2026-11-15 pass tests a latched head-on sidestep
  and physical retreat to the original approach; neither shortens the overall longest pair, so neither is kept.
  At the western Dworzec link only one inset side is validated; retreat makes both walkers request the same
  occupied sidewalk entrance. A new design must account for landing space and the independent curb/approach pairs.
  **Do not revive:** length-weighted goal picks; one-person minimum short-link capacity; world-grid body-clearance
  checks at short-link entrances; ignoring oncoming blockers by route key; reversed-endpoint entrance exemptions
  (immediate or after 5 s); dropping all or only dead-end twin U-turns; one-direction-at-a-time on tracks under 3 m;
  route-build twin-loop traps / one-step sink guards / spawn filters (including their combinations);
  universal length-scaled lane ramps; immediate or delayed entrance swaps; segment-exact `onNext` on all or short
  corner links; `stuck > 1` oncoming-exit swaps (including exit-only variants); `< 2 * QUEUE_GAP` short-link box
  guards (with or without capacity checks, alone or with exit swaps); removing way twin U-turns or all same-way
  internal links; blanket under-2 m way exclusions; `spawnPed` `pedNear` retries; the combined short/corner
  `entrance` guards; `curbLane` second columns; latched two-sided head-on sidesteps; physical short-link retreats
  to the original approach. These raise pairs, clusters, room seconds or traffic deadlocks, or fail to shorten
  the longest pair; per-variant numbers remain in the records.
  [Corner links](observations/ped-corner-links-2026-11-10.md),
  [twin loops and rejected routing](observations/ped-twin-lane-loops-2026-11-10.md),
  [Pasaż spawn weighting](observations/ped-overlap-pasaz-2026-11-10.md),
  [2026-11-14 stand-off variants](observations/ped-twin-lane-standoff-2026-11-14.md),
  [Taczaka stub fix](observations/ped-taczaka-clusters-2026-11-14.md),
  [Centrum ablations](observations/ped-centrum-pairs-2026-11-14.md),
  [2026-11-15 measurements and new mechanisms](observations/ped-twin-lane-standoff-2026-11-15.md),
  [earlier mechanisms](observations/ped-overlap-remnants-2026-11-08.md).
- **Rataje seed-4 car–tram deadlock (rechecked 2026-11-15):** no longer reproduced at `6bc437f`: both the full
  and isolated five-minute seed-4 runs give 0 Rataje deadlocks, 16.3 km/h and a 46 s longest hold. Restoring only
  the two pedestrian curb expressions from before `9798737` recreates the exact historical T300 / 58 s cycle:
  line 13's committed-car road gate → car 49 inside `(1026, 1671)` → that tram's opposing-lane pad.
  The queued tram release correctly refuses because the oncoming-inclusive body sweep returns 2.5 m, while the
  car-side pad release only runs before entry. Extending it to connector following with both 20 s waits,
  verified rear storage and a connector-only latch clears the historical cycle but adds car 49 / tram 13 contact
  (0 → 1 pair, 17 frames): the car drives into the stopped nose. **Rejected; no game code changed.** Do not
  retry that bypass merely with different waits/latching: this opposing run needs actual path clearance, not
  just space to store the rear. The fresh nine-seed × seven-district baseline has 0 deadlocks, 18 holds >120 s
  (all Kaponiera) and 48 car–tram pairs; it includes seed 4 and the later curb fix. Measurements and source
  controls are in the
  [Rataje investigation](observations/rataje-seed4-deadlock-2026-11-15.md). The original
  [capacity finding](observations/kaponiera-signal-capacity-2026-11-15.md) predates the curb fix.
- **Kaponiera long holds and the last deadlock:** **seed-noise caveat (2026-11-15):** after the curb fix (`9798737`) the eight historical seeds read 15 holds, but 12 fresh seeds read 12 vs 19 pre-fix and all 20 seeds 27 vs 23, with no deadlock increase; the rise is resampling noise, not a rule fault ([record](observations/curb-fix-traffic-2026-11-15.md)). Compare pedestrian-affecting changes on the 20-seed set. **Round 3 baseline (pre-fix random stream):** +12 s at the two local
  signal sites is retained (`SIGNAL_OFFSET_OVERRIDES`), with **4 holds > 120 s**, 0 new deadlocks and **28 car–tram
  pairs** over historical seeds `1 2 3 5 7 11 99 4242` × 7 districts. Holds fall 11 → 4; the worst district mean
  change is −0.0625 km/h (Kaponiera), within 0.1 km/h. The user accepts the extra overlap pair (27 → 28) as a
  known cost. Production Kaponiera runs reproduce the experimental rows; only the two offsets change, with all
  other 491 plans identical. Splits, cycles, WALK durations and design walking speeds are unchanged.
  +15/+15 is rejected: holds 11 → 2 and pairs 27 → 26, but three new deadlock cycles (Centrum seed 11: two;
  Jeżyce seed 99: one) and Centrum mean −0.7625 km/h. +15/+12 screening gives 18 holds. The unchanged Rataje
  seed-4 cycle is a separate finding above. [Capacity record](observations/kaponiera-signal-capacity-2026-11-15.md).
  Previous baseline (2026-11-14/15): Kaponiera keeps 11 holds > 120 s (seed 5: 6, seed 1: 3). The two traced cases
  are signal capacity, not rule faults: seed 1's queue at `(-1136, 127)` (18 s of 65 s green, tram queue) and
  seed 5's 3→2 merge at `(-1497, 198)` into a 16 s / 60 s green. A further gain needs a signal-plan change passing the capacity
  investigation's gates. History:
  at `8c41595` (8 seeds × 7 districts, 5 min) every hold > 120 s and
  every deadlock is in Kaponiera: 12.6 km/h, 51.3 % stopped, worst wait 145 s, held > 60 s 133, > 120 s **13**,
  **1** deadlock, 2 box-stuck seeds (from 12.3 km/h, 52.2 %, 155 s, 167 / 21 / 5 / 3 at `3279f75`). `6d70c71` broke
  the tram → car → (car →) own proxy → tram cycles (seeds 1, 7, 99 and one of seed 5's): the tram's road-car gate now
  skips a car stopped ≥ `QUEUED_RELEASE_WAIT` 20 s behind that tram's proxy, directly or via one stopped car, whose
  stopped body is outside the swept envelope. `proxyYieldsTo` (2026-11-10) breaks seed 5's remaining 70 s cycle: a
  tram stopped ≥ 20 s for the car yields its own crossing pad in the car's exit lane once the car has waited 20 s and
  the lane, after any real queue in it, holds the car's rear clear of the pad, so the car goes first while the tram's
  sweep keeps the tram stopped.
  Seed 5: held > 120 s 2 → 0, deadlocks 1 → 0, 11.7 → 11.8 km/h, held > 60 s 31 → 28; the other seven seeds are
  bit-identical (8-seed held > 120 s 13 → 11, held > 60 s 133 → 130, deadlocks 1 → 0). Seed 2's 10 holds over 120 s
  were then fixed in the signal plan (2026-11-11): the 37.8 m crossing over Roosevelta's tram corridor clears at the
  1.2 m/s design walking speed (`SIGNAL_WALK_SPEEDS`), so its group-0 stage needs 34 s instead of 40 s and the 10 m
  two-lane give-way link gets 16 s instead of 10 s (2.4 → 3.8 cars/min). Seed 2 goes 10 → 0 holds over 120 s and
  169 → 116 s longest; the eight Kaponiera seeds go 11 → 1 hold, 130 → 90 over 60 s, 12.6 → 13.1 km/h, 0 deadlocks.
  Costs: seed 1's new 175 s queue into Centrum, seed 5's one box stop, Centrum −0.2 km/h and Jeżyce +0.1 km/h (the
  other four districts are bit-identical); the eight-seed car–tram audit is 37 before and 37 after on this tree (36
  was measured at 8c41595), Kaponiera 9 → 8 and Jeżyce 21 → 23. Rechecked on 2026-11-13: seed 7's old 139 s hold
  was already removed by that signal change (longest 95 s, maximum switch wait 7.9 s). The remaining one hold over
  120 s belongs to seed 1's 175 s boundary queue; seed 5's box stop also stays open. The historical switch replay
  distinguishes line 20's occupied-switch and boarding-crossing waits from line 2's 81.4 s maximum; no new runtime
  change was justified. [Switch investigation](observations/kaponiera-switch-jam-2026-11-13.md).
  Rechecked at `eed1a16` (after `5015aa1`, 2026-11-14): 0 deadlocks across all 8 seeds × 7 districts; seed 5's box stop
  is cleared (`boxStuck 0`, worst hold `145 s` merge at `(-1497, 198)`), and seed 1's boundary queue into Centrum at
  `(-1136, 127)` (`waitMax 142 s`, `#11` `153 s`) is a real capacity + physical tram-queue interaction (`18 s / 65 s`
  `g0` split plus two missed greens from trams queueing out of `(-1066.3, 137.2)` and trapping `#68` in the box),
  so no game code was changed. [Seed 1 queue trace](observations/kaponiera-seed1-queue-2026-11-14.md).
  Seed 5's `145 s` hold (`91%` `merge`) at `(-1497, 198)` is likewise downstream capacity (`10 m` 2-lane exit `2367`
  into `(-1503, 224)`'s `16 s / 60 s` green, with `tram 6` and pedestrians taking the first green so `#8` holds `l1`
  for `114 s`) combined with `accelerate()`'s `mergingAhead` braking holding cars `6–10 m` short of the stop line;
  three `accelerate()` guards (`go &&`, `o.v.speed >= 0.5`, `!go && v.held === 'merge'`) regressed seed 2
  (`14.1 → 12.3–13.2 km/h`) and added `boxStuck` on seeds 3/5/7, so no game code was changed
  ([`(-1497, 198)` merge trace](observations/kaponiera-merge-1497-2026-11-14.md)).
  Rejected in this pass:
  1.2 m/s for every plan (173 plans re-timed, two Kaponiera deadlocks over eight seeds), green1 12–15 s at this site
  (audit 38–39, a deadlock, or mean speed lower), keeping the 1 m/s split and moving the offset (seed 2 still had
  7 holds), and the +6 s phase-preserving offset (Centrum and Jeżyce bit-identical but 8 holds and audit 38). The
  crossing has no refuge to split (rail clearance falls to 0.1 m mid-span).
  [Signal-plan record](observations/kaponiera-signal-plan-2026-11-11.md).
  Do not revive the entry guard that counts tram proxies as exit
  occupancy (seed 7 held > 120 s 6 → 19 and a deadlock, Jeżyce seed 1 16.0 → 12.8 km/h), the release only for a
  direct proxy follower (the seed-1 cycle runs through a car) or without the 20 s wait (audit 73 → 79, trams passing
  a just-released car at 5–6.5 m/s), ignoring the waiting tram's proxy for its connector obstacle (the cycle became
  three vehicles, box still 84 s), counting the room behind an exit-lane tram proxy (no change), the rejected
  unrestricted sibling lane (cars entered a left-turn lane over the tram tracks and two trams waited 89 s at
  switches), the version applied to links that do not store for a signal (Jeżyce's `(-2023, -448)` car–tram cycle
  returned and the audit rose to 13 pairs), the rear-gap rule for every moving queue (it cut the merge's throughput
  and added a deadlock), the early-arrival and lane-lead braking relaxations without their regressions, or the
  tram-pad release without both 20 s wait terms (a momentary stop released a seed-99 car that had just reached the
  line and left an unrelated bus in a 124 s red-light hold).
  [Tram-pad release](observations/kaponiera-tram-pad-release-2026-11-10.md),
  [Deadlock traces and the queued-release fix](observations/kaponiera-deadlock-traces-2026-11-10.md),
  [2026-11-10 traces and re-measurement](observations/kaponiera-traffic-2026-11-10.md),
  [2026-11-08 trace and rejected variants](observations/kaponiera-traffic-2026-11-08.md),
  [Centrum trace](observations/merge-starvation-2026-11-07.md),
  [per-second left-turn/tram trace](observations/left-turn-tram-2026-11-04.md).
- **Car–tram body overlaps:** **seed-noise caveat (2026-11-15):** the curb fix (`9798737`) reads 44 pairs on the eight historical seeds but 46 vs 56 pre-fix on twelve fresh seeds (all 20: 90 vs 84, 4.5 vs 4.2 per seed); it is resampling noise, no rule change ([record](observations/curb-fix-traffic-2026-11-15.md)). **Round 3 baseline (pre-fix random stream): 28 pairs** over eight historical seeds
  (Jeżyce 16, Kaponiera 7, Centrum 2, Rataje 2, Stare Miasto 1). The user accepts the extra pair from the two
  Kaponiera +12 s signal offsets (27 → 28) in exchange for reducing long holds 11 → 4 without new deadlocks.
  [Capacity tradeoff](observations/kaponiera-signal-capacity-2026-11-15.md). Previous baseline (`a49181b`):
  27 pairs (Jeżyce 15, Kaponiera 6, Centrum 3, Rataje 2, Stare Miasto 1); Jeżyce includes the 10 m stub `4660`,
  the `8947 -> 4659` bus clearance and 2 connector entries. History: re-measured at `5199713`: **37 pairs** over eight seeds (Jeżyce 23,
  Kaponiera 8, Stare Miasto 5, Centrum 1; 19 moving / 18 stopped), one car held over 120 s and no deadlock.
  [Section-sweep audit and city-wide list](observations/car-tram-sweep-2026-11-12.md): 176 intruding lane ends,
  only 37 able to retreat clear while retaining six metres. The named Jeżyce 10 m stubs need 24.75 / 10.25 m
  retreat; Kaponiera 6522 needs 2.25 / 6.25 / 9.50 m across its three lanes on a 9.41 m edge. A whole-edge
  setback cannot clear these while storing a car. The earlier Kaponiera investigation identified moving contacts
  from the feeder race, which remained outside that pass. Stare Miasto 8503/8504 have lateral room, but the measured +3.70 / +4.60 m offset
  candidate leaves the eight-seed total at 37 and is rejected: seed 2 mean 18.4 → 17.3 km/h, stopped 6.5 → 10.2%;
  seed 7 off-stop tram holds >60 s 1 → 3, against zero measured repeat noise. No runtime geometry change is retained.
  Connector queues and the Jeżyce shared-lane body contacts remain; the new tool is a sampled section envelope, not a continuous collision proof.
  The opposing-lane audit stays **40 runs / 38 lanes / 293 m** (`--all` 55 / 51 / 498); the Rynek Jeżycki lane
  moves still increase overlaps and add a deadlock. Do not retry the rejected feeder cap, connector stop, proxy
  clipping, gate standoff, projected entry speed, unheld-curve forecast, `enter` hard stop, broad stand test,
  feeder two-step, unrestricted sibling lane, moving-queue rear-gap rule or below-5 m residual hiding without a
  new geometric reason. Keep `tramStandsAt`'s "tram waits for me" exemption.
  On 2026-11-15 (8 seeds: `32 → 27` pairs, `10 → 10` moving / `22 → 17` stopped; Jeżyce `19 → 15`, Stare Miasto `2 → 1`,
  other five districts unchanged), `setTrams`/`drive()` in `js/traffic.js` (`_tramLeftGap`) now clamp a left-turner's
  leftward shift (`targetDl < 0`) so its left edge keeps `1.3 m` clear of any tram track to its left, removing all 4
  Dąbrowskiego (`8947`/`6237`) stopped left-turner contacts with 6/7 districts bit-identical and 7/8 Jeżyce seeds
  bit-identical (`seed 7` `15.2 → 14.5 km/h` with higher top-5 junction throughput and `maxWait 85 → 84 s`; 0 deadlocks,
  0 holds `> 120 s`). Do not revive `BUS_OVERLAP = 2.6` (`busOnly` junction conflicts in `mapTramsToRoads`: cut overlaps
  `32 → 24` but raised Kaponiera `6 → 11` and caused 4 Jeżyce deadlocks). Remaining Jeżyce pairs are the 10 m stub
  `4660` (10 stopped), `8947 -> 4659` bus clearance (3 moving), and 2 connector entries.
  [2026-11-15b follow-up](observations/car-tram-jezyce-2026-11-15b.md): no game change retained. Short-run oncoming
  yielding reduced seed-2 Jeżyce pairs `3 -> 2` but mean speed `15.1 -> 14.0 km/h`; outward connector clearance
  reduced seed-1 pairs `4 -> 2` but mean `16.5 -> 15.0 km/h` and left the stopped `4660` bus contact. Both fail
  the per-seed 0.1 km/h limit. The `8947 -> 4659` bus encounter reaches both rendered sections after the initial
  rigid-rectangle false positive; it cannot be dismissed as an audit artefact. Neither variant justifies retrying
  the rejected broad guards or bus-only reservations.
  [4660 fresh-seed storage trial](observations/car-tram-jezyce-4660-2026-11-15.md): a geometry-selected
  instantaneous downstream-room/box admission guard is rejected on all 20 default fresh seeds. Jeżyce pairs
  `41 → 20`, city-wide `74 → 62` (within noise), but holds `>120 s` `28 → 118` and mean per-seed maximum wait
  `109.75 → 172.00 s` both read `worse`; Jeżyce mean `14.370 → 14.030 km/h`, Kaponiera `13.135 → 12.210 km/h`.
  The trial still leaves a stopped car on 4660 and a stopped bus on its incoming connector at seed 61. A clear
  exit at admission does not reserve passage over the 25.97 m incoming connector and downstream junction;
  do not revive this instantaneous guard as proof of safe storage. No game change was retained.
  [2026-11-16 body-path reservation](observations/car-tram-jezyce-4660-reserve-2026-11-16.md): **kept** for
  unsignalised short links swept by an opposing tram (`reservationRefused`: one body on the link, exit-lane room, far
  junction clear, no tram reaching the run in the car's travel time; `tramStandsAt`'s exemption kept). 20 fresh seeds:
  pairs `95 → 69` (better, `462cd6f`), Jeżyce `53 → 27`, holds `> 120 s` `17 → 15`, deadlocks `2 → 0`, max-wait `-0.35 s`
  per seed, other districts unchanged; zones limited to links whose far junction has an oncoming approach (`f.opposite`, not
  a reverse lane) and a tram run of at least 5 m: exactly 4684/4685 city-wide (the one-way Centrum links gave a
  deadlock; 6342 cost 19 s mean / 162 s max stops); a latched, bounded 20 s proxy release also fires elsewhere (Stare Miasto);
  **trade-off: Jeżyce mean `-0.25 km/h` per seed** (CI [-0.6, +0.13], includes 0 but above the 0.1 limit).
  Rejected variants, do not retry: holding both exit lanes' length for the car's connector transit (starves the main
  road, holds `28 → 134`), dropping a tram proxy for any car on a connector (Stare Miasto pairs `4 → 17`; the kept release needs a 20 s stand), and applying the rule to signalised stubs / Kaponiera 6522 (pairs and holds rise).
  [2026-11-15 Jeżyce record](observations/car-tram-jezyce-2026-11-15.md),
  [Kaponiera and Stare diagnosis](observations/car-tram-kaponiera-stare-2026-11-10.md),
  [Jeżyce traces and follower fix](observations/car-tram-jezyce-2026-11-10.md),
  [2026-11-10 baseline](observations/car-tram-overlaps-2026-11-10.md),
  [moving gate](observations/car-tram-overlaps-2026-11-09.md),
  [short-link pass](observations/car-tram-overlaps-2026-11-08.md),
  [older eight-seed results](observations/tram-overlaps-2026-11-04.md),
  [opposing lanes](observations/tram-opposing-lanes-2026-11-08.md).

Decided: central density stays as built (user, 2026-11-10). Jeżyce and Łazarz at 1.19× / 1.20× their OSM district
share are not thinned; [central-density record](observations/central-density-2026-11-08.md).

## Optional features and fidelity

- **Performance on older devices** (users report slowness): measured 2026-11-11 in headless Chrome (WebGPU, Apple
  silicon, 1280 × 720): Rynek street view 1,553 draws / 7.9 M triangles / 11–13 ms renderer CPU, Centrum drone 2,851
  draws; the sun-shadow pass is ~half the draws and 68 % of submitted instances at Rynek are off screen; 903 MB JS
  heap, 412 MB GPU memory. Done: frozen static matrices (`c1f5e66`, renderer CPU −20 to −24 % at Rynek) and indexed
  load-time predicates (boot 18.4 → 11.9 s at 1× on a busy machine,
  [record](observations/perf-boot-predicates-2026-11-11.md)), the block frontage / curb / tram-rail indexes of boot
  part 2 (`outlineRay` and the tram/rail nearest queries; headless build 15.4 → 9.5 s;
  [record](observations/perf-boot-2-2026-11-11.md)), boot part 3 (land raster near-water block skip, road-network
  crossing-run rejects / CSR components / split footprint hash, city-grid ring and road-segment buckets, rail
  keep-out row spans; browser boot 1× −4 % and 6× −21 %, headless build 14.7 → 9.4 s;
  [record](observations/perf-boot-3-2026-11-11.md)), a low graphics tier (`js/graphics-quality.js`:
  `?quality=` or auto-detected from the GPU identity / WebGL2 / ≤ 4 cores / ≤ 4 GB / touch-first unknown GPU; Rynek
  renderer CPU 16.3 → 12.0 ms, GPU 34 → 6 ms), halved mural / tram plate canvases
  ([record](observations/perf-memory-2026-11-11.md)), the low-tier tree profile
  ([record](observations/perf-trees-2026-11-11.md): the Centrum drone drops 488 of 1,879 draws and 72 % of tree
  triangles; Rynek −85 draws at street level; high is pixel-identical), and draw-call batching (roofs merged per
  piece, lamp mast + housing merged, cheap-prop culling cells, merged prop shadow stand-ins on high only; see
  [record](observations/perf-draw-calls-2026-11-11.md) for the rebased ablation). Not yet measured on a real phone or
  integrated GPU; `?stats=1` shows a copyable report for that.
  Retained JS heap after GC is now ~843 MB high / ~780 MB low: after the first captured-scope release
  (−104 MB, [record](observations/perf-heap-2026-11-11.md)), the second pass releases local building/tree/road staging
  and packs immutable footprint queries (a further ~43 MiB per tier, with equivalent graph hashes and unchanged frame
  p50; [record](observations/perf-heap-2-2026-11-12.md)).
  Street furniture geometry trimmed (lamp masts, hydrants, gas lanterns, bollards, columns: −43 % furniture
  triangles, frame −12 to −14 %; [record](observations/perf-heavy-props-2026-11-11.md)).
  Sun shadow cadence: one depth map per cascade, the far cascade every second frame (shadow draws −31 to −42 %,
  renderer CPU −15 to −19 %, GPU memory −72 MB on high; [record](observations/perf-shadows-2026-11-11.md)). It relies
  on `SunShadowNode` internals: recheck shadows on both backends after any three.js SHA bump.
  Opaque shadow shader consolidation cuts programs 287 → 224 high / 267 → 206 low and median compile + warm-up
  8–18% across tiers/profile-cache states, with equivalent screenshots on both backends
  ([record](observations/perf-shaders-2026-11-12.md)).
  Boot part 4 removes curb-ring interior visits, short-circuits corner-link band checks and adds an outline-distance
  hierarchy: precompile init 7.16 → 6.70 s at 1× / 45.42 → 42.74 s at 6×, with identical build hashes and unchanged
  retained heap ([record](observations/perf-boot-4-2026-11-12.md)).
  Boot part 5 reuses park lots and trims signal-placement work: precompile init 6.63 → 6.29 s at 1× /
  43.04 → 40.78 s at 6×, with matching build hashes and unchanged retained heap
  ([record](observations/perf-boot-5-2026-11-12.md)).
  Cached per-pass chunk boxes reduce submitted triangles by up to 10% with fewer draws and unchanged programs;
  GPU-time savings remain unproven ([record](observations/perf-culling-2026-11-12.md)).
  Next steps, in order:
  1. **Measure real devices** with `?stats=1` (a phone in the default low tier, an integrated-GPU laptop, an iPad in
     Safari where the GPU model is masked) and let those reports pick the next target; extend the GPU table in
     `graphics-quality.js` from them.
  2. **Scene shader compile** still takes ~1 s on this Mac; use real-device reports to justify further material
     consolidation, and keep the full warm-up until deferred first-use hitches can be ruled out.
  3. **JS heap** (~843 MB high / ~780 MB low retained): runtime land rasters, scene/geometry buffers, remaining
     route/collider/guide indexes and shader NodeData (~38 MB) dominate. Use real-device measurements to justify
     further exact packing or geometry deduplication; shader-cache release needs a renderer-supported lifecycle.
     Post-upload attribute release remains unsafe in the pinned three.js; keep GEO/BLOCKS late-reader inputs.
  4. **Remaining boot work** after eleven passes: boot part 11 ([record](observations/perf-boot-11-2026-11-16.md)) adds exact
     segment-to-segment `railSegHasSegs` pre-filtering for `laneClear` (`city-grid.js`, `pedestrian-routes.js`), caches
     per-edge curb frames and inlines edge tests in `nearestCurbFrame` (`street-details.js`), skips duplicate
     `clearOfRails` checks in `findOverhead` (`street-details.js`), precomputes Bernstein basis tables in `makeCurve`
     (`road-network.js`), and indexes `TRAM_SURFACE_GRID` (`city-config.js`) with a flat `Int32Array` bucket grid
     (headless Node build 10.42 → 10.04 s median / −3.73%, min 10.37 → 9.98 s / −3.70%, 5/5 interleaved pairs faster,
     `signalHeads` −12.9%, `tramInfra` −30.3%, `cityGrid` −4.5%, 24/24 output hashes identical, +0.06 MiB retained
     heap). Earlier, boot part 10 ([record](observations/perf-boot-10-2026-11-15.md)) precomputes
     `LANE_GUIDE` segment records and adds bbox/squared-distance rejection in `roadClearance`, packs `px`/`pz`
     `Float64Array` vertex coordinates in `createPolygonIndex`/`pointInPolyIndexed` (`city-config.js`), switches
     `createFootprintIndex` to 32 m cells with flag-partitioned `ids` (`road-network.js`), and adds single-cell
     fast paths, hoisted limits and bbox-before-`accept` in `segmentGrid` (`tram-infra.js`) (headless Node build
     10.08 → 9.95 s median / −1.29%, min 10.04 → 9.80 s / −2.37%, 5/5 interleaved pairs faster, `streetDetails` −3.3%,
     `blocks` −4.5%, `railLayout` −8.2%, 24/24 output hashes identical, +3.80 MiB retained heap). Earlier, boot part 9
     ([record](observations/perf-boot-9-2026-11-14.md)) cut 12.05 → 11.62 s median / −3.52% (browser precompile `[init]`
     for passes 8 + 9: 6.77 → 6.59 s at 1× / 44.26 → 41.65 s at 6×; passes 6–7 are not separately revertible now that later commits use `railWithin`). Remaining larger budgets in Node `--cpu-prof` are
     `road-network` footprint index (0.44 s self), `tram-infra` `within` + `nearest` + `add` (0.36 + 0.11 + 0.15 s),
     `railWithin` (0.29 s), `pointInPolyIndexed` (0.27 s), `nearestCurbFrame` (0.24 s), `roadClearance` (0.17 s),
     `clearOfCrosswalks` (0.17 s), `makeCurve` + `curvePoint` (0.16 + 0.15 s), `outlineRay` (0.16 s), `laneClear`
     (0.15 s) and `cutSlab` (0.15 s);
     do not retry 12 m `laneGrid` cells, a flat `Int32Array` grid for `railWithin`, a flat `Int32Array` grid for
     `landingGrid` (`clearOfCrosswalks`), extra
     `segmentGrid` edge fields (+30.1 MiB heap), duplicated per-bucket `bounds` in `createFootprintIndex`, per-edge
     `x`-range branches in `pointInPolyIndexed`, or a separate `_mainlineCells` map in `railWithin`.
     Workers or deferral would need
     pure layout/buffer boundaries (cityGrid + traffic: 17.64 s upper-bound budget), justified by real-device reports.
     The [worker boundary study](observations/perf-workers-2026-11-12.md) stopped at Stage 1: production remains
     synchronous and there is no `?workers=0` or worker path. The large phases are mostly pure logic, but a worker
     on the current chain can overlap only the next independent branch. Runtime signal heads (5.56 s) model
     2.4–3.2 s net at 6×, not clearly above 3 s; blocks/cityGrid/streetDetails return 50–73/52/15+ MiB measured
     records that the next stage waits for, and a worker's config + geodata alone retain 85 MiB. The scratch
     tram/rail worker regressed even with an unthrottled worker; page CPU throttling does not throttle a dedicated
     worker. Revisit
     workers only with a compact worker-consumable geodata/config projection or baked layouts, pure layout
     modules returning flat typed-array records, and a multi-stage pipeline measured under worker throttling and a
     process-peak budget. The raw cyclic network is not a cloneable boundary.
  5. **Remaining off-screen instances:** masts, local gas lanterns and members of intersecting chunks still dominate;
     use real-device reports to justify a conservative hierarchy/range approach, measuring per-pass CPU and buffer
     uploads. Smaller heavy-mesh cells added 52–232 draws for only 0.7–2.6% extra triangle savings and were rejected.
  6. Tree LOD / draw distance for the high tier (low already has its own profile), only if real devices need it.
  7. **High-altitude panoramic vistas** were the draw peak (Winogrady `wp5`: 2,039 scene draws on High / 1,584 on Low from
     chunk accumulation across 3–8 km of city). Done: a far-block merge for the 1 km static chunks and per-landmark steel/gold
     batching (−34 % high / −44 % low on WebGPU and WebGL2, merge on/off bit-identical,
     [record](observations/perf-vistas-2026-11-15.md)), then whole-crown tree LOD 2 in 400 m far cells with per-instance
     moves (tree scene draws at wp5 616 → 264, scene draws −23 % High / −7 % Low, WebGPU High renders bit-identical, no flight
     hitch, [record](observations/perf-tree-vistas-2026-11-15.md)), then per-bridge section batching and the outskirts
     borough far merge (wp5 Bridges 138 → 90 draws, Outskirts 97 → 41,
     [record](observations/perf-bridges-outskirts-2026-11-16.md)). Left: 600 m tree cells (150 tree draws at wp5 but
     +20 % shadow triangles at Centrum). The tree level sweep is incremental now (about 4.5 k of 118 k trees visited
     per update, 0.50 → 0.05 ms,
     [record](observations/perf-tree-sweep-2026-11-16.md)).
  [Ranked opportunities](observations/perf-older-devices-2026-11-11.md).
- Road levels and richer road-priority classification; revisit only with a runtime consumer.
- Additional height sources (nDSM/LoD1/LoD2) and GEOPOZ machine-readable data: research candidates.

## Browser checks still outstanding

The 2026-11-11 headless Chrome pass is recorded in
[observations/browser-checks-2026-11-11.md](observations/browser-checks-2026-11-11.md) and the 2026-11-14 pass in
[observations/browser-checks-2026-11-14.md](observations/browser-checks-2026-11-14.md); coverage transitions and
Ławica draw-call / shadow costs were measured 2026-11-14 in
[observations/perf-transitions-2026-11-14.md](observations/perf-transitions-2026-11-14.md). They covered part or all of
the checks below; each remaining bullet is the part that is still open.

Shop-sign atlas grazing mip bleed was verified and fixed 2026-11-15 on WebGPU and WebGL2, at 20–80 m / 75–85°
in midday and midnight views. An 8 px gutter and isotropic LOD capped at 4 isolate cells while retaining one atlas
and draw; [footprint proof, screenshots and costs](observations/shop-sign-mips-2026-11-15.md). Cell selection, chain
signs and dusk/night spot colours were checked 2026-11-11.

The [2026-11-16 signals/trams/clearance pass](observations/browser-checks-2026-11-16.md) sampled six cantilever
heads, four ordinary span heads and the Górna Wilda head on WebGPU high and WebGL2 low: visible from 13–30 m
behind the queue at 1.2 m eye height; lead-car view not checked. Mast/anchor and stay coverage is partial.
It framed the Rynek Łazarski road-cleared columns, raised 6.1 m tram canopies and elevated railway portals on both
backends; the 2026-11-17 [tram pass](observations/browser-checks-trams-2026-11-17.md) then showed the pantograph on
WebGPU too. Natural WebGPU sequences cover a whole Zawady switch passage, a Kaponiera road-crossing passage and a left
turn without a nearby tram; the 2026-11-17 pass added an occupied-stop admission, a tram passing a stopped car, a left
turn just after clearing a braking tram's path, the Zawady/Ogrody dwells and a Jeżyce reservation. Remaining checks and defects are listed
below. The Główny hall / Garbary ramp track overlaps remain deliberately unchanged, as documented in
[the earlier clearance audit](observations/overhead-clearance-2026-11-14.md#3-document-only-findings-no-code-change).

### Interface and performance

- Confirm the loading-screen credit link hover/focus and external navigation in a real (non-headless) browser; its
  colours, contrast, dark-mode independence and credit layout at 1280 × 720 and 390 × 844 were checked 2026-11-11.

### Geometry, materials and collisions

- Calibrate Collegium Maius hall weather-cover elevations and outer panel specification if a measured section or
  dated refurbishment record becomes available. Its narrow gabled exterior above curved interior glazing is now
  resolved from GUGiK/GEOPOZ imagery (13 × 17 m approximation); 14 m eaves / 3.5 m rise remain model assumptions.
  [Hall-roof evidence, 2026-11-13](observations/kit-roofs-2026-11-13.md#hall-weather-roof-review-2026-11-13).
- Continue landmark-placement and scenic-camera checks, panel-material shimmer, balcony LOD transitions and
  platform/slab flicker where surfaces are only 1 cm apart.
- Browser check still open for the street trees: an in-frame overlay of OSM points on the pits (the 2026-11-17 attempt drew no
  marker meshes in the WebGPU frame, cause not investigated), and GPU frame time plus the WebGL2/low tier on the tree scene. The
  2026-11-17 pass matched 302 of 712 old-town pits and 362 of 1,496 Cytadela-area pits to OSM nodes within 0.3 m (all the rest are
  procedural rows), found every OSM node within 45 m of two sample discs rendered at its exact point, and measured WebGPU high at
  60 fps (vsync-capped) with 754–1,236 draw calls at street level and the drone, CPU frame 7–15 ms
  ([record](observations/browser-checks-props-2026-11-17.md#4-street-trees-vs-osm-frame-rate-and-draw-calls)). The Rybaki collision was
  checked 2026-11-11: the player deflected 0.57 m around a tree with a player collider at `(-285.9, 874.5)`.
  [Tree-placement audit and pins](observations/street-tree-clearance-2026-11-06.md),
  [OSM tree record](observations/osm-street-trees-2026-11-08.md),
  [2026-11-14 headless audit](observations/street-tree-audit-2026-11-14.md).
- Keep everything but the shelter out of tram-shelter footprints: the 2026-11-17 browser pass found 14 of 224 shelters with
  something standing in them (local coordinates in the shelter frame; the headless scan that found only two skipped lamp masts,
  pits and trees):
  - parking machine and hydrant, from `place()` in `street-details.js`: Dworzec Zachodni `(−1637.99, 878.92)` local
    `(−1.45, 0.32)`; Żeromskiego `(−2961.0, −791.4)` local `(1.76, 0.28)`;
  - lamp masts, from the lamp placer: Wilczak `(843.3, −2048.1)`, Małe Garbary `(205.2, −262.7)` and `(234.1, −244.5)`,
    Łomżyńska `(3492.2, −106.9)`, Kórnicka `(1314.6, 1046.2)`, Polanka `(1927.5, 1293.8)` (at the bench);
  - street trees with their pits, from the tree placement: Łąkowa `(13.9, 737.7)`, Uniwersytet Przyrodniczy `(−1885.4, −2046.6)`,
    Most Teatralny `(−1313.5, −360.8)`, Św. Leonarda `(−1541.1, −2702.1)`, Serbska `(801.8, −2556.1)`, Budziszyńska
    `(−5851.2, 2271.6)`;
  - borderline: the stop sign at Rondo Kaponiera `(−1414.4, 88.4)`, local `(1.93, 0.70)`, on the edge of the open front.

  The 2026-11-14 street-tree audit's "0 shelter violations" needs re-checking. Shots and local coordinates in
  [the record](observations/browser-checks-props-2026-11-17.md#defects-found-while-framing-the-shelters-14-shelters-after-review-round-1).
  The browser walk/drive check of the named diagonal shelters at Dworzec Zachodni and Żniwna itself passed (person stops at the
  back glass, ends and bench, enters the open front; car stops at the glass or bench).
- Browser check: lamps stepped onto lawns in narrow-walk parks (the 122 `onLawn` lamps, 1.0–1.59 m inside the walk edge, a count that may be stale;
  e.g. block 212 near `−953, −1928`, Skwer Sybiraków block 303, Moniuszki block 421). The 2026-11-17 browser pass
  ([record](observations/browser-checks-props-2026-11-17.md#3-park-lamps--ok-for-the-sampled-lamps-the-lawn-lamp-placement-itself-not-exercised))
  framed 13 lamps in Za Cytadelą, Park Cytadela, Park Nad Wartą and Park Jana Kasprowicza by day and night (all fine; none a
  verified lawn lamp: the one at `−959.18, −1893.81` stands on a grass median). The "122 `onLawn`" figure comes from the 3,438-lamp audit
  and may be stale (the grid now has 3,390 lamps, `tram-bed-surfaces-2026-11-14.md`); the headless audit
  ([record](observations/park-lamps-trees-2026-11-14.md)) already confirmed the geometry. [Tree/building clearance](observations/tree-building-clearance-2026-11-03.md).
- Watch the black locust wind motion in a strong-gust phase: the 2026-11-17 check sampled 7.2 s of a ≈ 12.6 s gust period
  (crown drift ≤ 2 px / 6 px, leaf flutter, no popping) and could not separate branch motion from foliage motion in stills
  ([record](observations/browser-checks-props-2026-11-17.md#5-black-locust-wind--plausible-amplitude-small-not-resolved-for-strong-gusts)).
  [Tree models](world.md).

### Signals, traffic and audio

- Check rendered demand crossings beyond node `2422`, the full rendered Św. Marcin green-wave corridor, and
  crossing ticks against displayed heads (headless NPC demand-request coverage now spans all 23 demand-crossing nodes,
  `tools/audit-demand-crossings.mjs`, [2026-11-15 audit](observations/demand-crossings-2026-11-15.md); Most Teatralny
  pole-mounted heads and Głogowska/Hetmańska were checked on WebGPU and WebGL2 in
  [2026-11-14](observations/browser-checks-2026-11-14.md) and [2026-11-15](observations/browser-checks-2026-11-15.md)).
  [Previous coverage and limits](observations/signals-2026-10-30.md).
- Check Dworzec's connected refuge route, signals and pedestrian/vehicle interactions on WebGL2; record a full
  rendered interaction with a naturally approaching bus, including rear clearance.
  [Dworzec checks](observations/dworzec-2026-10-30.md), [bus population check](observations/bus-population-2026-10-30.md).
- **Defect: overhead heads stand on the wrong side of the stop line.** `findOverhead` (`js/street-details.js:2592–2644`)
  puts 101 of 114 heads 8–15 m *behind* the line and 13 within 1.75 m of it; Table 7.2 (załącznik 3, pkt 7.2.2) and two ZDM
  Poznań designs put overhead signals 8–30 m *beyond* the line, so the lead driver sees none of them (56° above the eye
  at best). Fix proposed in [the record](observations/browser-checks-signals-2026-11-17.md): flip `search(-8/-10.5)`
  to +8/+10.5, clamp to +10.5…+30, widen the along windows at `:2610,2620`, update `docs/world.md:423` and the sight
  audit, or (B) move the approach stop line upstream (road-network/traffic, needs accept-traffic). The consolidated 2019
  table is identical, so no re-read is needed.
- **Defect: head 10's span stays cross an elevated mainline rail deck** (existing poles (−1551.0, 544.4, head 9's pole) / (−1547.0, 533.6),
  head (−1506.1, 555.0)) at 10 m, only 3.65 m above the 6.35 m deck, through the train envelope for 20 m. Spans use
  a ground-relative 10 m; over a viaduct they need the deck height plus the portal/catenary clearance, or a different
  anchor pair. Also: head 22's left mast stands against a facade and its stay passes a balcony row in projection (possible
  collision, not examined). [Record](observations/browser-checks-signals-2026-11-17.md).
- Near-collinear spans are systemic: 11 of 44 span heads have stays under 12° apart in plan (head 16 at 8°, 90 at 1.5°);
  cause is `pick` (`js/street-details.js` ~2689–2690) admitting same-side pairs at a +8 penalty. Low priority.
- Related: Table 7.2 row 1 ("obok jezdni") needs the stop line ≥ 2,0 m before a side signal, but the ground-pole search
  allows −15 … +1.75 m (`js/street-details.js` ~2807–2833, enforced by `tests/signal-placement.test.cjs` ~354); ordinary
  ground heads probably share the misreading.
- Remaining overhead-head checks: 81 of 114 overhead heads have no visual check yet; supports and coverage were checked on WebGPU only; low-level frames of head 10's stays against the portal
  were not legible. Lead-car and rear-queue views will need repeating after the sign fix.
  [Record](observations/browser-checks-signals-2026-11-17.md), earlier
  [visual coverage](observations/browser-checks-2026-11-16.md) and
  [geometric clearance audit](observations/signal-tram-clearance-2026-11-14.md).
- **Defect (to confirm with the user): trams reach the −9 m/s² floor.** About 3.6 times per tram-hour headless (bench
  world, 7 districts, seeds 4242 and 7, 5 min, 20 fps, 25.5 tram-hours: 157 episodes below −3 m/s², 117 below −5,
  93 at the cap; at-cap by wait reason room 36, car 28, switch 17, signal 9, stop 3; Wilda `(−929, 1954)` hits `'room'`
  about 10 times per run), mostly for late room/switch/signal gates (cars about a third). Fix the late gates (lookahead /
  `bMax`-aware gating; `bMax: 3.0` at `js/trams.js:53` is used only by the amber check) rather than just lowering the cap
  (`t.acc = Math.max(-9, _acc)`, `:1817`), which would cause overruns. Needs accept-traffic. Browser rates of 9–11 m/s²
  were a harness timebase artefact. [Record](observations/browser-checks-trams-2026-11-17.md#3-kaponiera).
- **Defect (minor): open doorways are barely readable in some lighting (Zawady Tramino).** Open leaf RGB (27, 31, 33) vs
  closed (9, 21, 31) in `zawadyA3-10` / `-12`; the open colour `0x2b2622` (`js/actor-models.js:3697`) is shared by all
  models, and Ogrody's Combino reads better (`ogrody-09` / `-11`), so it is lighting and angle. Model labels are inferred
  from livery. [Record](observations/browser-checks-trams-2026-11-17.md#5-dwells-and-the-jeżyce-reservation).
- **Defect (not investigated): high-tier (SSR) reflection on the tram canopy underside.** The 6.1 m canopy at Piaśnicka
  Rynek `(3274, 2324)` shows semi-transparent ghost reflections on WebGPU high (`pano-webgpu-back`, `pano-webgpu-side`);
  the comparison frame was WebGL2 **low**, which has no SSR (`pano-webgl2-back`); WebGL2 high was not checked. Likely cause:
  the canopy roof material `roughness: 0.5, metalness: 0.42` (`js/canopies.js:48`), under the 0.75 SSR roughness mask.
  [Record](observations/browser-checks-trams-2026-11-17.md#1-pantograph-under-a-raised-canopy).
- Kaponiera left turn with a tram approaching: the close crossing ahead of the tram's nose was **not framed**. The frames
  (`kapL3`) show the car just after it cleared the path of a braking tram (≈ 0.25 s after), the crossing itself is inferred
  from the log. The per-frame tram-reservation value (`c.held`, `tramConflictGap`) was not read, so the ~1 s
  forecast-gap case is unverified. [Record](observations/browser-checks-trams-2026-11-17.md#3-kaponiera).
- Tram lines now run on rails to the OSM data edge outside the detail box (Starołęka z ≈ 3125 and 21 other chains); the real
  terminus loops (Starołęka PKM etc.) lie beyond the snapshot. Consider a buffer-stop prop at the data-edge ends and a pole-vs-outskirts-building
  check. [Record](observations/staroleka-rails-2026-11-17.md).
- Listen to sirens, bells, tram motors/squeal and the noon show; verify local timing and audible range.

For each fix, record measurements and regression checks in the topic docs or observation records, and state which
browser checks were actually performed. Remove completed tasks from this backlog; retain only unresolved work.
