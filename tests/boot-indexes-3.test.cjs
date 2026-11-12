// The boot-only fast paths added in the 2026-11-11 third load pass: the ring distance grid (city-grid.js ringDist),
// the rail clearance bbox reject, the walked segment-grid filing, the rail keep-out row spans, and the land raster's
// near-water block skip. Each keeps the plain version's exact arithmetic; only the candidates the arithmetic sees are
// narrowed. The land test rebuilds the full two-pass chamfer and compares every cell of the real detail box.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { loadModule } = require('./helpers/module.cjs');

const read = (name) => readFileSync(join(__dirname, '../js', name), 'utf8');
const cut = (source, start, end) => {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0, `missing start marker: ${start.slice(0, 50)}`);
  assert.ok(b > a, `missing end marker: ${end.slice(0, 50)}`);
  return source.slice(a, b);
};

const plainRingDist = (ring, x, z) => {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const c = ring[(i + 1) % ring.length];
    const dx = c.x - a.x, dz = c.z - a.z, l2 = dx * dx + dz * dz;
    const t = l2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2)) : 0;
    best = Math.min(best, Math.hypot(x - a.x - t * dx, z - a.z - t * dz));
  }
  return best;
};

function ringDistModule() {
  const source = read('city-grid.js');
  const edges = cut(source, '// Edges of a ring bucketed', 'function lineIntersection(');
  const distance = cut(source, '// Distance from (x, z)', 'function polygonCentroidArea');
  const context = vm.createContext({ Math, Infinity, Map, WeakMap, Array, Object });
  return vm.runInContext(`${edges}\n${distance}\n;ringDist`, context);
}

test('ringDist index matches the plain edge scan on real and synthetic rings', async () => {
  const { PLAZAS, BLOCKS } = await import('../js/city-config.js');
  const ringDist = ringDistModule();
  const rings = PLAZAS.map((p) => p.ring).filter((r) => r.length >= 3);
  const parks = BLOCKS.filter((b) => b.park > 0.6).map((b) => b.poly);
  rings.push(...parks.slice(0, 40));
  let compared = 0;
  for (const ring of rings) {
    const step = Math.max(1, Math.floor(ring.length / 10));
    for (let i = 0; i < ring.length; i += step) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      for (const t of [0, 0.25, 0.5, 1]) {
        const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
        for (const dx of [0, -1e-6, 1e-6]) {
          for (const dz of [0, -1e-6, 1e-6]) {
            for (const limit of [0.7, 0.95, 1, 1.5, Infinity]) {
              const exact = plainRingDist(ring, x + dx, z + dz);
              const actual = ringDist(ring, x + dx, z + dz, limit);
              const expected = exact < limit ? exact : limit;
              assert.equal(actual, expected, `ring ${ring.length} at ${x + dx},${z + dz} limit ${limit}`);
              compared++;
            }
          }
        }
      }
    }
  }
  assert.ok(compared > 50000, `compared ${compared} ring samples`);
});

test('ringDist handles vertices and queries exactly on 16 m cell lines', () => {
  const ringDist = ringDistModule();
  const ring = [];
  // a 240 m square with vertices on the 16 m cell lines and extra points on every cell line
  for (let t = 0; t <= 240; t += 8) ring.push({ x: t, z: 0 });
  for (let t = 0; t <= 240; t += 16) ring.push({ x: 240, z: t });
  for (let t = 240; t >= 0; t -= 8) ring.push({ x: t, z: 240 });
  for (let t = 240; t >= 0; t -= 16) ring.push({ x: 0, z: t });
  let compared = 0;
  for (const t of [0, 16, 31.999999, 32, 48, 240]) {
    for (const u of [0, 16, 32, 120, 240]) {
      for (const d of [0, -1e-6, 1e-6]) {
        for (const limit of [0.7, 1, 20, 100, Infinity]) {
          const exact = plainRingDist(ring, t + d, u);
          assert.equal(ringDist(ring, t + d, u, limit), exact < limit ? exact : limit);
          const exactZ = plainRingDist(ring, u, t + d);
          assert.equal(ringDist(ring, u, t + d, limit), exactZ < limit ? exactZ : limit);
          compared += 2;
        }
      }
    }
  }
  assert.ok(compared > 800);
});

