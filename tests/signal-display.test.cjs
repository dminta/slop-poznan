const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

function inert() {
  const values = {};
  return new Proxy(function () {}, {
    get(_target, key) {
      if (key === Symbol.iterator) return function* () {};
      if (key === Symbol.toPrimitive) return () => 0;
      if (key === 'then') return undefined;
      if (key === 'length') return 0;
      return key in values ? values[key] : (values[key] = inert());
    },
    set(_target, key, value) { values[key] = value; return true; },
    apply: () => inert(),
    construct: () => inert()
  });
}

test('signal display uploads local plans and follows a pedestrian request after the heads have been built', async () => {
  const config = await import('../js/city-config.js');
  let display;
  const indices = [];
  const three = inert();
  three.DataTexture = function (data, width, height) {
    display = { image: { data, width, height }, needsUpdate: false };
    return display;
  };
  three.InstancedBufferAttribute = function (data, size) {
    if (size === 1) indices.push(data);
    return { array: data, itemSize: size };
  };
  const tsl = inert();
  tsl.uniform = (value) => { const u = inert(); u.value = value; return u; };
  const headGroups = [];
  const source = readFileSync(join(__dirname, '../js/street-details.js'), 'utf8');
  // Capture the production grouping decision before pole placement; no renderer is needed to compare a head's
  // actual phase with the lane approaching that same arm on the real Poznań graph.
  const marker = '      const half = a.w / 2;';
  assert.ok(source.includes(marker));
  const details = loadModule(source.replace(marker, '      headGroups.push({ site, arm: a, group0 });\n' + marker), {
    imports: {
      'three/webgpu': three, 'three/tsl': tsl, 'three/addons/utils/BufferGeometryUtils.js': inert(),
      './city-config.js': config,
      './road-network.js': { CROSSWALK: 4.3, CROSSWALK_REACH: 3, STOP_SETBACK: 1.75 },
      './tsl-materials.js': inert(), './trees.js': { createTreeField: () => ({ group: inert() }) },
      './city-grid.js': { clearOfRails: () => true, pavedPlazaRects: [], parkTreeSites: [], parkLampSites: [] }
    },
    globals: { document: inert(), console: { info() {} }, headGroups },
    filename: 'street-details.js'
  }).buildStreetDetails(inert());
  assert.equal(display.image.width, config.SIGNAL_PLANS.length);
  assert.equal(display.image.height, 1);
  assert.ok(indices.length >= 4, 'all vehicle and pedestrian lens groups carry a stable plan index');
  for (const data of indices) for (const u of data) {
    assert.ok(u > 0 && u < 1);
    assert.ok(Math.abs(u * config.SIGNAL_PLANS.length - 0.5 - Math.round(u * config.SIGNAL_PLANS.length - 0.5)) < 0.0001);
  }
  assert.ok(details.audioSignals.length > 100);
  assert.ok(details.audioSignals.every((s) => config.SIGNAL_PLANS.includes(s.signalTiming)));
  const { GEO } = await import('../js/geodata.js');
  const network = loadModule(readFileSync(join(__dirname, '../js/road-network.js'), 'utf8'), {
    imports: { './city-config.js': config, './geodata.js': { GEO } },
    globals: { console: { info() {} } }, filename: 'road-network.js'
  }).buildRoadNetwork([], []);
  let checked = 0;
  for (const head of headGroups) {
    if (!head.arm.inbound) continue;
    let node = null, distance = 12;
    for (const n of network.nodes) {
      const d = Math.hypot(n.x - head.site.x, n.z - head.site.z);
      if (n.signal && d < distance) { node = n; distance = d; }
    }
    if (!node || node.signalTiming.pedestrian) continue;
    const approach = node.in.find((e) => e.inArm.ux * head.arm.ux + e.inArm.uz * head.arm.uz > 0.98);
    if (!approach) continue;
    for (const time of [0, 10, 20, 30, 40, 50, 60, 70]) {
      assert.equal(config.signalPhase(time, head.group0, head.site),
        config.signalPhase(time, approach.axisIndex === 0, node),
        `${head.arm.name} at (${head.site.x}, ${head.site.z}) shows the approaching lane's phase`);
    }
    checked++;
  }
  assert.ok(checked > 400, `${checked} real approaches checked`);
  const plan = config.SIGNAL_PLANS[0];
  // The furnished network can lose an OSM arm after the heads were built.
  plan.pedestrian = true;
  config.configurePedestrianSignal({ signalTiming: plan }, true, 12);
  config.requestWalkSignal(20, plan);
  const codes = { off: 0, green: 1, amber: 2, red: 3, redAmber: 4 };
  for (const time of [20, plan.start, plan.start + 5, plan.start + 12, plan.start + plan.duration]) {
    details.signalClock.value = time;
    display.needsUpdate = false;
    details.update(null);
    const state = config.updateSignal(time, plan);
    assert.deepEqual(Array.from(display.image.data.slice(plan.index * 4, plan.index * 4 + 4)),
      [codes[state.phase0], codes[state.phase1], state.displayWalk0, state.displayWalk1]);
    assert.ok(display.needsUpdate, 'a changed signal updates even without a camera or street lighting');
  }
});

test('crossing audio follows the local steady and flashing green and skips disabled signals', async () => {
  const config = await import('../js/city-config.js');
  const { CityAudioSources } = loadModule(readFileSync(join(__dirname, '../js/audio-sources.js'), 'utf8'), {
    imports: { './city-config.js': config }, filename: 'audio-sources.js'
  });
  const timing = { ...config.SIGNAL_TIMING, offset: 20, time: NaN };
  const site = { x: 0, y: 2, z: 0, isAvenue: true, signalTiming: timing };
  const sources = new CityAudioSources({
    controllerManager: { entities: {}, keys: {}, getActiveEntity: () => ({ type: 'car', speed: 0 }) },
    trafficSystem: { cars: [], buses: [], peds: [] }, streetDetails: { audioSignals: [site] }
  });
  const listener = { x: 0, y: 2, z: 0 };
  for (const [time, green] of [[19, false], [20, true], [27, true], [30, false]]) {
    const snapshot = sources.collect(listener, time);
    assert.equal(snapshot.signals.length, 1);
    assert.equal(snapshot.signals[0].walk, green, `local time ${time - timing.offset}`);
  }
  timing.disabled = true;
  timing.time = NaN;
  assert.equal(sources.collect(listener, 31).signals.length, 0);
  site.signalTiming = { ...config.SIGNAL_TIMING, alias: timing, mainUx: 0, mainUz: 1 };
  const aliasState = config.updateSignal(32, site);
  assert.equal(aliasState.disabled, true, 'a head on an aliased plan also goes dark');
  assert.equal(aliasState.phase0, 'off');
  assert.equal(sources.collect(listener, 32).signals.length, 0, 'an aliased disabled pole makes no locator ticks');
});
