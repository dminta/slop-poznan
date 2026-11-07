import * as THREE from 'three/webgpu';
import { addMesh, box, cylinder, lathe, pitchedRoof, profileSlab, collider, fitToSite } from './landmark-kit.js';
import { LANDMARK_SITES } from './city-config.js';

// js/landmarks-historic.js
// Eleven historic buildings of the old town, Ostrów Tumski and the Dzielnica Cesarska: Biblioteka Raczyńskich, Pałac
// Działyńskich, Hotel Bazar, Muzeum Narodowe, Teatr Polski, Collegium Maius and the Bernardine, Franciscan, NMP in
// Summo, św. Wojciech and Boże Ciało churches. Modelled in metres around a local origin (conventions in
// landmark-kit.js), each fitted onto its OpenStreetMap outline at scale 1.000: each model keeps the bounding box,
// height and top position verified against the GUGiK lidar (docs/observations/landmarks-2026-11-05.md), so detail is
// added inside that envelope (walls are set back where cornices and pilasters stand proud of them).
//
// All eleven sites are turned (`ang` ≠ 0). The kit's box-local facade pass passes the part's yaw so turned boxes
// get window bays between solid masonry corners; plain wall runs use it where it doesn't clash with modelled
// details. Modelled window panes use M.glassLit (warm interior glow at night driven by city lighting uniforms; each
// pane carries its own seed in uv.x and lit share in uv.y, with 0.20 on churches). Small parts are gathered per
// material into one merged mesh per wall or massing unit (`parts` / `emit`), so a facade of 40 windows costs one
// mesh, not 120. That keeps the build and the batching pass cheap, and a straight wall's parts keep a thin convex
// hull for the footprint and roadway tests.

// Measured heights (m) from GUGiK ISOK LiDAR DSM − DTM queries (docs/observations/landmarks-2026-11-05.md)
const RACZYNSKI = { top: 18.6 };
const DZIALYNSKI = { top: 22.25 };
const BAZAR = { top: 24.4 };
const MUZEUM = { top: 26.0 };
const TEATR_PL = { top: 23.9 };
const MAIUS = { top: 36.4 };
const BERNARDYNI = { top: 44.7 };
const FRANCISZKANIE = { top: 32.6 };
const NMP = { top: 28.8 };
const WOJCIECH = { top: 23.9 };
const BOZE_CIALO = { top: 39.5 };

const site = (name) => LANDMARK_SITES[name];

// -------------------------------------------------------------------------------------------------------------------
// Merged part meshes. A part list holds boxes ([w, h, d, x, y, z, mask], y at the base like the kit's box; mask picks
// the faces drawn), turned boxes ({ obox: [w, h, d, x, y, z, a], mask }, turned by a about y), convex polygons
// ({ poly: [[x, y, z], ...], n: outward normal }) and frustum rings ({ ring: [rBottom, rTop, h, segments, x, y, z],
// a0, sweep, cap }: column shafts, drums, turrets, smooth-shaded; angles from +z towards +x). One list becomes one
// non-indexed geometry with position, normal and uv (metres on the face's dominant plane), which
// batchStaticGroupMeshes merges like any kit part.
// -------------------------------------------------------------------------------------------------------------------
const PX = 1, NX = 2, PY = 4, NY = 8, PZ = 16, NZ = 32;
const SIDES = PX | NX | PZ | NZ;
const BOX_FACES = [
  [PX, [1, 0, 0], [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]]],
  [NX, [-1, 0, 0], [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]]],
  [PY, [0, 1, 0], [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]]],
  [NY, [0, -1, 0], [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]],
  [PZ, [0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]],
  [NZ, [0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]]
];

function newell(pts) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

let _litPaneId = 0;
let _currentLitMat = null;

// Vertices partsGeometry writes for a list, so it can fill typed arrays in place: pushing into plain arrays and
// copying them cut the warm build from 36 to 27 ms in the vm test harness (Node 26, three r180, 2026-11-06)
function partsVertexCount(list) {
  let n = 0;
  for (const e of list) {
    if (Array.isArray(e) || e.obox) {
      let mask = Array.isArray(e) ? (e[6] ?? 63) : (e.mask ?? 63);
      for (; mask; mask &= mask - 1) n += 6;
    } else if (e.poly) {
      n += (e.poly.length - 2) * 3;
    } else if (e.ring) {
      const segs = e.ring[3];
      n += segs * (e.ring[1] > 0 ? 6 : 3);
      if (e.cap && e.ring[1] > 0) n += segs * 3;
    }
  }
  return n;
}

function partsGeometry(list) {
  const count = partsVertexCount(list);
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  let iv = 0;
  const vert = (p, n, uvVal) => {
    const i3 = iv * 3, i2 = iv * 2;
    pos[i3] = p[0]; pos[i3 + 1] = p[1]; pos[i3 + 2] = p[2];
    nor[i3] = n[0]; nor[i3 + 1] = n[1]; nor[i3 + 2] = n[2];
    if (uvVal) {
      uv[i2] = uvVal[0];
      uv[i2 + 1] = uvVal[1];
    } else {
      const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
      if (ax >= ay && ax >= az) { uv[i2] = p[2]; uv[i2 + 1] = p[1]; }
      else if (ay >= az) { uv[i2] = p[0]; uv[i2 + 1] = p[2]; }
      else { uv[i2] = p[0]; uv[i2 + 1] = p[1]; }
    }
    iv++;
  };
  // A convex polygon as a triangle fan, wound so its normal faces `want`; `ns`: optional smooth vertex normals
  const fan = (pts, want, ns, uvVal) => {
    let p = pts;
    let vn = ns;
    let n = newell(pts);
    if (n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0) {
      p = pts.slice().reverse();
      vn = ns && ns.slice().reverse();
      n = [-n[0], -n[1], -n[2]];
    }
    for (let i = 1; i < p.length - 1; i++) {
      vert(p[0], vn ? vn[0] : n, uvVal);
      vert(p[i], vn ? vn[i] : n, uvVal);
      vert(p[i + 1], vn ? vn[i + 1] : n, uvVal);
    }
  };
  const boxFaces = (w, h, d, mask, map) => {
    for (const [bit, n, cs] of BOX_FACES) {
      if (mask & bit) fan(cs.map(([sx, sy, sz]) => map(sx * w / 2, sy * h / 2, sz * d / 2)), map(n[0], n[1], n[2], true));
    }
  };
  for (const e of list) {
    if (Array.isArray(e)) {
      const [w, h, d, x, y, z, mask = 63] = e;
      boxFaces(w, h, d, mask, (lx, ly, lz, dir) => (dir ? [lx, ly, lz] : [x + lx, y + h / 2 + ly, z + lz]));
    } else if (e.obox) {
      const [w, h, d, x, y, z, a] = e.obox;
      const c = Math.cos(a), s = Math.sin(a);
      boxFaces(w, h, d, e.mask ?? 63, (lx, ly, lz, dir) => {
        const rx = lx * c + lz * s;
        const rz = -lx * s + lz * c;
        return dir ? [rx, ly, rz] : [x + rx, y + h / 2 + ly, z + rz];
      });
    } else if (e.poly) {
      fan(e.poly, e.n || newell(e.poly), null, e.uv);
    } else if (e.ring) {
      const [rb, rt, h, segs, x, y, z] = e.ring;
      const a0 = e.a0 ?? 0;
      const sweep = e.sweep ?? Math.PI * 2;
      const k = (rb - rt) / h;
      const l = Math.hypot(1, k);
      const at = (r, a, py) => [x + r * Math.sin(a), py, z + r * Math.cos(a)];
      const sn = (a) => [Math.sin(a) / l, k / l, Math.cos(a) / l];
      const cap = [[x, y + h, z]];
      for (let i = 0; i < segs; i++) {
        const a = a0 + (sweep * i) / segs;
        const b = a0 + (sweep * (i + 1)) / segs;
        const m = (a + b) / 2;
        const want = [Math.sin(m), k, Math.cos(m)];
        if (rt > 0) fan([at(rb, a, y), at(rb, b, y), at(rt, b, y + h), at(rt, a, y + h)], want, [sn(a), sn(b), sn(b), sn(a)]);
        else fan([at(rb, a, y), at(rb, b, y), [x, y + h, z]], want, [sn(a), sn(b), sn(m)]);
        if (e.cap) cap.push(at(rt, a, y + h));
      }
      if (e.cap && rt > 0) {
        cap.push(at(rt, a0 + sweep, y + h));
        fan(cap, [0, 1, 0]);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

// A parts collector: material → part list. emit() turns every list into one mesh and empties the collector.
const parts = (litShare = 0.45) => Object.assign(new Map(), { litShare });
function put(b, material, entry) {
  let l = b.get(material);
  if (!l) b.set(material, (l = []));
  l.push(entry);
}
function emit(parent, b) {
  for (const [material, list] of b) if (list.length) addMesh(parent, partsGeometry(list), material);
  b.clear();
}

// -------------------------------------------------------------------------------------------------------------------
// Wall faces. face('z', at, s) is the wall plane z = at with its outside towards sign s (face('x', ...) likewise),
// u running along the wall (x on a z face, z on an x face); gface(ox, oz, a) is a wall of any heading through
// (ox, oz) with its outward normal at angle a from +z towards +x (u along (cos a, -sin a)), and rface the tangent wall
// of a round drum. v is height, `off` the distance out of the wall.
// -------------------------------------------------------------------------------------------------------------------
const face = (axis, at, s) => ({ axis, at, s });
const gface = (ox, oz, a) => ({ axis: 'g', ox, oz, a });
const rface = (cx, cz, r, a) => gface(cx + r * Math.sin(a), cz + r * Math.cos(a), a);
function faceN(f) {
  if (f.axis === 'g') return [Math.sin(f.a), 0, Math.cos(f.a)];
  return f.axis === 'z' ? [0, 0, f.s] : [f.s, 0, 0];
}
// The wall's u direction
function faceT(f) {
  if (f.axis === 'g') return [Math.cos(f.a), 0, -Math.sin(f.a)];
  return f.axis === 'z' ? [1, 0, 0] : [0, 0, 1];
}
function facePt(f, u, v, off) {
  if (f.axis === 'g') {
    const c = Math.cos(f.a), s = Math.sin(f.a);
    return [f.ox + u * c + off * s, v, f.oz - u * s + off * c];
  }
  return f.axis === 'z' ? [u, v, f.at + f.s * off] : [f.at + f.s * off, v, u];
}
// A box on a face: du along the wall, h tall from v, dn deep, its centre `off` out of the wall. The side against the
// wall is never drawn.
function fbox(f, u, du, v, h, off, dn, mask = 63) {
  if (f.axis === 'g') {
    const [x, , z] = facePt(f, u, v, off);
    return { obox: [du, h, dn, x, v, z, f.a], mask: mask & ~NZ };
  }
  const back = f.axis === 'z' ? (f.s > 0 ? NZ : PZ) : f.s > 0 ? NX : PX;
  const c = f.at + f.s * off;
  return f.axis === 'z' ? [du, h, dn, u, v, c, mask & ~back] : [dn, h, du, c, v, u, mask & ~back];
}
// A course (string course, cornice, plinth band) from u0 to u1, dn proud of the wall
function band(b, material, f, u0, u1, v, h, dn, mask = 63) {
  put(b, material, fbox(f, (u0 + u1) / 2, u1 - u0, v, h, dn / 2, dn, mask));
}
function pilaster(b, material, f, u, v, h, w = 0.7, dn = 0.25) {
  put(b, material, fbox(f, u, w, v, h, dn / 2, dn));
}
// A flat panel (pane, niche field, relief, inscription) of outline [[du, dv], ...] about (u, v), `off` out of the wall
function panel(b, material, f, outline, u, v, off = 0.03, litShare = b.litShare ?? 0.45) {
  const entry = { poly: outline.map(([du, dv]) => facePt(f, u + du, v + dv, off)), n: faceN(f) };
  if (material === _currentLitMat || (material && (material.isLitWindow || material.userData?.isLitWindow))) {
    entry.uv = [++_litPaneId, litShare];
  }
  put(b, material, entry);
}

const rectOutline = (w, h) => [[-w / 2, 0], [w / 2, 0], [w / 2, h], [-w / 2, h]];
// Round-headed opening, w wide and h tall to the crown
function archOutline(w, h, segs = 6) {
  const r = w / 2;
  const pts = [[-r, 0], [r, 0]];
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI;
    pts.push([Math.cos(a) * r, h - r + Math.sin(a) * r]);
  }
  return pts;
}
// Equilateral pointed (Gothic) arch, w wide and h tall to the apex: each side an arc of radius w about the opposite
// springer, the apex 0.866 w over the springing line
function pointOutline(w, h, segs = 3) {
  const hw = w / 2;
  const spring = h - 0.866 * w;
  const pts = [[-hw, 0], [hw, 0]];
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * (Math.PI / 3);
    pts.push([-hw + Math.cos(a) * w, spring + Math.sin(a) * w]);
  }
  for (let i = segs - 1; i >= 0; i--) {
    const a = (i / segs) * (Math.PI / 3);
    pts.push([hw - Math.cos(a) * w, spring + Math.sin(a) * w]);
  }
  return pts;
}
// A disc outline of radius r centred r above its base point
function discOutline(r, segs = 10) {
  const pts = [];
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    pts.push([Math.cos(a) * r, r + Math.sin(a) * r]);
  }
  return pts;
}
const OUTLINES = { rect: rectOutline, arch: archOutline, point: pointOutline };

// One window: the pane 3 cm proud of the wall, a stone sill below, a lintel cornice (`hood: true`) or a small
// triangular pediment (`hood: 'pediment'`) above, and stone jambs (`jambs`). Gothic windows (`mullions` n) get n
// brick mullions instead of a stone surround.
function win(b, M, f, u, v, w, h, opts = {}) {
  const { shape = 'rect', trim = M.sandstone, glass = M.glassLit, sill = true, hood = false, jambs = false, mullions = 0, litShare = b.litShare ?? 0.45 } = opts;
  panel(b, glass, f, OUTLINES[shape](w, h), u, v, 0.035, litShare);
  if (sill) band(b, trim, f, u - w / 2 - 0.15, u + w / 2 + 0.15, v - 0.16, 0.16, 0.24, SIDES | PY);
  if (hood === 'pediment') {
    band(b, trim, f, u - w / 2 - 0.25, u + w / 2 + 0.25, v + h + 0.05, 0.18, 0.28);
    panel(b, trim, f, [[-w / 2 - 0.3, 0], [w / 2 + 0.3, 0], [0, 0.55]], u, v + h + 0.23, 0.2);
  } else if (hood) {
    band(b, trim, f, u - w / 2 - 0.25, u + w / 2 + 0.25, v + h + 0.05, 0.22, 0.3);
  }
  if (jambs) {
    for (const s of [-1, 1]) put(b, trim, fbox(f, u + s * (w / 2 + 0.1), 0.2, v, h, 0.06, 0.12, SIDES | PY));
  }
  for (let i = 1; i <= mullions; i++) {
    const du = -w / 2 + (i * w) / (mullions + 1);
    put(b, trim, fbox(f, u + du, 0.14, v, h - 0.6 * w, 0.08, 0.16, SIDES | PY));
  }
}
// Rows of windows: one per u in `us` on every storey sill height in `vs`
function windowGrid(b, M, f, us, vs, w, h, opts) {
  for (const v of vs) for (const u of us) win(b, M, f, u, v, w, h, opts);
}
// n bay centres evenly spread from u0 to u1 (inclusive)
function spread(u0, u1, n) {
  if (n === 1) return [(u0 + u1) / 2];
  const out = [];
  for (let i = 0; i < n; i++) out.push(u0 + ((u1 - u0) * i) / (n - 1));
  return out;
}
// A standing figure (statue) h tall on a small plinth: a tapered robe ring and a head
function statue(b, material, x, y, z, h = 1.9) {
  const k = h / 1.9;
  put(b, material, [0.6 * k, 0.25, 0.6 * k, x, y, z, SIDES | PY]);
  put(b, material, { ring: [0.3 * k, 0.17 * k, 0.78 * h - 0.25, 6, x, y + 0.25, z], cap: true });
  put(b, material, { ring: [0.13 * k, 0.09 * k, 0.22 * h, 5, x, y + 0.78 * h, z], cap: true });
}
// A column of the classical orders: square base, tapering shaft, flared capital and abacus, h tall from y
// (`obj`: the shaft becomes its own kit cylinder under obj, a free-standing colonnade the tests can find)
function column(b, material, x, y, z, h, r, segs = 8, obj = null) {
  put(b, material, [r * 2.5, 0.4, r * 2.5, x, y, z, SIDES | PY]);
  const shaft = h - 0.4 - 0.85;
  if (obj) cylinder(obj, r * 0.86, r, shaft, segs, material, x, y + 0.4, z);
  else put(b, material, { ring: [r, r * 0.86, shaft, segs, x, y + 0.4, z] });
  put(b, material, { ring: [r * 0.86, r * 1.25, 0.7, segs, x, y + 0.4 + shaft, z] });
  put(b, material, [r * 2.7, 0.15, r * 2.7, x, y + h - 0.15, z, SIDES | PY]);
}
// Rectangular frustum (mansard lower slopes, skirt roofs): the w0 × d0 rectangle at y up to w1 × d1 at y + h, capped
function frustum(b, material, w0, d0, w1, d1, h, x, y, z) {
  const c = (w, d, py) => [[x - w / 2, py, z - d / 2], [x + w / 2, py, z - d / 2], [x + w / 2, py, z + d / 2], [x - w / 2, py, z + d / 2]];
  const lo = c(w0, d0, y);
  const hi = c(w1, d1, y + h);
  const outs = [[0, 0.3, -1], [1, 0.3, 0], [0, 0.3, 1], [-1, 0.3, 0]];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    put(b, material, { poly: [lo[i], lo[j], hi[j], hi[i]], n: outs[i] });
  }
  put(b, material, { poly: hi, n: [0, 1, 0] });
}
// A dormer on a roof slope facing f: cheeks, a pane and a small gabled cap; its front stands `off` from the wall plane
// (negative: set back up the slope), its sill at v
function dormer(b, M, f, u, v, roofMat, { w = 1.3, h = 1.5, d = 1.4, off = 0, wall = M.plasterWhite, litShare = b.litShare ?? 0.45 } = {}) {
  put(b, wall, fbox(f, u, w, v, h, off - d / 2, d, SIDES | PY));
  panel(b, M.glassLit, f, rectOutline(w - 0.5, h - 0.45), u, v + 0.22, off + 0.02, litShare);
  const p = (du, dv, dd) => facePt(f, u + du, v + h + dv, off + dd);
  const hw = w / 2 + 0.12;
  const n = faceN(f);
  const t = faceT(f);
  put(b, roofMat, { poly: [p(-hw, 0, 0.12), p(0, 0.6, 0.12), p(0, 0.6, -d), p(-hw, 0, -d)], n: [-t[0], 1, -t[2]] });
  put(b, roofMat, { poly: [p(hw, 0, -d), p(0, 0.6, -d), p(0, 0.6, 0.12), p(hw, 0, 0.12)], n: [t[0], 1, t[2]] });
  put(b, wall, { poly: [p(-w / 2, 0, 0.04), p(w / 2, 0, 0.04), p(0, 0.52, 0.04)], n });
}
// A gable outline ([u, v] about the wall's centre line) as a slab `depth` thick, facing ±x (axis 'x') or ±z
function gableSlab(obj, outline, depth, material, x, y, z, axis) {
  return profileSlab(obj, outline, depth, material, x, y, z, axis === 'x' ? Math.PI / 2 : 0);
}
// A Baroque gable outline: span w at the base, shoulders sweeping in to a waist `waist` wide at h1 and a segmental
// crown up to h (its apex exactly at h). `bulge` blends the shoulders from straight (0) to a full quarter-ellipse (1):
// about 0.4 keeps them clear of a steep roof behind without the gable reading as a dome.
function curvedGable(w, waist, h1, h, segs = 4, bulge = 0.4) {
  const shoulder = (a) => {
    const t = a / (Math.PI / 2);
    const u = waist / 2 + ((w - waist) / 2) * ((1 - bulge) * (1 - t) + bulge * Math.cos(a));
    return [u, h1 * ((1 - bulge) * t + bulge * Math.sin(a))];
  };
  const pts = [[-w / 2, 0], [w / 2, 0]];
  for (let i = 1; i <= segs; i++) pts.push(shoulder((i / segs) * (Math.PI / 2)));
  for (let i = 1; i < 2 * segs; i++) {
    const a = (i / (2 * segs)) * Math.PI;
    pts.push([(waist / 2) * Math.cos(a), h1 + (h - h1) * Math.sin(a)]);
  }
  for (let i = 0; i < segs; i++) {
    const [u, v] = shoulder((Math.PI / 2) * (1 - i / segs));
    pts.push([-u, v]);
  }
  return pts;
}
// A scrolled (volute) gable outline that hides the roof end behind it: from half-width B at its foot it climbs in
// `tiers` convex scrolls with small ledges, each ending `margin` outside the roof's raking line (the roof end
// triangle of half-width rb and rise rh above the gable's foot), then a segmental crown up to `top`. Each scroll
// bulges outside its chord, so the whole roof triangle stays behind the gable.
function scrollGable(B, rb, rh, tiers, top, margin = 0.4, segs = 3) {
  const right = [[B, 0]];
  let u0 = B, v0 = 0;
  let hw = B, vt = 0;
  for (let k = 1; k <= tiers; k++) {
    vt = (rh * k) / (tiers + 1);
    hw = Math.min(u0, rb * (1 - vt / rh) + margin);
    for (let i = 1; i <= segs; i++) {
      const t = (i / segs) * (Math.PI / 2);
      right.push([hw + (u0 - hw) * Math.cos(t), v0 + (vt - v0) * Math.sin(t)]);
    }
    if (k < tiers) right.push([hw + 0.35, vt]);
    u0 = hw + 0.35;
    v0 = vt;
  }
  for (let i = 1; i < 4; i++) {
    const a = (i / 4) * (Math.PI / 2);
    right.push([hw * Math.cos(a), vt + (top - vt) * Math.sin(a)]);
  }
  const left = right.slice().reverse().map(([u, v]) => [-u, v]);
  return [...right, [0, top], ...left];
}
// A stepped gable outline: half-widths hw[k] and step heights vs[k] (outer to inner), crowned flat at the last step
function steppedOutline(hws, vs) {
  const right = [[hws[0], 0]];
  for (let k = 0; k < hws.length; k++) {
    right.push([hws[k], vs[k]]);
    if (k + 1 < hws.length) right.push([hws[k + 1], vs[k]]);
  }
  const left = right.slice().reverse().map(([u, v]) => [-u, v]);
  return [...right, ...left];
}
// A tower helm by lathe ([r, y] profile from its base) with a wrought-iron cross on the tip: the cross top stands
// 1.2 m over the profile's last point
function helm(obj, M, profile, segs, x, y, z, material = M.copper) {
  lathe(obj, profile, segs, material, x, y, z);
  const tip = y + profile[profile.length - 1][1];
  const b = parts();
  put(b, M.darkMetal, [0.12, 1.3, 0.12, x, tip - 0.1, z]);
  put(b, M.darkMetal, [0.7, 0.1, 0.1, x, tip + 0.75, z]);
  put(b, M.darkMetal, [0.1, 0.1, 0.7, x, tip + 0.75, z]);
  emit(obj, b);
}
// Openings (panes) round a ring at radius r: one per angle in `as`
function ringPanes(b, material, cx, cz, r, as, v, w, h, shape = 'rect') {
  for (const a of as) panel(b, material, rface(cx, cz, r, a), OUTLINES[shape](w, h), 0, v, 0.02);
}
// Rustication: channelled joints (thin courses 3 cm proud, top and front only) every 0.75 m from v0 to v1
function rusticate(b, material, f, u0, u1, v0, v1) {
  const mask = f.axis === 'z' ? PY | (f.s > 0 ? PZ : NZ) : PY | (f.s > 0 ? PX : NX);
  for (let v = v0 + 0.7; v < v1 - 0.2; v += 0.75) band(b, material, f, u0, u1, v, 0.07, 0.03, mask);
}

