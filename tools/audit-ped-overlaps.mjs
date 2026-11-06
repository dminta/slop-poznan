// Headless pedestrian overlap audit. Runs the real pedestrian simulation (traffic.js on the furnished network) with the
// camera parked at each district and reports clusters of bodies standing on top of each other.
// node tools/audit-ped-overlaps.mjs [--minutes 3] [--fps 15] [--seeds 4242] [--only centrum,stare] [--json out.json]
//
// A cluster is a connected group of >= 4 placed pedestrians whose centres are closer than OVERLAP (0.5 m), sampled once
// per simulated second and counted while it lasts over 5 s. The output also has the citywide overlapping-pair rate and
// the number of people stepping onto a crosswalk (throughput), so a fix cannot pass by simply stopping everyone.
import { writeFileSync } from 'node:fs';
import { buildWorld } from './bench-world.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args[i + 1];
};
const MINUTES = Number(opt('minutes', 3));
const FPS = Number(opt('fps', 15));
const SEEDS = opt('seeds', '4242').split(',').map(Number);
const ONLY = opt('only', null);
const JSON_OUT = opt('json', null);
const WARMUP = 20; // s before sampling: the first frame scatters everyone, mid-track
const OVERLAP = 0.5; // m between centres
const MIN_CLUSTER = 4;
const MIN_SECONDS = 5;

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
const districts = ONLY ? DISTRICTS.filter((d) => ONLY.split(',').includes(d.key)) : DISTRICTS;
if (!Number.isFinite(MINUTES) || MINUTES <= 0 || !Number.isFinite(FPS) || FPS <= 0 ||
    SEEDS.some((s) => !Number.isInteger(s) || s <= 0 || s >= 2147483647)) {
  throw new Error('Invalid minutes, fps or seed');
}
const { getLocationLabel } = await import(new URL('../js/city-config.js', import.meta.url).href);
const round = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

// Union-find over the placed peds of one sample
function components(peds, ids) {
  const parent = new Map(ids.map((i) => [i, i]));
  const find = (i) => {
    let r = i;
    while (parent.get(r) !== r) r = parent.get(r);
    while (parent.get(i) !== r) { const n = parent.get(i); parent.set(i, r); i = n; }
    return r;
  };
  const pairs = [];
  for (let a = 0; a < ids.length; a++) {
    const p = peds[ids[a]];
    for (let b = a + 1; b < ids.length; b++) {
      const q = peds[ids[b]];
      const dx = p.x - q.x, dz = p.z - q.z;
      if (dx * dx + dz * dz >= OVERLAP * OVERLAP) continue;
      pairs.push([ids[a], ids[b]]);
      const ra = find(ids[a]), rb = find(ids[b]);
      if (ra !== rb) parent.set(ra, rb);
    }
  }
  const groups = new Map();
  for (const i of ids) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(i);
  }
  return { pairs, groups: [...groups.values()] };
}

function describe(p) {
  const which = p.node
    ? `crosswalk node ${Math.round(p.node.x)},${Math.round(p.node.z)} side ${p.side}${p.node.signal ? ' signal' : ' give-way'}${p.waiting ? ' waiting' : ' crossing'}`
    : p.nextRoute?.[p.nextLeg]?.hold ? `tram-strip hold at ${Math.round(p.nextRoute[p.nextLeg].hold.node?.x ?? 0)},${Math.round(p.nextRoute[p.nextLeg].hold.node?.z ?? 0)}`
    : p.conversation ? 'talking' : p.pause > 0 ? 'resting' : p.route?.edge ? 'walking a sidewalk' : 'on a corner link';
  return `${which} t ${round(p.t)}/${round(p.len)} dir ${p.dir} v ${round(p.v)}`;
}

