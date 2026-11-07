const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { loadModule } = require('./helpers/module.cjs');
const { THREE } = require('./helpers/three-stub.cjs');

const cityConfig = require('../js/city-config.js');
const { LANDMARK_SITES, CITY_LANDMARKS } = cityConfig;

const tslStub = {
  createPreWarBuildingMaterial: (o) => ({ ...o }),
  createCurtainWallMaterial: (o) => ({ ...o }),
  createFacadeBoxes: () => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), {}),
  createLitWindowMaterial: (opts = {}) => Object.assign(new THREE.MeshStandardNodeMaterial({ color: 0x1c2a36, ...opts }), { isLitWindow: true, userData: { isLitWindow: true } })
};

const kitSource = readFileSync(join(__dirname, '../js/landmark-kit.js'), 'utf8');
const kit = loadModule(kitSource, {
  imports: {
    'three/webgpu': THREE,
    './city-config.js': cityConfig,
    './tsl-materials.js': tslStub
  },
  globals: { Math, console }
});

const M = kit.createLandmarkMaterials();

const historicSource = readFileSync(join(__dirname, '../js/landmarks-historic.js'), 'utf8');
const historic = loadModule(historicSource, {
  imports: {
    'three/webgpu': THREE,
    './landmark-kit.js': kit,
    './city-config.js': cityConfig
  },
  globals: { Math, console }
});

// Authoritative heights sourced from GUGiK ISOK LiDAR DSM − DTM and architectural/conservation registers
// (docs/observations/landmarks-2026-11-05.md)
const HISTORIC_LANDMARKS = [
  { name: 'Biblioteka Raczyńskich', targetH: 18.6, id: 'bibliotekaraczynskich', district: 'Stare Miasto' },
  { name: 'Pałac Działyńskich', targetH: 22.25, id: 'palacdzialynskich', district: 'Stare Miasto' },
  { name: 'Hotel Bazar', targetH: 24.4, id: 'hotelbazar', district: 'Stare Miasto' },
  { name: 'Muzeum Narodowe', targetH: 26.0, id: 'muzeumnarodowe', district: 'Stare Miasto' },
  { name: 'Teatr Polski', targetH: 23.9, id: 'teatrpolski', district: 'Centrum' },
  { name: 'Collegium Maius', targetH: 36.4, id: 'collegiummaius', district: 'Centrum' },
  { name: 'Kościół Bernardynów', targetH: 44.7, id: 'kosciolbernardynow', district: 'Stare Miasto' },
  { name: 'Kościół Franciszkanów', targetH: 32.6, id: 'kosciolfranciszkanow', district: 'Stare Miasto' },
  { name: 'Kościół Najświętszej Marii Panny', targetH: 28.8, id: 'kosciolnmp', district: 'Ostrów Tumski' },
  { name: 'Kościół św. Wojciecha', targetH: 23.9, id: 'kosciolswwojciecha', district: 'Stare Miasto' },
  { name: 'Kościół Bożego Ciała', targetH: 39.5, id: 'kosciolbozegociala', district: 'Centrum' }
];

test('all 11 historic landmarks are registered in LANDMARK_SITES and CITY_LANDMARKS with Polish diacritics', () => {
  for (const { name, id, district } of HISTORIC_LANDMARKS) {
    const site = LANDMARK_SITES[name];
    assert.ok(site, `Site '${name}' exists in LANDMARK_SITES`);
    assert.ok(site.w > 0 && site.d > 0 && site.h > 0, `Site '${name}' has positive dimensions`);

    const pin = CITY_LANDMARKS.find((l) => l.id === id);
    assert.ok(pin, `Map pin with id '${id}' exists in CITY_LANDMARKS`);
    assert.equal(pin.district, district, `Pin '${id}' district matches '${district}'`);
    assert.equal(pin.x, site.x, `Pin '${id}' x matches site`);
    assert.equal(pin.z, site.z, `Pin '${id}' z matches site`);
  }
});

