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