function run(d, seed) {
  let s = seed;
  Math.random = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const { traffic } = buildWorld({});
  const all = traffic.peds;
  const player = { type: 'person', position: { x: -1e5, y: 0, z: -1e5 }, heading: 0, speed: 0 };
  const dt = 1 / FPS;
  const seconds = MINUTES * 60;
  const wasPlaced = new Uint8Array(all.length);
  const spawnedAt = new Array(all.length).fill(null);
  const origin = new Array(all.length).fill(null);
  const clusterSince = new Float64Array(all.length).fill(-1);
  const pairSince = new Map();
  const episodes = new Map();
  const pairMax = new Map();
  let pairSamples = 0, pairSeconds = 0, samples = 0, spawns = 0, tightSpawns = 0;
  let entries = 0, completions = 0;
  let time = 0, frame = 0;
  const crossings = new Float64Array(all.length); // 0 none, 1 on a crosswalk last sample
  while (time < seconds) {
    time += dt;
    traffic.update(dt, time, d, player, 'person', null);
    frame++;
    // births: where each placed ped came from, and whether it landed on another body
    for (let i = 0; i < all.length; i++) {
      const p = all[i];
      const placed = p.placed ? 1 : 0;
      if (placed && !wasPlaced[i]) {
        spawns++;
        origin[i] = { x: p.x, z: p.z, crosswalk: !!p.node, t: time };
        let near = Infinity;
        for (const q of all) if (q !== p && q.placed) near = Math.min(near, Math.hypot(q.x - p.x, q.z - p.z));
        if (near < OVERLAP) tightSpawns++;
        spawnedAt[i] = time;
      }
      wasPlaced[i] = placed;
    }
    if (time < WARMUP || frame % FPS) continue;
    samples++;
    const ids = [];
    for (let i = 0; i < all.length; i++) if (all[i].placed) ids.push(i);
    const { pairs, groups } = components(all, ids);
    pairSamples += pairs.length;
    pairSeconds += pairs.length; // one sample per simulated second
    for (const [a, b] of pairs) {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (!pairSince.has(key)) pairSince.set(key, time);
      const duration = time - pairSince.get(key);
      if (!pairMax.has(key) || pairMax.get(key).duration < duration) pairMax.set(key, { duration, time, a: all[a], b: all[b] });
    }
    const live = new Set(pairs.map(([a, b]) => (a < b ? `${a}:${b}` : `${b}:${a}`)));
    for (const key of [...pairSince.keys()]) if (!live.has(key)) pairSince.delete(key);

    const inLarge = new Set();
    for (const group of groups) if (group.length >= MIN_CLUSTER) for (const i of group) inLarge.add(i);
    for (let i = 0; i < all.length; i++) clusterSince[i] = inLarge.has(i) ? (clusterSince[i] < 0 ? time : clusterSince[i]) : -1;
    for (const group of groups) {
      if (group.length < MIN_CLUSTER) continue;
      let cx = 0, cz = 0;
      for (const i of group) { cx += all[i].x; cz += all[i].z; }
      cx /= group.length; cz /= group.length;
      const key = `${Math.round(cx / 2)}:${Math.round(cz / 2)}`;
      const since = Math.min(...group.map((i) => clusterSince[i]));
      const duration = time - since;
      const known = episodes.get(key);
      if (!known || known.duration < duration) {
        episodes.set(key, {
          key, duration, time, size: group.length, x: cx, z: cz,
          where: getLocationLabel(cx, cz),
          members: group.map((i) => ({
            id: i, inCluster: round(duration), spawnedAt: spawnedAt[i] === null ? null : round(spawnedAt[i]),
            origin: origin[i] ? { x: round(origin[i].x), z: round(origin[i].z), crosswalk: origin[i].crosswalk, at: round(origin[i].t) } : null,
            state: describe(all[i]), x: round(all[i].x, 2), z: round(all[i].z, 2)
          }))
        });
      }
    }
    // throughput: people stepping onto a crosswalk
    for (let i = 0; i < all.length; i++) {
      const on = all[i].placed && all[i].node ? 1 : 0;
      if (on && !crossings[i]) entries++;
      if (!on && crossings[i]) completions++;
      crossings[i] = on;
    }
  }
  const clusterList = [...episodes.values()].filter((e) => e.duration >= MIN_SECONDS).sort((a, b) => b.duration - a.duration);
  const worstPairs = [...pairMax.entries()].filter(([, v]) => v.duration >= MIN_SECONDS)
    .sort((a, b) => b[1].duration - a[1].duration).slice(0, 10).map(([key, v]) => ({
      pair: key, duration: round(v.duration), at: round(v.time), where: getLocationLabel(v.a.x, v.a.z),
      x: round(v.a.x, 2), z: round(v.a.z, 2), a: describe(v.a), b: describe(v.b)
    }));
  const sampledSeconds = Math.max(1, MINUTES * 60 - WARMUP);
  return {
    district: d.key, seed, minutes: MINUTES,
    clusters: clusterList,
    clusterCount: clusterList.length,
    longestCluster: clusterList.length ? clusterList[0].duration : 0,
    biggestCluster: clusterList.reduce((n, e) => Math.max(n, e.size), 0),
    overlapPairSecondsPerSecond: round(pairSeconds / samples),
    overlapPairSecondShare: round(pairSamples / Math.max(1, samples * all.length * (all.length - 1) / 2), 8),
    spawningPeds: spawns, tightSpawns,
    crosswalkEntriesPerMinute: round((entries / sampledSeconds) * 60),
    crosswalkCompletionsPerMinute: round((completions / sampledSeconds) * 60),
    worstPairs
  };
}

