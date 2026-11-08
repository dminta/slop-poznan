// List opposing road lanes closer to a tram track than a 1.8 m car, 2.4 m tram and 0.2 m margin allow.
// By default only street-running tracks a route uses can collide with a car; `--all` also lists tracks with no route
// and off-street formations, where the proximity is layout rather than a car-tram body overlap.
// node tools/audit-tram-opposing-lanes.mjs [--min-length 5] [--clearance 2.3] [--all]
import { buildWorld } from './bench-world.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : Number(args[i + 1]);
};
const minimum = option('min-length', 5);
const clearance = option('clearance', 2.3);
const all = args.includes('--all');
if (!(minimum > 0) || !(clearance > 0 && clearance <= 2.3)) throw new Error('Invalid minimum length or clearance (maximum 2.3 m)');
const { trams } = buildWorld({});
// An edge may carry a station profile that shifts all lanes sideways between stops (road-network.js laneShiftAt).
const shiftAt = (edge, s) => {
  const p = edge.laneShift;
  if (!p) return 0;
  if (s <= p[0].s) return p[0].d;
  for (let k = 1; k < p.length; k++) {
    if (s > p[k].s) continue;
    const run = p[k].s - p[k - 1].s;
    return run > 1e-9 ? p[k - 1].d + (p[k].d - p[k - 1].d) * (s - p[k - 1].s) / run : p[k].d;
  }
  return p[p.length - 1].d;
};
const rows = [];
const skipped = [];
for (const te of trams.graph.edges) {
  for (const run of te.lanes) {
    if (run.dir !== -1) continue;
    const road = run.edge;
    let first = null, last = null, min = Infinity;
    const finish = () => {
      if (first !== null && last - first >= minimum) (te.street && te.routes.length ? rows : skipped).push({
        road: road.id, lane: run.lane, track: te.id, chain: te.chain,
        street: !!te.street, routes: te.routes.length,
        length: +(last - first).toFixed(2), minimum: +min.toFixed(2),
        roadStart: [road.sx, road.sz].map((n) => +n.toFixed(1)),
        roadEnd: [road.sx + road.dx * road.len, road.sz + road.dz * road.len].map((n) => +n.toFixed(1)),
        trackFrom: +first.toFixed(2), trackTo: +last.toFixed(2)
      });
      first = last = null;
      min = Infinity;
    };
    // Sample at one metre, as in mapTramsToRoads. Distances are perpendicular to the lane centreline.
    for (let s = Math.ceil(run.s0); s <= run.s1; s++) {
      let k = 0;
      while (k + 1 < te.cum.length - 1 && te.cum[k + 1] < s) k++;
      const seg = te.cum[k + 1] - te.cum[k];
      const u = seg > 0 ? (s - te.cum[k]) / seg : 0;
      const x = te.pts[2 * k] + (te.pts[2 * k + 2] - te.pts[2 * k]) * u;
      const z = te.pts[2 * k + 1] + (te.pts[2 * k + 3] - te.pts[2 * k + 1]) * u;
      const along = (x - road.sx) * road.dx + (z - road.sz) * road.dz;
      const lat = Math.abs((x - road.sx) * road.rx + (z - road.sz) * road.rz - road.lanes[run.lane] - shiftAt(road, along));
      if (along >= 0 && along <= road.len && lat < clearance) {
        if (first === null) first = s;
        last = s;
        min = Math.min(min, lat);
      } else finish();
    }
    finish();
  }
}
rows.sort((a, b) => a.road - b.road || a.lane - b.lane || a.track - b.track);
skipped.sort((a, b) => a.road - b.road || a.lane - b.lane || a.track - b.track);
const listed = all ? [...rows, ...skipped] : rows;
listed.sort((a, b) => a.road - b.road || a.lane - b.lane || a.track - b.track);
for (const row of listed) console.log(JSON.stringify(row));
const total = (list) => ({ segments: list.length, lanes: new Set(list.map((r) => `${r.road}:${r.lane}`)).size,
  length: +list.reduce((sum, r) => sum + r.length, 0).toFixed(2) });
console.error(JSON.stringify({ ...total(all ? listed : rows), skipped: total(skipped), clearance, minimum, all }));
