import * as THREE from 'three/webgpu';
import { Fn, attribute, color, float, vec2, mix, smoothstep, step, abs, fract, fwidth, max, clamp, normalGeometry, positionGeometry, texture, uv } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GEO } from './geodata.js';
import { blockAt, isLand } from './city-config.js';
import { cityUniforms, createCurbMaterial, transparentEffectMRT } from './tsl-materials.js';

// js/tram-infra.js
// The static tram infrastructure (docs/poznan-plan.md Phase 9 step 1), built once after the road network so it can keep
// clear of the car lanes without feeding obstacles back into them:
// - grooved rails for every tram track of GEO.rail (two 70 mm heads at 1435 mm gauge, flush with the road on
//   street-running track; on ballast with concrete sleepers on off-street track)
// - the overhead line: a contact wire 5.8 m over each track, carried every ~30 m by span wires between side poles (or a
//   centre pole between the tracks), cantilever arms on one-sided poles, or wall rosettes in the narrow streets round
//   the Old Town
// - tram stops from GEO.tramStops: a raised platform island on the right of the track where it fits clear of the car
//   lanes (else the stop stands on the sidewalk, as on the Poznań streets with no room for an island), a glass shelter,
//   a stop sign with the stop's name plate and a ticket machine
// layoutTramInfrastructure(network) is the pure placement (no three.js) that tests/tram-infra.test.cjs checks; its
// `stops` list is the public one trams can dwell at.

const GAUGE = 1.435;
const HEAD_W = 0.07; // grooved rail head (Ri60-ish)
const GROOVE_W = 0.042;
const SW_TOP = 0.22; // city-grid.js sidewalk top
const PIECE = 4; // rails and ballast are laid as straight pieces up to this long, so they follow curbs and bends
const WIRE_Y = 5.8; // contact wire height
const SPAN_Y = 6.6; // span wires and cantilever arms
const STATION = 30; // support spacing along the track
// Platforms keep this far from a car lane's centreline: road-network.js closes a lane when an obstacle box comes within
// LANE_CLEAR 1.2 m of it along both axes, which reaches ~1.7 m on a diagonal street
const LANE_KEEP = 1.75;
const TRACK_KEEP = 1.75; // poles & shelters keep this far from a track centreline (2.4 m car body + sway)
const PLATFORM_EDGE = 1.35; // track centreline to platform edge
const PLATFORM_W = 2.6;
const PLATFORM_L = 33; // a 32 m Moderus Gamma or Tramino
const PLATFORM_H = 0.25;
const OLD_TOWN_R = 900; // wall rosettes instead of poles on narrow streets this close to the Ratusz

// --- Track geometry ------------------------------------------------------------------------------------------------
// Tram tracks of GEO.rail (railIndex = index into GEO.rail), with cumulative arc length per point
function loadTracks() {
  const tracks = [];
  GEO.rail.forEach((r, railIndex) => {
    if (r.kind !== 'tram' || r.pts.length < 4) return;
    const p = r.pts;
    const n = p.length / 2;
    const cum = new Float64Array(n);
    for (let k = 1; k < n; k++) cum[k] = cum[k - 1] + Math.hypot(p[2 * k] - p[2 * k - 2], p[2 * k + 1] - p[2 * k - 1]);
    tracks.push({ railIndex, street: r.street, oneway: r.oneway, p, n, cum, len: cum[n - 1] });
  });
  return tracks;
}

// Point, unit tangent and segment at arc length s along a track (clamped)
function pointAt(tr, s) {
  const { p, cum, n } = tr;
  s = Math.max(0, Math.min(tr.len, s));
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const L = cum[hi] - cum[lo] || 1;
  const t = (s - cum[lo]) / L;
  const dx = (p[2 * hi] - p[2 * lo]) / L;
  const dz = (p[2 * hi + 1] - p[2 * lo + 1]) / L;
  return { x: p[2 * lo] + (p[2 * hi] - p[2 * lo]) * t, z: p[2 * lo + 1] + (p[2 * hi + 1] - p[2 * lo + 1]) * t, dx, dz, k: lo };
}