const results = [];
for (const d of districts) {
  for (const seed of SEEDS) {
    const t0 = Date.now();
    const r = run(d, seed);
    results.push(r);
    console.log(`\n== ${d.name} seed ${seed} (${round((Date.now() - t0) / 1000)} s)`);
    console.log(`  clusters >=${MIN_CLUSTER} overlapping peds for >${MIN_SECONDS} s: ${r.clusterCount}  ` +
      `longest ${round(r.longestCluster, 0)} s  biggest ${r.biggestCluster}  ` +
      `overlap pairs/s ${r.overlapPairSecondsPerSecond}  spawns ${r.spawningPeds} (${r.tightSpawns} on a body)  ` +
      `crosswalk entries/min ${r.crosswalkEntriesPerMinute}`);
    for (const e of r.clusters.slice(0, 8)) {
      console.log(`    ${round(e.duration, 0)} s, ${e.size} peds at (${round(e.x, 1)}, ${round(e.z, 1)}) ${e.where}`);
      for (const p of e.members.slice(0, 8)) console.log(`      #${p.id} ${p.state}  spawned ${p.origin ? `(${p.origin.x}, ${p.origin.z}) ${p.origin.crosswalk ? 'crosswalk' : 'sidewalk'} at ${p.origin.at}s` : '?'}`);
    }
    if (r.worstPairs.length) {
      console.log('  longest overlapping pairs:');
      for (const p of r.worstPairs.slice(0, 5)) console.log(`    ${p.duration} s at ${p.where} (${p.x}, ${p.z}): ${p.a} | ${p.b}`);
    }
  }
}
const totalClusters = results.reduce((n, r) => n + r.clusterCount, 0);
const meanPairs = results.reduce((n, r) => n + r.overlapPairSecondsPerSecond, 0) / results.length;
const meanEntries = results.reduce((n, r) => n + r.crosswalkEntriesPerMinute, 0) / results.length;
const longest = results.reduce((n, r) => Math.max(n, r.longestCluster), 0);
const biggest = results.reduce((n, r) => Math.max(n, r.biggestCluster), 0);
const spawns = results.reduce((n, r) => n + r.spawningPeds, 0);
const tight = results.reduce((n, r) => n + r.tightSpawns, 0);
console.log(`\nTOTAL clusters ${totalClusters}  longest ${round(longest, 0)} s  biggest ${biggest}  ` +
  `mean overlap pairs/s ${round(meanPairs, 2)}  mean crosswalk entries/min ${round(meanEntries, 1)}  ` +
  `spawns ${spawns}, ${tight} within ${OVERLAP} m of a body`);
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ minutes: MINUTES, fps: FPS, seeds: SEEDS, results }, null, 2));
