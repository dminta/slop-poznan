# Tighter static chunk culling (2026-11-12)

Static visible chunks and shadow stand-ins now use cached world-space bounding boxes instead of loose spheres for
frustum tests. The cell sizes, batching, geometry, draw distances and instance buffers are unchanged. Each pass uses
its own frustum, including each cascade only when its map is refreshed. This reduces submitted geometry and renderer
CPU; it does **not** establish a GPU-time improvement on this Apple GPU.

## Method

- Worktree `cx-perf-culling`, based on `19f0970`; served with `python3 -m http.server 8149` (8137 was occupied).
  Production `main.js` is unchanged. The scratch `.agent-task/perf-harness/perf-main.js` is generated from this tree's
  main module and imports production modules. Chrome is headless, WebGPU, 1280 × 720, DPR 1; low keeps its production
  internal ratio of 0.75. No three.js SHA change.
- Initial untouched-tree runs are `before-high.json` / `before-low.json`; the first candidate is `box-*.json` and the
  smaller-cell experiment is `split-low.json`. These early runs stopped actor updates before the first frame, so
  unused pool capacity at the origin contributes submitted triangles. They are useful for the **static** inventory
  and the smaller-cell ablation, not representative total traffic workload.
- The final comparisons (`final-high.json` / `final-low.json`) let actor pools populate before freezing simulation.
  They alternate sphere → box → box → sphere **within one boot**, at each view, with 1.2 s settle and 2.5 s samples.
  The actor placement is fixed within the comparison. Renderer CPU is measured around the real animation loop's
  `renderPipeline.render()`. Each row averages the two samples per arm. This controls boot/cache/placement variance;
  it is still one host and a short synthetic workload.
- Actual `onBeforeRender` hooks capture two consecutive real frames, covering one far-cascade
  refresh and one cached frame. Each instance's transformed geometry sphere is tested against that **draw camera's**
  frustum. Off-screen counts are conservative sphere rejects, not per-triangle clipping or occlusion estimates.
  Expensive inventory traversal is disabled throughout the timed samples. Plain meshes count as one object; the
  instance columns below include only InstancedMesh draws. Geometry triangle counts respect drawRange, but may differ
  slightly from renderer totals for grouped geometry; total frame counts come from `renderer.info`.
- GPU values are medians of the pinned renderer's **summed timestamp queries** (including nested render contexts),
  averaged over the two samples. They are comparative counters, not elapsed frame GPU time. WebGL visual runs disable
  timestamps: enabling them produced nested-query warnings in the scratch harness, unrelated to this change.
- Views, eye → target, metres: Rynek `(0,10,140) → (0,9,0)`, 60°; Centrum drone
  `(-1150,320,900) → (-1100,0,0)`, 55°; Św. Marcin street `(-1100,2.2,130) → (-1120,4,-40)`, 70°;
  eastern estate/outskirts `(2600,120,2000) → (2300,0,1600)`, 55°.

## Final frame comparison

Draws and triangles include scene, the near shadow cascade, half the far-cascade refreshes and post-processing.
Fractional draw counts reflect cadence/sample averages.

| Tier | View | Draws sphere → box | Triangles M sphere → box | Renderer CPU ms sphere → box | GPU query ms sphere → box |
|---|---|---:|---:|---:|---:|
| low | rynek | 856.5 → 840.5 | 4.957 → 4.927 | 6.87 → 6.47 | 6.79 → 6.86 |
| low | centrumDrone | 1113.0 → 997.0 | 5.519 → 4.965 | 8.39 → 7.97 | 5.37 → 5.69 |
| low | marcin | 930.0 → 857.7 | 5.575 → 5.257 | 7.26 → 6.68 | 6.61 → 7.02 |
| low | estate | 2040.0 → 1909.6 | 7.606 → 7.075 | 11.73 → 11.10 | 6.58 → 6.83 |
| high | rynek | 1215.0 → 1183.5 | 5.930 → 5.845 | 9.11 → 9.35 | 28.50 → 26.92 |
| high | centrumDrone | 2124.9 → 1938.7 | 8.080 → 7.277 | 14.78 → 14.33 | 51.51 → 51.71 |
| high | marcin | 1351.7 → 1282.8 | 7.126 → 6.787 | 10.06 → 9.40 | 31.17 → 32.29 |
| high | estate | 2745.0 → 2622.6 | 8.757 → 8.230 | 16.69 → 16.03 | 40.67 → 39.25 |

The high Rynek row includes one slow first box sample (9.64 ms; its second sample was 9.07 ms). An eight-sample
repeat with the populated pools and no inventory between samples gives CPU 9.16 → 8.75 ms
and GPU query 26.92 → 27.01 ms. All samples remain in the scratch report.

