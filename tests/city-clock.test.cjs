const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { loadModule } = require('./helpers/module.cjs');

// city-clock.js: the in-game clock, the church bells' hour strokes, the Ratusz noon show's timetable and the hejnał
// score, shared by landmarks-rynek.js (the goats' animation) and the audio (bells, hejnał, the goats' knocks). The
// audio buffers are rendered here too, with a fake context, and checked for what a listener would hear.
const source = (name) => readFileSync(join(__dirname, '../js', name), 'utf8');
const clock = loadModule(source('city-clock.js'), { filename: 'city-clock.js' });
const events = loadModule(source('audio-events.js'), {
  imports: { './audio-synthesis.js': { setControlRate() {} }, './city-clock.js': clock },
  filename: 'audio-events.js'
});

// Enough of a BaseAudioContext to bake buffers and to record how playEvent schedules them
function fakeContext(sampleRate = 22050) {
  const started = [];
  const param = () => ({ value: 0, cancelScheduledValues() {}, setTargetAtTime() {}, setValueAtTime() {} });
  const node = () => ({ gain: param(), connect(next) { return next; }, disconnect() {} });
  return {
    sampleRate,
    currentTime: 100,
    state: 'running',
    started,
    createBuffer(channels, length, rate) {
      const data = new Float32Array(length);
      return { sampleRate: rate, length, duration: length / rate, getChannelData: () => data };
    },
    createGain: node,
    createBufferSource() {
      const s = { ...node(), playbackRate: param(), buffer: null };
      s.start = (when, offset = 0) => started.push({ buffer: s.buffer, when, offset, rate: s.playbackRate.value });
      s.stop = () => {};
      return s;
    }
  };
}
const ctx = fakeContext();
const resources = events.createEventResources(ctx, {});
const samples = (buffer) => buffer.getChannelData(0);

test('the clock runs on in real time from the preset\'s time', () => {
  assert.equal(clock.clockMinutes('golden', 0), 17 * 60 + 45);
  assert.equal(clock.clockMinutes('midday', 90), 13 * 60 + 31.5);
  assert.equal(clock.clockMinutes('no-such-preset', 0), clock.PRESET_CLOCK.golden);
  for (const minutes of Object.values(clock.PRESET_CLOCK)) assert.ok(minutes >= 0 && minutes < 24 * 60);
});

test('bells strike the hour on the 12-hour dial, once, when the clock reaches it', () => {
  assert.deepEqual([0, 1, 11, 12, 13, 18, 23, 24].map(clock.hourStrokes), [12, 1, 11, 12, 1, 6, 11, 12]);
  // Golden hour (17:45): the first full hour is 18:00, a quarter of an hour on; a tick that straddles it finds it once
  assert.equal(clock.fullHourIn(clock.clockMinutes('golden', 0), clock.clockMinutes('golden', 899)), -1);
  assert.equal(clock.fullHourIn(clock.clockMinutes('golden', 899.9), clock.clockMinutes('golden', 900)), 18);
  assert.equal(clock.fullHourIn(clock.clockMinutes('golden', 900), clock.clockMinutes('golden', 900.1)), -1);
  // A preset on the hour (23:00) strikes 11 at once: the audio starts the clock just below the preset's time
  const midnight = clock.PRESET_CLOCK.midnight;
  assert.equal(clock.hourStrokes(clock.fullHourIn(midnight - 1e-6, clock.clockMinutes('midnight', 0.1))), 11);
  assert.equal(clock.pealLength(12), 11 * clock.CHURCH_PEAL.interval + clock.CHURCH_PEAL.tail);
});

test('the goats butt 12 times at the end of each lunge, while the show runs on the midday preset', () => {
  const phases = clock.goatShowPhases();
  const times = clock.GOAT_BUTT_TIMES;
  assert.equal(times.length, 12);
  assert.equal(times[0], phases.turn + clock.GOAT_SHOW.buttPeriod);
  assert.equal(times[11], phases.butts);
  for (let i = 1; i < 12; i++) assert.ok(Math.abs(times[i] - times[i - 1] - clock.GOAT_SHOW.buttPeriod) < 1e-9);
  assert.ok(phases.close < clock.SHOW_PERIOD);

  const state = { midday: false, start: 0 };
  assert.equal(clock.goatShowTime(state, 5, 'golden'), -1);
  assert.equal(clock.goatShowTime(state, 7, 'midday'), 0); // starts on the frame the preset turns midday
  assert.equal(clock.goatShowTime(state, 17, 'midday'), 10);
  assert.equal(clock.goatShowTime(state, 7 + clock.SHOW_PERIOD + 3, 'midday'), 3); // and repeats
  assert.equal(clock.goatShowTime(state, 200, 'twilight'), -1);
  assert.equal(clock.goatShowTime(state, 300, 'midday'), 0); // a fresh show on coming back
});

