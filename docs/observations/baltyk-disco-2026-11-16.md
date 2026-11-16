# Bałtyk 14th-floor disco: cost and placement (2026-11-16)

Design and rules: [`world.md`](../world.md#bałtyk-14th-floor-disco-baltyk-discojs-landmarks-towersjs). Measured in headless
Chrome 157 on an Apple M5 Pro (Metal ANGLE), 1280 × 720, `?quality=high&stats=1`, Bałtyk in view from 190 m
(eye −1560, 35, 330 looking at −1521.5, 52, 166.5), the numbers are those of the `?stats=1` panel.

## Draws and renderer CPU

Traffic and pedestrians change the whole-frame draw count by ± 10 from one sample to the next, which hides three draws.
The party group was therefore toggled (`group.visible`) in one page, ten times each way, four panel samples per state
(n = 40 per row, mean ± standard error):

| Backend | Time | Party group | Draws | CPU render (ms) |
| --- | --- | --- | --- | --- |
| WebGPU | midnight | visible | 924.3 ± 1.2 | 15.46 ± 0.07 |
| WebGPU | midnight | hidden | 921.5 ± 1.1 | 15.54 ± 0.05 |
| WebGL2 | midnight | visible | 929.7 ± 1.3 | 17.82 ± 0.07 |
| WebGL2 | midnight | hidden | 927.9 ± 1.1 | 17.72 ± 0.06 |
| WebGPU | midday | visible (day wall only) | 922.6 ± 1.0 | 10.67 ± 0.08 |
| WebGPU | midday | hidden | 920.4 ± 1.0 | 10.58 ± 0.07 |
| WebGL2 | midday | visible (day wall only) | 925.1 ± 1.5 | 18.77 ± 0.09 |
| WebGL2 | midday | hidden | 926.1 ± 1.4 | 18.79 ± 0.06 |

By construction the party is three draws at night (room, ball, pane; none casts shadows) and one by day (the curtain-wall
box; the old wall was part of the batched landmark mesh, so the net day cost is that one draw). The measured differences
(+2.8, +1.8, +2.2, −1.0 draws) agree within the noise; the renderer-CPU difference is below 0.1 ms in every row, within
the standard error. Pipelines: 230 → 236 programs (the night room, ball and pane, with their depth/MRT variants), compiled
behind the loading screen because the meshes start visible.

Unpaired, the HEAD build against this one (`git worktree` of `3e63862` served beside it) read 918 / 926 draws and
11.6 / 13.7 ms at midnight / midday against 919–934 / 929–932 and 11.3–11.9 / 11.7–12.0 ms: all inside the same sample
noise, which is why the paired toggle above is the number to trust. No GPU timing is available in headless Chrome; the
night shaders touch only the room's own pixels (the pane, about 16 × 3.4 m).

## Daytime regression check

The midday close view (eye −1511.7, 58, 186.2, WebGPU) was captured on `3e63862` and on this build and diffed per pixel:
52 500 px in the opening, 61 of them differ by more than 20 summed channel levels (cars and shadows elsewhere in the frame
account for the rest of the image's difference). The day wall is the same `glassDark` curtain-wall shader on a box in the
same plane.

## What is not measured

Frame GPU time, and the first-night pipeline hitch: none is expected because the meshes are visible while
`precompileShaders` runs (`[init] compile 1437 ms` on this build, WebGPU), but the HEAD build's compile time was not
measured beside it and a cold-cache run on slow hardware was not tried.