The earlier four-second alternating runs (`ab-*.json`, before correcting pool initialisation) also reduced renderer
CPU in all eight tier/view combinations: low 6.88 → 6.57 / 8.20 → 7.74 / 9.42 → 9.15 / 15.67 → 15.14 ms;
high 9.02 → 8.48 / 15.20 → 13.97 / 10.24 → 9.68 / 17.03 → 16.28 ms. GPU query deltas disagreed between separate
boots and alternating runs: for example high Rynek 26.08 → 26.16 ms in separate boots but 26.55 → 29.22 ms in the
alternating run. Do not infer a GPU speed-up from the triangle reduction or hide these contrary measurements.

## Per-pass submitted work

Each entry is **per pass refresh**, not amortised over the cadence: near/scene are divided by two captured frames,
far is one refresh. `Inst on/off` partitions submitted instances; `tri on/off` partitions submitted geometry using the
same conservative bounds test, including plain meshes. These are submission counts, not visible pixel counts.
The final inventory-only repeats (`inventory-final-*.json`) distinguish singleton instanced chunks from plain meshes,
and are separate boots from the CPU samples. Actor placement can differ between boots. Per-pass draw columns count
object hook invocations; `renderer.info` in the frame table is authoritative for actual GPU draw calls.

| Tier | View | Pass | Draws sphere → box | Inst on/off sphere → box | Tri on/off sphere → box |
|---|---|---|---:|---|---|
| low | rynek | scene | 675 → 669 | 60,662/119,567 → 60,661/119,380 | 2,387,991/1,857,853 → 2,387,982/1,847,542 |
| low | rynek | near | 104 → 102 | 826/15,604 → 826/15,590 | 90,336/304,922 → 90,336/304,250 |
| low | rynek | far | 181 → 165 | 2,949/17,649 → 2,949/14,909 | 167,988/304,153 → 164,836/269,230 |
| low | centrumDrone | scene | 824 → 754 | 102,901/107,801 → 102,901/85,875 | 3,221,796/1,722,494 → 3,221,796/1,318,092 |
| low | centrumDrone | near | 101 → 60 | 3/11,673 → 3/6,739 | 50,496/234,932 → 37,202/117,268 |
| low | centrumDrone | far | 415 → 405 | 4,690/12,209 → 4,690/11,028 | 164,682/253,993 → 164,326/217,990 |
| low | marcin | scene | 725 → 674 | 89,227/124,389 → 89,227/111,654 | 2,962,078/2,084,891 → 2,962,078/1,814,305 |
| low | marcin | near | 132 → 114 | 569/10,951 → 569/8,802 | 90,105/186,390 → 90,105/146,562 |
| low | marcin | far | 170 → 164 | 1,996/13,236 → 1,996/12,936 | 122,835/220,936 → 122,835/207,556 |
| low | estate | scene | 1911 → 1825 | 213,998/75,120 → 213,997/58,138 | 5,683,236/1,485,630 → 5,683,224/1,047,754 |
| low | estate | near | 89 → 55 | 17/7,555 → 17/6,013 | 40,182/189,872 → 28,951/124,814 |
| low | estate | far | 119 → 98 | 1,386/7,118 → 1,386/6,158 | 82,205/172,600 → 77,432/143,342 |
| high | rynek | scene | 766 → 760 | 60,979/119,541 → 60,978/119,354 | 2,452,967/1,891,057 → 2,452,958/1,880,746 |
| high | rynek | near | 239 → 225 | 2,208/17,908 → 2,208/16,880 | 392,615/412,446 → 379,854/389,736 |
| high | rynek | far | 405 → 382 | 9,593/15,556 → 9,593/13,113 | 859,027/494,775 → 840,514/435,120 |
| high | centrumDrone | scene | 1305 → 1235 | 112,600/107,737 → 112,600/85,811 | 4,325,896/1,806,950 → 4,325,896/1,402,548 |
| high | centrumDrone | near | 249 → 148 | 14/21,157 → 14/10,760 | 147,764/743,569 → 71,493/482,530 |
| high | centrumDrone | far | 1136 → 1113 | 19,817/22,510 → 19,816/19,893 | 1,451,804/445,910 → 1,397,833/388,965 |
| high | marcin | scene | 848 → 797 | 89,606/124,412 → 89,606/111,677 | 3,084,658/2,099,359 → 3,084,658/1,828,773 |
| high | marcin | near | 258 → 250 | 1,266/12,931 → 1,266/12,532 | 463,315/496,626 → 450,537/473,789 |
| high | marcin | far | 476 → 456 | 8,637/15,786 → 8,637/12,317 | 1,180,503/581,379 → 1,180,503/515,263 |
| high | estate | scene | 2340 → 2254 | 216,412/75,174 → 216,411/58,192 | 5,995,852/1,487,958 → 5,995,840/1,050,082 |
| high | estate | near | 201 → 171 | 530/8,735 → 530/7,839 | 128,966/457,219 → 116,740/404,010 |
| high | estate | far | 406 → 392 | 4,630/9,395 → 4,630/8,945 | 657,787/507,377 → 645,030/469,501 |

## Ranked off-screen static mesh families, before / after

