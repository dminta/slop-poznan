# Browser checks of overhead signal heads — 2026-11-17

Inspection of `6d3285b` on `cc-browser-signals`. No `js/`, `tools/` or test file changed; only this record and
`docs/backlog.md`. Follow-up to [browser-checks-2026-11-16.md](browser-checks-2026-11-16.md) (head numbering is the
same: index into `streetDetails.runtimeHeads.filter(h => h.overhead)`, 114 heads, 70 cantilever + 44 span) and
[signal-tram-clearance-2026-11-14.md](signal-tram-clearance-2026-11-14.md).

**Results in one paragraph.** (1) From the lead car's eye no overhead head is visible: 101 of 114 heads sit 8–15 m
*behind* the stop line, the other 13 are at most 1.75 m past it (56° above the horizon). (2) That is a sign bug: Table 7.2 of
the Polish regulation puts overhead heads **8–30 m beyond** the stop line, never before it; two ZDM Poznań designs
confirm it. (3) Both anchors of heads 15, 16, 22, 67, head 75, the head 9 arm and Górna Wilda's stay are now framed and
resolved; head 16's two masts stand only 3.0 m apart. (4) New defect: both stays of head 10 run 3.65 m above the rails
of an elevated mainline viaduct, inside the train envelope. (5) 20 further heads were sampled from a rear-queue view:
all 20 visible (head 61 after reframing).

## Environment

- Headless Chrome 157 (`--headless=new --enable-unsafe-webgpu --use-angle=metal`), HTTP **8250**, CDP **9450**,
  profile `/tmp/cc-browser-signals/chrome`; `Network.setCacheDisabled(true)` on every connection and the scratch server
  sends `Cache-Control: no-store`. Server and Chrome were killed at the end.