// -------------------------------------------------------------------------------------------------------------------
// Biblioteka Raczyńskich (1822–1829): its main front on Plac Wolności (+z) modelled on the Louvre's east colonnade —
// twelve pairs of cast-iron Corinthian columns on a rusticated plinth, carrying an architrave and a balustrade that
// partly hides the copper-clad hipped roof, a triangular tympanum on the axis, and the first and second floors set back
// behind the columns into a loggia (pl.wikipedia "Biblioteka Raczyńskich"). Bay widths, storey heights and the window
// openings are from general knowledge / photos. Envelope: 39.6 × 16.1 m, top 18.6 m (the roof ridge).
// -------------------------------------------------------------------------------------------------------------------
function buildRaczynski(group, colliders, M) {
  const c0 = colliders.length;
  const obj = new THREE.Group();
  const b = parts();
  const W = 39.6, D = 16.0;
  const P = 4.4; // plinth top: the loggia floor
  const ENT = 13.5; // entablature base
  const LOGGIA = 5.6; // loggia back wall
  const COLZ = 7.25;
  const wall = M.plasterCream;
  const trim = M.plasterWhite;

  // Rusticated plinth with channelled joints on all four faces
  box(obj, W - 0.08, P, D - 0.08, M.sandstone, 0, 0, 0);
  const pf = face('z', D / 2 - 0.04, 1), pb = face('z', -D / 2 + 0.04, -1);
  const pe = face('x', W / 2 - 0.04, 1), pw = face('x', -W / 2 + 0.04, -1);
  for (const f of [pf, pb]) rusticate(b, M.stoneGrey, f, -W / 2 + 0.04, W / 2 - 0.04, 0, P);
  for (const f of [pe, pw]) rusticate(b, M.stoneGrey, f, -D / 2 + 0.04, D / 2 - 0.04, 0, P);
  // Twelve column pairs 3.27 m apart: arched plinth windows between them, the entrance on the axis
  const pairs = spread(-18, 18, 12);
  const bays = pairs.slice(1).map((x, i) => (x + pairs[i]) / 2);
  for (const x of bays) {
    if (Math.abs(x) < 0.1) {
      panel(b, M.wood, pf, archOutline(2.0, 3.3), x, 0, 0.04);
      for (const s of [-1, 1]) pilaster(b, M.sandstone, pf, x + s * 1.25, 0, 3.6, 0.4, 0.13);
    } else {
      win(b, M, pf, x, 1.2, 1.2, 2.1, { shape: 'arch', sill: false });
    }
  }
  for (const f of [pe, pw]) windowGrid(b, M, f, [-5, -1, 3], [1.2], 1.1, 2.0, { shape: 'arch', sill: false });
  windowGrid(b, M, pb, bays, [1.2], 1.1, 2.0, { shape: 'arch', sill: false });

  // Upper block behind the loggia: two storeys, windows in every bay (responds behind each column pair)
  box(obj, W - 0.6, ENT - P + 1.3, LOGGIA + 7.7, wall, 0, P, (LOGGIA - 7.7) / 2);
  const lf = face('z', LOGGIA, 1);
  for (const x of pairs) pilaster(b, trim, lf, x, P, ENT - P, 1.7, 0.15);
  windowGrid(b, M, lf, bays, [5.6], 1.5, 3.0, { trim, hood: 'pediment' });
  windowGrid(b, M, lf, bays, [10.2], 1.3, 1.9, { trim });
  const ub = face('z', -7.7, -1), ue = face('x', W / 2 - 0.3, 1), uw = face('x', -W / 2 + 0.3, -1);
  windowGrid(b, M, ub, bays, [5.6], 1.4, 2.8, { trim, hood: true });
  windowGrid(b, M, ub, bays, [10.2], 1.3, 1.9, { trim });
  for (const f of [ue, uw]) {
    windowGrid(b, M, f, [-5, -1, 3], [5.6], 1.4, 2.8, { trim, hood: true });
    windowGrid(b, M, f, [-5, -1, 3], [10.2], 1.3, 1.9, { trim });
    band(b, trim, f, -7.7, LOGGIA, ENT, 1.3, 0.3); // architrave and frieze round the flanks
  }
  band(b, trim, ub, -W / 2 + 0.3, W / 2 - 0.3, ENT, 1.3, 0.3);

  // The colonnade: paired Corinthian columns on pedestals, 9.1 m from the loggia floor to the entablature
  for (const x of pairs) {
    put(b, trim, [2.1, 0.7, 1.1, x, P, COLZ, SIDES | PY]);
    for (const s of [-1, 1]) column(b, trim, x + s * 0.55, P + 0.7, COLZ, ENT - P - 0.7, 0.33, 8, obj);
  }
  // Entablature: architrave, frieze and cornice across the front (z 6.5..8.1), the cornice slab over the whole block
  put(b, trim, [W, 0.6, 1.5, 0, ENT, 7.35]);
  put(b, trim, [W - 0.1, 0.7, 1.4, 0, ENT + 0.6, 7.3, SIDES]);
  put(b, trim, [W, 0.4, 16.1, 0, ENT + 1.3, 0.05]);
  const COR = ENT + 1.7;
  // Balustrade over the colonnade (pedestals over the pairs, balusters between), broken by the tympanum on the axis
  const pedi = 4.95;
  for (let i = 0; i < pairs.length; i++) {
    const x = pairs[i];
    if (Math.abs(x) < pedi) continue;
    put(b, trim, [1.5, 1.1, 0.9, x, COR, 7.55]);
    if (i < pairs.length - 1 && Math.abs(bays[i]) > pedi) {
      for (const du of spread(-1.0, 1.0, 5)) put(b, trim, [0.16, 0.8, 0.16, bays[i] + du, COR + 0.14, 7.55, SIDES]);
    }
  }
  for (const s of [-1, 1]) {
    const x0 = s * pedi, x1 = s * (W / 2);
    put(b, trim, [Math.abs(x1 - x0), 0.14, 0.7, (x0 + x1) / 2, COR, 7.55]);
    put(b, trim, [Math.abs(x1 - x0), 0.16, 0.8, (x0 + x1) / 2, COR + 0.94, 7.55]);
    // Solid attic parapet round the flanks and back
    put(b, trim, [0.4, 1.1, D - 0.9, s * (W / 2 - 0.2), COR, -0.45]);
  }
  put(b, trim, [W, 1.1, 0.4, 0, COR, -7.8]);
  gableSlab(obj, [[-5.6, 0], [5.6, 0], [0, 2.5]], 1.6, trim, 0, COR, 7.26, 'z');
  panel(b, M.sandstone, face('z', 8.06, 1), [[-4.6, 0.25], [4.6, 0.25], [0, 2.0]], 0, COR, 0.03);
  // Copper-clad hipped roof, half hidden by the balustrade
  pitchedRoof(obj, W - 1.8, D - 3.0, RACZYNSKI.top - 15.6, M.copper, 0, 15.6, -0.8, { hip: 0.8 });
  emit(obj, b);

  group.add(obj);
  collider(colliders, -W / 2, W / 2, -D / 2, D / 2, RACZYNSKI.top);
  fitToSite([obj], site('Biblioteka Raczyńskich'), colliders, c0, { height: RACZYNSKI.top });
}

