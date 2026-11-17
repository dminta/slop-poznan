// Headless audit of pedestrians on vehicle carriageways (not crosswalks, not pedestrian streets).
// node tools/audit-ped-roadway.mjs [--static-only] [--dynamic-only] [--minutes 3] [--fps 15] [--seeds 4242,7,11]
//                                  [--only centrum,stare] [--json out.json] [--top 25]
//
// (a) static: every route track (sidewalk lines, corner/curb links, island ports, pedestrian-way lines; crosswalk tracks
//     are the exempt crossings) is sampled every <= 0.5 m, and a sample is an offence when its centre lies inside a
//     carriageway: a lane envelope (lane offsets +- LANE_HALF about the lane centre, along the edge from stop line to stop
//     line) or a junction connector curve (+- LANE_HALF). Crosswalk rectangles (+ CROSS_PAD) are exempt, pedestrian streets
//     are not in the network, so they never match. The report names the track kind, street and metres.
// (b) dynamic: the real simulation at the eight districts; every second each placed pedestrian that is not on a crosswalk
//     track and not inside a crosswalk rectangle is tested the same way; ped-seconds and positions are reported.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { buildWorld } from './bench-world.mjs';

// Importable (tests/ped-roadway.test.mjs): the report only runs when this file is the entry point.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
const args = isMain ? process.argv.slice(2) : [];
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args[i + 1];
};
const MINUTES = Number(opt('minutes', 3));
const FPS = Number(opt('fps', 15));
const SEEDS = opt('seeds', '4242,7,11').split(',').map(Number);
const ONLY = opt('only', null);
const JSON_OUT = opt('json', null);
const TOP = Number(opt('top', 25));
const WARMUP = 20;
const LANE_HALF = Number(opt('lane-half', 1.2)); // m: a car body is 1.8-2.0 m wide
const CROSS_PAD = 1.0;
const ENVELOPE = opt('envelope', 'lanes'); // 'lanes': lane centres +- LANE_HALF; 'span': lanes +- 1 m (what the route builder rejects); 'half': also the whole roadway (+- edge.half - HALF_INSET, over-strict on curb paving)
const HALF_INSET = Number(opt('half-inset', 1.0)); // m a sample must lie inside the roadway edge to count: 1 m = a body clear of the curb
const CONNECTORS = opt('connectors', 'on') !== 'off';
const STEP = 0.5;

const DISTRICTS = [
  { key: 'centrum', name: 'Centrum (Św. Marcin)', x: -900, z: 178 },
  { key: 'stare', name: 'Stare Miasto', x: 0, z: 0 },
  { key: 'jezyce', name: 'Jeżyce (Rynek Jeżycki)', x: -2056, z: -391 },
  { key: 'lazarz', name: 'Łazarz (Głogowska)', x: -1900, z: 1500 },
  { key: 'wilda', name: 'Wilda', x: -300, z: 1800 },
  { key: 'rataje', name: 'Rataje (Rondo Rataje)', x: 1108, z: 1439 },
  { key: 'kaponiera', name: 'Rondo Kaponiera', x: -1464, z: 88 },
  { key: 'dworzec', name: 'Poznań Główny', x: -1518.5, z: 557.7 }
];
const round = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

