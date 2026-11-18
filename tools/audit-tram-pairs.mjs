// Headless tram–tram section overlap audit. Uses the traffic benchmark world and update order.
// node tools/audit-tram-pairs.mjs [--minutes 5] [--fps 15] [--seed 4242] [--only centrum,kaponiera] [--tolerance 0.05]
import { buildWorld } from './bench-world.mjs';
import { exceedsTolerance, penetration } from './rect-penetration.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args[i + 1];
};
const minutes = Number(opt('minutes', 5));
const fps = Number(opt('fps', 15));
const initialSeed = Number(opt('seed', 4242));
const only = opt('only', null);
// A pair is only tolerant-overlapping when its deepest penetration over the run exceeds this margin. Default 0 keeps
// the recorded raw counts; 5 cm discards parallel-track tangencies that a 20 fps sample catches by phase alone.
const tolerance = Number(opt('tolerance', 0));
const districts = [
  { key: 'jezyce', x: -2056, z: -391 },
  { key: 'lazarz', x: -1900, z: 1500 },
  { key: 'centrum', x: -900, z: 178 },
  { key: 'kaponiera', x: -1464, z: 88 },
  { key: 'stare', x: 0, z: 0 },
  { key: 'rataje', x: 1108, z: 1439 },
  { key: 'wilda', x: -300, z: 1800 }
];
if (!Number.isFinite(minutes) || minutes <= 0 || !Number.isFinite(fps) || fps <= 0 ||
    !Number.isInteger(initialSeed) || initialSeed <= 0 || initialSeed >= 2147483647 ||
    !Number.isFinite(tolerance) || tolerance < 0 ||
    (only && only.split(',').some((key) => !districts.some((d) => d.key === key)))) {
  throw new Error('Invalid minutes, fps, seed, tolerance or district');
}

for (const district of districts) {
  if (only && !only.split(',').includes(district.key)) continue;
  let seed = initialSeed;
  Math.random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const { traffic, trams } = buildWorld({});
  const player = { type: 'person', position: { x: -1e5, y: 0, z: -1e5 }, heading: 0, speed: 0 };
  const pairs = new Map();
  let frames = 0;
  const dt = 1 / fps;
  let time = 0;
  let frame = 0;
  while (time < minutes * 60) {
    time += dt;
    trams.update(dt, time, district, null, player, 'person');
    traffic.update(dt, time, district, player, 'person', null);
    frame++;
    if (time < 20) continue;
    for (let i = 0; i < trams.trams.length; i++) {
      const a = trams.trams[i];
      if (!a.active) continue;
      for (let j = i + 1; j < trams.trams.length; j++) {
        const b = trams.trams[j];
        if (!b.active || Math.abs(a.x - b.x) > a.length + b.length || Math.abs(a.z - b.z) > a.length + b.length) continue;
        let deepest = -Infinity;
        for (const s of a.sections) {
          const rectA = { x: s.x, z: s.z, h: s.heading, hl: s.halfLength, hw: s.halfWidth };
          for (const t of b.sections) {
            const depth = penetration(rectA, { x: t.x, z: t.z, h: t.heading, hl: t.halfLength, hw: t.halfWidth });
            if (depth > deepest) deepest = depth;
          }
        }
        if (deepest < 0) continue;
        frames++;
        const key = `${a.id}:${b.id}`;
        const event = pairs.get(key);
        if (!event) pairs.set(key, { pair: key, time: +time.toFixed(1),
          x: Math.round((a.x + b.x) / 2), z: Math.round((a.z + b.z) / 2),
          speedA: +a.speed.toFixed(1), speedB: +b.speed.toFixed(1), waitA: a.waitReason, waitB: b.waitReason,
          maxPenetration: deepest });
        else if (deepest > event.maxPenetration) event.maxPenetration = deepest;
      }
    }
  }
  const events = [...pairs.values()];
  console.log(JSON.stringify({ district: district.key, seed: initialSeed, minutes, fps, tolerance,
    overlapPairs: pairs.size,
    overlapPairsTolerant: events.filter((e) => exceedsTolerance(e.maxPenetration, tolerance)).length,
    overlapFrames: frames,
    events: events.map((e) => ({ ...e, tolerant: exceedsTolerance(e.maxPenetration, tolerance),
      maxPenetration: +e.maxPenetration.toFixed(4) })) }));
}
