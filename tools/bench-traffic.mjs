// Headless traffic benchmark: the real Poznań road network, street traffic, pedestrians and trams (traffic.js,
// trams.js) run with no rendering, the camera parked in turn at a few districts. It reports how the traffic flows and
// where and why it doesn't: speeds, stops, queues, waits, throughput and stuck time per junction, the reasons cars wait
// (v.waitReason), cycles of vehicles waiting on each other (deadlocks), cars stuck inside a junction box and trams held
// a long time. Usage and the output are in docs/testing.md.
//   node tools/bench-traffic.mjs [--minutes 5] [--fps 15] [--seed 4242] [--only jezyce,lazarz] [--top 8] [--dump]
//                                [--json out.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { loadModule } = require('../tests/helpers/module.cjs');

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args[i + 1];
};
const MINUTES = Number(opt('minutes', 5));
const FPS = Number(opt('fps', 15));
const SEED = Number(opt('seed', 4242));
const TOP = Number(opt('top', 8));
const DUMP = args.includes('--dump');
const NO_PEDS = args.includes('--no-peds'); // experiments: run without pedestrians, or without trams
const NO_TRAMS = args.includes('--no-trams');
const NO_SIGNALS = args.includes('--no-signals');
const JSON_OUT = opt('json', null);
const WATCH = opt('watch', null); // x,z: print the junction nearest there every 30 s
const WARMUP = 20; // s before sampling starts: the first frame scatters cars anywhere, mid-lane
const RADIUS = 300; // m around the camera that is sampled (cars are kept within 380 m)

// Camera positions (world metres, x east, z south of the Stary Rynek origin)
const DISTRICTS = [
  { key: 'jezyce', name: 'Jeżyce (Rynek Jeżycki)', x: -2056, z: -391 },
  { key: 'lazarz', name: 'Łazarz (Głogowska)', x: -1900, z: 1500 },
  { key: 'centrum', name: 'Centrum (Św. Marcin)', x: -900, z: 178 },
  { key: 'kaponiera', name: 'Rondo Kaponiera', x: -1464, z: 88 },
  { key: 'stare', name: 'Stare Miasto', x: 0, z: 0 },
  { key: 'rataje', name: 'Rataje (Rondo Rataje)', x: 1108, z: 1439 },
  { key: 'wilda', name: 'Wilda', x: -300, z: 1800 }
];
const only = opt('only', null);
const districts = only ? DISTRICTS.filter((d) => only.split(',').includes(d.key)) : DISTRICTS;

// A stand-in for every three.js / TSL object: any property, call or `new` gives another one
function inert() {
  const store = {};
  return new Proxy(function () {}, {
    get(_t, key) {
      if (key === Symbol.iterator) return function* () {};
      if (key === Symbol.toPrimitive) return () => 0;
      if (key === 'then') return undefined;
      if (key === 'length') return 0;
      return key in store ? store[key] : (store[key] = inert());
    },
    set(_t, key, value) {
      store[key] = value;
      return true;
    },
    apply: () => inert(),
    construct: () => inert()
  });
}

const quiet = { info() {}, log() {}, warn() {} };
const G = {
  Math, Object, Array, Set, Map, WeakMap, Number, Infinity, NaN, JSON, Symbol, Float32Array, Uint8Array, Uint16Array,
  Uint32Array, Int32Array, Int8Array, Int16Array, Float64Array, Uint8ClampedArray, Promise, String, Error, Boolean, Date,
  RegExp, TypeError, isFinite, parseFloat, parseInt, Reflect, Proxy, console: quiet
};
const js = (file) => readFileSync(join(ROOT, 'js', file), 'utf8');
const config = await import(pathToFileURL(join(ROOT, 'js/city-config.js')).href);
const { GEO } = await import(pathToFileURL(join(ROOT, 'js/geodata.js')).href);

