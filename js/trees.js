import * as THREE from 'three/webgpu';
import { SPECIES_CROWN_R } from './city-config.js';
import { createTreeMaterial } from './tsl-materials.js';

// js/trees.js
// Procedural Poznań street & park trees, planted by street-details.js (section 4):
// - Lime, Norway maple, horse chestnut & black locust grown from seeded per-species rules: a flared
//   trunk / leader carrying scaffold limbs, branches and twigs as tapered, curving bark tubes (uv in metres for the
//   bark shader)
// - Leaf sprays on alpha-tested cards hung from the twigs, cut from a generated leaf atlas (heart-shaped lime leaves
//   with the odd flower bract, five-lobed maple leaves, seven-fingered chestnut leaves, pinnate locust leaves and a
//   dense far-canopy clump)
//   whose mipmaps keep their coverage, so distant crowns don't thin out
// - Crown-shell normals, interior occlusion & sway weights baked per vertex (attributes: createTreeMaterial in
//   tsl-materials.js)
// - Three levels of detail (two variants per species up close), picked per tree from the camera distance and
//   regrouped per spatial cell / species / variant / level whenever the camera has moved a few metres

const V3 = THREE.Vector3;

// Seeded PRNG (mulberry32): every species, variant and level grows the same tree on every load
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// =====================================================================================================================
// 1. LEAF ATLAS: 4x2 tiles of leaf sprays drawn in metres and fitted to their tile (tileMeters = the card's world size)
//    0 lime · 1 Norway maple · 2 horse chestnut · 3 far-canopy clump · 4 black locust
//    Texels: r = leaf brightness, g = per-leaf hue jitter, b = twig / stalk mask, a = coverage
// =====================================================================================================================
const ATLAS_WIDTH = 2048;
const ATLAS_HEIGHT = 1024;
const ATLAS_TILES_X = 4;
const ATLAS_TILES_Y = 2;
const TILE = ATLAS_WIDTH / ATLAS_TILES_X;
const GUTTER = 8; // px kept clear round every tile, so mip levels don't bleed between tiles
const TILE_FAR = 3;
const tileOrigin = (k) => [(k % ATLAS_TILES_X) * TILE, Math.floor(k / ATLAS_TILES_X) * TILE];

// Spray primitives in metres (x right, y up from the card's attachment point): twigs (polylines) & leaves
function buildSprays(rng) {
  const R = (a, b) => a + (b - a) * rng();
  const dirOf = (a) => [Math.sin(a), Math.cos(a)]; // a = angle from straight up

  // Curving twig from (x, y) at angle a off vertical, len m long, curling by `curl` rad over its length
  const twig = (x, y, a, len, curl, segs = 12) => {
    const pts = [[x, y]];
    let ang = a;
    for (let i = 1; i <= segs; i++) {
      ang += curl / segs + R(-0.035, 0.035);
      const p = pts[i - 1];
      pts.push([p[0] + Math.sin(ang) * len / segs, p[1] + Math.cos(ang) * len / segs]);
    }
    return pts;
  };
  // Point & direction angle at arc fraction t of a polyline
  const at = (pts, t) => {
    const f = Math.min(pts.length - 1.001, t * (pts.length - 1));
    const i = Math.floor(f);
    const k = f - i;
    const a = pts[i];
    const b = pts[i + 1];
    return { p: [lerp(a[0], b[0], k), lerp(a[1], b[1], k)], a: Math.atan2(b[0] - a[0], b[1] - a[1]) };
  };

  const sprays = [];

  // 0. Lime (lipa, Tilia cordata): five zigzag twigs, drooping a little, with two ranks of small heart-shaped,
  //    lopsided leaves on slender stalks, and now and then a pale strap-like bract that carries the flower cluster
  {
    const prims = [];
    const n = 5;
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n - 0.5;
      const pts = twig(f * 0.06, 0, f * 1.6 + R(-0.1, 0.1), R(0.52, 0.68) * (1 - Math.abs(f) * 0.25), f * 0.8, 14);
      prims.push({ type: 'twig', pts, w0: 0.012, w1: 0.004 });
      let side = rng() < 0.5 ? 1 : -1;
      for (let t = R(0.1, 0.16); t < 0.97; t += R(0.09, 0.12)) {
        const { p, a } = at(pts, t);
        side = -side;
        const la = a + side * R(0.7, 1.15);
        const len = R(0.095, 0.12) * (1 - t * 0.2);
        const stalk = len * 0.3;
        const q = [p[0] + Math.sin(la) * stalk, p[1] + Math.cos(la) * stalk];
        prims.push({ type: 'stalk', a: p, b: q, w: 0.003 });
        prims.push({ type: 'heart', p: q, a: la + side * R(-0.1, 0.3), len, wid: 0.82, skew: side * 0.14, t });
      }
      if (rng() < 0.5) {
        const { p, a } = at(pts, R(0.45, 0.75));
        prims.push({ type: 'oval', p, a: a + R(-0.5, 0.5), len: R(0.07, 0.085), wid: 0.3, bract: true, t: 1 });
      }
      const tip = at(pts, 1);
      prims.push({ type: 'heart', p: tip.p, a: tip.a, len: 0.09, wid: 0.8, skew: 0.1, t: 1 });
    }
    sprays.push(prims);
  }

  // 1. Norway maple (klon pospolity, Acer platanoides): four twigs with opposite pairs of broad five-lobed leaves on
  //    long stalks, the lobes ending in fine points with a few large teeth
  {
    const prims = [];
    const n = 4;
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n - 0.5;
      const pts = twig(f * 0.08, 0, f * 1.5 + R(-0.1, 0.1), R(0.58, 0.74) * (1 - Math.abs(f) * 0.3), f * 0.5);
      prims.push({ type: 'twig', pts, w0: 0.015, w1: 0.006 });
      for (let t = R(0.28, 0.36); t < 0.95; t += R(0.28, 0.34)) {
        const { p, a } = at(pts, t);
        for (const side of [-1, 1]) {
          const la = a + side * R(0.75, 1.1);
          const len = R(0.15, 0.19) * (1 - t * 0.2);
          const stalk = len * 0.55;
          const q = [p[0] + Math.sin(la) * stalk, p[1] + Math.cos(la) * stalk];
          prims.push({ type: 'stalk', a: p, b: q, w: 0.005 });
          prims.push({ type: 'maple', p: q, a: la + side * R(-0.2, 0.15), len, t });
        }
      }
      const tip = at(pts, 1);
      prims.push({ type: 'maple', p: tip.p, a: tip.a + R(-0.15, 0.15), len: R(0.13, 0.16), t: 1 });
    }
    sprays.push(prims);
  }

  // 2. Horse chestnut (kasztanowiec, Aesculus hippocastanum): three stout twigs with opposite pairs of big palmately
  //    compound leaves, seven obovate leaflets fanned out from the end of a long stalk (the crown's coarse, heavy look)
  {
    const prims = [];
    const n = 3;
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n - 0.5;
      const pts = twig(f * 0.06, 0, f * 1.4 + R(-0.1, 0.1), R(0.5, 0.62), f * 0.4, 10);
      prims.push({ type: 'twig', pts, w0: 0.02, w1: 0.009 });
      for (let t = R(0.3, 0.38); t < 0.9; t += R(0.34, 0.4)) {
        const { p, a } = at(pts, t);
        for (const side of [-1, 1]) {
          const la = a + side * R(0.7, 1.05);
          const len = R(0.2, 0.25) * (1 - t * 0.15);
          const petiole = twig(p[0], p[1], la, len * 0.7, side * R(-0.25, 0.05), 5);
          prims.push({ type: 'stalk', pts: petiole, w: 0.006 });
          const end = at(petiole, 1);
          prims.push({ type: 'digitate', p: end.p, a: end.a, len, t });
        }
      }
      const tip = at(pts, 1);
      prims.push({ type: 'digitate', p: tip.p, a: tip.a, len: R(0.18, 0.21), t: 1 });
    }
    sprays.push(prims);
  }

  // 3. Far-canopy clump: a ragged, roundish mass of leaves (one card stands for a whole section of a distant crown)
  {
    const prims = [];
    const lobes = Array.from({ length: 7 }, () => ({ a: R(0, Math.PI * 2), r: R(0.75, 1.0), w: R(0.5, 0.9) }));
    const edge = (ang) => 1.25 * lobes.reduce((m, l) => Math.max(m, l.r * Math.cos(Math.min(Math.PI / 2, Math.abs(((ang - l.a + Math.PI * 3) % (Math.PI * 2)) - Math.PI) / l.w))), 0.6);
    for (let k = 0; k < 520; k++) {
      const ang = R(0, Math.PI * 2);
      const rr = Math.sqrt(rng()) * edge(ang);
      const p = [Math.cos(ang) * rr, 1.3 + Math.sin(ang) * rr];
      prims.push({ type: 'oval', p, a: R(-Math.PI, Math.PI), len: R(0.16, 0.22), wid: 0.55, t: Math.min(1, Math.max(0, (p[1] - 0.2) / 2.2)) });
    }
    sprays.push(prims);
  }
  // 4. Black locust: airy pinnate leaves, each with paired, rounded leaflets and a terminal leaflet.
  {
    const prims = [];
    for (let i = 0; i < 5; i++) {
      const f = (i + 0.5) / 5 - 0.5;
      const pts = twig(f * 0.07, 0, f * 1.5 + R(-0.1, 0.1), R(0.5, 0.65), f * 0.5);
      prims.push({ type: 'twig', pts, w0: 0.012, w1: 0.004 });
      for (let t = 0.2; t < 0.9; t += 0.19) {
        const { p, a } = at(pts, t);
        for (const side of [-1, 1]) {
          const la = a + side * 0.85;
          const rachis = twig(p[0], p[1], la, R(0.18, 0.25), 0, 5);
          prims.push({ type: 'stalk', pts: rachis, w: 0.003 });
          for (let u = 0.25; u < 0.9; u += 0.2) {
            const leaf = at(rachis, u);
            for (const sd of [-1, 1]) prims.push({ type: 'oval', p: leaf.p, a: leaf.a + sd * 1.1, len: R(0.035, 0.05), wid: 0.58, t });
          }
          const tip = at(rachis, 1);
          prims.push({ type: 'oval', p: tip.p, a: tip.a, len: 0.045, wid: 0.58, t });
        }
      }
    }
    sprays.push(prims);
  }
  return sprays;
}

