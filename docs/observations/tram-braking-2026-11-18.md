# Tram braking investigation, 2026-11-18

Status: three experiments screened on two historical seeds; the wider scan passed the stated 20-fresh-seed rule.

`node tools/audit-tram-braking.mjs --seed 4242` and `--seed 7` each ran the seven bench districts for five minutes
at 20 fps. The audit excludes the first 20 s, counts active tram time thereafter, and counts threshold crossings only
while the post-update speed is above 0.5 m/s. It attributes each threshold episode to the reason and position at its
lowest acceleration. It uses ≤ −8.5 m/s² for the cap category, as in the earlier browser-check record.

| Threshold | Episodes | Per tram-hour |
| --- | ---: | ---: |
| Below −3 m/s² | 162 | 6.35 |
| Below −5 m/s² | 106 | 4.16 |
| ≤ −8.5 m/s² | 80 | 3.14 |

The denominator was 25.499 tram-hours. At ≤ −8.5 the peak reasons were room 31, switch 16, car 15, signal 9,
pedestrian 6 and stop 3. These counts differ from the prior record (157 / 117 / 93; no pedestrian episodes); its
exact moving-speed and episode criteria were not retained. The two series should not be compared as a change in
behaviour. Detailed district, reason and position data are in `.agent-task/braking-baseline-{4242,7}.jsonl` in this
worktree. The audit's own definition must be held fixed for subsequent variants.

The road-car conflict gate checks only 8 m ahead, shorter than the braking distance at normal speeds. Room and switch
checks scan 60 m, but their occupancy and clearance inputs can change as another tram moves; additionally,
`holdBeforeComplex` can move a newly selected gate upstream. These are hypotheses to investigate, not yet validated
fixes. Its existing 8 m limit has a documented deadlock trade-off. The experiments and their safety screens are below.

## Round 2: gate traces

The trace instruments a headless copy of the tram module, and the baseline replay reproduced all 162 / 106 / 80
threshold counts. The 80 events, their binding gates and closure data are retained in
[tram-braking-classification-2026-11-18.json](tram-braking-classification-2026-11-18.json). The trace uses a per-gate
prior-frame comparison; a new or abruptly closer stop point records speed, distance and `v²/(2d)` (null for a gate
already behind the front). Classes are diagnostic observations, not proof of a particular vehicle's intent:
`lookahead` means the gate appeared at the scan boundary, `changed occupancy` means a previously clear room became
blocked or a previously scanned switch gained a blocker, and `complex + ...` means `holdBeforeComplex` pulled that
newly closed gate upstream. `unresolved` means the available trace does not establish the cause. Times are seconds;
coordinates are rounded world metres. The table covers every ≤ −8.5 episode and gives up to three examples per row.