// Uniform grid of line segments for nearest-segment queries
function segmentGrid(cell = 24) {
  const cells = new Map();
  const key = (ix, iz) => ix * 100003 + iz;
  return {
    add(ax, az, bx, bz, data) {
      const seg = { ax, az, bx, bz, data };
      for (let ix = Math.floor(Math.min(ax, bx) / cell); ix <= Math.floor(Math.max(ax, bx) / cell); ix++) {
        for (let iz = Math.floor(Math.min(az, bz) / cell); iz <= Math.floor(Math.max(az, bz) / cell); iz++) {
          const k = key(ix, iz);
          if (!cells.has(k)) cells.set(k, []);
          cells.get(k).push(seg);
        }
      }
    },
    // Nearest segment within r of (x, z) passing `accept`: { seg, d, t, qx, qz } or null
    nearest(x, z, r, accept) {
      let best = null;
      let bestD = r;
      const seen = new Set();
      for (let ix = Math.floor((x - r) / cell); ix <= Math.floor((x + r) / cell); ix++) {
        for (let iz = Math.floor((z - r) / cell); iz <= Math.floor((z + r) / cell); iz++) {
          for (const sg of cells.get(key(ix, iz)) || []) {
            if (seen.has(sg)) continue;
            seen.add(sg);
            if (accept && !accept(sg)) continue;
            const ex = sg.bx - sg.ax;
            const ez = sg.bz - sg.az;
            const t = Math.max(0, Math.min(1, ((x - sg.ax) * ex + (z - sg.az) * ez) / (ex * ex + ez * ez || 1)));
            const qx = sg.ax + ex * t;
            const qz = sg.az + ez * t;
            const d = Math.hypot(qx - x, qz - z);
            if (d < bestD) {
              bestD = d;
              best = { seg: sg, d, t, qx, qz };
            }
          }
        }
      }
      return best;
    },
    // Every segment crossing the segment a-b: [{ seg, x, z }]
    crossing(ax, az, bx, bz) {
      const out = [];
      const seen = new Set();
      for (let ix = Math.floor(Math.min(ax, bx) / cell); ix <= Math.floor(Math.max(ax, bx) / cell); ix++) {
        for (let iz = Math.floor(Math.min(az, bz) / cell); iz <= Math.floor(Math.max(az, bz) / cell); iz++) {
          for (const sg of cells.get(key(ix, iz)) || []) {
            if (seen.has(sg)) continue;
            seen.add(sg);
            const rx = bx - ax;
            const rz = bz - az;
            const sx = sg.bx - sg.ax;
            const sz = sg.bz - sg.az;
            const den = rx * sz - rz * sx;
            if (Math.abs(den) < 1e-9) continue;
            const t = ((sg.ax - ax) * sz - (sg.az - az) * sx) / den;
            const u = ((sg.ax - ax) * rz - (sg.az - az) * rx) / den;
            if (t >= 0 && t <= 1 && u >= 0 && u <= 1) out.push({ seg: sg, x: ax + rx * t, z: az + rz * t });
          }
        }
      }
      return out;
    }
  };
}

/**
 * Placement of the tram infrastructure against a built road network (road-network.js buildRoadNetwork; only its
 * paintEdges / edges lanes are read). Returns
 * { tracks, stops, poles, spans, arms, rosettes, droppers }:
 * - stops: [{ name, x, z, heading, railIndex, s, dir, side, kind: 'island'|'curb', platform, shelter, sign, machine }]
 *   x, z, s: the stop point on the track (s = arc length along GEO.rail[railIndex].pts), dir: +1 when trams run along
 *   the points, heading: their travel heading (0 = +z), side: +1 when the platform is right of the points' direction.
 *   platform: { s0, s1, o0, o1 } (o = lateral offsets right of the points' direction; null on a curb stop).
 * - poles: [{ x, z, h }], spans: [{ ax, az, bx, bz }] (wires at SPAN_Y), arms: cantilevers, droppers: [{ x, z, y0 }]
 */