// Bounding box of a spray (metres), with leaves treated as discs round their centre
function sprayBounds(prims) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const add = (x, y, r = 0) => {
    minX = Math.min(minX, x - r);
    maxX = Math.max(maxX, x + r);
    minY = Math.min(minY, y - r);
    maxY = Math.max(maxY, y + r);
  };
  for (const q of prims) {
    if (q.type === 'twig' || (q.type === 'stalk' && q.pts)) for (const p of q.pts) add(p[0], p[1]);
    else if (q.type === 'stalk') {
      add(q.a[0], q.a[1]);
      add(q.b[0], q.b[1]);
    } else if (q.type === 'digitate') {
      add(q.p[0], q.p[1], q.len); // leaflets fan out up to ±1.5 rad from the stalk
    } else {
      add(q.p[0] + Math.sin(q.a) * q.len * 0.5, q.p[1] + Math.cos(q.a) * q.len * 0.5, q.len * 0.62);
    }
  }
  return { minX, maxX, minY, maxY };
}

function createLeafAtlas() {
  const ctx2d = () => {
    const c = document.createElement('canvas');
    c.width = ATLAS_WIDTH;
    c.height = ATLAS_HEIGHT;
    return c.getContext('2d', { willReadFrequently: true });
  };
  const col = ctx2d(); // r leaf brightness, g hue jitter, b twig mask
  const cov = ctx2d(); // coverage
  // Mean leaf value under the empty texels, so filtering never pulls black (or twig brown) into the leaf edges
  col.fillStyle = 'rgb(170, 128, 0)';
  col.fillRect(0, 0, ATLAS_WIDTH, ATLAS_HEIGHT);
  for (const c of [col, cov]) {
    c.lineCap = 'round';
    c.lineJoin = 'round';
  }
  const rng = mulberry32(20261015);
  const R = (a, b) => a + (b - a) * rng();
  const sprays = buildSprays(rng);
  const tileMeters = [];

  sprays.forEach((prims, k) => {
    // Fit: attachment point at the bottom centre of the tile (the far clump: centred), widest extent to the gutter
    const b = sprayBounds(prims);
    const [ox, oy] = tileOrigin(k);
    const room = TILE - 2 * GUTTER;
    let s;
    let cx;
    let by;
    if (k === TILE_FAR) {
      s = room / Math.max(b.maxX - b.minX, b.maxY - b.minY);
      cx = ox + TILE / 2 - ((b.minX + b.maxX) / 2) * s;
      by = oy + TILE / 2 + ((b.minY + b.maxY) / 2) * s;
    } else {
      s = Math.min((room / 2) / Math.max(-b.minX, b.maxX), room / Math.max(b.maxY, 0.01));
      cx = ox + TILE / 2;
      by = oy + TILE - GUTTER;
    }
    tileMeters[k] = room / s;
    const X = (p) => cx + p[0] * s;
    const Y = (p) => by - p[1] * s;
    // Point (u along, v across) of a leaf from P at angle a, L long & W wide (canvas space)
    const frame = (P, a, L, W) => {
      const d = [Math.sin(a), -Math.cos(a)];
      const x0 = X(P);
      const y0 = Y(P);
      return (u, v) => [x0 + d[0] * u * L * s - d[1] * v * W * s, y0 + d[1] * u * L * s + d[0] * v * W * s];
    };
    const ovalPath = (c, f, skew = 0) => {
      c.moveTo(...f(0, 0));
      c.bezierCurveTo(...f(0.05, 0.6 + skew), ...f(0.6, 0.62), ...f(1, 0));
      c.bezierCurveTo(...f(0.6, -0.62), ...f(0.05, -0.6 + skew), ...f(0, 0));
    };
    const halfPath = (c, f, skew = 0) => {
      c.moveTo(...f(0, 0));
      c.bezierCurveTo(...f(0.05, 0.6 + skew), ...f(0.6, 0.62), ...f(1, 0));
      c.closePath();
    };
    // Lime leaf: two rounded basal lobes either side of the stalk (one a little bigger: the lopsided base), broad
    // shoulders and a short drawn-out tip
    const heartSide = (c, f, sd, k) => {
      c.bezierCurveTo(...f(-0.16 * k, 0.24 * k * sd), ...f(-0.1 * k, 0.64 * sd), ...f(0.3, 0.62 * sd));
      c.bezierCurveTo(...f(0.6, 0.6 * sd), ...f(0.84, 0.24 * sd), ...f(1, 0));
    };
    // Both halves run base to tip as separate sub-paths; the fill closes each along the midrib, and they meet there
    const heartPath = (c, f, skew = 0) => {
      c.moveTo(...f(0, 0));
      heartSide(c, f, 1, 1 + skew);
      c.closePath();
      c.moveTo(...f(0, 0));
      heartSide(c, f, -1, 1 - skew);
      c.closePath();
    };
    const heartHalf = (c, f, skew = 0) => {
      c.moveTo(...f(0, 0));
      heartSide(c, f, 1, 1 + skew);
      c.closePath();
    };
    // Horse chestnut leaflet: obovate, a narrow wedge at the base, widest two-thirds out, then a short point
    const obovateSide = (c, f, sd) => {
      c.bezierCurveTo(...f(0.3, 0.2 * sd), ...f(0.55, 0.62 * sd), ...f(0.8, 0.52 * sd));
      c.bezierCurveTo(...f(0.92, 0.42 * sd), ...f(0.97, 0.14 * sd), ...f(1, 0));
    };
    const obovatePath = (c, f) => {
      for (const sd of [1, -1]) {
        c.moveTo(...f(0, 0));
        obovateSide(c, f, sd);
        c.closePath();
      }
    };
    const obovateHalf = (c, f) => {
      c.moveTo(...f(0, 0));
      obovateSide(c, f, 1);
      c.closePath();
    };
    // Norway maple lobe: straight-edged, one big tooth each side, a fine point at the tip
    const LOBE = [[0, 0.5], [0.45, 0.6], [0.52, 0.98], [0.64, 0.46], [0.82, 0.36], [0.86, 0.56], [1, 0]];
    const lobePath = (c, f) => {
      c.moveTo(...f(...LOBE[0]));
      for (let i = 1; i < LOBE.length; i++) c.lineTo(...f(...LOBE[i]));
      for (let i = LOBE.length - 2; i >= 0; i--) c.lineTo(...f(LOBE[i][0], -LOBE[i][1]));
      c.closePath();
    };
    // Same path on both canvases: data colour on one, white coverage on the other
    const fill = (path, rgb) => {
      for (const [c, style] of [[col, rgb], [cov, '#fff']]) {
        c.beginPath();
        path(c);
        c.fillStyle = style;
        c.fill();
      }
    };
    const stroke = (pts, w0, w1, rgb) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const w = Math.max(0.8, lerp(w0, w1, i / (pts.length - 1)) * s);
        for (const [c, style] of [[col, rgb], [cov, '#fff']]) {
          c.beginPath();
          c.moveTo(X(pts[i]), Y(pts[i]));
          c.lineTo(X(pts[i + 1]), Y(pts[i + 1]));
          c.lineWidth = w;
          c.strokeStyle = style;
          c.stroke();
        }
      }
    };
    const leafRGB = (t) => {
      // brighter towards the sunlit outer end of the spray, a few darker or older leaves
      const r = Math.min(255, Math.round(255 * R(0.6, 0.9) * (0.8 + 0.2 * t)));
      return [r, Math.round(255 * rng())];
    };
    const rgb = (r, g, bl = 0) => `rgb(${r}, ${g}, ${bl})`;

    for (const q of prims) {
      if (q.type === 'twig') stroke(q.pts, q.w0, q.w1, rgb(110, 128, 255));
      else if (q.type === 'stalk') stroke(q.pts || [q.a, q.b], q.w, q.w * 0.7, rgb(120, 128, 150));
      else if (q.type === 'oval') {
        // Lime bracts are pale yellow-green: bright, and high hue jitter (the material's sun-yellowed share)
        const [r, g] = q.bract ? [Math.round(255 * R(0.86, 0.96)), Math.round(R(228, 252))] : leafRGB(q.t);
        const f = frame(q.p, q.a, q.len, q.len * q.wid);
        fill((c) => ovalPath(c, f, q.skew || 0), rgb(r, g));
        if (q.len * s > 9) {
          // one half of the blade a little darker (folded along the midrib) and the midrib itself
          col.beginPath();
          halfPath(col, f, q.skew || 0);
          col.fillStyle = rgb(Math.round(r * 0.84), g);
          col.fill();
        }
      } else if (q.type === 'heart') {
        const [r, g] = leafRGB(q.t);
        const f = frame(q.p, q.a, q.len, q.len * q.wid);
        fill((c) => heartPath(c, f, q.skew || 0), rgb(r, g));
        if (q.len * s > 9) {
          col.beginPath();
          heartHalf(col, f, q.skew || 0);
          col.fillStyle = rgb(Math.round(r * 0.86), g);
          col.fill();
        }
      } else if (q.type === 'maple') {
        // Five toothed lobes radiating from the blade centre: main, two side & two smaller basal ones, wider than long
        const [r, g] = leafRGB(q.t);
        const L = q.len;
        const cP = [q.p[0] + Math.sin(q.a) * L * 0.3, q.p[1] + Math.cos(q.a) * L * 0.3];
        const lobes = [[0, 0.72, 0.34], [0.98, 0.66, 0.34], [-0.98, 0.66, 0.34], [1.95, 0.38, 0.4], [-1.95, 0.38, 0.4]];
        lobes.forEach(([da, ll, ww], li) => {
          const f = frame(cP, q.a + da + R(-0.07, 0.07), L * ll, L * ll * ww);
          const shade = li === 0 ? 1 : (da > 0 ? 0.88 : 0.95);
          fill((c) => lobePath(c, f), rgb(Math.round(r * shade), g));
        });
        fill((c) => c.arc(X(cP), Y(cP), L * 0.3 * s, 0, Math.PI * 2), rgb(Math.round(r * 0.96), g));
      } else if (q.type === 'digitate') {
        // Seven leaflets from the end of the stalk, the middle one longest, the outer pair small and swept back
        const [r, g] = leafRGB(q.t);
        const sizes = [0.5, 0.72, 0.9, 1, 0.9, 0.72, 0.5];
        sizes.forEach((ll, k) => {
          const L = q.len * ll * R(0.92, 1.05);
          const f = frame(q.p, q.a + (k - 3) * 0.47 + R(-0.06, 0.06), L, L * 0.36);
          const shade = k === 3 ? 1 : (k % 2 ? 0.9 : 0.96);
          fill((c) => obovatePath(c, f), rgb(Math.round(r * shade), g));
          if (L * s > 9) {
            col.beginPath();
            obovateHalf(col, f);
            col.fillStyle = rgb(Math.round(r * shade * 0.85), g);
            col.fill();
          }
        });
      }
    }
  });

  // Colour data + coverage -> level 0, then a mip chain whose alpha keeps each tile's coverage
  const data = col.getImageData(0, 0, ATLAS_WIDTH, ATLAS_HEIGHT).data;
  const mask = cov.getImageData(0, 0, ATLAS_WIDTH, ATLAS_HEIGHT).data;
  const level0 = new Uint8Array(ATLAS_WIDTH * ATLAS_HEIGHT * 4);
  for (let i = 0; i < level0.length; i += 4) {
    level0[i] = data[i];
    level0[i + 1] = data[i + 1];
    level0[i + 2] = data[i + 2];
    level0[i + 3] = mask[i + 3];
  }
  const tex = new THREE.DataTexture(level0, ATLAS_WIDTH, ATLAS_HEIGHT, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.mipmaps = coverageMips(level0, ATLAS_WIDTH, ATLAS_HEIGHT, ATLAS_TILES_X, ATLAS_TILES_Y);
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  tex.name = 'TreeLeafAtlas';
  return { texture: tex, tileMeters };
}

