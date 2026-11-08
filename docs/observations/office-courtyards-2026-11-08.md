# Office courtyards — 2026-11-08

Follow-up to the empty interiors left by the 2026-11-08 central-density pass. Stare Miasto sat at 0.815× its OSM
built share on the 190 dense central blocks, and the office-classified parts of blocks 868 (Garbary / Wodna),
816 (Stary Browar / Królowej Jadwigi), 769, 814, 752 and 695 still built only street slabs. The same headless raster
as [central-density-2026-11-08](central-density-2026-11-08.md) was used: footprints on a 2 m grid over
`CITY_BOUNDS`, each cell counted once for the block under its centre, against `GEO.blockStats`.

## Baseline

| block | district | area ha | OSM built | generated | generated / real | layout |
| ---: | --- | ---: | ---: | ---: | ---: | --- |
| 868 | Stare Miasto | 1.84 | 57.0% | 33.4% | 0.586 | office slabs only |
| 816 | Stare Miasto | 10.91 | 37.0% | 13.6% | 0.368 | office slabs, 37% park |
| 814 | Stare Miasto | 3.85 | 40.0% | 26.4% | 0.661 | office slabs, 10% park |
| 769 | Stare Miasto | 11.99 | 50.0% | 40.2% | 0.803 | office slabs + resid. |
| 752 | Stare Miasto | 1.81 | 60.0% | 47.7% | 0.795 | office slabs |
| 695 | Jeżyce | 3.24 | 41.0% | 35.5% | 0.866 | office slabs |
| **32 office-reach blocks** | — | **44.3** | **37.4%** | **26.8%** | **0.718** | — |
| **190 central blocks** | — | **342.4** | **45.3%** | **43.2%** | **0.953** | — |
| Stare Miasto subset (84) | — | 129.4 | 48.4% | 39.5% | 0.815 | — |

`officeBlock` placed 26–52 m slabs along the main frontage only. `officeSlab` stopped at 16–24 m, so a 40–75 m lot
left 16–51 m of green yard behind the slabs; towers filled their lot to 48 m but could not reach the rear of deeper
pieces. Frontless pieces used `OFFICES.inner` (`pavilion` / `works` / `yard`) and stayed mostly empty.

## What changed

1. **Budget steering by the block's real OSM share.** `commit()` adds every ground footprint to `srcBuiltArea`;
   the block loop sets `srcTarget = T × BLOCKS[i].area` and gives each lot piece a share of the unspent target
   (`srcPieceBudget`). `officeBlock` spends the piece on frontage slabs first, then on the core, and stops when the
   block is at its real share. Office blocks already over their OSM share (593 36.8%, 786 44.8%) therefore keep
   their plazas.
2. **`cfg.core` gate.** `steerProfile` enables the office core only at `q >= 1.15` and `(b.built >= 0.4 ||
   b.park >= 0.3)`. This keeps 593 (q 1.03), 786 (0.97), 938/939 (1.07) and 733 (37% built, no park) on the old
   layout, while 816 (37% built, 37% park), 814, 769, 868, 752 and 695 qualify.
3. **Deep and mid-depth frontage slabs.** A lot of `Dfull <= 55` now takes the whole depth down to a 3–6 m rear
   service yard instead of a 16–24 m slab. A floorplate of 34 m or more gets a central 6–10 m atrium/light well
   (65% of them), so the deep plan stays lit. This fills 752's 30–33 m pieces and 814's 46 m pieces without a core.
4. **`officeCore`.** Behind each frontage lot, 12–14 m off its rear wall, one of:
   - `U`: two side wings and a rear bar round a 12 m+ court;
   - `ring`: the U closed by a near bar round an atrium;
   - `H`: two full-depth side wings and a central crossbar with two courts;
   - `L`: one side wing and a rear bar;
   - `parallel`: two bars with a 12 m+ court between them;
   - `rear`: a single rear bar;
   - `lowRear`: a 1–2-storey, 8–14 m deep conference/service pavilion.
   Wings are 12–15 m deep, the minimum court is `OFFICE_COURT` 12 m, and every plan is checked against the piece
   budget before `commit`. A 1–2-storey glazed link (4–6 m wide) closes one end of a U, crosses a parallel court, or
   links a ring's bars. Materials are the curtain-wall glass palette (`F.glassTeal/Silver/Bronze`) with cream and
   sandstone for the low pavilions; bars are 3–6 storeys, pavilions 1–2.
5. **Frontless office pieces** (superblock interiors and frame slivers) use `officeInnerLot`: the courtyard plan when
   the piece is at least 22 m wide, otherwise one office oficyna filling the inset piece with 2–5 m side yards.
   `officeCore` prefers the weighted plan but takes the largest affordable plan when the weighted one is under 55%
   of it, so a 12 m rear bar does not waste a deep core.