test('historic landmarks build and match documented LiDAR elevations within 0.2 m', () => {
  const group = new THREE.Group();
  const colliders = [];
  historic.buildHistoricLandmarks({ group, colliders, M });

  assert.equal(group.children.length, 11, 'emits 11 landmark building groups');

  for (const { name, targetH } of HISTORIC_LANDMARKS) {
    const site = LANDMARK_SITES[name];
    const lm = group.children.find((child) => {
      const box = new THREE.Box3().setFromObject(child);
      const cx = (box.min.x + box.max.x) / 2;
      const cz = (box.min.z + box.max.z) / 2;
      return Math.hypot(cx - site.x, cz - site.z) < 25;
    });
    assert.ok(lm, `Found built model on site for '${name}'`);

    const box = new THREE.Box3().setFromObject(lm);
    const height = box.max.y - box.min.y;
    assert.ok(
      Math.abs(height - targetH) < 0.2,
      `'${name}' height ${height.toFixed(2)} m matches target ${targetH} m`
    );
    assert.ok(
      Math.abs(box.max.y - targetH) < 0.2,
      `'${name}' top elevation ${box.max.y.toFixed(2)} m matches target ${targetH} m`
    );

    // Colliders on site
    const siteColliders = colliders.filter((c) => {
      const cx = (c.minX + c.maxX) / 2;
      const cz = (c.minZ + c.maxZ) / 2;
      return Math.hypot(cx - site.x, cz - site.z) < 55;
    });
    assert.ok(siteColliders.length > 0, `'${name}' has at least one player collider on site`);
    const maxY = Math.max(...siteColliders.map((c) => c.maxY));
    assert.ok(
      Math.abs(maxY - targetH) < 0.2,
      `'${name}' collider maxY ${maxY.toFixed(2)} m matches target ${targetH} m`
    );
  }
});