Ranked by submitted off-screen triangles in the scene pass. Families retain the production mesh name; `∅` means
unnamed. The `#` is the representative object's browser ID from the same boot (chunks share `sharesPipelineWith`),
not a new production name. Shadow families use shared geometry IDs. This distinguishes original batches that have the
same empty name and triangle count. Instance counts are submitted counts, not citywide capacity. Extents are the
range of actual chunk X/Z spans (m), or the original sphere diameter (Ø) where X/Z was not captured; grid cells remain 1000 m for large visible batches, 500 m for proxies,
and size-based 250–1200 m for small props. Unchunked small-radius families retain their original field bounds.

### low, rynek

| Mesh family | Chunk bound spans m (Ø = sphere) | Tris/instance | Instances sphere → box | Off-screen share sphere → box | Off-screen tris sphere → box |
|---|---:|---:|---:|---:|---:|
| StreetDetails/∅ #60878 | 315–1001 | 120 | 5,295 → 5,191 | 48.4% → 47.4% | 307,680 → 295,200 |
| TramInfrastructure/TramRails #56201 | 790–1206 | 12 | 18,616 → 18,616 | 73.5% → 73.5% | 164,232 → 164,232 |
| StreetDetails/∅ #31232 | Ø 2676–2676 | 176 | 1,074 → 1,074 | 67.7% → 67.7% | 127,952 → 127,952 |
| StreetDetails/∅ #61052 | 323–1002 | 12 | 8,747 → 8,747 | 50.5% → 50.5% | 52,956 → 52,956 |
| TramInfrastructure/CatenaryPoles #56357 | 165–897 | 80 | 686 → 686 | 76.4% → 76.4% | 41,920 → 41,920 |
| StreetDetails/∅ #56060 | 1194–1202 | 12 | 5,960 → 6,886 | 53.1% → 59.4% | 38,004 → 49,116 |
| CityBlocks/Roof-dormer #60305 | 480–1003 | 11 | 6,208 → 6,208 | 53.3% → 53.3% | 36,410 → 36,410 |
| CityBlocks/∅ #3267 | Ø 2–2 | 24 | 1,900 → 1,900 | 72.4% → 72.4% | 33,024 → 33,024 |

### low, centrumDrone

| Mesh family | Chunk bound spans m (Ø = sphere) | Tris/instance | Instances sphere → box | Off-screen share sphere → box | Off-screen tris sphere → box |
|---|---:|---:|---:|---:|---:|
| StreetDetails/∅ #60878 | 315–1001 | 120 | 6,826 → 5,258 | 40.1% → 22.3% | 328,680 → 140,520 |
| StreetDetails/∅ #31232 | Ø 2676–2676 | 176 | 1,074 → 1,074 | 81.0% → 81.0% | 153,120 → 153,120 |
| TramInfrastructure/TramRails #56201 | 1202–1207 | 12 | 24,202 → 24,202 | 37.5% → 37.5% | 108,972 → 108,972 |
| StreetDetails/∅ #56060 | 1194–1202 | 12 | 6,347 → 4,846 | 65.1% → 54.2% | 49,548 → 31,536 |
| CityBlocks/Roof-dormer #60305 | 253–1003 | 11 | 9,021 → 6,426 | 47.7% → 26.6% | 47,377 → 18,832 |
| CityBlocks/Roof-mansardCap #60219 | 486–1016 | 9 | 8,833 → 6,209 | 47.5% → 25.4% | 37,791 → 14,175 |
| StreetDetails/∅ #61052 | 323–1002 | 12 | 9,416 → 8,460 | 33.0% → 25.4% | 37,284 → 25,812 |
| TramInfrastructure/TramRailGrooves #56247 | 221–504 | 12 | 3,176 → 2,355 | 92.7% → 90.1% | 35,328 → 25,476 |

### low, marcin

| Mesh family | Chunk bound spans m (Ø = sphere) | Tris/instance | Instances sphere → box | Off-screen share sphere → box | Off-screen tris sphere → box |
|---|---:|---:|---:|---:|---:|
| StreetDetails/∅ #60878 | 315–1001 | 120 | 6,738 → 5,697 | 47.2% → 37.5% | 381,600 → 256,680 |
| TramInfrastructure/TramRails #56201 | 939–1207 | 12 | 28,446 → 28,446 | 60.7% → 60.7% | 207,324 → 207,324 |
| StreetDetails/∅ #31232 | Ø 2676–2676 | 176 | 1,074 → 1,074 | 99.6% → 99.6% | 188,320 → 188,320 |
| TramInfrastructure/CatenaryPoles #56357 | 306–897 | 80 | 1,237 → 1,069 | 68.4% → 63.4% | 67,680 → 54,240 |
| StreetDetails/∅ #61052 | 323–1002 | 12 | 9,362 → 8,654 | 43.3% → 38.7% | 48,672 → 40,176 |
| StreetDetails/∅ #56060 | 1196–1202 | 12 | 7,493 → 7,493 | 48.5% → 48.5% | 43,608 → 43,608 |
| TramInfrastructure/TramRailGrooves #56247 | 164–503 | 12 | 5,117 → 5,117 | 63.9% → 63.9% | 39,216 → 39,216 |
| CityBlocks/Roof-dormer #60305 | 99–1003 | 11 | 7,006 → 5,781 | 50.6% → 40.2% | 39,028 → 25,553 |