// The furnished network as main.js builds it, less the buildings (none stands in a lane) and the curb rectangles
function buildWorld() {
  const rn = loadModule(js('road-network.js'), {
    imports: { './city-config.js': config, './geodata.js': { GEO } }, globals: G, filename: 'road-network.js'
  });
  const three = { 'three/webgpu': inert(), 'three/tsl': inert(), 'three/addons/utils/BufferGeometryUtils.js': inert() };
  const grid = loadModule(js('city-grid.js'), {
    imports: { ...three, './city-config.js': config, './geodata.js': { GEO }, './tsl-materials.js': inert() },
    globals: G, filename: 'city-grid.js'
  });
  const { buildStreetDetails } = loadModule(js('street-details.js'), {
    imports: {
      ...three, './city-config.js': config, './road-network.js': rn, './tsl-materials.js': inert(),
      './trees.js': { createTreeField: () => ({ group: inert() }) },
      './city-grid.js': { pavedPlazaRects: [], parkTreeSites: [], parkLampSites: [], clearOfRails: grid.clearOfRails }
    },
    globals: { ...G, document: inert() }, filename: 'street-details.js'
  });
  const { footprints } = buildStreetDetails(inert());
  const routes = loadModule(js('pedestrian-routes.js'), { imports: { './road-network.js': rn }, globals: G });
  const actors = loadModule(js('actor-models.js'), {
    imports: { ...three, './tsl-materials.js': inert() }, globals: { ...G, document: inert() }, filename: 'actor-models.js'
  });
  class PersonRig {
    constructor() {
      this.placed = false;
      this.feet = [];
    }
    update() {}
  }
  let trafficSource = js('traffic.js');
  if (NO_PEDS) {
    // an experiment: no pedestrians at all (none is ever placed)
    const budget = 'let pedBudget = jump ? NUM_PEDS : 6;';
    if (!trafficSource.includes(budget)) throw new Error(`--no-peds: traffic.js no longer has "${budget}"`);
    trafficSource = trafficSource.replace(budget, 'let pedBudget = 0;');
  }
  if (NO_SIGNALS) {
    // an experiment: every signal green for every road (crossing traffic still keeps out of an occupied box)
    for (const phase of ['avePhase = signalPhase(elapsed, true);', 'stPhase = signalPhase(elapsed, false);']) {
      if (!trafficSource.includes(phase)) throw new Error(`--no-signals: traffic.js no longer has "${phase}"`);
      trafficSource = trafficSource.replace(phase, `${phase.split(' =')[0]} = 'green';`);
    }
  }
  const { createTrafficSystem } = loadModule(trafficSource, {
    imports: {
      ...three, './road-network.js': rn, './pedestrian-routes.js': routes, './city-config.js': config,
      './tsl-materials.js': inert(), './vehicle-lights.js': inert(),
      // only the pure helpers (sizes, plates); the builders and materials are stand-ins
      './actor-models.js': new Proxy(actors, { get: (t, k) => (k in t && !/^(build|create)/.test(k) ? t[k] : inert()) }),
      './pedestrians.js': { PersonCrowd: function () { return inert(); }, PersonRig }, './city-grid.js': grid
    },
    globals: { ...G, performance: { now: () => 0 }, document: inert() }, filename: 'traffic.js'
  });
  const traffic = createTrafficSystem(inert(), [], footprints);
  const { layoutTramInfrastructure } = loadModule(js('tram-infra.js'), {
    imports: { ...three, './geodata.js': { GEO }, './city-config.js': config, './tsl-materials.js': inert() },
    globals: G, filename: 'tram-infra.js'
  });
  const { stops } = layoutTramInfrastructure(traffic.network);
  const { createTramSystem } = loadModule(js('trams.js'), {
    imports: {
      'three/webgpu': inert(), './geodata.js': { GEO }, './city-config.js': config,
      './tsl-materials.js': { cityUniforms: { uInteriorGlow: { value: 0.3 } } }, './actor-models.js': inert(),
      './vehicle-lights.js': {
        HEADLIGHTS: { busIntensity: 900 }, tramLightSpec: (len) => ({ headlight: [0.82, 0.9], zFront: len / 2 }),
        createVehicleHeadlight: () => inert(), placeVehicleHeadlight() {}
      }
    },
    globals: G, filename: 'trams.js'
  });
  const trams = createTramSystem(inert(), { network: traffic.network, stops, traffic });
  if (!NO_TRAMS) traffic.setTrams(trams);
  return { traffic, trams, network: traffic.network };
}

