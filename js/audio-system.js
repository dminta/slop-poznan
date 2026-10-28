import { createSynthResources, createMotorVoice, setControlRate } from './audio-synthesis.js';
import { createEventResources, playEvent, createWindVoice, SIGNAL_TIMING } from './audio-events.js';
import { CityAudioSources } from './audio-sources.js';
import { CityAcoustics } from './audio-acoustics.js';
import { LANDMARK_SITES } from './city-config.js';
import {
  CHURCH_BELLS,
  GOAT_BUTT_TIMES,
  HEJNAL,
  PRESET_CLOCK,
  RATUSZ_SOUNDS,
  clockMinutes,
  fullHourIn,
  goatShowTime,
  hejnalLength,
  hourStrokes,
  pealLength,
  sitePoint
} from './city-clock.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Per event kind: the panner's reference distance, the range beyond which emit() drops it, the emitter's height above
// the source, whether it follows its source, whether a crash may evict it (`keep`: never) and whether it is
// directional. The landmark sounds (church bells, the hejnał, the goats) carry their real height in the source's y.
// Crashes scale ref and range with severity in emit().
const EVENT_SPACE = {
  footstep: { ref: 1.8, range: 22, height: 0 },
  talk: { ref: 2, range: 30, height: 1.5, follow: true },
  horn: { ref: 8, range: 140, height: 0, follow: true, keep: true, directional: true },
  bell: { ref: 9, range: 160, height: 1.6, follow: true, keep: true },
  signal: { ref: 1.8, range: 35, height: 0 },
  church: { ref: 45, range: 520, height: 0, keep: true },
  hejnal: { ref: 20, range: 380, height: 0, keep: true },
  goats: { ref: 3, range: 120, height: 0, keep: true }
};
const smooth = (param, value, now, time = 0.035, immediate = false) => {
  param.cancelScheduledValues(now);
  if (immediate) param.setValueAtTime(value, now);
  else param.setTargetAtTime(value, now, time);
};

// Direct sound is muffled behind buildings; the shared reflection path keeps some diffuse sound around corners.
// All voices share one short convolution and the existing collision grid, with no mesh traversal or per-voice reverb.
class SpatialEmitter {
  constructor(context, dry, reflections, acoustics, refDistance, height = 0, directional = false) {
    this.height = height;
    this.acoustics = acoustics;
    this.nextObstruction = 0;
    this.obstruction = 0;
    this.input = context.createGain();
    this.input.gain.value = 0;
    this.filter = context.createBiquadFilter();
    setControlRate(this.filter.frequency, this.filter.detune, this.filter.Q, this.filter.gain);
    this.filter.type = 'lowpass';
    this.filter.Q.value = 0.5;
    this.panner = context.createPanner();
    setControlRate(
      this.panner.positionX, this.panner.positionY, this.panner.positionZ,
      this.panner.orientationX, this.panner.orientationY, this.panner.orientationZ
    );
    this.panner.panningModel = 'HRTF';
    this.panner.distanceModel = 'inverse';
    this.panner.refDistance = refDistance;
    this.panner.rolloffFactor = 1.15;
    this.panner.maxDistance = 500;
    if (directional) {
      this.panner.coneInnerAngle = 120;
      this.panner.coneOuterAngle = 260;
      this.panner.coneOuterGain = 0.6;
    }
    this.direct = context.createGain();
    this.input.connect(this.filter).connect(this.panner);
    this.panner.connect(this.direct).connect(dry);
    this.panner.connect(reflections);
  }

