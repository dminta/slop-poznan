// Tram queue benchmark at the detail-box edge. Parks the headless focus near each track buffer stop and reports
// stopped trams (over 30/60 s), deadEndWait/bufferWait/stuck histograms, the queue behind every buffer, and the
// worst cluster of stopped trams. `--in-view` adds a camera at the focus that marks everything within 250 m seen:
// without it every tram counts as unseen (the browser case when the camera looks elsewhere). See
// docs/observations/tram-edge-jams-2026-11-04.md for the before/after runs and limits.
//   node tools/bench-tram-edges.mjs [--minutes 5] [--fps 15] [--seed 4242] [--tram-seed 1922] [--in-view]
//                                   [--only south,east] [--json out.json]
import { buildWorld } from './bench-world.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : Number(args[i + 1]);
};
const MINUTES = opt('minutes', 5);
const FPS = opt('fps', 15);
const SEED = opt('seed', 4242);
const TRAM_SEED = opt('tram-seed', 1922);
const IN_VIEW = args.includes('--in-view');
const JSON_OUT = (() => { const i = args.indexOf('--json'); return i < 0 ? null : args[i + 1]; })();
const ONLY = (() => { const i = args.indexOf('--only'); return i < 0 ? null : args[i + 1].split(','); })();
const DT = 1 / FPS;

// Dead ends found on the real track graph (positions of the buffer stop). Focus points sit 260 m inside
// the map from each, so the buffer is within the 900 m tram radius and some spawn track leads to it.
const LOCATIONS = [
  { key: 'west-sw', name: 'SW buffer (-3604,3023)', x: -3604, z: 3023, fx: -3350, fz: 2800 },
  { key: 'south-sw', name: 'S buffer (-1889,3597)', x: -1889, z: 3597, fx: -1750, fz: 3330 },
  { key: 'south', name: 'S buffer (214,2995)', x: 214, z: 2995, fx: 214, fz: 2750 },
  { key: 'south-se', name: 'S buffer (625,3124)', x: 625, z: 3124, fx: 625, fz: 2880 },
  { key: 'south-se2', name: 'SE buffer (1504,3539)', x: 1504, z: 3539, fx: 1400, fz: 3280 },
  { key: 'east-se', name: 'SE buffer (4458,2886)', x: 4458, z: 2886, fx: 4200, fz: 2650 },
  { key: 'east', name: 'E buffer (4641,-132)', x: 4641, z: -132, fx: 4480, fz: -132 },
  { key: 'north-e', name: 'NE buffer (891,-3124)', x: 891, z: -3124, fx: 891, fz: -2860 },
  { key: 'north', name: 'N buffer (-945,-3050)', x: -945, z: -3050, fx: -945, fz: -2790 },
  { key: 'north-2', name: 'N buffer (-118,-2963)', x: -118, z: -2963, fx: -118, fz: -2700 },
  { key: 'north-w', name: 'NW buffer (-1551,-3650)', x: -1551, z: -3650, fx: -1450, fz: -3390 },
  { key: 'jezyce', name: 'Jeżyce (central baseline)', x: null, z: null, fx: -2056, fz: -391 },
  { key: 'centrum', name: 'Centrum (central baseline)', x: null, z: null, fx: -900, fz: 178 },
  { key: 'rataje', name: 'Rataje (central baseline)', x: null, z: null, fx: 1900, fz: 600 }
];
const locations = ONLY ? LOCATIONS.filter((l) => ONLY.includes(l.key)) : LOCATIONS;

const round = (x, d = 0) => Math.round(x * 10 ** d) / 10 ** d;
const where = (x, z) => `(${round(x)}, ${round(z)})`;

