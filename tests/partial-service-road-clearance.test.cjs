const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
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
    apply: () => inert(), construct: () => inert()
  });
}

function inside(poly, x, z) {
  let result = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) result = !result;
  }
  return result;
}

test('the unpaved Wioślarska service road stays park ground rather than a cut corridor', async () => {
  const config = await import('../js/city-config.js');
  const { GEO } = await import('../js/geodata.js');
  const service = GEO.roads.find((r) => r[0] === 'Wioślarska' && r[1] === 5 && r[5][0] === 463.6);
  assert.ok(service, 'the mapped unpaved Wioślarska piece exists');
  assert.deepEqual(service[5], [463.6, 1574.6, 518.3, 1586.1, 569.1, 1600.1]);
  // The road graph leaves highway=service pieces out by default (docs/actors.md, poz-roadgraph.mjs), so this
  // unpaved access road has no traffic lanes. Check every graph link within the corridor's bounds by distance.
  const linkPoints = (l) => {
    const out = [{ x: GEO.roadGraph.nodes[l[0] * 2], z: GEO.roadGraph.nodes[l[0] * 2 + 1] }];
    for (let i = 0; i < (l[6] || []).length; i += 2) out.push({ x: l[6][i], z: l[6][i + 1] });
    out.push({ x: GEO.roadGraph.nodes[l[1] * 2], z: GEO.roadGraph.nodes[l[1] * 2 + 1] });
    return out;
  };
  const distance = (x, z, a, b) => {
    const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
    return Math.hypot(x - a.x - t * dx, z - a.z - t * dz);
  };
  const serviceDistance = (x, z) => {
    let best = Infinity;
    for (let s = 0; s + 3 < service[5].length; s += 2) {
      best = Math.min(best, distance(x, z, { x: service[5][s], z: service[5][s + 1] },
        { x: service[5][s + 2], z: service[5][s + 3] }));
    }
    return best;
  };
  let nearest = Infinity;
  for (const l of GEO.roadGraph.links) {
    const p = linkPoints(l);
    for (let i = 0; i + 1 < p.length; i++) {
      const len = Math.hypot(p[i + 1].x - p[i].x, p[i + 1].z - p[i].z);
      for (let t = 0; t <= len; t += 1) {
        const x = p[i].x + (p[i + 1].x - p[i].x) * t / len;
        const z = p[i].z + (p[i + 1].z - p[i].z) * t / len;
        if (Math.abs(x - 516) < 80 && Math.abs(z - 1587) < 40) nearest = Math.min(nearest, serviceDistance(x, z));
      }
    }
  }
  const nearestText = Number.isFinite(nearest) ? `${nearest.toFixed(1)} m` : 'none within 80 m';
  assert.ok(nearest > service[1] * 0.5, `no traffic lane runs along the unpaved access road (nearest ${nearestText})`);
  // The park block owns the whole centreline; its paving and lawn are the intended surface for this non-drivable way.
  for (let s = 0; s + 3 < service[5].length; s += 2) {
    const ax = service[5][s], az = service[5][s + 1], bx = service[5][s + 2], bz = service[5][s + 3];
    const len = Math.hypot(bx - ax, bz - az);
    for (let t = 0; t <= len; t += 5) {
      const x = ax + (bx - ax) * t / len, z = az + (bz - az) * t / len;
      assert.equal(config.blockAt(x, z)?.id, 968, `Wioślarska at ${x.toFixed(1)}, ${z.toFixed(1)} is park ground`);
    }
  }
});

test('partial park lawns keep the six mapped service-road corridors clear', async () => {
  const config = await import('../js/city-config.js');
  const { GEO } = await import('../js/geodata.js');
  const source = readFileSync(join(__dirname, '../js/city-grid.js'), 'utf8');
  const marker = 'for (const piece of pieces) parkLawnGeos.push(createExtrudedPolygonMesh(piece, SW_TOP - 0.02, 0.06, lawnMat).geometry);';
  assert.ok(source.includes(marker));
  const clipped = new Map();
  const ids = new Set([149, 209, 266, 328, 608, 887]);
  const grid = loadModule(source.replace(marker, 'recordPieces(b, lawn, pieces, segs);\n          ' + marker), {
    imports: { 'three/webgpu': inert(), 'three/tsl': inert(),
      'three/addons/utils/BufferGeometryUtils.js': inert(), './tsl-materials.js': inert(),
      './city-config.js': config, './geodata.js': { GEO } },
    globals: { console: { info() {}, warn() {}, log() {} }, recordPieces: (block, lawn, pieces, segs) => {
      if (ids.has(block.id) && segs.length) clipped.set(block.id, { lawn, pieces, segs });
    } }
  });
  grid.buildCityGrid(inert());
  assert.equal(clipped.size, ids.size, 'all six selected lawns and road corridors were found');
  const area = (ring) => Math.abs(ring.reduce((sum, p, i) => {
    const q = ring[(i + 1) % ring.length];
    return sum + p.x * q.z - q.x * p.z;
  }, 0)) / 2;
  const cross = (a, b, c) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  for (const [id, { lawn, pieces, segs }] of clipped) {
    for (let i = 0; i < lawn.length; i++) for (let j = i + 2; j < lawn.length; j++) {
      if (i === 0 && j === lawn.length - 1) continue;
      const a = lawn[i], b = lawn[(i + 1) % lawn.length], c = lawn[j], d = lawn[(j + 1) % lawn.length];
      assert.ok(!(cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0), `block ${id} input ring is simple`);
    }
    const remaining = pieces.reduce((sum, piece) => sum + area(piece), 0);
    assert.ok(remaining > area(lawn) * 0.8 && remaining <= area(lawn) + 0.01, `block ${id} keeps most of the lawn without overlapping pieces`);
    if (id === 887) {
      const boundary = config.BLOCKS[id].poly;
      const onBoundary = (x, z) => boundary.some((a, i) => {
        const b = boundary[(i + 1) % boundary.length], dx = b.x - a.x, dz = b.z - a.z;
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
        return Math.hypot(x - a.x - t * dx, z - a.z - t * dz) < 1e-6;
      });
      for (const piece of pieces) for (let i = 0; i < piece.length; i++) {
        const a = piece[i], b = piece[(i + 1) % piece.length];
        for (const t of [0, 0.25, 0.5, 0.75]) {
          const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
          assert.ok(inside(boundary, x, z) || onBoundary(x, z), 'the clipped Tysiąclecia lawn stays inside its block');
        }
      }
    }
    let hits = 0;
    for (const [ax, az, bx, bz, half] of segs) {
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
      if (!len) continue;
      for (let s = 0; s <= len; s += 0.5) for (const side of [-0.8, 0, 0.8]) {
        const x = ax + dx * s / len - dz / len * half * side;
        const z = az + dz * s / len + dx / len * half * side;
        if (inside(lawn, x, z)) hits++;
        assert.ok(!pieces.some((p) => inside(p, x, z)), `block ${id} covers road at ${x.toFixed(1)}, ${z.toFixed(1)}`);
      }
    }
    assert.ok(hits > 0, `block ${id} originally overlapped its road`);
  }
});
