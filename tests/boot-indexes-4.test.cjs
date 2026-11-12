// Boot part 4: the corner-link predicate needs only the 4 m band, not the nearest edge's distance.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const source = readFileSync(join(__dirname, '../js/pedestrian-routes.js'), 'utf8');
const a = source.indexOf('  function cornerClear(a, b, block) {');
const b = source.indexOf('  // Clearance for a fallback connector:', a);
assert.ok(a >= 0 && b > a, 'cornerClear slice markers');
const body = source.slice(a, b);
const plain = `function cornerClear(a, b, block) {
  if (!clear(a, b, block)) return false;
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z)));
  for (let i = 0; i <= steps; i++) {
    const x = a.x + (b.x - a.x) * i / steps, z = a.z + (b.z - a.z) * i / steps;
    let distance = Infinity;
    for (let j = 0, k = block.poly.length - 1; j < block.poly.length; k = j++) {
      const p = block.poly[j], q = block.poly[k], dx = q.x - p.x, dz = q.z - p.z;
      const t = Math.max(0, Math.min(1, ((x - p.x) * dx + (z - p.z) * dz) / (dx * dx + dz * dz || 1)));
      distance = Math.min(distance, Math.hypot(x - p.x - dx * t, z - p.z - dz * t));
    }
    if (distance > 4) return false;
  }
  return true;
}`;
const load = (text, clear = () => true, math = Math) =>
  vm.runInNewContext(`${text}\ncornerClear`, { Math: math, clear });

test('cornerClear keeps the full-scan answer on real outlines, 4 m boundaries and degenerate edges', async () => {
  const { BLOCKS } = await import('../js/city-config.js');
  const fast = load(body), reference = load(plain);
  const synthetic = { poly: [{ x: 0, z: 0 }, { x: 100, z: 0 }, { x: 100, z: 0 },
    { x: 100, z: 100 }, { x: 0, z: 100 }] };
  const blocks = [...BLOCKS.filter((q, i) => i % 17 === 0 || q.poly.length > 300), synthetic];
  let count = 0;
  for (const block of blocks) {
    for (let i = 0; i < block.poly.length; i += Math.max(1, Math.floor(block.poly.length / 20))) {
      const p = block.poly[i], q = block.poly[(i + 1) % block.poly.length];
      const dx = q.x - p.x, dz = q.z - p.z, len = Math.hypot(dx, dz) || 1;
      for (const offset of [0, 4 - 1e-9, 4, 4 + 1e-9, -4, 12]) {
        const x = (p.x + q.x) * 0.5 - dz / len * offset;
        const z = (p.z + q.z) * 0.5 + dx / len * offset;
        const start = { x, z }, end = { x: x + dx / len * 6, z: z + dz / len * 6 };
        assert.equal(fast(start, end, block), reference(start, end, block), `block ${block.id} edge ${i}, ${offset}`);
        count++;
      }
    }
  }
  assert.ok(count > 10000, `${count} corner links compared`);
});

test('cornerClear stops after an accepting edge and preserves the obstacle rejection', () => {
  let calls = 0;
  const math = Object.create(Math);
  math.hypot = (...args) => { calls++; return Math.hypot(...args); };
  const fast = load(body, () => true, math);
  const block = { poly: [{ x: 0, z: 0 }, { x: 100, z: 0 }, { x: 100, z: 100 }, { x: 0, z: 100 }] };
  assert.equal(fast({ x: 0, z: 20 }, { x: 0, z: 22 }, block), true);
  assert.equal(calls, 4, 'one length plus the first edge for each of three samples');
  calls = 0;
  assert.equal(load(body, () => false, math)({ x: 0, z: 20 }, { x: 0, z: 22 }, block), false);
  assert.equal(calls, 0, 'obstacles reject before any outline work');
});