// ---------------------------------------------------------------------------------------------------------------------
const kmh = (ms) => ms * 3.6;
const pct = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0);
const round = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;
const where = (o) => `(${Math.round(o.x)}, ${Math.round(o.z)})`;

// Trams (trams.js) in the wait-for graph: their wait is `stuck` (s stopped away from a stop)
const isTram = (o) => !!o.path;
const waitOf = (o) => (isTram(o) ? o.stuck : o.wait);
const label = (o) => (isTram(o) ? `tram ${o.line || o.id}` : `#${o.benchId}`);
// The junction a car waits at or is crossing
const junctionOf = (v) => v.edge.to;
// Who o (a car or a tram) waits for, one vehicle or tram, from its waitReason and the state around it: the edges of the
// wait-for graph
function blocker(o, box) {
  if (isTram(o)) {
    if (o.waitReason === 'car') return o.obstacle && o.obstacle.edge ? o.obstacle : null;
    if (o.waitReason === 'tram') return o.leader;
    return null;
  }
  const v = o;
  const e = v.edge;
  const n = e.to;
  switch (v.waitReason) {
    case 'car': return !v.leader ? null : v.leader.tram ? v.leader.tram : v.leader.edge ? v.leader : null;
    case 'tram': {
      for (const c of n.tramConflicts || []) if (c.e === e && c.i === v.lane && c.by && c.by.active !== false) return c.by;
      return null;
    }
    case 'turner': {
      for (const q of e.occ[v.lane]) if (q.s > v.s && q.v !== v && !q.v.tram) return q.v;
      return null;
    }
    case 'box': {
      let best = null;
      for (const u of box.get(n) || []) if (u.edge.axisIndex !== e.axisIndex && (!best || u.wait > best.wait)) best = u;
      return best;
    }
    case 'room': {
      const f = v.move.to;
      const list = f.occ[v.move.out[v.lane]] || [];
      let last = null;
      for (const q of list) if (q.v !== v && q.s - q.v.half < f.len && (!last || q.s < last.s)) last = q;
      return !last ? null : last.v.tram ? last.v.tram : last.v;
    }
    case 'oncoming': case 'crossing': {
      // the longest-waiting vehicle at the head of a lane v gives way to
      let best = null;
      const ins = v.waitReason === 'oncoming' ? (e.opposite ? [e.opposite] : []) : n.in;
      for (const a of ins) {
        if (a === e) continue;
        for (const list of a.occ) {
          for (let k = list.length - 1; k >= 0; k--) {
            const u = list[k].v;
            if (u.tram || u === v) continue;
            if (!best || u.wait > best.wait) best = u;
            break;
          }
        }
      }
      return best;
    }
    default: return null;
  }
}
// Follow the wait-for graph from v: the chain, and where it ends (null, or the start of a cycle)
function chase(v, box) {
  const chain = [];
  const index = new Map();
  let u = v;
  while (u && !index.has(u)) {
    index.set(u, chain.length);
    chain.push(u);
    u = blocker(u, box);
    if (u && u.speed >= (isTram(u) ? 0.1 : 0.5)) {
      chain.moving = true; // the queue ahead is moving: v only waits its turn
      u = null;
    }
  }
  return { chain, cycle: u ? chain.slice(index.get(u)) : null };
}

