const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const read = (path) => readFileSync(join(__dirname, '..', path), 'utf8');
let SIGNAL_SITES, GEO;
test.before(async () => {
  ({ SIGNAL_SITES } = await import('../js/city-config.js'));
  ({ GEO } = await import('../js/geodata.js'));
});

test('signal sites are the road graph\'s signalled junctions, with an arm width per axis', () => {
  const { nodes, signals } = GEO.roadGraph;
  assert.ok(signals.length > 100);
  assert.equal(SIGNAL_SITES.length, signals.length);
  signals.forEach((n, i) => {
    const site = SIGNAL_SITES[i];
    assert.deepEqual([site.x, site.z], [nodes[n * 2], nodes[n * 2 + 1]]);
    assert.ok(site.nsWidth > 0 || site.ewWidth > 0, 'every junction has at least one arm');
  });
});

test('the road network and the signal heads both read the signal sites', () => {
  // street details are built before the network, so both read the shared list instead of looping the grid each
  for (const path of ['js/road-network.js', 'js/street-details.js']) {
    assert.match(read(path), /for \(const site of SIGNAL_SITES\)/, path);
  }
});

test('each group runs green, amber, red, then red and amber together before green again (Polish S-1)', async () => {
  const { signalPhase, walkSignal, SIGNAL_TIMING } = await import('../js/city-config.js');
  const sequence = (isAvenue) => {
    const phases = [];
    for (let t = 0; t < 2 * SIGNAL_TIMING.cycle; t += 0.25) {
      const p = signalPhase(t, isAvenue);
      if (phases.at(-1) !== p) phases.push(p);
    }
    return phases;
  };
  for (const isAvenue of [true, false]) {
    const phases = sequence(isAvenue);
    for (let i = 1; i < phases.length; i++) {
      const next = { green: 'amber', amber: 'red', red: 'redAmber', redAmber: 'green' }[phases[i - 1]];
      assert.equal(phases[i], next, `${isAvenue ? 'group 0' : 'group 1'}: ${phases.join(' ')}`);
    }
    assert.ok(phases.includes('redAmber'));
  }
  // never both groups moving at once, and no WALK during red+amber
  for (let t = 0; t < SIGNAL_TIMING.cycle; t += 0.25) {
    const [a, b] = [signalPhase(t, true), signalPhase(t, false)];
    assert.ok(a === 'red' || a === 'redAmber' || b === 'red' || b === 'redAmber', `t ${t}: ${a} / ${b}`);
    for (const isAvenue of [true, false]) {
      if (signalPhase(t, isAvenue) === 'redAmber') assert.equal(walkSignal(t, isAvenue), false, `t ${t}`);
    }
  }
});

test('every junction plan has safe clearance, seven seconds of WALK and independent timing', async () => {
  const { SIGNAL_PLANS, updateSignal } = await import('../js/city-config.js');
  assert.ok(SIGNAL_PLANS.length > 100);
  assert.equal(new Set(SIGNAL_PLANS.map((p) => p.index)).size, SIGNAL_PLANS.length);
  assert.ok(new Set(SIGNAL_PLANS.map((p) => p.offset)).size > 100);
  assert.ok(new Set(SIGNAL_PLANS.map((p) => p.green0)).size > 3);
  for (const plan of SIGNAL_PLANS) {
    assert.ok(plan.cycle >= 40 && plan.cycle <= 90);
    assert.ok(plan.green0 >= 10 && plan.green1 >= 10);
    // Use a copy: evaluation caches must not carry test time into a live simulation.
    const p = { ...plan, pedestrian: false, disabled: false, time: NaN };
    let walk0 = 0, walk1 = 0;
    for (let q = 0; q < p.cycle; q += 0.25) {
      const state = updateSignal(q + p.offset, p);
      assert.ok(!(state.phase0 === 'green' && state.phase1 === 'green'));
      if (state.walk0) { walk0 += 0.25; assert.equal(state.phase0, 'green'); }
      if (state.walk1) { walk1 += 0.25; assert.equal(state.phase1, 'green'); }
    }
    assert.equal(walk0, 7);
    assert.equal(walk1, 7);
    assert.equal(updateSignal(p.offset + p.green0 + 2.5, p).phase0, 'amber');
    assert.equal(updateSignal(p.offset + p.green0 + 3.5, p).phase0, 'red');
    assert.equal(updateSignal(p.offset + p.green0 + 3.5, p).phase1, 'redAmber');
    assert.equal(updateSignal(p.offset + p.cycle - 1, p).phase0, 'redAmber');
    assert.equal(updateSignal(p.offset + p.cycle - 1, p).phase1, 'red');
  }
});

