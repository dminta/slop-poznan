import { setControlRate } from './audio-synthesis.js';
import { CHURCH_PEAL, GOAT_BUTT_TIMES, HEJNAL, hejnalLength, hejnalNotes } from './city-clock.js';

const TAU = Math.PI * 2;
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, finite(value)));
const smoothstep = (value) => { const x = clamp(value); return x * x * (3 - 2 * x); };

function randomSource(seed) {
  let state = (finite(seed, 1) * 2654435761) >>> 0;
  state = Math.imul(state ^ (state >>> 16), 0x7feb352d);
  state = Math.imul(state ^ (state >>> 15), 0x846ca68b);
  state ^= state >>> 16;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// `rate` lets long, mostly low-pitched buffers (church bell, hejnał) render at a lower sample rate: the context
// resamples on playback, and a 22.05 kHz buffer takes half the time and memory to bake.
function makeBuffer(ctx, duration, synthesize, peak = 0.6, rate = ctx.sampleRate) {
  const buffer = ctx.createBuffer(1, Math.ceil(duration * rate), rate);
  const samples = buffer.getChannelData(0);
  let maximum = 0, mean = 0;
  for (let i = 0; i < samples.length; i++) {
    samples[i] = synthesize(i / rate, i);
    mean += samples[i];
  }
  mean /= samples.length;
  for (let i = 0; i < samples.length; i++) {
    // A short endpoint fade removes clicks even when a pitched component ends between zero crossings.
    const fade = Math.min(1, i / (rate * 0.002), (samples.length - 1 - i) / (rate * 0.012));
    samples[i] = (samples[i] - mean) * fade;
    maximum = Math.max(maximum, Math.abs(samples[i]));
  }
  const scale = maximum > 0 ? peak / maximum : 0;
  for (let i = 0; i < samples.length; i++) samples[i] *= scale;
  return buffer;
}

function footstep(ctx, seed) {
  const random = randomSource(seed);
  const soleTime = 0.024 + random() * 0.035;
  const scuffTime = soleTime + 0.025 + random() * 0.025;
  const contacts = Array.from({ length: 5 }, () => ({
    time: random() * 0.10, decay: 170 + random() * 300, level: 0.025 + random() * 0.075
  }));
  const coefficients = [180, 1050, 4600].map((frequency) => 1 - Math.exp(-TAU * frequency / ctx.sampleRate));
  const bands = [0, 0, 0];
  return makeBuffer(ctx, 0.23, (t) => {
    const noise = random() * 2 - 1;
    for (let i = 0; i < bands.length; i++) bands[i] += (noise - bands[i]) * coefficients[i];
    const body = bands[1] - bands[0], grit = bands[2] - bands[1];
    const heel = (1 - Math.exp(-t * 1900)) * Math.exp(-t * 105);
    const sole = Math.max(0, t - soleTime);
    const roll = (1 - Math.exp(-sole * 1100)) * Math.exp(-sole * 58);
    const scuff = Math.max(0, t - scuffTime);
    const drag = (1 - Math.exp(-scuff * 130)) * Math.exp(-scuff * 38);
    let fragments = 0;
    for (const contact of contacts) {
      if (t > contact.time) fragments += Math.exp(-(t - contact.time) * contact.decay) * contact.level;
    }
    // Short, differently coloured heel and sole contacts, followed by irregular concrete grit. No pitched kick.
    return (bands[0] * 0.25 + body * 0.9 + grit * 0.55) * heel
      + (bands[0] * 0.3 + body * 0.65 + grit * 0.15) * roll
      + (grit * 0.22 + (noise - bands[2]) * 0.035) * drag + grit * fragments;
  }, 0.55);
}

function speechFragment(ctx, speaker, seed) {
  const random = randomSource(seed);
  const vowels = [[600, 1170, 2380], [470, 1740, 2460], [340, 2010, 2650], [470, 890, 2300], [420, 1450, 2350]];
  const duration = 0.57 + random() * 0.28;
  const count = 2 + Math.floor(random() * 3);
  const segments = Array.from({ length: count }, () => ({
    vowel: vowels[Math.floor(random() * vowels.length)], weight: 0.65 + random() * 0.7,
    consonant: Math.floor(random() * 5), transition: 0.028 + random() * 0.038,
    stress: 0.62 + random() * 0.38, pitch: 0.96 + random() * 0.1
  }));
  const weight = segments.reduce((sum, segment) => sum + segment.weight, 0);
  let cursor = 0;
  for (const segment of segments) {
    segment.start = cursor;
    segment.duration = duration * segment.weight / weight;
    cursor += segment.duration;
  }
  const resonators = [95, 135, 190].map((bandwidth, i) => {
    const radius = Math.exp(-Math.PI * bandwidth / ctx.sampleRate);
    return {
      radius, a: 0, b: radius * radius, gain: (1 - radius) * [1, 0.8, 0.36][i],
      frequency: segments[0].vowel[i] * speaker.formants, y1: 0, y2: 0
    };
  });
  const pitchFall = 0.08 + random() * 0.10;
  const open = 0.52 + speaker.breath * 0.5, closing = 0.19;
  const breathCoefficient = 1 - Math.exp(-TAU * 1600 / ctx.sampleRate);
  const outputCoefficient = 1 - Math.exp(-TAU * 2900 / ctx.sampleRate);
  const formantSmoothing = 1 - Math.exp(-32 / (ctx.sampleRate * 0.022));
  const prosodySmoothing = 1 - Math.exp(-1 / (ctx.sampleRate * 0.025));
  const nasal = [250, 1180, 2250];
  let phase = random(), lastFlow = 0, breath = 0, low = 0, output = 0;
  let segmentIndex = 0, jitter = 1, shimmer = 1, pitch = speaker.pitch, stress = segments[0].stress;
  return makeBuffer(ctx, duration, (t, sample) => {
    while (segmentIndex + 1 < count && t >= segments[segmentIndex + 1].start) segmentIndex++;
    const segment = segments[segmentIndex], previous = segments[Math.max(0, segmentIndex - 1)];
    const local = t - segment.start;
    const articulation = smoothstep(local / segment.transition);
    const voiced = segment.consonant === 0 ? 0.35 + articulation * 0.65
      : segment.consonant === 1 ? 0.7 + articulation * 0.3 : articulation;
    if (sample % 32 === 0) {
      for (let i = 0; i < resonators.length; i++) {
        const r = resonators[i];
        const from = segment.consonant === 0 ? nasal[i] : previous.vowel[i];
        const target = (from + (segment.vowel[i] - from) * articulation) * speaker.formants;
        r.frequency += (target - r.frequency) * formantSmoothing;
        r.a = 2 * r.radius * Math.cos(TAU * r.frequency / ctx.sampleRate);
      }
    }
    const noise = random() * 2 - 1;
    breath += (noise - breath) * breathCoefficient;
    low += (noise - low) * 0.025;
    pitch += (speaker.pitch * segment.pitch * (1.06 - pitchFall * t / duration) - pitch) * prosodySmoothing;
    stress += (segment.stress - stress) * prosodySmoothing;
    const fundamental = pitch * jitter * (1 + 0.014 * Math.sin(t * 21) + 0.008 * Math.sin(t * 37));
    phase += fundamental / ctx.sampleRate;
    if (phase >= 1) {
      phase -= 1;
      jitter = 0.991 + random() * 0.018;
      shimmer = 0.94 + random() * 0.12;
    }
    // Asymmetric glottal flow, breath and small cycle variations avoid a steady oscillator-like vowel.
    const flow = phase < open ? 0.5 - 0.5 * Math.cos(Math.PI * phase / open)
      : phase < open + closing ? Math.cos(Math.PI * 0.5 * (phase - open) / closing) : 0;
    const pulse = (flow - lastFlow) * ctx.sampleRate / (speaker.pitch * 8);
    lastFlow = flow;
    const excitation = pulse * shimmer * voiced + breath * speaker.breath * voiced;
    let vowel = 0;
    for (const r of resonators) {
      const y = excitation + r.a * r.y1 - r.b * r.y2;
      r.y2 = r.y1;
      r.y1 = y;
      vowel += y * r.gain;
    }
    const fricative = segment.consonant === 2 ? (breath - low) * 0.10 * (1 - articulation)
      : segment.consonant === 3 ? (noise - breath) * 0.10 * Math.exp(-Math.max(0, local - 0.012) * 180)
      : segment.consonant === 4 ? breath * 0.055 * (1 - articulation) : 0;
    const envelope = smoothstep(t / 0.025) * smoothstep((duration - t) / 0.085);
    output += ((vowel * stress + fricative) * envelope - output) * outputCoefficient;
    return output;
  }, 0.5);
}

function horn(ctx, duration, seed) {
  const random = randomSource(seed);
  const frequencies = [365 + random() * 45, 465 + random() * 55];
  const phases = [random(), random()];
  const delay = 0.006 + random() * 0.009;
  const harmonics = [0.52, 1, 0.65, 0.37, 0.24, 0.14, 0.085];
  let flutter = 0, air = 0;
  return makeBuffer(ctx, duration, (t) => {
    const noise = random() * 2 - 1;
    flutter += (noise - flutter) * 0.008;
    air += (noise - air) * 0.24;
    let tone = 0;
    for (let reed = 0; reed < 2; reed++) {
      const local = Math.max(0, t - reed * delay);
      const attack = 1 - Math.exp(-local * (reed ? 160 : 230));
      const settling = 1 - 0.065 * Math.exp(-local * 65);
      phases[reed] += frequencies[reed] * (settling + flutter * 0.045 + Math.sin(local * 71 + reed) * 0.0025) / ctx.sampleRate;
      let buzz = 0;
      for (let i = 0; i < harmonics.length; i++) buzz += Math.sin(TAU * phases[reed] * (i + 1)) * harmonics[i];
      tone += buzz * attack * (reed ? 0.83 : 1);
    }
    const release = smoothstep((duration - t) / 0.045);
    const chatter = (noise - air) * Math.exp(-t * 55) * 0.6;
    return (tone * (0.95 + flutter * 0.6) + air * 0.17 + chatter) * release;
  }, 0.7);
}

function crashBody(ctx, seed) {
  const random = randomSource(seed);
  const coefficients = [45, 240 + random() * 70, 950].map((frequency) => 1 - Math.exp(-TAU * frequency / ctx.sampleRate));
  const bands = [0, 0, 0];
  const rebound = 0.018 + random() * 0.018;
  const decay = 0.026 + random() * 0.012;
  return makeBuffer(ctx, 0.28, (t) => {
    const noise = random() * 2 - 1;
    for (let i = 0; i < bands.length; i++) bands[i] += (noise - bands[i]) * coefficients[i];
    const contact = (1 - Math.exp(-t * 1600)) * Math.exp(-t / decay);
    const second = Math.max(0, t - rebound);
    const compression = (1 - Math.exp(-second * 700)) * Math.exp(-second / 0.034);
    // Broad, damped bumper/body pressure with a second contact; there is no pitched kick or falling oscillator.
    return (bands[1] - bands[0]) * (contact * 1.8 + compression * 0.65)
      + (bands[2] - bands[1]) * (contact * 0.6 + compression * 0.18);
  }, 0.7);
}

function crashMetal(ctx, seed) {
  const random = randomSource(seed);
  const creases = Array.from({ length: 7 }, () => ({
    time: 0.008 + random() ** 2 * 0.19,
    decay: 0.009 + random() * 0.020,
    level: 0.25 + random() * 0.65
  }));
  const modes = [430, 790, 1370, 2380].map((frequency, i) => {
    const radius = Math.exp(-1 / (ctx.sampleRate * (0.012 + random() * 0.016)));
    return { a: 2 * radius * Math.cos(TAU * frequency * (0.88 + random() * 0.24) / ctx.sampleRate),
      b: radius * radius, gain: (1 - radius) * [1, 0.85, 0.6, 0.3][i], y1: 0, y2: 0 };
  });
  const lowCoefficient = 1 - Math.exp(-TAU * 550 / ctx.sampleRate);
  const highCoefficient = 1 - Math.exp(-TAU * 4800 / ctx.sampleRate);
  let low = 0, high = 0;
  return makeBuffer(ctx, 0.43, (t) => {
    const noise = random() * 2 - 1;
    low += (noise - low) * lowCoefficient;
    high += (noise - high) * highCoefficient;
    let pressure = (1 - Math.exp(-t * 1800)) * Math.exp(-t / 0.018);
    for (const crease of creases) {
      const local = t - crease.time;
      if (local > 0) pressure += (1 - Math.exp(-local * 2200)) * Math.exp(-local / crease.decay) * crease.level;
    }
    const excitation = noise * pressure;
    let panel = 0;
    for (const mode of modes) {
      const y = excitation + mode.a * mode.y1 - mode.b * mode.y2;
      mode.y2 = mode.y1;
      mode.y1 = y;
      panel += y * mode.gain;
    }
    // Inharmonic sheet-metal resonances are driven by uneven buckles, underneath a short crushed/scraped texture.
    return panel * 1.7 + (high - low) * pressure * 0.22;
  }, 0.65);
}

function crashDebris(ctx, seed) {
  const random = randomSource(seed);
  const grains = Array.from({ length: 14 }, () => {
    const time = 0.015 + random() ** 1.7 * 0.51;
    return { time, frequency: 1400 + random() * 4300, decay: 0.003 + random() * 0.010,
      level: (0.25 + random() * 0.75) * (1 - time * 0.9) };
  });
  const coefficient = 1 - Math.exp(-TAU * 1100 / ctx.sampleRate);
  let low = 0;
  return makeBuffer(ctx, 0.67, (t) => {
    const noise = random() * 2 - 1;
    low += (noise - low) * coefficient;
    let fragments = 0;
    for (const grain of grains) {
      const local = t - grain.time;
      if (local <= 0 || local > grain.decay * 7) continue;
      const envelope = (1 - Math.exp(-local * 3500)) * Math.exp(-local / grain.decay) * grain.level;
      const ring = Math.sin(TAU * grain.frequency * local) + Math.sin(TAU * grain.frequency * 1.71 * local) * 0.3;
      fragments += ((noise - low) * 0.7 + ring * 0.16) * envelope;
    }
    return fragments;
  }, 0.55);
}

function gustBuffer(ctx) {
  // Low-rate, looping control signal: uneven overlapping gusts with a smooth seam, rather than a sine LFO.
  const sampleRate = 8000, duration = 24;
  const buffer = ctx.createBuffer(1, sampleRate * duration, sampleRate);
  const data = buffer.getChannelData(0), random = randomSource(349);
  const fast = Array.from({ length: 48 }, () => random()), slow = Array.from({ length: 12 }, () => random());
  const interpolate = (knots, position) => {
    const index = Math.floor(position), t = position - index;
    const a = knots[(index + knots.length - 1) % knots.length], b = knots[index % knots.length];
    const c = knots[(index + 1) % knots.length], d = knots[(index + 2) % knots.length];
    return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
  };
  for (let i = 0; i < data.length; i++) {
    const phase = i / data.length;
    data[i] = 0.38 + 0.54 * clamp(interpolate(fast, phase * fast.length) * 0.36 + interpolate(slow, phase * slow.length) * 0.64);
  }
  return buffer;
}

// Polish acoustic pedestrian signals (sygnalizacja akustyczna): a slow, dull locator tick on red so a blind
// pedestrian can find the pole, and a fast bright rattle on green ("terkot", ~10 clicks a second) for the time they may
// cross. `wait` and `walk` are the scheduling periods in seconds; a walk buffer holds `walkClicks` clicks, one period.
const SIGNAL_TIMING = { wait: 1.25, walk: 0.5, walkClicks: 5 };

function signal(ctx, walk) {
  const random = randomSource(84);
  const spacing = SIGNAL_TIMING.walk / SIGNAL_TIMING.walkClicks;
  return makeBuffer(ctx, walk ? SIGNAL_TIMING.walk : 0.07, (t) => {
    const local = walk ? t % spacing : t;
    if (local > (walk ? 0.03 : 0.05)) return 0;
    const attack = 1 - Math.exp(-local * 3000);
    // green: a short beep-like click near 2.1 kHz; red: a woody tick around 700 Hz with more noise
    const tone = walk ? Math.sin(TAU * 2100 * local) + Math.sin(TAU * 4200 * local) * 0.22
      : Math.sin(TAU * 700 * local) + Math.sin(TAU * 1630 * local) * 0.35;
    const noise = (random() * 2 - 1) * (walk ? 0.12 : 0.3);
    return (tone * 0.8 + noise) * attack * Math.exp(-local * (walk ? 160 : 110));
  }, walk ? 0.45 : 0.5);
}

function bell(ctx) {
  // One stroke of a tram's electric gong: a struck metal dish (inharmonic partials, the higher ones dying first) with a
  // short click of the clapper. playEvent rings it twice, the second a tone lower: the Poznań trams' ding-ding.
  const random = randomSource(91);
  const partials = [[1, 1, 1.1], [2.32, 0.55, 0.5], [4.25, 0.3, 0.24], [6.63, 0.16, 0.12], [9.38, 0.08, 0.07]];
  return makeBuffer(ctx, 1.3, (t) => {
    let tone = 0;
    for (const [ratio, amplitude, decay] of partials) tone += Math.sin(TAU * 1180 * ratio * t) * amplitude * Math.exp(-t / decay);
    const click = (random() * 2 - 1) * Math.exp(-t / 0.0015) * 0.5;
    return (tone + click) * (1 - Math.exp(-t / 0.0006));
  }, 0.6);
}

function churchBell(ctx) {
  // One stroke of a large swinging church bell, prime at 290 Hz (the Fara's; the Katedra's plays it lower): the minor-
  // third bell's partials (hum, prime, tierce, quint, nominal and the upper ones) as [ratio, amplitude, decay s], the
  // hum longest. Each partial beats slowly against a split twin (the "warble" of a real casting), and the clapper adds
  // a short metallic clank.
  const random = randomSource(1201);
  const rate = 22050;
  const partials = [
    [0.5, 0.55, 4.2], [1, 0.5, 2.6], [1.2, 0.7, 2.1], [1.5, 0.22, 1.2], [2, 0.65, 1.7],
    [2.5, 0.25, 0.9], [2.67, 0.2, 0.8], [3, 0.18, 0.6], [4, 0.1, 0.4], [5.33, 0.06, 0.25]
  ].map(([ratio, amplitude, decay]) => ({ frequency: 290 * ratio, amplitude, decay,
    split: 0.4 + random() * 1.2, phase: random() * TAU }));
  const clankCoefficient = 1 - Math.exp(-TAU * 2400 / rate);
  let low = 0;
  return makeBuffer(ctx, 6.5, (t) => {
    let tone = 0;
    for (const p of partials) {
      const beat = Math.cos(TAU * p.split * 0.5 * t);
      tone += Math.sin(TAU * p.frequency * t + p.phase) * p.amplitude * Math.exp(-t / p.decay) * (0.75 + 0.25 * beat);
    }
    const noise = random() * 2 - 1;
    low += (noise - low) * clankCoefficient;
    const clank = (noise - low) * Math.exp(-t / 0.012) * 0.6;
    return (tone + clank) * (1 - Math.exp(-t / 0.002));
  }, 0.6, rate);
}

function hejnal(ctx) {
  // A natural trumpet playing city-clock.js HEJNAL once: additive brass partials that brighten with loudness, a
  // tongued attack that scoops up into pitch, a little breath, and a slow vibrato on the held notes.
  const random = randomSource(1301);
  const rate = 22050;
  const notes = hejnalNotes().map((note) => ({ ...note, phase: 0 }));
  const last = notes[notes.length - 1];
  const attack = 0.035, release = HEJNAL.release;
  const breathCoefficient = 1 - Math.exp(-TAU * 1800 / rate);
  let breath = 0;
  return makeBuffer(ctx, hejnalLength() + 0.1, (t) => {
    const noise = random() * 2 - 1;
    breath += (noise - breath) * breathCoefficient;
    let out = 0;
    for (const note of notes) {
      const local = t - note.start;
      // notes are tongued apart: each ends a few hundredths before its written length, except the last
      const end = note.duration - (note === last ? 0 : 0.03);
      if (local < 0 || local > end + release) continue;
      const rise = Math.min(1, local / attack);
      const fall = local > end ? Math.max(0, 1 - (local - end) / release) : 1;
      const level = rise * rise * (3 - 2 * rise) * fall * (1 - 0.08 * Math.min(1, local / 1.5));
      const scoop = 1 - 0.025 * Math.exp(-local / 0.02);
      const vibrato = note.duration > 0.6
        ? 1 + 0.005 * Math.sin(TAU * 5.4 * local) * Math.min(1, Math.max(0, local - 0.3) / 0.3) : 1;
      note.phase += note.frequency * scoop * vibrato / rate;
      // Brass: louder is brighter. Each partial is `bright` times the one below (2nd and 3rd a little stronger),
      // capped under 9.5 kHz
      const bright = 0.42 + 0.3 * level;
      let tone = 0, amplitude = 1;
      for (let k = 1; k <= 12 && k * note.frequency < 9500; k++) {
        tone += Math.sin(TAU * k * note.phase) * amplitude * (k === 2 || k === 3 ? 1.25 : 1);
        amplitude *= bright;
      }
      const tongue = Math.exp(-local / 0.012);
      out += (tone * level + (noise - breath) * 0.25 * tongue) * 0.5 + breath * 0.04 * level;
    }
    return out;
  }, 0.6, rate);
}

function goatKnock(ctx, seed) {
  // The goats' wooden heads meeting: a hollow block knock (a few inharmonic wood modes, fast decays) with a dry click
  const random = randomSource(seed);
  const modes = [[540, 0.045, 1], [1310, 0.022, 0.6], [2480, 0.012, 0.35]].map(([frequency, decay, amplitude]) => ({
    frequency: frequency * (0.94 + random() * 0.12), decay, amplitude
  }));
  return makeBuffer(ctx, 0.22, (t) => {
    let knock = 0;
    for (const m of modes) knock += Math.sin(TAU * m.frequency * t) * m.amplitude * Math.exp(-t / m.decay);
    const click = (random() * 2 - 1) * Math.exp(-t / 0.0015) * 0.7;
    return (knock + click) * (1 - Math.exp(-t / 0.0005));
  }, 0.6);
}

export function createEventResources(ctx, resources) {
  const speakers = [
    { pitch: 99, formants: 0.88, breath: 0.06 }, { pitch: 119, formants: 0.94, breath: 0.10 },
    { pitch: 143, formants: 1.00, breath: 0.08 }, { pitch: 166, formants: 1.04, breath: 0.12 },
    { pitch: 191, formants: 1.10, breath: 0.09 }, { pitch: 216, formants: 1.14, breath: 0.13 }
  ];
  return {
    ...resources,
    footsteps: Array.from({ length: 8 }, (_, i) => footstep(ctx, i + 1)),
    syllables: speakers.map((speaker, voice) => Array.from({ length: 4 }, (_, i) => speechFragment(ctx, speaker, i + voice * 4 + 20))),
    horns: [0.22, 0.37, 0.55].map((duration, i) => horn(ctx, duration, 17 + i)),
    crashes: {
      body: Array.from({ length: 3 }, (_, i) => crashBody(ctx, i + 301)),
      metal: Array.from({ length: 3 }, (_, i) => crashMetal(ctx, i + 401)),
      debris: Array.from({ length: 3 }, (_, i) => crashDebris(ctx, i + 501))
    },
    gusts: gustBuffer(ctx),
    signalTick: signal(ctx, false),
    signalWalk: signal(ctx, true),
    bell: bell(ctx),
    churchBell: churchBell(ctx),
    hejnal: hejnal(ctx),
    goatKnocks: [goatKnock(ctx, 1401), goatKnock(ctx, 1402)]
  };
}

export function playEvent(ctx, resources, kind, output, options = {}) {
  const random = randomSource(options.seed);
  const start = Math.max(ctx.currentTime, finite(options.when, ctx.currentTime));
  const intensity = clamp(finite(options.intensity, 1));
  const levels = { footstep: 0.22, talk: 0.065, horn: 0.23, signal: 0.13, crash: 0.35, bell: 0.2, church: 0.34,
    hejnal: 0.24, goats: 0.3 };
  if (!Object.hasOwn(levels, kind) || intensity === 0) return { endTime: start, dispose() {} };
  const gain = ctx.createGain();
  gain.gain.value = intensity * levels[kind];
  gain.connect(output);
  const sources = new Map();
  let disposed = false;
  const release = (source) => {
    const envelope = sources.get(source);
    if (!envelope) return;
    source.onended = null;
    source.disconnect();
    envelope.disconnect();
    sources.delete(source);
    if (!sources.size) {
      disposed = true;
      gain.disconnect();
    }
  };
  const event = {
    endTime: start,
    dispose(immediate = false) {
      if (disposed) return;
      disposed = true;
      const now = ctx.currentTime;
      const fade = !immediate && ctx.state === 'running' ? 0.04 : 0;
      event.endTime = Math.min(event.endTime, now + fade);
      gain.gain.cancelScheduledValues(now);
      gain.gain.setTargetAtTime(0, now, 0.008);
      for (const source of sources.keys()) source.stop(now + fade);
      // Suspended contexts may not dispatch ended until resumed; reset also releases future syllables now.
      if (!fade) for (const source of sources.keys()) release(source);
    }
  };
  // `skip`: seconds of the buffer to leave out at its start (a peal or show joined part-way)
  const play = (buffer, when, rate = 1, volume = 1, skip = 0) => {
    const source = ctx.createBufferSource();
    const envelope = ctx.createGain();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    envelope.gain.value = volume;
    source.connect(envelope).connect(gain);
    sources.set(source, envelope);
    source.onended = () => release(source);
    const end = when + (buffer.duration - skip) / rate;
    event.endTime = Math.max(event.endTime, end);
    source.start(when, skip);
    source.stop(end);
    return end;
  };

  if (kind === 'footstep') {
    const speed = clamp(Math.abs(finite(options.speed)) / 8);
    play(resources.footsteps[Math.floor(random() * resources.footsteps.length)], start, 0.9 + random() * 0.17 + speed * 0.13);
  } else if (kind === 'talk') {
    const identity = randomSource(finite(options.voiceSeed, finite(options.seed, 1)));
    const voice = resources.syllables[Math.floor(identity() * resources.syllables.length)];
    const pitch = 0.95 + identity() * 0.1;
    const count = random() < 0.65 ? 2 : 1;
    let when = start;
    let variant = Math.floor(random() * voice.length);
    for (let i = 0; i < count; i++) {
      const buffer = voice[variant];
      const end = play(buffer, when, pitch * (0.985 + random() * 0.03), 0.78 + random() * 0.22);
      when = end + 0.065 + random() * 0.13;
      variant = (variant + 1 + Math.floor(random() * (voice.length - 1))) % voice.length;
    }
  } else if (kind === 'horn') {
    play(resources.horns[Math.floor(random() * resources.horns.length)], start, 0.94 + random() * 0.12);
  } else if (kind === 'bell') {
    const pitch = 0.97 + random() * 0.06;
    play(resources.bell, start, pitch);
    play(resources.bell, start + 0.24, pitch * 0.84, 0.9);
  } else if (kind === 'church' || kind === 'hejnal') {
    // `offset` (s) joins a running peal or show part-way: strokes or calls already over are left out, one under way
    // starts mid-buffer. church: `strokes` (1-12) at CHURCH_PEAL.interval, `pitch` the bell's playback rate; hejnal:
    // the calls at HEJNAL.plays, offset in show seconds.
    const church = kind === 'church';
    const buffer = church ? resources.churchBell : resources.hejnal;
    const rate = church ? clamp(finite(options.pitch, 1), 0.5, 2) : 1;
    const offset = Math.max(0, finite(options.offset));
    const count = church ? Math.round(clamp(finite(options.strokes, 1), 1, 12)) : HEJNAL.plays.length;
    for (let i = 0; i < count; i++) {
      const at = (church ? i * CHURCH_PEAL.interval : HEJNAL.plays[i]) - offset;
      const skip = Math.max(0, -at) * rate;
      if (skip >= buffer.duration - 0.05) continue;
      play(buffer, start + Math.max(0, at), rate, church ? 1 : i ? 0.75 : 1, skip);
    }
  } else if (kind === 'goats') {
    // the 12 butts of the Ratusz goats, at GOAT_BUTT_TIMES show seconds; `offset` is the show time now
    const offset = finite(options.offset);
    for (let i = 0; i < GOAT_BUTT_TIMES.length; i++) {
      const at = GOAT_BUTT_TIMES[i] - offset;
      if (at < 0) continue;
      play(resources.goatKnocks[i % 2], start + at, 0.95 + random() * 0.1, 0.8 + random() * 0.2);
    }
  } else if (kind === 'crash') {
    const severity = clamp(finite(options.severity, intensity));
    const variant = Math.floor(random() * resources.crashes.body.length);
    const rate = (1.16 - severity * 0.24) * (0.96 + random() * 0.08);
    play(resources.crashes.body[variant], start, rate, 0.7 + severity * 0.3);
    play(resources.crashes.metal[variant], start + 0.003, rate, 0.08 + severity * 0.72);
    if (severity > 0.45) {
      play(resources.crashes.debris[variant], start + 0.012, rate, (severity - 0.45) / 0.55 * 0.55);
    }
  } else {
    play(options.walk ? resources.signalWalk : resources.signalTick, start);
  }
  return event;
}

function smoothParameter(parameter, timeConstant, epsilon = 0.0001) {
  let target = NaN;
  return (value, now) => {
    if (Math.abs(value - target) < epsilon) return;
    parameter.cancelScheduledValues(now);
    parameter.setTargetAtTime(value, now, timeConstant);
    target = value;
  };
}

export function createWindVoice(ctx, resources, output) {
  const master = ctx.createGain();
  master.gain.setValueAtTime(0, ctx.currentTime);
  master.gain.setTargetAtTime(1, ctx.currentTime, 0.8);
  master.connect(output);
  const nodes = [master], sources = [], channels = [];
  let disposed = false, remaining = 4;
  const disconnect = () => {
    for (const node of nodes) node.disconnect();
  };
  for (let i = 0; i < 2; i++) {
    const noise = ctx.createBufferSource();
    noise.buffer = resources.noise;
    noise.loop = true;
    const highpass = ctx.createBiquadFilter();
    setControlRate(highpass.frequency, highpass.detune, highpass.Q, highpass.gain);
    highpass.type = 'highpass';
    highpass.frequency.value = 80;
    highpass.Q.value = 0.5;
    const lowpass = ctx.createBiquadFilter();
    setControlRate(lowpass.frequency, lowpass.detune, lowpass.Q, lowpass.gain);
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 1550;
    lowpass.Q.value = 0.4;
    const air = ctx.createGain();
    air.gain.value = 0.010;
    const rumbleFilter = ctx.createBiquadFilter();
    setControlRate(rumbleFilter.frequency, rumbleFilter.detune, rumbleFilter.Q, rumbleFilter.gain);
    rumbleFilter.type = 'lowpass';
    rumbleFilter.frequency.value = 480;
    rumbleFilter.Q.value = 0.5;
    const rumble = ctx.createGain();
    rumble.gain.value = 0.006;
    const pan = ctx.createStereoPanner();
    pan.pan.value = i ? 0.7 : -0.7;
    const gust = ctx.createBufferSource();
    gust.buffer = resources.gusts;
    gust.loop = true;
    gust.playbackRate.value = i ? 0.79 : 1;
    const modulation = ctx.createGain();
    modulation.gain.value = 0;
    noise.connect(highpass).connect(lowpass).connect(air).connect(modulation).connect(pan).connect(master);
    highpass.connect(rumbleFilter).connect(rumble).connect(modulation);
    gust.connect(modulation.gain);
    channels.push({
      air: smoothParameter(air.gain, 0.6),
      rumble: smoothParameter(rumble.gain, 1),
      cutoff: smoothParameter(lowpass.frequency, 0.8, 1)
    });
    sources.push(noise, gust);
    nodes.push(noise, highpass, lowpass, air, rumbleFilter, rumble, pan, gust, modulation);
    for (const source of [noise, gust]) source.onended = () => { if (--remaining === 0) disconnect(); };
    noise.start(ctx.currentTime, i * resources.noise.duration * 0.43);
    gust.start(ctx.currentTime, i * resources.gusts.duration * 0.37);
  }
  return {
    update({ speed = 0, altitude = 0, night = 0, traffic = 0, enclosure = 0 } = {}, now = ctx.currentTime) {
      if (disposed) return;
      now = Math.max(ctx.currentTime, finite(now, ctx.currentTime));
      const motion = clamp(Math.abs(finite(speed)) / 55);
      const exposure = Math.sqrt(clamp(altitude / 300));
      const quiet = 1 - clamp(Number(night)) * 0.3;
      const shelter = 1 - clamp(enclosure) * 0.65;
      for (const channel of channels) {
        // Walls shelter ambient wind; the rush from riding or flying still follows the player's motion.
        channel.air((0.010 * shelter + motion * 0.024 + exposure * 0.015) * quiet, now);
        channel.cutoff(1550 + motion * 1400 + exposure * 850, now);
        channel.rumble((0.003 + clamp(traffic) * 0.020) * quiet * (1 - exposure * 0.5), now);
      }
    },
    dispose(immediate = false) {
      if (disposed) return;
      disposed = true;
      const now = ctx.currentTime;
      const fade = !immediate && ctx.state === 'running' ? 0.08 : 0;
      master.gain.cancelScheduledValues(now);
      master.gain.setTargetAtTime(0, now, 0.015);
      for (const source of sources) source.stop(now + fade);
      if (!fade) disconnect();
    }
  };
}

export { SIGNAL_TIMING };
