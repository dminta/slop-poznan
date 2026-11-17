// Audit rendered signal heads, pedestrian heads, and poles belonging to disabled signal plans.
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
    apply: () => inert(),
    construct: () => inert()
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
const gridModule = loadModule(
  source('city-grid') + '\nexport function snapshot() { return { pavedPlazaRects, parkTreeSites, parkLampSites, sidewalkBlocks }; }',
  { imports: { ...rendering, './city-config.js': config, './geodata.js': { GEO } }, globals }
);
const grid = gridModule.buildCityGrid(inert());
const liveGrid = { ...gridModule, ...gridModule.snapshot() };

const audit = { meshes: [] };
const streetSource = source('street-details')
  .replace(
    '  function addRuntimeSignalHeads(network, pedRoutes = null, supports = null, railLayout = null) {',
    '  Object.assign(audit, { signalArmPoles, vehicleHeadSites });\n' +
    '  function addRuntimeSignalHeads(network, pedRoutes = null, supports = null, railLayout = null) {'
  )
  .replace(
    '    const inst = new THREE.InstancedMesh(g, mat, matrices.length);',
    '    const inst = new THREE.InstancedMesh(g, mat, matrices.length);\n' +
    '    audit.meshes.push({ inst, g, attrs });'
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
const tramLayout = tramInfra.layoutTramInfrastructure(network, grid);
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

street.addRuntimeSignalHeads(network, pedRoutes, supports, railLayout);

const rootOf = (t) => {
  while (t && t.alias) t = t.alias;
  return t;
};

// Map each SIGNAL_PLAN index to its root plan, and count rendered lens instances (which carry signalIndex).
const totalPlans = config.SIGNAL_PLANS.length;
const disabledSet = new Set(config.SIGNAL_PLANS.filter((p) => p.disabled));

// Count rendered S-1 and pedestrian heads by signalIndex attribute from live instanced meshes.
const totalRenderedDisabledHeads = audit.meshes.reduce((acc, m) => {
  const idxData = m.attrs?.signalIndex?.data;
  if (!idxData) return acc;
  const count = typeof m.inst.count === 'number' ? m.inst.count : idxData.length;
  let hits = 0;
  for (let i = 0; i < count; i++) {
    const plan = rootOf(config.SIGNAL_PLANS[Math.round(idxData[i] * totalPlans - 0.5)]);
    if (disabledSet.has(plan)) hits++;
  }
  return acc + hits;
}, 0);

const poleByPlan = new Map();
const s1SitesByPlan = new Map();
for (const h of audit.vehicleHeadSites) {
  const plan = rootOf(h.site.timing);
  if (disabledSet.has(plan)) s1SitesByPlan.set(plan.index, (s1SitesByPlan.get(plan.index) || 0) + 1);
}
for (const r of audit.signalArmPoles.values()) {
  const plan = rootOf(r.site.timing);
  if (disabledSet.has(plan)) poleByPlan.set(plan.index, (poleByPlan.get(plan.index) || 0) + r.poles.length);
}

const rows = [];
for (const p of disabledSet) {
  const sites = config.SIGNAL_SITES.filter((s) => rootOf(s.timing) === p);
  const s1 = s1SitesByPlan.get(p.index) || 0;
  const poles = poleByPlan.get(p.index) || 0;
  rows.push({
    plan: p.index,
    pos: sites.map((s) => [+s.x.toFixed(1), +s.z.toFixed(1)]),
    s1Heads: s1,
    poles
  });
}

console.log(JSON.stringify({
  totalPlans,
  disabledPlans: disabledSet.size,
  disabledPlansWithPolesOrHeads: rows.filter((r) => r.s1Heads > 0 || r.poles > 0).length,
  totalRenderedDisabledLensOrPanelInstances: totalRenderedDisabledHeads,
  totalDisabledS1Sites: Array.from(s1SitesByPlan.values()).reduce((a, b) => a + b, 0),
  totalDisabledPoles: Array.from(poleByPlan.values()).reduce((a, b) => a + b, 0),
  plans: rows
}, null, 2));
