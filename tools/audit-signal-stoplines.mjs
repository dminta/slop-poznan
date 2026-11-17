// Table 7.2 stop-line audit: for every signalised approach, how far each head stands past its stop line, the shift
// that would put the line the required distance (side 2.0 m, overhead 10.5 m) before the head, and how much link is
// left. Reuses the headless world build of tools/audit-fallback-head-sight.mjs.
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
const rendering = {
  'three/webgpu': inert(),
  'three/tsl': inert(),
  'three/addons/utils/BufferGeometryUtils.js': inert(),
  './tsl-materials.js': inert()
};
const globals = { document: inert(), console: { info() {}, warn() {}, log() {} } };

const road = loadModule(source('road-network'), {
  imports: { './city-config.js': config, './geodata.js': { GEO } },
  globals
});
const gridModule = loadModule(source('city-grid') +
  '\nexport function snapshot() { return { pavedPlazaRects, parkTreeSites, parkLampSites, sidewalkBlocks }; }', {
  imports: { ...rendering, './city-config.js': config, './geodata.js': { GEO } },
  globals
});
const grid = gridModule.buildCityGrid(inert());
const liveGrid = { ...gridModule, ...gridModule.snapshot() };
const audit = {};
const streetSource = source('street-details').replace(
  '  function addRuntimeSignalHeads(network, pedRoutes = null, supports = null) {',
  '  Object.assign(audit, { signalArmPoles, vehicleHeadSites });\n' +
  '  function addRuntimeSignalHeads(network, pedRoutes = null, supports = null) {'
);
const street = loadModule(streetSource, {
  imports: {
    ...rendering,
    './city-config.js': config,
    './road-network.js': road,
    './city-grid.js': liveGrid,
    './trees.js': { createTreeField: () => ({ group: inert() }) }
  },
  globals: { ...globals, audit }
}).buildStreetDetails(inert());

const network = road.buildRoadNetwork(grid.sidewalks, [...grid.footprints, ...street.footprints]);
const { createPedestrianRoutes } = loadModule(source('pedestrian-routes'), {
  imports: { './road-network.js': road },
  globals
});
const pedRoutes = createPedestrianRoutes(network, config.blockAt, gridModule.railClearance);
const tramInfra = loadModule(source('tram-infra'), {
  imports: { ...rendering, './geodata.js': { GEO }, './city-config.js': config },
  globals
});
const tramLayout = tramInfra.layoutTramInfrastructure(network);
const railLayout = tramInfra.layoutRailInfrastructure(network);
const supports = [...tramLayout.poles, ...railLayout.masts];

const configure = source('traffic').match(/  function configureSignals\([^]*?\n  \}/)[0];
vm.runInNewContext(`(${configure})`, {
  nodes: network.nodes,
  pedRoutes,
  KERB: 1.6,
  signalNodes: [],
  configurePedestrianSignal: config.configurePedestrianSignal,
  configureSignalClearance: config.configureSignalClearance
})();

street.addRuntimeSignalHeads(network);
street.addRuntimeSignalHeads(network, pedRoutes, supports);

