# Fara niche wash, 2026-11-13

Follow-up to D6 in [the 2026-11-11 browser checks](browser-checks-2026-11-11.md#d6--fara-niche-attributes-are-not-gilded-and-the-niches-are-unlit-at-night-low).

The branch already assigned the spear, crozier and cross to the canonical `M.gold` (0xd8aa48, roughness 0.28,
metalness 1). This was visible on close inspection of the baseline; the earlier sandstone attribution was incorrect
for this revision. Retained that finish, including the sandstone Infant, robes and mitre. The gold's local night
variant has an amber emission tint, so it stays distinguishable from the warm stone after dusk.

Only the four lower niches receive local clones of the existing white plaster, sandstone, dark glass and gold
materials. Their emission is multiplied by `smoothstep(0.6, 1.15, cityUniforms.uInteriorGlow)`, following the existing
landmark-window and street-lamp mechanism. The factor is exactly zero at midday (0.24), one at twilight (1.25) and
at midnight (1.55). A fixed upward/front-facing normal weighting preserves the folds and architectural relief.
White plaster, sandstone, recess and gold have peak strengths 0.22, 0.32, 0.065 and 0.24 respectively. No real lights,
new geometry, collider changes, runtime material switches or per-frame allocations were added. The shared global
landmark batching pass merges the seven attribute pieces into one gold mesh; the canonical gold is excluded from
that pass but the niche-local variant is not.

## Browser method and evidence

Served the worktree on port 8012. Headless Google Chrome 157.0.8103.79 with `--enable-unsafe-webgpu --use-angle=metal`, Apple M5 Pro,
1600 × 1000, DPR 1, explicit `?quality=high&stats=1`; repeated the after set with `&backend=webgl`. Time buttons select
midday, twilight and midnight. A scratch CDP harness teleports through `CityMapSystem.onTeleport` and overrides only
`CameraSystem.update` to keep exact matching views: street eye (6.5, 1.7, 187), look (6.5, 16, 230); niche eye
(6.5, 10, 204), look (6.5, 12, 230), both 52° vertical FOV. The final comparisons seed `Math.random` with 4242 before
boot to preserve the background generation. NPC simulation still runs, so small whole-frame draw differences remain.

Screenshots and console/stats JSON are under `.agent-task/shots/` (scratch files, intentionally not committed):
`webgpu-{midday,twilight,midnight}-{street,niches}-{before,after}.png` and
`webgl-{midday,twilight,midnight}-{street,niches}-after.png`.

All four figures read at midnight from street level; the closer view retains the dark recess, warm sandstone folds,
white aedicule and amber attributes. Midday retains the original finishes and silhouettes, including the 2.1 m
outer-pair rise. No z-fighting was observed. The look remains subject to the user's screenshot review before merge.

## Measurements and checks

The midday four-niche image rectangle (330, 340)–(1320, 620) has mean absolute RGB differences
(0.053, 0.023, 0.002) on an 8-bit 0–255 scale, consistent with unchanged daytime finishes and small render noise.
These are image measurements, not an assertion of whole-frame pixel identity: the NPCs and the camera-shadow cadence
continue to change between captures.

Whole-frame `?stats=1` draw calls, including shadows and post-processing:

| Time / view | WebGPU before | WebGPU after | WebGL2 after |
| --- | ---: | ---: | ---: |
| midday / street | 905 | 893 | 887 |
| midday / niches | 904 | 883 | 885 |
| twilight / street | 937 | 939 | 921 |
| twilight / niches | 934 | 928 | 930 |
| midnight / street | 946 | 941 | 951 |
| midnight / niches | 949 | 953 | 947 |

The whole-frame count stays in the same range (up to 21 fewer / 4 more in these live samples); it is not a stable
microbenchmark of seven tiny meshes. The seven gold parts now batch into one mesh. Four local emission variants
increase the compiled program count from 224 to 229; render targets remain 18. No new light or shadow pass is created.

`node --test tests/` passed **598/598**, zero skipped, in 159.0 s on the final source; `git diff --check` passed.
The geometry harness needed explicit TSL/uniform imports and a material `clone()` stub. Existing Fara height,
figure size, niche depth and placement checks remain intact.

No shader/lighting warnings or runtime exceptions occurred in the completed WebGPU checks. CDP buffered earlier
network failures (`net::ERR_CONNECTION_RESET`, `net::ERR_SOCKET_NOT_CONNECTED`) from abandoned localhost reloads;
these are retained in the raw JSON, precede the successful boot's quality log and are not shader failures.
The stalled baseline attempt used CDP Fetch interception; the successful baseline instead temporarily served the
HEAD heritage module, then restored the edited source before the after runs. The final WebGL repeat restarted the
same port-8012 server with file logging to avoid another stalled reload.

The final WebGL2 run has zero console errors, runtime exceptions or warnings, including shader/lighting warnings.
All six after views were inspected; the midnight niche wash agrees with WebGPU. The port-8012 server was stopped
after capturing the evidence.

## Round 2 (same day): daytime gilt and a narrower wash

The first-round screenshots showed two remaining problems. At midday the cross read as gold but the spear and crozier
shafts (28-36 mm) were near-black: a thin, fully metallic cylinder shows only its dark reflection. At night the white
aedicule frames and hoods glowed with the figures, so each niche read as a lit box on a dark front.

Changes: the niche gilt is a local clone at metalness 0.45 / roughness 0.42 with a constant emission of 0.16 of
0xd8aa48 (the night term is unchanged, peak 0.24 of 0xffc04a); the white plaster clone is dropped, so only sandstone
(0.32), the recess (0.065) and the gilt are washed. This supersedes the strengths and the "four variants" above.

Checked in headless Chrome (same flags, views and seed as above, browser cache disabled; an earlier cached run showed
the round-1 module and was discarded), midday / twilight / midnight, street and niche views, WebGPU and WebGL2: the
spear, crozier and cross read gold at midday; at twilight and midnight the figures, pedestals and gilt are lit and
the frames and hoods are not. Programs 228 on both backends (224 before the niche work, 229 after round 1); render
targets 18. Screenshots: `.agent-task/shots/{webgpu,webgl}-{midday,twilight,midnight}-{street,niches}-r2.png`.