function layoutTramInfrastructure(network) {
  const tracks = loadTracks();
  const trackGrid = segmentGrid();
  for (const tr of tracks) {
    for (let k = 0; k + 1 < tr.n; k++) {
      trackGrid.add(tr.p[2 * k], tr.p[2 * k + 1], tr.p[2 * k + 2], tr.p[2 * k + 3], { tr, k });
    }
  }
  // Car lanes: every lane of every street the network paints (the drivable set before its connectivity filter, so
  // streets traffic doesn't use count as roadway too)
  const laneGrid = segmentGrid(32);
  for (const e of (network && (network.paintEdges || network.edges)) || []) {
    const span = e.span ?? e.len;
    for (const o of e.lanes) {
      const ax = e.x0 + e.rx * o;
      const az = e.z0 + e.rz * o;
      laneGrid.add(ax, az, ax + e.dx * span, az + e.dz * span, null);
    }
  }
  const laneDist = (x, z, r = 6) => {
    const h = laneGrid.nearest(x, z, r);
    return h ? h.d : r;
  };
  const trackDist = (x, z, r = 4, except = null) => {
    const h = trackGrid.nearest(x, z, r, except ? (sg) => sg.data.tr !== except : null);
    return h ? h.d : r;
  };
  // Poles keep 2 m from a lane centreline: the road network tests obstacles by box overlap, so a pole is clear of its
  // 1.2 m only beyond 1.2 + 0.16 m along both axes (up to 1.92 m diagonally)
  const clearSpot = (x, z, keep = TRACK_KEEP) => isLand(x, z) && laneDist(x, z) >= 2.0 && trackDist(x, z) >= keep;
  const onCurb = (x, z) => {
    const b = blockAt(x, z);
    return !!(b && !b.median);
  };

  // --- Overhead line supports ---------------------------------------------------------------------------------------
  const poles = [];
  const spans = [];
  const arms = [];
  const rosettes = [];
  const droppers = [];
  const supported = segmentGrid(32); // short marks across each track where a support already carries its wire
  const poleAt = (x, z, h) => {
    for (const q of poles) if (Math.abs(q.x - x) < 1.2 && Math.abs(q.z - z) < 1.2) return q;
    const q = { x, z, h };
    poles.push(q);
    return q;
  };
  // March out from the track (x, z) along (nx, nz) to the first curb a pole can stand on (0.6 m behind the curb edge),
  // else the first clear spot on the way (a reservation, or a street with no car lane on that side)
  const march = (x, z, nx, nz, maxO) => {
    let first = null;
    for (let o = TRACK_KEEP; o <= maxO; o += 0.25) {
      const px = x + nx * o;
      const pz = z + nz * o;
      if (!isLand(px, pz)) break;
      if (!clearSpot(px, pz)) continue;
      if (onCurb(px, pz)) {
        const ix = px + nx * 0.6;
        const iz = pz + nz * 0.6;
        if (onCurb(ix, iz) && clearSpot(ix, iz)) return { x: ix, z: iz, o: o + 0.6, curb: true };
      }
      if (!first) first = { x: px, z: pz, o, curb: false };
    }
    return first;
  };
  // Mark the wire as carried where a support line a-b crosses the tracks
  const markCrossings = (ax, az, bx, bz) => {
    for (const c of trackGrid.crossing(ax, az, bx, bz)) {
      droppers.push({ x: c.x, z: c.z, y0: SPAN_Y });
      supported.add(c.x - 0.1, c.z, c.x + 0.1, c.z, c.seg.data.tr);
    }
  };
  for (const tr of tracks) {
    if (tr.len < 14) continue;
    const count = Math.max(1, Math.round(tr.len / STATION));
    for (let i = 0; i < count; i++) {
      const s = (i + 0.5) * tr.len / count;
      const P = pointAt(tr, s);
      if (supported.nearest(P.x, P.z, STATION * 0.4, (sg) => sg.data === tr)) continue;
      const nx = -P.dz;
      const nz = P.dx;
      const street = tr.street === 1;
      const R = march(P.x, P.z, nx, nz, street ? 16 : 5);
      const L = march(P.x, P.z, -nx, -nz, street ? 16 : 5);
      // Narrow Old Town streets: span wires anchored on the house fronts (lots stand ~4.6 m behind the curb)
      if (street && R && L && R.curb && L.curb && R.o + L.o < 15 && Math.hypot(P.x, P.z) < OLD_TOWN_R) {
        const ra = { x: R.x + nx * 3.8, z: R.z + nz * 3.8 };
        const la = { x: L.x - nx * 3.8, z: L.z - nz * 3.8 };
        if (onCurb(ra.x, ra.z) && onCurb(la.x, la.z)) {
          rosettes.push({ x: ra.x, z: ra.z, nx: -nx, nz: -nz }, { x: la.x, z: la.z, nx, nz });
          spans.push({ ax: la.x, az: la.z, bx: ra.x, bz: ra.z });
          markCrossings(la.x, la.z, ra.x, ra.z);
          continue;
        }
      }
      if (street && R && L && R.o + L.o <= 32) {
        const a = poleAt(L.x, L.z, 7.6);
        const b = poleAt(R.x, R.z, 7.6);
        spans.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z });
        markCrossings(a.x, a.z, b.x, b.z);
        continue;
      }
      // One-sided: a pole with a cantilever arm reaching 0.4 m past the track
      const side = R && (!L || R.o <= L.o) ? R : L;
      if (!side || side.o > 9) continue;
      const q = poleAt(side.x, side.z, street ? 7.6 : 7.0);
      const ux = (P.x - q.x) / side.o;
      const uz = (P.z - q.z) / side.o;
      const ex = P.x + ux * 0.4;
      const ez = P.z + uz * 0.4;
      arms.push({ ax: q.x, az: q.z, bx: ex, bz: ez });
      markCrossings(q.x, q.z, ex, ez);
    }
  }

  // --- Tram stops ---------------------------------------------------------------------------------------------------
  const stops = [];
  const skipped = []; // [{ name, x, z, why }] stop nodes left without a stop
  const platformClear = (tr, s0, s1, o0, o1) => {
    for (let s = s0; s <= s1 + 1e-6; s += 1) {
      const P = pointAt(tr, s);
      for (const o of [o0, (o0 * 3 + o1) / 4, (o0 + o1) / 2, (o0 + o1 * 3) / 4, o1]) {
        const x = P.x - P.dz * o;
        const z = P.z + P.dx * o;
        if (!isLand(x, z) || laneDist(x, z) < LANE_KEEP) return false;
        // ...and clear of the other tracks (not tested at the track-side edge, which the chain continuing the
        // platform's own track past a switch passes as close as its own track)
        if (o !== o0 && trackDist(x, z, 4, tr) < PLATFORM_EDGE) return false;
      }
    }
    return true;
  };
  for (const st of GEO.tramStops) {
    const hit = trackGrid.nearest(st.x, st.z, 25);
    if (!hit) {
      skipped.push({ ...st, why: 'no track' });
      continue;
    }
    const { tr, k } = hit.seg.data;
    const s = tr.cum[k] + hit.t * (tr.cum[k + 1] - tr.cum[k]);
    // Several nodes for one stop position on one track
    if (stops.some((o) => o.railIndex === tr.railIndex && Math.abs(o.s - s) < 20)) continue;
    const P = pointAt(tr, s);
    const nx = -P.dz;
    const nz = P.dx;
    // The paired track of a two-track line: the nearest other, roughly parallel track 2–8 m to one side
    let pairSide = 0;
    for (const o of [3, 4.5, 6, 2.5, 7.5]) {
      for (const sg of [1, -1]) {
        const h = trackGrid.nearest(P.x + nx * o * sg, P.z + nz * o * sg, 1.2, (seg) => seg.data.tr !== tr);
        if (!h) continue;
        const ex = h.seg.bx - h.seg.ax;
        const ez = h.seg.bz - h.seg.az;
        if (Math.abs(ex * P.dx + ez * P.dz) / (Math.hypot(ex, ez) || 1) > 0.9) {
          pairSide = sg;
          break;
        }
      }
      if (pairSide) break;
    }
    // One-way track: the platform is on the right; two-way: away from the paired track (both sides tried if alone)
    const sides = tr.oneway ? [1] : pairSide ? [-pairSide] : [1, -1];
    let stop = null;
    for (const side of sides) {
      const dir = tr.oneway ? 1 : side; // travel direction with the platform on the right
      const half = Math.min(PLATFORM_L / 2, tr.len / 2);
      const sc = Math.max(half, Math.min(tr.len - half, s));
      for (const w of [PLATFORM_W, 2.0, 1.5]) {
        const o0 = side * PLATFORM_EDGE;
        const o1 = side * (PLATFORM_EDGE + w);
        if (half >= 9 && platformClear(tr, sc - half, sc + half, Math.min(o0, o1), Math.max(o0, o1))) {
          stop = { side, dir, kind: 'island', platform: { s0: sc - half, s1: sc + half, o0, o1 }, sc };
          break;
        }
      }
      if (stop) break;
      // No room for an island: the stop stands on the sidewalk if one runs within 12 m of the track (passengers cross
      // the traffic lane to board, as at the Poznań stops with no island)
      for (let o = PLATFORM_EDGE; o <= 12; o += 0.25) {
        const x = P.x + nx * o * side;
        const z = P.z + nz * o * side;
        if (!onCurb(x, z)) continue;
        let depth = 0;
        while (depth < 4.5 && onCurb(x + nx * (depth + 0.25) * side, z + nz * (depth + 0.25) * side)) depth += 0.25;
        const along = [-3, 3].every((d) => onCurb(x + nx * 0.6 * side + P.dx * d, z + nz * 0.6 * side + P.dz * d));
        if (depth >= 1.0 && along) stop = { side, dir, kind: 'curb', platform: null, curbO: o, depth, sc: s };
        break;
      }
      if (stop) break;
    }
    if (!stop) {
      skipped.push({ ...st, why: 'no room' });
      continue;
    }
    // Furniture in the stop's frame: f along the travel direction, r away from the track
    const C = pointAt(tr, stop.sc);
    const fx = C.dx * stop.dir;
    const fz = C.dz * stop.dir;
    const rx = -C.dz * stop.side;
    const rz = C.dx * stop.side;
    const base = stop.kind === 'island' ? PLATFORM_EDGE : stop.curbO;
    // usable depth: the island, or the sidewalk up to 3.4 m behind the curb (shops and gardens beyond)
    const width = stop.kind === 'island' ? Math.abs(stop.platform.o1 - stop.platform.o0) : Math.min(stop.depth, 3.4);
    const y = stop.kind === 'island' ? PLATFORM_H : SW_TOP;
    const at = (f, r) => ({ x: C.x + fx * f + rx * r, z: C.z + fz * f + rz * r });
    const yaw = Math.atan2(rx, rz); // local +z (the shelter's open front) faces the track: rotate by yaw then flip
    // A shelter (1.6 m roof) needs 2 m; its back stands 0.2 m in from the island's or sidewalk's far edge
    stop.shelter = width >= 2.0 ? { ...at(-2, base + width - 0.85), y, yaw: yaw + Math.PI, len: width >= 2.4 ? 4.4 : 3.2 } : null;
    stop.sign = { ...at(stop.kind === 'island' ? 12 : 9, base + 0.55), y, yaw: Math.atan2(fx, fz) };
    stop.machine = { ...at(2.2, base + width - 0.45), y, yaw: yaw + Math.PI };
    // Curb stops keep their furniture on the sidewalk and off the tracks
    if (stop.kind === 'curb' && ![stop.shelter, stop.sign, stop.machine].every((p) => onCurb(p.x, p.z))) {
      if (!onCurb(stop.sign.x, stop.sign.z)) {
        skipped.push({ ...st, why: 'no sign spot' });
        continue;
      }
      if (stop.shelter && !onCurb(stop.shelter.x, stop.shelter.z)) stop.shelter = null;
      if (!onCurb(stop.machine.x, stop.machine.z)) stop.machine = null;
    }
    stops.push({
      name: st.name,
      x: P.x,
      z: P.z,
      heading: Math.atan2(P.dx * stop.dir, P.dz * stop.dir),
      railIndex: tr.railIndex,
      s,
      dir: stop.dir,
      side: stop.side,
      kind: stop.kind,
      platform: stop.platform,
      shelter: stop.shelter,
      sign: stop.sign,
      machine: stop.machine
    });
  }

  // Ground footprints of everything placed, as small axis-aligned boxes (platforms sampled every 1.5 m): none goes to
  // the road network (built before this), but tests/tram-infra.test.cjs feeds them to it to prove no lane is crowded
  const footprints = [];
  const box = (x, z, h) => footprints.push({ minX: x - h, maxX: x + h, minZ: z - h, maxZ: z + h });
  for (const q of poles) box(q.x, q.z, 0.16);
  for (const st of stops) {
    for (const f of [st.shelter, st.sign, st.machine]) if (f) box(f.x, f.z, 0.4);
    if (!st.platform) continue;
    const tr = tracks.find((t) => t.railIndex === st.railIndex);
    const { s0, s1, o0, o1 } = st.platform;
    for (let s = s0; s <= s1 + 1e-6; s += 1.5) {
      const P = pointAt(tr, s);
      for (let k = 0; k <= 4; k++) {
        const o = o0 + (o1 - o0) * (0.08 + (0.84 * k) / 4);
        box(P.x - P.dz * o, P.z + P.dx * o, 0.2);
      }
    }
  }

  return { tracks, stops, skipped, poles, spans, arms, rosettes, droppers, footprints, laneDist, trackDist };
}