const heads = audit.vehicleHeadSites;
console.log('heads', heads.length, 'runtime', street.runtimeHeads.length, 'nodes', network.nodes.length);
const aliasRoot = (p) => { while (p && p.alias) p = p.alias; return p; };
const out = [];
for (const node of network.nodes) {
  if (!node.signalTiming || !node.signal || node.signalTiming.disabled) continue;
  const nr = aliasRoot(node.signalTiming);
  for (const edge of node.in) {
    if (!edge.lanes.length) continue;
    const x = edge.sx + edge.dx * edge.len, z = edge.sz + edge.dz * edge.len;
    const mine = [];
    for (const h of heads) {
      if (aliasRoot(h.site.timing) !== nr) continue;
      const swap = Math.abs(h.site.timing.mainUx * node.signalTiming.mainUx + h.site.timing.mainUz * node.signalTiming.mainUz) <= 0.82;
      if (!(node.signalTiming.pedestrian || (h.group0 !== swap) === (edge.axisIndex === 0))) continue;
      if (Math.hypot(h.p.x - node.x, h.p.z - node.z) >= 45) continue;
      if (h.a.ux * edge.inArm.ux + h.a.uz * edge.inArm.uz <= 0.98) continue;
      const along = (h.p.x - x) * edge.dx + (h.p.z - z) * edge.dz;
      mine.push({ along, overhead: !!h.overhead, span: !!h.span });
    }
    out.push({ node: node.id ?? null, edge: edge.id, len: edge.len, setbackTo: edge.setbackTo, heads: mine });
  }
}
const stat = (a) => { a = a.slice().sort((p, q) => p - q); const n = a.length; return n ? { n, med: +a[n >> 1].toFixed(2), max: +a[n - 1].toFixed(2), p90: +a[Math.floor(n * 0.9)].toFixed(2), gt2: a.filter(v => v > 2).length, gt5: a.filter(v => v > 5).length, gt10: a.filter(v => v > 10).length } : { n: 0 }; };
const ap = out.filter((o) => o.heads.length);
console.log('signalised approaches', out.length, 'with heads', ap.length, 'no head', out.length - ap.length);
const ovOnly = ap.filter((o) => o.heads.every((h) => h.overhead));
const ground = ap.filter((o) => o.heads.some((h) => !h.overhead));
console.log('overhead-only approaches', ovOnly.length, 'approaches with ground heads', ground.length);
// shift = need - along (head at +along past line). min shift over heads for ground: max along
const shiftOv = ovOnly.map((o) => 10.5 - Math.max(...o.heads.map((h) => h.along)));
const shiftGroundBest = ground.map((o) => 2 - Math.max(...o.heads.filter((h) => !h.overhead).map((h) => h.along)));
const shiftGroundAll = ground.map((o) => 2 - Math.min(...o.heads.filter((h) => !h.overhead).map((h) => h.along)));
console.log('overhead shift', stat(shiftOv));
console.log('ground (best head) shift', stat(shiftGroundBest));
console.log('ground (all heads) shift', stat(shiftGroundAll));
console.log('ground heads per approach', JSON.stringify(ground.reduce((m, o) => { const k = o.heads.filter(h=>!h.overhead).length; m[k] = (m[k]||0)+1; return m; }, {})));
// room: len available vs shift
const lenOv = ovOnly.map((o, i) => ({ len: o.len, shift: shiftOv[i] }));
console.log('overhead approaches where shift > len-10:', lenOv.filter((o) => o.shift > o.len - 10).length, 'shift>len*0.5', lenOv.filter((o) => o.shift > o.len * 0.5).length);
const lenG = ground.map((o, i) => ({ len: o.len, shift: shiftGroundBest[i] }));
console.log('ground approaches where shift > len-10:', lenG.filter((o) => o.shift > Math.max(0,o.len - 10) && o.shift > 0).length);
console.log('len stats ov', stat(ovOnly.map(o=>o.len)), 'ground', stat(ground.map(o=>o.len)));

for (const keep of [0, 5.5, 10]) {
  console.log('queue kept', keep, 'm: overhead feasible', lenOv.filter((o) => o.shift <= o.len - keep).length, '/', lenOv.length,
    '; ground needing a shift and feasible', lenG.filter((o) => o.shift > 0 && o.shift <= o.len - keep).length, '/',
    lenG.filter((o) => o.shift > 0).length);
}

const sl = street.stopLines;
if (sl) {
  const sh = sl.shifted.map((r) => r.shift).sort((p, q) => p - q);
  console.log('stop lines moved', sl.shifted.length, 'median', sh[sh.length >> 1], 'max', sh[sh.length - 1],
    '> 5 m', sh.filter((v) => v > 5).length, '> 10 m', sh.filter((v) => v > 10).length,
    '| already compliant', sl.compliant, '| left (queue < 5.5 m)', sl.tooShort.length, '| left (uneven lanes)', sl.uneven.length);
}