// The carriageway oracle for one built world: lane envelopes of every edge and every junction connector.
function createRoadOracle(network, crosswalks, { envelope = ENVELOPE, connectors = CONNECTORS, halfInset = HALF_INSET } = {}) {
  const CELL = 32;
  const key = (ix, iz) => (ix + 4096) * 8192 + (iz + 4096);
  const edgeCells = new Map(), curveCells = new Map(), crossCells = new Map();
  const file = (map, k, item) => { let l = map.get(k); if (!l) map.set(k, l = []); l.push(item); };
  for (const e of network.edges) {
    const ex = e.sx + e.dx * e.len, ez = e.sz + e.dz * e.len;
    const reach = Math.abs(e.lanes[0] ?? 0) + e.half + 3;
    const minX = Math.min(e.sx, ex) - reach, maxX = Math.max(e.sx, ex) + reach;
    const minZ = Math.min(e.sz, ez) - reach, maxZ = Math.max(e.sz, ez) + reach;
    let lo = Infinity, hi = -Infinity;
    for (const l of e.lanes) { lo = Math.min(lo, l); hi = Math.max(hi, l); }
    if (!e.lanes.length) continue;
    const car = envelope === 'span' ? 1 : LANE_HALF; // 'span' = pedestrian-routes.js onRoadway: lane centres +- 1 m
    e._lo = lo - car; e._hi = hi + car;
    if (envelope === 'half') { e._lo = Math.min(e._lo, -e.half + halfInset); e._hi = Math.max(e._hi, e.half - halfInset); }
    for (let ix = Math.floor(minX / CELL); ix <= Math.floor(maxX / CELL); ix++) {
      for (let iz = Math.floor(minZ / CELL); iz <= Math.floor(maxZ / CELL); iz++) file(edgeCells, key(ix, iz), e);
    }
  }
  const pt = {};
  for (const e of network.edges) {
    for (const m of e.moves) {
      for (let i = 0; i < e.lanes.length; i++) {
        const j = m.out[i];
        if (j < 0) continue;
        const c = network.connector(e, i, m.to, j);
        const n = Math.max(1, Math.ceil(c.len / 1));
        for (let k = 0; k <= n; k++) {
          network.curvePoint(c, c.len * k / n, pt);
          file(curveCells, key(Math.floor(pt.x / CELL), Math.floor(pt.z / CELL)), { x: pt.x, z: pt.z, e });
        }
      }
    }
  }
  for (const c of crosswalks) {
    const cx = (c.ax + c.bx) / 2, cz = (c.az + c.bz) / 2, r = Math.hypot(c.bx - c.ax, c.bz - c.az) / 2 + 6;
    for (let ix = Math.floor((cx - r) / CELL); ix <= Math.floor((cx + r) / CELL); ix++) {
      for (let iz = Math.floor((cz - r) / CELL); iz <= Math.floor((cz + r) / CELL); iz++) file(crossCells, key(ix, iz), c);
    }
  }
  const inCrosswalk = (x, z) => {
    for (const c of crossCells.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) || []) {
      const len = Math.hypot(c.bx - c.ax, c.bz - c.az) || 1;
      const ux = (c.bx - c.ax) / len, uz = (c.bz - c.az) / len;
      const along = (x - c.ax) * ux + (z - c.az) * uz;
      const across = -(x - c.ax) * uz + (z - c.az) * ux;
      const h = (c.h ?? 1.5) + CROSS_PAD;
      if (along >= -CROSS_PAD - 1.5 && along <= len + CROSS_PAD + 1.5 && Math.abs(across) <= h + 1) return true;
    }
    return false;
  };
  // returns the offending edge (lane envelope) or a marker for a connector, else null
  const onCarriageway = (x, z) => {
    const k = key(Math.floor(x / CELL), Math.floor(z / CELL));
    for (const e of edgeCells.get(k) || []) {
      const s = (x - e.sx) * e.dx + (z - e.sz) * e.dz;
      if (s < 0 || s > e.len) continue;
      const lat = (x - e.sx) * e.rx + (z - e.sz) * e.rz;
      if (lat > e._lo && lat < e._hi) return e;
    }
    for (const q of connectors ? curveCells.get(k) || [] : []) {
      if ((x - q.x) ** 2 + (z - q.z) ** 2 < (LANE_HALF + 0.5) ** 2) return { connector: true, e: q.e };
    }
    return null;
  };
  return { onCarriageway, inCrosswalk };
}

function trackKind(t) {
  if (t.node) return 'crosswalk';
  if (t.way) return 'way';
  if (t.edge && !t.link && !t.corner) return 'sidewalk';
  return 'link';
}

function staticAudit(traffic, oracle, label) {
  const routes = traffic.pedestrianRoutes;
  const tracks = routes.segments();
  const byKind = {};
  const offenders = [];
  const seen = new Set(); // a corner link is rebuilt per route choice: count each physical stretch once
  let total = 0;
  for (const t of tracks) {
    const kind = trackKind(t);
    if (kind === 'crosswalk') continue;
    const steps = Math.max(1, Math.ceil(t.len / STEP));
    let run = null;
    const flush = () => {
      const id = run && `${Math.round(run.x * 4)},${Math.round(run.z * 4)}|${Math.round(run.x1 * 4)},${Math.round(run.z1 * 4)}`;
      if (run && run.len >= STEP * 0.99 && !seen.has(id)) {
        seen.add(id);
        offenders.push(run);
        total += run.len;
        byKind[kind] = (byKind[kind] || 0) + run.len;
      }
      run = null;
    };
    for (let i = 0; i <= steps; i++) {
      const s = Math.min(t.len, i * STEP);
      const x = t.ax + t.ux * s, z = t.az + t.uz * s;
      const hit = oracle.onCarriageway(x, z);
      if (hit && !oracle.inCrosswalk(x, z)) {
        if (!run) run = { kind, x, z, x1: x, z1: z, len: 0, track: t, edge: hit.connector ? hit.e : hit, connector: !!hit.connector };
        else run.len += STEP;
        run.x1 = x; run.z1 = z;
      } else flush();
    }
    flush();
  }
  offenders.sort((a, b) => b.len - a.len);
  return { label, tracks: tracks.length, totalMetres: round(total), byKind: Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, round(v)])), offenders };
}

