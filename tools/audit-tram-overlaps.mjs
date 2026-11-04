// Headless car–tram body overlap audit. Uses the same worlds, seed and update order as bench-traffic.mjs.
// node tools/audit-tram-overlaps.mjs [--minutes 5] [--fps 15] [--seed 4242] [--only centrum,kaponiera]
import { buildWorld } from './bench-world.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args[i + 1];
};
const minutes = Number(opt('minutes', 5));
const fps = Number(opt('fps', 15));
const initialSeed = Number(opt('seed', 4242));
const only = opt('only', null);
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
    (only && only.split(',').some((key) => !districts.some((d) => d.key === key)))) {
  throw new Error('Invalid minutes, fps, seed or district');
}

// Separating-axis test for two oriented rectangles. Touching counts as overlap, matching the original audit.
function overlap(a, b) {
  for (const rect of [a, b]) {
    for (const angle of [rect.h, rect.h + Math.PI / 2]) {
      const x = Math.sin(angle), z = Math.cos(angle);
      const distance = Math.abs((a.x - b.x) * x + (a.z - b.z) * z);
      const radius = (r) => r.hl * Math.abs(Math.sin(r.h) * x + Math.cos(r.h) * z) +
        r.hw * Math.abs(Math.cos(r.h) * x - Math.sin(r.h) * z);
      if (distance > radius(a) + radius(b)) return false;
    }
  }
  return true;
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
        if (!t.sections.some((s) => overlap(car, { x: s.x, z: s.z, h: s.heading, hl: s.halfLength, hw: s.halfWidth }))) continue;
        frames++;
        const key = `${i}:${t.id}`;
        const conflicts = v.conn ? (v.edge.to.tramConflicts || []).filter((c) =>
          c.e === v.edge && c.i === v.lane && c.f === v.move.to && c.j === v.out) : [];
        if (!pairs.has(key)) pairs.set(key, {
          pair: key, time: +time.toFixed(1), x: Math.round(v.x), z: Math.round(v.z),
          carSpeed: +v.speed.toFixed(1), tramSpeed: +t.speed.toFixed(1),
          carWait: v.waitReason, tramWait: t.waitReason, connector: !!v.conn,
          conflict: conflicts.length > 0, heldByTram: conflicts.some((c) => c.held === frame && c.by === t)
        });
      }
    }
  }
  console.log(JSON.stringify({ district: district.key, seed: initialSeed, minutes, fps,
    overlapPairs: pairs.size, overlapFrames: frames, events: [...pairs.values()] }));
}