test('the hejnał is natural-trumpet notes and both calls end before the first butt', () => {
  const notes = clock.hejnalNotes();
  assert.ok(notes.length >= 10);
  for (const note of notes) {
    const partial = note.frequency / clock.HEJNAL.fundamental;
    assert.ok([3, 4, 5, 6, 8].some((p) => Math.abs(partial - p) < 1e-9), `partial ${partial}`);
    assert.ok(note.frequency > 300 && note.frequency < 1000);
  }
  const length = clock.hejnalLength();
  const plays = clock.HEJNAL.plays;
  for (let i = 1; i < plays.length; i++) assert.ok(plays[i] >= plays[i - 1] + length, 'calls do not overlap');
  assert.ok(plays[plays.length - 1] + length < clock.GOAT_BUTT_TIMES[0]);
});

test('the bells, trumpeter and goats stand on their landmarks', async () => {
  const { LANDMARK_SITES } = await import('../js/city-config.js');
  for (const bell of clock.CHURCH_BELLS) assert.ok(LANDMARK_SITES[bell.site], bell.site);
  const katedra = LANDMARK_SITES.Katedra;
  const towers = clock.sitePoint(katedra, clock.CHURCH_BELLS.find((b) => b.site === 'Katedra').along, 40);
  assert.ok(towers.x < katedra.x - 25, 'the Katedra\'s bells hang in its west towers');
  const ratusz = LANDMARK_SITES.Ratusz;
  const goats = clock.sitePoint(ratusz, clock.RATUSZ_SOUNDS.goats.along, clock.RATUSZ_SOUNDS.goats.y);
  assert.ok(goats.x > ratusz.x + 15, 'the goats come out on the east front');
  // Stary Rynek hears the Fara (≈ 260 m), not the Katedra (≈ 1 km)
  const fara = LANDMARK_SITES.Fara;
  assert.ok(Math.hypot(fara.x - ratusz.x, fara.z - ratusz.z) < 300);
  assert.ok(Math.hypot(towers.x - ratusz.x, towers.z - ratusz.z) > 520);
});

// Strongest period in a stretch of samples, by normalised autocorrelation over lags for low..high Hz, refined by
// parabolic interpolation (the bright brass partials make whole-sample lags of a high note score poorly, so the search
// stays within a fifth of the written note, which still pins the pitch to cents)
function pitch(data, from, to, rate, low, high) {
  const scores = [];
  for (let lag = Math.floor(rate / high); lag <= Math.ceil(rate / low); lag++) {
    let sum = 0, a = 0, b = 0;
    for (let i = from; i < to - lag; i++) { sum += data[i] * data[i + lag]; a += data[i] ** 2; b += data[i + lag] ** 2; }
    scores.push([lag, sum / Math.sqrt(a * b)]);
  }
  const best = Math.max(...scores.map(([, s]) => s));
  const index = scores.findIndex(([, s]) => s === best);
  const [lag] = scores[index];
  const [l, c, r] = [scores[index - 1]?.[1] ?? 0, scores[index][1], scores[index + 1]?.[1] ?? 0];
  const shift = (l - r) / (2 * (l - 2 * c + r) || 1);
  return rate / (lag + shift);
}

test('the baked hejnał plays the score in tune', () => {
  const buffer = resources.hejnal;
  const data = samples(buffer);
  assert.ok(data.every(Number.isFinite));
  assert.ok(Math.abs(buffer.duration - clock.hejnalLength() - 0.1) < 0.01);
  for (const note of clock.hejnalNotes()) {
    if (note.duration < 0.25) continue;
    const from = Math.round((note.start + 0.08) * buffer.sampleRate);
    const to = Math.round((note.start + note.duration - 0.05) * buffer.sampleRate);
    const heard = pitch(data, from, Math.min(to, from + 2048), buffer.sampleRate, note.frequency / 1.5, note.frequency * 1.5);
    const cents = 1200 * Math.log2(heard / note.frequency);
    assert.ok(Math.abs(cents) < 20, `${note.frequency.toFixed(1)} Hz played as ${heard.toFixed(1)} Hz`);
  }
});

