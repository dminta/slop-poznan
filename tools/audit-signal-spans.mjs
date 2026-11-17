// Full-collider headless audit of span stay angles, sampled rail deck clearance and anchor-to-collider distances.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { loadModule } = require('../tests/helpers/module.cjs');
const source = (name) => readFileSync(join(root, 'js', name + '.js'), 'utf8');

// Build the same landmark, building and bridge collider fixture as the full tree audit.
const { runAudit } = await import('./audit-tree-clearance.mjs');
const savedLog = console.log;
console.log = () => {};
const streetSource = process.argv.includes('--before')
  ? (await import('node:child_process')).execFileSync('git', ['show', 'HEAD:js/street-details.js'],
    { encoding: 'utf8' })
  : source('street-details');
const world = await runAudit({ worldOnly: true, streetSource });
console.log = savedLog;
const { config, details: street, grid, gridModule, roadMod: road, tramMod: tramInfra } = world;
const network = road.buildRoadNetwork(grid.sidewalks, [...grid.footprints, ...street.footprints,
  ...world.buildingColliders.filter((c) => !c.obb && (c.minY ?? 0) < 3.5)]);
const { createPedestrianRoutes } = loadModule(source('pedestrian-routes'), {
  imports: { './road-network.js': road }, globals: { console: { info() {}, warn() {}, log() {} } }
});
const pedRoutes = createPedestrianRoutes(network, config.blockAt, gridModule.railClearance);
const tramLayout = tramInfra.layoutTramInfrastructure(network, grid);
const railLayout = tramInfra.layoutRailInfrastructure(network);
const supports = [...tramLayout.poles, ...railLayout.masts];
const configure = source('traffic').match(/  function configureSignals\([^]*?\n  \}/)[0];
vm.runInNewContext(`(${configure})`, { nodes: network.nodes, pedRoutes, KERB: 1.6, signalNodes: [],
  configurePedestrianSignal: config.configurePedestrianSignal,
  configureSignalClearance: config.configureSignalClearance })();
street.addRuntimeSignalHeads(network);
street.addRuntimeSignalHeads(network, pedRoutes, supports, railLayout);

// AABB distance is conservative for rotated facades; existing poles are included in the report.
const spans = street.runtimeHeads.filter((h) => h.span);
const rows = spans.map((h, id) => {
  const [a, b] = h.anchors, p = h.p;
  const ux = a.x - p.x, uz = a.z - p.z, vx = b.x - p.x, vz = b.z - p.z;
  const angle = Math.acos(Math.max(-1, Math.min(1, (ux * vx + uz * vz) /
    (Math.hypot(ux, uz) * Math.hypot(vx, vz))))) * 180 / Math.PI;
  const stays = h.anchors.map((anchor) => {
    const len = Math.hypot(p.x - anchor.x, p.z - anchor.z), steps = Math.ceil(len / 0.25);
    let clearance = Infinity;
    for (let i = 0; i <= steps; i++) {
      const x = anchor.x + (p.x - anchor.x) * i / steps, z = anchor.z + (p.z - anchor.z) * i / steps;
      for (const v of railLayout.viaducts) for (const q of v.pieces) {
        const dx = q.bx - q.ax, dz = q.bz - q.az, l2 = dx * dx + dz * dz;
        const t = Math.max(0, Math.min(1, ((x - q.ax) * dx + (z - q.az) * dz) / l2));
        if (Math.hypot(x - q.ax - t * dx, z - q.az - t * dz) <= 2.7)
          clearance = Math.min(clearance, h.topY - v.deckY);
      }
    }
    return { anchor, deckClearance: Number.isFinite(clearance) ? clearance : null, envelopeHit: clearance < 6 };
  });
  return { id, edge: h.edge.id, head: { x: p.x, z: p.z, y: h.topY }, angle, stays,
    footBuildingDistance: h.anchors.map((p) => {
      let best = Infinity;
      for (const c of world.buildingColliders) {
        if ((c.minY ?? 0) > 0.3 || (c.maxY ?? Infinity) < 0.1) continue;
        const dx = Math.max(c.minX - p.x, 0, p.x - c.maxX);
        const dz = Math.max(c.minZ - p.z, 0, p.z - c.maxZ);
        best = Math.min(best, Math.hypot(dx, dz));
      }
      return best;
    }), anchorExisting: h.anchorExisting };
});
const summary = { spans: rows.length, nearCollinear: rows.filter((r) => r.angle < 12).length,
  railEnvelopeStays: rows.flatMap((r) => r.stays).filter((s) => s.envelopeHit).length,
  facadeHits: rows.flatMap((r) => r.footBuildingDistance).filter((d) => d <= 0.3).length,
  unplaced: street.auditRuntimeSignalHeads(network, pedRoutes).entries.filter((e) => e.class === 'C')
    .map((e) => [e.node.x, e.node.z]),
  note: 'AABB facade distances are conservative; balconies not examined.' };
const heads = street.runtimeHeads.map((h) => ({ edge: h.edge.id,
  x: h.p.x, z: h.p.z, support: h.bridge ? 'bridge' : h.span ? 'span' : h.overhead ? 'cantilever' : 'ground',
  pole: h.pole }));
if (process.argv.includes('--json')) console.log(JSON.stringify({ summary, rows, heads }));
else { for (const row of rows) console.log(JSON.stringify(row)); console.log(JSON.stringify({ summary })); }