// Box-filtered mip chain whose alpha is rescaled per tile so the share of texels above the alpha-test cutoff stays as
// it is at level 0 (otherwise alpha-tested foliage thins out and vanishes at distance)
function coverageMips(level0, width, height, tilesX, tilesY, cutoff = 128) {
  const levels = [{ data: level0, width, height }];
  const target = [];
  const tileWidth = width / tilesX;
  const tileHeight = height / tilesY;
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      let n = 0;
      for (let y = ty * tileHeight; y < (ty + 1) * tileHeight; y++) {
        for (let x = tx * tileWidth; x < (tx + 1) * tileWidth; x++) if (level0[(y * width + x) * 4 + 3] >= cutoff) n++;
      }
      target.push(n / (tileWidth * tileHeight));
    }
  }
  let src = level0;
  let w = width;
  let h = height;
  const hist = new Uint32Array(256);
  while (w > 1 || h > 1) {
    const nw = Math.max(1, w >> 1);
    const nh = Math.max(1, h >> 1);
    const sx = w / nw;
    const sy = h / nh;
    const dst = new Uint8Array(nw * nh * 4);
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        for (let c = 0; c < 4; c++) {
          let sum = 0;
          for (let dy = 0; dy < sy; dy++) for (let dx = 0; dx < sx; dx++) sum += src[((y * sy + dy) * w + x * sx + dx) * 4 + c];
          dst[(y * nw + x) * 4 + c] = Math.round(sum / (sx * sy));
        }
      }
    }
    const nx = Math.min(nw, tilesX);
    const ny = Math.min(nh, tilesY);
    const tw = nw / nx;
    const th = nh / ny;
    for (let ty = 0; ty < ny; ty++) {
      for (let tx = 0; tx < nx; tx++) {
        let mean = 0;
        for (let j = ty * tilesY / ny; j < (ty + 1) * tilesY / ny; j++) {
          for (let i = tx * tilesX / nx; i < (tx + 1) * tilesX / nx; i++) mean += target[j * tilesX + i];
        }
        const want = mean / ((tilesX / nx) * (tilesY / ny)) * tw * th;
        hist.fill(0);
        for (let y = ty * th; y < (ty + 1) * th; y++) for (let x = tx * tw; x < (tx + 1) * tw; x++) hist[dst[(y * nw + x) * 4 + 3]]++;
        let acc = 0;
        let aStar = 255;
        for (let a = 255; a >= 1; a--) {
          acc += hist[a];
          if (acc >= want) { aStar = a; break; }
        }
        const scale = cutoff / Math.max(aStar, 1);
        if (Math.abs(scale - 1) < 0.01) continue;
        for (let y = ty * th; y < (ty + 1) * th; y++) {
          for (let x = tx * tw; x < (tx + 1) * tw; x++) {
            const i = (y * nw + x) * 4 + 3;
            dst[i] = Math.min(255, Math.round(dst[i] * scale));
          }
        }
      }
    }
    levels.push({ data: dst, width: nw, height: nh });
    src = dst;
    w = nw;
    h = nh;
  }
  return levels;
}

