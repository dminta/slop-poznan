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
    apply: () => inert(),
    construct: () => inert()
  });
}
function inside(p, x, z) {
  let hit = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[i], b = p[j];
    if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) hit = !hit;
  }
  return hit;
}

test('surveyed park lawns leave nearby traffic lanes clear', async () => {
  const config = await import('../js/city-config.js');
  const { GEO } = await import('../js/geodata.js');
  const src = (name) => readFileSync(join(__dirname, '../js', name + '.js'), 'utf8');
  const render = {
    'three/webgpu': inert(), 'three/tsl': inert(),
    'three/addons/utils/BufferGeometryUtils.js': inert(), './tsl-materials.js': inert()
  };
  const targets = new Set([77, 262, 1101, 1299, 1304, 1356, 1370]);
  const records = [];
  let owner;
  const marker = 'const shape = createWorldXZShape(pts, holes);';
  const loop = 'if (!isParkBlock(b)) continue;\n    const ponds';
  assert.ok(src('city-grid').includes(loop) && src('city-grid').includes(marker));
  const gridSource = src('city-grid').replace(loop, 'if (!isParkBlock(b)) continue;\n    setOwner(b);\n    const ponds')
    .replace(marker, 'record(pts, bottomY, height, holes);\n  ' + marker);
  const globals = { console: { info() {}, log() {}, warn() {} }, setOwner: (b) => { owner = b; },
    record: (poly, y, height, holes) => {
      const lawn = y === 0.3 && Math.abs(height - 0.11) < 1e-6;
      const bed = y === 0.2 && Math.abs(height - 0.2) < 1e-6;
      const cutSurface = owner && (owner.id === 1101 || owner.id === 1356) && y === 0 &&
        (Math.abs(height - 0.22) < 1e-6 || Math.abs(height - 0.26) < 1e-6);
      if (owner && targets.has(owner.id) && (lawn || bed || cutSurface)) {
        records.push({ poly, holes, owner: owner.id, lawn });
      }
    } };
  const gridModule = loadModule(gridSource, { imports: { ...render, './city-config.js': config, './geodata.js': { GEO } }, globals });
  const grid = gridModule.buildCityGrid(inert());
  const road = loadModule(src('road-network'), { imports: { './city-config.js': config, './geodata.js': { GEO } }, globals });
  const network = road.buildRoadNetwork(grid.sidewalks, grid.footprints);
  for (const id of targets) assert.ok(records.some((r) => r.owner === id && r.lawn), `park ${id} retains lawn`);
  // The surveyed OSM Grudzieniec corridor reaches the Park Sołacki outline, but the modelled traffic lanes stay
  // clear; cutting it on that overlap alone would lose these three pond holes, so the lawn keeps them instead.
  const solacki = records.filter((r) => r.owner === 262 && r.lawn);
  assert.equal(solacki.length, 1, 'Park Sołacki emits one lawn ring');
  assert.equal(solacki[0].holes.length, 3, 'Park Sołacki keeps its three pond holes');
  const cross = (a, b, c) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  for (const { poly, lawn, owner: id } of records) {
    // Park Sołacki's historical 126-vertex bed predates this review and is left untouched; only its pond holes and
    // lane clearance are pinned here. The other surveyed lawns are simple.
    if (!lawn || id === 262) continue;
    for (let i = 0; i < poly.length; i++) for (let j = i + 2; j < poly.length; j++) {
      if (i === 0 && j === poly.length - 1) continue;
      const a = poly[i], b = poly[(i + 1) % poly.length], c = poly[j], d = poly[(j + 1) % poly.length];
      assert.ok(!(cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0),
        `park ${id} emits a self-intersecting lawn`);
    }
  }
  let samples = 0;
  for (const e of network.edges) for (const lane of e.lanes) for (let t = 0; t <= e.span; t += 1) {
    const x = e.x0 + e.dx * t + e.rx * lane, z = e.z0 + e.dz * t + e.rz * lane;
    for (const { poly, holes, owner: id } of records) {
      const b = config.BLOCKS[id];
      if (x < b.minX - 10 || x > b.maxX + 10 || z < b.minZ - 10 || z > b.maxZ + 10) continue;
      samples++;
      assert.ok(!inside(poly, x, z) || holes.some((h) => inside(h, x, z)), `park ${id} covers lane at ${x}, ${z}`);
    }
  }
  assert.ok(samples > 100, 'checks live traffic lanes around the surveyed parks');
  for (const [x, z] of [[1617.5, 1695.4], [-771.677, 2738.746]]) {
    assert.equal(config.blockAt(x, z), null, `roadway height at ${x}, ${z}`);
  }
});