test('historic landmark models cover >= 75% of their OSM footprints and align top features with LiDAR', () => {
  const group = new THREE.Group();
  const colliders = [];
  historic.buildHistoricLandmarks({ group, colliders, M });
  group.updateMatrixWorld(true);

  function pip(x, z, r) {
    let ins = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, zi] = r[i], [xj, zj] = r[j];
      if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) ins = !ins;
    }
    return ins;
  }

  function hull(pts) {
    pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const p of pts) {
      while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop();
      lo.push(p);
    }
    for (const p of pts.reverse()) {
      while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop();
      up.push(p);
    }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }

  function getTopVertices(obj, threshold = 0.5) {
    let maxY = -Infinity;
    obj.traverse((n) => {
      if (n.isMesh && n.geometry && n.geometry.vertices) {
        for (const v of n.geometry.vertices) {
          const p = v.clone().applyMatrix4(n.matrixWorld);
          if (p.y > maxY) maxY = p.y;
        }
      }
    });
    const topPts = [];
    obj.traverse((n) => {
      if (n.isMesh && n.geometry && n.geometry.vertices) {
        for (const v of n.geometry.vertices) {
          const p = v.clone().applyMatrix4(n.matrixWorld);
          if (p.y >= maxY - threshold) topPts.push(p);
        }
      }
    });
    const avgX = topPts.reduce((s, p) => s + p.x, 0) / topPts.length;
    const avgZ = topPts.reduce((s, p) => s + p.z, 0) / topPts.length;
    return { maxY, avgX, avgZ, pts: topPts };
  }

  for (const { name } of HISTORIC_LANDMARKS) {
    const site = LANDMARK_SITES[name];
    const obj = group.children.find((child) => {
      const box = new THREE.Box3().setFromObject(child);
      const cx = (box.min.x + box.max.x) / 2;
      const cz = (box.min.z + box.max.z) / 2;
      return Math.hypot(cx - site.x, cz - site.z) < 25;
    });
    assert.ok(obj, `Found built model for '${name}'`);

    // 1. Footprint coverage: >= 75% of OSM polygon ring
    const ring = [];
    for (let i = 0; i < site.ring.length; i += 2) {
      ring.push([site.ring[i], site.ring[i + 1]]);
    }
    const polys = [];
    obj.traverse((n) => {
      if (n.isMesh && n.geometry && n.geometry.vertices) {
        const pts = n.geometry.vertices.map((v) => {
          const p = v.clone().applyMatrix4(n.matrixWorld);
          return [p.x, p.z];
        });
        polys.push(hull(pts));
      }
    });
    const xs = ring.map((p) => p[0]), zs = ring.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    const st = 0.5;
    let ringA = 0, meshIn = 0;
    for (let x = x0; x < x1; x += st) {
      for (let z = z0; z < z1; z += st) {
        if (pip(x, z, ring)) {
          ringA += st * st;
          if (polys.some((p) => pip(x, z, p))) meshIn += st * st;
        }
      }
    }
    const coverage = meshIn / ringA;
    assert.ok(
      coverage >= 0.75,
      `'${name}' covers ${(coverage * 100).toFixed(1)}% of OSM footprint (>= 75% required)`
    );

    // 2. Top feature orientation alignment with LiDAR observations
    const top = getTopVertices(obj, 0.5);
    if (name === 'Biblioteka Raczyńskich') {
      let colonnadeSouth = false;
      obj.traverse((n) => {
        if (n.isMesh && n.geometry instanceof THREE.CylinderGeometry) {
          const p = new THREE.Vector3().applyMatrix4(n.matrixWorld);
          if (p.z > site.z + 5) colonnadeSouth = true;
        }
      });
      assert.ok(colonnadeSouth, 'Biblioteka Raczyńskich colonnade faces south onto Plac Wolności');
    } else if (name === 'Pałac Działyńskich') {
      assert.ok(top.avgX > site.x + 15, 'Pałac Działyńskich pelican top faces east onto Stary Rynek');
    } else if (name === 'Hotel Bazar') {
      assert.ok(top.avgX > site.x + 20 && top.avgZ < site.z, 'Hotel Bazar rotunda dome is at north-east corner');
    } else if (name === 'Muzeum Narodowe') {
      const lidarMuzeum = [-294.0, 42.9];
      const dist = Math.hypot(top.avgX - lidarMuzeum[0], top.avgZ - lidarMuzeum[1]);
      assert.ok(
        dist < 8.0,
        `Muzeum Narodowe top is ${dist.toFixed(1)} m from LiDAR peak (-294.0, 42.9) (< 8 m required)`
      );
    } else if (name === 'Teatr Polski') {
      assert.ok(top.avgZ < site.z - 5, 'Teatr Polski top fly tower is in north strip');
    } else if (name === 'Collegium Maius') {
      assert.ok(top.avgZ > site.z + 10, 'Collegium Maius dome top is in south part on Fredry');
    } else if (name === 'Kościół Bernardynów') {
      assert.ok(top.avgX < site.x - 15, 'Kościół Bernardynów twin towers are at west end on Garbary');
    } else if (name === 'Kościół Franciszkanów') {
      assert.ok(top.avgX > site.x + 5, 'Kościół Franciszkanów towers are east of center');
    } else if (name === 'Kościół Najświętszej Marii Panny') {
      const topStrict = getTopVertices(obj, 0.2);
      const minX = Math.min(...topStrict.pts.map((p) => p.x));
      const maxX = Math.max(...topStrict.pts.map((p) => p.x));
      assert.ok(maxX - minX > 10, 'Kościół NMP ridge spans E-W along nave');
    } else if (name === 'Kościół św. Wojciecha') {
      assert.ok(top.avgX < site.x - 10, 'Kościół św. Wojciecha gable top is at west');
    } else if (name === 'Kościół Bożego Ciała') {
      assert.ok(Math.abs(top.avgX - site.x) < 5, 'Kościół Bożego Ciała flèche is at mid-length');
    }
  }
});

