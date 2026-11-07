// Reproduce the furnished-grid signal audit; output is deterministic JSON lines in network order.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { loadModule } = require('../tests/helpers/module.cjs');
const source = (name) => readFileSync(join(root, 'js', name + '.js'), 'utf8');
function inert() {
  const values = {};
  return new Proxy(function () {}, {
    get(_target, key) {
      if (key === Symbol.iterator) return function* () {};
      if (key === Symbol.toPrimitive) return () => 0;
      if (key === 'then') return undefined;
      return key in values ? values[key] : (values[key] = inert());
    },
    set(_target, key, value) { values[key] = value; return true; },
    apply: () => inert(), construct: () => inert()
  });
}
const config = await import('../js/city-config.js');
const { GEO } = await import('../js/geodata.js');
const rendering = { 'three/webgpu': inert(), 'three/tsl': inert(),
  'three/addons/utils/BufferGeometryUtils.js': inert(), './tsl-materials.js': inert() };
const globals = { document: inert(), console: { info() {}, warn() {}, log() {} } };
const road = loadModule(source('road-network'), { imports: { './city-config.js': config, './geodata.js': { GEO } }, globals });
const gridModule = loadModule(source('city-grid') +
  '\nexport function snapshot() { return { pavedPlazaRects, parkTreeSites, parkLampSites, sidewalkBlocks }; }', {
  imports: { ...rendering, './city-config.js': config, './geodata.js': { GEO } }, globals
});
const grid = gridModule.buildCityGrid(inert());
const liveGrid = { ...gridModule, ...gridModule.snapshot() };
const audit = {};
const streetSource = source('street-details').replace('  function addRuntimeSignalHeads(network, pedRoutes = null) {',
  '  Object.assign(audit, { signalArmPoles, vehicleHeadSites });\n  function addRuntimeSignalHeads(network, pedRoutes = null) {');
const street = loadModule(streetSource, { imports: { ...rendering, './city-config.js': config,
  './road-network.js': road, './city-grid.js': liveGrid, './trees.js': { createTreeField: () => ({ group: inert() }) } },
  globals: { ...globals, audit } }).buildStreetDetails(inert());
const network = road.buildRoadNetwork(grid.sidewalks, [...grid.footprints, ...street.footprints]);
const { createPedestrianRoutes } = loadModule(source('pedestrian-routes'), { imports: { './road-network.js': road }, globals });
const pedRoutes = createPedestrianRoutes(network, config.blockAt, gridModule.railClearance);
const configure = source('traffic').match(/  function configureSignals\([^]*?\n  \}/)[0];
// Preserve the original audit's pre-configuration population, including subsequently disabled nodes.
const initial = [];
for (const node of network.nodes) {
  if (!node.signal || !node.signalTiming) continue;
  for (const edge of node.in) {
    const matching = audit.vehicleHeadSites.some((h) => h.site.timing.index === node.signalTiming.index &&
      Math.hypot(h.p.x - node.x, h.p.z - node.z) < 45 &&
      h.a.ux * edge.inArm.ux + h.a.uz * edge.inArm.uz > 0.98);
    if (matching) continue;
    let best = null, dot = -Infinity;
    for (const c of node.signalArms || []) {
      const d = c.arm.ux * edge.inArm.ux + c.arm.uz * edge.inArm.uz;
      if (d > dot) { dot = d; best = c; }
    }
    const record = best && audit.signalArmPoles.get(best.arm);
    if (record && (record.hasHead || !record.poles.length)) initial.push({ node, edge });
  }
}
vm.runInNewContext(`(${configure})`, { nodes: network.nodes, pedRoutes, KERB: 1.6, signalNodes: [],
  configurePedestrianSignal: config.configurePedestrianSignal, configureSignalClearance: config.configureSignalClearance })();
street.addRuntimeSignalHeads(network);
const before = process.argv.includes('--before');
if (!before) street.addRuntimeSignalHeads(network, pedRoutes);
const analysis = street.auditRuntimeSignalHeads(network, pedRoutes);
const byEdge = new Map(analysis.entries.map((entry) => [entry.edge, entry]));
const counts = { A: 0, B: 0, C: 0, D: 0 };
for (const { node, edge } of initial) {
  const entry = byEdge.get(edge);
  if (!entry) throw new Error('Historical edge is missing from the runtime audit');
  const x = entry.x, z = entry.z;
  const row = { node: [node.x, node.z], stop: [x, z], direction: [edge.dx, edge.dz], class: entry.class };
  if (entry.head) {
    const p = entry.head.p, ox = p.x - x, oz = p.z - z;
    row.head = [p.x, p.z];
    row.along = ox * edge.dx + oz * edge.dz;
    row.lateral = ox * edge.rx + oz * edge.rz;
  }
  if (entry.candidate) row.site = [entry.candidate.x, entry.candidate.z, entry.candidate.side];
  if (entry.class === 'C') {
    row.reasonCounts = entry.reasons;
    row.sampleCount = entry.sampleCount;
    row.closest = entry.closest;
    row.decisive = entry.closest.fail;
  }
  counts[row.class]++;
  console.log(JSON.stringify(row));
}
console.log(JSON.stringify({ counts, total: initial.length, vehicleHeads: street.vehicleHeads,
  pedestrianHeads: street.audioSignals.length, runtimePoles: street.runtimeHeads.filter((h) => !h.existing).length,
  reusedPoles: street.runtimeHeads.filter((h) => h.existing).length,
  overheadHeads: street.runtimeHeads.filter((h) => h.overhead).length,
  overheadPoles: street.runtimeHeads.filter((h) => h.overhead && !h.existing).length,
  overheadReused: street.runtimeHeads.filter((h) => h.overhead && h.existing).length,
  placements: street.runtimeHeads.map((h) => [h.node.x, h.node.z, h.p.x, h.p.z, h.existing]) }));