test('railClearance bbox reject keeps the plain segment scan', () => {
  const source = read('city-grid.js');
  const cells = cut(source, 'function railCells()', '/** Distance from (x, z) to the nearest GEO.rail centreline');
  const clear = cut(source, 'function railClearance(x, z, r = 8) {', '/** Is a prop whose footprint');
  const rails = [
    { pts: [-500, 0, 500, 0] },
    { pts: [100, -500, 100, 500] },
    { pts: [-400, -300, 320, 380] },
    { pts: [32, 64, 32, 160] }, // exactly on the 32 m cell line
    { pts: [64, 32, 160, 32] },
    { pts: [0, 0, 0, 0] } // zero length
  ];
  const context = vm.createContext({ Math, GEO: { rail: rails }, _railCells: null, RAIL_CELL: 32 });
  const railClearance = vm.runInContext(`${cells}\n${clear}\n;railClearance`, context);
  const segs = [];
  for (const r of rails) {
    for (let i = 0; i + 3 < r.pts.length; i += 2) {
      segs.push([r.pts[i], r.pts[i + 1], r.pts[i + 2], r.pts[i + 3]]);
    }
  }
  const plain = (x, z, r) => {
    let best = r;
    for (const [ax, az, bx, bz] of segs) {
      const ex = bx - ax, ez = bz - az;
      const L2 = ex * ex + ez * ez;
      const t = L2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / L2)) : 0;
      const d = Math.hypot(ax + ex * t - x, az + ez * t - z);
      if (d < best) best = d;
    }
    return best;
  };
  let seed = 17;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  let compared = 0;
  for (let i = 0; i < 4000; i++) {
    const x = -520 + rnd() * 1040, z = -520 + rnd() * 1040;
    for (const r of [0.25, 2, 8, 20]) {
      assert.equal(railClearance(x, z, r), plain(x, z, r), `clearance at ${x},${z} r ${r}`);
      compared++;
    }
  }
  for (const x of [0, 32, 64, 100, -32]) {
    for (const z of [0, 32, 64, 0.5, -32]) {
      for (const d of [0, -1e-6, 1e-6]) {
        assert.equal(railClearance(x + d, z, 8), plain(x + d, z, 8), `boundary ${x + d},${z}`);
        compared++;
      }
    }
  }
  assert.ok(compared > 10000);
});

test('the walked segment grid keeps the nearest-segment result', () => {
  const slice = cut(read('tram-infra.js'), 'function segmentGrid(cell = 24, walk = false) {',
    '\n// Distance to the nearest car lane');
  const context = vm.createContext({ Math, Infinity });
  const segmentGrid = vm.runInContext(`${slice}\n;segmentGrid`, context);
  const walked = segmentGrid(24, true);
  const boxed = segmentGrid(24, false);
  let seed = 23;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const segments = [];
  for (let i = 0; i < 500; i++) {
    const ax = -500 + rnd() * 1000, az = -500 + rnd() * 1000;
    const len = rnd() < 0.08 ? 0 : 0.5 + rnd() * 300;
    const ang = rnd() * Math.PI * 2;
    segments.push([ax, az, ax + Math.cos(ang) * len, az + Math.sin(ang) * len, i]);
  }
  segments.push([0, 0, 0, 0, 500], [24, 24, 24, 240, 501], [-24, 48, 24, 48, 502], [0, 0, 300, 300, 503]);
  for (const s of segments) {
    walked.add(s[0], s[1], s[2], s[3], s[4]);
    boxed.add(s[0], s[1], s[2], s[3], s[4]);
  }
  const distance = (s, x, z) => {
    const ex = s.bx - s.ax, ez = s.bz - s.az;
    const L2 = ex * ex + ez * ez;
    const t = L2 > 0 ? Math.min(1, Math.max(0, ((x - s.ax) * ex + (z - s.az) * ez) / L2)) : 0;
    return Math.hypot(s.ax + ex * t - x, s.az + ez * t - z);
  };
  let compared = 0;
  for (let i = 0; i < 30000; i++) {
    const x = -550 + rnd() * 1100, z = -550 + rnd() * 1100;
    const r = 0.25 + rnd() * 80;
    const accept = i % 7 === 0 ? (sg) => sg.data % 4 !== 0 : null;
    const a = walked.nearest(x, z, r, accept);
    const b = boxed.nearest(x, z, r, accept);
    if (!a) {
      assert.equal(b, null, `nearest at ${x},${z} r ${r}`);
    } else {
      assert.ok(b, `nearest missing at ${x},${z} r ${r}`);
      assert.equal(a.d, b.d, `distance at ${x},${z} r ${r}`);
      // A tie may pick either segment, but the walked grid must not pick a farther one.
      if (a.seg !== b.seg) assert.equal(distance(a.seg, x, z), a.d);
      assert.equal(a.qx, b.qx);
      assert.equal(a.qz, b.qz);
      assert.equal(a.t, b.t);
    }
    compared++;
  }
  assert.ok(compared > 20000);
});