test('generic building blocks do not generate inside any historic landmark footprint', async () => {
  function inert() {
    const fn = function () {};
    const proxy = new Proxy(fn, {
      get(_t, key) {
        if (key === Symbol.toPrimitive) return () => 0;
        if (key === Symbol.iterator) return undefined;
        if (key === 'then') return undefined;
        return proxy;
      },
      set: () => true,
      apply: () => proxy,
      construct: () => proxy
    });
    return proxy;
  }

  const stub = inert();
  const { GEO } = await import('../js/geodata.js');
  const source = readFileSync(join(__dirname, '../js/buildings.js'), 'utf8');
  const { buildCityBlocks } = loadModule(source, {
    imports: {
      'three/webgpu': stub,
      'three/addons/utils/BufferGeometryUtils.js': stub,
      'three/tsl': stub,
      './balconies.js': stub,
      './tsl-materials.js': stub,
      './roofs.js': stub,
      './city-config.js': cityConfig,
      './geodata.js': { GEO },
      './city-grid.js': { pavedPlazaRects: [], parkTreeSites: [], sidewalkBlocks: [] }
    },
    globals: {
      console: { info() {}, log() {}, warn() {} }, document: stub, Math, Map, Set, WeakMap, Object, Array, Number, JSON,
      Infinity, NaN, Float32Array, Uint8Array, Uint16Array, Uint32Array, Int32Array
    },
    filename: 'buildings.js'
  });

  const city = buildCityBlocks(stub);

  const group = new THREE.Group();
  const lmColliders = [];
  historic.buildHistoricLandmarks({ group, colliders: lmColliders, M });

  // SAT 2D OBB intersection test
  function obbOverlap(a, b) {
    function corners(o) {
      if (!o.obb) {
        return [
          [o.minX, o.minZ], [o.maxX, o.minZ],
          [o.maxX, o.maxZ], [o.minX, o.maxZ]
        ];
      }
      const { cx, cz, hx, hz, cs, sn } = o.obb;
      return [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]].map(([lx, lz]) => [
        cx + lx * cs + lz * sn,
        cz - lx * sn + lz * cs
      ]);
    }
    const ca = corners(a), cb = corners(b);
    const axes = [];
    for (let i = 0; i < 4; i++) {
      const p1 = ca[i], p2 = ca[(i + 1) % 4];
      const edge = [p2[0] - p1[0], p2[1] - p1[1]];
      const normal = [-edge[1], edge[0]];
      const len = Math.hypot(normal[0], normal[1]);
      axes.push([normal[0] / len, normal[1] / len]);
    }
    for (let i = 0; i < 4; i++) {
      const p1 = cb[i], p2 = cb[(i + 1) % 4];
      const edge = [p2[0] - p1[0], p2[1] - p1[1]];
      const normal = [-edge[1], edge[0]];
      const len = Math.hypot(normal[0], normal[1]);
      axes.push([normal[0] / len, normal[1] / len]);
    }
    for (const [nx, nz] of axes) {
      let minA = Infinity, maxA = -Infinity;
      for (const [x, z] of ca) {
        const d = x * nx + z * nz;
        if (d < minA) minA = d; if (d > maxA) maxA = d;
      }
      let minB = Infinity, maxB = -Infinity;
      for (const [x, z] of cb) {
        const d = x * nx + z * nz;
        if (d < minB) minB = d; if (d > maxB) maxB = d;
      }
      if (maxA < minB + 0.1 || maxB < minA + 0.1) return false;
    }
    return true;
  }

  let collisions = 0;
  for (const lc of lmColliders) {
    for (const gc of city.colliders) {
      if (lc.minX < gc.maxX && lc.maxX > gc.minX && lc.minZ < gc.maxZ && lc.maxZ > gc.minZ) {
        if (obbOverlap(lc, gc)) {
          collisions++;
        }
      }
    }
  }
  assert.equal(collisions, 0, 'zero collisions between landmark colliders and generic building colliders');
});

