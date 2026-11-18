# Signal span boot cost — 2026-11-18

The headless build was profiled with Node v26.13.1 on arm64, using `node --cpu-prof` and the benchmark's fixed seed 4242. The baseline is `/Users/dminta/Projects/slop-poznan` at 0bc0e6f. These are sampled self counts, not elapsed times; multiple JIT nodes at the same source line are summed.

| Profile location | Baseline samples | Changed samples |
|---|---:|---:|
| `wireClear` predicate (rail-envelope and facade checks) | 150 | 59 |
| `pick` (ordinary pair construction) | 51 | 38 |
| traction pair filter | 24 | 32 |
| `footBuildingClear` | 4 | 6 |
| `wireSupportClear` | 1 | 1 |

Many of the first 64 sorted pairs share an anchor. The ordinary search now caches each anchor's point and stay clearance per target; the traction search caches stay clearance per anchor and target. The wire test uses x/z only, so traction top height does not alter that result. Support-pole clearance still runs per pair because the two skipped anchors vary. Candidate order, checks, thresholds and emitted geometry are unchanged.

The benchmark's 24 hashes match. Its street hashes do not explicitly cover span records, so a scratch copy of the driver additionally hashed every `runtimeHeads` record's edge, position, pole, anchors, anchor flags, height and support flags. That hash matched too (`6f47c4b4822a7a67fc053f33be139edc713fc2135fc932bc543317ebcff4bf25`), covering the stay endpoints and heads. The geometry is deterministically generated from those records. No browser check was performed; this is an exact headless output-preserving change.

Five consecutive interleaved pairs ran baseline then worktree with `node tools/bench-boot-headless.mjs --json ...`, without hashing or concurrent tests. Times are milliseconds; delta is worktree minus baseline.

| Pair | Total base | Total changed | Total delta | signalHeads base | signalHeads changed | signalHeads delta |
|---|---:|---:|---:|---:|---:|---:|
| 1 | 10456.5 | 10483.7 | +27.2 | 2263.0 | 2116.4 | −146.6 |
| 2 | 10660.5 | 10548.5 | −112.0 | 2252.6 | 2161.9 | −90.7 |
| 3 | 10876.6 | 10619.2 | −257.4 | 2291.1 | 2188.7 | −102.4 |
| 4 | 10683.7 | 10618.5 | −65.2 | 2285.0 | 2162.2 | −122.8 |
| 5 | 10805.0 | 10606.7 | −198.3 | 2302.5 | 2148.0 | −154.5 |
| Median | 10683.7 | 10606.7 | −77.0 | 2285.0 | 2161.9 | −123.1 |
| Minimum | 10456.5 | 10483.7 | +27.2 | 2252.6 | 2116.4 | −136.2 |

The median signal phase improved 5.4%, all five paired deltas negative; total median improved 0.7%, four of five paired deltas negative. The earlier +362 ms comparison used different runs and is not directly comparable, so it does not establish how much of that gap remains.

`node --test tests/` passed 684/684 (123.5 s). `git diff --check` passed.
