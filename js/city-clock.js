// js/city-clock.js
// The in-game clock and the timetables of the city's clock-driven events, as plain data and pure functions shared by
// the scene (landmarks-rynek.js animates the Ratusz goats) and the audio (audio-system.js rings the church bells and
// plays the noon hejnał and the goats' knocks), so what you see and what you hear run off one schedule.

// The clock: each lighting preset shows a time of day (lighting.js TIME_PRESETS, named "… · HH:MM"); from the moment a
// preset is chosen the clock runs on in real time from there. Minutes after midnight; keep in step with the preset names.
const PRESET_CLOCK = {
  golden: 17 * 60 + 45,
  midday: 13 * 60 + 30,
  twilight: 19 * 60 + 15,
  midnight: 23 * 60
};

// Minutes after midnight (not wrapped; it may run past 24 h) `seconds` after `presetId` was chosen
function clockMinutes(presetId, seconds) {
  return (PRESET_CLOCK[presetId] ?? PRESET_CLOCK.golden) + seconds / 60;
}

// The full hour (an hour count, not wrapped) the clock reached in (from, to] minutes, or -1. A preset that starts on
// the hour (23:00) strikes at once when the caller starts `from` just below the preset's time.
function fullHourIn(from, to) {
  const hour = Math.floor(to / 60);
  return hour * 60 > from && hour * 60 <= to ? hour : -1;
}

// Church clocks strike the hour on the 12-hour dial: 1..12
function hourStrokes(hour) {
  const h = ((hour % 12) + 12) % 12;
  return h === 0 ? 12 : h;
}

// The hour bells of the Fara and the Katedra. `along` places the belfry along the site's long axis (fraction of its
// length w, from the centre; the Katedra's twin west towers stand at the west end), `y` is the belfry height in metres,
// `pitch` the playback rate of the shared bell stroke (the Katedra's bell is the bigger one) and `delay` the seconds
// after the hour (two church clocks are never in step).
const CHURCH_BELLS = [
  { site: 'Fara', along: 0, y: 30, pitch: 1, delay: 0.6 },
  { site: 'Katedra', along: -0.42, y: 40, pitch: 0.8, delay: 3.2 }
];
// Seconds between strokes, and how long the last stroke rings on
const CHURCH_PEAL = { interval: 2.6, tail: 6 };

function pealLength(strokes) {
  return (strokes - 1) * CHURCH_PEAL.interval + CHURCH_PEAL.tail;
}

// A point `along` × w from a landmark site's centre on its u axis (world (cos ang, -sin ang), as landmark-kit.js
// fitToSite turns models), at height y
function sitePoint(site, along, y) {
  const ang = site.ang || 0;
  return { x: site.x + along * site.w * Math.cos(ang), y, z: site.z - along * site.w * Math.sin(ang) };
}

// -------------------------------------------------------------------------------------------------------------------
// The Ratusz noon show. Koziołki: two goats come out above the Ratusz clock at noon and butt heads 12 times, while a
// trumpeter plays the hejnał from the tower. A show starts when the lighting preset becomes 'midday' and repeats every
// SHOW_PERIOD while it stays there (real clocks run it once a day; two minutes keeps it findable without being
// constant). Timeline in seconds from the start of a show:
// -------------------------------------------------------------------------------------------------------------------
const SHOW_PERIOD = 120;
const GOAT_SHOW = {
  doorsOpen: 1.5, // doors swing open 0 → 90°
  slideOut: 4.0, // goats roll out onto the ledge
  turnIn: 5.0, // and turn to face each other
  butts: 12,
  buttPeriod: 1.25, // rear back (70 %), lunge (30 %)
  turnOut: 1.0,
  slideIn: 2.5,
  doorsClose: 1.5
};

// The end time of each stage, in show seconds
function goatShowPhases() {
  const S = GOAT_SHOW;
  const open = S.doorsOpen;
  const out = open + S.slideOut;
  const turn = out + S.turnIn;
  const butts = turn + S.butts * S.buttPeriod;
  const turnBack = butts + S.turnOut;
  const slideIn = turnBack + S.slideIn;
  return { open, out, turn, butts, turnBack, slideIn, close: slideIn + S.doorsClose };
}

// The heads meet at the end of each butt period (the lunge ends at w = GOAT_W_HIT): the 12 knocks, in show seconds
const GOAT_BUTT_TIMES = Object.freeze(Array.from({ length: GOAT_SHOW.butts },
  (_, i) => goatShowPhases().turn + (i + 1) * GOAT_SHOW.buttPeriod));

// Seconds into the current show, or -1 outside the midday preset. `state` ({ midday, start }) is the caller's own, so
// the scene and the audio each track the preset change on the same frame's `elapsed` and agree on the start; call it
// every frame.
function goatShowTime(state, elapsed, presetId) {
  const midday = presetId === 'midday';
  if (midday && !state.midday) state.start = elapsed;
  state.midday = midday;
  return midday ? (elapsed - state.start) % SHOW_PERIOD : -1;
}

// Where the noon show sounds, as sitePoint arguments on the Ratusz site: the trumpeter on the tower's gallery (≈ 37 m,
// the tower stands at the middle of the building) and the goats on their ledge above the east front's clock (≈ 22 m)
const RATUSZ_SOUNDS = {
  trumpeter: { along: 0, y: 38 },
  goats: { along: 0.515, y: 22.5 }
};

// The hejnał: the authentic bugle call of Poznań (Hejnał miasta Poznania, official Annex to the City Statute) on
// the natural notes of a B♭ trumpet (partials 4, 5, 6, 8 of 116.54 Hz: B♭4 D5 F5 B♭5, sounding the C-E-G-C triad),
// played twice from the Ratusz tower while the goats come out, finishing before the first butt. Notes are [partial,
// beats], partial 0 a rest.
const HEJNAL = {
  fundamental: 116.54,
  beat: 0.2,
  score: [
    [4, 1], [5, 1], [6, 2.5], [5, 1], [4, 2.5], [0, 1],
    [4, 1], [5, 1], [6, 1], [8, 3], [6, 1], [0, 1],
    [5, 1], [4, 1], [5, 1], [6, 3.5]
  ],
  plays: [0.4, 5.5], // show seconds at which the trumpeter starts the call (the second time a little softer)
  release: 0.25 // how long the last note dies away after its written length
};

// The score as [{ frequency, start, duration }] in seconds from the start of one call, without rests
function hejnalNotes() {
  const notes = [];
  let time = 0;
  for (const [partial, beats] of HEJNAL.score) {
    const duration = beats * HEJNAL.beat;
    if (partial > 0) notes.push({ frequency: HEJNAL.fundamental * partial, start: time, duration });
    time += duration;
  }
  return notes;
}

// Length of one call in seconds, release included
function hejnalLength() {
  const last = hejnalNotes().at(-1);
  return last.start + last.duration + HEJNAL.release;
}

export {
  PRESET_CLOCK,
  clockMinutes,
  fullHourIn,
  hourStrokes,
  CHURCH_BELLS,
  CHURCH_PEAL,
  pealLength,
  sitePoint,
  SHOW_PERIOD,
  GOAT_SHOW,
  goatShowPhases,
  GOAT_BUTT_TIMES,
  goatShowTime,
  RATUSZ_SOUNDS,
  HEJNAL,
  hejnalNotes,
  hejnalLength
};