test('no historic landmark mesh or player collider penetrates any roadway', () => {
  const group = new THREE.Group();
  const colliders = [];
  historic.buildHistoricLandmarks({ group, colliders, M });
  group.updateMatrixWorld(true);

  // 1. Check all player colliders
  for (const o of colliders) {
    const { cx, cz, hx, hz, cs, sn } = o.obb || {
      cx: (o.minX + o.maxX) / 2, cz: (o.minZ + o.maxZ) / 2,
      hx: (o.maxX - o.minX) / 2, hz: (o.maxZ - o.minZ) / 2, cs: 1, sn: 0
    };
    for (let u = -hx; u <= hx; u += 0.5) {
      for (let w = -hz; w <= hz; w += 0.5) {
        const x = cx + u * cs + w * sn;
        const z = cz - u * sn + w * cs;
        const r = cityConfig.roadClearance(x, z);
        assert.ok(
          r >= 0,
          `Historic landmark collider at (${cx.toFixed(1)}, ${cz.toFixed(1)}) penetrates roadway by ${(-r).toFixed(2)} m at (${x.toFixed(1)}, ${z.toFixed(1)})`
        );
      }
    }
  }

  // 2. Check all landmark mesh footprints
  function pip(x, z, r) {
    let ins = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, zi] = r[i], [xj, zj] = r[j];
      if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) ins = !ins;
    }
    return ins;
  }

  function hull(pts) {
    pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const p of pts) {
      while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop();
      lo.push(p);
    }
    for (const p of pts.reverse()) {
      while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop();
      up.push(p);
    }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }

  for (const ch of group.children) {
    const polys = [];
    ch.traverse((n) => {
      if (n.isMesh && n.geometry && n.geometry.vertices) {
        polys.push(hull(n.geometry.vertices.map((v) => {
          const p = v.clone().applyMatrix4(n.matrixWorld);
          return [p.x, p.z];
        })));
      }
    });
    const b = new THREE.Box3().setFromObject(ch);
    for (let x = b.min.x; x <= b.max.x; x += 0.5) {
      for (let z = b.min.z; z <= b.max.z; z += 0.5) {
        if (polys.some((p) => pip(x, z, p))) {
          const r = cityConfig.roadClearance(x, z);
          assert.ok(
            r >= 0,
            `Historic landmark mesh penetrates roadway by ${(-r).toFixed(2)} m at (${x.toFixed(1)}, ${z.toFixed(1)})`
          );
        }
      }
    }
  }
});

test('all 11 historic landmarks have lit-window geometry using M.glassLit', () => {
  const group = new THREE.Group();
  const colliders = [];
  historic.buildHistoricLandmarks({ group, colliders, M });

  for (const { name } of HISTORIC_LANDMARKS) {
    const site = LANDMARK_SITES[name];
    const lm = group.children.find((child) => {
      const box = new THREE.Box3().setFromObject(child);
      const cx = (box.min.x + box.max.x) / 2;
      const cz = (box.min.z + box.max.z) / 2;
      return Math.hypot(cx - site.x, cz - site.z) < 25;
    });
    assert.ok(lm, `Found built model for '${name}'`);

    const mats = new Set();
    lm.traverse((n) => {
      if (n.isMesh && n.material) mats.add(n.material);
    });
    assert.ok(
      mats.has(M.glassLit),
      `'${name}' contains meshes with lit window material M.glassLit for night glow`
    );
  }
});

