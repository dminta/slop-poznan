// Compare bare and furnished road graphs: list every dropped edge by cause, km lost, and disabled signal plans.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { loadModule } = require('../tests/helpers/module.cjs');
const source = (name) => readFileSync(join(root, 'js', name + '.js'), 'utf8');
const satellites = await import('../js/satellite-sites.js');

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

// Build city grid and street details for the furnished network.
const gridModule = loadModule(
  source('city-grid') + '\nexport function snapshot() { return { pavedPlazaRects, parkTreeSites, parkLampSites, sidewalkBlocks }; }',
  { imports: { ...rendering, './city-config.js': config, './geodata.js': { GEO } }, globals }
);
const grid = gridModule.buildCityGrid(inert());
const liveGrid = { ...gridModule, ...gridModule.snapshot() };

const roadForStreet = loadModule(source('road-network'), {
  imports: { './city-config.js': config, './geodata.js': { GEO } },
  globals
});
const street = loadModule(source('street-details'), {
  imports: {
    ...rendering,
    './city-config.js': config,
    './road-network.js': roadForStreet,
    './city-grid.js': liveGrid,
    './satellite-sites.js': satellites,
    './trees.js': { createTreeField: () => ({ group: inert() }) }
  },
  globals
}).buildStreetDetails(inert());

// Build a lookup from (midX, midZ) to the nearest GEO.roadGraph link street name.
const rgNodes = GEO.roadGraph.nodes;
const rgSegments = [];
for (const [a, b, ni, , , , inner] of GEO.roadGraph.links) {
  const name = GEO.roadGraph.names[ni] || '(unnamed)';
  const pts = [[rgNodes[a * 2], rgNodes[a * 2 + 1]]];
  for (let k = 0; k < inner.length; k += 2) pts.push([inner[k], inner[k + 1]]);
  pts.push([rgNodes[b * 2], rgNodes[b * 2 + 1]]);
  for (let k = 0; k + 1 < pts.length; k++) {
    rgSegments.push({ ax: pts[k][0], az: pts[k][1], bx: pts[k + 1][0], bz: pts[k + 1][1], name });
  }
}

function streetNameAt(x, z) {
  let bestD2 = Infinity;
  let bestName = '(unnamed)';
  for (const s of rgSegments) {
    const dx = s.bx - s.ax, dz = s.bz - s.az;
    const len2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / len2));
    const px = s.ax + dx * t - x, pz = s.az + dz * t - z;
    const d2 = px * px + pz * pz;
    if (d2 < bestD2) {
      bestD2 = d2;
      bestName = s.name;
    }
  }
  return bestName;
}

function edgeKey(e) {
  const x1 = e.x0 + e.dx * e.span;
  const z1 = e.z0 + e.dz * e.span;
  return `${Math.round(e.x0 * 10)},${Math.round(e.z0 * 10)}->${Math.round(x1 * 10)},${Math.round(z1 * 10)}`;
}