// =====================================================================================================================
// 2. SPECIES: trunk / leader (radius, top, lean), scaffold limbs (count, heights up the leader, tilt off vertical and
//    length blended from the lowest to the highest limb), branches & twigs (count, span along the parent, angle off it,
//    length as a share of the parent or in metres), bending per metre (up: toward the sky, out: away from the trunk,
//    droop: down, growing toward the tips), leaf cards per twig (scale, droop) and the per-tree foliage tints (sRGB).
//    Scale 1 is a mature park tree; street trees are planted smaller.
// =====================================================================================================================
// Mature scale 1 horizontal crown radius per species (SPECIES_CROWN_R imported from city-config.js)

const SPECIES = [
  { // 0: Lime (lipa): straight trunk and leader with many slim ascending limbs, a dense egg-shaped dome of small
    //    leaves whose outer twigs hang a little; Poznań's commonest street and park tree
    name: 'lime', tile: 0,
    trunk: { r: 0.28, top: 9.0, lean: 0.03, segs: 8 },
    limbs: { n: 7, y: [3.0, 8.2], tilt: [1.05, 0.38], len: [4.0, 2.4], r: 0.58, up: 0.06, out: 0, droop: 0, jitter: 0.07, segs: 6 },
    branches: { n: 4, t: [0.3, 0.98], angle: [0.55, 0.95], len: [0.6, 0.42], up: 0.04, out: 0.02, droop: 0.03, jitter: 0.1, segs: 4 },
    twigs: { n: 3, t: [0.3, 1.0], angle: [0.6, 1.05], len: [1.05, 0.7], up: 0, out: 0, droop: 0.08, jitter: 0.12, segs: 2 },
    cards: { perTwig: 2, scale: [0.85, 1.1], droop: 0.15 },
    tints: [0x55762b, 0x63842f, 0x4a6a27]
  },
  { // 1: Norway maple (klon): a short trunk soon dividing into several spreading limbs, a broad, dense, rounded crown
    //    of big lobed leaves; the narrow-street and planter tree
    name: 'maple', tile: 1,
    trunk: { r: 0.25, top: 5.6, lean: 0.05, segs: 7 },
    limbs: { n: 6, y: [2.4, 5.2], tilt: [1.1, 0.45], len: [4.4, 3.0], r: 0.64, up: 0.07, out: 0, droop: 0, jitter: 0.1, segs: 6 },
    branches: { n: 4, t: [0.3, 0.98], angle: [0.55, 1.0], len: [0.62, 0.44], up: 0.05, out: 0.02, droop: 0, jitter: 0.12, segs: 4 },
    twigs: { n: 3, t: [0.3, 1.0], angle: [0.6, 1.05], len: [1.05, 0.7], up: 0.02, out: 0, droop: 0.03, jitter: 0.12, segs: 2 },
    cards: { perTwig: 2, scale: [0.85, 1.1], droop: 0.05 },
    tints: [0x4a6b28, 0x577a2d, 0x415f24]
  },
  { // 2: Horse chestnut (kasztanowiec): a stout trunk under a broad, heavy dome; the low limbs sweep out almost level
    //    and turn up at their ends, the branches hang from them and the twig tips curl up again
    name: 'chestnut', tile: 2,
    trunk: { r: 0.36, top: 6.2, lean: 0.04, segs: 7 },
    limbs: { n: 6, y: [2.4, 5.8], tilt: [1.25, 0.45], len: [5.6, 3.2], r: 0.62, up: 0.09, out: 0, droop: 0, jitter: 0.08, segs: 7 },
    branches: { n: 4, t: [0.3, 0.98], angle: [0.6, 1.0], len: [0.58, 0.4], up: 0.02, out: 0.02, droop: 0.06, jitter: 0.1, segs: 4 },
    twigs: { n: 3, t: [0.3, 1.0], angle: [0.55, 1.0], len: [1.1, 0.7], up: 0.06, out: 0, droop: 0, jitter: 0.12, segs: 2 },
    cards: { perTwig: 2, scale: [0.9, 1.15], droop: 0.08 },
    tints: [0x3c5a22, 0x466828, 0x34511f]
  },
  { // 3: Black locust (robinia akacjowa): open, irregular crown with ascending limbs and fine compound foliage.
    // A search-engine snapshot of Poznań's green inventory (retrieved 2026-11-03) listed robinia in its top three;
    // the inventory now redirects to an app, so its snapshot counts could not be independently verified:
    // https://sip.poznan.pl/sip/zielen2/
    name: 'robinia', tile: 4,
    trunk: { r: 0.27, top: 8.2, lean: 0.07, segs: 8 },
    limbs: { n: 6, y: [3.0, 7.5], tilt: [1.05, 0.4], len: [4.1, 2.8], r: 0.58, up: 0.08, out: 0.01, droop: 0, jitter: 0.12, segs: 6 },
    branches: { n: 3, t: [0.3, 0.98], angle: [0.55, 1.0], len: [0.62, 0.44], up: 0.04, out: 0.02, droop: 0.02, jitter: 0.14, segs: 4 },
    twigs: { n: 3, t: [0.3, 1.0], angle: [0.6, 1.1], len: [1.1, 0.75], up: 0, out: 0, droop: 0.05, jitter: 0.15, segs: 2 },
    cards: { perTwig: 2, scale: [0.9, 1.15], droop: 0.1 },
    tints: [0x668341, 0x73914a, 0x587438]
  }
];

// =====================================================================================================================
// 3. SKELETON
// =====================================================================================================================

// Unit vector `angle` off `dir`, turned `azimuth` round it
function deflect(dir, angle, azimuth) {
  const ref = Math.abs(dir.y) < 0.95 ? new V3(0, 1, 0) : new V3(1, 0, 0);
  const u = new V3().crossVectors(dir, ref).normalize();
  const w = new V3().crossVectors(dir, u);
  return dir.clone().multiplyScalar(Math.cos(angle))
    .addScaledVector(u, Math.sin(angle) * Math.cos(azimuth))
    .addScaledVector(w, Math.sin(angle) * Math.sin(azimuth))
    .normalize();
}