function runDistrict(d) {
  let seed = SEED;
  Math.random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const world = buildWorld();
  const { traffic, trams } = world;
  const vehicles = [...traffic.cars, ...traffic.buses];
  vehicles.forEach((v, i) => (v.benchId = i));
  const focus = { x: d.x, z: d.z };
  const player = { type: 'person', position: { x: -1e5, y: 0, z: -1e5 }, heading: 0, speed: 0 };
  const dt = 1 / FPS;
  const seconds = MINUTES * 60;
  const r = {
    samples: 0, longestHeld: 0, speed: 0, moving: 0, movingSpeed: 0, stopped: 0, queue: 0, queueAt: null,
    waits: [], held60: new Set(), held120: new Set(), reasons: {}, rootReasons: {},
    junctions: new Map(), deadlocks: new Map(), boxStuck: new Map(), tramHeld: new Map(), worstSnapshot: null
  };
  const J = (n) => {
    let j = r.junctions.get(n);
    if (!j) r.junctions.set(n, (j = { n, stuck: 0, through: 0, reasons: {}, maxWait: 0 }));
    return j;
  };
  const lastConn = new Map();
  const box = new Map();
  let time = 0;
  for (let frame = 0; time < seconds; frame++) {
    time += dt;
    if (!NO_TRAMS) trams.update(dt, time, focus, null, player, 'person');
    traffic.update(dt, time, focus, player, 'person', null);
    const sampling = time >= WARMUP;
    // throughput: vehicles entering a junction curve, every frame
    for (const v of vehicles) {
      if (!v.edge) continue;
      const near = Math.hypot(v.x - d.x, v.z - d.z) < RADIUS;
      if (v.conn && lastConn.get(v) !== v.conn && sampling && near) J(v.edge.to).through++;
      // a finished wait (it moves again): one sample of the wait distribution
      if (sampling && near && v.speed >= 0.5 && v.benchWait > 1) r.waits.push(v.benchWait);
      v.benchWait = v.wait;
      lastConn.set(v, v.conn);
    }
    if (!sampling || frame % FPS) continue;
    // once a second
    box.clear();
    for (const v of vehicles) {
      if (!v.edge || !(v.conn || v.commit === v.edge.to)) continue;
      const n = v.edge.to;
      if (!box.has(n)) box.set(n, []);
      box.get(n).push(v);
    }
    const near = vehicles.filter((v) => v.edge && Math.hypot(v.x - d.x, v.z - d.z) < RADIUS);
    for (const v of near) {
      r.samples++;
      r.speed += v.speed;
      if (v.speed >= 0.5) {
        r.moving++;
        r.movingSpeed += v.speed;
        continue;
      }
      r.stopped++;
      const why = v.waitReason || 'none';
      r.reasons[why] = (r.reasons[why] || 0) + 1;
      r.longestHeld = Math.max(r.longestHeld, v.wait);
      if (v.wait > 60) r.held60.add(v.benchId);
      if (v.wait > 120) r.held120.add(v.benchId);
      // follow the wait-for graph to its end: the root cause of this car's stop (a cycle: a deadlock)
      const { chain, cycle } = chase(v, box);
      const end = chain[chain.length - 1];
      const u = isTram(end) ? chain.findLast((c) => !isTram(c)) : end;
      const root = cycle ? 'deadlock' : chain.moving ? 'queue moving' : isTram(end) ? `tram: ${end.waitReason || 'none'}` : end.waitReason || 'none';
      r.rootReasons[root] = (r.rootReasons[root] || 0) + 1;
      const j = J(junctionOf(u));
      j.stuck++;
      j.reasons[root] = (j.reasons[root] || 0) + 1;
      j.maxWait = Math.max(j.maxWait, v.wait);
      if (v.conn && v.wait > 20) {
        const k = v.edge.to;
        r.boxStuck.set(k, Math.max(r.boxStuck.get(k) || 0, v.wait));
      }
    }
    // the longest stopped queue in a lane, counted back from its stop line
    for (const v of near) {
      const e = v.edge;
      for (const list of e.occ) {
        let q = 0;
        for (let i = list.length - 1; i >= 0; i--) {
          const o = list[i];
          if (o.v.tram || o.s > e.len + 0.01) continue;
          if (o.v.speed < 0.5) q++;
          else break;
        }
        if (q > r.queue) {
          r.queue = q;
          r.queueAt = e.to;
        }
      }
    }
    // deadlocks: cycles in the wait-for graph of vehicles (and trams) all stopped over 30 s
    for (const v of near) {
      if (v.wait < 30) continue;
      const { cycle } = chase(v, box);
      if (!cycle || cycle.some((c) => waitOf(c) < 30)) continue;
      const key = cycle.map(label).sort().join(',');
      const known = r.deadlocks.get(key);
      const wait = Math.min(...cycle.map(waitOf));
      if (!known || known.wait < wait) {
        r.deadlocks.set(key, {
          wait, at: time, size: cycle.length,
          members: cycle.map((c) => (isTram(c) ? `${label(c)} ${c.waitReason} ${where(c)}`
            : `${label(c)} ${c.waitReason}${c.conn ? ' in box' : ''} at ${where(c.edge.to)} ${where(c)} ${c.move.turn}`))
        });
      }
    }
    // trams stopped over 60 s, outside their stops
    for (const t of NO_TRAMS ? [] : trams.trams) {
      if (t.atStop || !(t.stuck > 60) || Math.hypot(t.x - d.x, t.z - d.z) > 900) continue;
      const key = `${t.id}`;
      const known = r.tramHeld.get(key);
      if (!known || known.stuck < t.stuck) {
        // who holds it: the pedestrian nearest its front, if that is what it waits for
        let ped = '';
        if (t.waitReason === 'pedestrian') {
          let best = null;
          for (const q of traffic.peds) if (q.placed && (!best || Math.hypot(q.x - t.frontX, q.z - t.frontZ) < Math.hypot(best.x - t.frontX, best.z - t.frontZ))) best = q;
          if (best) ped = ` (pedestrian ${round(Math.hypot(best.x - t.frontX, best.z - t.frontZ))} m off the front, v ${round(best.v)}, ${best.node ? `on a crosswalk at t ${round(best.t)}/${round(best.len)}` : 'on a sidewalk'}${best.waiting ? ', waiting' : ''}${best.conversation ? ', talking' : ''}${best.pause > 0 ? ', pausing' : ''})`;
        }
        r.tramHeld.set(key, { stuck: t.stuck, reason: t.waitReason + ped, at: where(t), line: t.line });
      }
    }
    if (WATCH && frame % (FPS * 30) === 0) {
      const [wx, wz] = WATCH.split(',').map(Number);
      let best = null;
      for (const n of world.network.nodes) if (!best || Math.hypot(n.x - wx, n.z - wz) < Math.hypot(best.x - wx, best.z - wz)) best = n;
      console.log(snapshot({ edge: { to: best } }, vehicles, time, NO_TRAMS ? [] : trams.trams));
    }
    // the worst junction right now, as text
    if (DUMP) {
      let worst = null;
      for (const v of near) if (v.speed < 0.5 && (!worst || v.wait > worst.wait)) worst = v;
      if (worst && (!r.worstSnapshot || worst.wait > r.worstSnapshot.wait)) r.worstSnapshot = { wait: worst.wait, text: snapshot(worst, vehicles, time, NO_TRAMS ? [] : trams.trams) };
    }
  }
  return r;
}

