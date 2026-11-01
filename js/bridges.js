import * as THREE from 'three/webgpu';
import {
  Fn,
  float,
  vec2,
  vec3,
  positionWorld,
  normalWorld,
  sin,
  abs,
  floor,
  fract,
  max,
  clamp,
  mix,
  smoothstep,
  dot,
  fwidth,
  select,
  uniform
} from 'three/tsl';
import { cityUniforms, createRoadSurfaceMaterial, createSidewalkMaterial, createCurbMaterial } from './tsl-materials.js';
import { BRIDGES, CITY_BOUNDS, ROADS, RAIL, waterAt } from './city-config.js';
import { GEO } from './geodata.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// js/bridges.js
// The bridges of the detailed core, built from the bridge-flagged road-graph links (city-config BRIDGES). Bridges are
// drivable, walkable, tram-carrying decks at street level (docs/poznan-plan.md D7): the road graph stays flat, so every
// deck's roadway sits at y ≈ 0 on its link, with the Warta CITY_BOUNDS.waterLevel (-3 m) below. city-grid.js draws its
// road deck only over land, so over the water the bridge deck itself is the drivable surface (a hair under the road
// paint); the structure is scenery under and beside it. Three parametric kinds:
// - tied steel arch (Most Bolesława Chrobrego): one arch rib per side over the main channel, hangers to the tie girders
// - girder / box beam (Most Świętego Rocha, Most Królowej Jadwigi, Most Mieszka I and the default over water): a
//   haunched box girder on arched concrete wall piers
// - overpass (Most Dworcowy, Most Teatralny, Most Uniwersytecki over the rail yard, and the default over land): with the
//   graph flat, only the parapets and lamps show above the street
// The player collides with the parapets only; the roadway and the sidewalks stay clear for traffic and pedestrians.

// =====================================================================================================================
// 1. HELPERS & MATERIALS
// =====================================================================================================================

const toLinear = (c) => Math.pow(c, 2.2);
const srgb = (r, g, b) => vec3(toLinear(r), toLinear(g), toLinear(b));
// The same as a uniform: materials that differ only by such values share one shader
const srgbUniform = (r, g, b) => uniform(new THREE.Vector3(toLinear(r), toLinear(g), toLinear(b)));

function smooth01(t) {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

const hash12 = Fn(([p]) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)));

const valueNoise = Fn(([p]) => {
  const pv = vec2(p).toVar();
  const i = floor(pv).toVar();
  const f = fract(pv).toVar();
  const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0))).toVar();
  const a = hash12(i);
  const b = hash12(i.add(vec2(1.0, 0.0)));
  const c = hash12(i.add(vec2(0.0, 1.0)));
  const d = hash12(i.add(vec2(1.0, 1.0)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
});

// Box-filtered periodic pulse (fraction of a footprint `w` around `x` where fract() lies in [a, b]), so courses never
// shimmer at distance
const boxPulse = Fn(([x, a, b, w]) => {
  const p = float(x).toVar();
  const lo = float(a).toVar();
  const hi = float(b).toVar();
  const hw = max(float(w), 0.0001).mul(0.5).toVar();
  const integral = (t) => floor(t).mul(hi.sub(lo)).add(clamp(fract(t), lo, hi).sub(lo));
  return integral(p.add(hw)).sub(integral(p.sub(hw))).div(hw.mul(2.0));
});

// 0 by day, ~0.75 at blue hour, 1 at night
const nightFactorNode = () => smoothstep(0.7, 1.45, cityUniforms.uInteriorGlow);

// Stone / concrete / painted steel (sRGB swatch) with a little world-space weathering, optional block coursing (course
// height in metres) and optional night floodlighting. The swatch & amounts are uniforms, so every coursed (or plain)
// and floodlit (or not) surface shares one shader
function createLandmarkMaterial(rgb, { roughness = 0.8, metalness = 0.0, flood = 0.0, noise = 0.18, courses = 0 } = {}) {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness, metalness });
  const base = srgbUniform(rgb[0], rgb[1], rgb[2]);
  const uNoise = uniform(noise);
  const n = valueNoise(positionWorld.xz.mul(0.35).add(positionWorld.y.mul(0.21)));
  const streak = valueNoise(vec2(positionWorld.x.add(positionWorld.z).mul(1.3), positionWorld.y.mul(0.06)));
  let col = base.mul(float(1.0).sub(uNoise).add(n.mul(uNoise.mul(1.2))).mul(mix(float(0.9), float(1.06), streak)));
  if (courses > 0) {
    const uCourses = uniform(courses);
    const cv = positionWorld.y.div(uCourses).toVar();
    const row = floor(cv);
    const along = select(abs(normalWorld.x).greaterThan(abs(normalWorld.z)), positionWorld.z, positionWorld.x);
    const cu = along.div(uCourses.mul(2.3)).add(row.mul(0.5)).toVar();
    const joint = boxPulse(cv, 0.0, 0.92, fwidth(cv)).mul(boxPulse(cu, 0.0, 0.965, fwidth(cu)));
    col = col.mul(mix(float(0.7), float(1.0), joint)).mul(hash12(vec2(floor(cu), row)).mul(0.16).add(0.92));
  }
  // Wet, algae-darkened concrete up to half a metre above the river
  const wet = float(1.0).sub(smoothstep(CITY_BOUNDS.waterLevel + 0.1, CITY_BOUNDS.waterLevel + 0.6, positionWorld.y));
  mat.colorNode = mix(col, col.mul(srgb(0.45, 0.5, 0.42)), wet.mul(0.8));
  if (flood > 0) mat.emissiveNode = col.mul(vec3(1.0, 0.86, 0.68)).mul(nightFactorNode().mul(uniform(flood)));
  return mat;
}

