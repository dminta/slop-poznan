# Railway level crossing barriers and signals — 2026-10-31

Implementation of level crossing barriers (rogatki) and St. Andrew's cross warning signals (sygnalizatory
przejazdowe z krzyżem św. Andrzeja) across all mainline railway level crossings on public streets in Poznań.

## Motivation and context

`GEO.levelCrossings` defines 39 level crossing nodes where mainline rail lines cross paved roads.
The rails were flush with the asphalt (`y = 0.016 m`), but lacked any physical barriers, warning signs,
or signals.

## Implementation

1. **Crossing detection and configuration (`js/tram-infra.js`):**
   - Surveyed all 25 crossing points lying within paved road corridors and clustered them into 5 major
     railway level crossings:
     * **ul. Świętego Michała**: single carriageway, 4 barriers and 4 warning signals.
     * **ul. Krańcowa**: single carriageway near Poznań Wschód, 4 barriers and 4 warning signals.
     * **ul. Bałtycka**: dual carriageway (eastbound and westbound), 8 barriers and 8 warning signals.
     * **ul. Gdyńska**: dual carriageway (northbound and southbound), 8 barriers and 8 warning signals.
     * **ul. Wrzesińska**: single carriageway, 4 barriers and 4 warning signals.
   - Total: 28 crossing barrier cabinets with red-and-white striped booms and 28 St. Andrew's cross warning signals.

2. **Geometries, materials, and structure gauges:**
   - Procedural TSL materials:
     * `barrierBoomMat`: red and white stripes every 0.3 m (`step(0.5, fract(along.div(0.6)))`).
     * `stAndrewMat`: St. Andrew's cross with white background and red border.
     * `signalLampMat`: bright red warning lamp lens (`0xee1515`).
   - Clearances strictly enforced:
     * Road clearance: `roadDist >= 0.15 m` (outside paved carriageway).
     * Lane clearance: `laneDist >= 1.85 m` (outside vehicle travel corridors).
     * Rail structure gauge: `railDist >= 2.6 m` from railway track centrelines.
     * Tram clearance: `tramDist >= 3.0 m` (no tram conflicts).
   - Physical colliders for barrier drive cabinets (height 1.2 m) and signal masts (height 2.9 m) added to `colliders`.

## Measurements

| Measurement | Before | After |
|---|---:|---:|
| Level crossing barriers | 0 | 28 |
| St. Andrew's warning signals | 0 | 28 |
| Active level crossings equipped | 0 | 5 (25 nodes) |
| Road network edges | 8,756 | 8,756 |
| Road network drivable length | 435.479 km | 435.479 km |

## Validation

- `node --test tests/rail-crossings.test.cjs`: passes 6/6.
- `node --test tests/*.cjs`: passes 296/296.
- `node --test tests/`: passes full regression suite (305/305).
