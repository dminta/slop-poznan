# Spatial audio

All sound is synthesized at runtime with Web Audio. The repo has no audio asset files: every buffer (engine
firing loops, rotor, ratchet, chain, noise, impulse response, footsteps, speech syllables, horns, crash layers,
signal ticks, wind gusts) is computed sample by sample in `createSynthResources` / `createEventResources` when the
`AudioContext` is first created. Keep it that way: add new sounds as generator functions, not files.

## Map

- `audio-system.js` (`CityAudioSystem`, internal `SpatialEmitter`): context lifecycle, master graph, voice
  budgets, pooling, event emission, crash gating, footstep/conversation/signal/horn scheduling.
- `audio-synthesis.js`: shared buffers plus `createMotorVoice` (continuous voices: `sedan`, `suv`, `bus`,
  `helicopter`, `cyclist`, `siren`). Also exports `setControlRate`.
- `audio-events.js`: one-shot buffers, `playEvent` (`footstep`, `talk`, `horn`, `signal`, `crash`) and the
  non-spatial `createWindVoice`.
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

- `main.js` constructs `CityAudioSystem({ controllerManager, trafficSystem, highwayTraffic, streetDetails }, { onStateChange })`.
  It calls `update(dt, elapsed, camera, night)` every frame, `honk()` on KeyB, `setEnabled()` on KeyN and the
  `#btn-sound` button, and `dispose()` on `pagehide` (only when the page is not persisted to bfcache).
- No context exists until a user gesture. `pointerdown`/`keydown` listeners on `document` call `unlock()`, which
  lazily runs `initialize()` and then `resume()`. The listeners stay attached for the system's whole lifetime
  because iOS can interrupt a running context, and resuming needs another gesture. Keep them attached.
- `ready` is set by `main.js` only after the first GPU frame is submitted (loading overlay hidden). `update`,
  `crash` and `honk` do nothing until `ready && enabled && context.state === 'running' && !document.hidden`.
- Mute state persists in `localStorage['nyc-sound']` (`'off'` disables). Every storage access is in try/catch.
- `suspend()` re-checks state after the promise settles, so a quick unmute cannot leave the context suspended.
  Keep that reconciliation when you touch enable or visibility logic.
- `reset()` disposes every voice, clears per-source state, collision history and conversations, and snaps master
  to 0. It runs on visibility change, on mute, and when the listener jumps more than 60 m in one tick (teleport or
  camera switch). Pending sound is discarded, never queued.

## Update cadence and source selection

- `update` runs at about 10 Hz: an accumulator, with `dt` clamped to 0.25. Crashes are the exception. They arrive
  synchronously from physics, between ticks.
- `CityAudioSources.collect()` keeps the N nearest candidates per category with `NearestSources` (bounded insertion,
  reused records): motors 10, sirens 2, people 6, signals 2. The player passes score `-1`, so it is always
  included. Records are overwritten on the next `collect()`. Copy any field you need to keep (`emit` copies
  `position: { ...source }`).
- Source `id` is the simulation object itself (car, ped, controller entity, signal site), never an array index.
  Pools (`Map`) and per-source state (`WeakMap`) are keyed by it, so voices survive re-ranking and pooled-object
  reuse.
- `updatePool` limits live voices with `limits` (motors 8 / sirens 2 / events 8; on small devices, meaning
  `hardwareConcurrency <= 4` or a coarse pointer: 6 / 1 / 5). An unselected slot fades out over 0.12 s before it is
  disposed, and retiring slots still count against the limit, so churn cannot double the graph.
- Voices are not reused. A new source gets a new emitter and voice. Buffer sources start at a serial-based
  golden-ratio offset so identical loops do not phase-lock.
- Per-source distance fade: emitter gain uses a smoothstep over the last 30 % of `source.range`. `emit()` drops
  an event outright if it is beyond its kind's range (crash range scales with severity).
- Police cars get two records: a normal motor and a `siren` (in `sources.sirens`, its own pool and range).
- Inactive player bicycles are skipped (their stored speed is stale). Inactive player vehicles sound at reduced
  gain with zero speed/load. Highway cars with `y < -0.05` (lane-end dips, Battery tunnel) are silent.

## Simulation couplings (silent breakage risk)

`audio-sources.js` reads raw fields. A rename in the simulation does not throw. The sound just disappears or
freezes. If you rename or remove any of these, update `audio-sources.js` in the same change:
- street cars/buses (`trafficSystem.cars/buses`): `edge`, `edge.to.signal`, `edge.axisIndex`, `x`, `z`, `speed`,
  `acc`, `driver.a`, `yaw`, `yawOffset`, `isPolice`, `bus`, `isSUV`, `wait`, `gap`, `leaderSpeed`, `conn`, `yielding`.
- highway cars: `placed`, `x`, `y`, `z`, `yaw`, `v`, `acc`, `kind`. `createHighwayTraffic` writes the pose before
  any visibility-culling `continue` so that cars behind the camera are still audible. Keep that order.
- peds: `placed`, `x`, `z`, `ax`, `az`, `ux`, `uz`, `len`, `node`, `v`, `rig.seed`, `rig.phase`, `rig.feet[i].px/py/pz`,
  `conversation` (`{ a, b }`, where `a`/`b` are ped objects and both must point back at the pair).
- controller entities: `type`, `position`, `speed`, `heading`, `verticalSpeed`, `verticalVel`, `mesh.visible`,
  `rig`, plus `controllerManager.keys`, `getActiveEntity()`, `getGroundHeight()`. `helicopterVerticalSpeed` clamps at
  y 0.25 / 380 to mirror the controller's altitude clamp. If you change those limits in `controllers.js`, update it.
- `streetDetails.audioSignals`: pole positions with `isAvenue`. WALK timing comes from `walkSignal` in `city-config.js`.
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
- Horns: automatic horns go off when an NPC is `blocked` for more than 4 s, with a 3 s global gap and an 18-33 s
  per-car gap. `honk()` handles the player's KeyB and works for `type === 'car'` only.
- Conversations: only the pair's `a` member drives turns, and only while both peds are nearly still. The next turn
  starts at `voice.endTime` plus a pause, so the speakers never overlap.
- Signals: tick and walk patterns are scheduled ahead with `when`. A phase change removes the pending events for
  that pole.

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
  HRTF math. Oscillator frequency modulation and gain envelopes stay a-rate on purpose (the siren sweep drives
  `siren.frequency` and `sirenGain.gain`).
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

No tests cover audio. Verify changes in the browser after a click or keypress has unlocked the context.