// -------------------------------------------------------------------------------------------------------------------
// Pałac Działyńskich (Stary Rynek 78, 1773–1776): the Baroque-Classicist east front on the Rynek (+x) divided by
// Corinthian pilasters, crowned by a late 18th-century attic whose tympanum carries the Ogończyk arms, flanked by
// 19th-century Roman legionaries, with relief panels of a sacrificial and a triumphal procession, and above it a
// truncated obelisk with the pelican (a reconstruction) between panoplia; the Sala Czerwona spans the full width of
// the first floor (pl.wikipedia "Pałac Działyńskich w Poznaniu"). Seven window axes, the central three in a shallow
// avant-corps, the giant order over the two upper floors and the slate mansard roof are from general knowledge /
// photos. Envelope 49.0 × 19.7 m; the pelican's raised wings are the 22.25 m lidar peak at the east end.
// -------------------------------------------------------------------------------------------------------------------
function buildDzialynski(group, colliders, M) {
  const c0 = colliders.length;
  const obj = new THREE.Group();
  const b = parts();
  const g = parts();
  const W = 49.0, D = 19.7;
  const HD = D / 2;
  const EAVE = 15.8;
  const wall = M.plasterCream;
  const trim = M.plasterWhite;

  // Main block, its walls set in so the cornices stand within the outline
  box(obj, 48.25, EAVE, 19.1, wall, -0.125, 0, 0);
  const ff = face('x', 24.0, 1);
  const fa = face('x', 24.2, 1); // the avant-corps
  const AX = [-7.65, -5.1, -2.55, 0, 2.55, 5.1, 7.65];
  const PIL = [-8.925, -6.375, -3.825, -1.275, 1.275, 3.825, 6.375, 8.925];
  put(b, wall, fbox(ff, 0, 7.7, 4.95, EAVE - 4.95, 0.1, 0.2));
  // Ground floor: rusticated, the arched portal on the axis between stone pilasters
  rusticate(b, trim, ff, -9.55, 9.55, 0, 4.6);
  panel(b, M.wood, ff, archOutline(2.2, 3.7), 0, 0, 0.05);
  for (const s of [-1, 1]) pilaster(b, M.sandstone, ff, s * 1.55, 0, 3.9, 0.5, 0.3);
  band(b, M.sandstone, ff, -2.0, 2.0, 3.9, 0.45, 0.4);
  for (const z of AX) if (z) win(b, M, ff, z, 1.5, 1.1, 1.7, { trim });
  band(b, trim, ff, -9.55, 9.55, 4.6, 0.35, 0.35);
  // Giant Corinthian pilasters through the two upper floors, the Sala Czerwona's tall windows and the second floor's
  for (const z of PIL) {
    const f = Math.abs(z) < 4 ? fa : ff;
    pilaster(b, trim, f, z, 4.95, 9.65, 0.55, 0.22);
    put(b, trim, fbox(f, z, 0.8, 14.6, 0.45, 0.15, 0.3));
  }
  for (const z of AX) {
    const f = Math.abs(z) < 4 ? fa : ff;
    win(b, M, f, z, 5.75, 1.25, 3.3, { trim, hood: Math.abs(z) < 4 ? 'pediment' : true, jambs: true });
    win(b, M, f, z, 10.9, 1.15, 2.2, { trim, jambs: true });
  }
  band(b, trim, ff, -HD, HD, 14.95, 0.55, 0.35);
  band(b, trim, ff, -HD, HD, 15.5, 0.27, 0.5);
  // The attic: piers over the pilasters, relief panels of the two processions, the cornice
  box(obj, 1.0, 2.0, D, wall, 23.6, EAVE, 0);
  const ft = face('x', 24.1, 1);
  for (const z of PIL) pilaster(b, trim, ft, z, EAVE, 2.0, 0.6, 0.2);
  for (const z of [-7.65, -5.1, 5.1, 7.65]) {
    panel(b, M.sandstone, ft, rectOutline(1.8, 1.25), z, 16.15, 0.03);
    for (const du of [-0.55, 0, 0.55]) put(b, M.sandstone, fbox(ft, z + du, 0.28, 16.25, 0.95, 0.08, 0.1));
  }
  band(b, trim, ft, -HD, HD, 17.55, 0.25, 0.35);
  // Tympanum on the attic with the Ogończyk arms in a cartouche; two legionaries beside it
  gableSlab(obj, [[-4.1, 0], [4.1, 0], [0, 2.15]], 0.4, trim, 23.95, 17.8, 0, 'x');
  gableSlab(obj, [[-3.7, 0.1], [3.7, 0.1], [0, 1.85]], 0.4, wall, 24.1, 17.8, 0, 'x');
  const tf = face('x', 24.3, 1);
  panel(b, trim, tf, [[-0.5, 0], [0.5, 0], [0.55, 0.6], [0, 1.05], [-0.55, 0.6]], 0, 17.95, 0.01);
  panel(g, M.gold, tf, rectOutline(0.12, 0.55), 0, 18.0, 0.02); // the Ogończyk arrow: shaft and head
  panel(g, M.gold, tf, [[-0.22, 0], [0.22, 0], [0, 0.45]], 0, 18.4, 0.02);
  for (const s of [-1, 1]) statue(b, M.sandstone, 23.6, 17.8, s * 4.6, 1.7);
  // Truncated obelisk behind the tympanum, flanked by panoplia (trophies of arms)
  put(b, M.sandstone, { ring: [0.85, 0.55, 3.25, 4, 23.4, 17.8, 0], a0: Math.PI / 4 });
  put(b, M.sandstone, [1.3, 0.15, 1.3, 23.4, 21.05, 0]);
  for (const s of [-1, 1]) {
    put(b, M.sandstone, { ring: [0.22, 0.12, 1.0, 5, 23.6, 18.9, s * 1.7] });
    put(b, M.sandstone, [0.1, 0.65, 0.6, 23.6, 19.1, s * 1.7]);
    put(b, M.sandstone, { obox: [0.08, 1.3, 0.08, 23.6, 18.8, s * 1.7, 0], mask: 63 });
  }
  // The gilded pelican on its nest, feeding its young: body, neck bent down to the breast, wings raised to 22.25 m
  const PX0 = 23.4, PY0 = 21.2;
  put(g, M.gold, { ring: [0.5, 0.45, 0.15, 8, PX0, PY0, 0] });
  put(g, M.gold, { ring: [0.28, 0.36, 0.35, 8, PX0, PY0 + 0.15, 0] });
  put(g, M.gold, { ring: [0.36, 0.14, 0.4, 8, PX0, PY0 + 0.5, 0], cap: true });
  put(g, M.gold, { obox: [0.12, 0.42, 0.12, PX0 + 0.12, PY0 + 0.62, 0, 0], mask: 63 });
  put(g, M.gold, [0.32, 0.12, 0.12, PX0 + 0.26, PY0 + 0.6, 0]);
  for (const s of [-1, 1]) {
    const wing = [[PX0 - 0.1, PY0 + 0.45, s * 0.2], [PX0 - 0.35, DZIALYNSKI.top, s * 0.85], [PX0 + 0.15, DZIALYNSKI.top - 0.12, s * 0.95], [PX0 + 0.2, PY0 + 0.45, s * 0.25]];
    put(g, M.gold, { poly: wing, n: [0, 0, s] });
    put(g, M.gold, { poly: wing, n: [0, 0, -s] }); // both sides of the thin wing
    for (const du of [-0.2, 0.2]) put(g, M.gold, { ring: [0.09, 0.05, 0.22, 5, PX0 + du, PY0 + 0.15, s * 0.28], cap: true });
  }
  // Sides (the long walls on the neighbours' party lines and the yard) and the back, three storeys of windows
  const fn = face('z', 9.55, 1), fs = face('z', -9.55, -1), fw = face('x', -24.25, -1);
  for (const f of [fn, fs]) {
    windowGrid(b, M, f, spread(-21.5, 20.5, 12), [1.4, 10.9], 1.1, 1.8, { trim });
    windowGrid(b, M, f, spread(-21.5, 20.5, 12), [5.9], 1.2, 2.9, { trim, hood: true });
    band(b, trim, f, -24.25, 24.0, 4.6, 0.3, 0.2);
    band(b, trim, f, -24.25, 24.0, 15.4, 0.4, 0.25);
  }
  windowGrid(b, M, fw, [-6.4, -3.2, 0, 3.2, 6.4], [1.4, 5.9, 10.9], 1.1, 2.0, { trim });
  band(b, trim, fw, -9.55, 9.55, 15.4, 0.4, 0.25);
  // Slate mansard: a steep lower slope with dormers and a low hipped top, behind the attic
  frustum(b, M.slate, 47.6, D, 44.4, 16.5, 3.2, -0.7, EAVE, 0);
  pitchedRoof(obj, 44.4, 16.5, 1.3, M.slate, -0.7, 19.0, 0, { hip: 0.5 });
  for (const s of [-1, 1]) {
    const rf = face('z', s * HD, s);
    for (const x of spread(-21, 19, 11)) dormer(b, M, rf, x, 16.3, M.slate, { off: -0.4 });
  }
  for (const z of [-5, 0, 5]) dormer(b, M, face('x', -24.5, -1), z, 16.3, M.slate, { off: -0.4 });
  emit(obj, b);
  emit(obj, g);

  group.add(obj);
  collider(colliders, -W / 2, W / 2, -D / 2, D / 2, DZIALYNSKI.top);
  fitToSite([obj], site('Pałac Działyńskich'), colliders, c0, { height: DZIALYNSKI.top });
}

// -------------------------------------------------------------------------------------------------------------------
// Hotel Bazar (Ernst Steudener, 1838–1842; the neo-Baroque wing by Roger Sławski, 1898–1899): the neoclassical
// Paderewskiego front with a pilastered portico raised to the roof and crowned by a triangular tympanum between two
// square towers (pl.wikipedia "Hotel Bazar w Poznaniu"). Here the north wing (-z) carries that front; the lidar's
// 24.4 m corner rotunda with its copper dome stands at the north-east corner. The west wing front is the richer
// neo-Baroque elevation with a curved gable; four storeys, shop windows on the ground floor and the slate mansard with
// dormers are from general knowledge / photos. Envelope 73.0 × 39.9 m.
// -------------------------------------------------------------------------------------------------------------------
function buildBazar(group, colliders, M) {
  const c0 = colliders.length;
  const obj = new THREE.Group();
  const wall = M.plasterCream;
  const trim = M.plasterWhite;
  const EAVE = 18.3;
  const SILLS = [5.9, 10.3, 14.4];
  const rotX = 32.05, rotZ = -15.8, rotR = 5.0; // walls; the cornice ring reaches the outline's 5.4 m

  // --- North wing (Paderewskiego front, -z) ---
  {
    const b = parts();
    box(obj, 70.7, EAVE, 14.0, wall, 0.2, 0, -12.3);
    const fN = face('z', -19.3, -1);
    rusticate(b, trim, fN, -35.15, 26.6, 0, 5.0);
    band(b, trim, fN, -35.15, 26.6, 5.0, 0.35, 0.3);
    band(b, trim, fN, -35.15, 26.6, 9.6, 0.2, 0.2);
    for (const [u0, u1] of [[-35.15, -7.0], [7.0, 26.6]]) band(b, trim, fN, u0, u1, 17.6, 0.7, 0.6);
    const left = spread(-33.0, -9.6, 8), right = spread(10.6, 24.4, 5);
    for (const x of [...left, ...right]) {
      win(b, M, fN, x, 0.5, 2.3, 3.4, { trim, sill: false, hood: true });
      win(b, M, fN, x, SILLS[0], 1.4, 2.5, { trim, hood: true });
      win(b, M, fN, x, SILLS[1], 1.3, 2.2, { trim });
      win(b, M, fN, x, SILLS[2], 1.2, 1.8, { trim });
    }
    // The portico raised to the roof: four giant pilasters, entablature and tympanum
    put(b, wall, fbox(fN, 0, 14.0, 0, EAVE, 0.3, 0.6));
    const fP = face('z', -19.9, -1);
    for (const x of [-6.3, -2.1, 2.1, 6.3]) {
      pilaster(b, trim, fP, x, 5.0, 12.0, 0.8, 0.3);
      put(b, trim, fbox(fP, x, 1.1, 16.6, 0.4, 0.2, 0.4));
    }
    band(b, trim, fP, -7.0, 7.0, 17.0, 0.8, 0.5);
    gableSlab(obj, [[-7.2, 0], [7.2, 0], [0, 1.7]], 0.8, trim, 0, EAVE + 0.02, -19.6, 'z');
    panel(b, wall, face('z', -20.0, -1), [[-6.2, 0.25], [6.2, 0.25], [0, 1.4]], 0, EAVE + 0.02, 0.01);
    panel(b, M.wood, fP, archOutline(2.6, 4.0), 0, 0, 0.03);
    for (const x of [-4.2, 4.2]) win(b, M, fP, x, 0.8, 1.6, 3.0, { trim, shape: 'arch' });
    for (const x of [-4.2, 0, 4.2]) {
      win(b, M, fP, x, SILLS[0], 1.6, 3.0, { trim, shape: 'arch', jambs: true });
      win(b, M, fP, x, SILLS[1], 1.4, 2.2, { trim, hood: true });
      win(b, M, fP, x, SILLS[2], 1.3, 1.8, { trim });
    }
    // The two square towers beside the tympanum, with pyramid caps
    for (const s of [-1, 1]) {
      box(obj, 3.6, 1.3, 3.6, wall, s * 9.2, EAVE, -17.5);
      for (const f of [face('z', -19.3, -1), face('x', s * 9.2 + s * 1.8, s)]) {
        const u = f.axis === 'z' ? s * 9.2 : -17.5;
        win(b, M, f, u, EAVE + 0.2, 0.9, 0.8, { trim, shape: 'arch', sill: false });
      }
      band(b, trim, face('z', -19.3, -1), s * 9.2 - 1.8, s * 9.2 + 1.8, EAVE + 1.0, 0.3, 0.25);
      pitchedRoof(obj, 3.9, 3.9, 0.8, M.copper, s * 9.2, EAVE + 1.3, -17.5, { hip: 1 });
    }
    // Courtyard and east-end walls: plain windows
    const fC = face('z', -5.3, 1);
    windowGrid(b, M, fC, spread(4, 24, 5), SILLS, 1.2, 2.0, { trim });
    windowGrid(b, M, face('x', 35.55, 1), [-7.8], [1.2, ...SILLS], 1.2, 2.0, { trim });
    // Slate mansard (lower slope with dormers, low top) up to the rotunda; a flat terrace behind it
    frustum(b, M.slate, 63.1, 14.0, 60.7, 11.6, 2.3, -4.0, EAVE, -12.3);
    for (const x of [...left, ...right].filter((_, i) => i % 2 === 0)) dormer(b, M, face('z', -19.3, -1), x, EAVE + 0.25, M.slate, { off: -0.45 });
    emit(obj, b);
    pitchedRoof(obj, 60.7, 11.6, 0.7, M.slate, -4.0, 20.6, -12.3, { hip: 0.5 });
  }

  // --- West wing (the neo-Baroque front, -x) and its south end ---
  {
    const b = parts();
    box(obj, 35.6, EAVE, 23.6, wall, -17.35, 0, 6.5);
    const fW = face('x', -35.15, -1);
    const bays = spread(-17.0, 17.0, 11);
    rusticate(b, trim, fW, -19.3, 18.3, 0, 5.0);
    band(b, trim, fW, -19.3, 18.3, 5.0, 0.35, 0.4);
    band(b, trim, fW, -19.3, 18.3, 17.6, 0.7, 0.4);
    // The central risalit (three bays) with pilasters, pedimented windows and a curved gable over the cornice
    put(b, wall, fbox(fW, 0, 10.8, 5.0, 12.6, 0.05, 0.1, 63 & ~NY));
    const fR = face('x', -35.25, -1);
    for (const z of [-5.2, -1.7, 1.7, 5.2]) pilaster(b, trim, fR, z, 5.35, 12.25, 0.55, 0.3);
    for (const z of bays) {
      const f = Math.abs(z) < 4 ? fR : fW;
      win(b, M, f, z, 0.5, 2.2, 3.3, { trim, sill: false, hood: true });
      win(b, M, f, z, SILLS[0], 1.3, 2.5, { trim, hood: 'pediment', jambs: Math.abs(z) < 4 });
      win(b, M, f, z, SILLS[1], 1.2, 2.2, { trim, hood: Math.abs(z) < 4 });
      win(b, M, f, z, SILLS[2], 1.1, 1.7, { trim });
    }
    gableSlab(obj, curvedGable(10.4, 4.4, 1.8, 3.0), 0.5, wall, -35.2, EAVE + 0.02, 0, 'x');
    panel(b, M.glassLit, face('x', -35.45, -1), discOutline(0.6), 0, EAVE + 0.92, 0.01);
    band(b, trim, fR, -5.2, 5.2, 17.6, 0.7, 0.3);
    // South end (z 18.3) and courtyard side (x 0.45): plain windows over shop fronts
    const fS = face('z', 18.3, 1);
    const sb = spread(-33.0, -2.0, 9);
    rusticate(b, trim, fS, -35.15, 0.45, 0, 5.0);
    band(b, trim, fS, -35.15, 0.45, 17.6, 0.7, 0.4);
    for (const x of sb) {
      win(b, M, fS, x, 0.5, 2.0, 3.2, { trim, sill: false, hood: true });
      for (const v of SILLS) win(b, M, fS, x, v, 1.2, 2.1, { trim });
    }
    windowGrid(b, M, face('x', 0.45, 1), spread(-1.0, 15.0, 4), SILLS, 1.2, 2.0, { trim });
    frustum(b, M.slate, 36.0, 24.0, 33.6, 21.6, 2.3, -17.55, EAVE, 6.7);
    for (const z of spread(-1.5, 15.5, 5)) if (Math.abs(z) > 3) dormer(b, M, face('x', -35.55, -1), z, EAVE + 0.25, M.slate, { off: -0.45 });
    emit(obj, b);
    pitchedRoof(obj, 33.6, 21.6, 0.7, M.slate, -17.55, 20.6, 6.7, { ridge: 'z', hip: 0.5 });
  }

  // --- Corner rotunda (north-east): pilastered storeys, a windowed drum and the copper dome with its lantern ---
  {
    const b = parts();
    put(b, wall, { ring: [rotR, rotR, EAVE, 16, rotX, 0, rotZ] });
    put(b, trim, { ring: [rotR + 0.05, rotR + 0.05, 5.0, 16, rotX, 0, rotZ] });
    put(b, trim, { ring: [rotR + 0.2, rotR + 0.2, 0.35, 16, rotX, 5.0, rotZ] });
    put(b, trim, { ring: [rotR + 0.4, rotR + 0.4, 0.74, 16, rotX, 17.6, rotZ], cap: true });
    // The street arc runs from the east front round to the north front (a 0.9..3.8 rad from +z towards +x)
    const as = spread(0.95, 3.75, 8);
    for (let i = 0; i < as.length; i++) {
      const f = rface(rotX, rotZ, rotR, as[i]);
      win(b, M, f, 0, 0.6, 1.4, 3.2, { trim, shape: 'arch', sill: false });
      win(b, M, f, 0, SILLS[0], 1.2, 2.5, { trim, hood: true });
      win(b, M, f, 0, SILLS[1], 1.1, 2.2, { trim });
      win(b, M, f, 0, SILLS[2], 1.0, 1.8, { trim });
      if (i) pilaster(b, trim, rface(rotX, rotZ, rotR, (as[i] + as[i - 1]) / 2), 0, 5.35, 12.25, 0.45, 0.16);
    }
    put(b, wall, { ring: [4.7, 4.7, 2.5, 16, rotX, EAVE, rotZ] });
    ringPanes(b, M.glass, rotX, rotZ, 4.7, spread(0, Math.PI * 1.75, 8), EAVE + 0.7, 0.8, 1.2, 'arch');
    put(b, trim, { ring: [4.9, 4.9, 0.3, 16, rotX, EAVE + 2.2, rotZ] });
    put(b, trim, { ring: [0.65, 0.6, 0.5, 8, rotX, 23.5, rotZ] });
    ringPanes(b, M.glass, rotX, rotZ, 0.6, spread(0, Math.PI * 1.5, 4), 23.55, 0.3, 0.38);
    emit(obj, b);
    lathe(obj, [[4.85, 0], [4.8, 0.6], [4.4, 1.4], [3.5, 2.1], [2.2, 2.55], [0.7, 2.7]], 16, M.copper, rotX, 20.8, rotZ);
    lathe(obj, [[0.78, 0], [0.55, 0.14], [0.12, 0.3], [0.04, BAZAR.top - 24.0]], 8, M.copper, rotX, 24.0, rotZ);
  }

  group.add(obj);
  collider(colliders, -35.55, 35.55, -19.3, -5.3, BAZAR.top);
  collider(colliders, -35.5, 0.4, -5.3, 18.7, 21.3);
  fitToSite([obj], site('Hotel Bazar'), colliders, c0, { height: BAZAR.top });
}

