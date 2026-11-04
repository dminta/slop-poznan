const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

function inert() {
  const store = {};
  return new Proxy(function () {}, {
    get(_target, key) {
      if (key === Symbol.iterator) return function* () {};
      if (key === Symbol.toPrimitive) return () => 0;
      if (key === 'then') return undefined;
      if (key === 'length') return 0;
      return key in store ? store[key] : (store[key] = inert());
    },
    set(_target, key, value) { store[key] = value; return true; },
    apply: () => inert(), construct: () => inert()
  });
}

function inside(ring, x, z) {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) result = !result;
  }
  return result;
}

function area(p) {
  return Math.abs(p.reduce((sum, a, i) => {
    const b = p[(i + 1) % p.length];
    return sum + a.x * b.z - b.x * a.z;
  }, 0)) / 2;
}

function roadSegments(graph) {
  const segments = [];
  for (const [a, b, , width, , , inner] of graph.links) {
    let x = graph.nodes[2 * a], z = graph.nodes[2 * a + 1];
    for (let i = 0; i <= inner.length; i += 2) {
      const nx = i < inner.length ? inner[i] : graph.nodes[2 * b];
      const nz = i < inner.length ? inner[i + 1] : graph.nodes[2 * b + 1];
      segments.push([x, z, nx, nz, width / 2]);
      x = nx; z = nz;
    }
  }
  return segments;
}

function crosses(plaza, [ax, az, bx, bz]) {
  if (Math.max(ax, bx) < plaza.minX || Math.min(ax, bx) > plaza.maxX ||
      Math.max(az, bz) < plaza.minZ || Math.min(az, bz) > plaza.maxZ) return false;
  const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 0.1));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
    if (inside(plaza.ring, x, z) && !plaza.holes.some((h) => inside(h, x, z))) return true;
  }
  return false;
}

function footprint(c) {
  if (!c.obb) return [
    { x: c.minX, z: c.minZ }, { x: c.maxX, z: c.minZ },
    { x: c.maxX, z: c.maxZ }, { x: c.minX, z: c.maxZ }
  ];
  const { cx, cz, hx, hz, cs, sn } = c.obb;
  return [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]]
    .map(([x, z]) => ({ x: cx + cs * x + sn * z, z: cz - sn * x + cs * z }));
}

test('all paved plazas and their furniture clear crossing drivable roads', async () => {
  const config = await import('../js/city-config.js');
  const { GEO } = await import('../js/geodata.js');
  const module = loadModule(readFileSync(join(__dirname, '../js/city-grid.js'), 'utf8'), {
    imports: { 'three/webgpu': inert(), 'three/addons/utils/BufferGeometryUtils.js': inert(),
      './city-config.js': config, './geodata.js': { GEO }, './tsl-materials.js': inert() },
    globals: { console: { info() {}, log() {}, warn() {} } }, filename: 'city-grid.js'
  });
  const square = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }];
  const hole = [{ x: 4, z: 4 }, { x: 6, z: 4 }, { x: 6, z: 6 }, { x: 4, z: 6 }];
  const pieces = module.cutSlab(square, [[5, 0, 5, 10, 1]], 0, [hole]);
  assert.ok(Math.abs(pieces.reduce((sum, p) => sum + area(p), 0) - 80) < 0.01);
  const grid = module.buildCityGrid(inert());
  const roads = roadSegments(GEO.roadGraph);
  const plazas = module.pavedPlazas();
  let crossed = 0;
  for (const plaza of plazas) {
    const sampled = roads.filter((s) => crosses(plaza, s));
    const segments = [...sampled];
    for (const s of plaza.roadSegs || []) {
      if (!segments.some((other) => other.every((v, i) => v === s[i]))) segments.push(s);
    }
    if (!segments.length) continue;
    crossed++;
    const expectedArea = area(plaza.ring) - plaza.holes.reduce((sum, h) => sum + area(h), 0);
    const uncutArea = module.cutSlab(plaza.ring, [], 0, plaza.holes).reduce((sum, p) => sum + area(p), 0);
    assert.ok(Math.abs(expectedArea - uncutArea) < 0.5, `${plaza.name}: plaza or building holes changed`);
    const cut = (grid.roadCutPlazas || []).find((p) =>
      p.ring.length === plaza.ring.length && p.ring[0].x === plaza.ring[0].x && p.ring[0].z === plaza.ring[0].z);
    assert.ok(cut, `${plaza.name || 'unnamed plaza'} needs road cuts`);
    for (const pieces of [cut.curb, cut.top]) {
      const before = pieces.reduce((sum, p) => sum + area(p), 0);
      const after = pieces.flatMap((p) => module.cutSlab(p, segments, 0)).reduce((sum, p) => sum + area(p), 0);
      assert.ok(before - after < 0.1, `${plaza.name}: ${(before - after).toFixed(2)} m² on roads`);
    }
    for (const c of cut.props) {
      const poly = footprint(c);
      const remaining = module.cutSlab(poly, segments, 0).reduce((sum, p) => sum + area(p), 0);
      assert.ok(area(poly) - remaining < 0.01, `${plaza.name}: furniture overlaps a road`);
    }
  }
  assert.equal(crossed, 3);
  const near = ([ax, az, bx, bz], x, z) => {
    const dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    return Math.hypot(x - ax - t * dx, z - az - t * dz) < 5;
  };
  for (const [x, z] of [[-242.6, 520.9], [-191.6, 374.5], [119.6, 166.8]]) {
    assert.ok(grid.roadCutPlazas.some((p) => p.roads.some((s) => near(s, x, z))), `missing cut near ${x}, ${z}`);
  }
  for (const [x, z] of [[217.6, 187.4], [4075, -1807]]) {
    assert.ok(!roads.some((s) => near(s, x, z)), `unexpected drivable road near ${x}, ${z}`);
  }
});
