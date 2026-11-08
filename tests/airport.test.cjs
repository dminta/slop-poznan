const assert = require('node:assert/strict');
const test = require('node:test');

const inside = (ring, x, z) => {
  let hit = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    if ((ring[i + 1] > z) !== (ring[j + 1] > z) &&
      x < (ring[j] - ring[i]) * (z - ring[i + 1]) / (ring[j + 1] - ring[i + 1]) + ring[i]) hit = !hit;
  }
  return hit;
};

test('Ławica aerodrome is a surface layer, not a city block', async () => {
  const { GEO } = await import('../js/geodata.js');
  const list = GEO.aeroway;
  assert.ok(Array.isArray(list) && list.length > 100, 'aeroway snapshot consumed');
  const kinds = {};
  for (const a of list) {
    assert.ok(['runway', 'taxiway', 'apron', 'terminal', 'helipad'].includes(a.kind), `kind ${a.kind}`);
    assert.ok(Array.isArray(a.ring) && a.ring.length >= 6 && a.ring.length % 2 === 0, 'flat ring');
    assert.ok(a.ring.every(Number.isFinite), 'finite ring');
    if (a.kind === 'terminal') assert.ok(a.h >= 8, `terminal height ${a.h}`);
    kinds[a.kind] = (kinds[a.kind] || 0) + 1;
  }
  assert.equal(kinds.runway, 1, 'one runway');
  assert.ok(kinds.taxiway >= 80, `taxiways ${kinds.taxiway}`);
  assert.ok(kinds.apron >= 20, `aprons ${kinds.apron}`);
  assert.ok(kinds.terminal >= 6, `terminals ${kinds.terminal}`);
  assert.ok(kinds.helipad >= 3, `helipads ${kinds.helipad}`);

  const runway = list.find((a) => a.kind === 'runway');
  const xs = runway.ring.filter((_, i) => i % 2 === 0), zs = runway.ring.filter((_, i) => i % 2 === 1);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  // 2,492 m at 107.5°: its east-west projection is about 2,376 m and its north-south one about 750 m.
  assert.ok(x1 - x0 > 2300 && x1 - x0 < 2500, `runway east-west extent ${(x1 - x0).toFixed(0)} m`);
  assert.ok(z1 - z0 > 650 && z1 - z0 < 850, `runway north-south extent ${(z1 - z0).toFixed(0)} m`);

  // The 2.81 km² aerodrome must not survive as one giant block: no block may cover the runway centreline.
  const line = [];
  for (let i = 0; i + 1 < runway.line.length; i += 2) line.push([runway.line[i], runway.line[i + 1]]);
  assert.ok(line.length >= 2, 'runway centreline emitted');
  for (const [x, z] of line) assert.ok(!GEO.blocks.some((b) => inside(b[0], x, z)), `runway sample ${x}, ${z} is not inside a block`);
});
