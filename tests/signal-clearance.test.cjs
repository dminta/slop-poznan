const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { loadModule } = require('./helpers/module.cjs');

const read = (file) => readFileSync(join(__dirname, '../js', file), 'utf8');
function inert() {
  const values = {};
  return new Proxy(function () {}, {
    get(_t, key) {
      if (key === Symbol.iterator) return function* () {};
      if (key === Symbol.toPrimitive) return () => 0;
      if (key === 'then') return undefined;
      if (key === 'length') return 0;
      return key in values ? values[key] : (values[key] = inert());
    },
    set(_t, key, value) { values[key] = value; return true; },
    apply: () => inert(), construct: () => inert()
  });
}

function furnished(config, GEO) {
  const rn = loadModule(read('road-network.js'), {
    imports: { './city-config.js': config, './geodata.js': { GEO } }, globals: { console: { info() {} } }
  });
  const three = { 'three/webgpu': inert(), 'three/tsl': inert(), 'three/addons/utils/BufferGeometryUtils.js': inert() };
  const { clearOfRails, railClearance } = loadModule(read('city-grid.js'), {
    imports: { ...three, './city-config.js': config, './geodata.js': { GEO }, './tsl-materials.js': inert() }
  });
  const { buildStreetDetails } = loadModule(read('street-details.js'), {
    imports: {
      ...three, './city-config.js': config, './road-network.js': rn, './tsl-materials.js': inert(),
      './trees.js': { createTreeField: () => ({ group: inert() }) },
      './city-grid.js': { clearOfRails, pavedPlazaRects: [], parkTreeSites: [], parkLampSites: [] }
    }, globals: { document: inert(), console: { info() {} } }
  });
  const details = buildStreetDetails(inert());
  const network = rn.buildRoadNetwork([], details.footprints);
  const { createPedestrianRoutes } = loadModule(read('pedestrian-routes.js'), { imports: { './road-network.js': rn } });
  const pedRoutes = createPedestrianRoutes(network, config.blockAt, railClearance);
  const configure = read('traffic.js').match(/  function configureSignals\([^]*?\n  \}/)[0];
  vm.runInNewContext(`(${configure})`, {
    nodes: network.nodes, pedRoutes, KERB: 1.6, signalNodes: [],
    configurePedestrianSignal: config.configurePedestrianSignal,
    configureSignalClearance: config.configureSignalClearance
  })();
  return { network, pedRoutes, details };
}

test('all furnished regular crossings clear the last WALK entrant at 1 m/s before conflicting green', async () => {
  const config = await import('../js/city-config.js');
  const { GEO } = await import('../js/geodata.js');
  config.resetSignalPlans();
  const first = furnished(config, GEO);
  const disabled = first.network.nodes.filter((n) => n.signalTiming?.disabled);
  assert.ok(disabled.length > 0);
  for (const n of disabled) {
    assert.equal(n.signal, false);
    assert.equal(n.paintNode.signal, false, 'a disabled crossing leaves no signal-only stop lines in the paint graph');
  }
  let checked = 0;
  for (const c of first.pedRoutes.crosswalks) {
    const timing = c.node.signalTiming;
    if (!c.node.signal || timing.pedestrian) continue;
    const width = Math.max(...c.tracks.map((t) => t.len - 3.2));
    const group = c.group === 0 ? 1 : 0;
    const start = group === 0 ? 0 : timing.start1;
    const nextGreen = group === 0 ? timing.start1 : timing.cycle;
    assert.ok(start + 7 + width <= nextGreen,
      `(${c.node.x}, ${c.node.z}) ${width.toFixed(1)} m crossing has ${nextGreen - start - 7} s clearance`);
    assert.equal(config.walkSignal(timing.offset + start + 6.99, group === 0, timing), true);
    assert.notEqual(config.signalPhase(timing.offset + start + 6.99 + width, group !== 0, timing), 'green');
    assert.ok(timing.green0 >= 10 && timing.green1 >= 10 && timing.cycle <= 90);
    checked++;
  }
  // Requiring rail-safe curb queues removes crossings whose former waiting positions overlapped a tram body.
  // The furnished benchmark now retains 490 regular signal crossings; keep a floor without retaining unsafe ones.
  assert.ok(checked > 480, `${checked} furnished crossings checked`);
  const marcin = config.SIGNAL_PLANS.filter((p) => p.corridor === 'Święty Marcin' && !p.pedestrian);
  assert.ok(marcin.length >= 2 && marcin.every((p) => p.cycle === 65));
  for (const p of config.SIGNAL_PLANS) {
    if (p.pedestrian || p.disabled || !Number.isFinite(p.distance)) continue;
    const phaseTime = ((p.distance / (40 / 3.6) - p.offset) % p.cycle + p.cycle) % p.cycle;
    assert.ok(Math.abs(phaseTime - (p.corridorGroup === 0 ? 0 : p.start1)) < 1e-8 || Math.abs(phaseTime - p.cycle) < 1e-8);
  }
  const plans = () => config.SIGNAL_PLANS.map((p) => [p.cycle, p.green0, p.green1, p.offset, p.disabled]);
  const initial = plans();
  const second = furnished(config, GEO);
  assert.equal(second.details.footprints.length, first.details.footprints.length,
    'disabled heads retain identical static furniture on the next rebuild');
  assert.equal(second.details.audioSignals.length, first.details.audioSignals.length);
  assert.equal(second.network.edges.length, first.network.edges.length);
  assert.deepEqual(plans(), initial, 'width and demand adjustments never accumulate between graph builds');
});