// Instrument road-network.js to record why edges are pruned.
function runInstrumented(sidewalks, obstacles) {
  const diag = {
    noOpenLane: new Map(),
    deduped: new Set(),
    tooShort: new Map(),
    noMovesOut: new Map(),
    inTheWayOut: new Set(),
    sccDropped: new Map(),
    blockedReasons: new Map()
  };

  let src = source('road-network');
  src = src.replace(
    '  const blockedOnStreet = (x, z, clear, curbClear = 0.3) => !onLand(x - clear, x + clear, z - clear, z + clear) ||\n' +
    '    curbs(x - curbClear, x + curbClear, z - curbClear, z + curbClear, 1) ||\n' +
    '    nearOutline(x, z, clear) ||\n' +
    '    blocked(x - clear, x + clear, z - clear, z + clear, 2);',
    '  let _lastBlockReason = null;\n' +
    '  const blockedOnStreet = (x, z, clear, curbClear = 0.3) => {\n' +
    '    if (!onLand(x - clear, x + clear, z - clear, z + clear)) { _lastBlockReason = "water/offLand"; return true; }\n' +
    '    if (curbs(x - curbClear, x + curbClear, z - curbClear, z + curbClear, 1)) { _lastBlockReason = "curb(sidewalk/curb-rect)"; return true; }\n' +
    '    if (nearOutline(x, z, clear)) { _lastBlockReason = "medianOutline"; return true; }\n' +
    '    if (blocked(x - clear, x + clear, z - clear, z + clear, 2)) { _lastBlockReason = "footprintObstacle"; return true; }\n' +
    '    return false;\n' +
    '  };'
  );
  src = src.replace(
    '    const open = lanes.filter((o) => laneOpen(x0, z0, dx, dz, span, o));\n' +
    '    if (!open.length) return;',
    '    const laneReasons = new Set();\n' +
    '    const open = lanes.filter((o) => { const ok = laneOpen(x0, z0, dx, dz, span, o); if (!ok && _lastBlockReason) laneReasons.add(_lastBlockReason); return ok; });\n' +
    '    if (!open.length) {\n' +
    '      const k = `${Math.round(x0 * 10)},${Math.round(z0 * 10)}->${Math.round(p1.x * 10)},${Math.round(p1.z * 10)}`;\n' +
    '      diag.noOpenLane.set(k, [...laneReasons].join("+") || "unknown");\n' +
    '      return;\n' +
    '    }'
  );
  src = src.replace(
    '  edges = edges.filter((e) => e.len > 4);',
    '  for (const e of edges) if (e.len <= 4) diag.tooShort.set(edgeKey(e), e.len);\n' +
    '  edges = edges.filter((e) => e.len > 4);'
  );
  src = src.replace(
    '    serveEveryLane(e);\n  }',
    '    const hadMoves = e.moves.length > 0;\n' +
    '    const moveReasons = new Set();\n' +
    '    const prevReason = _lastBlockReason;\n' +
    '    serveEveryLane(e);\n' +
    '    if (!e.moves.length) {\n' +
    '      diag.noMovesOut.set(edgeKey(e), hadMoves ? (_lastBlockReason || prevReason || "pathClear/order") : "noOutgoingCandidate");\n' +
    '    }\n  }'
  );
  src = src.replace(
    '  if (inTheWayOut.size) {',
    '  for (const e of inTheWayOut) diag.inTheWayOut.add(edgeKey(e));\n' +
    '  if (inTheWayOut.size) {'
  );
  src = src.replace(
    '  const longEnough = edges.length;\n' +
    '  edges = edges.filter((e) => comp[e.id] === bestComp);',
    '  const longEnough = edges.length;\n' +
    '  for (const e of edges) if (comp[e.id] !== bestComp) diag.sccDropped.set(edgeKey(e), { hasMoves: e.moves.length > 0 });\n' +
    '  edges = edges.filter((e) => comp[e.id] === bestComp);'
  );

  const edgeKeyHelper = `function edgeKey(e) { const x1 = e.x0 + e.dx * e.span; const z1 = e.z0 + e.dz * e.span; return \`\${Math.round(e.x0 * 10)},\${Math.round(e.z0 * 10)}->\${Math.round(x1 * 10)},\${Math.round(z1 * 10)}\`; }\n`;
  const roadMod = loadModule(edgeKeyHelper + src, {
    imports: { './city-config.js': config, './geodata.js': { GEO } },
    globals: { ...globals, diag }
  });
  const network = roadMod.buildRoadNetwork(sidewalks, obstacles);
  return { roadMod, network, diag };
}

function runSignals(roadMod, network) {
  const { createPedestrianRoutes } = loadModule(source('pedestrian-routes'), {
    imports: { './road-network.js': roadMod },
    globals
  });
  const pedRoutes = createPedestrianRoutes(network, config.blockAt, gridModule.railClearance);
  const configure = source('traffic').match(/  function configureSignals\([^]*?\n  \}/)[0];
  vm.runInNewContext(`(${configure})`, {
    nodes: network.nodes,
    pedRoutes,
    KERB: 1.6,
    signalNodes: [],
    configurePedestrianSignal: config.configurePedestrianSignal,
    configureSignalClearance: config.configureSignalClearance
  })();
  const disabledPlans = new Set();
  for (let i = 0; i < config.SIGNAL_PLANS.length; i++) {
    const p = config.SIGNAL_PLANS[i];
    if (p.disabled) disabledPlans.add(i);
  }
  return disabledPlans;
}

