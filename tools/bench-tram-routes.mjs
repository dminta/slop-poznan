// Headless tram route membership audit. See docs/testing.md for the sampling method and limits.
// node tools/bench-tram-routes.mjs [--seed 4242] [--minutes 10] [--fps 15]
import { buildWorld } from './bench-world.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : Number(args[i + 1]);
};
const SEED = opt('seed', 4242);
const MINUTES = opt('minutes', 10);
const FPS = opt('fps', 15);
if (!Number.isInteger(SEED) || SEED <= 0 || SEED >= 2147483647 || !Number.isInteger(FPS) || FPS <= 0 ||
    !Number.isInteger(MINUTES) || MINUTES <= 0) throw new Error('Invalid seed, minutes or fps');

// A sample is the front edge of each active tram once per simulated second, including the initial population.
// A route is the displayed direction, which may change while the path is extended ahead of the front.
const locations = [
  { name: 'Ostrów Tumski', x: 907.1, z: -246.5 },
  { name: 'Stare Miasto', x: 0, z: 0 },
  { name: 'Dworzec', x: -1518.5, z: 557.7 },
  { name: 'Półwiejska', x: -250, z: 850 },
  { name: 'Rataje', x: 1108, z: 1439 },
  { name: 'Jeżyce', x: -2056, z: -391 }
];
const total = { samples: 0, other: 0, unused: 0, sameLine: 0 };
for (const focus of locations) {
  let seed = SEED;
  Math.random = () => (seed = seed * 16807 % 2147483647) / 2147483647;
  const { traffic, trams } = buildWorld();
  const player = { type: 'person', position: { x: -1e5, y: 0, z: -1e5 }, heading: 0, speed: 0 };
  const counts = { samples: 0, other: 0, unused: 0, sameLine: 0 };
  const edges = new Map();
  const dt = 1 / FPS;
  for (let frame = 0; frame < MINUTES * 60 * FPS; frame++) {
    const time = (frame + 1) * dt;
    trams.update(dt, time, focus, null, player, 'person');
    traffic.update(dt, time, focus, player, 'person', null);
    if ((frame + 1) % FPS) continue;
    for (const tram of trams.trams) {
      const edge = tram.path.edges[tram.path.indexAt(tram.path.u)];
      counts.samples++;
      if (edge.routes.includes(tram.route)) continue;
      const sameLine = edge.routes.some((r) => trams.routes[r].ref === tram.line);
      const kind = sameLine ? 'sameLine' : edge.routes.length ? 'other' : 'unused';
      counts[kind]++;
      const key = `${tram.route}/${edge.id}/${kind}`;
      const record = edges.get(key) || { route: tram.route, line: tram.line, to: tram.destination,
        from: [edge.from.x, edge.from.z], toNode: [edge.to.x, edge.to.z], kind, samples: 0,
        edgeRoutes: edge.routes.map((r) => trams.routes[r].ref) };
      record.samples++;
      edges.set(key, record);
    }
  }
  for (const key of Object.keys(total)) total[key] += counts[key];
  console.log(JSON.stringify({ location: focus, ...counts, edges: [...edges.values()] }));
}
console.log(JSON.stringify({ seed: SEED, minutes: MINUTES, fps: FPS, total }));
