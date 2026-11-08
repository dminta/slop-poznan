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
const streetSource = source('street-details').replace(
  '  function addRuntimeSignalHeads(network, pedRoutes = null, supports = null) {',
  '  Object.assign(audit, { signalArmPoles, vehicleHeadSites });\n' +
  '  function addRuntimeSignalHeads(network, pedRoutes = null, supports = null) {');
const street = loadModule(streetSource, { imports: { ...rendering, './city-config.js': config,
  './road-network.js': road, './city-grid.js': liveGrid, './trees.js': { createTreeField: () => ({ group: inert() }) } },
  globals: { ...globals, audit } }).buildStreetDetails(inert());
const network = road.buildRoadNetwork(grid.sidewalks, [...grid.footprints, ...street.footprints]);
const { createPedestrianRoutes } = loadModule(source('pedestrian-routes'), { imports: { './road-network.js': road }, globals });
const pedRoutes = createPedestrianRoutes(network, config.blockAt, gridModule.railClearance);
const before = process.argv.includes('--before');
let supports = null;
if (!before) {
  const tramInfra = loadModule(source('tram-infra'), {
    imports: { ...rendering, './geodata.js': { GEO }, './city-config.js': config }, globals
  });
  const tramLayout = tramInfra.layoutTramInfrastructure(network);
  const railLayout = tramInfra.layoutRailInfrastructure(network);
  supports = [...tramLayout.poles, ...railLayout.masts];
}
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
if (!before) street.addRuntimeSignalHeads(network, pedRoutes, supports);
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
    // Raw phase inputs, so the test can check that every A head agrees with its edge's arm group even when the
    // two plans' main axes are opposed.
    row.group0 = entry.head.group0;
    row.axis0 = edge.axisIndex === 0;
    row.swap = Math.abs(entry.head.site.timing.mainUx * node.signalTiming.mainUx +
      entry.head.site.timing.mainUz * node.signalTiming.mainUz) <= 0.82;
    row.pedestrian = !!node.signalTiming.pedestrian;
    row.plan = entry.head.site.timing.index;
    row.nodePlan = node.signalTiming.index;
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
const alongOf = (h) => {
  const e = h.edge, x = e.sx + e.dx * e.len, z = e.sz + e.dz * e.len;
  return (h.p.x - x) * e.dx + (h.p.z - z) * e.dz;
};
const overhead = street.runtimeHeads.filter((h) => h.overhead);
const span = overhead.filter((h) => h.span);
const spanTraction = span.filter((h) => h.anchorTraction && h.anchorTraction.some(Boolean));
const cantilever = overhead.filter((h) => !h.span);
const fallback = cantilever.filter((h) => !h.band);
const spanFallback = span.filter((h) => !h.band);
const fallbackAlong = fallback.map(alongOf);
const spanFallbackAlong = spanFallback.map(alongOf);
const armLengths = cantilever.map((h) => Math.hypot(h.pole.x - h.p.x, h.pole.z - h.p.z));
const spanLengths = span.map((h) => Math.max(...h.anchors.map((p) => Math.hypot(p.x - h.p.x, p.z - h.p.z))));
const armRail = (h) => {
  const arm = Math.hypot(h.pole.x - h.p.x, h.pole.z - h.p.z);
  const steps = Math.max(1, Math.ceil(arm / 0.5));
  let min = Infinity;
  for (let i = 0; i <= steps; i++) {
    min = Math.min(min, gridModule.railClearance(h.pole.x + (h.p.x - h.pole.x) * i / steps,
      h.pole.z + (h.p.z - h.pole.z) * i / steps, 20));
  }
  return min;
};
// How close an existing signal pole would come to a head at the 8 m band: the fallback heads keep the support
// position because this distance exceeds the 12 m arm.
const supportDistance = (h) => {
  const e = h.edge, x = e.sx + e.dx * e.len, z = e.sz + e.dz * e.len;
  let min = Infinity;
  for (const record of audit.signalArmPoles.values()) for (const item of record.poles) {
    const p = item.p, along = (p.x - x) * e.dx + (p.z - z) * e.dz;
    if (along < -15 || along > 10) continue;
    const lat = (p.x - x) * e.rx + (p.z - z) * e.rz;
    let lane = e.lanes[0];
    for (const value of e.lanes) if (Math.abs(value - lat) < Math.abs(lane - lat)) lane = value;
    const t = Math.max(-15, Math.min(-8, along));
    min = Math.min(min, Math.hypot(p.x - x - e.dx * t - e.rx * lane,
      p.z - z - e.dz * t - e.rz * lane));
  }
  return min;
};
const spanAnchors = new Map();
for (const h of span) h.anchors.forEach((p, i) => {
  const k = `${p.x.toFixed(3)},${p.z.toFixed(3)}`;
  spanAnchors.set(k, { p, existing: h.anchorExisting[i] });
});
const spanNewFeet = [...spanAnchors.values()].filter((a) => !a.existing).map((a) => a.p);
const cantileverNewFeet = cantilever.filter((h) => !h.existing).map((h) => h.pole);
const newFeet = [...spanNewFeet, ...cantileverNewFeet];
const cantileverPoles = new Set(cantileverNewFeet
  .map((p) => `${p.x.toFixed(3)},${p.z.toFixed(3)}`)).size;