function createBridgeMaterials() {
  const lamp = new THREE.MeshStandardNodeMaterial({ roughness: 0.4, metalness: 0.0 });
  lamp.colorNode = srgb(0.62, 0.61, 0.58);
  lamp.emissiveNode = vec3(1.0, 0.88, 0.66).mul(nightFactorNode().mul(9.0));
  const glass = new THREE.MeshStandardNodeMaterial({ roughness: 0.1, metalness: 0.5 });
  glass.colorNode = srgb(0.18, 0.28, 0.32);
  return {
    lamp,
    deck: createLandmarkMaterial([0.58, 0.57, 0.54], { roughness: 0.9, noise: 0.14 }),
    pier: createLandmarkMaterial([0.62, 0.61, 0.58], { roughness: 0.92, noise: 0.16, flood: 0.05, courses: 1.2 }),
    girder: createLandmarkMaterial([0.52, 0.53, 0.52], { roughness: 0.85, noise: 0.12 }),
    arch: createLandmarkMaterial([0.86, 0.86, 0.84], { roughness: 0.5, metalness: 0.05, noise: 0.08, flood: 0.12 }),
    redArch: createLandmarkMaterial([0.62, 0.16, 0.16], { roughness: 0.45, metalness: 0.1, noise: 0.08, flood: 0.12 }),
    railing: createLandmarkMaterial([0.22, 0.25, 0.24], { roughness: 0.55, metalness: 0.3, noise: 0.08 }),
    glass,
    road: createRoadSurfaceMaterial(),
    sidewalk: createSidewalkMaterial(),
    curb: createCurbMaterial()
  };
}

// Instanced "beam" sets: every member is a unit box stretched between two points (one InstancedMesh per material)
function createBeamSet() {
  const sets = new Map();
  const X = new THREE.Vector3();
  const Y = new THREE.Vector3();
  const Z = new THREE.Vector3();
  const U = new THREE.Vector3();
  const mid = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  const push = (material, m) => {
    let arr = sets.get(material);
    if (!arr) sets.set(material, (arr = []));
    arr.push(m);
  };
  return {
    // Member from p0 to p1; `a` = thickness along the member's up-ish axis, `b` = along its side axis
    beam(material, p0, p1, a, b, ref = null) {
      X.subVectors(p1, p0);
      const len = X.length();
      if (len < 1e-4) return;
      X.multiplyScalar(1 / len);
      U.copy(ref || (Math.abs(X.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : UP));
      Z.crossVectors(X, U);
      if (Z.lengthSq() < 1e-8) Z.set(0, 0, 1);
      Z.normalize();
      Y.crossVectors(Z, X);
      const m = new THREE.Matrix4().makeBasis(X.clone().multiplyScalar(len), Y.clone().multiplyScalar(a), Z.clone().multiplyScalar(b));
      mid.addVectors(p0, p1).multiplyScalar(0.5);
      m.setPosition(mid);
      push(material, m);
    },
    // Axis-aligned-to-bridge block centred at p (size along the bridge, vertical, across)
    block(material, p, dir, along, h, across) {
      const m = new THREE.Matrix4().makeBasis(
        new THREE.Vector3(dir.x, 0, dir.z).multiplyScalar(along),
        new THREE.Vector3(0, h, 0),
        new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(across)
      );
      m.setPosition(p);
      push(material, m);
    },
    build(parent, name, shadowMats = new Set()) {
      const geo = new THREE.BoxGeometry(1, 1, 1);
      for (const [material, mats] of sets) {
        const mesh = new THREE.InstancedMesh(geo, material, mats.length);
        mats.forEach((m, i) => mesh.setMatrixAt(i, m));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.castShadow = shadowMats.has(material);
        mesh.receiveShadow = false;
        mesh.name = name;
        parent.add(mesh);
      }
    }
  };
}

// Collects static parts per material and merges them into one mesh per material (few draw calls)
function createPartCollector() {
  const buckets = new Map();
  const add = (material, geometry, matrix) => {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    for (const key of Object.keys(g.attributes)) if (key !== 'position' && key !== 'normal') g.deleteAttribute(key);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (matrix) g.applyMatrix4(matrix);
    let arr = buckets.get(material);
    if (!arr) buckets.set(material, (arr = []));
    arr.push(g);
  };
  return {
    add,
    // Flat horizontal quad (corners in order around it, either way round) facing up
    flat(material, corners) {
      const [c0, c1, c2] = corners;
      const up = (c1.z - c0.z) * (c2.x - c0.x) - (c1.x - c0.x) * (c2.z - c0.z) > 0;
      const pos = [];
      for (const k of up ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]) pos.push(corners[k].x, corners[k].y, corners[k].z);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const nrm = new Float32Array(pos.length);
      for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
      g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      add(material, g, null);
    },
    build(parent, name, { castShadow = false, receiveShadow = false } = {}) {
      for (const [material, geos] of buckets) {
        const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
        if (!merged) continue;
        const mesh = new THREE.Mesh(merged, material);
        mesh.name = name;
        mesh.castShadow = castShadow;
        mesh.receiveShadow = receiveShadow;
        parent.add(mesh);
      }
    }
  };
}

function bridgeFrame(spec) {
  const ax = spec.a.x;
  const az = spec.a.z;
  const dx = spec.b.x - ax;
  const dz = spec.b.z - az;
  const L = Math.hypot(dx, dz);
  const dir = new THREE.Vector3(dx / L, 0, dz / L);
  const side = new THREE.Vector3(-dir.z, 0, dir.x);
  // Point at fraction t along the bridge, lateral offset s, height y
  const at = (t, s = 0, y = 0) => new THREE.Vector3(ax + dx * t + side.x * s, y, az + dz * t + side.z * s);
  return { L, dir, side, at };
}