function runLocation(loc) {
  let seed = SEED;
  Math.random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const { trams } = buildWorld({ tramSeed: TRAM_SEED });
  const focus = { x: loc.fx, z: loc.fz };
  const player = { type: 'person', position: { x: -1e5, y: 0, z: -1e5 }, heading: 0, speed: 0 };
  // A camera sharing the focus marks everything within 250 m seen; the inert frustum test accepts all sides.
  const camera = IN_VIEW ? {
    position: { x: loc.fx, y: 30, z: loc.fz },
    matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
    projectionMatrix: {}, matrixWorldInverse: {},
    updateMatrixWorld() {}
  } : null;

  const trams_ = new Map();
  const record = (t) => {
    let r = trams_.get(t.id);
    if (!r) trams_.set(t.id, (r = { id: t.id, maxStuck: 0, maxDeadEnd: 0, maxBuffer: 0, stopped30: 0, stopped60: 0, reason: '', at: '', line: '' }));
    return r;
  };
  let samples = 0;
  const hist = { deadEnd: {}, buffer: {}, stuck: {} };
  const bucket = (v) => (v < 1 ? '0' : v < 8 ? '1-8' : v < 16 ? '8-16' : v < 30 ? '16-30' : v < 60 ? '30-60' : v < 120 ? '60-120' : '120+');
  const endQueues = new Map(); // buffer key -> { max, at, time, members }
  const clusters = new Map(); // rounded area -> max stopped count
  const worst = [];
  let spawns = 0;
  let spawnDeadEnd = 0;
  let spawnDeadEndNear = 0;
  let spawnBufferClear = 0;
  let retires = 0;
  let retiresAtBuffer = 0;
  let movingRetires = 0;
  let previous = new Map();
  let activeSum = 0;
  let near400Sum = 0;
  let near250Sum = 0;
  let minNear400 = Infinity;
  const seconds = MINUTES * 60;
  let time = 0;
  for (let frame = 0; time < seconds; frame++) {
    time += DT;
    trams.update(DT, time, focus, camera, player, 'person');
    // spawn / retire events, and whether a new tram was aimed at a buffer
    const current = new Map();
    for (const t of trams.trams) current.set(t.id, t);
    for (const [id, t] of current) {
      if (!previous.has(id)) {
        spawns++;
        if (t.path.end < Infinity) {
          spawnDeadEnd++;
          if (t.path.end - t.path.u < 400) spawnDeadEndNear++;
          if (t.path.end - t.path.u < 900) spawnBufferClear++;
        }
      }
    }
    for (const [id, t] of previous) {
      if (current.has(id)) continue;
      retires++;
      if (t.bufferWait > 2 && t.speed > 3) movingRetires++;
      for (const l of LOCATIONS) {
        if (l.x !== null && Math.hypot(t.x - l.x, t.z - l.z) < 150) { retiresAtBuffer++; break; }
      }
    }
    previous = current;
    // continuous stop crossing thresholds
    for (const t of trams.trams) {
      const r = record(t);
      if (!t.atStop && t.speed < 0.1) {
        if (t.stuck >= 30) r.stopped30 = 1;
        if (t.stuck >= 60) r.stopped60 = 1;
        if (t.stuck > r.maxStuck) { r.maxStuck = t.stuck; r.reason = t.waitReason; r.at = where(t.x, t.z); r.line = t.line; }
      }
      if (t.deadEndWait > r.maxDeadEnd) r.maxDeadEnd = t.deadEndWait;
      if (t.bufferWait > r.maxBuffer) r.maxBuffer = t.bufferWait;
    }
    if (frame % FPS) continue;
    samples++;
    let near400 = 0;
    let near250 = 0;
    for (const t of trams.trams) {
      const d = Math.hypot(t.x - loc.fx, t.z - loc.fz);
      if (d < 400) near400++;
      if (d < 250) near250++;
    }
    activeSum += trams.trams.length;
    near400Sum += near400;
    near250Sum += near250;
    if (time > 30) minNear400 = Math.min(minNear400, near400);
    const stopped = trams.trams.filter((t) => !t.atStop && t.speed < 0.1);
    for (const t of stopped) {
      const r = hist.deadEnd[bucket(t.deadEndWait)] || (hist.deadEnd[bucket(t.deadEndWait)] = 0);
      hist.deadEnd[bucket(t.deadEndWait)] = r + 1;
      hist.buffer[bucket(t.bufferWait)] = (hist.buffer[bucket(t.bufferWait)] || 0) + 1;
      hist.stuck[bucket(t.stuck)] = (hist.stuck[bucket(t.stuck)] || 0) + 1;
    }
    // Queue at each buffer: trams whose path ends on the same edge, within 300 m of the end
    const perEnd = new Map();
    for (const t of trams.trams) {
      if (!(t.path.end < Infinity)) continue;
      const last = t.path.edges[t.path.n - 1];
      const d = t.path.end - t.path.u;
      if (d > 300) continue;
      const key = `${last.id}/${round(last.pts[last.pts.length - 2])},${round(last.pts[last.pts.length - 1])}`;
      let q = perEnd.get(key);
      if (!q) perEnd.set(key, (q = { n: 0, stopped: 0, nearest: Infinity, members: [] }));
      q.n++;
      if (t.speed < 0.5) q.stopped++;
      q.nearest = Math.min(q.nearest, d);
      q.members.push(`${t.line || t.id}${t.speed < 0.5 ? 'S' : ''}@${round(d)}m`);
    }
    for (const [key, q] of perEnd) {
      const known = endQueues.get(key);
      if (!known) endQueues.set(key, { max: q.n, stopped: q.stopped, maxStopped: q.stopped, final: q.n, finalStopped: q.stopped,
        at: key.split('/')[1], time: round(time), members: q.members.join(' '), seconds: 1 });
      else {
        known.final = q.n;
        known.finalStopped = q.stopped;
        if (q.n >= 2) known.seconds++;
        if (q.stopped > known.maxStopped) known.maxStopped = q.stopped;
        if (q.n > known.max) { known.max = q.n; known.stopped = q.stopped; known.time = round(time); known.members = q.members.join(' '); }
      }
    }
    for (const [key, q] of endQueues) if (!perEnd.has(key)) { q.final = 0; q.finalStopped = 0; }
    // Clusters of stopped trams within ~250 m
    const used = new Set();
    for (const t of stopped) {
      if (used.has(t)) continue;
      const group = stopped.filter((o) => !used.has(o) && Math.hypot(o.x - t.x, o.z - t.z) < 250);
      for (const o of group) used.add(o);
      const key = `${Math.round(t.x / 100) * 100},${Math.round(t.z / 100) * 100}`;
      const known = clusters.get(key);
      if (!known || group.length > known.n) {
        clusters.set(key, { n: group.length, at: where(group.reduce((s, o) => s + o.x, 0) / group.length, group.reduce((s, o) => s + o.z, 0) / group.length), time: round(time), maxStuck: Math.max(...group.map((o) => o.stuck)), reasons: group.map((o) => `${o.line || o.id}:${o.waitReason}`).join(' ') });
      }
      if (group.length >= 3) worst.push({ n: group.length, at: where(t.x, t.z), time: round(time), members: group.map((o) => `${o.line || o.id}:${o.waitReason} ${where(o.x, o.z)} stuck ${round(o.stuck)} v ${round(o.speed, 1)}`).join(' | ') });
    }
  }
  const records = [...trams_.values()];
  const clustersTop = [...clusters.values()].sort((a, b) => b.n - a.n || b.maxStuck - a.maxStuck).slice(0, 4);
  const queuesTop = [...endQueues.entries()].map(([k, v]) => ({ end: k.split('/')[1], ...v })).sort((a, b) => b.max - a.max).slice(0, 5);
  const worstTop = worst.sort((a, b) => b.n - a.n).slice(0, 2);
  return {
    key: loc.key, name: loc.name, focus: where(loc.fx, loc.fz), samples, spawns, spawnDeadEnd, spawnDeadEndNear, spawnBufferClear, retires, retiresAtBuffer, movingRetires,
    active: round(activeSum / samples, 2), near400: round(near400Sum / samples, 2), near250: round(near250Sum / samples, 2),
    minNear400: minNear400 === Infinity ? 0 : minNear400,
    stopped30: records.filter((r) => r.stopped30).length, stopped60: records.filter((r) => r.stopped60).length,
    maxStuck: round(Math.max(0, ...records.map((r) => r.maxStuck))), maxDeadEnd: round(Math.max(0, ...records.map((r) => r.maxDeadEnd))),
    maxBuffer: round(Math.max(0, ...records.map((r) => r.maxBuffer))),
    hist, queues: queuesTop, clusters: clustersTop, worst: worstTop,
    activeEnd: trams.trams.length,
    longest: records.filter((r) => r.maxStuck > 20).sort((a, b) => b.maxStuck - a.maxStuck).slice(0, 6).map((r) => `${r.line || r.id} ${round(r.maxStuck)}s ${r.reason} ${r.at}`)
  };
}