| Reason / observed class | Episodes | Examples: seed, district, tram, time, position |
| --- | ---: | --- |
| room / complex + lookahead | 23 | 4242 jezyce #2 256.95 s (-1313, -405); 4242 lazarz #12 124.95 s (-1855, 897); 4242 lazarz #20 214.25 s (-1789, 904) |
| switch / complex + lookahead | 16 | 4242 jezyce #9 89 s (-1441, -230); 4242 jezyce #1 220.9 s (-2057, -399); 4242 lazarz #0 63.9 s (-1855, 897) |
| car / unresolved | 9 | 4242 jezyce #13 226.95 s (-2077, -469); 4242 centrum #21 83.2 s (-1018, 148); 4242 stare #5 29.1 s (-99, -276) |
| pedestrian / unresolved | 6 | 7 kaponiera #4 238.65 s (-1488, 210); 7 stare #18 105 s (-271, -165); 7 stare #18 105.4 s (-269, -164) |
| signal / unresolved | 5 | 4242 lazarz #3 46.3 s (-2580, 1866); 4242 kaponiera #10 29.9 s (-1207, 646); 4242 kaponiera #11 269.3 s (-1192, 599) |
| car / complex + unresolved | 5 | 4242 stare #19 99.95 s (-186, 329); 4242 stare #20 257.05 s (-186, 329); 4242 stare #9 283.95 s (-220, -172) |
| signal / signal | 4 | 4242 jezyce #10 275.35 s (-1264, -526); 4242 centrum #15 175 s (-1497, 574); 7 centrum #18 170.4 s (-1390, -254) |
| room / changed occupancy | 3 | 4242 jezyce #0 100.7 s (-1464, 68); 4242 centrum #19 47.85 s (-1470, 115); 7 centrum #19 47.85 s (-1470, 115) |
| stop / unresolved | 3 | 4242 lazarz #18 50.7 s (-1701, 756); 7 lazarz #18 50.7 s (-1701, 756); 7 kaponiera #2 232.9 s (-1383, -269) |
| room / unresolved | 2 | 4242 wilda #0 261.1 s (-617, 1258); 7 wilda #0 261.1 s (-617, 1258) |
| room / complex + changed occupancy | 2 | 7 jezyce #0 100.7 s (-1466, 77); 7 kaponiera #0 154.75 s (-1481, 188) |
| car / complex + lookahead | 1 | 4242 jezyce #21 64.45 s (-2049, -416) |
| room / complex + unresolved | 1 | 4242 jezyce #8 211.1 s (-1460, 33) |

The scan-boundary/complex combination accounts for 23 room and 16 switch episodes. At Wilda, seed 4242 tram 13 at
29.15 s saw the keep-clear gate at 59.98 m; its prior probe was already blocked while the entry was beyond 60 m.
The complex moved its stop point to 1.20 m at 6.17 m/s (15.90 m/s² required). This is a scan-boundary case, not proof
of a new occupancy race. Including one car episode, 40 events show this scan-boundary/complex combination. For signals, the amber
test uses distance to the signal head, while the effective gate can be further upstream; green entries are recorded,
but `recordSignalEntries` does not record an amber entry. Several traced amber gates appeared behind the front. These
facts warrant a separate signal fix; the trace alone does not prove a red violation.

## Variants and safety screen

Each variant was run for the same two seeds, 5 minutes, 20 fps, seven districts. Car–tram and tram–tram figures count
pooled pairs with a section-body overlap after warmup; pooled IDs can be reused. The overrun counter records gate-frame crossings
of an *observed closed* gate (0.01 m tolerance), including signal, room, switch, road-car and stop gates; it
can count separate gates at one crossing and misses gates already behind the front when first detected, red crossings
without an observed closed gate, buffer ends and movement between frames. Counts are diagnostic lower bounds, not a
proof of safety. Overlap pair identities and event lists were inspected, not just totals.

| Variant | Episodes below −3 / below −5 / ≤ −8.5 | Tram-hours | Car–tram pairs | Tram–tram pairs | Detected gate overruns |
| --- | --- | ---: | ---: | ---: | ---: |
| Baseline | 162 / 106 / 80 | 25.499 | 9 | 3 | 28 |
| Road-car lookahead | 208 / 159 / 83 | 25.505 | 8 | 3 | 33 |
| Wider room/switch scan | 104 / 80 / 54 | 25.441 | 6 | 4 | 19 |
| Keep-clear-only scan | 120 / 97 / 76 | 25.451 | 8 | 4 | 24 |

