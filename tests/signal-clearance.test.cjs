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

test('all furnished regular crossings clear the last WALK entrant at their design speed before conflicting green', async () => {
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
    const speed = timing.walkSpeed || 1;
    const group = c.group === 0 ? 1 : 0;
    const start = group === 0 ? 0 : timing.start1;
    const nextGreen = group === 0 ? timing.start1 : timing.cycle;
    assert.ok(start + 7 + width / speed <= nextGreen,
      `(${c.node.x}, ${c.node.z}) ${width.toFixed(1)} m crossing at ${speed} m/s has ${nextGreen - start - 7} s clearance`);
    assert.equal(config.walkSignal(timing.offset + start + 6.99, group === 0, timing), true);
    assert.notEqual(config.signalPhase(timing.offset + start + 6.99 + width / speed, group !== 0, timing), 'green');
    assert.ok(timing.green0 >= 10 && timing.green1 >= 10 && timing.cycle <= 90);
    checked++;
  }
  // The one 1.2 m/s plan: the 37.8 m span over Kaponiera's tram corridor. At 1 m/s its 40 s pedestrian stage left
  // the 10 m give-way link only 10 s (seed 2 held 10 cars over 120 s); 1.2 m/s clears the last WALK entrant in 32 s
  // (green0 - 2) and gives the link 16 s. Pin the split, start1 and the corridor offset plus its accepted local shift.
  const kaponiera = first.pedRoutes.crosswalks.filter((c) => Math.hypot(c.node.x + 1503.3, c.node.z - 224) < 1);
  assert.equal(kaponiera.length, 1, 'one crossing at Kaponiera (-1503, 224)');
  const wide = Math.max(...kaponiera[0].tracks.map((t) => t.len - 3.2));
  assert.ok(wide > 37 && wide < 39, `${wide.toFixed(2)} m span`);
  const kap = kaponiera[0].node.signalTiming;
  assert.equal(kap.walkSpeed, 1.2);
  assert.deepEqual([kap.cycle, kap.green0, kap.green1, kap.start1], [60, 34, 16, 39]);
  assert.ok(Math.abs(kap.offset - 39.6998) < 0.01);
  const east = first.network.nodes.find((n) => Math.hypot(n.x + 1135.54, n.z - 127.34) < 1).signalTiming;
  assert.deepEqual([east.cycle, east.green0, east.green1, east.start1], [65, 18, 37, 23]);
  assert.ok(Math.abs(east.offset - 29.9248) < 0.01);
  assert.ok(7 + wide / 1.2 <= kap.start1, 'the 1.2 m/s walk clears before group 1 gets green');
  assert.ok(config.SIGNAL_PLANS.filter((p) => p.walkSpeed > 1).length === 1,
    'the faster design speed is limited to the one exceptional span');
  // Requiring rail-safe curb queues removes crossings whose former waiting positions overlapped a tram body.
  // The furnished benchmark now retains 490 regular signal crossings; keep a floor without retaining unsafe ones.
  assert.ok(checked > 480, `${checked} furnished crossings checked`);
  const marcin = config.SIGNAL_PLANS.filter((p) => p.corridor === 'Święty Marcin' && !p.pedestrian);
  assert.ok(marcin.length >= 2 && marcin.every((p) => p.cycle === 65));
  for (const p of config.SIGNAL_PLANS) {
    if (p.pedestrian || p.disabled || !Number.isFinite(p.distance)) continue;
    const shift = p === kap || p === east ? 12 : 0;
    const phaseTime = ((p.distance / (40 / 3.6) + shift - p.offset) % p.cycle + p.cycle) % p.cycle;
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

test('Kaponiera site offsets shift only the two measured plans and survive graph rebuilds', async () => {
  const { GEO } = await import('../js/geodata.js');
  const source = read('city-config.js');
  const table = source.match(/const SIGNAL_OFFSET_OVERRIDES = \[[^]*?\n\];/);
  assert.ok(table, 'the measured exceptions remain an explicit per-site table');
  const load = (text) => loadModule(text, { imports: { './geodata.js': { GEO } } });
  const config = load(source);
  const control = load(source.replace(table[0], 'const SIGNAL_OFFSET_OVERRIDES = [];'));
  furnished(config, GEO);
  furnished(control, GEO);
  const overrides = new Map();
  for (const [x, z, offset] of [[-1134.8, 118.4, 12], [-1496.1, 232.3, 12]]) {
    const site = config.SIGNAL_SITES.find((s) => Math.hypot(s.x - x, s.z - z) <= 2);
    assert.ok(site, `signal site (${x}, ${z}) exists`);
    overrides.set(site.timing.index, offset);
  }
  assert.equal(overrides.size, 2);
  const plain = (p) => JSON.parse(JSON.stringify(p));
  assert.equal(config.SIGNAL_PLANS.length, control.SIGNAL_PLANS.length);
  for (const p of config.SIGNAL_PLANS) {
    const before = plain(control.SIGNAL_PLANS[p.index]);
    const after = plain(p);
    const seconds = overrides.get(p.index);
    if (seconds !== undefined) {
      assert.equal(p.offset, (before.offset + seconds) % p.cycle);
      after.offset = before.offset;
    }
    assert.deepEqual(after, before, `plan ${p.index}: only the two local offsets may change`);
  }
  // Furniture can leave stale cached display states until the next signal update; compare the rebuilt schedule.
  const schedules = () => config.SIGNAL_PLANS.map((p) =>
    [p.cycle, p.green0, p.start1, p.green1, p.offset, p.distance, p.walkSpeed, p.disabled]);
  const initial = schedules();
  furnished(config, GEO);
  assert.deepEqual(schedules(), initial, 'local shifts never accumulate on rebuild');
});