// -------------------------------------------------------------------------------------------------------------------
// Muzeum Narodowe: the main building, built for the Kaiser-Friedrich-Museum to Karl Hinckeldeyn's design (opened 1904;
// mosaics by Zbigniew Bednarowicz added to the main front in the 1970s), and the long new Galeria Malarstwa i Rzeźby
// wing opened in 2001, nicknamed "jamnik" for its controversial shape (pl.wikipedia "Muzeum Narodowe w Poznaniu").
// The old building (south, +z) is modelled with its main front to al. Marcinkowskiego (-x): granite rusticated ground
// floor, engaged Ionic columns on the central avant-corps, and the high central hall pavilion whose copper roof is the
// 26.0 m lidar peak; the new wing (north) is a low stone-clad block with a glazed foyer band and a glass roof light.
// Column count, bays and the new wing's cladding are from general knowledge / photos. Envelope 63.4 × 142.0 m.
// -------------------------------------------------------------------------------------------------------------------
function buildMuzeum(group, colliders, M) {
  const c0 = colliders.length;
  const obj = new THREE.Group();
  const stone = M.sandstone;
  const trim = M.plasterWhite;
  const Z0 = 27.2, Z1 = 70.6, ZC = (Z0 + Z1) / 2;

  // --- The old building ---
  {
    const b = parts();
    box(obj, 62.4, 5.5, Z1 - Z0, M.granite, 0, 0, ZC);
    box(obj, 62.4, 10.5, Z1 - Z0, stone, 0, 5.5, ZC);
    const fW = face('x', -31.2, -1), fE = face('x', 31.2, 1), fS = face('z', Z1, 1), fN = face('z', Z0, -1);
    for (const [f, u0, u1, dn] of [[fW, Z0, Z1, 0.5], [fE, Z0, Z1, 0.5], [fS, -31.2, 31.2, 0.4], [fN, -31.2, 31.2, 0.4]]) {
      rusticate(b, M.stoneGrey, f, u0, u1, 0, 5.5);
      if (f === fW) {
        for (const [a0, a1] of [[Z0, 37.0], [59.0, Z1]]) band(b, trim, f, a0, a1, 5.5, 0.35, 0.26, SIDES | PY);
      } else {
        band(b, trim, f, u0, u1, 5.5, 0.35, 0.3, 63 & ~NY);
      }
      band(b, trim, f, u0, u1, 15.4, 0.6, dn);
    }
    // Main front: the avant-corps (z 37..59) with six engaged Ionic columns, three portals with mosaic lunettes
    put(b, stone, fbox(fW, 48, 22, 5.5, 9.86, 0.15, 0.3, 63 & ~NY));
    const fA = face('x', -31.5, -1);
    const cols = spread(38.8, 57.2, 6);
    for (const z of cols) column(b, trim, -31.1, 5.5, z, 9.9, 0.38, 10);
    for (let i = 0; i < 5; i++) {
      const z = (cols[i] + cols[i + 1]) / 2;
      win(b, M, fA, z, 6.6, 1.6, 4.2, { trim, shape: 'arch', sill: false, jambs: true });
      win(b, M, fA, z, 12.6, 1.3, 1.6, { trim, sill: false });
    }
    for (const z of [44.4, 48.0, 51.6]) {
      panel(b, M.wood, fA, archOutline(2.4, 3.6), z, 0, 0.03);
      panel(b, M.plasterOchre, fA, [[-1.2, 0], [1.2, 0], [0.85, 0.85], [0, 1.2], [-0.85, 0.85]], z, 3.7, 0.04);
      panel(b, M.copper, fA, [[-0.6, 0.15], [0.6, 0.15], [0.42, 0.6], [0, 0.78], [-0.42, 0.6]], z, 3.7, 0.05);
    }
    put(b, M.granite, fbox(fW, 48, 13.5, 0, 5.5, 0.15, 0.3));
    for (const z of [...spread(29.6, 35.2, 3), ...spread(61.0, 68.2, 3)]) {
      win(b, M, fW, z, 1.6, 1.4, 2.4, { trim: M.stoneGrey, shape: 'arch', sill: false });
      win(b, M, fW, z, 6.6, 1.5, 3.6, { trim, hood: 'pediment', jambs: true });
      win(b, M, fW, z, 12.6, 1.3, 1.6, { trim });
    }
    // South front: thirteen bays between pilasters; the east side plainer
    const sb = spread(-28, 28, 13);
    for (let i = 0; i < sb.length; i++) {
      win(b, M, fS, sb[i], 1.6, 1.4, 2.4, { trim: M.stoneGrey, shape: 'arch', sill: false });
      win(b, M, fS, sb[i], 6.6, 1.5, 3.6, { trim, hood: i % 2 ? true : 'pediment', jambs: true });
      win(b, M, fS, sb[i], 12.6, 1.3, 1.6, { trim });
      if (i) pilaster(b, trim, fS, (sb[i] + sb[i - 1]) / 2, 5.85, 9.55, 0.6, 0.2);
    }
    windowGrid(b, M, fE, spread(30, 68, 9), [1.6, 6.6, 12.6], 1.3, 2.2, { trim });
    // The central hall pavilion over the avant-corps: lunette windows, cornice, copper gabled roof (26.0 m)
    box(obj, 20, 7.5, 12, stone, -17, 16, 48);
    for (const [f, us] of [[face('x', -27, -1), [44, 48, 52]], [face('x', -7, 1), [44, 48, 52]], [face('z', 42, -1), [-21, -13]], [face('z', 54, 1), [-21, -13]]]) {
      for (const u of us) win(b, M, f, u, 18.2, 2.4, 3.4, { trim, shape: 'arch' });
      const span = f.axis === 'x' ? [42, 54] : [-27, -7];
      band(b, trim, f, span[0], span[1], 22.9, 0.6, 0.35);
    }
    for (const z of [41.85, 54.15]) gableSlab(obj, [[-10.0, 0], [10.0, 0], [0, 2.5]], 0.3, trim, -17, 23.5, z, 'z');
    pitchedRoof(obj, 62.4, Z1 - Z0, 5.0, M.zinc, 0, 16, ZC, { hip: 0.4 });
    emit(obj, b);
    pitchedRoof(obj, 20.0, 12.0, MUZEUM.top - 23.5, M.copper, -17.0, 23.5, 48.0, { ridge: 'z', hip: 0 });
  }

  // --- The 2001 wing: long and low, stone-clad, glazed at the foot, with a glass roof light along its spine ---
  {
    const b = parts();
    const Y = 15.0;
    box(obj, 50, Y, 95.85, M.concrete, -1, 0, -22.925);
    const fW = face('x', -26, -1), fE = face('x', 24, 1), fN = face('z', -70.85, -1);
    for (const [f, u0, u1] of [[fW, -70.85, 25], [fE, -70.85, 25], [fN, -26, 24]]) {
      band(b, M.stoneGrey, f, u0, u1, Y - 0.3, 0.3, 0.15);
      band(b, M.stoneGrey, f, u0, u1, 4.4, 0.25, 0.1);
    }
    for (const f of [fW, fE]) {
      panel(b, M.glass, f, rectOutline(88, 3.4), -24, 0.6);
      for (const z of spread(-68, 20, 16)) put(b, M.darkMetal, fbox(f, z, 0.16, 0.6, 3.4, 0.06, 0.12));
      for (const z of spread(-60, 12, 7)) panel(b, M.glassLit, f, rectOutline(0.9, 7.5), z, 6.0);
    }
    panel(b, M.glassLit, fN, rectOutline(16, 10), -1, 1.0);
    // Glazed link to the old building
    box(obj, 20, 9, 2.6, M.glass, 0, 0, 26.1);
    emit(obj, b);
    pitchedRoof(obj, 14, 90, 2.5, M.glass, -1, Y, -23, { ridge: 'z', hip: 0 });
  }

  group.add(obj);
  collider(colliders, -31.7, 31.7, 27.0, 71.0, MUZEUM.top);
  collider(colliders, -26.0, 24.0, -71.0, 27.0, 17.5);
  fitToSite([obj], site('Muzeum Narodowe'), colliders, c0, { height: MUZEUM.top });
}

// Letters for the Teatr Polski frieze, 3 × 5 cells, top row first ("NARÓD SOBIE"); Ó carries an accent cell above
const GLYPHS = {
  N: ['101', '111', '111', '111', '101'],
  A: ['010', '101', '111', '101', '101'],
  R: ['110', '101', '110', '101', '101'],
  Ó: ['010', '101', '101', '101', '010'],
  D: ['110', '101', '101', '101', '110'],
  S: ['011', '100', '010', '001', '110'],
  O: ['010', '101', '101', '101', '010'],
  B: ['110', '101', '110', '101', '110'],
  I: ['111', '010', '010', '010', '111'],
  E: ['111', '100', '110', '100', '111']
};
// A line of text as flat cells on a face, centred on u, its base at v: every run of filled cells in a glyph row is one
// quad (2 triangles)
function inscription(b, material, f, text, u, v, cell, off) {
  const adv = cell * 4;
  let x = u - (text.length * adv - cell) / 2;
  for (const ch of text) {
    const rows = GLYPHS[ch];
    if (rows) {
      rows.forEach((row, r) => {
        const top = v + (5 - r) * cell;
        let c = 0;
        while (c < 3) {
          if (row[c] !== '1') { c++; continue; }
          let e = c;
          while (e < 3 && row[e] === '1') e++;
          panel(b, material, f, [[0, -cell], [(e - c) * cell, -cell], [(e - c) * cell, 0], [0, 0]], x + c * cell, top, off);
          c = e;
        }
      });
      if (ch === 'Ó') panel(b, material, f, [[0, 0], [cell, 0], [cell * 1.4, cell], [cell * 0.4, cell]], x + cell * 1.3, v + 5.3 * cell, off);
    }
    x += adv;
  }
}