### low, estate

| Mesh family | Chunk bound spans m (Ø = sphere) | Tris/instance | Instances sphere → box | Off-screen share sphere → box | Off-screen tris sphere → box |
|---|---:|---:|---:|---:|---:|
| StreetDetails/∅ #60878 | 70–1002 | 120 | 18,116 → 15,886 | 26.9% → 16.6% | 584,040 → 316,440 |
| StreetDetails/∅ #61052 | 67–1002 | 12 | 26,648 → 24,531 | 25.4% → 19.0% | 81,372 → 55,968 |
| CityBlocks/∅ #60788 | 118–1229 | 12 | 15,970 → 13,987 | 26.2% → 15.7% | 50,124 → 26,340 |
| TramInfrastructure/RailBallast #61186 | 11–1008 | 12 | 11,614 → 10,760 | 31.0% → 25.5% | 43,152 → 32,904 |
| TramInfrastructure/TramRails #56201 | 410–1204 | 12 | 7,591 → 6,687 | 41.0% → 33.0% | 37,332 → 26,484 |
| CityBlocks/∅ #60456 | 47–1060 | 12 | 12,811 → 11,558 | 21.2% → 12.7% | 32,640 → 17,604 |
| StreetDetails/∅ #56060 | 443–1201 | 12 | 4,431 → 4,247 | 54.9% → 53.0% | 29,208 → 27,000 |
| CityBlocks/Roof-dormer #60305 | 6–1004 | 11 | 14,098 → 13,668 | 18.6% → 16.1% | 28,897 → 24,167 |

### high, rynek

| Mesh family | Chunk bound spans m (Ø = sphere) | Tris/instance | Instances sphere → box | Off-screen share sphere → box | Off-screen tris sphere → box |
|---|---:|---:|---:|---:|---:|
| StreetDetails/∅ #70338 | 315–1001 | 120 | 5,295 → 5,191 | 48.4% → 47.4% | 307,680 → 295,200 |
| TramInfrastructure/TramRails #66084 | 790–1206 | 12 | 18,616 → 18,616 | 73.5% → 73.5% | 164,232 → 164,232 |
| StreetDetails/∅ #31232 | Ø 2676–2676 | 176 | 1,074 → 1,074 | 67.7% → 67.7% | 127,952 → 127,952 |
| StreetDetails/∅ #70512 | 323–1002 | 12 | 8,747 → 8,747 | 50.5% → 50.5% | 52,956 → 52,956 |
| TramInfrastructure/CatenaryPoles #66240 | 165–897 | 80 | 686 → 686 | 76.4% → 76.4% | 41,920 → 41,920 |
| StreetDetails/∅ #65943 | 1194–1202 | 12 | 5,960 → 6,886 | 53.1% → 59.4% | 38,004 → 49,116 |
| CityBlocks/Roof-dormer #69765 | 480–1003 | 11 | 6,208 → 6,208 | 53.3% → 53.3% | 36,410 → 36,410 |
| CityBlocks/∅ #3267 | Ø 2–2 | 24 | 1,900 → 1,900 | 72.4% → 72.4% | 33,024 → 33,024 |

### high, centrumDrone

| Mesh family | Chunk bound spans m (Ø = sphere) | Tris/instance | Instances sphere → box | Off-screen share sphere → box | Off-screen tris sphere → box |
|---|---:|---:|---:|---:|---:|
| StreetDetails/∅ #70338 | 315–1001 | 120 | 6,826 → 5,258 | 40.1% → 22.3% | 328,680 → 140,520 |
| StreetDetails/∅ #31232 | Ø 2676–2676 | 176 | 1,074 → 1,074 | 81.0% → 81.0% | 153,120 → 153,120 |
| TramInfrastructure/TramRails #66084 | 1202–1207 | 12 | 24,202 → 24,202 | 37.5% → 37.5% | 108,972 → 108,972 |
| StreetDetails/∅ #65943 | 1194–1202 | 12 | 6,347 → 4,846 | 65.1% → 54.2% | 49,548 → 31,536 |
| CityBlocks/Roof-dormer #69765 | 253–1003 | 11 | 9,021 → 6,426 | 47.7% → 26.6% | 47,377 → 18,832 |
| CityBlocks/Roof-mansardCap #69679 | 486–1016 | 9 | 8,833 → 6,209 | 47.5% → 25.4% | 37,791 → 14,175 |
| StreetDetails/∅ #70512 | 323–1002 | 12 | 9,416 → 8,460 | 33.0% → 25.4% | 37,284 → 25,812 |
| TramInfrastructure/TramRailGrooves #66130 | 221–504 | 12 | 3,176 → 2,355 | 92.7% → 90.1% | 35,328 → 25,476 |

### high, marcin

