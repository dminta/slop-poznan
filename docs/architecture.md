# Runtime architecture & player control

## Map
- `js/main.js` is the only entry and the only place where systems are wired together. `initApp()` builds everything, owns all HUD DOM
  wiring and runs the loop. Other modules export a class (`ThirdPersonControllerManager`, `CameraSystem`, `CityMapSystem`, ...) or a
  `build*`/`create*` factory that returns an object with `update()` and data such as `colliders` and `footprints`.
- `js/controllers.js` owns the four player entities (`entities.person|car|cyclist|helicopter`), `activeMode`, the merged input
  `keys`, ground height, building collisions and teleport placement. `js/cameras.js` owns the render camera, `CAMERA_PRESETS` and
  the orbit/zoom state. The scenic preset ids (`centralPark`, `fifthAve`, …) are still the Manhattan ones, because the
  `index.html` buttons (whose labels already name the Poznań views), a `main.js` shortcut and `tests/cameras.test.cjs` name them; their views are rough Poznań stand-ins until Phase 12. `js/city-config.js` holds static world data and helpers (`TELEPORT_LOCATIONS`, `SPAWN`, `getLocationLabel`,
  `isTypingInField`, `isLand`, `clampToLand`, ...).

## Module graph and registering a new module
- The project has no build step. The import map in `index.html` maps `three`, `three/webgpu` (same URL, so there is one Three.js
  instance), `three/tsl` and `three/addons/` to `three.js@dev` on jsDelivr. App modules import each other with relative
  `./x.js` specifiers, never with `?v=` queries.
- New-module registration (`modulepreload` line plus the count in `tests/boot.test.cjs`), module syntax, import stubs and
  the tests that slice `main.js` by text markers (`teleportTo`) are covered in [`testing.md`](testing.md).