// Every vehicle within 45 m of v's junction: what it does and why
function snapshot(v, vehicles, time, tramList) {
  const n = v.edge.to;
  const lines = [`t ${round(time, 0)} s, junction ${where(n)} ${n.signal ? 'signal' : 'no signal'}, ${n.sideCount} arms, ${n.groupCount} groups:`];
  for (const u of vehicles) {
    if (!u.edge || Math.hypot(u.x - n.x, u.z - n.z) > 45) continue;
    const e = u.edge;
    lines.push(`  #${u.benchId}${u.bus ? ' bus' : ''} ${where(u)} edge ${where(e.from)}->${where(e.to)} g${e.axisIndex} lane ${u.lane}/${e.lanes.length} ` +
      `${u.conn ? `in box ${round(u.cs)}/${round(u.conn.len)}` : `s ${round(u.s)}/${round(e.len)}`} ${u.move.turn}->${where(u.move.to.to)} ` +
      `v ${round(u.speed)} wait ${round(u.wait, 0)}${u.pedWait > 0 ? ` (for walkers ${round(u.pedWait, 0)})` : ''} ${u.waitReason}${u.leader && u.leader.benchId !== undefined ? ` behind #${u.leader.benchId}` : u.leader ? ' behind tram' : ''}` +
      `${u.edge.from === n && u.s < u.half - e.setbackFrom ? ` (tail on crosswalk ${e.outSide})` : ''}`);
  }
  lines.push(`  box ${n.box.join('/')}  crossing ${n.crossing.join('/')}  arms ${n.arms.map((a) => `${a.side}:g${a.group}`).join(' ')}`);
  for (const t of tramList) {
    if (Math.hypot(t.x - n.x, t.z - n.z) > 120) continue;
    lines.push(`  tram ${t.line || t.id} mid ${where(t)} front ${where({ x: t.frontX, z: t.frontZ })} v ${round(t.speed)} ${t.waitReason} ` +
      `stuck ${round(t.stuck, 0)}${t.atStop ? ` at stop ${t.stopName}` : ''}${t.obstacle && t.obstacle.benchId !== undefined ? ` for #${t.obstacle.benchId}` : ''}${t.leader ? ` leader tram ${t.leader.line || t.leader.id} at ${where(t.leader)} ${t.leader.waitReason} v ${round(t.leader.speed)}` : ''}`);
  }
  for (const p of n.walkers) lines.push(`  walker side ${p.side} ${p.waiting ? 'waiting' : 'crossing'} at ${where(p)} v ${round(p.v)} t ${round(p.t)}/${round(p.len)} dir ${p.dir}${p.conversation ? ' talking' : ''}${p.pause > 0 ? ' pause' : ''}`);
  return lines.join('\n');
}

const fmtShares = (obj, total) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 6)
  .map(([k, c]) => `${k} ${round((100 * c) / total, 0)}%`).join(', ');