test('lit window panes carry a per-pane seed in UV (all vertices of a pane share it; distinct panes differ)', () => {
  const group = new THREE.Group();
  const colliders = [];
  historic.buildHistoricLandmarks({ group, colliders, M });

  let totalPanes = 0;
  const seenSeeds = new Set();

  group.traverse((n) => {
    if (!n.isMesh || n.material !== M.glassLit) return;
    const pos = n.geometry.attributes.position.array;
    const uv = n.geometry.attributes.uv.array;
    const count = n.geometry.attributes.position.count;
    let i = 0;
    while (i < count) {
      const x0 = pos[i * 3], y0 = pos[i * 3 + 1], z0 = pos[i * 3 + 2];
      const u0 = uv[i * 2];
      const v0 = uv[i * 2 + 1];
      while (i < count) {
        for (let k = 0; k < 3; k++) {
          const u = uv[(i + k) * 2];
          const v = uv[(i + k) * 2 + 1];
          assert.equal(u, u0, `All vertices of a pane must share the same seed (vertex has ${u}, expected ${u0})`);
          assert.equal(v, v0, `All vertices of a pane must share the same lit share`);
        }
        i += 3;
        if (i < count) {
          const nx = pos[i * 3], ny = pos[i * 3 + 1], nz = pos[i * 3 + 2];
          if (Math.hypot(nx - x0, ny - y0, nz - z0) > 1e-4) break; // fan apex changed -> new pane!
        }
      }
      totalPanes++;
      assert.ok(!seenSeeds.has(u0), `Pane seed ${u0} must be unique across distinct panes`);
      seenSeeds.add(u0);
    }
  });

  assert.equal(totalPanes, 986, 'all 986 modelled window panes are identified');
  assert.equal(seenSeeds.size, 986, 'every pane has a distinct seed');
});

test('createLitWindowMaterial uses uInteriorGlow, UV per-pane hash and vertex lit probability', () => {
  const source = readFileSync(join(__dirname, '../js/tsl-materials.js'), 'utf8');
  const start = source.indexOf('function createLitWindowMaterial');
  const end = source.indexOf('function createFacadeBoxes', start);
  assert.ok(start >= 0 && end > start, 'createLitWindowMaterial definition exists in tsl-materials.js');

  class Node {
    constructor(name) { this.name = name; }
    div() { return this; }
    mul() { return this; }
    add() { return this; }
    sub() { return this; }
  }
  const node = (name) => new Node(name);

  const cityUniforms = { uInteriorGlow: node('uInteriorGlow') };
  const calls = [];
  const uvNode = { x: node('uvX'), y: node('uvY') };
  const context = {
    THREE: { MeshStandardNodeMaterial: class { constructor(opts) { Object.assign(this, opts); } } },
    cityUniforms,
    uv: () => { calls.push('uv'); return uvNode; },
    floor: (n) => { calls.push('floor'); return n; },
    fract: (n) => { calls.push('fract'); return n; },
    vec2: (a, b) => node('vec2'),
    color: (c) => node('color'),
    float: (f) => node('float'),
    step: (edge, x) => { calls.push('step'); return node('step'); },
    mix: (x, y, a) => { calls.push('mix'); return node('mix'); },
    smoothstep: (min, max, x) => { calls.push('smoothstep'); return node('smoothstep'); },
    hash2D: (p) => { calls.push('hash2D'); return node('hash2D'); }
  };

  const fnText = source.slice(start, end);
  const fn = vm.runInNewContext('(() => { let _litWindowMat = null; ' + fnText + '; return createLitWindowMaterial; })()', context);

  const mat = fn();
  assert.ok(mat.userData.usesInteriorGlow, 'material flags usage of uInteriorGlow');
  assert.ok(mat.isLitWindow, 'material marks isLitWindow');
  assert.ok(calls.includes('uv'), 'material reads uv() for pane seed and lit probability');
  assert.ok(calls.includes('hash2D'), 'material computes per-pane cellHash via hash2D');
  assert.ok(calls.includes('smoothstep'), 'material uses smoothstep for night fade');
  assert.ok(mat.emissiveNode, 'material assigns emissiveNode');
});