// -------------------------------------------------------------------------------------------------------------------
// Teatr Polski (Stanisław Hebanowski, 1873–1875, Italian Renaissance; built with public donations, hence "NARÓD
// SOBIE" — "the nation to itself"; the entrance vestibule with the box offices added by Stefan Cybichowski in 1929;
// it stood in the yard behind a tenement on ul. 27 Grudnia until the tenement was demolished: pl.wikipedia "Teatr
// Polski w Poznaniu"). The front (+z) shows the 1929 vestibule with a terrace, the six-column piano nobile over it with
// arched windows, the frieze inscription, an attic storey and the pediment with statues; behind are the foyer and the
// high stage house (fly tower ridge 23.9 m). Column order, statues and the letters' bronze finish are from general
// knowledge / photos. Envelope 27.3 × 41.8 m.
// -------------------------------------------------------------------------------------------------------------------
function buildTeatrPolski(group, colliders, M) {
  const c0 = colliders.length;
  const obj = new THREE.Group();
  const b = parts();
  const wall = M.plasterCream;
  const trim = M.plasterWhite;
  const FZ = 17.5; // the front wall
  const EAVE = 15.0;

  // Foyer block and the 1929 vestibule
  box(obj, 26.8, EAVE, FZ - 2, wall, 0, 0, (FZ + 2) / 2);
  box(obj, 18, 5.4, 4.0, trim, 0, 0, FZ + 2);
  const fv = face('z', FZ + 4, 1);
  band(b, M.sandstone, fv, -9, 9, 4.9, 0.5, 0.25);
  for (const x of [-4.5, 0, 4.5]) {
    panel(b, M.wood, fv, rectOutline(1.8, 2.8), x, 0, 0.03);
    panel(b, M.glassLit, fv, rectOutline(1.8, 0.9), x, 3.0, 0.03);
    for (const s of [-1, 1]) pilaster(b, M.sandstone, fv, x + s * 1.2, 0, 4.9, 0.45, 0.2);
  }
  for (const x of [-7.6, 7.6]) win(b, M, fv, x, 1.0, 1.4, 2.4, { trim: M.sandstone });
  for (const s of [-1, 1]) win(b, M, face('x', s * 9, s), FZ + 2, 1.0, 1.4, 2.4, { trim: M.sandstone });
  // Terrace balustrade on the vestibule roof
  for (const x of spread(-8.8, 8.8, 15)) put(b, trim, [0.18, 0.8, 0.18, x, 5.4, FZ + 3.75, SIDES]);
  put(b, trim, [18, 0.14, 0.32, 0, 6.2, FZ + 3.75]);

  // Piano nobile: six Corinthian half-columns with arched windows between, the frieze with the inscription
  const ff = face('z', FZ, 1);
  const cols = spread(-7.5, 7.5, 6);
  for (const x of cols) column(b, trim, x, 5.4, FZ + 0.12, 5.8, 0.4, 10);
  for (let i = 0; i < 5; i++) win(b, M, ff, (cols[i] + cols[i + 1]) / 2, 6.6, 1.5, 3.6, { trim, shape: 'arch', jambs: true });
  band(b, trim, ff, -9.3, 9.3, 11.2, 0.4, 0.6);
  band(b, wall, ff, -9.3, 9.3, 11.6, 0.75, 0.5);
  inscription(b, M.bronze, ff, 'NARÓD SOBIE', 0, 11.72, 0.1, 0.52);
  band(b, trim, ff, -9.6, 9.6, 12.35, 0.3, 0.7);
  // Attic storey with small windows over the bays, the cornice, the pediment and its statues
  for (const x of cols) pilaster(b, trim, ff, x, 12.65, 2.35, 0.6, 0.2);
  for (let i = 0; i < 5; i++) win(b, M, ff, (cols[i] + cols[i + 1]) / 2, 13.2, 1.0, 1.0, { trim });
  band(b, trim, ff, -13.4, 13.4, EAVE - 0.4, 0.4, 0.5);
  gableSlab(obj, [[-9.6, 0], [9.6, 0], [0, 3.4]], 1.0, trim, 0, EAVE, FZ - 0.2, 'z');
  panel(b, wall, face('z', FZ + 0.3, 1), [[-8.6, 0.3], [8.6, 0.3], [0, 2.9]], 0, EAVE, 0.01);
  statue(b, M.sandstone, 0, EAVE + 3.4, FZ, 1.8);
  for (const s of [-1, 1]) statue(b, M.sandstone, s * 9.0, EAVE, FZ - 0.1, 1.8);
  // Side bays of the front and the ground floor beside the vestibule
  for (const x of [-11.4, 11.4]) {
    win(b, M, ff, x, 1.4, 1.3, 2.2, { trim });
    win(b, M, ff, x, 6.6, 1.4, 3.0, { trim, shape: 'arch', hood: false, jambs: true });
    win(b, M, ff, x, 13.2, 1.0, 1.0, { trim });
  }
  rusticate(b, trim, ff, -13.4, -9.0, 0, 5.4);
  rusticate(b, trim, ff, 9.0, 13.4, 0, 5.4);
  band(b, trim, ff, -13.4, 13.4, 5.4, 0.3, 0.3);
  for (const s of [-1, 1]) {
    const f = face('x', s * 13.4, s);
    windowGrid(b, M, f, [5.0, 9.0, 13.0], [1.4, 6.6], 1.2, 2.4, { trim });
    band(b, trim, f, 2, FZ, EAVE - 0.4, 0.4, 0.2);
    band(b, trim, f, 2, FZ, 5.4, 0.3, 0.2);
  }
  pitchedRoof(obj, 26.9, FZ - 2, 17.2 - EAVE, M.zinc, 0, EAVE, (FZ + 2) / 2, { hip: 0.6 });

  // Auditorium and stage house: lesenes, tall arched windows, cornice, and the fly tower's slate roof (23.9 m)
  box(obj, 24, 18.5, 21.6, wall, 0, 0, -8.8);
  for (const s of [-1, 1]) {
    const f = face('x', s * 12, s);
    for (const z of [-17.5, -13.1, -8.7, -4.3, 0.1]) pilaster(b, trim, f, z, 0, 18.0, 0.7, 0.2);
    for (const z of [-15.3, -10.9, -6.5, -2.1]) {
      win(b, M, f, z, 8.6, 1.6, 3.6, { trim, shape: 'arch' });
      win(b, M, f, z, 2.0, 1.2, 1.8, { trim });
    }
    band(b, trim, f, -19.6, 2, 18.0, 0.5, 0.25);
  }
  const fr = face('z', -19.6, -1);
  panel(b, M.darkMetal, fr, rectOutline(3.2, 5.0), 0, 0, 0.03);
  windowGrid(b, M, fr, [-6, 6], [3, 10], 1.2, 1.8, { trim });
  band(b, trim, fr, -12, 12, 18.0, 0.5, 0.4);
  emit(obj, b);
  pitchedRoof(obj, 24, 21.6, TEATR_PL.top - 18.5, M.slate, 0, 18.5, -8.8, { hip: 0.35 });

  group.add(obj);
  collider(colliders, -13.65, 13.65, -20.05, 20.05, TEATR_PL.top);
  fitToSite([obj], site('Teatr Polski'), colliders, c0, { height: TEATR_PL.top });
}

// -------------------------------------------------------------------------------------------------------------------
// Collegium Maius (1908–1910, built for the Prussian Settlement Commission; neo-Baroque with neoclassical elements):
// a semicircular risalit on the main axis crowned by the dome (today lower and stockier than the original, with other
// window openings; the drum's six figures were removed in 1945), and a main hall under a glazed roof (pl.wikipedia
// "Collegium Maius w Poznaniu"). Here the risalit faces ul. Fredry (+z) with giant engaged columns round it, the drum
// stands on the avant-corps behind it, and the dome's lantern is the 36.4 m lidar peak; the three-storey wings, corner
// gables and tiled roofs are from general knowledge / photos. Envelope 90.4 × 61.0 m.
// -------------------------------------------------------------------------------------------------------------------
function buildMaius(group, colliders, M) {
  const c0 = colliders.length;
  const obj = new THREE.Group();
  const wall = M.plasterCream;
  const trim = M.sandstone;
  const EAVE = 16.5;
  const SILL = [1.6, 6.4, 11.6];
  // Three storeys over a rusticated ground floor; `rich` fronts get pedimented, jambed first-floor windows
  const storeys = (b, f, u0, u1, us, rich = true) => {
    rusticate(b, M.stoneGrey, f, u0, u1, 0, 5.5);
    band(b, trim, f, u0, u1, 5.5, 0.35, 0.3);
    band(b, trim, f, u0, u1, 15.9, 0.6, 0.3);
    for (const u of us) {
      win(b, M, f, u, SILL[0], 1.4, 2.4, { trim: M.stoneGrey, sill: false });
      win(b, M, f, u, SILL[1], 1.5, 3.0, { trim, hood: rich ? 'pediment' : true, jambs: rich });
      win(b, M, f, u, SILL[2], 1.4, 2.6, { trim, hood: rich });
    }
  };

  // --- South wing on Fredry, the corner pavilions and the side wings ---
  {
    const b = parts();
    // Two halves either side of the avant-corps (x ±15), so the risalit stands free on Fredry
    for (const s of [-1, 1]) box(obj, 29.9, EAVE, 25.7, wall, s * 29.95, 0, 9.85);
    const fS = face('z', 22.7, 1);
    const left = spread(-35.0, -17.5, 6);
    storeys(b, fS, -44.9, -15, left);
    storeys(b, fS, 15, 44.9, left.map((x) => -x));
    for (const s of [-1, 1]) {
      // Corner pavilions: pilasters, windows and a curved gable over the eaves
      for (const x of [38.2, 44.6]) pilaster(b, trim, fS, s * x, 5.85, 10.05, 0.7, 0.28);
      win(b, M, fS, s * 41.4, SILL[1], 1.6, 3.2, { trim, hood: 'pediment', jambs: true });
      win(b, M, fS, s * 41.4, SILL[2], 1.5, 2.6, { trim, hood: true });
      win(b, M, fS, s * 41.4, SILL[0], 1.4, 2.4, { trim: M.stoneGrey });
      gableSlab(obj, curvedGable(7.4, 3.0, 2.4, 5.0), 0.5, wall, s * 41.4, EAVE, 22.45, 'z');
      panel(b, M.glassLit, face('z', 22.7, 1), discOutline(0.6), s * 41.4, EAVE + 2.2, 0.01);
      // Side wing outer fronts and their north ends
      const fx = face('x', s * 44.9, s);
      storeys(b, fx, -36.7, 22.7, spread(-33.5, 19.5, 8), false);
      storeys(b, face('z', -36.7, -1), s * 21.2, s * 44.9, spread(s * 25.0, s * 41.0, 3), false);
    }
    for (const x of spread(-36, 36, 10)) if (Math.abs(x) > 16) dormer(b, M, face('z', 23, 1), x, EAVE + 0.4, M.tileRed, { off: -0.8, wall });
    emit(obj, b);
    for (const s of [-1, 1]) pitchedRoof(obj, 30.2, 26.0, 6.5, M.tileRed, s * 30.1, EAVE, 10.0, { hip: 0.3 });
    for (const s of [-1, 1]) {
      box(obj, 23.7, EAVE, 45.7, wall, s * 33.05, 0, -13.85);
      pitchedRoof(obj, 24.0, 46.0, 6.5, M.tileRed, s * 33.2, EAVE, -14.0, { hip: 0.5 });
    }
  }

  // --- Main hall in the courtyard under its glazed roof ---
  {
    const b = parts();
    box(obj, 30, 14, 24, wall, 0, 0, -15);
    for (const s of [-1, 1]) windowGrid(b, M, face('x', s * 15, s), spread(-24, -6, 4), [3.0, 8.5], 1.6, 3.2, { trim, shape: 'arch' });
    band(b, trim, face('z', -27, -1), -15, 15, 13.4, 0.6, 0.3);
    emit(obj, b);
    pitchedRoof(obj, 30, 24, 3.5, M.glass, 0, 14, -15, { ridge: 'z', hip: 0.2 });
  }

  // --- The semicircular risalit, the avant-corps behind it, the drum, dome and lantern ---
  {
    const b = parts();
    const RZ = 15, RR = 8.5;
    box(obj, 30, 21, 19, wall, 0, 0, 5.5);
    const half = { a0: -Math.PI / 2, sweep: Math.PI };
    put(b, M.stoneGrey, { ring: [9.0, 9.0, 1.2, 16, 0, 0, RZ], ...half, cap: true });
    put(b, wall, { ring: [RR, RR, 21, 16, 0, 0, RZ], ...half });
    put(b, trim, { ring: [9.0, 9.0, 1.5, 16, 0, 19.5, RZ], ...half, cap: true });
    put(b, trim, { ring: [8.8, 8.8, 0.9, 16, 0, 21.0, RZ], ...half });
    put(b, trim, { ring: [RR + 0.05, RR + 0.05, 5.5, 16, 0, 0, RZ], ...half });
    const colA = spread(-1.2, 1.2, 6);
    for (const a of colA) column(b, trim, 8.65 * Math.sin(a), 1.2, RZ + 8.65 * Math.cos(a), 18.3, 0.42);
    const winA = [-1.44, ...colA.slice(1).map((a, i) => (a + colA[i]) / 2), 1.44];
    for (const a of winA) {
      const f = rface(0, RZ, RR, a);
      if (Math.abs(a) < 0.01) panel(b, M.wood, f, archOutline(2.6, 3.6), 0, 1.2, 0.08);
      else win(b, M, f, 0, 2.0, 1.4, 2.4, { trim: M.stoneGrey, shape: 'arch' });
      win(b, M, f, 0, 6.6, 1.7, 4.4, { trim, shape: 'arch' });
      win(b, M, f, 0, 13.0, 1.5, 2.4, { trim, hood: true });
    }
    // Avant-corps flanks either side of the risalit
    const fS = face('z', 15, 1);
    for (const s of [-1, 1]) {
      for (const x of [s * 11.0, s * 13.6]) {
        win(b, M, fS, x, SILL[1], 1.5, 3.0, { trim, hood: 'pediment', jambs: true });
        win(b, M, fS, x, SILL[2], 1.4, 2.6, { trim, hood: true });
        win(b, M, fS, x, SILL[0], 1.4, 2.4, { trim: M.stoneGrey, sill: false });
      }
      rusticate(b, M.stoneGrey, fS, s * 9, s * 15, 0, 5.5);
      pilaster(b, trim, fS, s * 14.6, 0, 20.4, 0.8, 0.3);
    }
    band(b, trim, fS, -15, 15, 20.4, 0.6, 0.4);
    // Octagonal drum (5.5 m) with a window on every face and pilasters at the corners
    const DZ = 10;
    put(b, wall, { ring: [8.4, 8.4, 5.5, 8, 0, 21, DZ] });
    for (let i = 0; i < 8; i++) {
      const a = ((i + 0.5) * Math.PI) / 4;
      win(b, M, rface(0, DZ, 8.4 * Math.cos(Math.PI / 8), a), 0, 22.3, 1.4, 2.6, { trim, shape: 'arch' });
      pilaster(b, trim, rface(0, DZ, 8.4, (i * Math.PI) / 4), 0, 21, 5.1, 0.7, 0.2);
    }
    put(b, trim, { ring: [8.9, 8.9, 0.4, 8, 0, 26.1, DZ], cap: true });
    // Lantern: eight openings, cornice, small cupola and finial
    put(b, trim, { ring: [1.6, 1.5, 2.3, 8, 0, 32.0, DZ] });
    ringPanes(b, M.glass, 0, DZ, 1.5 * Math.cos(Math.PI / 8), spread(Math.PI / 8, (15 * Math.PI) / 8, 8), 32.4, 0.5, 1.4, 'arch');
    put(b, trim, { ring: [1.8, 1.8, 0.3, 8, 0, 34.3, DZ], cap: true });
    emit(obj, b);
    lathe(obj, [[8.3, 0], [8.1, 1.6], [7.2, 3.2], [5.4, 4.6], [3.0, 5.3], [1.6, 5.5]], 16, M.copper, 0, 26.5, DZ);
    lathe(obj, [[1.6, 0], [1.3, 0.5], [0.7, 0.9], [0.2, 1.1], [0.12, 1.15], [0.03, MAIUS.top - 34.6]], 8, M.copper, 0, 34.6, DZ);
  }

  group.add(obj);
  collider(colliders, -45.2, 45.2, -3.0, 24.0, MAIUS.top);
  collider(colliders, -45.2, -21.2, -36.0, -3.0, 23.0);
  collider(colliders, 21.2, 45.2, -36.0, -3.0, 23.0);
  collider(colliders, -15.0, 15.0, -27.0, -3.0, 17.5);
  fitToSite([obj], site('Collegium Maius'), colliders, c0, { height: MAIUS.top });
}