// Height profile over a span (t in [0, 1]): ramps up to deckY·rampFrac by r1, a sine crown up to deckY between r1 and
// r2, ramps down after r2. The decks here are flat (D7), so it shapes the arch ribs: r1 = 0, r2 = 1, rampFrac = 0 is a
// plain sine arch of rise deckY.
function makeDeckProfile(spec, r1, r2, rampFrac) {
  const yR = spec.deckY * rampFrac;
  const ease = (x) => 0.55 * x + 0.45 * smooth01(x);
  return (t) => {
    if (t <= 0 || t >= 1) return 0;
    if (t < r1) return yR * ease(t / r1);
    if (t > r2) return yR * ease((1 - t) / (1 - r2));
    return yR + (spec.deckY - yR) * Math.sin((Math.PI * (t - r1)) / (r2 - r1));
  };
}

// Collider for a bridge part: an oriented box (centre p at ground level, sizes along / across `dir`, from y = 0 to
// maxY) in pieces no longer than ~20 m, so the broad phase's world AABBs of slanted parapets stay small. Oriented
// colliders never become traffic obstacles (main.js), so parapets cannot delete lanes.
function addBridgeCollider(colliders, p, dir, along, across, maxY) {
  const na = Math.max(1, Math.ceil(along / 20));
  const a = along / na;
  const hx = a * 0.5;
  const hz = across * 0.5;
  // buildingContact's local frame: lx = dx·cs - dz·sn along the bridge, lz = dx·sn + dz·cs across it
  const cs = dir.x;
  const sn = -dir.z;
  const ex = Math.abs(cs) * hx + Math.abs(sn) * hz;
  const ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
  for (let i = 0; i < na; i++) {
    const u = -along * 0.5 + a * (i + 0.5);
    const cx = p.x + dir.x * u;
    const cz = p.z + dir.z * u;
    colliders.push({ minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, minY: 0, maxY, obb: { cx, cz, hx, hz, cs, sn } });
  }
}

// Semicircular arch opening in a wall's plane
function roundArchPath(cx, y0, halfW, springY, n = 8) {
  const pts = [new THREE.Vector2(cx - halfW, y0), new THREE.Vector2(cx + halfW, y0)];
  for (let k = 0; k <= n; k++) {
    const a = (Math.PI * k) / n;
    pts.push(new THREE.Vector2(cx + halfW * Math.cos(a), springY + halfW * Math.sin(a)));
  }
  return new THREE.Path(pts);
}

// Pointed (lancet) arch opening in a wall's plane (no Poznań structure uses one yet)
function pointedArchPath(cx, y0, halfW, springY, apexY, n = 7) {
  const rise = apexY - springY;
  const c = (rise * rise - halfW * halfW) / (2 * halfW);
  const R = halfW + c;
  const ta = Math.acos(c / R);
  const pts = [new THREE.Vector2(cx - halfW, y0), new THREE.Vector2(cx + halfW, y0)];
  for (let k = 0; k <= n; k++) {
    const a = (ta * k) / n;
    pts.push(new THREE.Vector2(cx - c + R * Math.cos(a), springY + R * Math.sin(a)));
  }
  for (let k = 1; k <= n; k++) {
    const a = Math.PI - ta + (ta * k) / n;
    pts.push(new THREE.Vector2(cx + c + R * Math.cos(a), springY + R * Math.sin(a)));
  }
  return new THREE.Path(pts);
}

// =====================================================================================================================
// 2. STRUCTURES FROM THE ROAD GRAPH
// =====================================================================================================================

const DECK_Y = -0.01; // roadway top: under the road paint (+0.012), under city-grid's land deck (0) where they overlap
const SIDEWALK_W = 1.9; // per side, outside the carriageway; the parapet's inner face sits inside isLand's w/2 + 2 m
const SIDEWALK_TOP = 0.2;
const PARAPET_H = 1.15;
const PIER_FOOT_Y = CITY_BOUNDS.waterLevel - 1.5;
// The roadway runs this far past the water on both banks, hidden under city-grid's land deck where the bank is flat and
// carrying the road where the embankment falls away below street level (the land raster's deck corridors reach 15 m)
const DECK_REACH = 15;

// Kinds by name (the real structures); unnamed or unlisted links pick by what they cross
const KIND_BY_NAME = {
  'Most Bolesława Chrobrego': 'arch',
  'Most Biskupa Jordana': 'arch',
  'Kładka Bramy Poznania': 'covered',
  'Mosty Berdychowskie': 'girder',
  'Most Świętego Rocha': 'girder',
  'Most Królowej Jadwigi': 'girder',
  'Most Mieszka I': 'girder',
  'Most Dworcowy': 'overpass',
  'Most Teatralny': 'overpass',
  'Most Uniwersytecki': 'overpass'
};

/**
 * The bridge structures: each name's links merged where they are parallel and side by side or end to end (dual
 * carriageways, a bridge split into pieces by junction nodes). Each structure is one straight axis a -> b through the
 * middle of its links with the carriageway width W across all of them, plus the stretch of the axis over water
 * ([w0, w1] in metres from a; null over land) sampled from the water polygons: city-config's isWater is false on deck
 * cells, so waterAt is the test.
 */