// A branch as a polyline from p0 along dir, len metres in segs steps (or at the given length fractions), bending per
// metre toward the sky (up), away from the trunk axis (out) and downward toward its tip (droop), with some wander
function growBranch(p0, dir, len, r0, r1, segs, bend, rng, level, schedule = null) {
  const ts = schedule || Array.from({ length: segs + 1 }, (_, i) => i / segs);
  const pts = [p0.clone()];
  const rad = [r0];
  const d = dir.clone();
  const p = p0.clone();
  const out = new V3();
  for (let i = 1; i < ts.length; i++) {
    const t = ts[i];
    const step = (t - ts[i - 1]) * len;
    out.set(p.x, 0, p.z);
    if (out.lengthSq() > 1e-6) out.normalize();
    d.x += out.x * bend.out * step + (rng() - 0.5) * bend.jitter;
    d.y += (bend.up - bend.droop * t * 2.0) * step + (rng() - 0.5) * bend.jitter * 0.6;
    d.z += out.z * bend.out * step + (rng() - 0.5) * bend.jitter;
    d.normalize();
    p.addScaledVector(d, step);
    pts.push(p.clone());
    rad.push(r0 + (r1 - r0) * Math.pow(t, 0.8));
  }
  return { pts, rad, len, level, ts };
}

// Point, direction & radius at length fraction t of a branch
function along(b, t) {
  const ts = b.ts;
  let i = 0;
  while (i < ts.length - 2 && ts[i + 1] < t) i++;
  const k = Math.min(1, Math.max(0, (t - ts[i]) / (ts[i + 1] - ts[i])));
  return {
    p: b.pts[i].clone().lerp(b.pts[i + 1], k),
    d: b.pts[i + 1].clone().sub(b.pts[i]).normalize(),
    r: lerp(b.rad[i], b.rad[i + 1], k)
  };
}

function growTree(sp, seed) {
  const rng = mulberry32(seed);
  const R = (a, b) => a + (b - a) * rng();
  const branches = [];
  const still = { up: 0, out: 0, droop: 0, jitter: 0.025 };

  // Trunk & leader: leaning a little, flaring at the root (dense rings at the base), tapering to a slim top
  const T = sp.trunk;
  const lean = R(0, Math.PI * 2);
  const trunkDir = new V3(Math.cos(lean) * T.lean, 1, Math.sin(lean) * T.lean).normalize();
  const schedule = [0, 0.03, 0.08];
  for (let i = 1; i <= T.segs; i++) schedule.push(0.08 + (0.92 * i) / T.segs);
  const trunk = growBranch(new V3(0, 0, 0), trunkDir, T.top, T.r, T.r * 0.3, T.segs, still, rng, 0, schedule);
  trunk.rad = trunk.rad.map((r, i) => r * (1 + 0.75 * Math.exp(-(trunk.ts[i] * T.top) / 0.28)));
  branches.push(trunk);

  // Scaffold limbs spiralling up the leader by the golden angle; branches along each limb; twigs along each branch
  const L = sp.limbs;
  const B = sp.branches;
  const W = sp.twigs;
  let az = R(0, Math.PI * 2);
  for (let i = 0; i < L.n; i++) {
    const f = L.n > 1 ? i / (L.n - 1) : 0;
    const y = lerp(L.y[0], L.y[1], f) + R(-0.25, 0.25);
    const base = along(trunk, Math.min(0.98, y / T.top));
    az += 2.39996 + R(-0.35, 0.35);
    const tilt = lerp(L.tilt[0], L.tilt[1], f) + R(-0.08, 0.08);
    const dir = new V3(Math.sin(tilt) * Math.cos(az), Math.cos(tilt), Math.sin(tilt) * Math.sin(az));
    const len = lerp(L.len[0], L.len[1], f) * R(0.88, 1.1);
    const limb = growBranch(base.p, dir, len, base.r * L.r, 0.035, L.segs, L, rng, 1);
    branches.push(limb);

    const nb = B.n + (rng() < 0.5 ? 1 : 0);
    let baz = R(0, Math.PI * 2);
    for (let j = 0; j < nb; j++) {
      const bt = lerp(B.t[0], B.t[1], (j + R(0.15, 0.85)) / nb);
      const a = along(limb, bt);
      baz += 2.39996 + R(-0.4, 0.4);
      const bdir = deflect(a.d, R(B.angle[0], B.angle[1]), baz);
      const outw = new V3(a.p.x, 0, a.p.z).normalize();
      if (bdir.dot(outw) < -0.15) bdir.addScaledVector(outw, 0.7).normalize(); // keep out of the crown core
      const blen = len * lerp(B.len[0], B.len[1], bt) * R(0.85, 1.12);
      const br = growBranch(a.p, bdir, blen, Math.max(0.022, a.r * 0.62), 0.014, B.segs, B, rng, 2);
      br.parentT = bt;
      branches.push(br);

      const nw = W.n + (rng() < 0.4 ? 1 : 0);
      let taz = R(0, Math.PI * 2);
      for (let k = 0; k < nw; k++) {
        const tt = lerp(W.t[0], W.t[1], (k + R(0.2, 0.8)) / nw);
        const ta = along(br, tt);
        taz += 2.39996 + R(-0.5, 0.5);
        const tdir = deflect(ta.d, R(W.angle[0], W.angle[1]), taz);
        const tw = growBranch(ta.p, tdir, lerp(W.len[0], W.len[1], tt) * R(0.8, 1.2), Math.max(0.012, ta.r * 0.7), 0.006, W.segs, W, rng, 3);
        tw.parentT = tt;
        branches.push(tw);
      }
    }
  }
  return branches;
}