| Mesh family | Chunk bound spans m (Ø = sphere) | Tris/instance | Instances sphere → box | Off-screen share sphere → box | Off-screen tris sphere → box |
|---|---:|---:|---:|---:|---:|
| StreetDetails/∅ #70338 | 315–1001 | 120 | 6,738 → 5,697 | 47.2% → 37.5% | 381,600 → 256,680 |
| TramInfrastructure/TramRails #66084 | 939–1207 | 12 | 28,446 → 28,446 | 60.7% → 60.7% | 207,324 → 207,324 |
| StreetDetails/∅ #31232 | Ø 2676–2676 | 176 | 1,074 → 1,074 | 99.6% → 99.6% | 188,320 → 188,320 |
| TramInfrastructure/CatenaryPoles #66240 | 306–897 | 80 | 1,237 → 1,069 | 68.4% → 63.4% | 67,680 → 54,240 |
| StreetDetails/∅ #70512 | 323–1002 | 12 | 9,362 → 8,654 | 43.3% → 38.7% | 48,672 → 40,176 |
| StreetDetails/∅ #65943 | 1196–1202 | 12 | 7,493 → 7,493 | 48.5% → 48.5% | 43,608 → 43,608 |
| TramInfrastructure/TramRailGrooves #66130 | 164–503 | 12 | 5,117 → 5,117 | 63.9% → 63.9% | 39,216 → 39,216 |
| CityBlocks/Roof-dormer #69765 | 99–1003 | 11 | 7,006 → 5,781 | 50.6% → 40.2% | 39,028 → 25,553 |

### high, estate

| Mesh family | Chunk bound spans m (Ø = sphere) | Tris/instance | Instances sphere → box | Off-screen share sphere → box | Off-screen tris sphere → box |
|---|---:|---:|---:|---:|---:|
| StreetDetails/∅ #70338 | 70–1002 | 120 | 18,116 → 15,886 | 26.9% → 16.6% | 584,040 → 316,440 |
| StreetDetails/∅ #70512 | 67–1002 | 12 | 26,648 → 24,531 | 25.4% → 19.0% | 81,372 → 55,968 |
| CityBlocks/∅ #70248 | 118–1229 | 12 | 15,970 → 13,987 | 26.2% → 15.7% | 50,124 → 26,340 |
| TramInfrastructure/RailBallast #70646 | 11–1008 | 12 | 11,614 → 10,760 | 31.0% → 25.5% | 43,152 → 32,904 |
| TramInfrastructure/TramRails #66084 | 410–1204 | 12 | 7,591 → 6,687 | 41.0% → 33.0% | 37,332 → 26,484 |
| CityBlocks/∅ #69916 | 47–1060 | 12 | 12,811 → 11,558 | 21.2% → 12.7% | 32,640 → 17,604 |
| StreetDetails/∅ #65943 | 443–1201 | 12 | 4,431 → 4,247 | 54.9% → 53.0% | 29,208 → 27,000 |
| CityBlocks/Roof-dormer #69765 | 6–1004 | 11 | 14,098 → 13,668 | 18.6% → 16.1% | 28,897 → 24,167 |

### Ranked instanced shadow casters

