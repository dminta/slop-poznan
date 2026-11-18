// Headless tram braking episodes, using the traffic benchmark's world and update order.
// node tools/audit-tram-braking.mjs [--minutes 5] [--fps 20] [--seed 4242] [--only wilda] [--trace] [--trace-out file]
import { buildWorld } from './bench-world.mjs';
import { instrumentTrams } from './tram-braking-trace.mjs';
import { closeSync, openSync, writeSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args[i + 1];
};
const minutes = Number(opt('minutes', 5));
const fps = Number(opt('fps', 20));
const initialSeed = Number(opt('seed', 4242));
const only = opt('only', null);
const traceFrames = args.includes('--trace');
const trace = traceFrames || args.includes('--trace-summary');
const traceFile = opt('trace-out', `/tmp/tram-braking-trace-${initialSeed}.jsonl`);
const traceFd = traceFrames ? openSync(traceFile, 'w') : null;
let traceBuffer = '';
function writeTrace(row) {
  traceBuffer += JSON.stringify(row) + '\n';
  if (traceBuffer.length >= 1048576) { writeSync(traceFd, traceBuffer); traceBuffer = ''; }
}
const districts = [
  { key: 'jezyce', x: -2056, z: -391 }, { key: 'lazarz', x: -1900, z: 1500 },
  { key: 'centrum', x: -900, z: 178 }, { key: 'kaponiera', x: -1464, z: 88 },
  { key: 'stare', x: 0, z: 0 }, { key: 'rataje', x: 1108, z: 1439 },
  { key: 'wilda', x: -300, z: 1800 }
];
if (!Number.isFinite(minutes) || minutes <= 0 || !Number.isFinite(fps) || fps <= 0 ||
    !Number.isInteger(initialSeed) || initialSeed <= 0 || initialSeed >= 2147483647 ||
    (only && only.split(',').some((key) => !districts.some((d) => d.key === key)))) {
  throw new Error('Invalid minutes, fps, seed or district');
}
const thresholds = [-3, -5, -8.5];
for (const district of districts) {
  if (only && !only.split(',').includes(district.key)) continue;
  let seed = initialSeed;
  Math.random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const { traffic, trams } = buildWorld({ tramSource: trace ? instrumentTrams : null });
  const player = { type: 'person', position: { x: -1e5, y: 0, z: -1e5 }, heading: 0, speed: 0 };
  const active = new Map();
  const gateState = new Map();
  const probeState = new Map();
  const overruns = [];
  const events = thresholds.map(() => []);
  let tramSeconds = 0;
  let tramMetres = 0;
  const dt = 1 / fps;
  let time = 0;
  while (time < minutes * 60) {
    time += dt;
    trams.update(dt, time, district, null, player, 'person');
    traffic.update(dt, time, district, player, 'person', null);
    if (time < 20) continue;
    for (const t of trams.trams) {
      if (!t.active) { active.delete(t); gateState.delete(t); probeState.delete(t); continue; }
      let diagnosis = null;
      if (trace && t._audit) {
        const a = t._audit;
        const previous = gateState.get(t) || new Map();
        const next = new Map();
        const oldProbes = probeState.get(t) || new Map();
        const probes = new Map(a.probes.map((p) => [p.key, p]));
        probeState.set(t, probes);
        const changes = [];
        for (const gate of a.gates) {
          if (!gate.key) continue;
          const key = gate.key + (gate.complex ? ':complex' : '');
          const old = previous.get(key);
          let change = old && old.change;
          if (!old || gate.d < old.d - Math.max(1, a.v * dt + 0.5)) {
            const prior = oldProbes.get(gate.key);
            const atBoundary = gate.nodeDistance >= 59 || (gate.kind === 'road' && gate.entry >= 7.9) ||
              (gate.kind === 'keepClear' && prior && prior.d + 0.5 > 60);
            const changedRoom = prior && !old && prior.gap >= prior.threshold;
            let className = gate.complex ? 'complex' : gate.kind === 'signal' && prior && prior.phase !== gate.phase ? 'signal' :
              atBoundary ? 'lookahead' : changedRoom || (prior && !old && gate.reason === 'switch') ? 'changed occupancy' : 'unresolved';
            const rawChange = gate.complex && next.get(gate.key)?.change;
            if (rawChange && rawChange.time === +time.toFixed(2)) className += ` + ${rawChange.class}`;
            change = { class: className, time: +time.toFixed(2), v: a.v, d: gate.d,
              requiredDecel: gate.d > 0 ? a.v * a.v / (2 * gate.d) : null, x: a.x, z: a.z, tram: t.id, gate, prior: prior || null };
            changes.push(change);
          }
          next.set(key, { d: gate.d, change });
          if (!['body', 'pedestrian', 'player', 'tramLeader'].includes(gate.kind) && gate.d >= 0 && gate.d + 0.01 < t.speed * dt) overruns.push({ time: +time.toFixed(2), tram: t.id, gate });
        }
        gateState.set(t, next);
        const binding = a.binding;
        const key = binding && binding.key && binding.key + (binding.complex ? ':complex' : '');
        diagnosis = key && next.get(key) ? next.get(key).change : null;
        if (traceFrames) writeTrace({ district: district.key, time: +time.toFixed(2), tram: t.id, v: a.v, binding, changes });
      }
      tramSeconds += dt;
      tramMetres += t.speed * dt;
      let ongoing = active.get(t);
      if (!ongoing) { ongoing = thresholds.map(() => null); active.set(t, ongoing); }
      thresholds.forEach((limit, i) => {
        const below = t.speed > 0.5 && (i === 2 ? t.acc <= limit : t.acc < limit);
        if (!below) { ongoing[i] = null; return; }
        if (!ongoing[i]) {
          ongoing[i] = { time: +time.toFixed(2), x: Math.round(t.x), z: Math.round(t.z),
            reason: t.waitReason, minAcc: t.acc, speed: +t.speed.toFixed(2), ...(trace ? { tram: t.id, diagnosis, binding: t._audit.binding } : {}) };
          events[i].push(ongoing[i]);
        } else if (t.acc < ongoing[i].minAcc) {
          Object.assign(ongoing[i], { x: Math.round(t.x), z: Math.round(t.z), reason: t.waitReason,
            minAcc: t.acc, speed: +t.speed.toFixed(2), ...(trace ? { diagnosis, binding: t._audit.binding } : {}) });
        }
      });
    }
  }
  const hours = tramSeconds / 3600;
  const counts = (list, key) => {
    const result = {};
    for (const event of list) {
      const name = key(event);
      result[name] = (result[name] || 0) + 1;
    }
    return result;
  };
  console.log(JSON.stringify({ district: district.key, seed: initialSeed, minutes, fps, tramHours: +hours.toFixed(3), tramSeconds, tramMetres, tramKmh: 3.6 * tramMetres / tramSeconds,
    ...(trace ? { overruns } : {}),
    thresholds: thresholds.map((limit, i) => ({ limit, count: events[i].length,
      perTramHour: +(events[i].length / hours).toFixed(2),
      byReason: counts(events[i], (event) => event.reason || 'none'),
      byLocation: counts(events[i], (event) => `${event.x},${event.z}`), events: events[i] })) }));
}

if (traceFrames) { if (traceBuffer) writeSync(traceFd, traceBuffer); closeSync(traceFd); }