test('the rail keep-out row spans fill exactly the plain predicate cells', () => {
  const source = read('tram-infra.js');
  const slice = cut(source, '  const tiles = new Map();', '  let bands = 0;');
  const make = () => {
    const context = vm.createContext({ Math, Map, Uint8Array, KEEPOUT_TILE: 64 });
    const api = vm.runInContext(`${slice}\n;({ fillRect, tiles, cells: () => corridorCells })`, context);
    return api;
  };
  const fast = make();
  const plain = make();
  let plainCount = 0;
  const plainFill = (ax, az, dx, dz, len, o0, o1) => {
    const nx = -dz, nz = dx;
    const xs = [ax + nx * o0 - dx * 0.25, ax + nx * o1 - dx * 0.25, ax + nx * o0 + dx * (len + 0.25), ax + nx * o1 + dx * (len + 0.25)];
    const zs = [az + nz * o0 - dz * 0.25, az + nz * o1 - dz * 0.25, az + nz * o0 + dz * (len + 0.25), az + nz * o1 + dz * (len + 0.25)];
    const tiles = plain.tiles;
    for (let iz = Math.floor(Math.min(...zs)); iz <= Math.floor(Math.max(...zs)); iz++) {
      for (let ix = Math.floor(Math.min(...xs)); ix <= Math.floor(Math.max(...xs)); ix++) {
        const cx = ix + 0.5 - ax, cz = iz + 0.5 - az;
        const u = cx * dx + cz * dz, o = cx * nx + cz * nz;
        if (u < -0.25 || u > len + 0.25 || o < o0 || o > o1) continue;
        const k = (ix >> 6) * 1024 + 512 * 1024 + (iz >> 6) + 512;
        let tile = tiles.get(k);
        if (!tile) tiles.set(k, tile = new Uint8Array(64 * 64));
        const idx = (ix & 63) + ((iz & 63) << 6);
        if (!tile[idx]) plainCount++;
        tile[idx] = 1;
      }
    }
  };
  const cases = [
    [0, 0, 1, 0, 120, -3.4, 3.4],
    [0, 0, Math.SQRT1_2, Math.SQRT1_2, 90, -3.4, 3.4],
    [0, 0, 0, 1, 80, -3.4, 3.4],
    [64, 128, 1, 0, 40, -1, 1],
    [32, 32, 0.6, 0.8, 70, -3.4, 3.4],
    [-20, 10, -0.8, 0.6, 50, -2, 2],
    [127.5, -63.5, 1, 0, 10, -0.5, 0.5],
    [0, 0, 1, 0, 0.01, -0.25, 0.25]
  ];
  for (const c of cases) {
    fast.fillRect(...c);
    plainFill(...c);
  }
  assert.equal(fast.cells(), plainCount, 'the filled cell count');
  const keys = new Set([...fast.tiles.keys(), ...plain.tiles.keys()]);
  let cells = 0;
  for (const key of keys) {
    const a = fast.tiles.get(key), b = plain.tiles.get(key);
    for (let idx = 0; idx < 64 * 64; idx++) {
      assert.equal(a ? a[idx] : 0, b ? b[idx] : 0, `tile ${key} cell ${idx}`);
      cells++;
    }
  }
  assert.ok(cells > 100);
});