  update(source, listener, now, range = 160, snap = false, immediate = false) {
    const y = source.y + this.height;
    const distance = Math.hypot(source.x - listener.x, y - listener.y, source.z - listener.z);
    if (snap) {
      this.panner.positionX.cancelScheduledValues(now);
      this.panner.positionY.cancelScheduledValues(now);
      this.panner.positionZ.cancelScheduledValues(now);
      this.panner.positionX.setValueAtTime(source.x, now);
      this.panner.positionY.setValueAtTime(y, now);
      this.panner.positionZ.setValueAtTime(source.z, now);
    } else {
      smooth(this.panner.positionX, source.x, now);
      smooth(this.panner.positionY, y, now);
      smooth(this.panner.positionZ, source.z, now);
    }
    if (this.panner.coneOuterAngle < 360 && Number.isFinite(source.heading)) {
      smooth(this.panner.orientationX, Math.sin(source.heading), now);
      smooth(this.panner.orientationZ, Math.cos(source.heading), now);
    }
    if (snap || now >= this.nextObstruction) {
      this.obstruction = this.acoustics.obstruction(source, listener, this.height);
      this.nextObstruction = now + 0.28 + (Math.abs(source.seed || 0) % 1) * 0.12;
    }
    const fade = clamp((range - distance) / (range * 0.3), 0, 1);
    smooth(this.input.gain, (source.gain ?? 1) * fade * fade * (3 - 2 * fade), now, 0.035, immediate);
    smooth(this.direct.gain, 1 - this.obstruction * 0.78, now, 0.12, immediate);
    const airCutoff = 1800 + 14000 * Math.exp(-distance / 70);
    smooth(this.filter.frequency, airCutoff * Math.pow(0.065, this.obstruction), now, 0.12, immediate);
    return distance;
  }

  dispose() {
    this.input.disconnect();
    this.filter.disconnect();
    this.panner.disconnect();
    this.direct.disconnect();
  }
}

