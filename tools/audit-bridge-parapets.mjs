// Headless audit: every bridge member that stands on the street (parapet railings, kerbs and copings, overpass
// balustrade panels, lamp posts, arch hangers) and every parapet collider, against the 3.6 m car lane envelopes of the
// painted road network (straight lanes and junction turning curves). The ul. Bolesława Krzywoustego report
// (2026-11-15) was a balustrade with lamps running diagonally across both carriageways at (1780-1900, 1760-1830).
//
//   node tools/audit-bridge-parapets.mjs [--before <rev>] [--boot] [--json] [--top N] [--name <substring>]
//
// --before loads js/bridges.js from a git revision (e.g. 84a1443, the pre-fix structure) against the current geodata
// and network, so the count can be recorded. The lanes are those of buildRoadNetwork([], []) (no curbs or furniture to
// drop or move a lane, ~3 s); --boot builds the boot network instead (blocks, city grid and street details, ~9 s),
// which measured the same overlaps on 2026-11-15. Exits 1 when anything overlaps a lane.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { auditBridgeParapets } = require('../tests/helpers/bridge-parapets.cjs');
const { loadModule } = require('../tests/helpers/module.cjs');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args[i + 1];
};
const jsonMode = args.includes('--json');
const before = opt('before', null);
const top = Number(opt('top', 20));
const nameFilter = opt('name', null);

// The network main.js boots with: street-details.js builds it over the city grid's sidewalks and its own furniture
async function bootNetwork() {
  const js = (f) => readFileSync(join(root, 'js', f), 'utf8');
  function inert() {
    const store = {};
    return new Proxy(function () {}, {
      get(_t, key) {
        if (key === Symbol.iterator) return function* () {};
        if (key === Symbol.toPrimitive) return () => 0;
        if (key === 'then') return undefined;
        if (key === 'length') return 0;
        return key in store ? store[key] : (store[key] = inert());
      },
      set(_t, key, value) { store[key] = value; return true; },
      apply: () => inert(),
      construct: () => inert()
    });
  }
  const quiet = { info() {}, log() {}, warn() {}, error() {} };
  const G = {
    Math, Object, Array, Set, Map, WeakMap, Number, Infinity, NaN, JSON, Symbol,
    Float32Array, Uint8Array, Uint16Array, Uint32Array, Int32Array, Int8Array, Int16Array, Float64Array, Uint8ClampedArray,
    Promise, String, Error, Boolean, Date, RegExp, TypeError, isFinite, parseFloat, parseInt, Reflect, Proxy,
    console: quiet, performance, document: inert()
  };
  const config = await import(pathToFileURL(join(root, 'js/city-config.js')).href);
  const { GEO } = await import(pathToFileURL(join(root, 'js/geodata.js')).href);
  const satellites = await import(pathToFileURL(join(root, 'js/satellite-sites.js')).href);
  const three = { 'three/webgpu': inert(), 'three/tsl': inert(), 'three/addons/utils/BufferGeometryUtils.js': inert() };
  const blocksMod = loadModule(js('buildings.js'), {
    imports: {
      ...three, './balconies.js': inert(), './roofs.js': inert(), './tsl-materials.js': inert(),
      './city-config.js': config, './geodata.js': { GEO },
      './city-grid.js': { pavedPlazaRects: [], parkTreeSites: [], railClearance: () => 100, railRectClear: () => true, sidewalkBlocks: [] }
    },
    globals: G, filename: 'buildings.js'
  });
  const cityBlocks = blocksMod.buildCityBlocks(inert());
  const gridMod = loadModule(
    js('city-grid.js') + '\nexport function snapshot() { return { pavedPlazaRects, parkTreeSites, parkLampSites, sidewalkBlocks }; }',
    { imports: { ...three, './city-config.js': config, './geodata.js': { GEO }, './tsl-materials.js': inert(), './trees.js': { SPECIES_CROWN_R: config.SPECIES_CROWN_R } }, globals: G, filename: 'city-grid.js' }
  );
  const cityGrid = gridMod.buildCityGrid(inert(), { buildingFootprints: cityBlocks.footprintsByBlock, buildingColliders: cityBlocks.colliders });
  const gridSnap = gridMod.snapshot();
  const rnMod = loadModule(js('road-network.js'), { imports: { './city-config.js': config, './geodata.js': { GEO } }, globals: G, filename: 'road-network.js' });
  const tramInfraMod = loadModule(js('tram-infra.js'), {
    imports: { ...three, './geodata.js': { GEO }, './city-config.js': config, './tsl-materials.js': inert() }, globals: G, filename: 'tram-infra.js'
  });
  const sdMod = loadModule(js('street-details.js'), {
    imports: {
      ...three, './city-config.js': config, './road-network.js': rnMod, './tsl-materials.js': inert(),
      './satellite-sites.js': satellites,
      './trees.js': { SPECIES_CROWN_R: config.SPECIES_CROWN_R, createTreeField: () => ({ group: inert() }) },
      './city-grid.js': { pavedPlazaRects: gridSnap.pavedPlazaRects, parkTreeSites: gridSnap.parkTreeSites, parkLampSites: gridSnap.parkLampSites, clearOfRails: gridMod.clearOfRails }
    },
    globals: G, filename: 'street-details.js'
  });
  const streetDetails = sdMod.buildStreetDetails(inert(), { buildingColliders: cityBlocks.colliders, grid: cityGrid, layoutTramInfrastructure: tramInfraMod.layoutTramInfrastructure });
  return streetDetails.roadNetwork;
}

