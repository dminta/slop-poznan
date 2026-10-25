const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const read = (path) => readFileSync(join(__dirname, '..', path), 'utf8');
let SIGNAL_SITES, AVENUES, STREETS;
test.before(async () => {
  ({ SIGNAL_SITES, AVENUES, STREETS } = await import('../js/city-config.js'));
});

test('Manhattan signals sit at the 63 core avenue x street corners, avenue-major', () => {
  assert.equal(SIGNAL_SITES.length, 63);
  const expected = AVENUES.flatMap((a) => STREETS.map((s) => ({ x: a.x, z: s.z, nsWidth: a.width, ewWidth: s.width })));
  assert.deepEqual(SIGNAL_SITES, expected);
});

test('the road network and the signal heads both read the signal sites', () => {
  // street details are built before the network, so both read the shared list instead of looping the grid each
  for (const path of ['js/road-network.js', 'js/street-details.js']) {
    assert.match(read(path), /for \(const site of SIGNAL_SITES\)/, path);
  }
});