test('crossingRuns piece rejects keep the plain per-metre sample runs', () => {
  const slice = cut(read('road-network.js'), '    function crossingRuns(e, lanes, ids, all = false) {',
    '    const trackIds = new Map();');
  const plainSource = `
    function crossingRuns(e, lanes, ids, all = false) {
      const runs = [];
      const chains = new Set(ids.map((i) => streetTracks[i].chain));
      for (const chain of chains) {
        const pieces = chainTracks.get(chain);
        if (!pieces) continue;
        const active = new Map();
        let s = 0;
        for (const t of pieces) {
          const oncoming = all || t.ux * e.dx + t.uz * e.dz < 0.5;
          for (let d = 0; d <= t.len; d += 1) {
            const x = t.ax + t.ux * d;
            const z = t.az + t.uz * d;
            const along = (x - e.sx) * e.dx + (z - e.sz) * e.dz;
            const lat = (x - e.sx) * e.rx + (z - e.sz) * e.rz;
            const inBand = oncoming && along >= 0 && along <= e.len;
            for (let i = 0; i < lanes.length; i++) {
              const close = inBand && Math.abs(lat - lanes[i]) < OPPOSING_CLEAR;
              if (close) {
                let r = active.get(i);
                if (!r) {
                  r = { lane: i, chain, s0: s + d, s1: s + d, latMin: lat, latMax: lat };
                  active.set(i, r);
                }
                r.s1 = s + d;
                r.latMin = Math.min(r.latMin, lat);
                r.latMax = Math.max(r.latMax, lat);
              } else if (active.has(i)) {
                runs.push(active.get(i));
                active.delete(i);
              }
            }
          }
          s += t.len;
        }
        for (const r of active.values()) runs.push(r);
      }
      return runs;
    }`;
  const fastContext = vm.createContext({ Math, Set, Map, Infinity, streetTracks: [], chainTracks: new Map(), OPPOSING_CLEAR: 2.3 });
  const plainContext = vm.createContext({ Math, Set, Map, Infinity, streetTracks: [], chainTracks: new Map(), OPPOSING_CLEAR: 2.3 });
  const fast = vm.runInContext(`${slice}\n;crossingRuns`, fastContext);
  const plain = vm.runInContext(`${plainSource}\n;crossingRuns`, plainContext);
  let seed = 29;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  let compared = 0;
  for (let trial = 0; trial < 120; trial++) {
    const streetTracks = [], chainTracks = new Map();
    const chains = 1 + Math.floor(rnd() * 3);
    for (let c = 0; c < chains; c++) {
      const pieces = [];
      let ax = -80 + rnd() * 160, az = -80 + rnd() * 160;
      for (let k = 0; k < 1 + Math.floor(rnd() * 4); k++) {
        const len = 5 + rnd() * 60;
        const ang = Math.floor(rnd() * 4) * Math.PI / 2; // axis-aligned and crossing cases
        const ux = Math.cos(ang), uz = Math.sin(ang);
        pieces.push({ ax, az, ux, uz, len });
        ax += ux * len;
        az += uz * len;
      }
      chainTracks.set(c, pieces);
      streetTracks.push({ chain: c }, { chain: c });
    }
    fastContext.streetTracks = streetTracks;
    fastContext.chainTracks = chainTracks;
    plainContext.streetTracks = streetTracks;
    plainContext.chainTracks = chainTracks;
    const e = {
      sx: -60 + rnd() * 120, sz: -60 + rnd() * 120,
      dx: rnd() < 0.6 ? 1 : 0, dz: 0, rx: 0, rz: 0, len: 5 + rnd() * 80
    };
    e.dz = e.dx ? 0 : 1;
    e.rx = -e.dz;
    e.rz = e.dx;
    // mix a parallel edge with a crossing one by turning the frame
    if (rnd() < 0.5) {
      const ang = rnd() * Math.PI * 2;
      e.dx = Math.cos(ang); e.dz = Math.sin(ang); e.rx = -e.dz; e.rz = e.dx;
    }
    const lanes = [-4, -1.5, 0, 1.5, 4].slice(0, 1 + Math.floor(rnd() * 4)).map((o) => o + rnd() * 0.6);
    lanes.sort((a, b) => a - b);
    const ids = streetTracks.map((_, i) => i);
    for (const all of [false, true]) {
      assert.equal(JSON.stringify(fast(e, lanes, ids, all)), JSON.stringify(plain(e, lanes, ids, all)),
        `trial ${trial} all ${all}`);
      compared++;
    }
  }
  assert.ok(compared > 200);
});

