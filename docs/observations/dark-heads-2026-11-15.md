# Dark signal heads on disabled plans, 2026-11-15

## Diagnosis: Most Teatralny (`-1373, -213`, plan 381)

1. **Real-world OSM signalisation:** Yes, the real Most Teatralny / Franklina Roosevelta junction is signalised in `tools/data/poz_signals.json`:
   - `11423283301` (`52.4104598, 16.9139614`, world `-1364.3, -211.4`): `highway=traffic_signals`, `traffic_signals:direction=forward` (`Geopoz: Ortofotomapa 2022`)
   - `11423283302` (`52.4105424, 16.9138635`, world `-1371.0, -220.6`): `highway=traffic_signals` (`Geopoz: Ortofotomapa 2022`)
   - Controlled crossings `3433222618` (`-1377.1, -214.7`) and `6050595327` (`-1369.2, -212.7`) with `highway=crossing`, `crossing=traffic_signals`.

2. **Why plan 381 is disabled:**
   - In `SIGNAL_SITES` (`js/city-config.js`), site `(-1384.6, -216.7)` (`junction: 4696`, `plan 381`, corridor `Franklina Roosevelta`) has 3 arms (`Most Teatralny` inbound, `Franklina Roosevelta` inbound from south, `Franklina Roosevelta` outbound to north), so `basePedestrian` is `false`.
   - In the bare road graph, node `(-1373.2, -213.7)` retains all 3 arms (`sideCount: 3`, 2 inbound, 2 outbound).
   - In the furnished road graph (`grid.sidewalks`), sidewalks around `(-1253.0, -546.1)` (north of Most Teatralny) prune the outgoing links of `(-1273.3, -529.6) -> (-1253.0, -546.1)` on northbound Roosevelta. The strongly-connected-component filter (`road-network.js`) therefore drops northbound Roosevelta (`(-1373.2, -213.7) -> (-1379.2, -238.9) -> ... -> (-1253.0, -546.1)`) and, because Most Teatralny westbound (`(-1346.5, -206.7) -> (-1373.2, -213.7)`) can only exit onto northbound Roosevelta, drops that inbound arm as well.
   - This leaves `(-1373.2, -213.7)` with only 1 inbound edge (Roosevelta from south) and 1 outbound edge (Most Teatralny eastbound): `sideCount === 2` (a right-turn bend) and `pedRoutes.across(n).length === 0`.
   - `road-network.js` (`if (n.sideCount < 3) n.signalTiming.pedestrian = true`) converts it to a pedestrian-only plan, and `configureSignals()` (`js/traffic.js`) calls `configurePedestrianSignal(n, false, 0)`, setting `plan 381.disabled = true` and `node.signal = false` under the rule *"Two-arm nodes without crossings are disabled."* That pruning rule is working as intended on the resulting 2-arm bend.

3. **City-wide dark heads before fix (`tools/audit-dark-heads.mjs`):**
   - Out of **493** `SIGNAL_PLANS`, **25** plans are disabled after `configureSignals()` (all 25 are `basePedestrian: false` sites reduced to `sideCount === 2` with `0` crossings).
   - **24** of those 25 disabled plans still had static poles and/or heads built during `buildStreetDetails()` (which runs before `createTrafficSystem()` / `configureSignals()`): **49** S-1 vehicle heads and **72** poles (each carrying a pedestrian head, **121** dark lens/panel instances total).

## Fix and verification

- `js/street-details.js`: Track `timing` on each static signal pole, S-1 housing, backplate, lens, pedestrian housing, pedestrian panel, and pole collider during `buildStreetDetails()`. When `addRuntimeSignalHeads()` runs (after `configureSignals()`), compact those 9 `InstancedMesh`es in place (updating `count`, `visible`, `instanceMatrix`, `signalIndex`, and `computeBoundingSphere()`), drop the corresponding disabled pole colliders and `vehicleHeadSites`, and clear `signalArmPoles` entries for disabled plans so active approaches do not reuse removed poles. Footprints are left unchanged so the road network and traffic are unaffected.
- `tools/audit-dark-heads.mjs`: After fix, **25** disabled plans, **0** disabled plans with poles or heads, **0** rendered disabled lens/panel instances, **0** disabled S-1 sites, **0** disabled poles.
- `tools/audit-signal-heads.mjs`: `vehicleHeads` `1120 -> 1071` (before) / `1291 -> 1242` (after); two active approaches that previously reused a pole from a disabled plan now place their own pole (`runtimePoles` `112 -> 114`, `reusedPoles` `59 -> 57`, `overheadPoles` `42 -> 43`, `spanPoles` `32 -> 33`).
- Browser checks (headless Chrome, 1280 × 720, WebGPU and `?backend=webgl` WebGL2, `.agent-task/shots/INDEX.md`): both Most Teatralny plan 381 poles (`-1355.53, -217.33` and `-1359.58, -201.85`) and their dark S-1 and pedestrian heads are gone after the fix on both backends.