// =====================================================================================================================
// 4. GEOMETRY: bark tubes & leaf cards of one species / variant at one level of detail
// =====================================================================================================================
class TreeGeometryBuilder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.attr = [];
    this.idx = [];
  }

  vertex(p, n, u, v, leaf, ao, sway, rnd) {
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(n.x, n.y, n.z);
    this.uv.push(u, v);
    this.attr.push(leaf, ao, sway, rnd);
    return this.pos.length / 3 - 1;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aTree', new THREE.Float32BufferAttribute(this.attr, 4));
    const vCount = this.pos.length / 3;
    g.setIndex(vCount > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// Tapered tube along a branch with parallel-transported rings (every `stride`-th skeleton point); uv in metres
function addTube(gb, b, radial, stride, aoAt, swayAt) {
  const n = b.pts.length;
  const keep = [];
  for (let i = 0; i < n; i += stride) keep.push(i);
  if (keep[keep.length - 1] !== n - 1) keep.push(n - 1);
  const tangent = (i) => {
    const a = b.pts[Math.max(0, i - 1)];
    const c = b.pts[Math.min(n - 1, i + 1)];
    return c.clone().sub(a).normalize();
  };
  let T = tangent(keep[0]);
  let N = Math.abs(T.y) < 0.9 ? new V3(0, 1, 0).cross(T).normalize() : new V3(1, 0, 0).cross(T).normalize();
  const q = new THREE.Quaternion();
  const around = 2 * Math.PI * Math.max(b.rad[0], 0.02);
  let vLen = 0;
  const base = gb.pos.length / 3;
  const dir = new V3();
  const p = new V3();
  keep.forEach((i, ki) => {
    if (ki > 0) {
      const T2 = tangent(i);
      q.setFromUnitVectors(T, T2);
      N.applyQuaternion(q).normalize();
      T = T2;
      vLen += b.pts[i].distanceTo(b.pts[keep[ki - 1]]);
    }
    const Bn = new V3().crossVectors(T, N);
    const t = b.ts[i];
    const ao = aoAt(b.pts[i]);
    const sway = swayAt(b, t);
    for (let j = 0; j <= radial; j++) {
      const ang = (j / radial) * Math.PI * 2;
      dir.copy(N).multiplyScalar(Math.cos(ang)).addScaledVector(Bn, Math.sin(ang));
      p.copy(b.pts[i]).addScaledVector(dir, b.rad[i]);
      gb.vertex(p, dir, (j / radial) * around, vLen, 0, ao, sway, 0);
    }
  });
  // Rings run counter-clockwise round the tangent, so (a, a + 1, c) is counter-clockwise seen from outside: the front
  // faces point out along the normals (the material drops the bark's back faces)
  for (let k = 0; k < keep.length - 1; k++) {
    for (let j = 0; j < radial; j++) {
      const a = base + k * (radial + 1) + j;
      const c = a + radial + 1;
      gb.idx.push(a, a + 1, c, a + 1, c + 1, c);
    }
  }
}

// Leaf card: bottom edge centred on `at`, rising along `up`, facing `face`; uv over atlas tile `tile` (mirrored or not)
function addCard(gb, at, up, face, size, tile, mirror, rnd, crown) {
  const side = new V3().crossVectors(up, face).normalize();
  const nrm = new V3().crossVectors(side, up).normalize();
  const [ox, oy] = tileOrigin(tile);
  let u0 = (ox + GUTTER) / ATLAS_WIDTH;
  let u1 = (ox + TILE - GUTTER) / ATLAS_WIDTH;
  if (mirror) [u0, u1] = [u1, u0];
  const vTop = (oy + GUTTER) / ATLAS_HEIGHT;
  const vBot = (oy + TILE - GUTTER) / ATLAS_HEIGHT;
  const corners = [
    [-0.5, 0, u0, vBot],
    [0.5, 0, u1, vBot],
    [0.5, 1, u1, vTop],
    [-0.5, 1, u0, vTop]
  ];
  const base = gb.pos.length / 3;
  const p = new V3();
  for (const [sx, sy, u, v] of corners) {
    p.copy(at).addScaledVector(side, sx * size).addScaledVector(up, sy * size);
    const { n, ao } = crown.shade(p, nrm);
    gb.vertex(p, n, u, v, 1, ao, lerp(0.8, 1.0, sy), rnd);
  }
  gb.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

// Crown ellipsoid (from the foliage) for shell normals & interior occlusion
function makeCrown(points) {
  const box = new THREE.Box3().setFromPoints(points);
  const C = box.getCenter(new V3());
  const Rr = box.getSize(new V3()).multiplyScalar(0.5).max(new V3(0.5, 0.5, 0.5));
  const tmp = new V3();
  const sn = new V3();
  return {
    C,
    R: Rr,
    bottom: box.min.y,
    // Shell normal (out from the centre, a little skyward) blended with the card face (turned to agree with it)
    shade(p, face) {
      tmp.copy(p).sub(C).divide(Rr);
      const e = tmp.length();
      sn.copy(tmp).normalize();
      sn.y += 0.22;
      sn.normalize();
      const f = face.dot(sn) < 0 ? face.clone().negate() : face.clone();
      const n = sn.clone().multiplyScalar(0.72).addScaledVector(f, 0.28).normalize();
      const top = Math.min(1, Math.max(-1, (p.y - C.y) / Rr.y));
      const ao = (0.22 + 0.78 * smooth(0.15, 1.0, e)) * (0.86 + 0.14 * top);
      return { n, ao };
    },
    // Bark: open below the crown, darker the deeper inside it
    barkAO(p) {
      if (p.y < box.min.y) return 0.9;
      tmp.copy(p).sub(C).divide(Rr);
      return lerp(0.32, 0.8, smooth(0.2, 1.0, tmp.length()));
    }
  };
}

// Sway weight along the hierarchy: 0 on the trunk (whole-tree bend is height based), rising to 1 at the twig tips
function swayWeight(b, t) {
  switch (b.level) {
    case 0: return 0;
    case 1: return 0.18 * t;
    case 2: return 0.18 + 0.4 * t;
    default: return 0.58 + 0.4 * t;
  }
}

// Leaf cards of one tree: lod 0 on every twig, lod 1 fewer & larger along the branches, lod 2 a shell of whole-crown
// cards (far-canopy tile) round the crown ellipsoid
function placeCards(sp, branches, lod, tileMeters, rng, crown) {
  const R = (a, b) => a + (b - a) * rng();
  const cards = [];
  const outward = (p) => new V3(p.x - crown.C.x, (p.y - crown.C.y) * 0.6, p.z - crown.C.z).normalize();
  const orient = (p, d, droop) => {
    const o = outward(p);
    const up = d.clone().multiplyScalar(0.55).addScaledVector(o, 0.45)
      .add(new V3(R(-0.3, 0.3), R(-0.2, 0.3), R(-0.3, 0.3)));
    up.y -= droop;
    up.normalize();
    let face = o.clone().add(new V3(R(-0.9, 0.9), R(-0.6, 0.9), R(-0.9, 0.9))).normalize();
    face.addScaledVector(up, -face.dot(up));
    if (face.lengthSq() < 1e-4) face = new V3(0, 1, 0).cross(up);
    return { up, face: face.normalize() };
  };
  const size = tileMeters[sp.tile];
  if (lod === 0) {
    for (const b of branches) {
      if (b.level !== 3) continue;
      const n = sp.cards.perTwig;
      for (let k = 0; k < n; k++) {
        const t = lerp(0.4, 1.0, (k + R(0.3, 0.9)) / n);
        const a = along(b, t);
        const { up, face } = orient(a.p, a.d, sp.cards.droop);
        cards.push({ at: a.p, up, face, size: size * R(sp.cards.scale[0], sp.cards.scale[1]), tile: sp.tile });
      }
    }
    // a card at the end of every branch fills the gap between its twigs
    for (const b of branches) {
      if (b.level !== 2) continue;
      const a = along(b, 1);
      const { up, face } = orient(a.p, a.d, sp.cards.droop);
      cards.push({ at: a.p, up, face, size: size * R(0.9, 1.1), tile: sp.tile });
    }
  } else if (lod === 1) {
    for (const b of branches) {
      if (b.level !== 2) continue;
      for (const t of [0.42, 0.72, 1.0]) {
        const a = along(b, Math.min(1, t + R(-0.06, 0.04)));
        const { up, face } = orient(a.p, a.d, sp.cards.droop);
        const at = a.p.clone().addScaledVector(outward(a.p), 0.35);
        cards.push({ at, up, face, size: size * R(1.35, 1.6), tile: sp.tile });
      }
    }
  } else {
    // Fibonacci directions over the crown, fewer underneath; cards centred just inside the shell, facing out
    const n = 18;
    const meanR = (crown.R.x + crown.R.y + crown.R.z) / 3;
    const s = Math.max(meanR * 1.25, 2.4);
    for (let i = 0; i < n; i++) {
      const y = 1 - (i + 0.5) / n * 1.55; // 1 .. -0.55
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const ph = i * 2.39996 + R(-0.2, 0.2);
      const dir = new V3(Math.cos(ph) * r, y, Math.sin(ph) * r);
      const center = crown.C.clone().add(dir.clone().multiply(crown.R).multiplyScalar(0.58));
      const face = dir.clone().add(new V3(R(-0.25, 0.25), R(-0.25, 0.25), R(-0.25, 0.25))).normalize();
      let up = new V3(0, 1, 0).addScaledVector(face, -face.y);
      if (up.lengthSq() < 1e-3) up = new V3(1, 0, 0);
      up.normalize().applyAxisAngle(face, R(-0.5, 0.5));
      const at = center.clone().addScaledVector(up, -s * 0.5);
      cards.push({ at, up, face, size: s, tile: TILE_FAR });
    }
  }
  return cards;
}

// One species / variant: [lod0, lod1, lod2] geometries (lod 2 only for variant 0)
function buildTreeGeometries(speciesIndex, variant, tileMeters) {
  const sp = SPECIES[speciesIndex];
  const seed = 7919 * (speciesIndex + 1) + 104729 * (variant + 1);
  const branches = growTree(sp, seed);

  // Crown from the full-detail foliage: card anchors pushed out by half a card
  const rngC = mulberry32(seed ^ 0x5bd1e995);
  const tips = [];
  for (const b of branches) if (b.level === 3) tips.push(b.pts[b.pts.length - 1]);
  const roughCrown = makeCrown(tips);
  const cards0 = placeCards(sp, branches, 0, tileMeters, rngC, roughCrown);
  const pts = [];
  for (const c of cards0) {
    pts.push(c.at.clone().addScaledVector(c.up, c.size * 0.5));
    pts.push(c.at.clone().addScaledVector(c.up, c.size));
  }
  const crown = makeCrown(pts);

  const geos = [];
  const levels = variant === 0 ? [0, 1, 2] : [0, 1];
  for (const lod of levels) {
    const gb = new TreeGeometryBuilder();
    const rng = mulberry32(seed + lod * 31337);
    const aoAt = (p) => crown.barkAO(p);
    // Bark: lod 0 everything, lod 1 trunk + limbs + branches (coarser), lod 2 trunk + limbs as thin prisms
    for (const b of branches) {
      if (lod === 0) {
        const radial = [9, 6, 4, 3][b.level];
        addTube(gb, b, radial, 1, aoAt, swayWeight);
      } else if (lod === 1 && b.level <= 2) {
        addTube(gb, b, [6, 5, 3][b.level], 2, aoAt, swayWeight);
      } else if (lod === 2 && b.level <= 1) {
        addTube(gb, b, b.level === 0 ? 5 : 3, b.level === 0 ? 4 : 6, aoAt, swayWeight);
      }
    }
    const cards = lod === 0 ? cards0 : placeCards(sp, branches, lod, tileMeters, rng, crown);
    for (const c of cards) addCard(gb, c.at, c.up, c.face, c.size, c.tile, rng() < 0.5, rng(), crown);
    const g = gb.build();
    g.userData = { species: sp.name, variant, lod, cards: cards.length, triangles: gb.idx.length / 3 };
    geos[lod] = g;
  }
  return geos;
}

// =====================================================================================================================
// 5. TREE FIELD: per-tree level of detail, with spatial cells culled separately in the view and shadow passes
// =====================================================================================================================
const TREE_CELL_SIZE = 200;
const LOD_HYSTERESIS = 6;

// The historical (high) profile. Every distance is in metres: full detail within lodNear, coarse cards & branches within
// lodMid, whole-crown cards to the draw distance, then hidden. Draw distance is per site tier (0 park & plaza, 1 wide
// street & leftover slab, 2 narrow street); at street level (camera below 40 m) streetCutoff caps it, because everything
// beyond it is behind the buildings anyway. lod1Variants 2 = both crown variants at LOD 1; 1 = variant 1 trees reuse
// variant 0 there. farSpecies null = every species keeps its own whole-crown geometry; a species index makes all species
// share that one geometry for LOD 2 (distant crowns are the far-canopy tile for every species).
const TREE_QUALITY_DEFAULT = {
  lodNear: 105,
  lodMid: 420,
  maxDist: [3000, 1600, 950],
  streetCutoff: 1150,
  lod1Variants: 2,
  farSpecies: null
};

// `trees` profile of the active graphics tier. main.js sets it once at boot, before street-details plants the trees:
// the field copies it when it builds, so the meshes and instance capacities match the profile (docs/rendering.md).
let treeQuality = TREE_QUALITY_DEFAULT;

function treeQualityProfile(settings = null) {
  const fallback = TREE_QUALITY_DEFAULT;
  const positive = (value, other) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : other);
  if (!settings) return { ...fallback, maxDist: fallback.maxDist.slice() };
  const maxDist = Array.isArray(settings.maxDist) && settings.maxDist.length === 3
    ? settings.maxDist.map((value, i) => positive(value, fallback.maxDist[i]))
    : fallback.maxDist.slice();
  return {
    lodNear: positive(settings.lodNear, fallback.lodNear),
    lodMid: positive(settings.lodMid, fallback.lodMid),
    maxDist,
    streetCutoff: positive(settings.streetCutoff, fallback.streetCutoff),
    lod1Variants: settings.lod1Variants === 1 ? 1 : 2,
    farSpecies: Number.isInteger(settings.farSpecies) && settings.farSpecies >= 0 && settings.farSpecies < SPECIES.length
      ? settings.farSpecies
      : null
  };
}

function configureTreeQuality(settings) {
  treeQuality = treeQualityProfile(settings);
}

function hashPos(x, y, z) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

// Reassign a seeded 4% of existing sites, without changing placement, scale or trunk colliders.
function treeSpecies(t) {
  return hashPos(t.x, 19.7, t.z) < 0.04 ? 3 : Math.min(3, Math.max(0, t.species || 0));
}

/**
 * Builds the instanced tree field for `sites` ({ x, y, z, scale, species, yaw?, sx?, sz?, tier? }) and keeps each
 * tree's level of detail up to date from the camera of every view pass (scene.onBeforeRender). Returns
 * { group, material, atlas, update(cameraPosition) }.
 */
function createTreeField(scene, sites) {
  const profile = treeQuality;
  const group = new THREE.Group();
  group.name = 'Trees';
  const atlas = createLeafAtlas();
  const material = createTreeMaterial(atlas.texture);

  // Geometries: [species][variant][lod]
  const geos = SPECIES.map((_, s) => [0, 1].map((v) => buildTreeGeometries(s, v, atlas.tileMeters)));

  // Per-tree transform & data
  const N = sites.length;
  const mats = new Float32Array(N * 16);
  const data = new Float32Array(N * 4);
  const px = new Float32Array(N);
  const py = new Float32Array(N);
  const pz = new Float32Array(N);
  const meshOf = new Int32Array(N * 3); // mesh index per level
  const cellOf = new Array(N);
  const tier = new Uint8Array(N);
  const lod = new Uint8Array(N).fill(255);

  // Shared geometry types: lod 0 & 1 per species & variant, lod 2 per species
  const types = [];
  const makeType = (geo, name) => {
    const height = Math.max(Math.abs(geo.boundingBox.min.y), Math.abs(geo.boundingBox.max.y));
    // The material adds wind after the instance transform: height-squared lean/rock, plus bob and flutter.
    const windPadding = Math.hypot(0.2, 0.06) * Math.hypot(0.86, 0.51) * (height / 11) ** 2 + 2;
    const type = { geo, name, windPadding, meshes: [] };
    types.push(type);
    return type;
  };
  // A low-tier profile may merge the two LOD-1 crown variants and/or make every species draw one whole-crown geometry:
  // fewer meshes per cell means fewer draw calls for the same trees (the instance buffers stay, see the note below).
  const sharedFar = profile.farSpecies === null ? null : makeType(
    geos[profile.farSpecies][0][2], `Trees_${SPECIES[profile.farSpecies].name}_lod2`);
  const meshIndex = SPECIES.map((sp, s) => ({
    l0: [0, 1].map((v) => makeType(geos[s][v][0], `Trees_${sp.name}_v${v}_lod0`)),
    l1: [0, 1].map((v) => (v === 1 && profile.lod1Variants === 1
      ? null
      : makeType(geos[s][v][1], `Trees_${sp.name}_v${v}_lod1`))),
    l2: sharedFar || makeType(geos[s][0][2], `Trees_${sp.name}_lod2`)
  }));
  const cells = new Map();
  const meshes = [];
  const counts = [];

  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  sites.forEach((t, i) => {
    const sp = treeSpecies(t);
    const r1 = hashPos(t.x, 1.3, t.z);
    const r2 = hashPos(t.z, 7.1, t.x);
    const r3 = hashPos(t.x + t.z, 3.3, 0.7);
    const variant = hashPos(t.x, 5.9, t.z) < 0.5 ? 0 : 1;
    const s = t.scale * (0.9 + r1 * 0.2);
    dummy.position.set(t.x, t.y || 0, t.z);
    dummy.rotation.set(0, t.yaw ?? r2 * Math.PI * 2, 0);
    dummy.scale.set(s * (0.9 + r3 * 0.2) * (t.sx || 1), s * (0.88 + r1 * 0.24), s * (0.9 + r2 * 0.2) * (t.sz || 1));
    dummy.updateMatrix();
    dummy.matrix.toArray(mats, i * 16);
    tint.setHex(SPECIES[sp].tints[Math.floor(r3 * 2.999)]).multiplyScalar(0.82 + r1 * 0.36);
    data.set([tint.r, tint.g, tint.b, sp + r2 * 0.999], i * 4);
    px[i] = t.x;
    py[i] = (t.y || 0) + 6 * s;
    pz[i] = t.z;
    tier[i] = Math.min(2, t.tier || 0);
    const key = Math.floor(t.x / TREE_CELL_SIZE) + ',' + Math.floor(t.z / TREE_CELL_SIZE);
    let cell = cells.get(key);
    if (!cell) {
      const cellGroup = new THREE.Group();
      cellGroup.name = `TreeCell_${key}`;
      cellGroup.visible = false;
      group.add(cellGroup);
      cell = { group: cellGroup, trees: [], meshes: new Map() };
      cells.set(key, cell);
    }
    cell.trees.push(i);
    cellOf[i] = cell;
    const mi = meshIndex[sp];
    const treeTypes = [mi.l0[variant], mi.l1[variant === 1 && profile.lod1Variants === 1 ? 0 : variant], mi.l2];
    for (let l = 0; l < 3; l++) {
      const type = treeTypes[l];
      let index = cell.meshes.get(type);
      if (index === undefined) {
        index = meshes.length;
        meshes.push({ type, cell, name: `${type.name}_${key}`, capacity: 0 });
        cell.meshes.set(type, index);
      }
      meshOf[i * 3 + l] = index;
      meshes[index].capacity++;
    }
  });

  const instanced = meshes.map((m) => {
    const geo = new THREE.BufferGeometry();
    for (const name of Object.keys(m.type.geo.attributes)) geo.setAttribute(name, m.type.geo.attributes[name]);
    geo.setIndex(m.type.geo.index);
    geo.boundingSphere = m.type.geo.boundingSphere;
    geo.boundingBox = m.type.geo.boundingBox;
    const cap = m.capacity;
    // Static usage on purpose: three.js re-uploads a DynamicDrawUsage attribute in every render pass of every frame
    // (both shadow cascades + the scene pass, ~7 MB/frame here). rebuild() uploads just the instances in use, and only
    // when the levels change.
    const treeData = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    geo.setAttribute('aTreeData', treeData);
    const mesh = new THREE.InstancedMesh(geo, material, cap);
    mesh.name = m.name;
    mesh.count = 0;
    mesh.visible = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    m.cell.group.add(mesh);
    m.type.meshes.push(mesh);
    counts.push(0);
    return mesh;
  });

  // Repack only cells whose trees changed level; the meshes and their buffer capacities stay fixed.
  const dirtyCells = new Set();
  function rebuild() {
    for (const cell of dirtyCells) {
      for (const mi of cell.meshes.values()) counts[mi] = 0;
      for (const i of cell.trees) {
        const l = lod[i];
        if (l === 255) continue;
        const mi = meshOf[i * 3 + l];
        const mesh = instanced[mi];
        const c = counts[mi]++;
        mesh.instanceMatrix.array.set(mats.subarray(i * 16, i * 16 + 16), c * 16);
        mesh.geometry.attributes.aTreeData.array.set(data.subarray(i * 4, i * 4 + 4), c * 4);
      }
      let visible = false;
      for (const mi of cell.meshes.values()) {
        const mesh = instanced[mi];
        const n = counts[mi];
        mesh.count = n;
        mesh.visible = n > 0;
        if (n > 0) {
          visible = true;
          // main.js swaps instanceMatrix for a storage attribute: look it up here on every changed cell.
          for (const attr of [mesh.instanceMatrix, mesh.geometry.attributes.aTreeData]) {
            attr.clearUpdateRanges();
            attr.addUpdateRange(0, n * attr.itemSize);
            attr.needsUpdate = true;
          }
          mesh.computeBoundingSphere();
          mesh.boundingSphere.radius += meshes[mi].type.windPadding;
        }
      }
      // Hidden cells avoid traversing all their dormant species/variant/LOD meshes in every render pass.
      cell.group.visible = visible;
    }
    dirtyCells.clear();
  }

  // Levels from the camera position (3D distance to mid-crown), with hysteresis at every boundary
  const last = new V3(Infinity, Infinity, Infinity);
  const cam = new V3();
  function update(position) {
    cam.copy(position);
    if (cam.distanceToSquared(last) < 16) return false;
    last.copy(cam);
    const low = cam.y < 40;
    let changed = false;
    for (let i = 0; i < N; i++) {
      const dx = px[i] - cam.x;
      const dy = py[i] - cam.y;
      const dz = pz[i] - cam.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const maxD = low ? Math.min(profile.maxDist[tier[i]], profile.streetCutoff) : profile.maxDist[tier[i]];
      // levels 0-2, 3 = hidden; next to a boundary a tree keeps the level it has
      const curL = lod[i] === 255 ? 3 : lod[i];
      let nextL = d < profile.lodNear ? 0 : d < profile.lodMid ? 1 : d < maxD ? 2 : 3;
      if (Math.abs(nextL - curL) === 1) {
        const edge = [profile.lodNear, profile.lodMid, maxD][Math.min(nextL, curL)];
        if (Math.abs(d - edge) < LOD_HYSTERESIS) nextL = curL;
      }
      const next = nextL === 3 ? 255 : nextL;
      if (next !== lod[i]) {
        lod[i] = next;
        dirtyCells.add(cellOf[i]);
        changed = true;
      }
    }
    if (changed) rebuild();
    return changed;
  }

  // Follow the view camera of every scene render (shadow cascades are orthographic and keep the view's levels)
  const viewPos = new V3();
  const prevBeforeRender = scene.onBeforeRender;
  scene.onBeforeRender = function (renderer, scn, camera, target) {
    prevBeforeRender.call(this, renderer, scn, camera, target);
    if (camera.isOrthographicCamera === true || camera.isArrayCamera === true) return;
    update(viewPos.setFromMatrixPosition(camera.matrixWorld));
  };

  // Levels for the start-up view (Stary Rynek, south of the Ratusz), so the precompile pass sees the tree meshes
  update(new V3(0, 10, 140));

  // Precompile one visible representative per geometry; the other cells use exactly the same pipeline.
  for (const type of types) {
    const representative = type.meshes.find((mesh) => mesh.visible) || type.meshes[0];
    for (const mesh of type.meshes) if (mesh !== representative) mesh.userData.sharesPipelineWith = representative;
  }

  // Tree placements are world-space instance matrices; the field, cells and meshes keep identity transforms.
  // Freezing both avoids recomputing thousands of dormant objects in every view and shadow pass.
  group.traverse((object) => {
    object.matrixAutoUpdate = false;
    object.matrixWorldAutoUpdate = false;
  });

  const stats = {
    trees: N,
    triangles: geos.map((v) => v.map((l) => l.map((g) => g && g.userData.triangles))),
    cards: geos.map((v) => v.map((l) => l.map((g) => g && g.userData.cards)))
  };
  return { group, material, atlas, update, meshes: instanced, stats };
}

export {
  createTreeField,
  createLeafAtlas,
  buildTreeGeometries,
  coverageMips,
  treeSpecies,
  configureTreeQuality,
  treeQualityProfile,
  TREE_QUALITY_DEFAULT,
  SPECIES as TREE_SPECIES,
  SPECIES_CROWN_R
};