const bridgesSource = before
  ? execFileSync('git', ['show', `${before}:js/bridges.js`], { cwd: root, encoding: 'utf8' })
  : null;
const t0 = performance.now();
const network = args.includes('--boot') ? await bootNetwork() : null;
const result = auditBridgeParapets({ root, bridgesSource, network });
const ms = performance.now() - t0;
const rows = nameFilter ? result.rows.filter((r) => (r.name || '').includes(nameFilter)) : result.rows;
const tally = (list) => list.reduce((t, r) => ((t[r.type] = (t[r.type] || 0) + 1), t), {});
const summary = {
  label: before ? `before (${before})` : 'current',
  structures: result.structures.length,
  members: result.counts,
  colliders: result.colliders,
  overlaps: rows.length,
  overlapsByType: tally(rows),
  krzywoustego: tally(result.rows.filter((r) => /Krzywoustego/.test(r.name || ''))),
  colliderOverlaps: result.colliderRows.length,
  byBridge: result.byBridge,
  membersByBridge: result.membersByBridge,
  rows: rows.slice(0, top),
  colliderRows: result.colliderRows.slice(0, top),
  ms: Math.round(ms)
};
if (jsonMode) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`=== Bridge parapets / lamps vs car lanes (${summary.label}) ===`);
  console.log(`${summary.structures} structures; members ${JSON.stringify(summary.members)}; ${summary.colliders} colliders`);
  console.log(`${summary.overlaps} members overlap a lane envelope ${JSON.stringify(summary.overlapsByType)}; ` +
    `Krzywoustego ${JSON.stringify(summary.krzywoustego)}; ${summary.colliderOverlaps} colliders overlap`);
  for (const [name, b] of Object.entries(summary.byBridge)) {
    console.log(`  ${name}: parapet ${b.parapet}, panel ${b.panel}, lamp ${b.lamp}, structure ${b.structure}, ` +
      `max ${b.maxDepth.toFixed(2)} m`);
  }
  console.log('Worst members:');
  for (const r of summary.rows) {
    console.log(`  ${r.depth.toFixed(2)} m  ${r.type.padEnd(9)} ${r.name} (${r.x}, ${r.z}) over ${r.length} m` +
      `${r.curve ? ' [turn curve]' : ''}`);
  }
  if (summary.colliderRows.length) console.log('Worst colliders:');
  for (const r of summary.colliderRows) console.log(`  ${r.depth.toFixed(2)} m  (${r.x}, ${r.z})`);
  console.log(`(${summary.ms} ms)`);
}
if (rows.length || result.colliderRows.length) process.exitCode = 1;