- 1280 × 720, DPR 1, midday. WebGPU **high** (`WebGPUBackend`, canvas 1280 × 720) and `?quality=low&backend=webgl`
  (**WebGL2 low**, `WebGLBackend`). `Math.random` is an LCG seeded 4242 at navigation (the 2026-11-16 pass's seed).
- Harness: `/tmp/cc-browser-signals/` (`server.mjs`, `cdp.mjs`, `lead.mjs`, `anchors.mjs`, `cover.mjs`, `supports.mjs`,
  `pts.mjs`, `aerial.mjs`, plus the geometry probes `dump.mjs`, `portal*.mjs`, `railstay.mjs`, `near9.mjs`). It is the
  previous pass's harness, which pins the camera from an in-memory-patched `main.js` (files on disk untouched), hides
  the player mesh and the HUD, and exposes `H = {scene, renderer, streetDetails, tramLayout, railLayout, …}`.
  Per-head data (position, lane, stop-line point, anchors, `topY`) is in `all-heads.json`.
- **All screenshots are in `/tmp/cc-browser-signals/shots/`**; names below are relative to it. Frames judged were
  opened individually, or as labelled 2 × 2 / 2 × 3 contact sheets (`sheet-*.png`, not cited as evidence) and then
  re-opened at full resolution where the verdict depended on pixels.
- Console: **0 errors, 0 warnings** (288 `info`/`log` entries) on both backends across all boots and captures
  (`console.jsonl`); no WebGPU validation or shader messages.
- Staged objects: the rear-queue views of section 4 use three static clones of the player's taxi, 7 m apart, lead centre
  3 m before the stop line (as in the 2026-11-16 pass); the lead-car views of section 1 and the support views use no
  staged cars. Natural traffic and trams stand wherever the seeded simulation put them, which is why some frames contain
  a tram or pedestrian.

## 1. Lead-car view (WebGPU high and WebGL2 low)

**Verdict: the overhead head is not visible to the lead driver for any of the 12 heads checked, on both backends.**

Method (`lead.mjs`): eye at **1.2 m**, **1 m behind the stop line**, in the lane under the head (the stop-line point is
the edge end `edge.sx + dx·len` plus the lane offset nearest the head). Two frames per head and backend: `-fwd` looks
along the travel direction, pitched up 5°, vertical FOV 50° (covers −20° … +30° about the horizon); `-back` turns round
and looks at the head from the same eye to prove that the head exists where the data say. For `16` and `75` (head
*ahead* of the eye) `-back` is the "look up at the head" frame. Elevation = atan2(5.3 − 1.2, forward distance); > 90°
means behind the driver.

| ID | Type | Head along stop line (m) | Forward dist. from eye (m) | Elevation | Lead-car verdict | Shots (`{webgpu,webgl2}-…`) |
|---|---|---|---|---|---|---|
| 1 | cantilever | −15 | −14 | behind (164°) | Not visible: not in the windscreen | `lead-1-fwd`, `lead-1-back` |
| 27 | cantilever | −15 | −14 | behind | Not visible | `lead-27-fwd`, `lead-27-back` |
| 60 | cantilever | −15 | −14 | behind | Not visible | `lead-60-fwd`, `lead-60-back` |
| 62 | cantilever | −15 | −14 | behind | Not visible | `lead-62-fwd`, `lead-62-back` |
| 0 | cantilever | −15 | −14 | behind | Not visible | `lead-0-fwd`, `lead-0-back` |
| 9 | cantilever | −10.5 | −9.5 | behind (157°) | Not visible | `lead-9-fwd`, `lead-9-back` |
| 15 | span | −10.5 | −9.5 | behind | Not visible | `lead-15-fwd`, `lead-15-back` |
| 22 | span | −10.5 | −9.5 | behind | Not visible | `lead-22-fwd`, `lead-22-back` |
| 67 | span | −10.5 | −9.5 | behind | Not visible | `lead-67-fwd`, `lead-67-back` |
| 19 | span (Górna Wilda) | −10.5 | −9.5 | behind | Not visible | `lead-19-fwd`, `lead-19-back` |
| 16 | span | +1.75 | +2.75 | **56°** above horizon | Not visible: far above any windscreen (> ±20°); the ahead-of-eye frame shows only a tram traction mast/arm | `lead-16-fwd`, `lead-16-back` |
| 75 | cantilever | +1.75 | +2.75 | **56°** | Not visible, same reason | `lead-75-fwd`, `lead-75-back` |

What the frames show:

- Every `-fwd` frame (WebGPU and WebGL2) shows the stop line's crosswalk, the junction and ordinary ground-pole heads
  at the corners, but **no head, arm or stay hanging over the lane ahead**. Per-pixel check: `webgpu-lead-1-fwd.png`
  (empty sky above the junction), `webgpu-lead-16-fwd.png` (a dark tram mast with a 4 m arm stands at the right; it is
  a traction arm, not the signal arm).
- Every `-back` frame shows the head and its arm or stays standing *behind* the eye, where the data put it:
  `webgpu-lead-1-back.png` (two cantilever heads behind the viewer), `webgpu-lead-60-back.png` (cantilever head 60 behind the viewer; the span with stays and a red head in that frame is
  head 61, 3.7 m away), `webgpu-lead-15-back.png`, `webgpu-lead-22-back.png`, `webgpu-lead-19-back.png`, `webgpu-lead-16-back.png`,
  `webgpu-lead-75-back.png` (green head on its arm, ≈ 55 px) and the WebGL2 counterparts. Heads 22, 67 and 19 read as
  dark lenses on both backends; I did not investigate why (phase at the frame's clock time or lens state).
- WebGPU and WebGL2 agree on every frame; there is no backend-specific visibility difference.
- The elevation column is the geometric check the task asks for. The visible sky range of a windscreen is ≈ −10° … +20°;
  the two nearest heads are at 56°, the rest are behind the driver.

Distribution over all 114 heads (`all-heads.json`, `along` = position along the approach relative to the stop line,
negative = upstream): −15 m (clamp): 44; −14.8 … −12.4: 4; −10.5: 51; −8: 2; **+0.03 or +1.74/1.75: 13**. So **101 of 114
heads are 8–15 m behind the line and the other 13 are within 1.75 m of it; none is 8 m or more beyond it.**

## 2. Head-position sign question — **it is a bug**

### What the code does

`findOverhead` (`js/street-details.js:2592–2644`) takes `x, z` as the edge end (the stop line, `edge.sx + dx·len`),
`edge.dx/dz` as the direction of travel, and treats **negative `along` as upstream**. `search(-8, true)` and
`search(-10.5, true, true)` (`:2640,2643`) ask for a head at ≤ −8 / ≤ −10.5 m *before* the line; `targetFor`
(`:2597–2603`) clamps the head's longitudinal position to `[-15, maxAlong]` (`:2600`). The head therefore hangs 8–15 m
behind a driver who is standing at the stop line (section 1 measured exactly that). The comment at `:2588–2590` and
`docs/world.md:423–424` read the table as "head at least 8 m **before** the stop line".

### What the regulation says

Rozporządzenie Ministra Infrastruktury z dnia 3 lipca 2003 r. w sprawie szczegółowych warunków technicznych dla znaków
i sygnałów drogowych oraz urządzeń bezpieczeństwa ruchu drogowego i warunków ich umieszczania na drogach (Dz.U. 2003
nr 220 poz. 2181). **Załącznik nr 3**, pkt **7.2.2** "Zasady umieszczania sygnalizatorów w stosunku do drogi",
**Tabela 7.2** in the wording given by the amending regulation of 3 July 2015 (Dz.U. 2015 poz. 1314, in the
PDF "w załączniku nr 3 do rozporządzenia … w pkt 7.2.2 … tabela 7.2 otrzymuje brzmienie"):

> **Tabela 7.2. Odległości linii warunkowego zatrzymania od sygnalizatora** (mierzone od płaszczyzny czołowej
> sygnalizatora do zewnętrznej krawędzi linii warunkowego zatrzymania – P-14)

| Położenie sygnalizatora | minimalna | zalecana | maksymalna |
|---|---|---|---|
| obok jezdni | 2,0 | 2,0 | 4,0 |
| sygnalizatory pomocnicze | 0,5 | 0,5 | 1,0 |
| **nad jezdnią na wysokości 4,5 m** | **8,0** | **12,5** | **25,0** |
| **nad jezdnią na wysokości 5,5 m** | **10,5** | **15,0** | **30,0** |

Footnote ** on the overhead rows: "Jeżeli są to jedyne sygnalizatory na wlocie" — i.e. these values apply when the overhead
heads are the *only* signals on the approach, which is exactly the fallback case (no ground pole found). The consolidated
text (Dz.U. 2019 poz. 2311 t.j., part 2, p. 232; footnote 121 says the wording comes from the 2015 amendment) has the
identical 4,5 m / 5,5 m rows (8,0 / 12,5 / 25,0 and 10,5 / 15,0 / 30,0)
(<https://api.sejm.gov.pl/eli/acts/DU/2019/2311/text/I/D20192311-c2.pdf>). The sentence on where the stop line P-14 goes,
in **załącznik nr 2, pkt 4.2.5** (znak P-14, not załącznik 3 pkt 7.2.2), lists "**8,0 m przed sygnalizatorami znajdującymi
się nad jezdnią** (przy czym odległości te są mierzone od zewnętrznej krawędzi linii warunkowego zatrzymania do płaszczyzny
czołowej sygnalizatora)" next to "2,0 m przed sygnalizatorami znajdującymi się obok jezdni". "Przed" attaches to the *signal*:
the line lies 8 m **in front of** an overhead signal, i.e. **the signal is 8 m beyond the line**, in the direction of
travel. The table gives the stop line's distance from the signal; it is not a distance of the signal from the line on
the approach side. A driver stopped at the line sees an overhead head ahead and above.

Cross-checks:

- The minima are the 20°-ish sightline: from a driver's eye (1.2 m) 8,0 m ahead of a 4,5 m head is
  atan(3,3/8) = 22°; 10,5 m ahead of a 5,5 m head is atan(4,3/10,5) = 22°; the recommended 12,5 / 15 m give 15° / 16°
  and the maxima 25 / 30 m give 7° / 8°. The rule exists so the lead driver sees the head within a plausible vertical
  field; a head *behind* the line (our case) can never satisfy it.
- Real Poznań designs (ZDM Poznań, public project PDFs): *Grunwaldzka – wyjazd z PSP*:
  "Ze względu na instalację nowych sygnalizatorów na konstrukcji wysięgnikowej wymagane jest zachowanie minimalnej
  odległości od linii zatrzymania. W związku z tym linie zatrzymania na obu wlotach ulicy Grunwaldzkiej odsunięte
  zostały na wymaganą minimalną odległość 8 metrów" — the *stop lines were moved back* to make 8 m between them and the
  arm signals, so the signals stay where they are, beyond the line
  (<https://zdm.poznan.pl/upload/content/gallery/4235/ps-grunwaldzka-wyjazd-z-psp.pdf>). *Zamenhofa – Krucza*: "Na
  północnym wlocie ulicy Zamenhofa przesunięta została linia zatrzymania tak by zapewnić lepszą widoczność
  sygnalizatorów zawieszonych na bramie nad wewnętrznymi pasami wlotu" — gantry signals over the inner approach lanes,
  stop line repositioned for visibility. The quote does not say which way the line moved, so this is *consistent with*
  the reading, not a confirmation; Grunwaldzka is the supporting precedent (<https://zdm.poznan.pl/upload/content/gallery/5012/ps-zamenhofa-krucza.pdf>).
  I read these two paragraphs in the PDFs; I did not find a street-level photograph of a specific Poznań head, so
  "real Poznań examples" here means these two design documents, not site photos.
- The table text above is the 2015 amendment; the 2019 consolidated text is identical for the rows used here, so there
  is no 5,0 m row and the 5,3 m head sits between the 4,5 m and 5,5 m rows (the code's stricter 10,5 m row is the
  conservative choice).

### Verdict

The current sign is **wrong**. Table 7.2 and both ZDM designs put overhead heads 8–30 m *past* the stop line; the code
puts 101 of 114 heads 8–15 m *before* it and 13 within 1.75 m of it. Section 1's frames confirm that the lead driver
sees none of them. The earlier rear-queue checks only passed because the viewer stood 13–30 m behind the line, i.e.
*upstream* of the head.

### Proposed fix (not applied) — two options

**(A) Move the heads past the line.** The head's longitudinal position becomes +10.5 … +30 m beyond the stop line,
preferably about +12 … +15 m (min 8 / 10,5, recommended 12,5 / 15; the 5,3 m head is closer to the 5,5 m row). In
`js/street-details.js`:

1. `:2597–2603` `targetFor`: replace the clamp `Math.max(-15, Math.min(maxAlong, along))` (`:2600`) with one to
   `[minAlong, 30]` and pass the *minimum* distance instead of a maximum.
2. The duplicate clamp in the grid loop (~`:2621`, `along < -15 ? -15 : …`) must flip the same way.
3. `:2640–2643`: `search(-8, true)` → `search(8, true)`, `search(-10.5, true, true)` → `search(10.5, true, true)`, and the
   retarget test (~`:2642`, `band.target.along <= -10.5 + 1e-6`) becomes `>= 10.5 - 1e-6`. The non-band fallback
   `search(STOP_SETBACK, false)` (`:2641`) needs a flagged "below the table minimum" result instead of a head at +1.75 m
   (13 heads today).
4. The search windows (`:2610` `along < -30 || along > 20`, `:2620` `for along = -30 … 20`) must reach
   `+30 + OVERHEAD_REACH`.
5. The along lists in `findSpan` (~`:2701`) and `findTractionSpan` (~`:2760`) use the same −10.5 / −8 / +1.75 convention.
6. Tests: `tests/signal-placement.test.cjs` ~383–384 and 397–398, `tests/signal-audit.test.cjs` ~75 and 82 (Górna Wilda at
   −10.5).
7. Comment at `js/street-details.js` ~2588–2590 and `docs/world.md` ~423–424 ("at least 8 m before the stop line" →
   "beyond"); `tools/audit-fallback-head-sight.mjs` should assert a lead-car elevation ≤ ~22°.

Side effect: with the 1.75 m setback plus the 4.3 m crosswalk, +10.5 m puts heads about 4.5 m inside the junction
box. Feet and spans move to the far corners, so the rail, tram-pole, landing and pedestrian clearances and the Górna
Wilda traction-span case must all be re-proved, and the C-edge closure (43 edges) and build time re-measured.

**(B) Keep the cantilever at the near corner and move that approach's stop line upstream** so that it sits ≥ 10,5 m before
the head (the ZDM Grunwaldzka precedent: stop lines moved back to the required 8 m). This touches
road-network/traffic code and must be judged with `node tools/accept-traffic.mjs --base <ref>`.

**Related issue (ground heads).** Row 1 ("obok jezdni") requires the stop line ≥ 2,0 m before a side signal, but the
ground-pole search allows −15 … +1.75 m (`js/street-details.js` ~2807–2833, enforced by
`tests/signal-placement.test.cjs` ~354). The same misreading likely affects ordinary ground heads.

## 3. Supports

All support frames are WebGPU high (WebGL2 not repeated for them).

### Head 16 — two unshown masts → **resolved; the masts are 3.0 m apart**

Anchors (both new 10 m masts, `anchorExisting` [false, false]): (−2735.42, 2061.52) and (−2736.52, 2064.31), **3.0 m apart**, head at
(−2722.30, 2056.76). Frames: `webgpu-anchor-head16-m0.png` and `webgpu-anchor-head16-m1.png` — each shows one thin light
mast beside a dark tram traction pole, with a stay leaving the mast top; `webgpu-aer-head16-ne.png` shows both stays
converging on the apex above the head and the drop to the head, with the masts at the building front.
`webgpu-sup-head16-masts-a90.png` shows the pair side by side. **Observation:** the span is near-collinear: both stays leave
from almost the same point, so it is effectively a single-point suspension about 14 m away. This is systemic: **11 of 44 span heads have stays under 12° apart
in plan** (heads 90 at 1.5°; 3, 18, 108, 72, 87 and 16 at ≈ 8°; 40, 65, 22 and 13), because `pick` (~`:2689–2690`)
admits same-side anchor pairs at a +8 penalty.

### Heads 15, 22, 67 — both anchors → **resolved**

`webgpu-anchor-head15-m0.png` (new mast) / `m1` (existing anchor) · `webgpu-anchor-head22-m0.png` / `m1` (two new masts,
hugging a building front; in m0 the left mast stands against a facade and its stay passes a balcony row in projection —
a possible collision, not examined) · `webgpu-anchor-head67-m0.png` (existing pole, two stays meet at its top) / `m1` (new mast).
Each frame shows a signal mast with a stay from its top toward the head. Views are from beside/under the stay
(2.5 m eye, 8–11 m away), and the stay is traced to the mast top in every frame. Whole-span frames
`webgpu-aer-head15-*.png`, `webgpu-aer-head22-*.png`, `webgpu-aer-head67-*.png` (sheets only, too small for a verdict
by themselves) are consistent. No mast/stay is missing and no stay is visibly detached.

### Head 75 — closer view → **resolved**

`webgpu-sup-head75-close-a0.png` (green head ≈ 55 px wide with its arm), `…-a200.png`, `…-a270.png` and the whole arm
in `webgpu-sup-head75-arm-a0.png` / `-a200.png`: a 11.7 m cantilever with the head at its tip, green lens lit, arm and
mast attached.

### Head 9 — arm versus tram traction pole → **resolved: no crossing; the earlier overlap was a projection**

Geometry: arm (−1551.03, 544.43) → head (−1549.80, 552.58) at 5.55 m; nearest traction poles are 3.10 m (h 7.0 m,
(−1547.05, 550.03)) and 4.36 m (h 7.6 m, (−1554.78, 548.86)) from the arm in plan (`near9.mjs`). Visual: the top-down
frame `webgpu-sup-head9-arm-top-a90.png` shows the thin light signal arm running between the two dark traction poles
with a clear gap (≈ 3 m) beside the nearer one; side views `webgpu-sup-head9-arm-west-a180.png`,
`webgpu-sup-head9-arm-east-a0.png` and `webgpu-sup-head9-arm-axis-south-a90.png` show the arm and head at the island
with the traction poles standing separately and the viaduct deck behind.

### Górna Wilda (head 19) — stay versus tram span wire → **resolved**

Head (−460.08, 982.52), anchors = the two existing 7.6 m traction poles (−468.13, 972.47) / (−455.90, 979.71); the
tram span wire runs between the *same two poles*. In plan the stays and the wire form a triangle; they meet only at the
poles. `webgpu-gw19-pole-a-close.png` is the deciding frame: at the pole top two lines leave it, a lighter steeper
signal stay and, ≈ 0.6 m lower, the dark flatter tram span wire; they diverge immediately. `webgpu-gw19-pole-b-close.png`
shows the same at the other pole, `webgpu-gw19-top.png` the plan view. Clearance is the geometric 7.2 m stay height over
the 6.6 m tram span (≈ 0.6 m at the poles, growing in plan toward the head); the frames show the separation
qualitatively, they do not measure it. The stay does not cross the span wire anywhere else (`portal.mjs`:
`tramSpan` intersections of head 19's stays are at the poles themselves).

### Signal stay and a mainline railway portal — **no stay crosses a portal beam; one defect found next to it (head 10)**

- Plan-view intersection of all 44 span heads' stays against the 148 rail portal beams and 1,411 rail arms (`portal.mjs`):
  **0 crossings** (14 crossings of tram span wires, 2 of tram arms). The closest pair is head 10 (span, **existing** poles as anchors, `anchorExisting` [true, true]: (−1551.03, 544.43), which is
  head 9's cantilever pole, and (−1547.01, 533.60), head (−1506.06, 555.00)): its second stay passes **1.32 m in plan** from the
  west end mast (−1524.48, 543.89, h 9.6 m, base 6.33 m) of a portal beam, so it passes the portal mast rather than
  crossing the beam.
- **Defect:** both stays of head 10 run at `topY` 10 m, but the railway there is on an elevated viaduct whose deck is at
  6.33–6.35 m. Sampled every 0.5 m (`railstay.mjs`) the stays are within 1 m of a rail axis for **20 m** (40 samples) and
  only **3.65 m above the deck**; trains and the rail overhead wire occupy that height (the portal beam is at ≈ 15 m).
  Only head 10 does this (no other span head has a stay over an elevated rail surface). The 10 m span height is chosen
  "above the 9.6 m portal masts" for ground-level railway (`js/street-details.js:657–661`); it is not relative to
  the viaduct deck.
- Frames: `webgpu-h10-aer-c.png` (the white stays cross the viaduct deck at track level, the portal gantry beside them,
  the apex and drop to the head on the road side), `webgpu-h10-aer-b.png`, `webgpu-h10-aer-d.png`, `webgpu-h10-aer-a.png`.
  Low frames from the deck (`webgpu-h10-deck-a/b/c.png`) and from under the viaduct
  (`webgpu-h10-portal-{top,s,n,w,e,close}.png`) are **not legible** (rail catenary wires and the deck/girders dominate)
  and are not used for any verdict. The in-plan 1.32 m clearance to the portal mast and the 3.65 m height over the deck
  rest on the numbers above plus the aerial frames, not on a close view of the crossing itself.

## 4. Coverage: 20 more heads from a rear-queue view (WebGPU high)

Method (`cover.mjs`): eye at 1.2 m, **28 m before the stop line in the head's lane**, three staged taxis, looking at the
head (5.3 m). This only proves the head can be seen from *upstream*; per section 1/2 it does not establish visibility
for the lead driver. Chosen by farthest-point sampling over the heads not yet checked, so the sample spans the
whole map. Coordinates are the head's world position (x east, z south, m). Shots are
`webgpu-cov-<id>-queue.png`.

| ID | Type | Head (x, z), m | Head along stop line | Verdict (rear queue) |
|---|---|---|---|---|
| 40 | span | −672, −1366 | −10.5 | Visible: lit green lens with stay apex above, ≈ 10 px, partly framed by foliage |
| 112 | cantilever | −8558, −2586 | +1.75 | Visible but small (≈ 8 px) at frame centre on its arm; a bus fills the left edge |
| 5 | cantilever | 3982, 2135 | −15 | Visible: green head on a long arm, ≈ 12 px (a large pole-mounted head in the foreground is another head) |
| 108 | span | −5419, 2069 | −10.5 | Visible: green head and stays, ≈ 12 px |
| 66 | span | −1119, 2714 | −10.5 | Visible: red head and stays, ≈ 8 px, beside a building edge and tram wires |
| 25 | cantilever | 2198, −2131 | −14.67 | Visible: green head at the centre of an arm; second pole-top head is another group |
| 77 | cantilever | −3521, −958 | −10.5 | Visible: red head at the arm end, ≈ 10 px |
| 30 | span | 1445, 568 | −10.5 | Visible: red head with a clear stay triangle, ≈ 10 px |
| 82 | cantilever | −3202, 1658 | −15 | Visible: green head at the arm end, ≈ 10 px, next to a large ground head |
| 72 | span | −1134, 665 | −10.5 | Visible: amber head on stays, ≈ 12 px (a tram passes at the left) |
| 31 | cantilever | 1929, 2536 | −10.5 | Visible: red head, ≈ 10 px |
| 51 | cantilever | 3178, −117 | −14.46 | Visible: green head at the arm end, ≈ 12 px |
| 76 | cantilever | 247, −256 | −15 | Visible: green head at the arm end, ≈ 12 px |
| 104 | cantilever | −4720, 836 | −15 | Visible: red head at the arm end, ≈ 10 px |
| 42 | span | 160, −2454 | −10.5 | Visible: red head with stay apex, ≈ 10 px |
| 92 | cantilever | −2317, 360 | −15 | Visible: green head at the arm end, ≈ 10 px |
| 78 | cantilever | 1557, −636 | −10.5 | Visible: green head, ≈ 10 px |
| 39 | span | −1806, −1113 | −10.5 | Visible: amber head hanging from a stay (long drop), ≈ 12 px |
| 113 | span | −6424, 2572 | −10.5 | Visible: red head on a wide stay apex, ≈ 10 px |
| 61 | span | 903, 1988 | +1.75 | Visible (≈ 12–15 px) under its stay apex: `webgpu-lead-60-back.png` and `webgpu-cov-61-queue-e.png` show it clearly; `webgpu-cov-61-queue.png` (pedestrian in front) and `…-queue-b/c.png` (passing tram) are blocked and not used |

Distinct heads now framed: the 11 of the previous pass, heads 0 and 10, and these 20 = 33 of 114, leaving **81 without
a visual check.** The rear-queue verdicts say nothing about the lead driver (section 1/2), and sampling did not look for
occluders by buses/vans.

## Defects and open items

1. **Overhead heads on the wrong side of the stop line** (section 2): 101/114 behind the line, 13 within 1.75 m. Options A/B in section 2.
2. **Head 10's stays over the elevated rail deck** at 3.65 m above the deck (section 3).
3. **Near-collinear spans are systemic** (head 16 and 10 others, see section 3), low priority.
4. `docs/world.md` states "7 cantilever heads at the stop line … and one span head" (~:425); the current count is 10
   cantilever + 3 span = 13 within 1.75 m of the line (stale number; design text not edited).
5. The sight audit assumed a viewer upstream; it needs a lead-car elevation check once the sign is fixed.
