# Open tram doorways — 2026-11-19

Follow-up to [browser-checks-trams-2026-11-17.md](browser-checks-trams-2026-11-17.md#5-dwells-and-the-jeżyce-reservation).
Previously, an open tram doorway (`doorsOpen = 1` in `tramState.z`) replaced the two closed glass leaves (`leaf`)
with flat `0x2b2622`, left the exterior `paintRough` (`0.30` on Tramino) and `paintMetal` (`0.50` on Tramino) intact,
and shared the same `0xffe2b8 * 0.32` night emissive term as closed glass. In shadowed or backlit daytime views on
Tramino, the metallic surface reflected the blue sky over the dark base colour, reading RGB (27, 31, 33) against
closed (9, 21, 31).

## Fix (`js/actor-models.js`)

In `createTramMaterial()`, without adding geometries, draws, or per-instance attributes (preserving the shared
instanced tram material):

- **Open portal (`openAt`)**: when `doorsOpen = 1`, `doorway` opens a single continuous `1.16 × 1.80 m` cabin aperture
  (`p.z` within `±0.58 m` of the door centre, `p.y` in `0.52..2.32 m`), hiding the central vertical stile that separates
  the two `closedLeaf` glass panes while keeping the outer `doorFrame` (yellow on Tramino, `0x1f2327` on Gamma and
  Combino).
- **Matte, non-metallic cabin interior**: `roughnessNode` sets `0.88` (above the `0.75` high-tier SSR roughness cutoff)
  and `metalnessNode` sets `0.0` across `doorway`, removing SSR/sky mirror tinting on Tramino's `0.50`-metalness coat.
- **Cabin vestibule detail & interior lighting**: procedural interior layered in door-local `(uDoor, p.y)` shows
  warm cream/grey cabin walls (`0xb6b0a4` / `0xdcd6ca`) with jamb/lintel AO, flanking seat backs (`0x274c66`), slate
  floor (`0x42474e`), safety-yellow threshold step (`0xf3c316`), `fwidth`-anti-aliased central yellow grab pole, ceiling
  LED strip (`0xfff4de`), and an opposite-side window opening (`oppWin`, cool daylight `0x8fb0c7..0xc6dfee` by day,
  dark `0x1b2533` at night).
- **Day & night radiance (`emissiveNode`)**: `cabinEmit` blends daytime interior/opposite-window bounce (keeping
  shadowed/backlit portals legible) and warm night cabin illumination (`0.78` on lit walls/pole/step, `0.92` on the
  ceiling LED strip—below the `1.00` midnight bloom threshold—and `0.20` on `oppGlass`), while closed glass (`closedLeaf`)
  and side windows keep `0.22` warm tint at night.

## Browser verification (Headless Chrome 157)

- **Setup**: Headless Chrome 157 (`--headless=new --enable-unsafe-webgpu --use-angle=metal`), `1280 × 720`, DPR 1,
  `Network.setCacheDisabled(true)`, temporary localhost HTTP server (`Cache-Control: no-store`, stopped and cleaned up
  after capture). Tested **WebGPU high** (`?quality=high`, `url:high`) and **WebGL2 low** (`?backend=webgl&quality=low`,
  `url:low`).
- **Console**: **0 errors, 0 warnings** across both backends (`10` info logs each).
- **Measured doorway crop RGB** (projected door interior bounding box `594,283..686,444` in curb view,
  `612,305..669,423` in angled view; `mid` = center 50% width × 20%–70% height):

| Backend / tier | Stop (model, line) | View (`sunDotCurb`) | State | Midday mean RGB (luma) | Midday center RGB | Midnight mean RGB (luma) | Midnight center RGB |
|---|---|---|---|---|---|---|---|
| WebGPU high | Zawady (`tramino`, 5) | Curb (`-0.478`, shadowed) | Open | `(149.8, 168.4, 178.0)` (`165.2`) | `(180.3, 198.2, 200.2)` | `(131.8, 126.6, 110.9)` (`126.6`) | `(147.6, 130.3, 97.7)` |
| WebGPU high | Zawady (`tramino`, 5) | Curb (`-0.478`, shadowed) | Closed | `(28.5, 32.6, 23.9)` (`31.1`) | `(43.0, 45.0, 22.7)` | `(129.2, 114.4, 87.4)` (`115.6`) | `(118.7, 105.3, 78.5)` |
| WebGPU high | Zawady (`tramino`, 5) | Angled (`-0.478`, shadowed) | Open | `(149.0, 167.5, 175.0)` (`164.1`) | `(178.9, 196.8, 199.5)` | — | — |
| WebGPU high | Zawady (`tramino`, 5) | Angled (`-0.478`, shadowed) | Closed | `(34.9, 38.1, 27.1)` (`36.7`) | `(39.9, 41.3, 17.8)` | — | — |
| WebGPU high | Ogrody (`combino`, 7) | Curb (`+0.487`, sunlit) | Open | `(199.6, 211.7, 217.0)` (`209.5`) | `(228.6, 234.6, 230.7)` | `(137.0, 129.2, 105.3)` (`129.1`) | `(150.8, 132.4, 94.8)` |
| WebGPU high | Ogrody (`combino`, 7) | Curb (`+0.487`, sunlit) | Closed | `(22.1, 34.3, 43.8)` (`32.4`) | `(24.1, 36.7, 45.3)` | `(126.3, 111.6, 87.1)` (`113.0`) | `(113.6, 100.3, 78.1)` |
| WebGL2 low | Zawady (`tramino`, 5) | Curb (`-0.478`, shadowed) | Open | `(148.3, 167.3, 177.6)` (`164.0`) | `(179.1, 197.5, 201.3)` | `(131.9, 126.6, 111.0)` (`126.6`) | `(147.6, 130.2, 97.7)` |
| WebGL2 low | Zawady (`tramino`, 5) | Curb (`-0.478`, shadowed) | Closed | `(22.5, 25.6, 16.0)` (`24.2`) | `(38.4, 39.3, 15.7)` | `(129.2, 114.4, 87.4)` (`115.6`) | `(118.7, 105.3, 78.5)` |
| WebGL2 low | Ogrody (`combino`, 2) | Curb (`+0.487`, sunlit) | Open | `(198.0, 210.8, 216.5)` (`208.5`) | `(227.9, 234.2, 231.4)` | `(137.1, 129.1, 105.2)` (`129.1`) | `(150.7, 132.2, 94.5)` |
| WebGL2 low | Ogrody (`combino`, 2) | Curb (`+0.487`, sunlit) | Closed | `(13.5, 28.7, 39.8)` (`26.2`) | `(16.5, 32.0, 41.8)` | `(126.4, 111.6, 87.1)` (`113.0`) | `(113.7, 100.4, 78.2)` |

Note: the Zawady `doorBox` includes the outer yellow Tramino frame edge and closed center stile (raising the closed
curb `mid` red/green channels slightly vs pure glass), whereas the glass pane pixels alone read dark blue-slate
(`p10` `(3, 6, 11)` on WebGL2 low). At midnight, the open doorway clearly shows the bright ceiling LED strip, warm
walls, blue seat backs, yellow grab pole, and yellow threshold step against the uniform warm tinted glass of the
closed leaves. Visual inspection of all captured frames confirms clean anti-aliasing, no bloom washout, and no SSR
ghosting on the open interior.

## Tests

- Added numeric TSL shader test in `tests/vehicle-models.test.cjs` (`createTramMaterial distinguishes open cabin
  doorways from closed tinted glass in day and night`).
- Full suite `node --test tests/` passed after the final code edit.