// --- Rendering ---------------------------------------------------------------------------------------------------------
// Name plate atlas: one 256 x 128 cell per stop name (a yellow "TRAMWAJ" band over the name in white on ZTM green)
const PLATE_CELL = [256, 128];
function createPlateAtlas(names) {
  const cols = 8;
  const rows = Math.max(1, Math.ceil(names.length / cols));
  const c = document.createElement('canvas');
  c.width = cols * PLATE_CELL[0];
  c.height = rows * PLATE_CELL[1];
  const ctx = c.getContext('2d');
  names.forEach((name, i) => {
    const x0 = (i % cols) * PLATE_CELL[0];
    const y0 = Math.floor(i / cols) * PLATE_CELL[1];
    ctx.fillStyle = '#0d6b3f';
    ctx.fillRect(x0, y0, PLATE_CELL[0], PLATE_CELL[1]);
    ctx.fillStyle = '#f2c230';
    ctx.fillRect(x0 + 6, y0 + 6, PLATE_CELL[0] - 12, 34);
    ctx.fillStyle = '#0d3b24';
    ctx.font = '800 24px Inter, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('TRAMWAJ', x0 + PLATE_CELL[0] / 2, y0 + 24);
    ctx.fillStyle = '#ffffff';
    let size = 34;
    ctx.font = `700 ${size}px Inter, Arial, sans-serif`;
    while (size > 14 && ctx.measureText(name).width > PLATE_CELL[0] - 20) {
      size -= 2;
      ctx.font = `700 ${size}px Inter, Arial, sans-serif`;
    }
    ctx.fillText(name, x0 + PLATE_CELL[0] / 2, y0 + 84);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, cols, rows };
}

// Instanced mesh from a list of matrices (and optional per-instance attributes), or null when the list is empty
function instanced(name, geo, mat, matrices, attrs = {}, shadow = true) {
  if (!matrices.length) return null;
  const g = geo.clone();
  for (const [key, { size, data }] of Object.entries(attrs)) {
    g.setAttribute(key, new THREE.InstancedBufferAttribute(new Float32Array(data), size));
  }
  const mesh = new THREE.InstancedMesh(g, mat, matrices.length);
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.name = name;
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Builds the rails, overhead line and stops into a `TramInfrastructure` group (a scene-culling root, main.js) and
 * returns { group, colliders, stops } (colliders: poles, shelters, signs and machines for the player only; built after
 * the road network, so nothing here closes a lane).
 */
function buildTramInfrastructure(scene, network) {
  const layout = layoutTramInfrastructure(network);
  const { tracks, stops, poles, spans, arms, rosettes, droppers, laneDist } = layout;
  const group = new THREE.Group();
  group.name = 'TramInfrastructure';
  const colliders = [];
  const dummy = new THREE.Object3D();
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const M = () => {
    dummy.updateMatrix();
    return dummy.matrix.clone();
  };
  // Unit box along local x from a to b, w wide (z) and h tall (y), its centre at height y
  const beam = (ax, ay, az, bx, by, bz, w, h) => {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const L = Math.hypot(dx, dy, dz);
    dummy.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    dummy.rotation.set(0, Math.atan2(-dz, dx), Math.atan2(dy, Math.hypot(dx, dz)), 'YZX');
    dummy.scale.set(L, h, w);
    return M();
  };

  // --- Materials ----------------------------------------------------------------------------------------------------
  // Rail heads: polished running surface on top, dark weathered steel on the sides
  const railMat = new THREE.MeshStandardNodeMaterial();
  const top = step(0.5, normalGeometry.y);
  railMat.colorNode = mix(color(0x3d332c), color(0xa9aaa6), top);
  railMat.metalnessNode = mix(float(0.35), float(0.9), top);
  railMat.roughnessNode = mix(float(0.8), float(0.32), top);
  const grooveMat = new THREE.MeshStandardNodeMaterial({ color: 0x141414, roughness: 0.95 });
  // Ballast with concrete sleepers every 0.6 m (per-instance `tie` = piece length, phase along the track)
  const ballastMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.95 });
  ballastMat.colorNode = Fn(() => {
    const tie = attribute('tie', 'vec2');
    const along = positionGeometry.x.add(0.5).mul(tie.x).add(tie.y).div(0.6);
    const fw = max(fwidth(along), 0.0001);
    // box-filtered 40% duty sleepers, fading to their mean coverage once a period is under a couple of pixels
    const pulse = clamp(float(0.2).sub(abs(fract(along).sub(0.5))).div(fw).add(0.5), 0.0, 1.0);
    const sleeper = mix(pulse, float(0.4), smoothstep(0.25, 0.6, fw))
      .mul(step(abs(positionGeometry.z), 0.41)).mul(step(0.5, normalGeometry.y));
    const stone = mix(color(0x5d5850), color(0x77706a), step(0.5, normalGeometry.y));
    return mix(stone, color(0x9b9890), sleeper);
  })();
  const steelMat = new THREE.MeshStandardNodeMaterial({ color: 0x4f5650, roughness: 0.55, metalness: 0.7 });
  const wireMat = new THREE.MeshStandardNodeMaterial({ color: 0x3b3027, roughness: 0.5, metalness: 0.8 });
  const platformMat = createCurbMaterial();
  const edgeMat = new THREE.MeshStandardNodeMaterial({ color: 0xd8c55a, roughness: 0.7 }); // tactile edge strip
  const frameMat = new THREE.MeshStandardNodeMaterial({ color: 0x2c3330, roughness: 0.45, metalness: 0.6 });
  const glassMat = new THREE.MeshStandardNodeMaterial({
    color: 0xb8d0d4, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.28, depthWrite: false,
    side: THREE.DoubleSide
  });
  glassMat.mrtNode = transparentEffectMRT;
  // Back-lit advert panel in the shelter's end wall: a pale print by day, lit after dusk (street-details.js lamps'
  // smoothstep on uInteriorGlow)
  const adMat = new THREE.MeshBasicNodeMaterial();
  adMat.colorNode = mix(color(0x6f8c9a), color(0xe8f2ff).mul(1.6), smoothstep(0.4, 1.1, cityUniforms.uInteriorGlow));
  const machineMat = new THREE.MeshStandardNodeMaterial({ color: 0xf0c419, roughness: 0.45, metalness: 0.3 });
  const screenMat = new THREE.MeshBasicNodeMaterial();
  screenMat.colorNode = mix(color(0x1d2a30), color(0x9fd4ff).mul(1.2), smoothstep(0.4, 1.1, cityUniforms.uInteriorGlow));

  // --- 1. Rails -----------------------------------------------------------------------------------------------------
  const railM = [];
  const grooveM = [];
  const ballastM = [];
  const ties = [];
  for (const tr of tracks) {
    const pieces = Math.max(1, Math.ceil(tr.len / PIECE));
    for (let i = 0; i < pieces; i++) {
      const s0 = (i * tr.len) / pieces;
      const s1 = ((i + 1) * tr.len) / pieces;
      const A = pointAt(tr, s0);
      const B = pointAt(tr, s1);
      const mx = (A.x + B.x) / 2;
      const mz = (A.z + B.z) / 2;
      if (!isLand(mx, mz)) continue;
      const len = Math.hypot(B.x - A.x, B.z - A.z);
      if (len < 0.01) continue;
      const dx = (B.x - A.x) / len;
      const dz = (B.z - A.z) / len;
      const ground = blockAt(mx, mz) ? SW_TOP : 0;
      // Off-street track on ballast, except where it crosses a road
      const ballast = tr.street !== 1 && !ground && laneDist(mx, mz, 4) >= 3.5;
      const headTop = ballast ? ground + 0.27 : ground + 0.016;
      if (ballast) {
        dummy.position.set(mx, ground + 0.06, mz);
        dummy.rotation.set(0, Math.atan2(-dz, dx), 0);
        dummy.scale.set(len + 0.02, 0.16, 2.9);
        ballastM.push(M());
        ties.push(len, s0);
      }
      for (const sg of [1, -1]) {
        const o = sg * (GAUGE / 2 + HEAD_W / 2);
        const h = ballast ? 0.17 : 0.05;
        dummy.position.set(mx - dz * o, headTop - h / 2, mz + dx * o);
        dummy.rotation.set(0, Math.atan2(-dz, dx), 0);
        dummy.scale.set(len + 0.03, h, HEAD_W);
        railM.push(M());
        if (!ballast) {
          const og = sg * (GAUGE / 2 - GROOVE_W / 2);
          dummy.position.set(mx - dz * og, headTop - 0.002 - 0.02, mz + dx * og);
          dummy.scale.set(len + 0.03, 0.04, GROOVE_W);
          grooveM.push(M());
        }
      }
    }
  }
  for (const mesh of [
    instanced('TramRails', unitBox, railMat, railM, {}, false),
    instanced('TramRailGrooves', unitBox, grooveMat, grooveM, {}, false),
    instanced('TramBallast', unitBox, ballastMat, ballastM, { tie: { size: 2, data: ties } }, false)
  ]) if (mesh) group.add(mesh);

  // --- 2. Overhead line ---------------------------------------------------------------------------------------------
  const poleM = [];
  const wireM = [];
  const spanM = [];
  const armM = [];
  const rosetteM = [];
  for (const q of poles) {
    dummy.position.set(q.x, q.h / 2, q.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, q.h, 1);
    poleM.push(M());
    colliders.push({ minX: q.x - 0.16, maxX: q.x + 0.16, minZ: q.z - 0.16, maxZ: q.z + 0.16, maxY: q.h });
  }
  for (const sp of spans) spanM.push(beam(sp.ax, SPAN_Y + 0.15, sp.az, sp.bx, SPAN_Y + 0.15, sp.bz, 0.018, 0.018));
  for (const a of arms) {
    armM.push(beam(a.ax, SPAN_Y, a.az, a.bx, SPAN_Y, a.bz, 0.07, 0.07));
    // diagonal stay from higher up the pole to the arm's middle
    armM.push(beam(a.ax, SPAN_Y + 0.9, a.az, (a.ax + a.bx) / 2, SPAN_Y, (a.az + a.bz) / 2, 0.035, 0.035));
  }
  for (const r of rosettes) {
    dummy.position.set(r.x, SPAN_Y + 0.15, r.z);
    dummy.rotation.set(0, Math.atan2(r.nx, r.nz), 0);
    dummy.scale.set(1, 1, 1);
    rosetteM.push(M());
  }
  for (const d of droppers) wireM.push(beam(d.x, WIRE_Y, d.z, d.x, d.y0 + 0.15, d.z + 0.0001, 0.012, 0.012));
  // Contact wire: straight runs along each track, one piece per polyline segment (split at ~STATION)
  for (const tr of tracks) {
    for (let k = 0; k + 1 < tr.n; k++) {
      const ax = tr.p[2 * k];
      const az = tr.p[2 * k + 1];
      const bx = tr.p[2 * k + 2];
      const bz = tr.p[2 * k + 3];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.05 || !isLand((ax + bx) / 2, (az + bz) / 2)) continue;
      const parts = Math.max(1, Math.ceil(L / STATION));
      for (let j = 0; j < parts; j++) {
        const t0 = j / parts;
        const t1 = (j + 1) / parts;
        wireM.push(beam(ax + (bx - ax) * t0, WIRE_Y, az + (bz - az) * t0, ax + (bx - ax) * t1, WIRE_Y, az + (bz - az) * t1, 0.022, 0.022));
      }
    }
  }
  const poleGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.1, 0.15, 1, 10).toNonIndexed(),
    new THREE.CylinderGeometry(0.12, 0.12, 0.06, 10).translate(0, 0.5, 0).toNonIndexed()
  ]);
  const rosetteGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.08, 10).rotateX(Math.PI / 2).translate(0, 0, 0.04);
  for (const mesh of [
    instanced('CatenaryPoles', poleGeo, steelMat, poleM),
    instanced('CatenaryWires', unitBox, wireMat, wireM, {}, false),
    instanced('CatenarySpans', unitBox, wireMat, spanM, {}, false),
    instanced('CatenaryArms', unitBox, steelMat, armM),
    instanced('CatenaryRosettes', rosetteGeo, steelMat, rosetteM, {}, false)
  ]) if (mesh) group.add(mesh);

  // --- 3. Stops -----------------------------------------------------------------------------------------------------
  const platformM = [];
  const edgeM = [];
  const frameM = [];
  const glassM = [];
  const adM = [];
  const signPoleM = [];
  const plateM = [];
  const plateCells = [];
  const machineM = [];
  const screenM = [];
  const names = [...new Set(stops.map((s) => s.name))].sort();
  const atlas = createPlateAtlas(names);
  const trackByRail = new Map(tracks.map((tr) => [tr.railIndex, tr]));
  const footprint = (x, z, hx, hz, yaw, maxY) => {
    const c = Math.abs(Math.cos(yaw));
    const s = Math.abs(Math.sin(yaw));
    const ex = hx * c + hz * s;
    const ez = hx * s + hz * c;
    colliders.push({ minX: x - ex, maxX: x + ex, minZ: z - ez, maxZ: z + ez, maxY });
  };
  for (const st of stops) {
    if (st.platform) {
      const tr = trackByRail.get(st.railIndex);
      const { s0, s1, o0, o1 } = st.platform;
      const n = Math.max(1, Math.ceil((s1 - s0) / 3));
      const om = (o0 + o1) / 2;
      const w = Math.abs(o1 - o0);
      const oe = o0 + Math.sign(o1 - o0) * 0.25; // tactile strip along the track-side edge
      for (let i = 0; i < n; i++) {
        const A = pointAt(tr, s0 + ((s1 - s0) * i) / n);
        const B = pointAt(tr, s0 + ((s1 - s0) * (i + 1)) / n);
        const len = Math.hypot(B.x - A.x, B.z - A.z);
        const dx = (B.x - A.x) / len;
        const dz = (B.z - A.z) / len;
        const mx = (A.x + B.x) / 2;
        const mz = (A.z + B.z) / 2;
        dummy.rotation.set(0, Math.atan2(-dz, dx), 0);
        dummy.position.set(mx - dz * om, PLATFORM_H / 2 - 0.05, mz + dx * om);
        dummy.scale.set(len + 0.05, PLATFORM_H + 0.1, w);
        platformM.push(M());
        dummy.position.set(mx - dz * oe, PLATFORM_H + 0.002, mz + dx * oe);
        dummy.scale.set(len + 0.05, 0.006, 0.4);
        edgeM.push(M());
      }
    }
    if (st.shelter) {
      const { x, y, z, yaw, len } = st.shelter;
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(len / 4.4, 1, 1);
      const m = M();
      frameM.push(m);
      glassM.push(m);
      adM.push(m);
      footprint(x, z, len / 2, 0.7, yaw, y + 2.6);
    }
    if (st.sign) {
      const { x, y, z, yaw } = st.sign;
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(1, 1, 1);
      const m = M();
      signPoleM.push(m);
      plateM.push(m);
      const i = names.indexOf(st.name);
      plateCells.push(i % atlas.cols, Math.floor(i / atlas.cols));
      footprint(x, z, 0.08, 0.08, 0, y + 3);
    }
    if (st.machine) {
      const { x, y, z, yaw } = st.machine;
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(1, 1, 1);
      const m = M();
      machineM.push(m);
      screenM.push(m);
      footprint(x, z, 0.35, 0.3, yaw, y + 1.8);
    }
  }
  // Shelter (local: 4.4 m along x, open front facing +z, back wall at z = -0.6): four posts, a roof slab, a glass back
  // wall and end panels, one end holding a lit advert, and a bench
  const shelterFrameGeo = mergeGeometries([
    ...[-2.15, 2.15].flatMap((x) => [-0.62, 0.62].map((z) => new THREE.BoxGeometry(0.07, 2.45, 0.07).translate(x, 1.225, z))),
    new THREE.BoxGeometry(4.6, 0.1, 1.6).translate(0, 2.5, 0),
    new THREE.BoxGeometry(2.4, 0.06, 0.4).translate(0, 0.46, -0.38),
    new THREE.BoxGeometry(0.06, 0.4, 0.06).translate(-1, 0.23, -0.38),
    new THREE.BoxGeometry(0.06, 0.4, 0.06).translate(1, 0.23, -0.38)
  ].map((g) => g.toNonIndexed()));
  const shelterGlassGeo = mergeGeometries([
    new THREE.PlaneGeometry(4.2, 2.1).translate(0, 1.2, -0.62),
    new THREE.PlaneGeometry(1.2, 2.1).rotateY(Math.PI / 2).translate(-2.15, 1.2, 0)
  ]);
  const shelterAdGeo = new THREE.BoxGeometry(0.1, 1.75, 1.2).translate(2.15, 1.15, 0);
  // Stop sign: a pole with the name plate across the top (both faces), standing along the track
  const signPoleGeo = new THREE.CylinderGeometry(0.04, 0.04, 2.9, 8).translate(0, 1.45, 0);
  const plateGeo = mergeGeometries([
    new THREE.PlaneGeometry(0.8, 0.4).translate(0, 2.65, 0.035),
    new THREE.PlaneGeometry(0.8, 0.4).rotateY(Math.PI).translate(0, 2.65, -0.035)
  ]);
  const plateMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.4 });
  const cell = attribute('plateCell', 'vec2');
  // canvas row 0 is the texture's top (flipY)
  plateMat.colorNode = texture(atlas.tex, uv().add(vec2(cell.x, float(atlas.rows - 1).sub(cell.y))).div(vec2(atlas.cols, atlas.rows)));
  const plateBackGeo = new THREE.BoxGeometry(0.82, 0.42, 0.06).translate(0, 2.65, 0);
  const machineGeo = mergeGeometries([
    new THREE.BoxGeometry(0.55, 1.6, 0.4).translate(0, 0.8, 0).toNonIndexed(),
    new THREE.BoxGeometry(0.62, 0.08, 0.48).translate(0, 1.64, 0).toNonIndexed()
  ]);
  const screenGeo = new THREE.PlaneGeometry(0.34, 0.26).translate(0, 1.3, 0.201);
  for (const mesh of [
    instanced('TramPlatforms', unitBox, platformMat, platformM),
    instanced('TramPlatformEdges', unitBox, edgeMat, edgeM, {}, false),
    instanced('TramShelterFrames', shelterFrameGeo, frameMat, frameM),
    instanced('TramShelterGlass', shelterGlassGeo, glassMat, glassM, {}, false),
    instanced('TramShelterAdverts', shelterAdGeo, adMat, adM, {}, false),
    instanced('TramStopSignPoles', signPoleGeo, frameMat, signPoleM),
    instanced('TramStopPlateBacks', plateBackGeo, frameMat, plateM),
    instanced('TramStopPlates', plateGeo, plateMat, plateM, { plateCell: { size: 2, data: plateCells } }, false),
    instanced('TicketMachines', machineGeo, machineMat, machineM),
    instanced('TicketMachineScreens', screenGeo, screenMat, screenM, {}, false)
  ]) if (mesh) group.add(mesh);

  scene.add(group);
  const publicStops = stops.map(({ name, x, z, heading, railIndex, s, dir, side, kind }) => ({ name, x, z, heading, railIndex, s, dir, side, kind }));
  console.info(`[tram-infra] ${tracks.length} tracks, ${poles.length} poles, ${spans.length} span wires, ${arms.length} arms, ` +
    `${rosettes.length} rosettes; ${stops.length} stops (${stops.filter((s) => s.kind === 'island').length} islands) ` +
    `of ${GEO.tramStops.length} stop nodes`);
  return { group, colliders, stops: publicStops };
}

export { layoutTramInfrastructure, buildTramInfrastructure };