const report = [];
const all = { samples: 0, speed: 0, moving: 0, movingSpeed: 0, stopped: 0, queue: 0, waits: [], held120: 0, deadlocks: 0 };
for (const d of districts) {
  const t0 = Date.now();
  const r = runDistrict(d);
  const waits = r.waits.slice().sort((a, b) => a - b);
  const row = {
    district: d.name, cars: round(r.samples / (MINUTES * 60 - WARMUP), 0),
    meanKmh: round(kmh(r.speed / r.samples)), movingKmh: round(kmh(r.movingSpeed / Math.max(1, r.moving))),
    stoppedPct: round((100 * r.stopped) / r.samples), longestQueue: r.queue,
    waitP50: round(pct(waits, 0.5), 0), waitP90: round(pct(waits, 0.9), 0), waitMax: round(waits[waits.length - 1] || 0, 0),
    held60: r.held60.size, held120: r.held120.size, longestHeld: round(r.longestHeld, 0), deadlocks: r.deadlocks.size, boxStuck: r.boxStuck.size,
    tramsHeld60: r.tramHeld.size
  };
  report.push(row);
  console.log(`\n== ${d.name} ${where(d)}  (${round((Date.now() - t0) / 1000, 0)} s)`);
  console.log(`  cars ${row.cars}  mean ${row.meanKmh} km/h (moving ${row.movingKmh})  stopped ${row.stoppedPct}%  longest queue ${row.longestQueue}` +
    `${r.queueAt ? ` at ${where(r.queueAt)}` : ''}`);
  console.log(`  waits p50 ${row.waitP50} s  p90 ${row.waitP90} s  max ${row.waitMax} s  held >60 s ${row.held60}  >120 s ${row.held120}`);
  console.log(`  stopped because: ${fmtShares(r.reasons, r.stopped)}`);
  console.log(`  queue heads (root cause): ${fmtShares(r.rootReasons, r.stopped)}`);
  const top = [...r.junctions.values()].sort((a, b) => b.stuck - a.stuck).slice(0, TOP);
  console.log('  junctions by stopped car-seconds:');
  for (const j of top) {
    console.log(`    ${where(j.n).padEnd(14)} ${j.n.signal ? 'signal' : 'give-way'} ${j.n.sideCount} arms  stopped ${j.stuck} car-s  ` +
      `through ${j.through}  max wait ${round(j.maxWait, 0)} s  ${fmtShares(j.reasons, j.stuck)}`);
  }
  if (r.deadlocks.size) {
    console.log(`  deadlocks (wait-for cycles, every member stopped > 30 s): ${r.deadlocks.size}`);
    for (const dl of [...r.deadlocks.values()].sort((a, b) => b.wait - a.wait).slice(0, TOP)) {
      console.log(`    ${dl.size} vehicles, ${round(dl.wait, 0)} s at t ${round(dl.at, 0)}: ${dl.members.join(' | ')}`);
    }
  }
  if (r.boxStuck.size) {
    console.log(`  junction boxes with a car stopped inside > 20 s: ${[...r.boxStuck].sort((a, b) => b[1] - a[1]).slice(0, TOP)
      .map(([n, w]) => `${where(n)} ${round(w, 0)} s`).join(', ')}`);
  }
  if (r.tramHeld.size) {
    console.log(`  trams stopped > 60 s: ${[...r.tramHeld.values()].map((t) => `line ${t.line || '-'} ${t.reason} ${round(t.stuck, 0)} s at ${t.at}`).join(', ')}`);
  }
  if (r.worstSnapshot) console.log(`  longest wait, as it stood:\n${r.worstSnapshot.text.replace(/^/gm, '    ')}`);
  all.samples += r.samples;
  all.speed += r.speed;
  all.moving += r.moving;
  all.movingSpeed += r.movingSpeed;
  all.stopped += r.stopped;
  all.queue = Math.max(all.queue, r.queue);
  all.waits.push(...r.waits);
  all.held120 += r.held120.size;
  all.deadlocks += r.deadlocks.size;
}
const waits = all.waits.sort((a, b) => a - b);
const total = {
  district: 'ALL', meanKmh: round(kmh(all.speed / all.samples)), movingKmh: round(kmh(all.movingSpeed / Math.max(1, all.moving))),
  stoppedPct: round((100 * all.stopped) / all.samples), longestQueue: all.queue, waitP90: round(pct(waits, 0.9), 0),
  waitMax: round(waits[waits.length - 1] || 0, 0), held120: all.held120, deadlocks: all.deadlocks
};
console.log('\n| District | cars | mean km/h | moving km/h | stopped | longest queue | wait p50 / p90 / max s | held > 120 s | deadlocks |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const row of report) {
  console.log(`| ${row.district} | ${row.cars} | ${row.meanKmh} | ${row.movingKmh} | ${row.stoppedPct}% | ${row.longestQueue} | ` +
    `${row.waitP50} / ${row.waitP90} / ${row.waitMax} | ${row.held120} | ${row.deadlocks} |`);
}
console.log(`| **all** | | ${total.meanKmh} | ${total.movingKmh} | ${total.stoppedPct}% | ${total.longestQueue} | – / ${total.waitP90} / ${total.waitMax} | ${total.held120} | ${total.deadlocks} |`);
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ minutes: MINUTES, fps: FPS, seed: SEED, districts: report, total }, null, 2));