test('the church bell rings on for seconds and the goats knock short and dry', () => {
  const bell = samples(resources.churchBell);
  const rate = resources.churchBell.sampleRate;
  const rms = (data, from, to) => Math.sqrt(data.slice(from, to).reduce((s, v) => s + v * v, 0) / (to - from));
  const early = rms(bell, 0, rate * 0.3);
  const late = rms(bell, rate * 3, rate * 3.3);
  assert.ok(bell.every(Number.isFinite));
  assert.ok(late > early * 0.08 && late < early * 0.6, `after 3 s at ${(late / early).toFixed(2)} of the strike`);
  for (const knock of resources.goatKnocks) {
    const data = samples(knock);
    assert.ok(knock.duration < 0.25);
    assert.ok(rms(data, data.length * 0.6, data.length) < rms(data, 0, data.length * 0.2) * 0.05);
  }
});

test('crossing signals tick slowly on red and rattle fast on green', () => {
  const onsets = (data) => {
    let count = 0, quiet = Infinity;
    for (let i = 0; i < data.length; i++) {
      if (Math.abs(data[i]) > 0.05) { if (quiet > ctx.sampleRate * 0.02) count++; quiet = 0; } else quiet++;
    }
    return count;
  };
  const walk = resources.signalWalk;
  const T = events.SIGNAL_TIMING;
  assert.ok(Math.abs(walk.duration - T.walk) < 0.001);
  assert.equal(onsets(samples(walk)), T.walkClicks);
  assert.ok(T.walkClicks / T.walk >= 8, 'green clicks at 8 Hz or more');
  assert.ok(T.wait >= 1 && resources.signalTick.duration < T.wait, 'red ticks about once a second or slower');
});

test('playEvent joins a peal part-way and schedules the goats on their butts', () => {
  ctx.started.length = 0;
  const output = { connect() {} };
  const interval = clock.CHURCH_PEAL.interval;
  // six strokes at the Katedra's pitch, joined 1.5 strokes in: the first two still ringing (joined mid-buffer), then
  // four whole ones; a 12-stroke peal joined 1 s after its last stroke keeps the strokes still ringing (6.5 s buffer)
  events.playEvent(ctx, resources, 'church', output, { strokes: 6, pitch: 0.8, offset: interval * 1.5 });
  assert.equal(ctx.started.length, 6);
  assert.deepEqual(ctx.started.slice(0, 2).map((s) => s.when), [100, 100]);
  assert.ok(Math.abs(ctx.started[0].offset - interval * 1.5 * 0.8) < 1e-9, 'buffer seconds at rate 0.8');
  assert.ok(Math.abs(ctx.started[1].offset - interval * 0.5 * 0.8) < 1e-9);
  assert.ok(Math.abs(ctx.started[2].when - (100 + interval * 0.5)) < 1e-9);
  assert.ok(ctx.started.every((s) => s.rate === 0.8 && s.buffer === resources.churchBell));
  ctx.started.length = 0;
  events.playEvent(ctx, resources, 'church', output, { strokes: 12, offset: interval * 11 + 1 });
  assert.deepEqual(ctx.started.map((s) => Math.round(s.offset * 10) / 10), [6.2, 3.6, 1]);

  ctx.started.length = 0;
  const event = events.playEvent(ctx, resources, 'goats', output, { offset: 12 });
  const butts = [...clock.GOAT_BUTT_TIMES].filter((t) => t >= 12);
  assert.deepEqual(ctx.started.map((s) => s.when), butts.map((t) => 100 + t - 12));
  assert.ok(event.endTime > 100 + clock.GOAT_BUTT_TIMES[11] - 12);

  ctx.started.length = 0;
  events.playEvent(ctx, resources, 'hejnal', output, { offset: 0 });
  assert.deepEqual(ctx.started.map((s) => s.when), [...clock.HEJNAL.plays].map((t) => 100 + t));
});
