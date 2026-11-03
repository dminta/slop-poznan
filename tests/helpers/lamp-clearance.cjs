// Shared helper for lamp curb clearance measurement and headless regression tests.
// Audits all street-details (main, side, gas) and city-grid (park, plaza) lamps
// against the raised sidewalk/plaza/park-walk curb boundary.
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { loadModule } = require('./module.cjs');

function inert() {
  const values = {};
  return new Proxy(function () {}, {
    get(_target, key) {
      if (key === Symbol.iterator) return function* () {};
      if (key === Symbol.toPrimitive) return () => 0;
      if (key === 'then') return undefined;
      return key in values ? values[key] : (values[key] = inert());
    },
    set(_target, key, value) { values[key] = value; return true; },
    apply: () => inert(), construct: () => inert()
  });
}

function auditCityLamps({ root = join(__dirname, '../..'), before = false } = {}) {
  const source = (name) => readFileSync(join(root, 'js', name + '.js'), 'utf8');

  const config = require(join(root, 'js/city-config.js'));
  const { GEO } = require(join(root, 'js/geodata.js'));
  const rendering = {
    'three/webgpu': inert(),
    'three/tsl': inert(),
    'three/addons/utils/BufferGeometryUtils.js': inert(),
    './tsl-materials.js': inert()
  };
  const globals = { document: inert(), console: { info() {}, warn() {}, log() {} } };

  const road = loadModule(source('road-network'), {
    imports: { './city-config.js': config, './geodata.js': { GEO } },
    globals
  });

  let gridSource = source('city-grid');
  if (before) {
    const { execSync } = require('node:child_process');
    gridSource = execSync('git show HEAD:js/city-grid.js', { encoding: 'utf8' });
  }

  const __lamps = [];
  const gridModule = loadModule(
    gridSource
      .replace(
        'lampMatrices.push(new THREE.Matrix4().makeTranslation(x, y, z));',
        'lampMatrices.push(new THREE.Matrix4().makeTranslation(x, y, z));\n __lamps.push({ x, y, z });'
      ) +
      '\nexport function snapshot() { return { pavedPlazaRects, parkTreeSites, parkLampSites, sidewalkBlocks }; }',
    {
      imports: { ...rendering, './city-config.js': config, './geodata.js': { GEO } },
      globals: { ...globals, __lamps }
    }
  );

  gridModule.buildCityGrid(inert());
  const liveGrid = { ...gridModule, ...gridModule.snapshot() };

  // 1. Load street-details lamps
  let streetCode = source('street-details');
  if (before) {
    const { execSync } = require('node:child_process');
    streetCode = execSync('git show HEAD:js/street-details.js', { encoding: 'utf8' });
  }

  const __cap = [];
  const captureInjection = streetCode
    .replace(
      'mastMatrices.push(dummy.matrix.clone());',
      'mastMatrices.push(dummy.matrix.clone());\n __cap.push({ type: cls, x: lx, z: lz, r: 0.14 * scale, fpHalf: 0.225, ox: outX, oz: outZ, hx: headX, hz: headZ });'
    )
    .replace(
      'gasPostMatrices.push(dummy.matrix.clone());',
      'gasPostMatrices.push(dummy.matrix.clone());\n __cap.push({ type: "gas", x: px, z: pz, r: 0.20, fpHalf: 0.20 });'
    );

  loadModule(captureInjection, {
    imports: {
      ...rendering,
      './city-config.js': config,
      './road-network.js': road,
      './city-grid.js': liveGrid,
      './trees.js': { createTreeField: () => ({ group: inert() }) }
    },
    globals: { ...globals, __cap }
  }).buildStreetDetails(inert());

  // 2. Combine all lamps
  const allLamps = [];
  for (const s of __lamps) {
    const isPark = Math.abs(s.y - 0.26) < 1e-3 || Math.abs(s.y - 0.41) < 1e-3; // park walk or lawn (narrow walks)
    allLamps.push({
      type: isPark ? 'park' : 'plaza',
      x: s.x,
      z: s.z,
      r: 0.20,
      fpHalf: 0.20
    });
  }
  allLamps.push(...__cap);

  // 3. Raised surface membership and curb distance
  const { blockAt, UNDERPASS_SIDEWALKS } = config;
  const plazas = gridModule.pavedPlazas().map((p) => p.ring);
  const pip = (ring, x, z) => {
    let ins = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j], b = ring[i];
      if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) ins = !ins;
    }
    return ins;
  };
  const plazaBox = plazas.map((r) => {
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const p of r) {
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
      z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
    }
    return [x0, x1, z0, z1];
  });

  const raised = (x, z) => {
    if (blockAt(x, z)) return true;
    for (let i = 0; i < plazas.length; i++) {
      const b = plazaBox[i];
      if (x >= b[0] && x <= b[1] && z >= b[2] && z <= b[3] && pip(plazas[i], x, z)) return true;
    }
    for (const s of UNDERPASS_SIDEWALKS || []) {
      if (pip(s.poly, x, z)) return true;
    }
    return false;
  };

  const N = 48;
  const curbDist = (x, z) => {
    if (!raised(x, z)) return 0;
    let prev = 0;
    for (let r = 0.05; r <= 3.0001; r += 0.05) {
      let hit = -1;
      for (let k = 0; k < N; k++) {
        const a = (k / N) * 2 * Math.PI;
        if (!raised(x + Math.cos(a) * r, z + Math.sin(a) * r)) {
          hit = k;
          break;
        }
      }
      if (hit >= 0) {
        let lo = prev, hi = r;
        const a = (hit / N) * 2 * Math.PI;
        for (let it = 0; it < 8; it++) {
          const m = (lo + hi) / 2;
          if (raised(x + Math.cos(a) * m, z + Math.sin(a) * m)) lo = m;
          else hi = m;
        }
        return hi;
      }
      prev = r;
    }
    return 3;
  };

  // 4. Measure clearances
  const auditResults = [];
  const byType = {};

  for (const lamp of allLamps) {
    const isRaised = raised(lamp.x, lamp.z);
    const d = curbDist(lamp.x, lamp.z);
    const poleClearance = isRaised ? d - lamp.r : -lamp.r;
    const footprintClearance = isRaised ? d - lamp.fpHalf : -lamp.fpHalf;

    const record = {
      lamp,
      r: lamp.r,
      fpHalf: lamp.fpHalf,
      dist: d,
      onSurface: isRaised,
      poleClearance,
      footprintClearance
    };
    auditResults.push(record);

    const t = byType[lamp.type] || (byType[lamp.type] = {
      count: 0,
      overlapCurbStone: 0,
      footprintOverlapCurbStone: 0,
      clearanceLt0: 0,
      clearanceLt03: 0,
      clearanceLt05: 0,
      clearance05To08: 0,
      clearanceGt08: 0,
      worst: []
    });

    t.count++;
    if (!isRaised || d < 0.25) t.overlapCurbStone++;
    if (!isRaised || d < lamp.fpHalf) t.footprintOverlapCurbStone++;
    if (poleClearance < 0) t.clearanceLt0++;
    if (poleClearance < 0.30) t.clearanceLt03++;
    if (poleClearance < 0.50) t.clearanceLt05++;
    else if (poleClearance <= 0.80) t.clearance05To08++;
    else t.clearanceGt08++;

    t.worst.push(record);
  }

  for (const t of Object.values(byType)) {
    t.worst.sort((a, b) => a.poleClearance - b.poleClearance);
  }

  return {
    allLamps,
    auditResults,
    byType,
    raised,
    curbDist
  };
}

module.exports = { auditCityLamps };