| Tier / view | Cascade | Family (triangles/instance) | Instances sphere → box | Off-screen % sphere → box | Off-screen tris sphere → box |
|---|---|---|---:|---:|---:|
| low / rynek | near | ShadowProxy/ShadowProxy #68747 (176) | 437 → 437 | 94.1 → 94.1 | 72,336 → 72,336 |
| low / rynek | near | CityBlocks/ #3267 (24) | 1,900 → 1,900 | 93.5 → 93.5 | 42,648 → 42,648 |
| low / rynek | near | CityBlocks/ #3266 (12) | 1,774 → 1,774 | 94.1 → 94.1 | 20,040 → 20,040 |
| low / rynek | far | ShadowProxy/ShadowProxy #68747 (176) | 511 → 511 | 66.5 → 66.5 | 59,840 → 59,840 |
| low / rynek | far | CityBlocks/ #3267 (24) | 1,900 → 1,900 | 77.3 → 77.3 | 35,232 → 35,232 |
| low / rynek | far | ShadowProxy/ShadowProxy #68745 (12) | 2,740 → 1,992 | 86.8 → 81.8 | 28,524 → 19,548 |
| low / centrumDrone | near | ShadowProxy/ShadowProxy #68746 (120) | 604 → 0 | 100.0 → 0.0 | 72,480 → 0 |
| low / centrumDrone | near | ShadowProxy/ShadowProxy #68745 (12) | 2,438 → 0 | 100.0 → 0.0 | 29,256 → 0 |
| low / centrumDrone | near | CityBlocks/ #3267 (24) | 485 → 485 | 100.0 → 100.0 | 11,640 → 11,640 |
| low / centrumDrone | far | ShadowProxy/ShadowProxy #68746 (120) | 964 → 726 | 73.8 → 65.2 | 85,320 → 56,760 |
| low / centrumDrone | far | ShadowProxy/ShadowProxy #68745 (12) | 4,652 → 4,525 | 53.6 → 52.3 | 29,904 → 28,380 |
| low / centrumDrone | far | ShadowProxy/ShadowProxy #68752 (80) | 160 → 160 | 87.5 → 87.5 | 11,200 → 11,200 |
| low / marcin | near | ShadowProxy/ShadowProxy #68746 (120) | 350 → 172 | 94.9 → 89.5 | 39,840 → 18,480 |
| low / marcin | near | ShadowProxy/ShadowProxy #68745 (12) | 1,630 → 1,021 | 88.3 → 81.4 | 17,280 → 9,972 |
| low / marcin | near | CityBlocks/ #3267 (24) | 700 → 700 | 96.0 → 96.0 | 16,128 → 16,128 |
| low / marcin | far | ShadowProxy/ShadowProxy #68746 (120) | 613 → 532 | 82.9 → 80.3 | 60,960 → 51,240 |
| low / marcin | far | ShadowProxy/ShadowProxy #68745 (12) | 2,877 → 2,669 | 78.7 → 77.0 | 27,168 → 24,672 |
| low / marcin | far | CityBlocks/ #3267 (24) | 700 → 700 | 79.0 → 79.0 | 13,272 → 13,272 |
| low / estate | near | ShadowProxy/ShadowProxy #68746 (120) | 633 → 187 | 100.0 → 100.0 | 75,960 → 22,440 |
| low / estate | near | CityBlocks/ #3255 (12) | 888 → 888 | 99.7 → 99.7 | 10,620 → 10,620 |
| low / estate | near | CityBlocks/ #3250 (12) | 712 → 712 | 100.0 → 100.0 | 8,544 → 8,544 |
| low / estate | far | ShadowProxy/ShadowProxy #68746 (120) | 703 → 529 | 76.0 → 68.1 | 64,080 → 43,200 |
| low / estate | far | CityBlocks/ #3255 (12) | 888 → 888 | 97.1 → 97.1 | 10,344 → 10,344 |
| low / estate | far | ShadowProxy/ShadowProxy #68745 (12) | 1,001 → 761 | 75.2 → 67.4 | 9,036 → 6,156 |
| high / rynek | near | CityBlocks/ #3267 (24) | 1,900 → 1,900 | 84.2 → 84.2 | 38,376 → 38,376 |
| high / rynek | near | ShadowProxy/ShadowProxy #78627 (12) | 2,445 → 2,020 | 88.3 → 85.8 | 25,896 → 20,796 |
| high / rynek | near | CityGrid/ #64148 (96) | 271 → 199 | 91.9 → 88.9 | 23,904 → 16,992 |
| high / rynek | far | ShadowProxy/ShadowProxy #78628 (120) | 416 → 292 | 74.8 → 64.0 | 37,320 → 22,440 |
| high / rynek | far | TramInfrastructure/CatenaryPoles #66240 (80) | 588 → 303 | 76.4 → 54.1 | 35,920 → 13,120 |
| high / rynek | far | ShadowProxy/ShadowProxy #78627 (12) | 3,574 → 2,868 | 61.8 → 52.3 | 26,484 → 18,012 |
| high / centrumDrone | near | ShadowProxy/ShadowProxy #78628 (120) | 935 → 53 | 100.0 → 100.0 | 112,200 → 6,360 |
| high / centrumDrone | near | TramInfrastructure/CatenaryPoles #66240 (80) | 828 → 354 | 100.0 → 100.0 | 66,240 → 28,320 |
| high / centrumDrone | near | ShadowProxy/ShadowProxy #78627 (12) | 3,253 → 622 | 100.0 → 99.8 | 39,024 → 7,452 |
| high / centrumDrone | far | ShadowProxy/ShadowProxy #78628 (120) | 2,261 → 2,062 | 47.5 → 42.5 | 129,000 → 105,120 |
| high / centrumDrone | far | ShadowProxy/ShadowProxy #78627 (12) | 8,523 → 7,746 | 60.5 → 56.5 | 61,872 → 52,548 |
| high / centrumDrone | far | TramInfrastructure/CatenaryPoles #66240 (80) | 1,248 → 1,116 | 39.3 → 32.1 | 39,200 → 28,640 |
| high / marcin | near | ShadowProxy/ShadowProxy #78628 (120) | 563 → 396 | 89.2 → 84.6 | 60,240 → 40,200 |
| high / marcin | near | TramInfrastructure/CatenaryPoles #66240 (80) | 812 → 812 | 84.7 → 84.7 | 55,040 → 55,040 |
| high / marcin | near | StreetDetails/Trees_lime_v0_lod1_-6,-1 #33384 (846) | 58 → 58 | 58.6 → 58.6 | 28,764 → 28,764 |
| high / marcin | far | ShadowProxy/ShadowProxy #78628 (120) | 1,203 → 925 | 64.0 → 53.2 | 92,400 → 59,040 |
| high / marcin | far | TramInfrastructure/CatenaryPoles #66240 (80) | 1,015 → 1,015 | 59.9 → 59.9 | 48,640 → 48,640 |
| high / marcin | far | StreetDetails/Trees_maple_v0_lod1_-6,2 #33392 (744) | 61 → 61 | 98.4 → 98.4 | 44,640 → 44,640 |
| high / estate | near | ShadowProxy/ShadowProxy #78628 (120) | 712 → 392 | 94.1 → 89.3 | 80,400 → 42,000 |
| high / estate | near | TramInfrastructure/CatenaryPoles #66240 (80) | 192 → 150 | 97.9 → 97.3 | 15,040 → 11,680 |
| high / estate | near | StreetDetails/ #65019 (186) | 86 → 50 | 91.9 → 86.0 | 14,694 → 7,998 |
| high / estate | far | ShadowProxy/ShadowProxy #78628 (120) | 1,457 → 1,156 | 60.4 → 50.1 | 105,600 → 69,480 |
| high / estate | far | StreetDetails/Trees_lime_v0_lod1_14,9 #33384 (846) | 35 → 35 | 88.6 → 88.6 | 26,226 → 26,226 |
| high / estate | far | TramInfrastructure/CatenaryPoles #66240 (80) | 334 → 334 | 85.0 → 85.0 | 22,720 → 22,720 |