class CityAudioSystem {
  constructor(simulation, { onStateChange = () => {} } = {}) {
    this.sources = new CityAudioSources(simulation);
    this.acoustics = new CityAcoustics(simulation.controllerManager);
    this.onStateChange = onStateChange;
    this.context = null;
    this.ready = false;
    this.disposed = false;
    this.supported = !!(globalThis.AudioContext || globalThis.webkitAudioContext);
    this.enabled = true;
    // 'sound' replaced 'nyc-sound' for the Poznań port; the old key still counts until the next toggle rewrites it, so
    // a mute choice survives the rename.
    try {
      this.enabled = (localStorage.getItem('sound') ?? localStorage.getItem('nyc-sound')) !== 'off';
    } catch { /* Private browsing. */ }
    const smallDevice = navigator.hardwareConcurrency <= 4 || matchMedia('(pointer: coarse)').matches;
    this.limits = smallDevice ? { motors: 6, sirens: 1, trams: 2, events: 5 } : { motors: 8, sirens: 2, trams: 3, events: 8 };
    this.motors = new Map();
    this.sirens = new Map();
    this.trams = new Map();
    this.events = [];
    this.states = new WeakMap();
    this.conversations = new WeakMap();
    this.listener = { x: 0, y: 0, z: 0 };
    this.haveListener = false;
    this.accumulator = 0;
    this.lastHorn = -Infinity;
    this.collisionPairs = new WeakMap();
    this.collisionSequence = 0;
    this.collisionSystems = [simulation.controllerManager, simulation.trafficSystem];
    this.onCollision = (impact) => this.crash(impact);
    for (const system of this.collisionSystems) system.setCollisionListener?.(this.onCollision);
    this.motorParams = { speed: 0, load: 0, verticalSpeed: 0, squeal: 0, doppler: 1, seed: 0 };
    this.windParams = { speed: 0, altitude: 0, night: 0, traffic: 0, enclosure: 0 };
    this.footPosition = { x: 0, y: 0, z: 0, seed: 0 };
    // The clock-driven landmark sounds (city-clock.js): fixed source records (their own ids), reused option objects,
    // and the state of the current hour's peal and noon show. `played` flags are cleared by reset(), so a peal or
    // show still running when the listener comes back (unmute, teleport) resumes part-way instead of being lost.
    const landmark = (name, along, y, seed) => {
      const site = LANDMARK_SITES[name];
      if (!site) return null;
      const point = sitePoint(site, along, y);
      const source = { id: null, x: point.x, y: point.y, z: point.z, seed };
      source.id = source;
      return source;
    };
    this.churches = CHURCH_BELLS.map((bell, i) => ({ bell, source: landmark(bell.site, bell.along, bell.y, 71 + i), played: false }));
    this.trumpeter = landmark('Ratusz', RATUSZ_SOUNDS.trumpeter.along, RATUSZ_SOUNDS.trumpeter.y, 81);
    this.goatLedge = landmark('Ratusz', RATUSZ_SOUNDS.goats.along, RATUSZ_SOUNDS.goats.y, 82);
    this.presetId = null;
    this.presetSince = 0;
    this.clockFrom = 0;
    this.peal = { start: -Infinity, strokes: 0 };
    this.show = { midday: false, start: 0 };
    this.showTime = -1;
    this.lastShowTime = -1;
    this.hejnalPlayed = false;
    this.goatsPlayed = false;
    this.hejnalEnd = HEJNAL.plays[HEJNAL.plays.length - 1] + hejnalLength();
    this.churchOptions = { strokes: 1, pitch: 1, offset: 0, when: 0, intensity: 1 };
    this.showOptions = { offset: 0, intensity: 1 };
    this.onGesture = (event) => {
      if (event.type === 'keydown' && (event.repeat || event.metaKey || event.ctrlKey || /INPUT|TEXTAREA|SELECT/.test(event.target?.tagName))) return;
      if (this.enabled) this.unlock();
    };
    this.onVisibility = () => {
      this.reset();
      if (document.hidden) this.suspend();
      else if (this.enabled && this.context) this.unlock();
    };
    // Keep gesture handlers: iOS can interrupt a previously running context, and resuming may need another tap.
    document.addEventListener('pointerdown', this.onGesture, { passive: true });
    document.addEventListener('keydown', this.onGesture);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  unlock() {
    if (!this.supported || !this.enabled || this.disposed || document.hidden) return;
    try {
      if (!this.context) this.initialize();
      if (this.context.state !== 'running') {
        this.context.resume().then(() => {
          if (!this.enabled || document.hidden || this.disposed) return this.suspend();
          this.onStateChange();
        }).catch(() => {}); // A later user gesture can retry autoplay/interruption failures.
      }
    } catch (error) {
      console.warn('[audio] Unable to initialize sound', error);
      this.supported = false;
      this.context?.close().catch(() => {});
      this.onStateChange();
    }
  }

  initialize() {
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    const context = this.context = new Context({ latencyHint: 'interactive' });
    const listener = context.listener;
    setControlRate(
      listener.positionX, listener.positionY, listener.positionZ,
      listener.forwardX, listener.forwardY, listener.forwardZ,
      listener.upX, listener.upY, listener.upZ
    );
    this.resources = createEventResources(context, createSynthResources(context));
    this.mix = context.createGain();
    this.compressor = context.createDynamicsCompressor();
    this.compressor.threshold.value = -16;
    this.compressor.knee.value = 12;
    this.compressor.ratio.value = 6;
    this.compressor.attack.value = 0.005;
    this.compressor.release.value = 0.22;
    this.master = context.createGain();
    this.master.gain.value = 0;
    this.mix.connect(this.compressor).connect(this.master).connect(context.destination);
    this.reflections = context.createGain();
    this.reflections.gain.value = 0.02;
    this.reverb = context.createConvolver();
    this.reverb.normalize = false;
    this.reverb.buffer = this.resources.impulse;
    this.reflectionFilter = context.createBiquadFilter();
    setControlRate(this.reflectionFilter.frequency, this.reflectionFilter.detune, this.reflectionFilter.Q, this.reflectionFilter.gain);
    this.reflectionFilter.type = 'lowpass';
    this.reflectionFilter.frequency.value = 2400;
    this.reflectionFilter.Q.value = 0.5;
    this.reflections.connect(this.reverb).connect(this.reflectionFilter).connect(this.mix);
    this.wind = createWindVoice(context, this.resources, this.mix);
    context.onstatechange = () => this.onStateChange();
  }

  setEnabled(enabled) {
    this.enabled = !!enabled;
    try {
      localStorage.setItem('sound', this.enabled ? 'on' : 'off');
      localStorage.removeItem('nyc-sound');
    } catch { /* Storage is optional. */ }
    if (this.enabled) this.unlock();
    else {
      this.reset();
      this.suspend();
    }
    this.onStateChange();
  }

  suspend() {
    if (!this.context || this.context.state === 'closed') return;
    // Visibility/mute can change again while suspend is pending. Reconcile after it settles so a rapid unmute
    // cannot leave an enabled system suspended merely because resume saw the old 'running' state.
    return this.context.suspend().then(() => {
      if (this.enabled && !document.hidden && !this.disposed) this.unlock();
    }).catch(() => {});
  }

  reset() {
    for (const pool of [this.motors, this.sirens, this.trams]) {
      for (const slot of pool.values()) { slot.voice.dispose(); slot.emitter.dispose(); }
      pool.clear();
    }
    for (const event of this.events) { event.voice.dispose(true); event.emitter.dispose(); }
    this.events.length = 0;
    this.conversations = new WeakMap();
    this.states = new WeakMap();
    this.collisionPairs = new WeakMap();
    for (const church of this.churches) church.played = false;
    this.hejnalPlayed = this.goatsPlayed = false;
    this.haveListener = false;
    this.accumulator = 0;
    if (this.master) {
      this.master.gain.cancelScheduledValues(this.context.currentTime);
      this.master.gain.setValueAtTime(0, this.context.currentTime);
    }
  }

  state(source, now) {
    let state = this.states.get(source.id);
    if (!state) {
      const hash = Math.sin(source.seed * 127.1 + 311.7) * 43758.5453;
      const variation = hash - Math.floor(hash);
      state = { variation, phase: source.phase, grounded: source.grounded, x: source.x, z: source.z,
        signal: now + variation, horn: now + 8 + variation * 13, stopped: 0, stepSequence: 0 };
      this.states.set(source.id, state);
    }
    return state;
  }

  updateConversations(people, now) {
    // Only the nearby pair's first member schedules speech. Shared turn state prevents overlapping replies.
    for (const source of people) {
      const pair = source.conversation;
      if (!pair || pair.a !== source.id || pair.a.conversation !== pair || pair.b.conversation !== pair) continue;
      const partner = people.find(person => person.id === pair.b && person.conversation === pair);
      if (!partner || source.speed > 0.15 || partner.speed > 0.15) continue;
      let state = this.conversations.get(pair);
      if (!state) {
        state = { reply: false, sequence: 0, next: now + 0.3 };
        this.conversations.set(pair, state);
      }
      if (now < state.next) continue;
      const speaker = state.reply ? partner : source;
      if (this.emit('talk', speaker, { intensity: 0.3, seed: speaker.seed + state.sequence, voiceSeed: speaker.seed })) {
        const voice = this.events[this.events.length - 1].voice;
        const pause = 0.35 + (Math.sin(speaker.seed * 53 + state.sequence * 17.13) * 0.5 + 0.5) * 0.75;
        state.next = voice.endTime + pause;
        state.reply = !state.reply;
        state.sequence++;
      } else {
        state.next = now + 0.5;
      }
    }
  }

  updatePool(pool, candidates, limit, now, dt, siren = false) {
    for (const slot of pool.values()) slot.selected = false;
    let count = 0;
    for (const source of candidates) {
      if (siren && !source.police) continue;
      if (++count > limit) break;
      let slot = pool.get(source.id);
      if (!slot) {
        // Retiring voices count against the budget, so rapid source changes cannot temporarily double the graph.
        if (pool.size >= limit) continue;
        const emitter = new SpatialEmitter(this.context, this.mix, this.reflections, this.acoustics,
          siren ? 9 : source.kind === 'helicopter' ? 12 : source.kind === 'tram' ? 7 : 4, siren ? 0.9 : 0, siren);
        slot = { emitter, voice: createMotorVoice(this.context, this.resources, siren ? 'siren' : source.kind, emitter.input),
          distance: 0, x: source.x, y: source.y, z: source.z, fresh: true };
        pool.set(source.id, slot);
      }
      slot.selected = true;
      slot.retire = 0;
      const jumped = Math.hypot(source.x - slot.x, source.y - slot.y, source.z - slot.z) > 35;
      const range = source.range;
      const distance = slot.emitter.update(source, this.listener, now, range, slot.fresh || jumped);
      const radial = slot.fresh || jumped ? 0 : clamp((distance - slot.distance) / dt, -60, 60);
      const params = this.motorParams;
      params.speed = source.speed;
      params.load = source.load;
      params.verticalSpeed = source.verticalSpeed;
      params.squeal = source.squeal || 0;
      params.seed = source.seed;
      params.doppler = clamp(343 / (343 + radial), 0.85, 1.18);
      slot.voice.update(params, now);
      slot.distance = distance;
      slot.x = source.x; slot.y = source.y; slot.z = source.z;
      slot.fresh = false;
    }
    for (const [id, slot] of pool) {
      if (slot.selected) continue;
      if (!slot.retire) {
        smooth(slot.emitter.input.gain, 0, now, 0.025);
        slot.retire = now + 0.12;
      } else if (now >= slot.retire) {
        slot.voice.dispose(); slot.emitter.dispose(); pool.delete(id);
      }
    }
  }

  removeEvent(index) {
    const event = this.events[index];
    event.voice.dispose(true);
    event.emitter.dispose();
    this.events.splice(index, 1);
  }

  emit(kind, source, options = {}) {
    const now = this.context.currentTime;
    const crash = kind === 'crash';
    const severity = clamp(options.severity ?? options.intensity ?? 1, 0, 1);
    const space = EVENT_SPACE[kind] || EVENT_SPACE.signal;
    const ref = crash ? 4 + severity * 8 : space.ref;
    const range = crash ? 50 + severity * 110 : space.range;
    if (Math.hypot(source.x - this.listener.x, source.y - this.listener.y, source.z - this.listener.z) > range) return false;
    if (crash) {
      // Impacts are immediate, between the 10 Hz ambience updates. Reclaim finished events first, then let
      // a strong impact displace a quieter crash or background event without increasing the voice budget.
      for (let i = this.events.length - 1; i >= 0; i--) {
        if (now >= this.events[i].voice.endTime) this.removeEvent(i);
      }
      let crashes = 0, weakest = -1;
      for (let i = 0; i < this.events.length; i++) {
        const event = this.events[i];
        if (event.kind !== 'crash') continue;
        crashes++;
        if (weakest < 0 || event.severity < this.events[weakest].severity) weakest = i;
      }
      if (crashes >= Math.min(3, this.limits.events)) {
        if (severity <= this.events[weakest].severity) return false;
        this.removeEvent(weakest);
      }
      if (this.events.length >= this.limits.events) {
        const background = this.events.findIndex(event => event.kind !== 'crash' && !EVENT_SPACE[event.kind]?.keep);
        if (background < 0) return false;
        this.removeEvent(background);
      }
    }
    if (this.events.length >= this.limits.events) return false;
    const emitter = new SpatialEmitter(this.context, this.mix, this.reflections, this.acoustics,
      ref, crash ? 0 : space.height, !crash && !!space.directional);
    // Do not fade away the first few milliseconds of a crash: its spatial gain and filtering are ready at onset.
    emitter.update(source, this.listener, now, range, true, crash);
    const voice = playEvent(this.context, this.resources, kind, emitter.input, { seed: source.seed, ...options });
    this.events.push({ kind, voice, emitter, id: source.id, range, severity, position: { ...source }, follow: !crash && !!space.follow });
    return true;
  }

  crash(impact) {
    if (!this.ready || !this.enabled || !this.haveListener || this.context?.state !== 'running' || document.hidden) return false;
    const { a, b, x, y, z, speed } = impact;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || a === b
      || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !Number.isFinite(speed) || speed < 0.8) return false;
    if (Math.hypot(x - this.listener.x, y - this.listener.y, z - this.listener.z) > 160) return false;
    const now = this.context.currentTime;
    let contacts = this.collisionPairs.get(a);
    if (!contacts) this.collisionPairs.set(a, contacts = new WeakMap());
    let contact = contacts.get(b);
    if (!contact) {
      contact = { last: -Infinity, played: -Infinity, speed: 0 };
      contacts.set(b, contact);
      let reverse = this.collisionPairs.get(b);
      if (!reverse) this.collisionPairs.set(b, reverse = new WeakMap());
      reverse.set(a, contact);
    }
    const separated = now - contact.last > 0.3;
    contact.last = now;
    // Both pair orders share the gate. Sustained rubbing stays quiet, but a substantially stronger second hit
    // or a new impact after separation can sound again; muting/reset discards this history rather than queuing it.
    if (now - contact.played < 0.18 || (!separated && speed <= Math.max(4, contact.speed * 1.8))) return false;
    const light = a.type === 'cyclist' || b.type === 'cyclist';
    const severity = clamp((speed - 0.8) / 22, 0, 1) * (light ? 0.65 : 1);
    const intensity = (0.12 + 0.88 * Math.sqrt(severity)) * (light ? 0.7 : 1);
    // The physics record is reused. emit() copies this position so the crash remains at the contact point.
    if (!this.emit('crash', { id: a, x, y, z, seed: ++this.collisionSequence }, { severity, intensity })) return false;
    contact.played = now;
    contact.speed = speed;
    return true;
  }