function dynamicAudit(d, seed, getLocationLabel) {
  let s = seed;
  Math.random = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const { traffic, network } = buildWorld({ furnished: true });
  const oracle = createRoadOracle(network, traffic.crosswalks);
  const all = traffic.peds;
  const player = { type: 'person', position: { x: -1e5, y: 0, z: -1e5 }, heading: 0, speed: 0 };
  const dt = 1 / FPS, seconds = MINUTES * 60;
  let time = 0, frame = 0, pedSeconds = 0, samples = 0, placedSeconds = 0;
  const events = new Map();
  while (time < seconds) {
    time += dt;
    traffic.update(dt, time, d, player, 'person', null);
    frame++;
    if (time < WARMUP || frame % FPS) continue;
    samples++;
    for (let i = 0; i < all.length; i++) {
      const p = all[i];
      if (!p.placed) continue;
      placedSeconds++;
      if (p.node || oracle.inCrosswalk(p.x, p.z)) continue;
      const hit = oracle.onCarriageway(p.x, p.z);
      if (!hit) continue;
      pedSeconds++;
      const k = `${Math.round(p.x / 3)}:${Math.round(p.z / 3)}`;
      const ev = events.get(k) || { x: round(p.x), z: round(p.z), seconds: 0, ids: new Set(), where: getLocationLabel(p.x, p.z),
        street: hit.e && hit.e.name, route: p.route?.way ? 'way' : p.route?.edge ? 'sidewalk' : 'link' };
      ev.seconds++; ev.ids.add(i);
      events.set(k, ev);
    }
  }
  const list = [...events.values()].sort((a, b) => b.seconds - a.seconds).map((e) => ({ ...e, ids: e.ids.size }));
  return { district: d.key, seed, pedSeconds, placedSeconds, share: round(pedSeconds / Math.max(1, placedSeconds), 5), spots: list };
}


export { createRoadOracle, staticAudit, trackKind };

if (isMain) {
const { getLocationLabel } = await import(new URL('../js/city-config.js', import.meta.url).href);
const out = { lanes: LANE_HALF };
if (!flag('dynamic-only')) {
  Math.random = (() => { let s = 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  const { traffic, network } = buildWorld({ furnished: true });
  const oracle = createRoadOracle(network, traffic.crosswalks);
  const r = staticAudit(traffic, oracle, 'static');
  out.static = { ...r, offenders: r.offenders.map((o) => ({
    kind: o.kind, x: round(o.x), z: round(o.z), x1: round(o.x1), z1: round(o.z1), metres: round(o.len), connector: o.connector,
    where: getLocationLabel(o.x, o.z), edge: o.edge ? `${o.edge.from.x | 0},${o.edge.from.z | 0}->${o.edge.to.x | 0},${o.edge.to.z | 0}` : null
  })) };
  console.log(`STATIC: ${r.tracks} tracks, ${r.totalMetres} m on carriageway in ${r.offenders.length} runs; by kind ${JSON.stringify(r.byKind)}`);
  for (const o of out.static.offenders.slice(0, TOP)) {
    console.log(`  ${o.metres} m ${o.kind}${o.connector ? ' (connector)' : ''} (${o.x}, ${o.z}) -> (${o.x1}, ${o.z1}) ${o.where} edge ${o.edge}`);
  }
}
if (!flag('static-only')) {
  const districts = ONLY ? DISTRICTS.filter((d) => ONLY.split(',').includes(d.key)) : DISTRICTS;
  out.dynamic = [];
  let total = 0, placed = 0;
  for (const d of districts) for (const seed of SEEDS) {
    const r = dynamicAudit(d, seed, getLocationLabel);
    out.dynamic.push(r);
    total += r.pedSeconds; placed += r.placedSeconds;
    console.log(`DYNAMIC ${d.key} seed ${seed}: ${r.pedSeconds} ped-s on carriageway of ${r.placedSeconds} (${r.share})`);
    for (const e of r.spots.slice(0, 3)) console.log(`    ${e.seconds} s (${e.x}, ${e.z}) ${e.where} ${e.route} ${e.ids} peds`);
  }
  out.dynamicTotal = { pedSeconds: total, placedSeconds: placed, share: round(total / Math.max(1, placed), 5) };
  console.log(`DYNAMIC TOTAL ${total} ped-s of ${placed} placed (${out.dynamicTotal.share})`);
}
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(out, null, 2));

}