function bridgeStructures() {
  const out = [];
  for (const br of BRIDGES) {
    const links = br.links.map((l) => {
      const a = l.pts[0];
      const b = l.pts[l.pts.length - 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      return { ...l, a, b, len, ux: (b.x - a.x) / (len || 1), uz: (b.z - a.z) / (len || 1) };
    }).filter((l) => l.len > 1);
    const parent = links.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const joinable = (p, q) => {
      if (Math.abs(p.ux * q.uz - p.uz * q.ux) > 0.17) return false;
      const lat = (pt) => (pt.x - p.a.x) * -p.uz + (pt.z - p.a.z) * p.ux;
      const lon = (pt) => (pt.x - p.a.x) * p.ux + (pt.z - p.a.z) * p.uz;
      if (Math.abs((lat(q.a) + lat(q.b)) * 0.5) > 30) return false;
      const t0 = Math.min(lon(q.a), lon(q.b));
      const t1 = Math.max(lon(q.a), lon(q.b));
      return Math.max(0, t0 - p.len, -t1) < 30;
    };
    for (let i = 0; i < links.length; i++) {
      for (let j = i + 1; j < links.length; j++) if (joinable(links[i], links[j])) parent[find(i)] = find(j);
    }
    const groups = new Map();
    links.forEach((l, i) => {
      const k = find(i);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(l);
    });
    for (const group of groups.values()) {
      const axis = group.reduce((m, l) => (l.len > m.len ? l : m), group[0]);
      const ux = axis.ux;
      const uz = axis.uz;
      const o = axis.a;
      let tmin = Infinity;
      let tmax = -Infinity;
      let smin = Infinity;
      let smax = -Infinity;
      for (const l of group) {
        for (const p of [l.a, l.b]) {
          const t = (p.x - o.x) * ux + (p.z - o.z) * uz;
          tmin = Math.min(tmin, t);
          tmax = Math.max(tmax, t);
        }
        const sc = ((l.a.x + l.b.x) * 0.5 - o.x) * -uz + ((l.a.z + l.b.z) * 0.5 - o.z) * ux;
        smin = Math.min(smin, sc - l.width * 0.5);
        smax = Math.max(smax, sc + l.width * 0.5);
      }
      const sc = (smin + smax) * 0.5;
      const a = { x: o.x + ux * tmin - uz * sc, z: o.z + uz * tmin + ux * sc };
      const b = { x: o.x + ux * tmax - uz * sc, z: o.z + uz * tmax + ux * sc };
      const L = tmax - tmin;
      const W = smax - smin;
      // Water along the axis, on the centre line and both carriageway edges, in 1 m steps
      const runs = [];
      let run = null;
      for (let t = 0; t <= L; t += 1) {
        let wet = false;
        for (const s of [-W * 0.5, 0, W * 0.5]) {
          if (waterAt(a.x + ux * t - uz * s, a.z + uz * t + ux * s)) wet = true;
        }
        if (wet && !run) runs.push((run = { t0: t, t1: t }));
        else if (wet) run.t1 = t;
        else run = null;
      }
      const water = runs.length ? { w0: runs[0].t0, w1: runs[runs.length - 1].t1, runs } : null;
      const kind = KIND_BY_NAME[br.name] || (water ? 'girder' : 'overpass');
      out.push({
        name: br.name || 'Bridge',
        kind,
        a,
        b,
        L,
        width: W,
        tram: group.some((l) => l.tram),
        water,
        footbridge: !!(br.footbridge || group.some((l) => l.footbridge))
      });
    }
  }
  return out;
}

// =====================================================================================================================
// 3. BUILDERS
// =====================================================================================================================

function getTrackSegments(track) {
  const segs = [];
  if (!track) return segs;
  const pts = track.pts || track;
  if (!Array.isArray(pts) || pts.length < 2) return segs;
  if (typeof pts[0] === 'number') {
    for (let i = 0; i + 3 < pts.length; i += 2) {
      segs.push([{ x: pts[i], z: pts[i + 1] }, { x: pts[i + 2], z: pts[i + 3] }]);
    }
  } else if (Array.isArray(pts[0])) {
    for (let i = 0; i + 1 < pts.length; i++) {
      segs.push([{ x: pts[i][0], z: pts[i][1] }, { x: pts[i + 1][0], z: pts[i + 1][1] }]);
    }
  } else if (typeof pts[0] === 'object' && pts[0] !== null) {
    for (let i = 0; i + 1 < pts.length; i++) {
      segs.push([pts[i], pts[i + 1]]);
    }
  }
  return segs;
}

const defaultTramTracks = () => {
  const fromRoutes = (GEO?.tramRoutes || []).flatMap((r) => r.tracks || []);
  if (fromRoutes.length > 0) return fromRoutes;
  if (Array.isArray(GEO?.rail)) {
    const trams = GEO.rail.filter((r) => r.kind === 'tram');
    if (trams.length > 0) return trams;
  }
  if (Array.isArray(RAIL)) {
    const trams = RAIL.filter((r) => r.kind === 'tram');
    if (trams.length > 0) return trams;
  }
  return [];
};

const defaultRailTracks = () => {
  if (Array.isArray(GEO?.rail)) {
    const rails = GEO.rail.filter((r) => r.kind === 'rail' || !r.kind);
    if (rails.length > 0) return rails;
  }
  if (Array.isArray(RAIL)) {
    const rails = RAIL.filter((r) => r.kind === 'rail' || !r.kind);
    if (rails.length > 0) return rails;
  }
  return [];
};

// The pieces of a parapet line (lateral offset s, over [t0, t1] in metres from a) left between the streets that cross
// it: a road joining the bridge from the side (a junction inside the merged structure) gets a gap of its half width
// plus 3 m on either side. Roads within ~20° of the bridge axis are its own carriageways and never cut it.
// Tram tracks get a clearance margin of min 2.0 m from track centerline; railway tracks get min 2.4 m.
function parapetPieces(f, s, t0, t1, { tramTracks = null, railTracks = null } = {}) {
  const p0 = f.at(t0 / f.L, s);
  const p1 = f.at(t1 / f.L, s);
  const dx = p1.x - p0.x;
  const dz = p1.z - p0.z;
  const x0 = Math.min(p0.x, p1.x) - 1;
  const x1 = Math.max(p0.x, p1.x) + 1;
  const z0 = Math.min(p0.z, p1.z) - 1;
  const z1 = Math.max(p0.z, p1.z) + 1;
  const cuts = [];
  for (const r of ROADS) {
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const a = r.pts[i];
      const b = r.pts[i + 1];
      if (Math.max(a.x, b.x) < x0 || Math.min(a.x, b.x) > x1 || Math.max(a.z, b.z) < z0 || Math.min(a.z, b.z) > z1) continue;
      const ex = b.x - a.x;
      const ez = b.z - a.z;
      const el = Math.hypot(ex, ez);
      if (el < 1e-3) continue;
      const sinA = Math.abs(ex * f.dir.z - ez * f.dir.x) / el;
      if (sinA < 0.34) continue;
      // p0 + u·(dx, dz) = a + v·(ex, ez)
      const den = dx * ez - dz * ex;
      if (Math.abs(den) < 1e-9) continue;
      const u = ((a.x - p0.x) * ez - (a.z - p0.z) * ex) / den;
      const v = ((a.x - p0.x) * dz - (a.z - p0.z) * dx) / den;
      if (u < -0.05 || u > 1.05 || v < 0 || v > 1) continue;
      const t = t0 + u * (t1 - t0);
      const half = (r.w || 6) * 0.5 / sinA + 3;
      cuts.push([t - half, t + half]);
    }
  }

  const cutTracks = (tracks, margin) => {
    if (!tracks) return;
    for (const tr of tracks) {
      const segs = getTrackSegments(tr);
      for (const [a, b] of segs) {
        if (Math.max(a.x, b.x) < x0 || Math.min(a.x, b.x) > x1 || Math.max(a.z, b.z) < z0 || Math.min(a.z, b.z) > z1) continue;
        const ex = b.x - a.x;
        const ez = b.z - a.z;
        const el = Math.hypot(ex, ez);
        if (el < 1e-3) continue;
        const sinA = Math.abs(ex * f.dir.z - ez * f.dir.x) / el;
        if (sinA < 0.2) continue;
        const den = dx * ez - dz * ex;
        if (Math.abs(den) < 1e-9) continue;
        const u = ((a.x - p0.x) * ez - (a.z - p0.z) * ex) / den;
        const v = ((a.x - p0.x) * dz - (a.z - p0.z) * dx) / den;
        if (u < -0.05 || u > 1.05 || v < 0 || v > 1) continue;
        const t = t0 + u * (t1 - t0);
        const half = Math.max(margin, Math.min(8.0, margin / sinA));
        cuts.push([t - half, t + half]);
      }
    }
  };

  cutTracks(tramTracks || defaultTramTracks(), 2.0);
  cutTracks(railTracks || defaultRailTracks(), 2.4);

  cuts.sort((p, q) => p[0] - q[0]);
  const pieces = [];
  let start = t0;
  for (const [c0, c1] of cuts) {
    if (c0 > start) pieces.push([start, Math.min(c0, t1)]);
    start = Math.max(start, c1);
  }
  if (start < t1) pieces.push([start, t1]);
  return pieces.filter(([a, b]) => b - a >= 2);
}