The road variant checked committed vehicles out to `max(8, v²/(2·3) + 2)` metres, using a distant check only to
influence braking and leaving the 8 m reservation logic in place. It worsened both hard braking and detected overruns in these two seeds; screened only. The wider scan checked switches, crossings
and keep-clear zones out to 140 m and used distant checks only
for braking. Although it reduced cap episodes by 26, it introduced three car–tram pairs absent in the same-seed
baseline, including Stare Miasto seed 7 at `(−185, 306)` with car/tram speeds 6.2/7.3 m/s; it also introduced two
tram–tram pairs in Stare Miasto seed 4242. This was a two-seed screen, not an acceptance verdict; the 20-fresh-seed
comparison below accepted it. The keep-clear-only variant similarly extended only the
road/mainline keep-clear scan to 140 m. It reduced cap episodes by four, but introduced five car–tram pairs and two
tram–tram pairs absent from the corresponding seed baselines. For example, Jeżyce seed 4242 at `(−1876, −394)` had
car/tram speeds 6.3/5.7 m/s. Screened only. Changes in a shared random stream mean these two-seed observations are
screening evidence, not statistical estimates of the changes' effect; same-seed new contacts alone are not an acceptance
verdict. The experimental diffs are retained as `.agent-task/variant-{road,far,keep}.patch` in this worktree.

The full `node --test tests/` suite passed (690 tests) before applying the wider scan; the post-change run is recorded below.

## Round 3: fresh-seed acceptance

The wider scan was measured against `poznan` using the default 20 fresh seeds. The traffic benchmark uses 5 minutes at
15 fps and the separate braking and tram–tram audits use 5 minutes at 20 fps. Both paired-bootstrap intervals use
10,000 resamples of the mean working-minus-baseline difference per seed. Per-seed data and exact CIs are in the
[traffic results](tram-braking-traffic-acceptance-2026-11-18.json) and
[braking and tram-pair results](tram-braking-paired-audit-2026-11-18.json). Baseline and working columns in the tables
are **sums of the 20 seed values**; speed and braking-rate levels are their per-seed averages, obtained by dividing by 20.

## Traffic acceptance: poznan vs working tree (20 seeds, 5 min, 15 fps)

Seeds: 61 67 71 73 79 83 89 97 101 103 107 109 113 127 131 137 139 149 151 157. Diff = working − baseline; 95 % CI is a paired bootstrap of the mean diff per seed.

| metric | baseline | working | mean diff / seed | 95 % CI | verdict |
|---|---|---|---|---|---|
| car–tram pairs | 70 | 70 | 0 | [-0.9, +0.9] | within noise |
| holds > 120 s | 18 | 30 | +0.6 | [-0.25, +1.65] | within noise |
| deadlocks | 1 | 2 | +0.05 | [0, +0.15] | within noise |
| max wait s | 2201 | 2475 | +13.7 | [-3.75, +32.55] | within noise |
| km/h all | 305.6 | 304.8 | -0.04 | [-0.21, +0.13] | within noise |
| km/h Jeżyce (info) | 273.2 | 275.2 | +0.1 | [-0.38, +0.56] | within noise |
| km/h Łazarz (info) | 279.6 | 280.5 | +0.04 | [-0.31, +0.37] | within noise |
| km/h Centrum (info) | 288.6 | 284.6 | -0.2 | [-0.65, +0.28] | within noise |
| km/h Kaponiera (info) | 262.4 | 261.7 | -0.03 | [-0.35, +0.27] | within noise |
| km/h Stare Miasto (info) | 360.6 | 356.2 | -0.22 | [-0.51, +0.12] | within noise |
| km/h Rataje (info) | 343.6 | 344.6 | +0.05 | [-0.24, +0.35] | within noise |
| km/h Wilda (info) | 344.8 | 344.8 | 0 | [0, 0] | within noise |

Per-seed paired values (baseline → working (diff)):