test('the split footprint hash answers the same curb and obstacle queries', () => {
  const source = read('road-network.js');
  const factory = cut(source, 'function createFootprintIndex(', '\nfunction buildRoadNetwork(');
  const slice = cut(source, '  const boxKey =', '  // All four corners at least SHORE_MARGIN');
  let seed = 31;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const sidewalks = [], obstacles = [];
  for (let i = 0; i < 220; i++) {
    const x = -9000 + rnd() * 13400, z = -2800 + rnd() * 5600;
    const w = 0.5 + rnd() * 60, d = 0.5 + rnd() * 60;
    const r = { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, walkable: rnd() < 0.3 };
    if (i % 3 === 0) sidewalks.push(r); else obstacles.push(i % 11 === 0 ? { ...r, curb: true } : r);
  }
  const BLOCKS = [{ ...obstacles[0], median: true }, { ...obstacles[2], park: 0.8 }];
  const context = vm.createContext({ Math, Map, CELL: 16, sidewalks, obstacles, BLOCKS });
  const { curbs, blocked } = vm.runInContext(`${factory}\n${slice}\n;({ curbs, blocked })`, context);
  const overlaps = (r, minX, maxX, minZ, maxZ) => r.minX < maxX && r.maxX > minX && r.minZ < maxZ && r.maxZ > minZ;
  const curbRects = [...sidewalks, ...obstacles.filter((r) => r.curb)];
  const obstacleRects = obstacles.filter((r) => !r.curb);
  let checked = 0;
  for (let i = 0; i < 2000; i++) {
    const x = -9100 + rnd() * 13600, z = -2830 + rnd() * 5680;
    const s = 0.05 + rnd() * 40;
    const minX = x - s, maxX = x + s, minZ = z - s, maxZ = z + s;
    const wantCurb = curbRects.some((r) => overlaps(r, minX, maxX, minZ, maxZ));
    const wantObstacle = obstacleRects.some((r) => !r.walkable && overlaps(r, minX, maxX, minZ, maxZ));
    assert.equal(curbs(minX, maxX, minZ, maxZ, 1), wantCurb, `curb box ${x},${z} ${s}`);
    assert.equal(blocked(minX, maxX, minZ, maxZ, 1), wantObstacle, `obstacle box ${x},${z} ${s}`);
    const wantRoadObstacle = obstacleRects.some((r) =>
      r !== obstacles[0] && r !== obstacles[2] && (r.maxX - r.minX < 50 || r.maxZ - r.minZ < 50) &&
      overlaps(r, minX, maxX, minZ, maxZ));
    assert.equal(blocked(minX, maxX, minZ, maxZ, 2), wantRoadObstacle, `road obstacle box ${x},${z} ${s}`);
    checked += 3;
  }
  assert.ok(checked > 3000);
});