  honk(entity) {
    if (!this.ready || !this.enabled || this.context?.state !== 'running' || entity?.type !== 'car') return;
    const now = this.context.currentTime;
    if (now - this.lastHorn < 0.8) return;
    if (this.emit('horn', { id: entity, ...entity.position, heading: entity.heading, seed: 4 }, { intensity: 0.7 })) this.lastHorn = now;
  }

  // Every frame, even muted: the clock and the noon show must see a preset change on the same frame (and elapsed) as
  // landmarks-rynek.js does, or the goats' knocks would drift off their animation. No allocation.
  trackClock(elapsed, presetId) {
    if (presetId !== this.presetId) {
      this.presetId = presetId;
      this.presetSince = elapsed;
      // just below the preset's time, so a preset that starts on the hour (23:00) strikes at once
      this.clockFrom = (PRESET_CLOCK[presetId] ?? PRESET_CLOCK.golden) - 1e-6;
    }
    this.showTime = goatShowTime(this.show, elapsed, presetId);
  }

  // The hour bells and the noon show (city-clock.js), at the 10 Hz tick. Each one-shot covers a whole peal or show
  // and is emitted once, when the listener is within its range; joining late passes an offset, so playEvent leaves
  // out what is already over.
  updateLandmarkSounds(elapsed, now) {
    const minutes = clockMinutes(this.presetId, elapsed - this.presetSince);
    const hour = fullHourIn(this.clockFrom, minutes);
    this.clockFrom = minutes;
    if (hour >= 0) {
      this.peal.start = now - (minutes - hour * 60) * 60;
      this.peal.strokes = hourStrokes(hour);
      for (const church of this.churches) church.played = false;
    }
    if (this.peal.strokes) {
      const length = pealLength(this.peal.strokes);
      for (const church of this.churches) {
        if (church.played || !church.source) continue;
        const offset = now - this.peal.start - church.bell.delay;
        if (offset >= length) continue;
        if (!this.inRange(church.source, EVENT_SPACE.church.range)) continue;
        const options = this.churchOptions;
        options.strokes = this.peal.strokes;
        options.pitch = church.bell.pitch;
        options.offset = Math.max(0, offset);
        options.when = now + Math.max(0, -offset);
        church.played = this.emit('church', church.source, options);
      }
    }
    const t = this.showTime;
    if (t < 0 || t < this.lastShowTime) this.hejnalPlayed = this.goatsPlayed = false; // a new show
    this.lastShowTime = t;
    if (t < 0) return;
    const options = this.showOptions;
    options.offset = t;
    if (!this.hejnalPlayed && this.trumpeter && t < this.hejnalEnd && this.inRange(this.trumpeter, EVENT_SPACE.hejnal.range)) {
      this.hejnalPlayed = this.emit('hejnal', this.trumpeter, options);
    }
    if (!this.goatsPlayed && this.goatLedge && t < GOAT_BUTT_TIMES[GOAT_BUTT_TIMES.length - 1]
      && this.inRange(this.goatLedge, EVENT_SPACE.goats.range)) {
      this.goatsPlayed = this.emit('goats', this.goatLedge, options);
    }
  }

