# Scene-build workers: dependency, boundary and critical-path study (2026-11-12)

## Result and decision

**Stage 1 only; no production worker path ships in this pass.** `js/` is untouched, there is no worker entry,
fallback switch or `?workers=0`, and the production boot stays synchronous. This is a no-go on the current build,
not on the idea of workers: the measured 6× budgets are large enough to attract a worker, but the build is a
dependency chain and every usable pure payload is either too late to overlap or too large to rehydrate.

The 6× baseline is precompile **40.204 s** and navigation-to-ready **53.872 s** (median of three, Chrome 157, Apple
M5 Pro, headless WebGPU). Sampled CPU says the big phases are mostly pure application logic, not three.js: blocks
6.72 s of 6.88 s, streetDetails 8.64 s of 9.09 s, the runtime signal audit 5.56 s of 5.56 s and cityGrid 3.74 s of
7.63 s. That does **not** make them movable. Their measured plain-record outputs are 50-73 MiB (blocks), 52 MiB
(cityGrid) and 15.4 MiB (streetDetails footprints + colliders, before its unsized tree sites), and the first two are
needed by the next builder before any independent main-thread work can run.

The only candidate with a useful overlap is the runtime signal-head layout (`auditRuntimeSignalHeads`, 5.56 s,
almost no three.js). The realistic model saves **2.4-3.2 s** at 6×: trees, traffic actors and the remaining traffic
setup (about 2.7-3.5 s) can run while a worker rebuilds the network, tram/rail supports and heads; a 0.3 s result
application is paid afterwards. Only the optimistic end reaches 3 s, which is not outside run-to-run drift. A
support-only layout could move the audit earlier and model about **4 s**, but that needs a new pure extraction from
`tram-infra.js` and still makes every worker import city-config: the browser worker probe retains **85.0 MiB** after
GC for config + geodata alone, before network, pedestrian routes and heads. That worsens the load peak, which the
task forbids. No other phase has an overlap window above 0.5 s.

The previous take-over's tram/rail scratch worker remains the only measured candidate: precompile regressed
6.233 → 6.400 s at 1× and 40.204 → 42.734 s at 6×; the 6× worker was **not** CPU-throttled, so the honest phone
case is worse. That alone would not settle the question; the big-budget analysis above does.

## Method

- The baseline harness was rebuilt by the previous take-over and is retained under `.agent-task/perf/`. Chrome 157,
  headless WebGPU, 1280 × 720, DPR 1, isolated profile, local static server; `?quality=high&stats=1`; a 200 µs CPU
  profile from navigation to the actual `[init]` line; forced GC then `Runtime.getHeapUsage`. Three runs per
  throttle. Raw files: `baseline-{1,6}-{1,2,3}.json`, `summary.json`.
- This take-over adds three analyses, all scratch and untracked:
  1. **Call-tree split** of the three baseline-6 profiles (`analyze-split.mjs`, `analyze-tree.mjs`): sampled self
     time under each builder, split into application modules, three.js/TSL and other. "Application" is an upper
     bound on movable logic; it includes some inlined geometry record work.
  2. **Boundary-size probe** (`boundary-size.mjs`): builds blocks → cityGrid → streetDetails → traffic → tram/rail
     layouts → runtime heads with the real geodata/config and inert three.js (the test harness convention). It
     serializes exactly the plain records a worker protocol would return and writes
     `boundary-size.json` / `boundary-size-nosup.json`.
  3. **Worker throttle/heap probe** (`worker-probe/`): a page starts a module worker that dynamically imports
     geodata and city-config; CDP auto-attaches to the worker target, applies the page throttle, resumes it, and
     reads the worker heap after forced GC. Six runs, page 1× and 6×.
- The critical-path model uses the browser phase medians below, the sampled builder splits and the measured
  payloads. It is a model, not a worker implementation; every assumption is named where its number appears.
- The machine is shared. Paired baseline precompile at 6× ranges 41.4-45.4 s in the previous record; phase drift and
  shader compilation are outside this comparison. CPU throttling is synthetic, not a phone or thermal model.

## Build dependency graph

Arrows are data dependencies, not just the current source order. All scene, material, geometry, canvas and DOM
creation stays on the main thread in every proposal below. Geodata is immutable; config also owns mutable shared
signal plans.