config.resetSignalPlans();
const bare = runInstrumented([], []);
const bareDisabled = runSignals(bare.roadMod, bare.network);

config.resetSignalPlans();
const furnished = runInstrumented(grid.sidewalks, [...grid.footprints, ...street.footprints]);
const furnishedDisabled = runSignals(furnished.roadMod, furnished.network);

const furnishedKeys = new Set(furnished.network.edges.map(edgeKey));
const droppedEdges = [];
for (const e of bare.network.edges) {
  const k = edgeKey(e);
  if (furnishedKeys.has(k)) continue;
  const mx = e.x0 + e.dx * e.span * 0.5;
  const mz = e.z0 + e.dz * e.span * 0.5;
  const name = streetNameAt(mx, mz);
  let cause = 'other';
  let detail = '';
  if (furnished.diag.noOpenLane.has(k)) {
    cause = 'sidewalk/footprint lane pruning';
    detail = furnished.diag.noOpenLane.get(k);
  } else if (furnished.diag.tooShort.has(k)) {
    cause = 'too short after setback';
    detail = `${furnished.diag.tooShort.get(k).toFixed(1)} m`;
  } else if (furnished.diag.inTheWayOut.has(k)) {
    cause = 'squeezed inTheWayOut';
  } else if (furnished.diag.noMovesOut.has(k)) {
    cause = 'SCC (no clear outgoing moves)';
    detail = furnished.diag.noMovesOut.get(k);
  } else if (furnished.diag.sccDropped.has(k)) {
    cause = 'SCC (disconnected from largest component)';
  }
  droppedEdges.push({
    key: k,
    name,
    len: e.len,
    span: e.span,
    mx,
    mz,
    cause,
    detail
  });
}

// Group by cause
const byCause = new Map();
for (const d of droppedEdges) {
  if (!byCause.has(d.cause)) byCause.set(d.cause, []);
  byCause.get(d.cause).push(d);
}

console.log(`Bare network: ${bare.network.edges.length} edges, ${(bare.network.edges.reduce((s, e) => s + e.len, 0) / 1000).toFixed(3)} km`);
console.log(`Furnished network: ${furnished.network.edges.length} edges, ${(furnished.network.edges.reduce((s, e) => s + e.len, 0) / 1000).toFixed(3)} km`);
const totalLostM = droppedEdges.reduce((s, d) => s + d.len, 0);
console.log(`Dropped edges (in bare, missing in furnished): ${droppedEdges.length} edges, ${(totalLostM / 1000).toFixed(3)} km (${totalLostM.toFixed(1)} m)\n`);

for (const [cause, list] of [...byCause.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const km = list.reduce((s, d) => s + d.len, 0) / 1000;
  console.log(`=== ${cause}: ${list.length} edges, ${km.toFixed(3)} km ===`);
  for (const d of list.sort((a, b) => b.len - a.len)) {
    console.log(`  - ${d.name} | len=${d.len.toFixed(1)}m (span=${d.span.toFixed(1)}m) | (${d.mx.toFixed(1)}, ${d.mz.toFixed(1)}) | ${d.key}${d.detail ? ` [${d.detail}]` : ''}`);
  }
  console.log('');
}

const newlyDisabled = [...furnishedDisabled].filter((i) => !bareDisabled.has(i));
console.log(`Signal plans disabled: bare=${bareDisabled.size}, furnished=${furnishedDisabled.size}, newly disabled=${newlyDisabled.length}`);
for (const i of newlyDisabled) {
  const site = config.SIGNAL_SITES.find((s) => s.timing?.index === i);
  const pos = site ? `(${site.x.toFixed(1)}, ${site.z.toFixed(1)})` : '';
  const name = site ? streetNameAt(site.x, site.z) : '';
  const corridor = site?.timing?.corridor ? ` [corridor: ${site.timing.corridor}]` : '';
  console.log(`  - plan ${i}: ${name} ${pos}${corridor}`);
}