## Candidate decisions

At Rynek, mast chunk boxes are only 7.04–10.06 m tall versus 626–1614 m sphere diameters; rail boxes are
0.05–6.86 m tall versus 1546–1714 m sphere diameters. Tight vertical bounds explain the drone-view gain without
smaller cells. A box is not always a subset of the original sphere: one cheap tree-pit family at Rynek submits
38,004 → 49,116 off-screen triangles. The tables retain such losses; net frame work and draws fall at every view.

1. **Keep tight boxes on existing chunks and stand-ins.** The renderer already calls `intersectsFrustum` for each
   pass. Compute the world-space union of actual transformed instance geometry boxes once, after updating each new
   chunk's world matrix, and test it without per-frame allocation. Baked proxies use their geometry box. No additional
   draws, instance uploads, shader graphs, material variants, runtime meshes or visibility cache. This retains frozen
   static matrices and the far cascade's cached depth/matrix pairing. Do not apply this CPU bound to vertex-displaced
   materials; they keep the original renderer path.
2. **Reject 500 m heavy visible cells.** Starting from tight boxes, large batches with ≥120 triangles/instance used
   500 m rather than 1000 m cells. Low Rynek: 889 → 941 draws, 7.563 → 7.369 M triangles, CPU 6.51 → 6.79 ms;
   drone 1045 → 1121, 7.602 → 7.535 M, 7.52 → 7.84 ms; street 907 → 967, 7.897 → 7.769 M,
   7.09 → 7.14 ms; estate 1959 → 2191, 9.714 → 9.587 M, 13.35 → 11.56 ms (the estate CPU is noisy).
   Extra triangles saved are only 0.7–2.6%, for 52–232 extra draws; no repeatable CPU/GPU benefit. No high-tier
   expansion of this losing candidate. Restore the existing cell sizes.
3. **Do not replace the spheres with spheres derived from the new boxes.** They would still extend above/below
   the flat geometry by hundreds of metres. The box test uses all six plane support points directly; retaining the
   existing spheres also preserves distance culling and raycast consumers.
4. **Prefix/range trimming remains an option, not a shipped change.** `count` draws a prefix, not an arbitrary
   instance interval; geometry `drawRange` selects vertices/indices, not instances. Arbitrary frustum intersections
   generally form several runs even after a fixed spatial ordering. Exact compaction must keep matrices, colours
   and every custom instance attribute aligned, and update storage/vertex buffers on both backends and every pass.
   The inventory's last-visible-index prefix estimates and scan costs are reported below; these CPU-heavy exhaustive
   scans run outside timing and are not a production implementation or an optimised hierarchy benchmark.
5. **Cascade culling already exists.** Shadow proxies live on layer 3, enabled on each cascade camera, and the
   renderer culls each draw with that cascade's frustum. Tightening their bounds improves that existing test. Do not
   derive shadow visibility from the scene camera: off-screen buildings/trees can cast visible long golden-hour
   shadows. No new camera-based caster skip or shorter shadow reach is introduced.
6. **No smaller-prop distance cut.** The existing size-based distances and cheap-prop batching remain. Dropping
   sub-pixel instances by a new threshold is a visible trade-off at some viewport, zoom, elevation or night glow;
   it is outside this task's no-visual-change constraint, and no unmeasured low-tier distance option is recommended.

Prefix scan, low (scene only; first sphere inventory, per frame):

| View | Existing-prefix triangles removable | Exhaustive inventory scan CPU ms |
|---|---:|---:|
| rynek | 1,140,703 | 9.15 |
| centrumDrone | 861,337 | 9.15 |
| marcin | 1,349,548 | 9.00 |
| estate | 912,491 | 13.05 |

Prefix scan, high (scene only; first sphere inventory, per frame):