  inRange(source, range) {
    return Math.hypot(source.x - this.listener.x, source.y - this.listener.y, source.z - this.listener.z) <= range;
  }

  // presetId: the lighting preset (lighting.js TIME_PRESETS key): 'midnight' quietens the wind, and it sets the clock
  update(dt, elapsed, camera, presetId = 'golden') {
    this.trackClock(elapsed, presetId);
    if (!this.ready || !this.enabled || this.context?.state !== 'running' || document.hidden) return;
    this.accumulator += dt;
    if (this.accumulator < 0.1) return;
    dt = Math.min(this.accumulator, 0.25);
    this.accumulator %= 0.1;
    const now = this.context.currentTime;
    const position = camera.position;
    if (this.haveListener && Math.hypot(position.x - this.listener.x, position.y - this.listener.y, position.z - this.listener.z) > 60) this.reset();
    this.listener.x = position.x; this.listener.y = position.y; this.listener.z = position.z;
    camera.updateMatrixWorld();
    const m = camera.matrixWorld.elements;
    const listener = this.context.listener;
    if (listener.positionX) {
      const values = [position.x, position.y, position.z, -m[8], -m[9], -m[10], m[4], m[5], m[6]];
      const params = [listener.positionX, listener.positionY, listener.positionZ, listener.forwardX, listener.forwardY,
        listener.forwardZ, listener.upX, listener.upY, listener.upZ];
      for (let i = 0; i < params.length; i++) {
        if (this.haveListener) smooth(params[i], values[i], now, 0.025);
        else params[i].setValueAtTime(values[i], now);
      }
    } else {
      listener.setPosition(position.x, position.y, position.z);
      listener.setOrientation(-m[8], -m[9], -m[10], m[4], m[5], m[6]);
    }
    this.haveListener = true;
    this.acoustics.update(this.listener, now);
    const enclosure = this.acoustics.enclosure;
    smooth(this.reflections.gain, 0.02 + enclosure * 0.22, now, 0.4);
    smooth(this.reflectionFilter.frequency, 2400 + enclosure * 3400, now, 0.4);
    smooth(this.master.gain, 0.65, now, 0.12);
    const sources = this.sources.collect(this.listener, elapsed);
    for (let i = this.events.length - 1; i >= 0; i--) {
      const event = this.events[i];
      if (now >= event.voice.endTime) {
        this.removeEvent(i);
      } else {
        const pair = event.position.conversation;
        if (pair && (pair.a.conversation !== pair || pair.b.conversation !== pair)) {
          event.voice.dispose();
          event.follow = false; // Fade at the old position if the meeting ended or a pedestrian was recycled.
        }
        const source = event.follow && (sources.motors.find(s => s.id === event.id) || sources.trams.find(s => s.id === event.id)
          || sources.people.find(s => s.id === event.id));
        if (source) Object.assign(event.position, source);
        event.emitter.update(event.position, this.listener, now, event.range);
      }
    }
    this.updatePool(this.motors, sources.motors, this.limits.motors, now, dt);
    this.updatePool(this.sirens, sources.sirens, this.limits.sirens, now, dt, true);
    this.updatePool(this.trams, sources.trams, this.limits.trams, now, dt);
    // Tram bells: a ding-ding as a tram leaves its stop (once the doors have closed), and every few seconds while it
    // waits for the player on its track
    for (const source of sources.trams) {
      const state = this.state(source, now);
      const departing = state.tramStopped === true && !source.stopped;
      state.tramStopped = source.stopped;
      if (departing || (source.bell && now >= (state.bell || 0))) {
        if (this.emit('bell', source, { intensity: source.bell ? 0.8 : 0.55 })) state.bell = now + 4 + state.variation * 2;
      }
    }
    for (const source of sources.people) {
      const state = this.state(source, now);
      const moved = Math.hypot(source.x - state.x, source.z - state.z);
      if (source.grounded && moved < 3 && Number.isFinite(state.phase)) {
        for (let foot = 0; foot < 2; foot++) {
          // The rig plants each foot when its phase wraps, including different stride lengths and running gaits.
          const offset = foot * 0.5;
          const planted = (source.phase + offset) % 1 < (state.phase + offset) % 1;
          if ((planted && source.speed > 0.2) || (!state.grounded && foot === 0)) {
            const position = this.footPosition;
            position.x = foot ? source.rightX : source.leftX;
            position.y = foot ? source.rightY : source.leftY;
            position.z = foot ? source.rightZ : source.leftZ;
            position.seed = source.seed;
            this.emit('footstep', position, { intensity: source.speed > 3 ? 0.65 : 0.4,
              seed: source.seed + state.stepSequence++, speed: source.speed });
          }
        }
      }
      state.phase = source.phase; state.grounded = source.grounded;
      state.x = source.x; state.z = source.z;
    }
    this.updateConversations(sources.people, now);
    this.updateLandmarkSounds(elapsed, now);
    for (const source of sources.signals) {
      const state = this.state(source, now);
      if (state.walk !== source.walk) {
        if (state.walk !== undefined) {
          for (let i = this.events.length - 1; i >= 0; i--) {
            const event = this.events[i];
            if (event.kind !== 'signal' || event.id !== source.id) continue;
            this.removeEvent(i);
          }
        }
        state.walk = source.walk;
        state.signal = now;
      }
      if (now + 0.12 >= state.signal) {
        const when = Math.max(now, state.signal);
        this.emit('signal', source, { walk: source.walk, intensity: 0.28, when });
        state.signal = when + (source.walk ? SIGNAL_TIMING.walk : SIGNAL_TIMING.wait);
      }
    }
    for (const source of sources.motors) {
      if (source.player || source.kind === 'helicopter' || source.kind === 'cyclist') continue;
      const state = this.state(source, now);
      // Polish drivers honk far less than New York's: only after 8 s stuck behind a stalled car, and a driver who has
      // honked waits 30-50 s before the next one
      state.stopped = source.blocked ? state.stopped + dt : 0;
      if (state.stopped > 8 && now > state.horn && now - this.lastHorn > 3) {
        if (this.emit('horn', source, { intensity: 0.55 })) {
          state.horn = now + 30 + state.variation * 20;
          this.lastHorn = now;
        }
      }
    }
    Object.assign(this.windParams, { speed: Math.min(sources.motion, 50), altitude: position.y, traffic: sources.traffic, night: presetId === 'midnight' ? 1 : 0, enclosure });
    this.wind.update(this.windParams, now);
  }

  dispose() {
    this.disposed = true;
    for (const system of this.collisionSystems) system.setCollisionListener?.(null);
    document.removeEventListener('pointerdown', this.onGesture);
    document.removeEventListener('keydown', this.onGesture);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.reset();
    this.wind?.dispose(true);
    for (const node of [this.mix, this.compressor, this.master, this.reflections, this.reverb, this.reflectionFilter]) node?.disconnect();
    if (this.context) {
      this.context.onstatechange = null;
      this.context.close().catch(() => {});
    }
  }
}

export { CityAudioSystem };