// Parapet railings (steel posts and rails on a concrete edge kerb) on both sides over [t0, t1] (metres from a), and
// their colliders; lamps every ~28 m, staggered
function buildParapets(B, f, mats, colliders, t0, t1, y0, sOut, options = {}) {
  for (const sg of [-1, 1]) {
    for (const [pa, pb] of parapetPieces(f, sg * sOut, t0, t1, options)) buildParapetPiece(B, f, mats, colliders, pa, pb, y0, sg, sg * sOut);
  }
}

function buildParapetPiece(B, f, mats, colliders, t0, t1, y0, sg, s) {
  const { at, dir, L } = f;
  const len = t1 - t0;
  const n = Math.max(1, Math.round(len / 2));
  B.beam(mats.railing, at(t0 / L, s, y0 + PARAPET_H - 0.05), at(t1 / L, s, y0 + PARAPET_H - 0.05), 0.1, 0.14);
  B.beam(mats.railing, at(t0 / L, s, y0 + 0.55), at(t1 / L, s, y0 + 0.55), 0.06, 0.06);
  B.beam(mats.deck, at(t0 / L, s, y0 + 0.1), at(t1 / L, s, y0 + 0.1), 0.2, 0.32);
  for (let k = 0; k <= n; k++) {
    const t = (t0 + (len * k) / n) / L;
    B.beam(mats.railing, at(t, s, y0 + 0.2), at(t, s, y0 + PARAPET_H - 0.1), 0.07, 0.07);
  }
  const nl = Math.max(1, Math.round(len / 28));
  for (let k = 0; k < nl; k++) {
    const t = (t0 + (len * (k + (sg > 0 ? 0.25 : 0.75))) / nl) / L;
    const sp = s - sg * 0.35;
    B.beam(mats.railing, at(t, sp, y0), at(t, sp, y0 + 8.2), 0.18, 0.18);
    B.beam(mats.railing, at(t, sp, y0 + 8.0), at(t, sp - sg * 1.6, y0 + 8.2), 0.1, 0.1);
    B.block(mats.lamp, at(t, sp - sg * 1.7, y0 + 8.05), dir, 0.9, 0.25, 0.45);
  }
  const mid = at((t0 + t1) * 0.5 / L, s, 0);
  addBridgeCollider(colliders, mid, dir, len, 0.45, y0 + PARAPET_H + 0.1);
}

