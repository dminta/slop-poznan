const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');
const test = require('node:test');

test('tram decks clear tall furniture and support contact wires', () => {
  const r = spawnSync(process.execPath, [join(__dirname, '../tools/audit-canopy-clearance.mjs'), '--json'],
    { encoding: 'utf8', timeout: 180000 });
  assert.equal(r.status, 0, r.stderr);
  const data = JSON.parse(r.stdout);
  const hits = data.hits.filter((h) => data.targetCanopies.includes(h.index) &&
    ['led-lamp', 'gas-lamp', 'park-lamp', 'tree', 'tram-pole', 'tram-arm', 'tram-span'].includes(h.kind));
  assert.deepEqual(hits, []);
  assert.ok(data.targetCanopies.includes(10), 'the tram platform deck is selected');
  assert.ok(data.targetCanopies.includes(184), 'the low roof is selected');
  assert.ok(data.hangers.length > 8, 'deck hangers replace overhead supports');
  for (const canopy of [7, 8, 9, 10]) {
    assert.ok(data.hangers.some((h) => h.canopy === canopy), `canopy ${canopy} has wire hangers`);
  }
  assert.ok(data.hangers.every((h) => h.top > 5.8 && h.top <= 6.1));
  assert.deepEqual(data.missingSignalSupports, []);
  const nearby = (p) => Math.hypot(p.x + 380, p.z - 229) < 5;
  const poles = data.tramPoles.filter(nearby);
  assert.equal(poles.length, 1, 'the low roof keeps one nearby traction pole');
  assert.ok(data.tramArms.some((a) => Math.hypot(a.ax - poles[0].x, a.az - poles[0].z) < 0.01),
    'that pole carries the contact wire on a cantilever');
});

test('overlapping decks choose the highest qualifying underside regardless of order', () => {
  const { readFileSync } = require('node:fs');
  const vm = require('node:vm');
  const source = readFileSync(join(__dirname, '../js/tram-infra.js'), 'utf8');
  const geometry = source.slice(source.indexOf('function makeObb('), source.indexOf('function shelterZones('));
  const keepout = source.slice(source.indexOf('function createCanopyKeepout('),
    source.indexOf('// Every layout caller'));
  const create = vm.runInNewContext(geometry + keepout + '\ncreateCanopyKeepout');
  const low = { cx: 0, cz: 0, w: 10, d: 10, ang: 0, clearance: 4.6 };
  const high = { ...low, clearance: 6.1 };
  for (const decks of [[low, high], [high, low]]) {
    const k = create(decks);
    assert.equal(k.at(0, 0, 0.001, 6.6).source, high);
    assert.equal(k.at(0, 0, 0.001, 5).source, low);
    assert.equal(k.at(20, 20), null);
  }
});