6. **Per-lot cores.** Each frontage lot gets its own core, so a tower podium (up to 48 m) does not kill the courtyard
   behind its neighbours. Adjacent cores share party walls; no ground footprint overlaps.

## Measurements after the change

| block | OSM real | before | after | after / real |
| ---: | ---: | ---: | ---: | ---: |
| 868 | 57.0% | 33.4% | **48.2%** | 0.846 |
| 816 | 37.0% | 13.6% | **14.8%** | 0.399 |
| 814 | 40.0% | 26.4% | **32.0%** | 0.801 |
| 769 | 50.0% | 40.2% | **47.8%** | 0.957 |
| 752 | 60.0% | 47.7% | **53.1%** | 0.886 |
| 695 | 41.0% | 35.5% | **41.2%** | 1.004 |
| 593 (over-built, core off) | 30.0% | 36.8% | 36.8% | 1.226 |
| 786 (over-built, core off) | 28.0% | 44.8% | 44.8% | 1.602 |

The 32 office-reach blocks (44.3 ha, within 240 m of Bałtyk, Andersia/AND2/PFC or Collegium Altum) move from
26.8% to 30.9% generated against 37.4% real (ratio 0.718 → 0.827). The 190 central blocks move 43.2% → 43.7%
against 45.3% (0.953 → 0.965); blocks below 75% of their real share fall 46 → 44. On the Stare Miasto subset of
those 190 blocks, 39.5% → 40.8% against 48.4% (0.815 → 0.842); the whole district moves 28.6% → 29.2% against
30.0% (0.953 → 0.970).

816 remains low for a structural reason: after the 37% park carve its buildable lot area is only 2.26 ha, 20.7% of
the 10.91 ha island, and it generates 14.8% (71% of that generic ceiling). The rest of its 37% OSM share is the Stary
Browar landmark (1.35 ha of the island) and buildings on the park edge, which `buildings.js` does not own. 575
(Collegium Maius, 0.91 ha) and 801 (a 0.62 ha fragmented island whose lot rects cover 46.5% of it) are likewise
landmark or lot-coverage ceilings, not empty office cores.

## Geometry and rendering checks

- **Frame-local footprint audit.** For every detail block the ground footprints were rotated back by the block's
  `ry` and tested against the block's own rect: 0 of the 775 ground parts in the 16 office-classified blocks leave
  their lot, so no new wall can reach a curb or sidewalk. Pairwise ground-part overlap in those blocks is 0 m² (the
  stacked upper tiers are intentional setbacks, not overlaps), so the new cores add no coplanar z-fighting.
- **Tests.** `node --test tests/buildings-density.test.cjs` — 8/8 pass. The first test now also guards the office
  result: 868 ≥ 47%, 814 ≥ 31%, 769 ≥ 46%, 816 ≥ 14%, and 593 / 786 may not exceed 37.8% / 45.8%. The villa
  districts, Chartowo and the four campus blocks are unchanged.
- `node --test tests/*.cjs` — 429/429 pass.
- `node --test tests/` — 443/443 pass, including the geodata rebuild, traffic regressions, tree/lamp clearance and
  the park-surface tests.
- **Browser checks.** Chrome 157.0.8103.39 headless loaded the full scene on WebGPU (Apple `metal-3`) and on the
  WebGL2 fallback (`?backend=webgl`; the canvas returned a `webgl2` context). The automatic drone was sampled in
  eight 8 s steps over the centre, and the Bałtyk and Stary Rynek scenic cameras were inspected. The office quarter
  reads as filled courtyards and lower flat-roofed glass/cream wings behind the frontage slabs; the foreground of
  the drone sweep is the Królowej Jadwigi / Składowa office quarter (blocks 816 and 868) and no block-sized green
  hole remains there. No curb or sidewalk overlap, floating part, missing facade or z-fighting was seen, and neither
  run logged a console error or warning. Frame rates were 40–44 fps on WebGPU and 30 fps on WebGL2 in the headless
  run.

## Remaining causes

1. **Landmark ceilings.** 816's Stary Browar, 575's Collegium Maius and the landmark parts of the Old Town are built
   by `landmarks*.js`, not the generic raster; their per-block generated share undercounts the scene on purpose.
2. **Fragmented islands.** 801's lot rects cover 46.5% of its island, so even 100% footprint coverage of the rects
   caps the generated share at 46.5%; the office pass does not change that.
3. **Already-overbuilt offices.** 593, 786 and 733 stay on their old layout because `cfg.core` is off. A later pass
   that thins them should use the same `srcBuiltArea` budget in reverse (drop frontage lots / rear bars) rather than
   adding more cores.

Files changed: `js/buildings.js`, `tests/buildings-density.test.cjs`, `docs/world.md`, `docs/backlog.md` and this
record.