// The deck over [t0, t1]: roadway surface at DECK_Y, raised sidewalks with curbs, the concrete slab with its fascia
function buildDeck(B, parts, f, spec, mats, t0, t1, s0, s1) {
  const { at, dir, L } = f;
  const W = spec.width;
  const Wd = spec.footbridge ? W : W + 2 * SIDEWALK_W;
  const ta = t0 / L;
  const tb = t1 / L;
  const sa = s0 / L;
  const sb = s1 / L;
  if (spec.footbridge) {
    const hW = W * 0.5;
    parts.flat(mats.sidewalk, [at(sa, -hW, SIDEWALK_TOP), at(sb, -hW, SIDEWALK_TOP), at(sb, hW, SIDEWALK_TOP), at(sa, hW, SIDEWALK_TOP)]);
    B.block(mats.deck, at((ta + tb) * 0.5, 0, (SIDEWALK_TOP + DECK_Y) * 0.5 - 0.015), dir, t1 - t0, SIDEWALK_TOP - DECK_Y, W);
    B.block(mats.deck, at((ta + tb) * 0.5, 0, DECK_Y - 0.33), dir, t1 - t0, 0.6, W + 0.6);
    for (const sg of [-1, 1]) B.block(mats.deck, at((ta + tb) * 0.5, sg * (W * 0.5 + 0.35), -0.45), dir, t1 - t0, 1.0, 0.3);
  } else {
    parts.flat(mats.road, [at(ta, -W * 0.5, DECK_Y), at(tb, -W * 0.5, DECK_Y), at(tb, W * 0.5, DECK_Y), at(ta, W * 0.5, DECK_Y)]);
    // Sidewalks only over [s0, s1] (beyond, the bridge's own deck lies under city-grid's land and its sidewalks)
    for (const sg of [-1, 1]) {
      const i = sg * W * 0.5;
      const o = sg * Wd * 0.5;
      parts.flat(mats.sidewalk, [at(sa, i, SIDEWALK_TOP), at(sb, i, SIDEWALK_TOP), at(sb, o, SIDEWALK_TOP), at(sa, o, SIDEWALK_TOP)]);
      // Curb face and the sidewalk slab under it, out to the ends of [s0, s1]
      B.block(mats.curb, at((sa + sb) * 0.5, sg * (W * 0.5 + 0.1), (SIDEWALK_TOP + DECK_Y) * 0.5 - 0.01), dir, s1 - s0, SIDEWALK_TOP - DECK_Y - 0.02, 0.2);
      B.block(mats.deck, at((sa + sb) * 0.5, sg * (W + Wd) * 0.25, (SIDEWALK_TOP + DECK_Y) * 0.5 - 0.015), dir, s1 - s0, SIDEWALK_TOP - DECK_Y - 0.03, SIDEWALK_W - 0.2);
    }
    // Slab, with a fascia beam along both edges
    B.block(mats.deck, at((ta + tb) * 0.5, 0, DECK_Y - 0.33), dir, t1 - t0, 0.6, Wd + 0.6);
    for (const sg of [-1, 1]) B.block(mats.deck, at((ta + tb) * 0.5, sg * (Wd * 0.5 + 0.35), -0.45), dir, t1 - t0, 1.0, 0.3);
  }
}

// Concrete wall pier across the deck, standing from below the river bed up to yTop under the girder at t (metres
// from a). With the decks at street level the river runs only a metre or so below the girders, so the wall shows as a
// low band above the water.
function buildPier(B, f, mats, t, across, yTop) {
  const h = yTop - PIER_FOOT_Y;
  if (h > 0.2) B.block(mats.pier, f.at(t / f.L, 0, PIER_FOOT_Y + h * 0.5), f.dir, 2.2, h, across);
}

