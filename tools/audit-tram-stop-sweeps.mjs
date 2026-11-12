// City-wide standing-car intrusion list; a diagnostic, not an automatic safe-setback claim.
// node tools/audit-tram-stop-sweeps.mjs [--step 0.25] [--margin 0.1]
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { buildWorld } from './bench-world.mjs';
import { buildSectionSweep, standingRectangle, findStandingRetreat } from './tram-sweep-geometry.mjs';

const require = createRequire(import.meta.url);
const { loadModule } = require('../tests/helpers/module.cjs');
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(`--${name}`) ? Number(args[args.indexOf(`--${name}`) + 1]) : fallback;
const step = option('step', 0.25), margin = option('margin', 0.1);
if (!(step > 0) || !(margin >= 0)) throw new Error('Invalid sweep sampling');
const source = readFileSync(new URL('../js/trams.js', import.meta.url), 'utf8');
const geometry = loadModule(source, { imports: {
  'three/webgpu': {}, './geodata.js': {}, './city-config.js': {}, './tsl-materials.js': {},
  './actor-models.js': {}, './vehicle-lights.js': {}
} });
const start = performance.now();
const { network, trams } = buildWorld({});
const built = performance.now();
const sweep = buildSectionSweep(trams.graph, geometry.TRAM_MODELS, geometry.edgePoint, geometry.poseSections,
  { step, margin });
const indexed = performance.now();
const round = (v) => Math.round(v * 100) / 100;
const rows = [];
for (const e of network.edges) {
  if (e.to.shape) continue;
  for (let lane = 0; lane < e.lanes.length; lane++) {
    const rect = (back) => standingRectangle(e, network.laneOffset(e, lane, e.len - 2.8 - back), back);
    const first = rect(0), hit = sweep.intrusion(first);
    if (hit.depth <= 0) continue;
    // Keep six metres of storage (5.6 m van + clearance). An unsafe short edge stays listed as unresolved.
    const { retreat, requiredRetreat } = findStandingRetreat(rect, sweep, e.len - 6);
    rows.push({ edge: e.id, lane, x: round(first.x), z: round(first.z), length: round(e.len),
      intrusion: round(hit.depth), chain: hit.hit.chain, sectionLength: hit.hit.sectionLength,
      retreat: retreat !== null ? round(retreat) : null, remaining: retreat !== null ? round(e.len - retreat) : null,
      requiredRetreat: requiredRetreat !== null ? round(requiredRetreat) : null,
      from: [round(e.from.x), round(e.from.z)], to: [round(e.to.x), round(e.to.z)] });
  }
}
console.log(JSON.stringify({ summary: { rows: rows.length, resolvable: rows.filter((r) => r.retreat !== null).length,
  rectangles: sweep.count, step, margin, worldBuildMs: round(built - start), sweepBuildMs: round(indexed - built),
  queryMs: round(performance.now() - indexed) } }));
for (const row of rows) console.log(JSON.stringify(row));
