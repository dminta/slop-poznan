// Headless car–tram body overlap audit. Uses the same worlds, seed and update order as bench-traffic.mjs.
// node tools/audit-tram-overlaps.mjs [--minutes 5] [--fps 15] [--seed 4242] [--only centrum,kaponiera] [--tolerance 0.05]
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
// Same penetration tolerance as the tram–tram audit; default 0 leaves the recorded car–tram counts unchanged.
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
  const vehicles = [...traffic.cars, ...traffic.buses];
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
    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      if (!v.edge) continue;
      const car = { x: v.x, z: v.z, h: v.yaw + v.yawOffset, hl: v.half, hw: v.halfWidth };
      for (const t of trams.trams) {
        if (!t.active || Math.abs(v.x - t.x) > t.length + 10 || Math.abs(v.z - t.z) > t.length + 10) continue;
        let deepest = -Infinity;
        for (const s of t.sections) {
          const depth = penetration(car, { x: s.x, z: s.z, h: s.heading, hl: s.halfLength, hw: s.halfWidth });
          if (depth > deepest) deepest = depth;
        }
        if (deepest < 0) continue;
        frames++;
        const key = `${i}:${t.id}`;
        const conflicts = v.conn ? (v.edge.to.tramConflicts || []).filter((c) =>
          c.e === v.edge && c.i === v.lane && c.f === v.move.to && c.j === v.out) : [];
        const event = pairs.get(key);
        if (!event) pairs.set(key, {
          pair: key, time: +time.toFixed(1), x: Math.round(v.x), z: Math.round(v.z),
          carSpeed: +v.speed.toFixed(1), tramSpeed: +t.speed.toFixed(1),
          carWait: v.waitReason, tramWait: t.waitReason, connector: !!v.conn,
          conflict: conflicts.length > 0, heldByTram: conflicts.some((c) => c.held === frame && c.by === t),
          maxPenetration: deepest
        });
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
