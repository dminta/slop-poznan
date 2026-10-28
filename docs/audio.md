# Spatial audio

All sound is synthesized at runtime with Web Audio. The repo has no audio asset files: every buffer (engine
firing loops, rotor, ratchet, chain, noise, impulse response, footsteps, speech syllables, horns, crash layers,
signal ticks, wind gusts, church bell, hejnał, goat knocks) is computed sample by sample in `createSynthResources` / `createEventResources` when the
`AudioContext` is first created. Keep it that way: add new sounds as generator functions, not files.

## Map

- `audio-system.js` (`CityAudioSystem`, internal `SpatialEmitter`): context lifecycle, master graph, voice
  budgets, pooling, event emission, crash gating, footstep/conversation/signal/horn scheduling.
- `audio-synthesis.js`: shared buffers plus `createMotorVoice` (continuous voices: `sedan`, `suv`, `bus`,
  `helicopter`, `cyclist`, `siren`, `tram`). Also exports `setControlRate`.
- `audio-events.js`: one-shot buffers, `playEvent` (`footstep`, `talk`, `horn`, `signal`, `crash`, `bell`, `church`,
  `hejnal`, `goats`), `SIGNAL_TIMING` and the non-spatial `createWindVoice`.
- `city-clock.js` (pure, no audio): the in-game clock (`PRESET_CLOCK`, `clockMinutes`, `fullHourIn`, `hourStrokes`),
  the church bells (`CHURCH_BELLS`, `CHURCH_PEAL`), the Ratusz noon show's timetable (`GOAT_SHOW`, `goatShowTime`,
  `GOAT_BUTT_TIMES`, shared with the goats' animation in `landmarks-rynek.js`) and the hejnał score (`HEJNAL`).
  Tested in `tests/city-clock.test.cjs`, which also bakes the event buffers with a fake context.
- `audio-sources.js` (`CityAudioSources`): reads simulation objects into reused snapshot records. This is the
  only place that knows simulation field names.
- `audio-acoustics.js` (`CityAcoustics`): obstruction and street enclosure from collider bounds.

## Graph topology

```
voice mix (mono) -> emitter.input(gain) -> lowpass -> HRTF panner -+-> direct(gain) -> mix
                                                                   +-> reflections(gain) -> convolver -> lowpass -> mix
wind voice (stereo panners, not spatial) --------------------------------------------------------------> mix
mix -> DynamicsCompressor -> master(gain, ramps to 0.65) -> destination
```

- Every voice and event gets its own `SpatialEmitter`. All emitters share one `reflections` send and one short
  `ConvolverNode` (0.7 s synthetic impulse). Do not add a reverb per voice.
- Voices own their nodes and return `{ update, dispose }` (motors) or `{ endTime, dispose(immediate) }` (events).
  `dispose()` must stop every source and disconnect every node it created. The emitter is disposed separately by
  the system.
- Motor voices write mono (`mix.channelCountMode = 'explicit'`, count 1). Doppler is not handled by the panner.
  `updatePool` derives a playback-rate factor from the change in radial distance, and each voice multiplies its
  pitch and filter frequencies by it. When you add a voice, apply `doppler` to its rates and cutoffs too.

## Lifecycle, autoplay and unlock

- `main.js` constructs `CityAudioSystem({ controllerManager, trafficSystem, tramSystem, streetDetails }, { onStateChange })`.
  It calls `update(dt, elapsed, camera, presetId)` every
  frame (`presetId` is `lightingSystem.activePresetId`: `'midnight'` quietens the wind and the preset sets the clock), `honk()` on KeyB, `setEnabled()` on KeyN and the
  `#btn-sound` button, and `dispose()` on `pagehide` (only when the page is not persisted to bfcache).
- No context exists until a user gesture. `pointerdown`/`keydown` listeners on `document` call `unlock()`, which
  lazily runs `initialize()` and then `resume()`. The listeners stay attached for the system's whole lifetime
  because iOS can interrupt a running context, and resuming needs another gesture. Keep them attached.
- `ready` is set by `main.js` only after the first GPU frame is submitted (loading overlay hidden). `update`,
  `crash` and `honk` do nothing until `ready && enabled && context.state === 'running' && !document.hidden`.