| seed | car–tram pairs | holds > 120 s | deadlocks |
|---|---|---|---|
| 61 | 4 → 3 (-1) | 0 → 0 (0) | 0 → 0 (0) |
| 67 | 2 → 2 (0) | 0 → 2 (+2) | 0 → 0 (0) |
| 71 | 5 → 2 (-3) | 2 → 2 (0) | 0 → 0 (0) |
| 73 | 3 → 2 (-1) | 0 → 2 (+2) | 0 → 0 (0) |
| 79 | 3 → 5 (+2) | 1 → 0 (-1) | 0 → 0 (0) |
| 83 | 4 → 2 (-2) | 3 → 0 (-3) | 0 → 0 (0) |
| 89 | 2 → 3 (+1) | 2 → 1 (-1) | 0 → 0 (0) |
| 97 | 3 → 6 (+3) | 0 → 3 (+3) | 0 → 0 (0) |
| 101 | 1 → 1 (0) | 0 → 0 (0) | 0 → 0 (0) |
| 103 | 6 → 3 (-3) | 0 → 0 (0) | 1 → 1 (0) |
| 107 | 3 → 5 (+2) | 0 → 0 (0) | 0 → 0 (0) |
| 109 | 3 → 1 (-2) | 0 → 1 (+1) | 0 → 0 (0) |
| 113 | 3 → 4 (+1) | 1 → 0 (-1) | 0 → 0 (0) |
| 127 | 3 → 3 (0) | 0 → 0 (0) | 0 → 0 (0) |
| 131 | 2 → 5 (+3) | 9 → 8 (-1) | 0 → 0 (0) |
| 137 | 4 → 7 (+3) | 0 → 0 (0) | 0 → 0 (0) |
| 139 | 4 → 3 (-1) | 0 → 0 (0) | 0 → 0 (0) |
| 149 | 10 → 6 (-4) | 0 → 3 (+3) | 0 → 0 (0) |
| 151 | 4 → 6 (+2) | 0 → 8 (+8) | 0 → 1 (+1) |
| 157 | 1 → 1 (0) | 0 → 0 (0) | 0 → 0 (0) |

New deadlock patterns (in ≥ 3 working seeds, none of the baseline's): none

No statistically clear regression.

The additional paired audit produced:

| metric | baseline | working | mean diff / seed | 95 % CI | verdict |
|---|---|---|---|---|---|
| below -3 per tram-hour | 132.61 | 81.72 | -2.54 | [-2.79, -2.29] | better |
| below -5 per tram-hour | 94.5 | 64.71 | -1.49 | [-1.74, -1.23] | better |
| at/below -8.5 per tram-hour | 74.42 | 45.98 | -1.42 | [-1.63, -1.21] | better |
| observed gate-frame overruns | 444 | 208 | -11.8 | [-13.7, -10] | better |
| tram–tram pairs | 40 | 33 | -0.35 | [-0.75, 0] | within noise |
| tram km/h (including dwells) (info) | 250.26 | 251.64 | +0.07 | [-0.02, +0.16] | within noise |

The baseline covered 255.03 tram-hours and the variant 254.04. Across all active tram time, the below −3 / below −5 /
≤ −8.5 counts were 1691 / 1205 / 949 versus 1038 / 822 / 584: rates 6.63 / 4.72 / 3.72 versus 4.09 / 3.24 / 2.30
per tram-hour. The last rate fell by about 38%. Mean tram speed including dwell was 12.51 versus 12.58 km/h; the paired
mean difference +0.07 km/h has 95% CI [−0.02, +0.16]. The 15 fps traffic result had 70 car–tram pairs on each side;
holds over 120 s were 18 versus 30 and deadlocks 1 versus 2, with both intervals including zero. This does not prove
the counts are equal. Tram–tram pairs were 40 versus 33, with the upper CI endpoint at zero. Observed gate-frame
crossings fell from 444 to 208, but the earlier stated coverage limitations remain: a gate first seen behind a tram and
an unobserved red or buffer-end overrun are not counted. The variant exposes additional distant gates to this diagnostic,
so the two sides do not have identical observation opportunities. These results meet the requested statistical rule;
they do not prove that every tram can stop without emergency braking or that all crossings are safe.

Post-change verification: `node --test tests/` passed all 690 tests. A one-minute Wilda smoke run had identical active
tram time, distance and braking episode counts with and without the trace instrumentation.