test('largestComponent CSR keeps the plain Kosaraju result and its tie order', () => {
  const slice = cut(read('road-network.js'), 'function largestComponent(list, next) {', '\n// Cubic Bézier');
  const plainSource = `
    function largestComponent(list, next) {
      const index = new Map(list.map((e, i) => [e, i]));
      const succ = list.map((e) => next(e).map((f) => index.get(f)).filter((j) => j !== undefined));
      const pred = list.map(() => []);
      succ.forEach((s, i) => { for (const j of s) pred[j].push(i); });
      const visited = new Uint8Array(list.length);
      const order = [];
      for (let root = 0; root < list.length; root++) {
        if (visited[root]) continue;
        visited[root] = 1;
        const stack = [[root, 0]];
        while (stack.length) {
          const top = stack[stack.length - 1];
          if (top[1] < succ[top[0]].length) {
            const j = succ[top[0]][top[1]++];
            if (!visited[j]) { visited[j] = 1; stack.push([j, 0]); }
          } else { order.push(top[0]); stack.pop(); }
        }
      }
      const comp = new Int32Array(list.length).fill(-1);
      let best = -1, bestSize = 0;
      for (let k = order.length - 1, c = 0; k >= 0; k--) {
        if (comp[order[k]] >= 0) continue;
        const stack = [order[k]];
        comp[order[k]] = c;
        let size = 0;
        while (stack.length) {
          const i = stack.pop();
          size++;
          for (const p of pred[i]) if (comp[p] < 0) { comp[p] = c; stack.push(p); }
        }
        if (size > bestSize) { bestSize = size; best = c; }
        c++;
      }
      return new Set(list.filter((_, i) => comp[i] === best));
    }`;
  const g = { Math, Map, Set, Array, Object, Int32Array, Uint8Array, Infinity };
  const fast = vm.runInContext(`${slice}\n;largestComponent`, vm.createContext(g));
  const plain = vm.runInContext(`${plainSource}\n;largestComponent`, vm.createContext(g));
  let seed = 37;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (const n of [0, 1, 2, 7, 60, 250]) {
    const items = Array.from({ length: n }, (_, i) => ({ id: i }));
    const succ = new Map(items.map((e) => [e, items.filter((f) => f !== e && rnd() < 0.12)]));
    const next = (e) => succ.get(e);
    const runFast = [...fast(items, next)].map((e) => e.id).sort((a, b) => a - b);
    const runPlain = [...plain(items, next)].map((e) => e.id).sort((a, b) => a - b);
    assert.deepEqual(runFast, runPlain, `component of ${n} items`);
  }
});

test('pavedPlazas road buckets keep the full-scan square selection and road segments', async () => {
  const config = await import('../js/city-config.js');
  const { GEO } = await import('../js/geodata.js');
  const three = {
    'three/webgpu': inertStub(), 'three/tsl': inertStub(),
    'three/addons/utils/BufferGeometryUtils.js': inertStub(), './tsl-materials.js': inertStub()
  };
  const modules = (source) => loadModule(source, {
    imports: { ...three, './city-config.js': config, './geodata.js': { GEO } },
    globals: {
      Math, Object, Array, Set, Map, WeakMap, Number, Infinity, NaN, JSON, Float32Array, Uint8Array, Uint32Array,
      Int32Array, String, Error, Boolean, console: { info() {}, log() {}, warn() {} }
    },
    filename: 'city-grid.js'
  });
  const fast = modules(read('city-grid.js')).pavedPlazas();
  let plainSource = read('city-grid.js');
  plainSource = plainSource.replace(
    'for (const i of nearRoadSegments(p.minX, p.maxX, p.minZ, p.maxZ)) {',
    'for (let i = 0; i < roadSegs.length; i++) {');
  plainSource = plainSource.replace(
    'p.roadSegs = nearGraphSegments(p.minX, p.maxX, p.minZ, p.maxZ)\n      .map((i) => roadSegments[i])\n      .filter((s) => crossesPlaza(p, s));',
    'p.roadSegs = roadSegments.filter((s) => crossesPlaza(p, s));');
  assert.ok(!plainSource.includes('nearRoadSegments(p.minX') && !plainSource.includes('nearGraphSegments(p.minX'),
    'the plain pavedPlazas reference still contains a bucket lookup');
  const plain = modules(plainSource).pavedPlazas();
  const summarize = (list) => list.map((p) => [p.name, p.minX, p.maxX, p.minZ, p.maxZ,
    p.roadSegs.map((s) => s.join(',')), p.tramSegs ? p.tramSegs.map((s) => s.join(',')) : null]);
  assert.equal(JSON.stringify(summarize(fast)), JSON.stringify(summarize(plain)));
  assert.ok(fast.length > 20, `kept ${fast.length} squares`);
});

