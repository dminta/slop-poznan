const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

// Open canopies (js/canopies.js) on the committed GEO.canopies: the platform, tram-stop and fuel-station roofs have
// to stand above the ground actors, their 0.4 m columns have to stay out of every running line, and the runtime
// builder has to emit one instance per record without adding wall-like colliders below the deck.

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
    apply: () => inert(),
    construct: () => inert()
  });
}

function threeStubs() {
  const three = inert();
  three.Group = function () {
    const g = inert();
    g.children = [];
    g.add = (mesh) => { if (mesh) g.children.push(mesh); };
    return g;
  };
  return { three };
}

test('canopy columns keep clear of every rail centreline and are inside their roof', async () => {
  const { GEO } = await import('../js/geodata.js');
  const CELL = 64;
  const cells = new Map();
  for (const r of GEO.rail) {
    const p = r.pts;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const s = [p[i], p[i + 1], p[i + 2], p[i + 3]];
      for (let ix = Math.floor(Math.min(s[0], s[2]) / CELL); ix <= Math.floor(Math.max(s[0], s[2]) / CELL); ix++) {
        for (let iz = Math.floor(Math.min(s[1], s[3]) / CELL); iz <= Math.floor(Math.max(s[1], s[3]) / CELL); iz++) {
          const key = `${ix},${iz}`;
          if (!cells.has(key)) cells.set(key, []);
          cells.get(key).push(s);
        }
      }
    }
  }
  const railDistance = (x, z) => {
    let best = Infinity;
    for (let ix = Math.floor(x / CELL) - 1; ix <= Math.floor(x / CELL) + 1; ix++) {
      for (let iz = Math.floor(z / CELL) - 1; iz <= Math.floor(z / CELL) + 1; iz++) {
        for (const [ax, az, bx, bz] of cells.get(`${ix},${iz}`) || []) {
          const ex = bx - ax, ez = bz - az;
          const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)));
          best = Math.min(best, Math.hypot(ax + ex * t - x, az + ez * t - z));
        }
      }
    }
    return best;
  };
  let columns = 0, min = Infinity, closest = null;
  for (const c of GEO.canopies) {
    const cs = Math.cos(c.ang), sn = Math.sin(c.ang);
    for (let i = 0; i + 1 < c.columns.length; i += 2) {
      const x = c.columns[i], z = c.columns[i + 1];
      columns++;
      assert.ok(x >= c.x0 - 0.5 && x <= c.x1 + 0.5 && z >= c.z0 - 0.5 && z <= c.z1 + 0.5, 'column under its roof');
      // Local coordinates are well inside the slab, so no post stands on a cantilever edge.
      const dx = x - c.cx, dz = z - c.cz;
      const u = dx * cs + dz * sn, v = -dx * sn + dz * cs;
      assert.ok(Math.abs(u) <= c.w * 0.5 + 0.1 && Math.abs(v) <= c.d * 0.5 + 0.1, 'column inside the oriented roof');
      const d = railDistance(x, z);
      if (d < min) { min = d; closest = [x, z, c.kind]; }
    }
  }
  assert.ok(columns >= 1500, `columns emitted (${columns})`);
  // The generator keeps 2.6 m before 0.1 m rounding; the post centre stays outside a 1.5 m train/tram body at 2.5 m.
  assert.ok(min >= 2.5, `closest column ${min.toFixed(2)} m from a track at ${closest}`);
});

test('buildCanopies emits one roof instance per record and only collides the posts and the deck', async () => {
  const { GEO } = await import('../js/geodata.js');
  const { buildCanopies } = loadModule(readFileSync(join(__dirname, '../js/canopies.js'), 'utf8'), {
    imports: { 'three/webgpu': threeStubs().three, './geodata.js': { GEO } },
    filename: 'canopies.js'
  });
  const scene = { add: () => {} };
  const result = buildCanopies(scene);
  assert.equal(result.count, GEO.canopies.length);
  assert.equal(result.group.name, 'Canopies');
  const postCount = GEO.canopies.reduce((n, c) => n + c.columns.length / 2, 0);
  assert.equal(result.colliders.length, postCount + GEO.canopies.length, 'one post box per column plus one deck box');
  const postBoxes = result.colliders.filter((c) => c.minY === 0);
  const deckBoxes = result.colliders.filter((c) => c.minY > 0);
  assert.equal(postBoxes.length, postCount);
  assert.equal(deckBoxes.length, GEO.canopies.length);
  for (const c of deckBoxes) {
    assert.ok(c.minY >= 4.5, 'deck underside above the ground actors');
    assert.ok(c.maxY > c.minY, 'deck has thickness');
  }
  assert.ok(postBoxes.every((c) => c.maxY >= 4.5 && c.maxX - c.minX <= 0.5), 'posts are thin and full height');
});