| Builder/phase | Reads | Produces and ordering constraints |
|---|---|---|
| Module evaluation / city config | GEO land/holes/roads/bridges/blocks/signals | Land code/distance rasters; block/road/park indexes; derived roads/blocks; shared signal sites/plans. Runs synchronously at import, before `[init]`. |
| landmarks | GEO/config sites, shared materials | Scene, colliders, raised-ground additions; colliders feed grid/wall placement and controllers. |
| blocks | GEO buildings/industry/parks, blocks, rail clearance | Scene, ordered `allBlocks`, colliders, per-block footprints, later slab population. Footprints are required by park cutting and grid lot reuse. |
| cityGrid | Land/roads/parks/rail/plazas, building footprints/colliders | Geometry/scene interleaved with cut rings, sidewalks, footprints, colliders and prop colliders; writes live sidewalk/plaza/tree/lamp arrays consumed later. Releases park indexes. |
| airport / canopies | GEO/config and quality/materials | Independent scene layers and player colliders; their colliders must exist before furniture/network placement but their builders are not grid-dependent (except the declared order). |
| leftover slabs | Block records plus grid live arrays | Appends to `parkTreeSites`; must run before street trees consume that array. |
| outskirts | GEO/config extent, seeded generator | Scene and colliders; independent of the graph, but colliders go into furniture/network inputs. |
| bridges | Config bridges, grid sidewalks | Scene/deck/colliders; grid dependency and collider feed prevent moving it freely after network start. |
| street furniture, before trees | Roads/blocks/plazas, all preceding colliders, shared signal sites/plans | Canvases/name plates, scene instances, audio signals, ordered traffic footprints and player colliders. Footprints must be final before the road network. |
| road network (inside streetDetails) | GEO road graph, sidewalks, final furniture/grid footprints, low non-OBB colliders, land queries, SIGNAL_SITES | Cyclic nodes/edges/paint edges plus closure-backed clearance and connector queries. Resets/mutates shared signal plans, aliases timing objects, preserves site/arm identity. |
| street trees, after network | Finished network lanes/turns/crossing envelopes; grid/slab/mapped tree sites, species crown radii and walls | Exact tree sites, scene field and player colliders. Adds no traffic footprints; the network is already final. |
| traffic and pedestrian routes | Finished network, building colliders, rail clearance, pedestrian ways, tier population | Models/canvases/pools plus closures and lazy tracks/links; route construction changes crosswalk configuration, signal clearance and plans. Lazy materialisation order matters. |
| tram layout | GEO tram tracks/stops, land/block queries, finished lane/turn geometry | Plain track/platform/support arrays plus lane/track distance closures. Independent of trees/actors; support arrays feed runtime signal placement. |
| rail layout | GEO mainline tracks, bridges/plazas, land/block/road queries, finished lane/turn geometry | Track/viaduct/fence/mast arrays, keep-out tiles and query closures. Independent of tram layout, but a larger return/rehydration boundary. |
| runtime signal heads | Network, materialised pedestrian links, tram poles + rail masts, existing furniture/walls | Appends heads/poles/arms/footprints/colliders and updates shared signal state; actual construction, not a removable audit. |
| paint / tram assembly | Network/crosswalks/rail clearance; both layouts | Paint buffers and infrastructure scene/colliders/stops. Rail assembly reads `elevationAt`; controllers retain `corridor.has`. |
| tram simulation | GEO rail/routes, stops, traffic, road graph and shared signals | Pure track graph first; then road mappings/signals, models/pool and runtime closures. Initial graph can build early, mappings/actors cannot. |
| controllers / cameras / audio | All final colliders, keep-out query, saved state, actor/furniture public fields | Scene objects, DOM/input, persistence, audio and camera state. |
| culling / matrices / postFX / UI | All scene roots and quality/device | Chunks, shadow stand-ins, final static matrices, render pipeline, map and HUD. Then shader compile, warm-up and GPU completion. |

Determinism: buildings reseed per block; city-grid/street-details use position hashes; outskirts/trees have fixed
local generators. The traffic/pedestrian `Math.random` stream and the tram simulation's seeded stream must retain
call order. Moving deterministic tram/rail layouts or signal placement does not consume either stream, but moving
street trees or traffic actors would. Array order is observable: segment-grid crossing iteration chooses dropper
order, pole lookup preserves first-index ties, and graph/site identities connect shared timing plans. Structured
clone preserves cycles within a packet but does not reconnect clones to the main thread's existing config objects.