test('crossers request a pedestrian signal once, wait for clearance and get a full crossing interval', async () => {
  const { configurePedestrianSignal, requestWalkSignal, updateSignal } = await import('../js/city-config.js');
  const node = { signal: true, signalTiming: { pedestrian: true, disabled: false, start: Infinity, lastGreen: 0, time: NaN } };
  configurePedestrianSignal(node, true, 24);
  assert.equal(updateSignal(0, node).phase0, 'green', 'no automatic red without a waiting crosser');
  requestWalkSignal(1, node);
  const p = node.signalTiming;
  assert.equal(p.start, 20, 'minimum road green batches vehicles before serving the request');
  assert.ok(p.start - 1 <= 20, 'an accepted request waits no longer than 20 seconds before amber');
  requestWalkSignal(5, node);
  assert.equal(p.start, 20, 'requests cannot postpone the pedestrian phase');
  assert.equal(updateSignal(20, node).phase0, 'amber');
  assert.equal(updateSignal(23, node).phase0, 'red');
  assert.equal(updateSignal(24.9, node).walk1, false);
  assert.equal(updateSignal(25, node).walk1, true);
  assert.equal(updateSignal(31.99, node).walk1, true);
  assert.equal(updateSignal(32, node).walk1, false);
  assert.equal(updateSignal(32, node).displayWalk1, 2);
  assert.equal(updateSignal(35, node).displayWalk1, 0);
  assert.equal(updateSignal(32 + 24 - 0.1, node).phase0, 'redAmber', 'last entrant has enough time to cross');
  assert.equal(updateSignal(56, node).phase0, 'green');
  requestWalkSignal(57, node);
  assert.equal(p.start, 76, 'minimum road green after the preceding request');
  assert.ok(p.start - 57 <= 20, 'a later accepted request also has a bounded delay');
  configurePedestrianSignal(node, false);
  assert.equal(node.signal, false);
  assert.equal(updateSignal(60, node).phase0, 'off');
});

test('corridor green waves follow measured road distance at 40 km/h', async () => {
  const { SIGNAL_PLANS } = await import('../js/city-config.js');
  for (const name of ['Franklina Roosevelta', 'Święty Marcin', 'Głogowska', 'Grunwaldzka',
    'Jana Henryka Dąbrowskiego', 'Królowej Jadwigi', 'Garbary',
    'Hetmańska', 'Górecka', 'Bukowska']) {
    assert.ok(SIGNAL_PLANS.some((p) => p.corridor === name && Number.isFinite(p.distance)), `${name} has coordinated signals`);
  }
  // Estkowskiego's two OSM sites belong to the same Garbary junction; both arms must use that one clock.
  const estkowskiego = SIGNAL_SITES.filter((site) => site.arms.some((a) => a.name === 'Ewarysta Estkowskiego'));
  assert.ok(estkowskiego.length > 0);
  assert.ok(estkowskiego.every((site) => site.timing.corridor === 'Garbary' && Number.isFinite(site.timing.distance)));
  const corridors = SIGNAL_PLANS.filter((p) => p.corridor && Number.isFinite(p.distance));
  assert.ok(corridors.length > 20);
  for (const p of corridors) {
    const travel = p.distance / (40 / 3.6);
    const groupStart = ((travel - p.offset) % p.cycle + p.cycle) % p.cycle;
    assert.ok(Math.min(Math.abs(groupStart), Math.abs(groupStart - p.cycle), Math.abs(groupStart - p.start1)) < 1e-7);
  }
});

test('merged OSM plans preserve each head direction while sharing one physical junction clock', async () => {
  const { updateSignal, SIGNAL_TIMING } = await import('../js/city-config.js');
  const plan = { ...SIGNAL_TIMING, mainUx: 1, mainUz: 0, time: NaN };
  const original = { alias: plan, mainUx: 0, mainUz: 1 };
  assert.equal(updateSignal(1, original).phase0, 'red');
  assert.equal(updateSignal(1, plan).phase0, 'green');
  assert.equal(original.walk1, true);
  assert.equal(plan.walk0, true);
  plan.pedestrian = true;
  plan.start = Infinity;
  plan.time = NaN;
  assert.equal(updateSignal(2, original).phase0, 'green');
  assert.equal(original.phase1, 'green', 'both road directions obey the same pedestrian request');
});

test('short links between signals use frequent service without breaking a corridor cycle', async () => {
  const { SIGNAL_PLANS } = await import('../js/city-config.js');
  const compact = SIGNAL_PLANS.filter((p) => p.compact && !p.corridor);
  assert.ok(compact.length > 10);
  assert.ok(compact.every((p) => p.cycle === 44));
  assert.ok(SIGNAL_PLANS.filter((p) => p.corridor).every((p) => p.cycle === 60));
});