// Supports (metres from a) over the water stretch: abutments just inside both banks and interior piers that split it
// into spans about `span` m long, the end spans three quarters of the inner ones
function spanSupports(w0, w1, span) {
  const s0 = w0 - 1.5;
  const s1 = w1 + 1.5;
  const len = s1 - s0;
  const n = len < span * 0.8 ? 1 : Math.max(2, Math.round(len / span));
  if (n === 1) return [s0, s1];
  const weights = Array.from({ length: n }, (_, k) => (k === 0 || k === n - 1 ? 0.75 : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  const out = [s0];
  let acc = s0;
  for (let k = 0; k < n; k++) out.push((acc += (len * weights[k]) / total));
  return out;
}

// Haunched box girder under the slab between consecutive supports (deeper over the piers), and the piers & abutments
function buildGirders(B, f, mats, supports, Wd, skip = () => false) {
  const { at, dir, L } = f;
  const top = DECK_Y - 0.63;
  for (let k = 0; k + 1 < supports.length; k++) {
    const a = supports[k];
    const b = supports[k + 1];
    if (skip(a, b)) continue;
    const span = b - a;
    // Shallow for its span (real ones run span / 20): the river is only ~2.4 m under the slab
    const dMid = Math.max(0.8, Math.min(1.2, span / 50));
    const dSup = Math.max(dMid, Math.min(1.6, span / 32));
    const n = Math.max(2, Math.ceil(span / 4));
    for (let i = 0; i < n; i++) {
      const tm = a + (span * (i + 0.5)) / n;
      const e = Math.min(tm - a, b - tm) / (span * 0.5);
      const d = dMid + (dSup - dMid) * (1 - e) * (1 - e);
      B.block(mats.girder, at(tm / L, 0, top - d * 0.5), dir, span / n + 0.02, d, Wd * 0.62);
    }
  }
  for (let k = 0; k < supports.length; k++) {
    const t = supports[k];
    const end = k === 0 || k === supports.length - 1;
    if (end) {
      // Abutment: a wall across the full deck down into the river bed
      B.block(mats.pier, at(t / L, 0, (top + PIER_FOOT_Y) * 0.5), dir, 2.6, top - PIER_FOOT_Y, Wd + 0.8);
    } else {
      buildPier(B, f, mats, t, Wd * 0.8, top - 1.6);
    }
  }
}

/** Girder / box-beam bridge: deck over the water stretch, haunched girder on arched wall piers, parapets & lamps. */
function buildGirderBridge(group, spec, mats, colliders, options = {}) {
  const B = createBeamSet();
  const parts = createPartCollector();
  const f = bridgeFrame(spec);
  const Wd = spec.footbridge ? spec.width : spec.width + 2 * SIDEWALK_W;
  const { w0, w1 } = spec.water;
  const d0 = Math.max(0, w0 - DECK_REACH);
  const d1 = Math.min(f.L, w1 + DECK_REACH);
  buildDeck(B, parts, f, spec, mats, d0, d1, Math.max(0, w0 - 2), Math.min(f.L, w1 + 2));
  buildGirders(B, f, mats, spanSupports(w0, w1, spec.name === 'Most Świętego Rocha' || spec.name === 'Most Królowej Jadwigi' ? 70 : 55), Wd);
  buildParapets(B, f, mats, colliders, Math.max(0, w0 - 2), Math.min(f.L, w1 + 2), SIDEWALK_TOP, Wd * 0.5 - 0.12, options);
  B.build(group, spec.name, new Set([mats.deck, mats.pier, mats.girder]));
  parts.build(group, spec.name, { castShadow: true });
}

/**
 * Tied steel arch: one rib per side over the longest water run, hung from the tie girders along the deck edges with
 * wind bracing overhead where trams and lorries clear it; girder spans on piers carry the rest of the water stretch.
 */
function buildArchBridge(group, spec, mats, colliders, options = {}) {
  const B = createBeamSet();
  const parts = createPartCollector();
  const f = bridgeFrame(spec);
  const { at, dir, L } = f;
  const Wd = spec.footbridge ? spec.width : spec.width + 2 * SIDEWALK_W;
  const archMat = spec.name === 'Most Biskupa Jordana' && mats.redArch ? mats.redArch : mats.arch;
  const { w0, w1, runs } = spec.water;
  const main = runs.reduce((m, r) => (r.t1 - r.t0 > m.t1 - m.t0 ? r : m), runs[0]);
  const a0 = Math.max(w0 - 1.5, main.t0 - 2);
  const a1 = Math.min(w1 + 1.5, main.t1 + 2);
  const span = a1 - a0;
  const d0 = Math.max(0, w0 - DECK_REACH);
  const d1 = Math.min(L, w1 + DECK_REACH);
  buildDeck(B, parts, f, spec, mats, d0, d1, Math.max(0, w0 - 2), Math.min(L, w1 + 2));

  // Supports: the arch's ends, then girder spans over whatever water lies beyond them
  const before = a0 - (w0 - 1.5) > 4 ? spanSupports(w0, a0 - 1.5, 45).slice(0, -1) : [];
  const after = (w1 + 1.5) - a1 > 4 ? spanSupports(a1 + 1.5, w1, 45).slice(1) : [];
  const supports = [...before, a0, a1, ...after];
  buildGirders(B, f, mats, supports, Wd, (a, b) => a === a0 && b === a1);

  // Ribs, ties & hangers
  const rise = Math.max(8, Math.min(18, span * 0.17));
  const rib = makeDeckProfile({ deckY: rise }, 0, 1, 0);
  const sA = Wd * 0.5 + 0.7;
  const yS = 0.5;
  const ribY = (t) => yS + rib((t - a0) / span);
  const n = Math.max(12, Math.ceil(span / 4));
  for (const sg of [-1, 1]) {
    const s = sg * sA;
    B.beam(archMat, at(a0 / L, s, -0.45), at(a1 / L, s, -0.45), 1.9, 0.9);
    for (let i = 0; i < n; i++) {
      const ta = a0 + (span * i) / n;
      const tb = a0 + (span * (i + 1)) / n;
      B.beam(archMat, at(ta / L, s, ribY(ta)), at(tb / L, s, ribY(tb)), 1.3, 1.0);
    }
    for (let t = a0 + 5; t < a1 - 2.5; t += 5) {
      if (ribY(t) - yS > 1.5) B.beam(archMat, at(t / L, s, yS), at(t / L, s, ribY(t) - 0.6), 0.12, 0.12);
    }
  }
  for (let i = 1; i < n; i++) {
    const t = a0 + (span * i) / n;
    if (ribY(t) < 7.2 || i % 3) continue;
    B.beam(archMat, at(t / L, -sA, ribY(t) - 0.2), at(t / L, sA, ribY(t) - 0.2), 0.7, 0.7, dir);
  }
  buildParapets(B, f, mats, colliders, Math.max(0, w0 - 2), Math.min(L, w1 + 2), SIDEWALK_TOP, Wd * 0.5 - 0.12, options);
  B.build(group, spec.name, new Set([mats.deck, mats.pier, mats.girder, archMat]));
  parts.build(group, spec.name, { castShadow: true });
}

/**
 * Covered glass footbridge (Kładka Bramy Poznania): enclosed pedestrian bridge gallery across the Cybina river.
 * Features a full sidewalk deck, bottom girders with central pier, continuous glass walls, structural steel frame,
 * roof slab, and edge colliders so the player cannot fall into the river.
 */
function buildCoveredFootbridge(group, spec, mats, colliders) {
  const B = createBeamSet();
  const parts = createPartCollector();
  const f = bridgeFrame(spec);
  const { at, dir, L } = f;
  const W = spec.width;
  const { w0, w1 } = spec.water;
  const d0 = Math.max(0, w0 - DECK_REACH);
  const d1 = Math.min(L, w1 + DECK_REACH);
  const t0 = Math.max(0, w0 - 2);
  const t1 = Math.min(L, w1 + 2);
  const len = t1 - t0;

  buildDeck(B, parts, f, spec, mats, d0, d1, t0, t1);
  buildGirders(B, f, mats, spanSupports(w0, w1, 30), W);

  const yFloor = SIDEWALK_TOP;
  const galleryH = 3.2;
  const yRoof = yFloor + galleryH;
  const halfW = W * 0.5;

  B.block(mats.deck, at(((t0 + t1) * 0.5) / L, 0, yRoof + 0.1), dir, len, 0.22, W + 0.2);

  for (const sg of [-1, 1]) {
    const s = sg * (halfW - 0.06);
    B.beam(mats.girder, at(t0 / L, s, yRoof), at(t1 / L, s, yRoof), 0.18, 0.18);
    B.beam(mats.girder, at(t0 / L, s, yFloor + 0.15), at(t1 / L, s, yFloor + 0.15), 0.3, 0.18);
    B.beam(mats.girder, at(t0 / L, s, yFloor + 1.1), at(t1 / L, s, yFloor + 1.1), 0.08, 0.08);

    B.block(mats.glass, at(((t0 + t1) * 0.5) / L, s, yFloor + galleryH * 0.5), dir, len, galleryH - 0.1, 0.06);

    const mid = at(((t0 + t1) * 0.5) / L, s, 0);
    addBridgeCollider(colliders, mid, dir, len, 0.45, yRoof + 0.2);
  }

  const n = Math.max(2, Math.round(len / 3));
  for (let k = 0; k <= n; k++) {
    const t = (t0 + (len * k) / n) / L;
    for (const sg of [-1, 1]) {
      const s = sg * (halfW - 0.06);
      B.beam(mats.girder, at(t, s, yFloor), at(t, s, yRoof), 0.12, 0.12);
    }
  }

  const nl = Math.max(1, Math.round(len / 15));
  for (let k = 0; k < nl; k++) {
    const t = (t0 + (len * (k + 0.5)) / nl) / L;
    B.block(mats.lamp, at(t, 0, yRoof - 0.08), dir, 0.8, 0.15, 0.3);
  }

  B.build(group, spec.name, new Set([mats.deck, mats.pier, mats.girder, mats.glass]));
  parts.build(group, spec.name, { castShadow: true });
}

/**
 * Overpass over land (the rail yard): the deck and girders lie at or under city-grid's street-level land deck, so what
 * shows is the balustrade along both edges of the carriageway corridor (concrete panels pierced by small round arches,
 * under a coping) and its lamps.
 */
function buildOverpass(group, spec, mats, colliders, panelGeo, options = {}) {
  if (spec.L < 15) return;
  const B = createBeamSet();
  const parts = createPartCollector();
  const f = bridgeFrame(spec);
  const { at, dir, L } = f;
  const s = spec.width * 0.5 + 2.15;
  const UP = new THREE.Vector3(0, 1, 0);
  const across = new THREE.Vector3().crossVectors(dir, UP);
  for (const sg of [-1, 1]) {
    for (const [t0, t1] of parapetPieces(f, sg * s, 2, L - 2, options)) {
      const n = Math.max(1, Math.round((t1 - t0) / BALUSTRADE_PANEL));
      const scale = (t1 - t0) / (n * BALUSTRADE_PANEL);
      for (let k = 0; k < n; k++) {
        const t = (t0 + ((t1 - t0) * (k + 0.5)) / n) / L;
        const m = new THREE.Matrix4().makeBasis(dir.clone().multiplyScalar(scale), UP, across).setPosition(at(t, sg * s, 0));
        parts.add(mats.deck, panelGeo, m);
      }
      B.block(mats.deck, at(((t0 + t1) * 0.5) / L, sg * s, 1.0), dir, t1 - t0, 0.12, 0.4);
      const nl = Math.round((t1 - t0) / 30);
      for (let k = 0; k < nl; k++) {
        const t = (t0 + ((t1 - t0) * (k + (sg > 0 ? 0.25 : 0.75))) / nl) / L;
        B.beam(mats.railing, at(t, sg * s, 1.06), at(t, sg * s, 8.2), 0.18, 0.18);
        B.beam(mats.railing, at(t, sg * s, 8.0), at(t, sg * (s - 1.6), 8.2), 0.1, 0.1);
        B.block(mats.lamp, at(t, sg * (s - 1.7), 8.05), dir, 0.9, 0.25, 0.45);
      }
      addBridgeCollider(colliders, at(((t0 + t1) * 0.5) / L, sg * s, 0), dir, t1 - t0, 0.4, 1.2);
    }
  }
  B.build(group, spec.name, new Set([mats.deck]));
  parts.build(group, spec.name, { castShadow: true });
}

// One balustrade panel in its (along, up) plane, centred on x = 0, 0.25 m thick: a round-arched opening under a top
// rail, so the street can see the tracks below
const BALUSTRADE_PANEL = 2.4;
function createBalustradePanel() {
  const w = BALUSTRADE_PANEL * 0.5;
  const shape = new THREE.Shape([new THREE.Vector2(-w, 0), new THREE.Vector2(w, 0), new THREE.Vector2(w, 0.94), new THREE.Vector2(-w, 0.94)]);
  shape.holes.push(roundArchPath(0, 0.22, 0.62, 0.3));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.25, bevelEnabled: false, curveSegments: 1 });
  geo.translate(0, 0, -0.125);
  return geo;
}