// -------------------------------------------------------------------------------------------------------------------
// Kościół św. Franciszka Serafickiego (Bernardyni): a massive single-nave church under a barrel vault, with an
// elongated, lower presbytery closed by a straight wall; the rich Baroque front between two towers whose two-lantern
// helms were designed by Jan Adam Stier (rebuilt by 1983); in the front's niches the Franciscan saints of c. 1730 by
// Franciszek Domsburger — St John Capistran with four more saints below, St Bonaventure and St Louis of Toulouse in the
// middle tier, the Immaculata between St Francis and St Anthony at the top (pl.wikipedia "Kościół św. Franciszka
// Serafickiego w Poznaniu"; its infobox gives 69 m towers, but the lidar measures 44.7 m at the crosses, which this
// model keeps). The monastery wing south of the nave follows the OSM outline. Pilaster rhythm, window sizes and helm
// profile are from general knowledge / photos. Envelope 76.4 × 41.0 m.
// -------------------------------------------------------------------------------------------------------------------
function buildBernardyni(group, colliders, M) {
  const c0 = colliders.length;
  const obj = new THREE.Group();
  const wall = M.plasterCream;
  const trim = M.plasterWhite;
  const ZC = -10; // the church axis
  const TX = -34.5, TS = 6.2; // towers: centre x and side; their fronts flush with the front's plane
  const TZ = [ZC - 8.5, ZC + 8.5];
  const SHAFT = 31.0;

  // --- Nave, presbytery and their flanks ---
  {
    const b = parts(0.20);
    box(obj, 46.05, 19.0, 18, wall, -13.025, 0, ZC);
    box(obj, 27.9, 16, 15, wall, 23.95, 0, ZC);
    gableSlab(obj, [[-7.5, 0], [7.5, 0], [0, 9.4]], 0.4, wall, 37.77, 16, ZC, 'x'); // to x 37.97
    const nN = face('z', ZC - 9, -1), nS = face('z', ZC + 9, 1);
    for (const f of [nN, nS]) {
      band(b, trim, f, -36.05, 10, 18.3, 0.7, 0.4);
      const xs = f === nN ? spread(-27.0, 6.4, 6) : [3.2, 7.2];
      for (const x of xs) {
        win(b, M, f, x, f === nN ? 9.0 : 13.0, 2.2, f === nN ? 6.0 : 4.0, { trim, shape: 'arch', jambs: true });
        if (f === nN) win(b, M, f, x, 3.0, 1.4, 2.4, { trim, shape: 'arch' });
      }
      for (const x of f === nN ? spread(-30.4, 9.8, 7) : [1.0, 5.2, 9.4]) pilaster(b, trim, f, x, f === nN ? 0 : 13.0, f === nN ? 18.3 : 5.3, 1.0, 0.3);
    }
    for (const s of [-1, 1]) {
      const f = face('z', ZC + s * 7.5, s);
      for (const x of [15.5, 23.5, 31.5]) win(b, M, f, x, 6.5, 2.0, 5.0, { trim, shape: 'arch', jambs: true });
      for (const x of [11.5, 19.5, 27.5, 35.5]) pilaster(b, trim, f, x, 0, 15.4, 0.9, 0.25);
      band(b, trim, f, 10, 38, 15.4, 0.6, 0.35);
    }
    win(b, M, face('x', 37.9, 1), ZC, 6.5, 2.4, 5.5, { trim, shape: 'arch', sill: false });
    win(b, M, face('x', 37.96, 1), ZC, 18.5, 1.4, 2.0, { trim, shape: 'arch', sill: false });
    emit(obj, b);
    pitchedRoof(obj, 46.05, 18.6, 30.9 - 19.0, M.tileRed, -13.025, 19.0, ZC, { ridge: 'x' });
    pitchedRoof(obj, 28, 15.6, 9.5, M.tileRed, 23.8, 16, ZC, { ridge: 'x' });
  }

  // --- The west front: three tiers of pilasters, cornices and niches with the saints, the gable, the portal ---
  {
    const b = parts(0.20);
    // Its plane stands 0.2 m behind the towers' fronts, so the saints and portal columns stay inside the outline
    box(obj, 2.0, 19.0, 26, wall, -36.6, 0, ZC);
    box(obj, 1.6, 7.97, 10.4, wall, -36.8, 19.03, ZC);
    gableSlab(obj, scrollGable(5.3, 3.05, 30.9 - 27.0, 2, 35.1 - 27.0), 1.2, wall, -37.0, 27.0, ZC, 'x');
    const fF = face('x', -37.6, -1);
    const piers = [ZC - 12.5, ZC - 8.5 - 2.6, ZC - 8.5 + 2.6, ZC - 4.8, ZC - 2.3, ZC + 2.3, ZC + 4.8, ZC + 8.5 - 2.6, ZC + 8.5 + 2.6, ZC + 12.5];
    for (const z of piers) pilaster(b, trim, fF, z, 0, 18.4, 0.8, 0.3);
    band(b, trim, fF, ZC - 13, ZC + 13, 10.6, 0.5, 0.35);
    band(b, trim, fF, ZC - 13, ZC + 13, 18.4, 0.6, 0.35);
    // Portal: door, columns, a broken pediment; St John Capistran in the niche over it
    panel(b, M.wood, fF, archOutline(2.6, 4.6), ZC, 0, 0.32);
    for (const s of [-1, 1]) column(b, trim, -37.85, 0, ZC + s * 1.9, 5.6, 0.3);
    band(b, trim, fF, ZC - 2.4, ZC + 2.4, 5.6, 0.5, 0.45);
    for (const s of [-1, 1]) panel(b, trim, fF, [[0, 0], [s * 1.6, 0], [s * 0.3, 0.9]].map(([u, v]) => [u + s * 0.8, v]), ZC, 6.1, 0.3);
    const niche = (z, v, h = 2.6) => {
      panel(b, trim, fF, archOutline(1.3, h), z, v, 0.05);
      statue(b, M.sandstone, -37.95, v, z, h - 0.6);
    };
    niche(ZC, 7.0, 3.2);
    for (const z of [ZC - 3.55, ZC + 3.55, TZ[0], TZ[1]]) niche(z, 4.0);
    // Middle tier: the great window between St Bonaventure and St Louis; windows on the tower fronts
    win(b, M, fF, ZC, 12.0, 2.2, 5.0, { trim, shape: 'arch', jambs: true });
    for (const z of [ZC - 3.55, ZC + 3.55]) niche(z, 12.6);
    for (const z of TZ) win(b, M, fF, z, 12.4, 1.4, 3.6, { trim, shape: 'arch', jambs: true });
    // Upper tier between the towers: the Immaculata between St Francis and St Anthony, cornice, the gable's oculus
    for (const z of [ZC - 4.8, ZC - 2.3, ZC + 2.3, ZC + 4.8]) pilaster(b, trim, fF, z, 19.0, 7.6, 0.7, 0.25);
    niche(ZC, 19.6, 3.4);
    for (const z of [ZC - 3.55, ZC + 3.55]) niche(z, 20.4);
    band(b, trim, fF, ZC - 5.3, ZC + 5.3, 26.6, 0.4, 0.35);
    panel(b, M.glassLit, face('x', -37.6, -1), discOutline(0.8), ZC, 28.6, 0.02);
    put(b, M.darkMetal, [0.12, 1.3, 0.12, -37.0, 35.0, ZC]);
    emit(obj, b);
  }

  // --- The twin towers: three storeys with string courses and corner pilasters, the belfry, Stier's helms ---
  for (const tz of TZ) {
    const b = parts(0.20);
    box(obj, TS, SHAFT, TS, wall, TX, 0, tz);
    const fs = [face('x', TX - TS / 2, -1), face('x', TX + TS / 2, 1), face('z', tz - TS / 2, -1), face('z', tz + TS / 2, 1)];
    for (const f of fs) {
      const c = f.axis === 'x' ? tz : TX;
      for (const v of [19.0, 26.0]) band(b, trim, f, c - TS / 2, c + TS / 2, v, 0.45, 0.3);
      band(b, trim, f, c - TS / 2 - 0.3, c + TS / 2 + 0.3, SHAFT - 0.4, 0.4, 0.3);
      for (const s of [-1, 1]) pilaster(b, trim, f, c + s * (TS / 2 - 0.4), 19.0, SHAFT - 19.4, 0.8, 0.2);
      panel(b, M.darkMetal, f, archOutline(1.5, 3.2), c, 26.8, 0.03);
      win(b, M, f, c, 20.4, 1.0, 2.2, { trim, shape: 'arch' });
    }
    // Two-lantern helm: bell cap, first open lantern, bulb, second lantern, top bulb and the needle with its cross
    const prof = [[3.5, 0], [3.9, 0.5], [3.6, 1.3], [2.4, 2.5], [1.6, 3.3], [1.5, 3.5], [1.5, 5.3], [1.9, 5.6], [1.7, 6.4],
      [1.0, 7.2], [0.8, 7.4], [0.8, 8.8], [1.1, 9.1], [0.9, 9.8], [0.35, 10.4], [0.15, 10.8], [0.06, BERNARDYNI.top - SHAFT - 1.2]];
    ringPanes(b, M.darkMetal, TX, tz, 1.52, spread(0, Math.PI * 1.75, 8), SHAFT + 3.7, 0.7, 1.4, 'arch');
    ringPanes(b, M.darkMetal, TX, tz, 0.82, spread(0, Math.PI * 1.5, 4), SHAFT + 7.6, 0.45, 1.0, 'arch');
    emit(obj, b);
    helm(obj, M, prof, 8, TX, SHAFT, tz);
  }

  // --- Monastery wing (south): three storeys of windows, a hipped tile roof ---
  {
    const b = parts(0.20);
    box(obj, 30, 13, 18.7, wall, -15, 0, 8.35);
    const fW = face('x', -30, -1), fS = face('z', 17.7, 1), fE = face('x', 0, 1);
    windowGrid(b, M, fW, spread(1.5, 15.5, 5), [1.2, 5.4, 9.6], 1.2, 2.0, { trim });
    windowGrid(b, M, fS, spread(-27.5, -2.5, 8), [1.2, 5.4, 9.6], 1.2, 2.0, { trim });
    windowGrid(b, M, fE, spread(1.5, 15.5, 5), [1.2, 5.4, 9.6], 1.2, 2.0, { trim });
    band(b, trim, fW, -1, 17.7, 12.5, 0.5, 0.3);
    band(b, trim, fS, -30, 0, 12.5, 0.5, 0.3);
    emit(obj, b);
    pitchedRoof(obj, 30, 19, 4.5, M.tileRed, -15, 13, 8.5, { hip: 0.5 });
  }

  group.add(obj);
  collider(colliders, -38.0, 38.0, -19.0, -1.0, BERNARDYNI.top);
  collider(colliders, -30.0, 0.0, -1.0, 18.0, 17.5);
  collider(colliders, -37.6, -35.6, -23.0, 3.0, 35.1);
  for (const tz of TZ) collider(colliders, TX - TS / 2, TX + TS / 2, tz - TS / 2, tz + TS / 2, BERNARDYNI.top);
  fitToSite([obj], site('Kościół Bernardynów'), colliders, c0, { height: BERNARDYNI.top });
}