const spanNewHeads = span.filter((h) => h.anchorExisting.some((existing) => !existing)).length;
console.log(JSON.stringify({ counts, total: initial.length, vehicleHeads: street.vehicleHeads,
  pedestrianHeads: street.audioSignals.length, runtimePoles: street.runtimeHeads.filter((h) => !h.existing).length,
  reusedPoles: street.runtimeHeads.filter((h) => h.existing).length,
  overheadHeads: overhead.length,
  overheadPoles: overhead.filter((h) => !h.existing).length,
  overheadReused: overhead.filter((h) => h.existing).length,
  overheadStrict: overhead.filter((h) => h.strict).length,
  overheadBand: overhead.filter((h) => h.band).length,
  overheadException: fallback.length,
  overheadFallbackAlong: fallbackAlong.map((v) => Number(v.toFixed(3))),
  overheadFallbackSupportMin: fallback.length ? Number(Math.min(...fallback.map(supportDistance)).toFixed(3)) : null,
  overheadArmMax: armLengths.length ? Number(Math.max(...armLengths).toFixed(4)) : null,
  overheadArmMean: armLengths.length
    ? Number((armLengths.reduce((sum, v) => sum + v, 0) / armLengths.length).toFixed(4)) : null,
  spanHeads: span.length,
  spanPoles: new Set(spanNewFeet.map((p) => `${p.x.toFixed(3)},${p.z.toFixed(3)}`)).size,
  spanReused: [...spanAnchors.values()].filter((a) => a.existing).length,
  spanNewHeads,
  spanExistingHeads: span.length - spanNewHeads,
  cantileverPoles,
  spanStrict: span.filter((h) => h.strict).length,
  spanBand: span.filter((h) => h.band).length,
  spanTractionHeads: spanTraction.length,
  spanTractionAnchors: spanTraction.reduce((sum, h) => sum + h.anchorTraction.filter(Boolean).length, 0),
  spanException: spanFallback.length,
  spanFallbackAlong: spanFallbackAlong.map((v) => Number(v.toFixed(3))),
  spanLengthMax: spanLengths.length ? Number(Math.max(...spanLengths).toFixed(4)) : null,
  spanLengthMean: spanLengths.length
    ? Number((spanLengths.reduce((sum, v) => sum + v, 0) / spanLengths.length).toFixed(4)) : null,
  pedestrianApproaches: analysis.entries.filter((entry) => entry.node.signalTiming &&
    entry.node.signalTiming.pedestrian && !entry.node.signalTiming.disabled)
    .map((entry) => ({ node: [entry.node.x, entry.node.z], class: entry.class })),
  overheadFootRailMin: newFeet.length ? Math.min(...newFeet.map((p) =>
    gridModule.railClearance(p.x, p.z, 20))) : null,
  overheadArmRailMin: cantilever.length ? Math.min(...cantilever.map((h) =>
    armRail(h))) : null,
  spanHeadRailMin: span.length ? Math.min(...span.map((h) =>
    gridModule.railClearance(h.p.x, h.p.z, 20))) : null,
  placements: street.runtimeHeads.map((h) => [h.node.x, h.node.z, h.p.x, h.p.z, h.existing]) }));