## Boot order (inside `initApp`)
1. `renderer.init()`, then `LightingSystem`.
2. City builders, in this order: `buildCityGrid`, `buildOutskirts`, `buildBridges`, `buildLandmarks`, `buildCityBlocks`,
   `buildStreetDetails`, `createTrafficSystem`, `createHighwayTraffic`, `buildRoadPaint`. The order matters because of the
   live `let` exports below ([`world.md`](world.md#build-order-mainjs-initapp-and-why-it-is-fixed)).
3. `ThirdPersonControllerManager(scene, allColliders)`. Saved player state is restored right after it is constructed.
4. Then `CameraSystem`, `TouchControls`, `CityAudioSystem`, `setupSceneCulling`, the WebGPU-only instanced-matrix swap, the
   SSR/post-processing pipeline, `GamepadControls`, UI wiring and `CityMapSystem`.
5. `precompileShaders()`, then one warm-up frame. The loading overlay hides and `audioSystem.ready` is set only after
   `onSubmittedWorkDone`.
- `markInit(label)` logs phase timings once as `[init] ...`. Add a `markInit` call for any new heavy boot phase.

## How modules share state
- `1f66530` replaced the old `window.NYC` globals. Do not reintroduce globals. Share state in one of three ways:
  1. **Constructor injection from `main.js`.** `controllerManager` goes to the camera, touch, gamepad, map and audio systems.
     `cameraSystem` goes to gamepad and map; the traffic road `network` goes to the map. Reach the player through `controllerManager.getActiveEntity()`, `.activeMode`,
     `.entities` and `.keys`.
  2. **Static imports** from `city-config.js` and the other data modules.
  3. **Mutable exported singletons:**
     - `cityUniforms` in `tsl-materials.js`. `lighting.js` writes it; `controllers.js` and the materials read it, for example
       `uInteriorGlow` drives headlight intensity.
     - Exported `let` bindings that a builder fills in: `sidewalkBlocks`, `pavedPlazaRects`, `keepClearBoxes`, ...
       (`city-grid.js`). These stay `undefined` until their builder runs, so read them at
       call time, never at module top level.
     - The test harness snapshots imports as plain values, so tests pass these as stub values.
- The HUD reflects state through body attributes and classes that CSS keys off: `body[data-mode]` (for example, the altitude
  gauge is shown only for the helicopter), `.is-boosting`, `.touch-enabled` and `.hud-minimized`.

## Per-frame order (`renderer.setAnimationLoop` in `main.js`)
The loop runs these in order:
1. `gamepadControls.update`
2. `controllerManager.update`
3. `cameraSystem.update`
4. `signalClock`
5. `tramSystem.update` (camera position, camera, active entity and mode)
6. `trafficSystem.update` (receives the camera position, active entity, mode and camera)
7. `highwayTraffic.update`
8. a throttled save
9. the building, street-detail and lighting updates (these use `cameraSystem.currentPos`)
10. `mapSystem.update`
11. `audioSystem.update`
12. `updateSceneCulling` (skipped on the warm-up frame)
13. `renderPipeline.render()`

Why the order matters:
- Trams run before the street traffic: the cars put this frame's trams into their lanes and the player collides with
  the trams where they are drawn. The trams brake for the cars of the frame before.
- Gamepad input runs first so it applies in the same frame. The camera runs after movement so it follows the final position.
  Traffic runs after the player moves so it collides with the player's new position.
- Traffic consumes and clears `car.lastCollisionSpark`, which `resolveHorizontalCollision` sets.

Timing:
- `dt` is clamped to `[0.001, 0.05]` for the simulation. FPS telemetry uses the raw frame time.
- DOM telemetry (speed, altitude, location signs) updates every 250 ms, not every frame. `topSpeedKmh` must track the speed caps
  in `controllers.js` (km/h = m/s x 3.6); the HUD shows km/h and altitude in metres.

Allocation: hot paths reuse scratch objects (`_desiredPos`, `_buildingContact`, `_nearList`, the single `_collisionEvent`). Keep
per-frame code free of allocations. Collision listeners must copy any event fields they want to keep.

## Input sources and how they merge
- Every source writes its own map inside `ThirdPersonControllerManager`:
  - keyboard: `bindKeyboard`, which tracks pressed codes so that releasing one binding keeps another held key active
  - touch: `setTouchInput`
  - gamepad: `setGamepadInput`
- `_blendInput` combines them into `keys[action]`. If any source holds a digital `true`, the result is `true`; otherwise it is
  the strongest analog value in 0..1. Movement code must therefore treat `keys.x` as a number. Multiply by it (for example
  `maxWalk * this.keys.forward`) rather than assuming a boolean.
- The actions are `forward`, `backward`, `left`, `right`, `up`, `down` and `boost`. To add one, add it to `keys`, to the
  `bindings` table in `bindKeyboard`, and, where relevant, to the touch buttons (`data-touch-action` markup and
  `TouchControls.setMode` visibility) and to the `GamepadControls.update` mapping.
- Some keys are not movement and are handled elsewhere:
  - In `main.js`: `1`-`4` select the mode, `5`-`0` and `V` select the camera, `H`, `N` and `B` (horn).
  - In `city-map.js`: `M` and `Esc`.
  - Every keyboard handler must skip events where `isTypingInField(e)` is true, so typing in the map search box doesn't drive
    the player.
- Every source resets on `blur` and `visibilitychange`. Opening the map calls `resetInput()` and disables touch and gamepad
  through `onToggle`.
- `GamepadControls` reads only pads with `mapping === 'standard'`. It suppresses buttons that are already held after a connect,
  a reset or a mode change, so a held button never fires a fresh action. It also checks `this.revision` after each callback,
  because callbacks such as `selectMode` call `reset()` synchronously.
- Pointer drags on the canvas orbit the camera (pinch to zoom, wheel to zoom) in `CameraSystem.bindPointerControls`.
  `userOrbitTimer` delays the automatic re-centre.

## Travel modes
The modes are `person`, `car`, `cyclist` and `helicopter`. Only the active entity runs physics. The exceptions:
- An inactive person keeps walking north and south.
- The helicopter's rotors always spin.
- `poseCharacters` poses the person and cyclist rigs every frame.

Always switch modes through `selectMode()` in `main.js`. It syncs the touch labels, the gamepad reset, the mode buttons,
`body.dataset.mode`, the control hints, and the jump back to the chase camera from scenic cameras. Calling
`controllerManager.setMode` directly does none of this. Boot restore is the only intentional direct use.

Adding a mode, or renaming one, means touching all of these places, because the mode list is duplicated:
- `controllers.js`:
  - `create<Mode>Entity()` returns `{ type, label, mesh, position, heading, speed, cameraTargetOffset, chaseDistance,
    chaseHeight, ... }`
  - `this.entities`
  - the `update()` dispatch
  - the `collisionBody`, `findTeleportPosition` radius and `body` table
  - the per-mode reset branch in `teleportActiveTo`
  - the radius in the `update<Mode>` call to `resolveHorizontalCollision`
  - `getGroundHeight`, if the mode needs special ground
- `main.js`: `controlHints`, `topSpeedKmh`, the `modes` array in `onCycleMode`, and the `Digit` shortcuts.
- `index.html`: a `.mode-btn[data-mode]` button with an icon `<symbol>`. Also `css/style.css` if the mode needs a
  `body[data-mode=...]` rule.
- `touch-controls.js`: the mode whitelist, button visibility and labels in `setMode`.
- `gamepad-controls.js`: the trigger mapping by mode.
- `cameras.js`: the per-`entity.type` offsets in the `chase`, `action` and `pov` presets.
- Other files that branch on `entity.type` or `activeMode`: `traffic.js` (the player's lane footprint; the helicopter is
  ignored), `audio-sources.js`/`audio-synthesis.js` (motor kinds) and `audio-system.js`.
- `tests/controllers.test.cjs`, `tests/touch-controls.test.cjs` and `tests/teleports.test.cjs`.

Physics notes:
- Car and cyclist speed/coasting tuning (`driveSpeed()`, `CAR_DRIVE`/`BICYCLE_DRIVE`) is documented in
  [`actors.md`](actors.md#physics-and-coasting-parameters-player-vehicles-controllersjs).
- Colliders have the shape `{ minX, maxX, minZ, maxZ, minY?, maxY, obb?: { cx, cz, hx, hz, cs, sn } }`, gathered in `main.js`
  from landmarks, blocks, outskirts, bridges, the grid, street furniture and tram infrastructure.
  - They must be static. `nearColliders` buckets them once into 48 m cells, and it writes `_order` and `_seen` onto each
    collider.
  - `minY` matters. Every building part gets its own collider (commit `49b2ef2` removed a blanket block collider that caused
    invisible walls), and raised parts let ground players pass underneath.
  - The car uses an oriented rectangle (SAT); the other modes use circles.
  - Only the helicopter may leave the detail box (`HELI_RANGE`, 6000 m past `CITY_BOUNDS`). Ground modes stay
    `SHORE_MARGIN` 8 m from water: `shorePoint` pushes a body back along `clampToLand`'s 2-D answer, keeping one coordinate
    where it can so the body slides along the shore. Bridge decks never narrow the margin (`isLand`).
  - Ground modes also stay out of the railway corridor: the manager takes `{ keepOut }` as its third constructor argument
    (main.js passes `tramInfra.railCorridor`, a 1 m raster; see `world.md` Mainline railway). `resolveHorizontalCollision`
    ends with `keepOutOfCorridor`: a body that moved in goes back along one axis to its last free spot (`_lastFree`, one
    `{x, z}` per position vector, reused), so it slides along the edge, else all the way, and a car loses 70% of its
    speed. A body with no free spot within 6 m (restored or carried in) moves to the nearest free land on 1 m rings.
    `findTeleportPosition` rejects arrivals inside, so map clicks and restores land outside. The helicopter is exempt,
    and NPC traffic, pedestrians and trams never go through this path.

## Teleports
- Every teleport goes through `teleportTo(x, z, heading)` in `main.js`: the HUD presets, map clicks (`CityMapSystem.onTeleport`)
  and the restore path (which calls `teleportActiveTo` directly).
- `teleportTo` calls, in this order (`tests/teleports.test.cjs` asserts the exact sequence):
  1. `controllerManager.teleportActiveTo`
  2. `touchControls.reset()`
  3. `gamepadControls.reset()`
  4. `cameraSystem.resetForTeleport()`
  5. `selectCamera('chase', true)`
- It then sets `mapSystem.waypoint` to the *returned* safe position, not the requested one.
- `teleportActiveTo` moves only the active entity. `findTeleportPosition` checks the whole footprint against buildings, against
  the other player entities and against the default chase-camera corridor. It searches rings 4–256 m out and returns `null`
  (the player stays put) if nothing is clear. The helicopter keeps its altitude, at least 92 m unless `savedAltitude` is given.
- Adding a preset destination:
  1. Add an entry to `TELEPORT_LOCATIONS` (`city-config.js`, heading 0 = south/+z, π = north).
  2. Add a matching `button[data-teleport=key]` in `#teleport-popover`.
  3. The test requires the keys to match the buttons exactly and the point to lie within a street's width of a road,
     8 m from water (`isLand`) and outside any `blockAt`.

## Persistence (localStorage)
- `player-state` (`main.js`) stores `{ version: 2, activeMode, entities: { [mode]: { x, y, z, heading } } }`.
  - Version 2 is Poznań. A version 1 state holds a Manhattan position and is ignored; the old `nyc-player-state` key is
    removed on load.
  - It is saved every 5 s while the page is visible, on `pagehide` and when the page becomes hidden.
  - On restore, each entity goes through `setMode` + `teleportActiveTo`, so saved players come back at rest and clear of
    obstacles.
  - If you change the shape, bump `version`. Old data is then ignored.
- `sound` (`audio-system.js`) stores `'on'` or `'off'`. The old `nyc-sound` key is read as a fallback and removed on the
  next toggle.
- Wrap every storage access in `try { } catch { /* reason */ }`. Storage may be unavailable, and that must never block play.

## HUD, CSS and cache busting
- `css/style.css` is linked as `./css/style.css?v=YYYYMMDD-<slug>` (currently `20261027-sim-plates`). When you change
  `style.css`, bump that query in `index.html` in the same commit; GitHub Pages caches it.
- Colours are tokens on `:root`: `--accent`/`--accent-ink` (yellow, also the map's GPS route in `city-map.js`) mark
  whatever is active; `--sign-graphite` (#3b3d3f) and `--sign-blue` (#1f5bb5, the district strip) are the street plate.
  The loading screen, brand and map title share the `.badge` roundel.
- The location HUD draws each street as a Poznań SIM 2017 plate, the same design as the in-world wall plates:
  `renderLocation(label, district)` in `main.js` runs each OSM name through `plateLabel` (exported by
  `street-details.js`, the one copy of the kind words and the patron given-name list) and fills `.street-sign-kind`
  ("ulica Jana Henryka", "aleje Karola", "rondo"; none for Rynek/Zaułek/Pasaż/Wzgórze names), `.street-sign-name`
  ("Dąbrowskiego") and `.street-sign-district`, the blue bottom strip with `districtAt` of the player (or scenic
  camera) position in capitals; outside every district ring the strip is left out.
- Fonts: Inter (UI) and Overpass (plates) from Google Fonts; the css2 API serves their latin-ext subset by `unicode-range`,
  which covers Ą Ć Ę Ł Ń Ó Ś Ź Ż. A replacement family must have latin-ext.
- JS modules carry no version query. The boot test requires plain `./js/x.js` paths so that preloads and imports share one URL.
- UI code uses only safe DOM APIs: `textContent`, `classList`, `replaceChildren` and `createElement`. Never `innerHTML`.
- Popovers are native `[popover]` elements that `main.js` positions from `data-anchor`, `data-align` and `data-side`.
- After a mouse click, `main.js` blurs the button so Space and Enter don't re-press it.
- The map (`city-map.js`) draws up = `GEO.frame.bearingDeg` (0 for Poznań: true north up) in world metres. The compass
  needle and its tooltip (`#map-compass`) are set from that bearing at runtime. It caches static layers (`miniCache`,
  `fullStaticKey`) and must invalidate them when fonts load.
- Layers, bottom up: outskirts land, the core, water (with island holes), parks, blocks, plazas, rail (dashed grey),
  bridges, trams (thin red, above the decks), landmarks. The furthest zoom-out (`minZoom()`) fits the whole city outline
  to the canvas; "fit all" (`#map-view-all`) fits the detail box (`CITY_BOUNDS`).
- The legend (`#fullmap-legend`, static items in `index.html`) wraps to a second row rather than run under the centred
  status pill, and hides below 1360 px. Its Tram and Rail swatches read `--map-tram`/`--map-rail`, which the
  `CityMapSystem` constructor sets from `MAP`, so they follow the palette the map draws with.
- Area names are read from `GEO.labels` by `kind`: each kind (suburb, quarter, neighbourhood, water) has its own zoom
  range; water is italic mixed case, the rest spaced caps via `mapCaps`. `LABEL_ALIAS` (`city-config.js`) holds short
  street names (empty for now). Road names are used as OSM signs them.
- Road labels: `chainRoadPieces` joins same-named OSM pieces end to end (not through forks), then `roadLabelAnchors`
  places about one label per 260 m of arc length where the street runs straight (turns under 0.2 rad) for longer than
  the text. Both run once at load (~18 ms). Street search compares `foldText` keys (lower case, no diacritics, ł → l); `compareNames` (Polish collation) is
  for any alphabetical list, and `formatCount` formats counts with Polish digit grouping.
- The GPS route (`updateRoute`, `drawRoute`) is the shortest path on `trafficSystem.network`, which `main.js` passes in as
  `network`. One-way streets count both ways. The map builds the graph on first use, then runs Dijkstra from the
  waypoint's nearest node once per destination. It re-snaps the player only after 8 m of movement. If either end is more
  than `ROUTE_SNAP` (300 m) from a node, or there is no network, it draws a straight line instead.