## Where the 6× time goes

Phase medians from the three baseline-6 runs, sampled application/three.js split from the same profiles, and the
plain-data payloads measured by the boundary probe. Payloads are JSON encodings of the real headless world, not live
heap; they are upper bounds on a text protocol and lower bounds on a naive object clone with per-record overhead.

| Builder / phase | 6× phase (ms) | Sampled app logic (ms) | Sampled three.js (ms) | Plain payload (MiB) | Independent main work available |
|---|---:|---:|---:|---:|---|
| blocks | 7,324 | 6,722 | 147 | 50.3 `allBlocks` + 13.4 colliders + 9.0 footprints | landmarks 0.49 s only; cityGrid waits for the footprints |
| cityGrid | 8,196 | 3,735 | 3,889 | 30.1 sidewalk blocks + 14.0 park tree sites + 8.0 prop colliders + 0.4 footprints/sidewalks | airport + canopies + outskirts ≈ 0.42 s; bridges need the grid sidewalks |
| streetDetails | 9,629 | 8,635 | 447 | 4.0 traffic footprints + 11.4 colliders + tree sites not sized | none before the road network; trees need the network |
| traffic: createTrafficSystem | 813 | 691 | 101 | actor pools/closures not sized | audit does not depend on the actors |
| traffic: tram + rail layouts | 1,910 | 1,910 | 0 | 0.33 supports + large track/fence arrays | createTrafficSystem 0.81 s |
| traffic: runtime signal heads | 5,563 | 5,558 | 5 | 0.04 heads + 2.32 compact network + 0.33 supports | trees 1.5-2.0 s + actors 0.81 s + other traffic ≈ 0.5-0.7 s |
| culling | 2,838 | 1,287 | 1,370 | matrices/shadow buffers not sized | none; all roots and matrices are final |
| land raster (outside `[init]`) | ~887 incl. | ~887 | 0 | two byte arrays ≈ 36.9 MiB | short; config consumers run immediately after import |

The streetDetails split is not a phase stopwatch: the call tree gives the road network 2.586 s inclusive and the
street-detail/tree code the rest. A scratch section-timing copy gives tree-section : network : furniture proportions
of roughly 1.15 : 1.70 : 0.73 in Node; scaled to the 9.63 s browser phase, trees are about 1.5-2.0 s. The record
uses that range and states it rather than presenting a single stopwatch value.

## Candidate ranking and critical path

"Movable" is the sampled app-logic budget, not a promise. "Overlap" is main-thread work that can run while the
worker branch runs. A single worker does not use a second core for the main thread's own sequential work; 2/4/8
usable cores therefore give the same estimate for one worker unless a multi-worker pipeline is built (a different
program, last row).

| Candidate | Movable 6× | Fixed worker cost | Boundary and main-thread work | Overlap | Critical-path estimate |
|---|---:|---|---|---|---|
| blocks layout | 6.72 s | startup 0.41 s + config 0.39 s at 1×, ≈4.8 s at honest 6× if not hidden; 85 MiB retained | 63-73 MiB records; rehydration and block streaming stay main-thread; grid waits for footprints | landmarks 0.49 s | ≤0.5 s saved; not worth a protocol |
| cityGrid layout | 3.74 s (3.89 s three.js must stay) | same fixed cost | 52 MiB records; shape/triangulation/instance assembly stays main-thread; streetDetails waits | airport/canopies/outskirts 0.42 s | ≤0.4 s saved |
| streetDetails layout | 8.64 s | same | 15.4 MiB measured records plus unsized tree sites and the cyclic network; trees and network are a hard barrier; assembly stays main-thread | none before network | one worker does not shorten the chain; a layout/assembly split could overlap only ~0.5 s of assembly |
| traffic actors | 0.81 s | same | actor pools, closures and models; audit does not need them | audit is the longer branch | ≤0.8 s |
| tram + rail layouts | 1.91 s | same | 0.33 MiB supports plus large arrays and distance closures | createTrafficSystem 0.81 s | ≤0.8 s; measured scratch candidate regressed |
| runtime signal heads | 5.56 s | same | 2.32 MiB compact network (or rebuild 2.59 s) + 0.33 MiB supports + 0.04 MiB heads; rehydration/application ≈ 0.3 s | trees 1.5-2.0 s + actors 0.81 s + other traffic 0.5-0.7 s | 2.4-3.2 s net; central ≈2.8 s, optimistic 3.2 s, not clearly above 3 |
| culling | 1.29 s app + 1.37 s three.js | same | source matrices/buffers; shadow triangle bake | none | ≤1 s, below gate |
| land raster | 0.89 s | same | ≈37 MiB byte arrays; narrow async-ready contract before land consumers | short | ≤0.9 s, below gate |