- Mute state persists in `localStorage['sound']` (`'off'` disables); the old `nyc-sound` key is the fallback, removed
  on the next toggle. Every storage access is in try/catch.
- `suspend()` re-checks state after the promise settles, so a quick unmute cannot leave the context suspended.
  Keep that reconciliation when you touch enable or visibility logic.
- `reset()` disposes every voice, clears per-source state, collision history and conversations, and snaps master
  to 0. It runs on visibility change, on mute, and when the listener jumps more than 60 m in one tick (teleport or
  camera switch). Pending sound is discarded, never queued.

## Update cadence and source selection

- `update` runs at about 10 Hz: an accumulator, with `dt` clamped to 0.25. Crashes are the exception. They arrive
  synchronously from physics, between ticks. `trackClock` is the other: it runs every frame before any early return
  (even muted), so a preset change starts the clock and the noon show on the same frame and `elapsed` as the goats'
  animation does.
- `CityAudioSources.collect()` keeps the N nearest candidates per category with `NearestSources` (bounded insertion,
  reused records): motors 10, sirens 2, trams 3, people 6, signals 2. The player passes score `-1`, so it is always
  included. Records are overwritten on the next `collect()`. Copy any field you need to keep (`emit` copies
  `position: { ...source }`).
- Source `id` is the simulation object itself (car, ped, controller entity, signal site), never an array index.
  Pools (`Map`) and per-source state (`WeakMap`) are keyed by it, so voices survive re-ranking and pooled-object
  reuse.
- `updatePool` limits live voices with `limits` (motors 8 / sirens 2 / trams 3 / events 8; on small devices, meaning
  `hardwareConcurrency <= 4` or a coarse pointer: 6 / 1 / 2 / 5). An unselected slot fades out over 0.12 s before it is
  disposed, and retiring slots still count against the limit, so churn cannot double the graph.
- Voices are not reused. A new source gets a new emitter and voice. Buffer sources start at a serial-based
  golden-ratio offset so identical loops do not phase-lock.
- Per-source distance fade: emitter gain uses a smoothstep over the last 30 % of `source.range`. `emit()` drops
  an event outright if it is beyond its kind's range (crash range scales with severity).
- Emergency vehicles (`isPolice`: Policja, ambulances, fire service) get two records: a normal motor and a `siren`
  (in `sources.sirens`, its own pool and range). The `siren` voice is the Polish two-tone hi-lo (435 / 580 Hz, 0.55 s
  each, a stepped square control wave through `resources.sirenTwoTone`) with a fast wail (650–1450 Hz, 2 sweeps a
  second) for 6 s in every 30 s, offset per vehicle (`SIREN`, `sirenWailing`; `tests/audio-siren.test.cjs`).
- Trams are their own category (`sources.trams`, pool `this.trams`, range 220 m, ref distance 7), never mixed into
  the motors. The `tram` voice: a baked traction loop (`resources.traction`, 250 Hz reference) pitched 0.55–2.45× over
  0–18 m/s and loud with `load` (|acc|: regenerative braking whines too), rail rumble (low-passed noise rising with
  speed), the auxiliary converter's 100 Hz hum, and flange squeal (noise through a Q 28 band-pass near 2.9 kHz with a
  4.3 Hz wobble) scaled by `squeal`. `squeal` comes from the bend under the body (front-to-rear section heading change
  over the length, i.e. 1/radius, from R ≈ 80 m to full at R ≈ 30 m) and needs > 1 m/s. `motorParams.squeal` is passed
  to every voice; the others ignore it.
- Inactive player bicycles are skipped (their stored speed is stale). Inactive player vehicles sound at reduced
  gain with zero speed/load.

## Simulation couplings (silent breakage risk)

`audio-sources.js` reads raw fields. A rename in the simulation does not throw. The sound just disappears or
freezes. If you rename or remove any of these, update `audio-sources.js` in the same change:
- street cars/buses (`trafficSystem.cars/buses`): `edge`, `edge.to.signal`, `edge.axisIndex`, `x`, `z`, `speed`,
  `acc`, `driver.a`, `yaw`, `yawOffset`, `isPolice`, `bus`, `isSUV`, `wait`, `gap`, `leaderSpeed`, `conn`, `yielding`.