// -------------------------------------------------------------------------------------------------------------------
// Kościół św. Antoniego Padewskiego (Franciszkanie, Wzgórze Przemysła; built 1668–1698 and 1733 to Jan Koński's
// design, per the Ochrona Zabytków register note found by search; no architectural description was available, so
// the towers, front and convent are from general knowledge / photos). The twin towers (lidar 32.6 m, 16 m apart)
// flank the north front (-z): square shafts, octagonal belfries and lantern helms; the front has two tiers of
// pilasters, the portal with niche statues and a curved gable. The nave runs along z on the east, the convent west.
// Envelope 48.0 × 43.5 m.
// -------------------------------------------------------------------------------------------------------------------
function buildFranciszkanie(group, colliders, M) {
  const c0 = colliders.length;
  const obj = new THREE.Group();
  const wall = M.plasterCream;
  const trim = M.plasterWhite;
  const NX0 = 1, NX1 = 22.7;

  // --- Nave ---
  {
    const b = parts(0.20);
    box(obj, NX1 - NX0, 16.5, 41.7, wall, (NX0 + NX1) / 2, 0, -0.15);
    gableSlab(obj, [[-10.85, 0], [10.85, 0], [0, 8]], 0.3, wall, (NX0 + NX1) / 2, 16.5, 20.55, 'z');
    const fE = face('x', NX1, 1), fWs = face('x', NX0, -1), fSo = face('z', 20.7, 1);
    for (const z of spread(-16, 20, 7)) pilaster(b, trim, fE, z, 0, 15.9, 0.9, 0.25);
    for (const z of spread(-13, 17, 6)) {
      win(b, M, fE, z, 7.0, 2.0, 4.8, { trim, shape: 'arch', jambs: true });
      win(b, M, fE, z, 2.5, 1.2, 1.4, { trim });
    }
    band(b, trim, fE, -16.9, 20.7, 15.9, 0.6, 0.3);
    for (const z of [4, 10, 16]) win(b, M, fWs, z, 7.0, 2.0, 4.8, { trim, shape: 'arch', jambs: true });
    win(b, M, fSo, 11.85, 6.0, 2.8, 6.0, { trim, shape: 'arch', jambs: true });
    band(b, trim, fSo, NX0, NX1, 15.9, 0.6, 0.3);
    emit(obj, b);
    pitchedRoof(obj, 22.0, 42.0, 8.0, M.tileRed, 12.0, 16.5, 0, { ridge: 'z' });
  }

  // --- North front between the towers: portal, niches, two tiers of pilasters, the curved gable ---
  {
    const b = parts(0.20);
    box(obj, 22, 14, 2.7, wall, 12, 0, -20.85);
    box(obj, 10.8, 6.47, 2.0, wall, 12, 14.03, -21.2);
    gableSlab(obj, scrollGable(5.4, 5.5, 24.5 - 20.5, 2, 26.0 - 20.5), 1.2, wall, 12, 20.5, -21.5, 'z');
    const fF = face('z', -22.2, -1);
    for (const x of [1.5, 6.5, 9.0, 15.0, 17.5, 22.5]) pilaster(b, trim, fF, x, 0, 13.4, 0.8, 0.3);
    band(b, trim, fF, 1.0, 23.0, 13.4, 0.6, 0.3);
    panel(b, M.wood, fF, archOutline(2.6, 4.4), 12, 0, 0.05);
    for (const s of [-1, 1]) column(b, trim, 12 + s * 1.8, 0, -22.15, 5.4, 0.26);
    band(b, trim, fF, 10.0, 14.0, 5.4, 0.45, 0.3);
    win(b, M, fF, 12, 7.0, 1.8, 3.2, { trim, hood: 'pediment', jambs: true });
    for (const x of [7.75, 16.25]) {
      panel(b, trim, fF, archOutline(1.2, 2.6), x, 5.4, 0.04);
      statue(b, M.sandstone, x, 5.4, -22.15, 2.0);
    }
    for (const x of [4, 20]) win(b, M, fF, x, 7.0, 1.2, 2.6, { trim, shape: 'arch', jambs: true });
    for (const x of [7.4, 9.6, 14.4, 16.6]) pilaster(b, trim, fF, x, 14, 6.2, 0.6, 0.25);
    win(b, M, fF, 12, 15.2, 2.0, 3.6, { trim, shape: 'arch', jambs: true });
    band(b, trim, fF, 6.6, 17.4, 20.2, 0.3, 0.3);
    put(b, M.darkMetal, [0.12, 1.2, 0.12, 12, 25.9, -21.5]);
    emit(obj, b);
  }

  // --- Twin towers: square shafts, octagonal belfries, lantern helms ---
  for (const tx of [4.0, 20.0]) {
    const b = parts(0.20);
    const tz = -19.5, S = 5.2, SH = 21.0;
    box(obj, S, SH, S, wall, tx, 0, tz);
    for (const f of [face('z', tz - S / 2, -1), face('x', tx - S / 2, -1), face('x', tx + S / 2, 1)]) {
      const c = f.axis === 'x' ? tz : tx;
      for (const s of [-1, 1]) pilaster(b, trim, f, c + s * (S / 2 - 0.35), 14, SH - 14.4, 0.7, 0.2);
      win(b, M, f, c, 16.0, 1.0, 2.4, { trim, shape: 'arch' });
      band(b, trim, f, c - S / 2 - 0.3, c + S / 2 + 0.3, SH - 0.4, 0.4, 0.3);
    }
    put(b, wall, { ring: [2.3, 2.3, 3.0, 8, tx, SH, tz], a0: Math.PI / 8 });
    ringPanes(b, M.darkMetal, tx, tz, 2.3 * Math.cos(Math.PI / 8), spread(0, Math.PI * 1.5, 4), SH + 0.4, 0.8, 1.9, 'arch');
    put(b, trim, { ring: [2.6, 2.6, 0.3, 8, tx, SH + 2.7, tz], a0: Math.PI / 8, cap: true });
    const prof = [[2.5, 0], [2.6, 0.3], [2.2, 1.1], [1.3, 2.0], [0.9, 2.3], [0.9, 3.5], [1.2, 3.8], [0.9, 4.6], [0.4, 5.2],
      [0.15, 5.8], [0.06, FRANCISZKANIE.top - SH - 3.0 - 1.2]];
    ringPanes(b, M.darkMetal, tx, tz, 0.92, spread(0, Math.PI * 1.5, 4), SH + 3.0 + 2.45, 0.45, 0.9, 'arch');
    emit(obj, b);
    helm(obj, M, prof, 8, tx, SH + 3.0, tz);
  }

  // --- The convent: west range on the hill, its south range along the church ---
  {
    const b = parts(0.20);
    box(obj, 23.7, 12.5, 20, wall, -12.85, 0, -10);
    const fN = face('z', -20, -1), fW = face('x', -24.7, -1);
    windowGrid(b, M, fN, spread(-22.5, -3.5, 7), [1.2, 5.2, 9.2], 1.2, 2.0, { trim });
    windowGrid(b, M, fW, spread(-17.5, -2.5, 5), [1.2, 5.2, 9.2], 1.2, 2.0, { trim });
    band(b, trim, fN, -24.7, -1, 12.0, 0.5, 0.3);
    band(b, trim, fW, -20, 0, 12.0, 0.5, 0.3);
    box(obj, 7, 10, 10, wall, -4.5, 0, 5);
    box(obj, 4, 10, 10, wall, -3, 0, 15);
    windowGrid(b, M, face('x', -8, -1), [2.5, 7.5], [1.2, 5.6], 1.1, 1.9, { trim });
    windowGrid(b, M, face('x', -5, -1), [12.5, 17.5], [1.2, 5.6], 1.1, 1.9, { trim });
    emit(obj, b);
    pitchedRoof(obj, 24.0, 20.0, 4.5, M.tileRed, -13.0, 12.5, -10.0, { hip: 0.4 });
    pitchedRoof(obj, 7.2, 10, 2.8, M.tileRed, -4.5, 10, 5, { ridge: 'z', hip: 0.3 });
    pitchedRoof(obj, 4.2, 10, 2.0, M.tileRed, -3, 10, 15, { ridge: 'z', hip: 0.3 });
  }

  group.add(obj);
  collider(colliders, 1.0, 23.0, -22.0, 21.0, FRANCISZKANIE.top);
  collider(colliders, -25.0, 1.0, -20.0, 0.0, 17.0);
  collider(colliders, -8.0, -1.0, 0.0, 10.0, 12.8);
  collider(colliders, -5.0, -1.0, 10.0, 20.0, 12.0);
  fitToSite([obj], site('Kościół Franciszkanów'), colliders, c0, { height: FRANCISZKANIE.top });
}

// -------------------------------------------------------------------------------------------------------------------
// Kościół Najświętszej Marii Panny in Summo (1431–1448; Hanusz Prusz completed it, Lorek of Kościan bricked the west
// gable in 1445): a short, wide brick hall of two bays and three aisles with an ambulatory, the outer wall closed in a
// pentagon at the east; no buttresses, but shallow lesenes with two levels of niches, probably once topped by
// gablets, and one three-light ogival window between each pair; the west gable stepped, filled with ogival blendes and
// topped with pinnacles, the highest converted into a 19th-century ridge turret; the main portal of moulded glazed
// brick on the south, its twin on the north walled up (medievalheritage.eu "Poznań – collegiate church of St. Mary";
// dzieje.pl). The polygon's proportions, the blendes' layout and the window sizes are from general knowledge /
// photos. Envelope 24.2 × 15.8 m, ridge and turret 28.8 m.
// -------------------------------------------------------------------------------------------------------------------
function buildNmp(group, colliders, M) {
  const c0 = colliders.length;
  const obj = new THREE.Group();
  const b = parts(0.20);
  const EAVE = 14.5;
  const X0 = -11.5, XE = 6.0; // west wall, start of the eastern polygon
  const HW = 7.5;
  const blende = M.plasterWhite;

  box(obj, XE - X0, EAVE, 2 * HW, M.brick, (X0 + XE) / 2, 0, 0);
  pitchedRoof(obj, XE - X0, 2 * HW + 0.6, NMP.top - EAVE, M.tileRed, (X0 + XE) / 2, EAVE, 0, { ridge: 'x' });
  // The eastern closure: half an octagon, its walls, a hipped roof down from the ridge end, a window on every face
  const poly = [];
  for (let i = 0; i <= 4; i++) {
    const a = (i * Math.PI) / 4;
    poly.push([XE + 5.9 * Math.sin(a), -HW * Math.cos(a)]);
  }
  for (let i = 0; i < 4; i++) {
    const [x0, z0] = poly[i], [x1, z1] = poly[i + 1];
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    const ox = (z1 - z0), oz = -(x1 - x0); // outward: the polygon runs from -z round +x to +z
    const l = Math.hypot(ox, oz);
    put(b, M.brick, { poly: [[x0, 0, z0], [x1, 0, z1], [x1, EAVE, z1], [x0, EAVE, z0]], n: [ox / l, 0, oz / l] });
    const pad = (p) => [p[0] + (ox / l) * 0.2, p[1] + (oz / l) * 0.2];
    const e0 = pad([x0, z0]), e1 = pad([x1, z1]);
    put(b, M.tileRed, { poly: [[e0[0], EAVE, e0[1]], [e1[0], EAVE, e1[1]], [XE, NMP.top, 0]], n: [ox / l, 0.6, oz / l] });
    const f = gface(mx, mz, Math.atan2(ox, oz));
    win(b, M, f, 0, 3.6, 2.2, 8.0, { shape: 'point', trim: M.clinker, mullions: 2 });
  }
  for (const [x, z] of [poly[1], poly[3]]) put(b, M.brick, [0.9, EAVE, 0.9, x, 0, z]);
  put(b, M.brick, [0.4, EAVE, 1.0, 11.9, 0, 0]);
  // Long walls: three lesenes each with two levels of niches and a gablet, a three-light window in each bay
  for (const s of [-1, 1]) {
    const f = face('z', s * HW, s);
    for (const x of [X0 + 0.5, (X0 + XE) / 2, XE]) {
      pilaster(b, M.brick, f, x, 0, EAVE, 1.2, 0.4);
      const lf = face('z', s * (HW + 0.4), s);
      for (const v of [3.5, 8.5]) panel(b, blende, lf, pointOutline(0.7, 2.6), x, v, 0.01);
      const gab = [facePt(f, x - 0.6, EAVE, 0.2), facePt(f, x + 0.6, EAVE, 0.2), facePt(f, x, EAVE + 1.6, 0.2)];
      put(b, M.brick, { poly: gab, n: faceN(f) });
      put(b, M.brick, { poly: gab, n: faceN(f).map((c) => -c) }); // seen over the roof from the far side too
    }
    for (const x of [-7.1, 1.6]) {
      const portal = x < 0;
      if (portal && s > 0) {
        // South portal of moulded glazed brick, the main entrance
        panel(b, M.clinker, f, pointOutline(3.0, 4.6), x, 0, 0.06);
        panel(b, M.wood, f, pointOutline(2.0, 3.8), x, 0, 0.08);
      } else if (portal) {
        panel(b, M.clinker, f, pointOutline(2.6, 4.2), x, 0, 0.05); // the walled-up north portal
      }
      win(b, M, f, x, portal ? 5.6 : 3.4, 3.2, portal ? 7.6 : 9.6, { shape: 'point', trim: M.clinker, mullions: 2 });
    }
  }
  // The west gable: six steps a side with white ogival blendes, a pinnacle on every step and the ridge turret
  const HWS = [7.5, 6.3, 5.1, 3.9, 2.7, 1.5];
  const VS = [2.0, 4.1, 6.2, 8.3, 10.4, 12.5];
  gableSlab(obj, steppedOutline(HWS, VS), 1.2, M.brick, X0 + 0.01, EAVE, 0, 'x');
  const gf = face('x', X0 - 0.59, -1);
  for (const u of [0, -1.95, 1.95, -3.9, 3.9, -5.85, 5.85]) {
    let top = 0;
    for (let k = 0; k < HWS.length; k++) if (Math.abs(u) + 0.75 <= HWS[k]) top = VS[k];
    if (top > 1.5) panel(b, blende, gf, pointOutline(1.2, top - 1.0), u, EAVE + 0.4, 0.01);
  }
  for (let k = 0; k < HWS.length; k++) {
    for (const s of [-1, 1]) {
      const z = s * (HWS[k] - 0.3);
      // The crown's pair stays under the turret's tip
      const sh = k === HWS.length - 1 ? 0.5 : 1.2;
      put(b, M.brick, [0.5, sh, 0.5, X0, EAVE + VS[k], z]);
      put(b, M.brick, { ring: [0.38, 0, k === HWS.length - 1 ? 0.6 : 0.8, 4, X0, EAVE + VS[k] + sh, z], a0: Math.PI / 4 });
    }
  }
  put(b, M.brick, [0.9, 0.8, 0.9, X0, EAVE + VS[5], 0]);
  put(b, M.copper, { ring: [0.62, 0, NMP.top - EAVE - VS[5] - 0.8, 4, X0, EAVE + VS[5] + 0.8, 0], a0: Math.PI / 4 });
  // West wall below the gable: the tall west window and the gallery's small windows
  const ww = face('x', X0, -1);
  win(b, M, ww, 0, 4.0, 3.0, 9.0, { shape: 'point', trim: M.clinker, mullions: 2 });
  for (const z of [-5, 5]) panel(b, blende, ww, pointOutline(1.2, 6.0), z, 6.0, 0.02);
  emit(obj, b);

  group.add(obj);
  collider(colliders, -12.5, 12.5, -8.5, 8.5, NMP.top);
  fitToSite([obj], site('Kościół Najświętszej Marii Panny'), colliders, c0, { height: NMP.top });
}