Critical-path arithmetic for the signal-head worker, measured components at 6×:

- From the start of the road network: baseline = network 2.586 + trees 1.75 + actors 0.813 + layouts 1.910 +
  audit 5.563 + other traffic ≈ 0.55 = **13.17 s**. The worker path = network 2.586 + layouts 1.910 + audit 5.563
  = **10.06 s**, with the main thread doing trees + actors + other in 3.1 s and then waiting; add ≈0.3 s to apply
  the head records, so **10.36 s**. Central saving **2.8 s**. The optimistic tree/other end (2.0 + 0.7) gives
  3.2 s; the pessimistic end (1.5 + 0.4) gives 2.4 s. The gate is 3 s well outside drift, so this does not clear
  it.
- A support-only layout (new pure module, estimated 0.7 s, not measured) would let the audit start while the main
  thread runs the full tram/rail layouts; the model becomes 2.586 + 0.7 + 5.563 = **8.85 s**, saving about 4.3 s
  gross / 4.0 s net. It does not change the 85 MiB config worker or the network/routes it must hold, and the
  support extraction is not a small boundary.
- One worker is one extra core. A multi-worker pipeline (blocks → grid → street/network → audit) would use 2/4/8
  cores, but requires every builder to be split into pure layout and main assembly with flat protocols. As a
  planning bound only, moving 12 s of genuinely independent pure work with 1 s of main packing gives
  `40.204 − 12 + 1 + 12/cores` = **35.2 / 32.2 / 30.7 s** precompile on 2/4/8 cores. No single phase above
  reaches that bound; it is the reason to revisit workers only with a broader rewrite.

## Boundary and worker costs

**Payloads** measured by `boundary-size.mjs` from the real headless world (JSON encoding, MiB; not clone time and
not live heap):

| Output | Records | MiB |
|---|---:|---:|
| blocks `allBlocks` | 21,724 block details | 50.3 |
| block colliders | 51,893 | 13.4 |
| block footprints by block | — | 9.0 |
| grid sidewalk blocks | — | 30.1 |
| grid park tree sites | 61,550 | 14.0 |
| grid prop colliders | 63,231 | 8.0 |
| grid footprints/sidewalks | 231 / — | 0.4 |
| street traffic footprints | 35,547 | 4.0 |
| street player colliders | 95,500 | 11.4 |
| audit runtime heads | 171 | 0.04 |
| compact network (nodes/edges/lanes/moves) | 7,891 / 12,992 / 16,578 lanes | 2.32 |
| tram poles + rail masts | 4,491 + 1,650 | 0.33 |

The compact network packet is an explicit numeric encoding (nodes, edges, lane offsets, move tables), not a
production protocol; connectors, curves, closure-backed clearance queries and signal-plan identities still have to
be rebuilt or indexed. A direct `structuredClone` of the cyclic network throws stack overflow (previous record).
The traffic audit's own records are small; its input is not.

**Fixed costs**, browser worker probe (module worker, geodata then city-config, CDP worker session):

| Cost | 1× runs | 6× page throttle runs | Honest 6× estimate |
|---|---:|---:|---:|
| worker startup, page wall | 406 / 407 / 408 ms | 421 / 410 / 427 ms | scale by 6: ≈2.4-2.6 s if not hidden |
| geodata import | 14 / 14 / 14 ms (first run 37) | 15 / 15 / 15 ms | ≈0.1 s |
| city-config evaluation | 385 / 387 / 387 ms | 399 / 389 / 405 ms | ≈2.3-2.4 s |
| retained worker heap after GC | 45.8 MiB used + 43.3 MiB backing = **85.0 MiB** | same | before network, routes, heads |