- peds: `placed`, `x`, `z`, `ax`, `az`, `ux`, `uz`, `len`, `node`, `v`, `rig.seed`, `rig.phase`, `rig.feet[i].px/py/pz`,
  `conversation` (`{ a, b }`, where `a`/`b` are ped objects and both must point back at the pair).
- controller entities: `type`, `position`, `speed`, `heading`, `verticalSpeed`, `verticalVel`, `mesh.visible`,
  `rig`, plus `controllerManager.keys`, `getActiveEntity()`, `getGroundHeight()`. `helicopterVerticalSpeed` clamps at
  y 0.25 / 380 to mirror the controller's altitude clamp. If you change those limits in `controllers.js`, update it.
- trams (`tramSystem.trams`): `id`, `x`, `z`, `heading`, `speed`, `acc`, `atStop`, `waitReason` (`'player'` rings the
  bell), `length`, `sections[k].heading`.
- `streetDetails.audioSignals`: pedestrian head positions (about 980) with `isAvenue` (true when the head walks with group 0's traffic). WALK timing comes from `walkSignal` in `city-config.js`.
- Footsteps fire when `rig.phase + offset` wraps (one per foot). Changing the rig's phase convention breaks them.

## Events

- `emit(kind, source, options)` builds an emitter, snaps it into position (`snap = true`), and calls `playEvent`.
  `talk` and `horn` events have `follow = true`. Each tick they look up their source id in the current snapshot and
  move with it. Other events stay where they started.
- Crashes: `controllerManager` (building/ground contacts) and `trafficSystem` (vehicle-vehicle, vehicle-player)
  each expose `setCollisionListener` with a single slot. The audio system takes that slot, so adding a second
  consumer means fanning out from one listener. The event object is reused and synchronous, so copy fields out
  immediately. `crash()` gates per unordered pair (shared `WeakMap` contact for both orders): at least 0.18 s
  between plays, and continuous rubbing stays silent unless the speed is about 1.8x stronger or the pair separated
  for more than 0.3 s. Cyclists are lighter (lower severity and intensity). A crash may evict the weakest crash
  (at most 3 at once) or a background event, but never a horn. Crash emitters start at full gain (`immediate`),
  which keeps the transient.
- Bells: a tram's `bell` event (two strokes of a synthesized gong 0.24 s apart, the second a tone lower) rings when its
  `atStop` goes false (departure, doors closed), and every 4–6 s while its `waitReason` is `'player'`. Per-tram state
  (`tramStopped`, `bell`) is in `this.states`. Bells follow the tram (`follow`), ref 9, range 160, and are never
  evicted for a crash, like horns.
- Horns: automatic horns go off when an NPC is `blocked` for more than 8 s (Polish drivers rarely honk),
  with a 3 s global gap and a 30-50 s per-car gap. `honk()` handles the player's KeyB and works for `type === 'car'`
  only.
- Conversations: only the pair's `a` member drives turns, and only while both peds are nearly still. The next turn
  starts at `voice.endTime` plus a pause, so the speakers never overlap.
- Signals: Polish acoustic signals, a dull ~700 Hz tick every 1.25 s on red and a bright ~2.1 kHz rattle of 10 clicks a
  second on green (`SIGNAL_TIMING`; one walk buffer is 0.5 s of five clicks). They are scheduled ahead with `when`. A
  phase change removes the pending events for that pole.
- Clock: the time of day is the active lighting preset's (`PRESET_CLOCK`, matching the "· HH:MM" in the
  `TIME_PRESETS` names; keep them in step if a preset's time changes) running on in real time from the moment it was
  chosen. A preset that starts on the hour (23:00) counts as reaching it at once.
- Church bells: when the clock reaches a full hour, the Fara (site centre, 30 m up) and the Katedra (west towers, 40 m,
  a lower bell, 2.6 s later) strike the hour on the 12-hour dial: one `church` event per church carrying all the
  strokes (2.6 s apart), ref 45, range 520 (Stary Rynek hears the Fara ≈ 260 m away, not the Katedra ≈ 1 km).
- Noon show: on the `midday` preset the Ratusz goats come out at once and every 120 s (`goatShowTime`, the same
  timetable as their animation). The trumpeter plays the hejnał twice from the tower gallery (`hejnal`, 38 m, ref 20,
  range 380), then the goats knock heads 12 times on the east-front ledge (`goats`, at `GOAT_BUTT_TIMES`, ref 3, range
  120). The hejnał is a generic natural-trumpet bugle call, not a transcription of Poznań's hejnał.
- Joining late: each peal or show event is emitted once per peal/show, when the listener is within range, with an
  `offset` into it; `playEvent` leaves out the strokes, calls or knocks already over and starts one still ringing
  mid-buffer. `reset()` clears the played flags, so after an unmute or a teleport a peal or show still under way
  resumes part-way. Bells, the hejnał and the goats are `keep` kinds in `EVENT_SPACE`: a crash never evicts them.
  Their option objects and source records are built once; nothing allocates until an event actually fires.

## Acoustics

- `CityAcoustics.update` refreshes at 2 Hz, or immediately after the listener moves 20 m. It copies colliders from
  `controllerManager.nearColliders(x, z, 200)` into its own array. `nearColliders` returns a shared array that the
  next call overwrites, so always copy it. Small or low boxes (`maxY <= 3`, or footprints of 2 m or less) are skipped.
- `enclosure` (0..1) comes from 8 rising probes 80 m long. It drives the reflection send gain and cutoff in
  `CityAudioSystem.update`, and wind shelter in `createWindVoice`.
- `obstruction()` traces three parallel rays (+/-0.9 m aperture) through collider AABBs/OBBs, not meshes. Each
  emitter recomputes it every 0.28-0.40 s (jittered by seed), never every tick. Obstruction lowers `direct` gain and
  emitter cutoff, while the reflection send stays unobstructed, so sound bleeds around corners.
- `thickness` returns 0 when the listener is inside a box, because chase cameras clip into conservative colliders.
  Without that, the whole city would go silent.

## CPU overhead rules

- Call `setControlRate(...)` on every AudioParam of each new BiquadFilter, PannerNode and the listener, including
  ones you never automate (`detune`, `gain` on a lowpass). Any a-rate param left over forces per-sample filter or
  HRTF math. Oscillator frequency modulation and gain envelopes stay a-rate on purpose (the siren's two control
  oscillators drive `siren.frequency`, the wail also `sirenGain.gain`).
- Use `smoothParameter` (one in each of synthesis and events) for voice controls. It skips changes below an
  epsilon and cancels scheduled values first, so the automation timeline stays short.
- Precompute periodic content into looping buffers (turbine tones, rotor envelope, engine banks) instead of stacking
  oscillators per voice.
- Engines crossfade two pre-rendered RPM banks with equal power. A single loop pitched across the full rev range
  thins into a buzz.

## Recipes

**New continuous (looping, moving) sound**: add a `kind` branch and its name to the allow-list in
`createMotorVoice` (`audio-synthesis.js`). Add any baked buffer to `createSynthResources`. Emit candidates from
`CityAudioSources.collect` via `motor()` (or a new `NearestSources` category plus snapshot field). In
`CityAudioSystem`, choose a `refDistance` in `updatePool`, plus a limit and pool if it needs its own budget, and
clear the new pool in `reset()`.

**New one-shot event**: add a generator, build its buffers in `createEventResources`, and add a level to `levels`
plus a branch in `playEvent` (`audio-events.js`). An unknown kind returns a silent no-op. In `emit()`
(`audio-system.js`), add the kind's `ref` and `range`, and decide whether it `follow`s and whether crashes may evict
it. Trigger it from `update()` (using per-source `state()`) or from a public method called by `main.js`.

**New simulation source type**: read it in `CityAudioSources` (constructor and `collect`), give it a stable object
`id`, and pass the owning system through the constructor object built in `main.js`.

Only the pure parts are tested: the siren control wave (`tests/audio-siren.test.cjs`) and the clock, schedules and baked
event buffers (`tests/city-clock.test.cjs`). Nothing tests the Web Audio graph, mixing or spatialisation: verify changes in
the browser after a click or keypress has unlocked the context.
