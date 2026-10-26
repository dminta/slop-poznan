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
