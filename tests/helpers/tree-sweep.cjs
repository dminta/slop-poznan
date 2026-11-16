const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { loadModule } = require('./module.cjs');

// Shared by tests/tree-sweep.test.cjs and tools/bench-tree-sweep.mjs: loads js/trees.js in the vm harness, holds the
// original full-sweep loop as the reference, and generates the recorded-style camera paths.

function loadTrees() {
  const stub = new Proxy({}, { get: () => function Stub() { return {}; } });
  return loadModule(readFileSync(join(__dirname, '../../js/trees.js'), 'utf8'), {
    imports: {
      'three/webgpu': stub,
      './tsl-materials.js': { createTreeMaterial: () => ({}) },
      './city-config.js': require('../../js/city-config.js')
    },
    globals: { document: {}, Math, Array, Uint8Array, Uint32Array, Float32Array, Float64Array, Int32Array, Map, Set, Infinity },
    filename: 'trees.js'
  });
}

const LOD_HYSTERESIS = 6;

// The sweep functions cut out of js/trees.js and evaluated in this realm: code inside the vm context pays for every
// Math.* lookup through the context's global proxy (about 3x slower), which would skew a timing comparison against
// the reference loop below.
function loadSweepNative() {
  const source = readFileSync(join(__dirname, '../../js/trees.js'), 'utf8');
  const a = source.indexOf('// Level of a tree at distance d');
  const b = source.indexOf('/**\n * Builds the instanced tree field');
  return new Function('LOD_HYSTERESIS', `${source.slice(a, b)}\nreturn { createLevelSweep, levelAt };`)(LOD_HYSTERESIS);
}

// The pre-incremental update() loop of js/trees.js, verbatim apart from the arguments. apply(i, prev, next) stands
// for the farRemove/farAdd/dirty-cell block.
function fullSweep(profile, px, py, pz, tier, lod, cx, cy, cz, apply) {
  const low = cy < 40;
  let changed = 0;
  for (let i = 0; i < px.length; i++) {
    const dx = px[i] - cx;
    const dy = py[i] - cy;
    const dz = pz[i] - cz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const maxD = low ? Math.min(profile.maxDist[tier[i]], profile.streetCutoff) : profile.maxDist[tier[i]];
    const curL = lod[i] === 255 ? 3 : lod[i];
    let nextL = d < profile.lodNear ? 0 : d < profile.lodMid ? 1 : d < maxD ? 2 : 3;
    if (Math.abs(nextL - curL) === 1) {
      const edge = [profile.lodNear, profile.lodMid, maxD][Math.min(nextL, curL)];
      if (Math.abs(d - edge) < LOD_HYSTERESIS) nextL = curL;
    }
    const next = nextL === 3 ? 255 : nextL;
    const prev = lod[i];
    if (next !== prev) {
      lod[i] = next;
      apply(i, prev, next);
      changed++;
    }
  }
  return changed;
}

// Deterministic city-like field: dense clusters (parks, streets) inside the 8 x 6 km box plus a sparse scatter.
function syntheticField(n, seed = 7) {
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const centres = Array.from({ length: 60 }, () => [(rnd() - 0.5) * 7000, (rnd() - 0.5) * 6000, 30 + rnd() * 250]);
  const px = new Float32Array(n);
  const py = new Float32Array(n);
  const pz = new Float32Array(n);
  const tier = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (rnd() < 0.15) {
      px[i] = (rnd() - 0.5) * 8000;
      pz[i] = (rnd() - 0.5) * 6500;
    } else {
      const c = centres[Math.floor(rnd() * centres.length)];
      px[i] = c[0] + (rnd() + rnd() + rnd() - 1.5) * c[2] * 3;
      pz[i] = c[1] + (rnd() + rnd() + rnd() - 1.5) * c[2] * 3;
    }
    py[i] = rnd() * 3 + 5 + (rnd() < 0.02 ? rnd() * 20 : 0);
    tier[i] = Math.floor(rnd() * 3);
  }
  return { px, py, pz, tier };
}

const lerp = (a, b, t) => a + (b - a) * t;

// Polyline sampled every `step` metres of travel
function along(points, step) {
  const out = [];
  for (let k = 0; k + 1 < points.length; k++) {
    const [a, b] = [points[k], points[k + 1]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const n = Math.max(1, Math.round(len / step));
    for (let s = 0; s < n; s++) out.push([lerp(a[0], b[0], s / n), lerp(a[1], b[1], s / n), lerp(a[2], b[2], s / n)]);
  }
  out.push(points[points.length - 1]);
  return out;
}

// Camera paths (one [x, y, z] per frame). The flight is 660 frames wp5 -> Rynek through 11 poses.
function cameraPaths() {
  const wp5 = [-240, 40, -3200];
  const rynek = [22, 7, 58];
  const poses = Array.from({ length: 11 }, (_, k) => {
    const t = k / 10;
    return [lerp(wp5[0], rynek[0], t), lerp(wp5[1], rynek[1], t) + Math.sin(t * Math.PI) * 120, lerp(wp5[2], rynek[2], t)];
  });
  const flight = [];
  for (let f = 0; f < 660; f++) {
    const u = (f / 659) * 10;
    const k = Math.min(9, Math.floor(u));
    flight.push([0, 1, 2].map((c) => lerp(poses[k][c], poses[k + 1][c], u - k)));
  }
  const orbit = Array.from({ length: 720 }, (_, f) => {
    const a = (f / 720) * Math.PI * 2;
    return [-1100 + Math.cos(a) * 450, 320 + Math.sin(a * 3) * 90, 900 + Math.sin(a) * 450];
  });
  // 15 m/s at 60 fps = 0.25 m per frame, along streets of the old town and out to Jeżyce
  const driving = along([[22, 1.6, 140], [22, 1.6, -600], [-700, 1.6, -600], [-700, 1.6, 600], [800, 1.6, 600]], 0.25);
  // Wanders across the y = 40 switch, up and down, near the centre and over open land
  const crossing = Array.from({ length: 900 }, (_, f) => [
    -600 + f * 1.5, 40 + Math.sin(f / 15) * 25, 300 + Math.sin(f / 90) * 500]);
  const exact = Array.from({ length: 200 }, (_, f) => [200 + f * 6, f % 2 ? 40 : 39.999, -100]); // sits on y = 40
  return { flight, orbit, driving, crossing, exact };
}

// The low tier's tree profile straight from the preset table (pure data, js/graphics-quality.js)
function lowTreeSettings() {
  const source = readFileSync(join(__dirname, '../../js/graphics-quality.js'), 'utf8');
  return loadModule(source, { filename: 'graphics-quality.js' }).QUALITY_TIERS.low.trees;
}

module.exports = { lowTreeSettings, loadSweepNative, loadTrees, fullSweep, syntheticField, cameraPaths, LOD_HYSTERESIS };