| View | Existing-prefix triangles removable | Exhaustive inventory scan CPU ms |
|---|---:|---:|
| rynek | 1,162,069 | 7.50 |
| centrumDrone | 955,867 | 9.95 |
| marcin | 1,361,182 | 9.35 |
| estate | 902,951 | 14.15 |

## Boot, memory and programs

Initial separate boots: culling low 241 → 282 ms, high 365 → 466 ms (later high 432 ms). Total init is dominated by
city construction and shader compilation; the box pass adds tens of milliseconds at 1×. After all four views and GC,
retained heap 786.7 → 788.0 MiB low, 858.9 → 860.1 MiB high (scratch hooks/inventory remain retained; compare the delta,
not the production ~780/~843 MiB). GPU memory 227.0 → 225.4 MiB low, 341.6 → 339.2 MiB high from fewer uploaded draws.
No new shader programs: 206 low / 224 high throughout viewpoint changes and motion. Mesh and buffer capacities are
unchanged; the extra retained objects are boxes and their bound vectors. Boot at 6× is recorded below.

| Tier at 6× | Culling ms sphere → box | Precompile init ms sphere → box | Sum of init phases ms sphere → box |
|---|---:|---:|---:|
| low | 1385 → 1767 | 38587 → 38410 | 49923 → 47223 |
| high | 2276 → 2679 | 38422 → 39028 | 47985 → 48070 |

The box setup adds about 0.4 s in the culling phase at 6×; total boot does not noticeably regress. Compile/cache
variance dominates the total, so these pairs do not prove a boot improvement. Raw phase logs are in `boot6-*.json`.

## Appearance, motion and console

The screenshot harness freezes shader time, simulation time and clouds, hides moving actor roots/HUD, and keeps the
entire tree field, buildings, material shading, SSR/bloom on high and off-screen shadow casters. Each pose toggles
sphere/box in the same boot and allows both cascades to settle. The three time presets are golden, midday and midnight.
Per tier/backend: 12 view/time pairs, 24 poses at 15° increments around Rynek, and 24 poses 50 m apart on a 1.15 km
flight across the centre (35 m altitude). The route crosses chunk and cascade boundaries. Each pose also runs through
normal consecutive frames, including the far cascade's stale-map frame. These are scripted rapid turns/flights with
paired captures, not a manual driving review.

- low gpu: 60 pairs; programs 206–206; console errors/warnings 0. Pixel results: see below.
- low gl: 60 pairs; programs 206–206; console errors/warnings 0. Pixel results: see below.
- high gpu: 60 pairs; programs 224–224; console errors/warnings 0. Pixel results: see below.
- high gl: 60 pairs; programs 224–224; console errors/warnings 0. Pixel results: see below.
- Pixel diff low-gpu: 60 pairs, 0 non-identical pairs.
- Pixel diff low-gl: 60 pairs, 1 non-identical pairs; low-gl-motion-fly-1-sphere.png: 3 pixels, max channel 1.
- Pixel diff high-gpu: 60 pairs, 1 non-identical pairs; high-gpu-motion-fly-1-sphere.png: 1 pixels, max channel 11.
- Pixel diff high-gl: 60 pairs, 0 non-identical pairs.

238 of 240 pairs are bit-identical in the final diff summary. No object, tree
line or shadow disappears; the isolated 1–3 pixel differences have no visible silhouette change.

PNG evidence and raw JSONs stay under `.agent-task/` and are not site assets. The first visual pass exposed un-frozen
pedestrians; the repeated runs freeze simulation and shader time. The first WebGL pass exposed harness-only nested
GPU query warnings; repeated fallback checks disable timestamps, as production already does.

## Tests, reproduction and limits

- `node --test tests/`: **576 passed, 0 failed**. Four added tests cover final world transforms and real instance bounds,
  independent scene/cascade visibility (including repeated cached-cascade use), touching/flat/outlier bounds and
  conservative visible-point retention, and exclusion of shader-displaced material families.
- Reproduce with the scratch runner: `node .agent-task/perf-harness/run.mjs
  '{"quality":"low","ab":true,"settleMs":1200,"sampleMs":2500,"output":".agent-task/repeat.json"}'`.
  `visual.mjs` takes `quality`, `webgl`, `output`; `boot.mjs` also takes `baseline`, `cpu`. All use port 8149.
- No real weak phone, integrated GPU, iOS Safari, thermal soak or continuous human-controlled driving session.
  Headless Chrome's Apple GPU timestamps cannot establish low-end GPU savings. A real-device `?stats=1` report is
  still needed. Viewpoint-specific CPU savings and conservative triangle reductions are the measured result.
- Most off-screen instance work remains: a box rejects an entire chunk; it cannot discard off-screen members of an
  intersecting chunk. Camera occlusion is also outside scope. The worst masts and local gas-lantern batch remain
  candidates for an allocation-free hierarchy/range strategy **if** real devices justify its renderer CPU and upload cost.
- The pinned renderer's `intersectsFrustum`/`FrustumArray.intersectsBox` hook and frozen world bounds are dependencies;
  recheck both backends after a three.js bump. No commit or push was made.