// =====================================================================================================================
// 4. ASSEMBLY
// =====================================================================================================================

/**
 * Builds every bridge of the core under one `Bridges` group added to the scene. Call after buildCityGrid(); `sidewalks`
 * (its raised sidewalk rects) is accepted for footing checks but nothing stands on the street yet: piers stand in the
 * river and overpass parapets on the corridor edges. Returns the parapet colliders (oriented boxes, y 0 to ~1.4 m).
 */
function buildBridges(scene, { sidewalks = [], tramTracks = null, railTracks = null } = {}) {
  void sidewalks;
  const t0 = performance.now();
  const group = new THREE.Group();
  group.name = 'Bridges';
  const colliders = [];
  const mats = createBridgeMaterials();
  const structures = bridgeStructures();
  const counts = { arch: 0, girder: 0, overpass: 0, covered: 0 };
  const panelGeo = createBalustradePanel();
  const options = { tramTracks, railTracks };
  for (const spec of structures) {
    // A river kind without water under it (a name on an approach piece) is an overpass on its land
    const kind = spec.water ? spec.kind : 'overpass';
    if (kind === 'arch') buildArchBridge(group, spec, mats, colliders, options);
    else if (kind === 'covered') buildCoveredFootbridge(group, spec, mats, colliders);
    else if (kind === 'girder') buildGirderBridge(group, spec, mats, colliders, options);
    else buildOverpass(group, spec, mats, colliders, panelGeo, options);
    counts[kind] = (counts[kind] || 0) + 1;
  }
  scene.add(group);
  console.info(`[bridges] ${structures.length} structures ${JSON.stringify(counts)}, ${colliders.length} colliders, built in ${(performance.now() - t0).toFixed(0)} ms`);
  return { group, colliders };
}

export { buildBridges, bridgeStructures, parapetPieces };