const out = [];
for (const loc of locations) {
  const t0 = Date.now();
  const r = runLocation(loc);
  out.push(r);
  console.log(`\n== ${r.name} focus ${r.focus} (${round((Date.now() - t0) / 1000)} s)`);
  console.log(`  stopped trams >30 s: ${r.stopped30}  >60 s: ${r.stopped60}  max continuous stuck ${r.maxStuck} s  max deadEndWait ${r.maxDeadEnd} s  active at end ${r.activeEnd}`);
  console.log(`  population avg active ${r.active}  within 400 m ${r.near400} (min ${r.minNear400})  within 250 m ${r.near250}`);
  console.log(`  spawns ${r.spawns} (${r.spawnDeadEnd} already buffer-bound, ${r.spawnDeadEndNear} within 400 m, ${r.spawnBufferClear} within 900 m)  retires ${r.retires} (${r.retiresAtBuffer} within 150 m of a buffer, ${r.movingRetires} moving)`);
  console.log(`  max bufferWait ${r.maxBuffer} s`);
  console.log(`  deadEndWait histogram (samples): ${JSON.stringify(r.hist.deadEnd)}  bufferWait: ${JSON.stringify(r.hist.buffer)}`);
  console.log(`  stuck histogram (samples): ${JSON.stringify(r.hist.stuck)}`);
  console.log(`  worst buffer queues: ${r.queues.map((q) => `end ${q.end} max=${q.max} maxStopped=${q.maxStopped} final=${q.final}/${q.finalStopped} queue-s=${q.seconds} at t=${q.time} [${q.members}]`).join(' | ') || '-'}`);
  console.log(`  worst stopped clusters: ${r.clusters.map((c) => `${c.n} trams at ${c.at} t=${c.time} stuck ${round(c.maxStuck)} (${c.reasons})`).join(' | ') || '-'}`);
  console.log(`  longest stops: ${r.longest.join(', ') || '-'}`);
  if (r.worst.length) console.log(`  worst cluster detail: ${r.worst[0].members}`);
}
console.log(`\n| Location | Focus | active | <400 m | <250 m | stopped >30 s | stopped >60 s | max stuck s | max deadEndWait s | queue max/slow at end | final | queue share | worst cluster |`);
console.log(`|---|---|---|---|---|---|---|---|---|---|---|---|---|`);
for (const r of out) {
  const q = r.queues[0];
  const c = r.clusters[0];
  const share = q ? `${Math.round((100 * q.seconds) / r.samples)}%` : '-';
  console.log(`| ${r.name} | ${r.focus} | ${r.active} | ${r.near400} | ${r.near250} | ${r.stopped30} | ${r.stopped60} | ${r.maxStuck} | ${r.maxDeadEnd} | ${q ? `${q.max}/${q.maxStopped} at ${q.end}` : '-'} | ${q ? `${q.final}/${q.finalStopped}` : '-'} | ${share} | ${c ? `${c.n} at ${c.at}` : '-'} |`);
}
if (JSON_OUT) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(JSON_OUT, JSON.stringify({ minutes: MINUTES, fps: FPS, seed: SEED, tramSeed: TRAM_SEED, inView: IN_VIEW, locations: out }, null, 2));
}