The 6× page throttle did **not** throttle the worker: config took 385-405 ms at both rates. CDP
`Emulation.setCPUThrottlingRate` is rejected on a worker target in Chrome 157 ("Operation is only supported for
pages, not workers"), so a worker-throttled measurement is not available with this harness. A page-throttled run
with an unthrottled worker overstates any gain; the table's honest column multiplies worker work by the page's 6×.
The previous tram candidate's worker was unthrottled, so its measured 6× regression is an upper bound.

Memory: a worker that imports city-config retains 85.0 MiB after GC before building the network, pedestrian routes
and heads; the main page's retained heap is already 844.4 MiB at 6×. Terminating the worker after the build does
not remove the load-time peak. No SharedArrayBuffer or special headers are assumed.

Previous tram/rail boundary results, retained for comparison: direct cyclic clone fails; the flat lane-chord packet
is 5,994,240 bytes (187,320 Float64 chords); lane capture 34-38 ms at 1× / 239.8 ms at 6×; worker startup
464-521 ms, config 403-437 ms, geodata 14-37 ms; tram layout 109-116 ms, rail 197-219 ms, output clone 26-37 ms.
The concurrent tram-only candidate measured 6.400 s / 42.734 s precompile at 1× / 6× against 6.233 / 40.204
baseline; paired 1× was +43 ms and the two available paired 6× runs were mixed/regressive. Its result is not a
60-hash identity proof and its worker was unthrottled.

## What was rejected, and what would have to change

Rejected now: any production worker, `?workers=0`, worker entry module, preload, message protocol, fallback tests,
60-hash comparison, screenshots, actor smoke, backend checks and peak-memory audit. None was implemented, so none
is claimed. The task allows this outcome when the first phase cannot be made bit-identical or does not pay for its
boundary; the numbers above show the current seams do not pay with margin.

To make workers pay, the build needs a different representation before it needs a thread:

1. **Compact, worker-consumable geodata/config.** A worker that imports `city-config.js` repeats the land raster,
   signal plans, derived geometry and indexes: 0.4 s and 85 MiB per worker at 1×, before any layout. A versioned
   projection (only the tables and query indexes the stage needs) or baked layout records would remove that fixed
   cost. Do not import the generated file wholesale in several workers.
2. **Pure layout modules with flat protocols.** Blocks, cityGrid and streetDetails must return polygon/tree/lamp/
   collider/facade records as typed arrays and plain indexed tables, while the main thread creates shapes,
   materials, canvases and instanced meshes. That is a rewrite of each builder's seam, not a move of an existing
   function: the current functions interleave scene construction with layout and return live object graphs.
3. **A pipeline, not one worker.** Blocks → grid → street/network → signal audit can overlap only if each stage
   returns flat records and the main thread assembles the previous stage while the next computes. A single worker
   on the current chain is bounded by the next stage's dependency, which is why the best single-phase estimate is
   ~2.8 s. Measure each stage with worker CPU throttling and process peak, not page throttle alone.
4. **If starting small, start with the signal audit only after a support-only pure layout exists.** It is the only
   current stage with a 5.56 s pure budget and a small result (0.04 MiB). Build the support-only module first,
   prove its output equals `layoutTramInfrastructure().poles` + `layoutRailInfrastructure().masts`, then measure a
   worker-throttled net gain and the 85 MiB fixed heap before writing a protocol.

The backlog's next steps remain: real-device `?stats=1` reports first, then the remaining clearance-helper and
culling work; workers only after a representation change that removes the config re-evaluation.

## Limitations

- No worker-throttled candidate measurement: page throttling demonstrably does not throttle a dedicated worker in
  Chrome 157, and CDP rejects the throttle on the worker target. The honest 6× worker column is a ×6 scaling of
  unthrottled worker time, not a phone measurement.
- Worker heap is config + geodata only (85.0 MiB after GC); network, pedestrian routes, heads and the main page's
  peak are not measured together. The boundary probe uses inert three.js and a Node VM, so its timings are not
  browser phase times; only its record sizes are used.
- Payload sizes are JSON encodings, not structured-clone or transfer costs. The compact network is an encoding
  proposal, not a tested protocol; connectors/curves and signal-plan identity still need an index design.
- The 6× phase medians come from three unpaired runs on a shared machine; shader compilation is outside the
  target and drift is visible in unchanged phases. No real phone, WebGL2 fallback or thermal behavior was checked.
- `js/` is untouched, so the 60 build hashes, screenshots, actor smoke and backend checks were not run. The quick
  suite (`node --test tests/*.cjs`) passes 564/564 and the full suite (`node --test tests/`) passes 580/580, both
  after the documentation edit. No test markers or preload counts change.