// -------------------------------------------------------------------------------------------------------------------
// Kościół św. Wojciecha: a Gothic brick church, three-aisled pseudo-basilica inside (aisles added in the first half of
// the 16th century), under a high tiled double-pitched roof; the front carries a Gothic frieze of diagonally laid
// brick and a gently curved late-Renaissance gable, gables were added to the east and west a century after the aisles;
// Gothic portals on the north and south; the shingled wooden belfry in front of the church dates from the turn of the
// 16th and 17th centuries, the city's oldest wooden monument (pl.wikipedia "Kościół św. Wojciecha w Poznaniu"; the
// crypt of the distinguished, 1923, lies under the church). The low south annex is the strip the OSM outline shows;
// buttresses, window sizes and the belfry's shape are from general knowledge / photos. Envelope 32.8 × 22.7 m.
// -------------------------------------------------------------------------------------------------------------------
function buildWojciech(group, colliders, M) {
  const c0 = colliders.length;
  const obj = new THREE.Group();
  const b = parts(0.20);
  const EAVE = 12.0;
  const Z0 = -9.0, Z1 = 5.5, ZC = (Z0 + Z1) / 2;

  box(obj, 31.7, EAVE, Z1 - Z0, M.brick, -0.15, 0, ZC);
  pitchedRoof(obj, 31.9, Z1 - Z0 + 0.6, 19.5 - EAVE, M.tileRed, -0.05, EAVE, ZC, { ridge: 'x' }); // behind the east gable
  // Diagonal-brick frieze (clinker lozenges) under the eaves and across the front
  const diamond = [[0, -0.22], [0.22, 0], [0, 0.22], [-0.22, 0]];
  const fN = face('z', Z0, -1), fS = face('z', Z1, 1), fW = face('x', -16, -1), fE = face('x', 15.7, 1);
  for (const [f, u0, u1] of [[fN, -16, 16], [fS, 0, 16], [fW, Z0, Z1]]) {
    for (let u = u0 + 0.4; u < u1 - 0.2; u += 0.62) panel(b, M.clinker, f, diamond, u, EAVE - 0.8, 0.02);
    band(b, M.clinker, f, u0, u1, EAVE - 0.4, 0.2, 0.08);
  }
  // North flank: buttresses, pointed windows, the Gothic portal
  for (const x of [-12, -6, 0, 6, 12]) {
    put(b, M.brick, fbox(fN, x, 1.0, 0, 7.0, 0.25, 0.5));
    put(b, M.brick, fbox(fN, x, 1.0, 7.0, 2.0, 0.15, 0.3));
  }
  for (const x of [-9, 3, 9, 14]) win(b, M, fN, x, 3.5, 1.8, 5.2, { shape: 'point', trim: M.clinker, mullions: 1 });
  panel(b, M.clinker, fN, pointOutline(2.4, 3.8), -3, 0, 0.05);
  panel(b, M.wood, fN, pointOutline(1.6, 3.2), -3, 0, 0.07);
  win(b, M, fN, -3, 5.4, 1.6, 3.4, { shape: 'point', trim: M.clinker });
  // South flank over the annex, buttresses on the free eastern half
  for (const x of [-12, -6]) win(b, M, fS, x, 7.0, 1.6, 3.6, { shape: 'point', trim: M.clinker });
  for (const x of [3, 9, 14]) win(b, M, fS, x, 3.5, 1.8, 5.2, { shape: 'point', trim: M.clinker, mullions: 1 });
  for (const x of [0.5, 6, 12]) put(b, M.brick, fbox(fS, x, 1.0, 0, 7.0, 0.3, 0.6));
  // West front: corner buttresses, the reconstructed west portal and the window over it
  for (const z of [Z0 + 0.5, Z1 - 0.5]) put(b, M.brick, fbox(fW, z, 1.0, 0, 8.0, 0.35, 0.7));
  panel(b, M.clinker, fW, pointOutline(2.8, 4.6), ZC, 0, 0.06);
  panel(b, M.wood, fW, pointOutline(2.0, 4.0), ZC, 0, 0.08);
  win(b, M, fW, ZC, 5.6, 2.2, 4.4, { shape: 'point', trim: M.clinker, mullions: 1 });
  // The late-Renaissance west gable: curved shoulders and crown, white cornices and lesenes, niches
  const GW = Z1 - Z0;
  gableSlab(obj, scrollGable(GW / 2, GW / 2 + 0.3, 19.5 - EAVE, 3, WOJCIECH.top - EAVE), 1.2, M.brick, -16, EAVE, ZC, 'x');
  const gf = face('x', -16.6, -1);
  band(b, M.plasterWhite, gf, Z0, Z1, EAVE, 0.3, 0.15);
  // White cornices on the scrolls' ledges (rise 7.5 m in three tiers)
  for (const [v, hw] of [[1.875, 5.9], [3.75, 4.0], [5.625, 2.1]]) band(b, M.plasterWhite, gf, ZC - hw, ZC + hw, EAVE + v - 0.25, 0.25, 0.1);
  for (const z of [ZC - 4.2, ZC - 1.4, ZC + 1.4, ZC + 4.2]) {
    if (Math.abs(z - ZC) < 3) pilaster(b, M.plasterWhite, gf, z, EAVE + 3.75, 1.6, 0.35, 0.08);
    panel(b, M.plasterWhite, gf, archOutline(0.9, 2.2), z, EAVE + 0.7, 0.02);
  }
  panel(b, M.plasterWhite, gf, archOutline(1.2, 2.6), ZC, EAVE + 4.3, 0.02);
  panel(b, M.glassLit, gf, discOutline(0.45), ZC, EAVE + 8.3, 0.03);
  // East gable (lower, plainer) and the east window of the presbytery
  gableSlab(obj, scrollGable(GW / 2, GW / 2 + 0.3, 19.5 - EAVE, 2, 7.8), 0.6, M.brick, 15.68, EAVE, ZC, 'x');
  win(b, M, fE, ZC, 3.5, 2.0, 6.0, { shape: 'point', trim: M.clinker, mullions: 1 });
  panel(b, M.plasterWhite, face('x', 15.98, 1), archOutline(1.0, 2.0), ZC, EAVE + 1.2, 0.02);
  // The low south annex under a lean-to roof, with the south portal
  box(obj, 15.6, 5.5, 4.0, M.brick, -8.2, 0, Z1 + 2);
  const fA = face('z', Z1 + 4, 1);
  panel(b, M.clinker, fA, pointOutline(2.2, 3.6), -8, 0, 0.05);
  panel(b, M.wood, fA, pointOutline(1.5, 3.0), -8, 0, 0.07);
  for (const x of [-13, -3]) win(b, M, fA, x, 1.6, 1.2, 2.4, { shape: 'point', trim: M.clinker });
  const ly = (z) => 5.5 + ((Z1 + 4.2 - z) / 4.2) * 2.6;
  put(b, M.tileRed, { poly: [[-16, ly(Z1 + 4.2), Z1 + 4.2], [-0.4, ly(Z1 + 4.2), Z1 + 4.2], [-0.4, ly(Z1), Z1], [-16, ly(Z1), Z1]], n: [0, 1, 0.6] });
  for (const x of [-16, -0.4]) put(b, M.brick, { poly: [[x, 5.5, Z1], [x, 5.5, Z1 + 4], [x, ly(Z1), Z1]], n: [x < -8 ? -1 : 1, 0, 0] });

  // The wooden belfry: boarded lower frame under a shingled skirt roof, the open bell storey and its tented helm
  {
    const BX = 4, BZ = 9.5;
    box(obj, 6.0, 6.5, 6.0, M.wood, BX, 0, BZ);
    for (const f of [face('x', BX - 3, -1), face('x', BX + 3, 1), face('z', BZ - 3, -1), face('z', BZ + 3, 1)]) {
      const c = f.axis === 'x' ? BZ : BX;
      for (const u of spread(c - 2.6, c + 2.6, 6)) put(b, M.wood, fbox(f, u, 0.1, 0, 6.5, 0.04, 0.08));
      panel(b, M.darkMetal, f, rectOutline(1.2, 2.2), c, 0, 0.09);
    }
    frustum(b, M.wood, 7.4, 7.4, 4.9, 4.9, 1.1, BX, 6.5, BZ);
    box(obj, 4.6, 2.6, 4.6, M.wood, BX, 7.6, BZ);
    for (const f of [face('x', BX - 2.3, -1), face('x', BX + 2.3, 1), face('z', BZ - 2.3, -1), face('z', BZ + 2.3, 1)]) {
      const c = f.axis === 'x' ? BZ : BX;
      for (const du of [-0.9, 0.9]) panel(b, M.darkMetal, f, archOutline(0.8, 1.7), c + du, 8.0, 0.02);
    }
    pitchedRoof(obj, 5.2, 5.2, 1.6, M.wood, BX, 10.2, BZ, { hip: 1 });
    put(b, M.darkMetal, { ring: [0.08, 0.02, 0.2, 4, BX, 11.8, BZ] });
  }
  emit(obj, b);

  group.add(obj);
  collider(colliders, -17.0, 17.0, -9.5, 5.5, WOJCIECH.top);
  collider(colliders, 0.5, 7.5, 6.0, 13.0, 12.0);
  collider(colliders, -16.0, -0.4, 5.5, 9.5, 8.1);
  fitToSite([obj], site('Kościół św. Wojciecha'), colliders, c0, { height: WOJCIECH.top });
}

// -------------------------------------------------------------------------------------------------------------------
// Kościół Bożego Ciała (founded 1406): a three-aisled Gothic pseudo-hall whose tall body is held by massive stepped
// buttresses up to the crowning cornice; the elongated presbytery with five windows (three keep their 15th-century
// tracery); a plain west front dominated by a great five-light traceried window under a modest Baroque gable with a
// relief of the chalice and three hosts; a stocky tower by Krzysztof Bonadura the Elder added to the south aisle
// around 1700; the main and north portals reconstructed on the glazed-brick south portal (pl.wikipedia "Kościół Bożego
// Ciała w Poznaniu"). The copper ridge turret at mid-length is the 39.5 m lidar peak; the tower's position (where the
// OSM outline bulges south), buttress spacing and the turret's form are from general knowledge / photos. Envelope
// 58.8 × 26.0 m.
// -------------------------------------------------------------------------------------------------------------------
function buildBozeCialo(group, colliders, M) {
  const c0 = colliders.length;
  const obj = new THREE.Group();
  const b = parts(0.20);
  const EAVE = 17.0;
  const ZC = 4.0;
  const X0 = -29.0, X1 = 28.0, Z0 = -8.0, Z1 = 16.0;

  box(obj, X1 - X0, EAVE, Z1 - Z0, M.brick, (X0 + X1) / 2, 0, ZC);
  pitchedRoof(obj, 57.3, 26.0, 31.0 - EAVE, M.tileRed, -0.35, EAVE, ZC, { ridge: 'x' });
  gableSlab(obj, [[-12.0, 0], [12.0, 0], [0, 13.6]], 0.4, M.brick, 28.2, EAVE, ZC, 'x');
  // Stepped buttresses (one per 6.4 m bay) and tall two-light windows between them on both flanks; the presbytery's
  // five windows at the east end keep their tracery roundels
  const bx = spread(-26.6, 25.0, 9);
  for (const s of [-1, 1]) {
    const f = face('z', s > 0 ? Z1 : Z0, s);
    for (const x of bx) {
      put(b, M.brick, fbox(f, x, 1.3, 0, 10.0, 0.5, 1.0));
      put(b, M.brick, fbox(f, x, 1.3, 10.0, 6.4, 0.3, 0.6));
      put(b, M.clinker, fbox(f, x, 1.35, 9.8, 0.25, 0.52, 1.04));
    }
    for (let i = 0; i < bx.length - 1; i++) {
      const x = (bx[i] + bx[i + 1]) / 2;
      if (s > 0 && x > 14.5 && x < 21.5) continue; // the tower
      win(b, M, f, x, 4.5, 2.6, 10.5, { shape: 'point', trim: M.clinker, mullions: 1 });
      if (x > 12) panel(b, M.clinker, f, discOutline(0.5), x, 13.0, 0.06);
    }
    band(b, M.clinker, f, X0, X1, EAVE - 0.5, 0.5, 0.25);
  }
  // East end: buttresses at the corners and the presbytery's axial window
  const fE = face('x', X1, 1);
  for (const z of [Z0 + 0.7, Z1 - 0.7, ZC - 5, ZC + 5]) put(b, M.brick, fbox(fE, z, 1.3, 0, 15.0, 0.5, 1.0));
  win(b, M, fE, ZC, 4.5, 3.0, 11.0, { shape: 'point', trim: M.clinker, mullions: 2 });
  // West front: the glazed-brick portal, the five-light window with tracery roundels, corner buttresses
  const fW = face('x', X0, -1);
  for (const z of [Z0 + 0.7, Z1 - 0.7]) put(b, M.brick, fbox(fW, z, 1.3, 0, 15.0, 0.4, 0.8));
  panel(b, M.clinker, fW, pointOutline(3.6, 5.6), ZC, 0, 0.06);
  panel(b, M.wood, fW, pointOutline(2.4, 4.6), ZC, 0, 0.08);
  win(b, M, fW, ZC, 6.6, 6.5, 9.8, { shape: 'point', trim: M.clinker, mullions: 4 });
  for (const dz of [-1.6, 0, 1.6]) panel(b, M.clinker, fW, discOutline(0.55), ZC + dz, 13.6 - Math.abs(dz) * 0.5, 0.06);
  // The Baroque west gable: curved shoulders and crown, white cornices, the chalice and three hosts in a medallion
  gableSlab(obj, scrollGable(13.0, 13.0, 31.0 - EAVE, 3, 16.0), 1.6, M.brick, X0 + 0.2, EAVE, ZC, 'x');
  const gf = face('x', X0 - 0.6, -1);
  band(b, M.plasterWhite, gf, Z0 + 0.2, Z1 - 0.2, EAVE, 0.4, 0.15);
  for (const [v, hw] of [[3.5, 9.9], [7.0, 6.7], [10.5, 3.4]]) band(b, M.plasterWhite, gf, ZC - hw, ZC + hw, EAVE + v - 0.3, 0.3, 0.1);
  for (const dz of [-6, 6]) panel(b, M.plasterWhite, gf, archOutline(1.4, 3.4), ZC + dz, EAVE + 1.4, 0.02);
  panel(b, M.plasterWhite, gf, discOutline(1.7, 12), ZC, EAVE + 4.4, 0.02);
  // The chalice in convex pieces (panels are fans): foot, stem, cup
  panel(b, M.sandstone, gf, [[-0.35, 0], [0.35, 0], [0.12, 0.2], [-0.12, 0.2]], ZC, EAVE + 4.9, 0.03);
  panel(b, M.sandstone, gf, rectOutline(0.16, 0.6), ZC, EAVE + 5.1, 0.03);
  panel(b, M.sandstone, gf, [[-0.12, 0], [0.12, 0], [0.7, 0.6], [-0.7, 0.6]], ZC, EAVE + 5.7, 0.03);
  for (const dz of [-0.8, 0, 0.8]) panel(b, M.sandstone, gf, discOutline(0.22, 8), ZC + dz, EAVE + 6.5 + (dz ? 0 : 0.35), 0.03);
  panel(b, M.glassLit, gf, archOutline(1.4, 2.4), ZC, EAVE + 11.0, 0.02);
  // Bonadura's tower on the south aisle: a stocky square shaft with corner pilasters, belfry openings, Baroque cap
  {
    const TX = 18, TZ = 12.5, S = 7.0, SH = 28.0;
    box(obj, S, SH, S, M.brick, TX, 0, TZ);
    for (const f of [face('z', TZ + S / 2, 1), face('x', TX - S / 2, -1), face('x', TX + S / 2, 1)]) {
      const c = f.axis === 'x' ? TZ : TX;
      for (const s of [-1, 1]) pilaster(b, M.brick, f, c + s * (S / 2 - 0.4), 0, SH - 0.6, 0.8, 0.3);
      for (const v of [9.5, 19.0]) band(b, M.plasterWhite, f, c - S / 2 + 0.8, c + S / 2 - 0.8, v, 0.35, 0.25);
      band(b, M.plasterWhite, f, c - S / 2 - 0.2, c + S / 2 + 0.2, SH - 0.6, 0.6, 0.33);
      panel(b, M.darkMetal, f, archOutline(1.6, 3.4), c, 23.2, 0.03);
      win(b, M, f, c, 12.0, 1.1, 2.6, { shape: 'arch', trim: M.plasterWhite });
    }
    win(b, M, face('z', TZ + S / 2, 1), TX, 2.0, 1.4, 3.6, { shape: 'point', trim: M.clinker });
    lathe(obj, [[4.0, 0], [4.1, 0.4], [3.4, 1.6], [2.0, 2.6], [1.2, 3.0], [1.1, 3.6], [1.4, 3.9], [0.9, 4.6], [0.3, 5.0], [0.08, 5.6]], 8, M.copper, TX, SH, TZ);
  }
  // The copper ridge turret at mid-length: an octagonal lantern on the ridge and its needle spire with the cross
  {
    const FX = 1.0;
    put(b, M.copper, [1.8, 1.2, 1.8, FX, 30.0, ZC]);
    put(b, M.copper, { ring: [0.75, 0.75, 1.4, 8, FX, 31.2, ZC], a0: Math.PI / 8 });
    ringPanes(b, M.darkMetal, FX, ZC, 0.75 * Math.cos(Math.PI / 8), spread(0, Math.PI * 1.75, 8), 31.4, 0.35, 1.0, 'arch');
    put(b, M.copper, { ring: [0.95, 0.95, 0.2, 8, FX, 32.6, ZC], a0: Math.PI / 8, cap: true });
    emit(obj, b);
    helm(obj, M, [[0.9, 0], [0.5, 0.6], [0.3, 2.0], [0.04, BOZE_CIALO.top - 32.8 - 1.2]], 8, FX, 32.8, ZC);
  }

  group.add(obj);
  collider(colliders, -30.0, 30.0, -9.0, 17.0, BOZE_CIALO.top);
  fitToSite([obj], site('Kościół Bożego Ciała'), colliders, c0, { height: BOZE_CIALO.top });
}

function buildHistoricLandmarks({ group, colliders, M }) {
  _litPaneId = 0;
  _currentLitMat = M.glassLit;
  buildRaczynski(group, colliders, M);
  buildDzialynski(group, colliders, M);
  buildBazar(group, colliders, M);
  buildMuzeum(group, colliders, M);
  buildTeatrPolski(group, colliders, M);
  buildMaius(group, colliders, M);
  buildBernardyni(group, colliders, M);
  buildFranciszkanie(group, colliders, M);
  buildNmp(group, colliders, M);
  buildWojciech(group, colliders, M);
  buildBozeCialo(group, colliders, M);
}

export { buildHistoricLandmarks };