function inertStub() {
  const store = {};
  return new Proxy(function () {}, {
    get(_t, key) {
      if (key === Symbol.iterator) return function* () {};
      if (key === Symbol.toPrimitive) return () => 0;
      if (key === 'then') return undefined;
      if (key === 'length') return 0;
      return key in store ? store[key] : (store[key] = inertStub());
    },
    set(_t, key, value) {
      store[key] = value;
      return true;
    },
    apply: () => inertStub(),
    construct: () => inertStub()
  });
}

test('the land raster near-water block skip reproduces the full chamfer on every cell', async () => {
  const config = await import('../js/city-config.js');
  const source = read('city-config.js');
  const slot = cut(source, 'const POLY_SLOT = 4;', 'function createPolygonIndex');
  const raster = cut(source, 'const LAND_RES = 2;', 'const landCell =');
  const B = config.CITY_BOUNDS;
  const context = vm.createContext({
    Math, Float32Array, Uint8Array, Array, Object, Infinity,
    LAND_RINGS: config.LAND_RINGS,
    LAND_HOLES: config.LAND_HOLES,
    BRIDGES: config.BRIDGES,
    RAIL_BRIDGES: config.RAIL_BRIDGES,
    TRAM_WIDTH: config.TRAM_WIDTH,
    createPolygonIndex: config.createPolygonIndex,
    DBX0: B.minX, DBX1: B.maxX, DBZ0: B.minZ, DBZ1: B.maxZ
  });
  const { LAND_CODE, LAND_DIST, LAND_W, LAND_H } = vm.runInContext(
    `${slot}\n${raster}\n;({ LAND_CODE, LAND_DIST, LAND_W, LAND_H })`, context);
  const W = LAND_W, H = LAND_H;
  const D = new Float32Array(W * H);
  for (let k = 0; k < D.length; k++) D[k] = LAND_CODE[k] === 0 ? 0 : 1e9;
  const o = 2, d = 2 * Math.SQRT2;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      let v = D[k];
      if (!v) continue;
      if (i > 0) v = Math.min(v, D[k - 1] + o);
      if (j > 0) {
        v = Math.min(v, D[k - W] + o);
        if (i > 0) v = Math.min(v, D[k - W - 1] + d);
        if (i + 1 < W) v = Math.min(v, D[k - W + 1] + d);
      }
      D[k] = v;
    }
  }
  for (let j = H - 1; j >= 0; j--) {
    for (let i = W - 1; i >= 0; i--) {
      const k = j * W + i;
      let v = D[k];
      if (!v) continue;
      if (i + 1 < W) v = Math.min(v, D[k + 1] + o);
      if (j + 1 < H) {
        v = Math.min(v, D[k + W] + o);
        if (i + 1 < W) v = Math.min(v, D[k + W + 1] + d);
        if (i > 0) v = Math.min(v, D[k + W - 1] + d);
      }
      D[k] = v;
    }
  }
  let compared = 0, water = 0;
  for (let k = 0; k < D.length; k++) {
    const expected = LAND_CODE[k] === 2 ? 255 : Math.min(255, Math.round(D[k]));
    assert.equal(LAND_DIST[k], expected, `land distance at cell ${k}`);
    if (LAND_CODE[k] === 0) water++;
    compared++;
  }
  assert.ok(compared > 19000000, `compared ${compared} cells`);
  assert.ok(water > 400000, `water cells ${water}`);
});
