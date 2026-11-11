// The boot-only spatial indexes added in the 2026-11-11 load pass: the block outline edge grid (buildings.js
// outlineRay), the bridge corridor AABB reject, the tram segment-grid bbox reject, the pole cell lookup, and the
// street-details curb edge grid (blockCurbDist / nearestCurbFrame). Each index may only choose which items the
// unchanged arithmetic sees: same answers as the plain scan on vertices, edges, ties and +-1 um neighbours.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const read = (name) => readFileSync(join(__dirname, '../js', name), 'utf8');
const cut = (source, start, end) => {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0, `missing start marker: ${start.slice(0, 40)}`);
  assert.ok(b > a, `missing end marker: ${end.slice(0, 40)}`);
  return source.slice(a, b);
};

const plainRay = (poly, x, z, nx, nz) => {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j];
    const ex = poly[i].x - a.x;
    const ez = poly[i].z - a.z;
    const den = nx * ez - nz * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((a.x - x) * ez - (a.z - z) * ex) / den;
    const u = ((a.x - x) * nz - (a.z - z) * nx) / den;
    if (t > 0 && u >= 0 && u <= 1 && t < best) best = t;
  }
  return best;
};

const plainDist = (poly, x, z) => {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j];
    const c = poly[i];
    const dx = c.x - a.x;
    const dz = c.z - a.z;
    const L2 = dx * dx + dz * dz;
    let t = L2 > 0 ? ((x - a.x) * dx + (z - a.z) * dz) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = a.x + t * dx - x;
    const ez = a.z + t * dz - z;
    const d = ex * ex + ez * ez;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
};

const DIRECTIONS = [[1, 0], [0, 1], [-1, 0], [0, -1], [0.6, 0.8], [-0.6, 0.8], [0.8, -0.6], [-0.8, -0.6]];

test('outlineRay edge grid matches the plain ray cast; distances stay a full scan', async () => {
  const { BLOCKS } = await import('../js/city-config.js');
  const slice = cut(read('buildings.js'), '  const FRONT_REACH = 10;',
    "  // World point (x, z) inside one of the source block's lot rects");
  const context = vm.createContext({ Math, Infinity, srcBlock: null });
  const { outlineRay, outlineDist } = vm.runInContext(`${slice}\n;({ outlineRay, outlineDist })`, context);
  const blocks = BLOCKS.filter((b, i) => i % 7 === 0 || b.poly.length > 300).slice(0, 400);
  let compared = 0;
  for (const b of blocks) {
    context.srcBlock = b;
    const poly = b.poly;
    for (let i = 0; i < poly.length; i += Math.max(1, Math.floor(poly.length / 12))) {
      const a = poly[i], c = poly[(i + 1) % poly.length];
      for (const t of [0, 0.5]) {
        const x = a.x + (c.x - a.x) * t, z = a.z + (c.z - a.z) * t;
        for (const d of [0, -1e-6, 1e-6]) {
          for (const [nx, nz] of DIRECTIONS) {
            const expected = plainRay(poly, x + d, z, nx, nz);
            const actual = outlineRay(x + d, z, nx, nz);
            if (expected <= 18) assert.equal(actual, expected, `block ${b.id} ray at ${x + d},${z} dir ${nx},${nz}`);
            else assert.equal(actual, Infinity, `block ${b.id} far ray at ${x + d},${z} dir ${nx},${nz}`);
            compared++;
            const wantDist = plainDist(poly, x, z + d);
            assert.equal(outlineDist(x, z + d), wantDist, `block ${b.id} distance at ${x},${z + d}`);
            compared++;
          }
        }
      }
    }
  }
  assert.ok(compared > 50000, `compared ${compared} outline samples`);
});

test('a synthetic outline keeps the ray grid exact on cell boundaries and long edges', () => {
  const slice = cut(read('buildings.js'), '  const FRONT_REACH = 10;',
    "  // World point (x, z) inside one of the source block's lot rects");
  const poly = [];
  // a 500 m square with an extra collinear edge and a vertex exactly on a cell line
  const side = [0, 0.5, 7, 8, 16, 17.25, 100, 300, 500];
  for (const t of side) poly.push({ x: t, z: 0 });
  for (const t of side) poly.push({ x: 500, z: t });
  for (const t of [...side].reverse()) poly.push({ x: t, z: 500 });
  for (const t of [...side].reverse()) poly.push({ x: 0, z: t });
  const context = vm.createContext({ Math, Infinity, srcBlock: { poly } });
  const { outlineRay } = vm.runInContext(`${slice}\n;({ outlineRay })`, context);
  let compared = 0;
  for (const t of side) {
    for (const d of [0, -1e-6, 1e-6]) {
      for (const [nx, nz] of DIRECTIONS) {
        for (const [x, z] of [[t, d], [t, 500 + d], [d, t], [500 + d, t], [t * 0.7, 250]]) {
          const expected = plainRay(poly, x, z, nx, nz);
          const actual = outlineRay(x, z, nx, nz);
          if (expected <= 18) assert.equal(actual, expected);
          else assert.equal(actual, Infinity);
          compared++;
        }
      }
    }
  }
  assert.ok(compared > 500);
});

test('the bridge corridor AABB reject keeps every SAT answer', async () => {
  const { BRIDGES } = await import('../js/city-config.js');
  const source = read('buildings.js');
  const toWorldSrc = cut(source, '  const toWorld = (x, z) => (xf', '  const toFrame =');
  const slice = cut(source, '  const bridgeCorridors = [];', '  const SIDES = ');
  const context = vm.createContext({ Math, Infinity, xf: null, BRIDGES });
  vm.runInContext(`${toWorldSrc}\n${slice}\n;({ hitsBridgeCorridor })`, context);

  const plainCorridors = [];
  for (const bridge of BRIDGES) {
    for (const link of bridge.links) {
      for (let i = 0; i + 1 < link.pts.length; i++) {
        const a = link.pts[i], c = link.pts[i + 1];
        const L = Math.hypot(c.x - a.x, c.z - a.z);
        if (L < 0.1) continue;
        plainCorridors.push({
          cx: (a.x + c.x) * 0.5, cz: (a.z + c.z) * 0.5, ux: (c.x - a.x) / L, uz: (c.z - a.z) / L,
          hl: L * 0.5 + 4, hw: link.width * 0.5 + 3
        });
      }
    }
  }
  const toWorld = (frame, x, z) => (frame
    ? [frame.px + (x - frame.px) * frame.cs + (z - frame.pz) * frame.sn,
      frame.pz - (x - frame.px) * frame.sn + (z - frame.pz) * frame.cs]
    : [x, z]);
  const plainHits = (x0, x1, z0, z1, frame) => {
    const hx = (x1 - x0) * 0.5, hz = (z1 - z0) * 0.5;
    const [cx, cz] = toWorld(frame, x0 + hx, z0 + hz);
    const ax = frame ? frame.cs : 1, az = frame ? -frame.sn : 0;
    const bx = frame ? frame.sn : 0, bz = frame ? frame.cs : 1;
    for (const o of plainCorridors) {
      const dx = cx - o.cx, dz = cz - o.cz;
      const vx = -o.uz, vz = o.ux;
      let apart = false;
      for (const [nx, nz] of [[ax, az], [bx, bz], [o.ux, o.uz], [vx, vz]]) {
        const r = hx * Math.abs(ax * nx + az * nz) + hz * Math.abs(bx * nx + bz * nz) +
          o.hl * Math.abs(o.ux * nx + o.uz * nz) + o.hw * Math.abs(vx * nx + vz * nz);
        if (Math.abs(dx * nx + dz * nz) >= r) { apart = true; break; }
      }
      if (!apart) return true;
    }
    return false;
  };
  const frames = [null, { th: 0.3, cs: Math.cos(0.3), sn: Math.sin(0.3), px: -1400, pz: 100 },
    { th: -0.7, cs: Math.cos(-0.7), sn: Math.sin(-0.7), px: 0, pz: 0 }];
  let seed = 7;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const hitsBridgeCorridor = vm.runInContext('hitsBridgeCorridor', context);
  let hits = 0;
  let compared = 0;
  const check = (x0, x1, z0, z1, frame) => {
    context.xf = frame;
    const actual = hitsBridgeCorridor(x0, x1, z0, z1);
    const expected = plainHits(x0, x1, z0, z1, frame);
    assert.equal(actual, expected, `rect ${x0},${x1},${z0},${z1} frame ${frame ? frame.th : 'world'}`);
    hits += actual ? 1 : 0;
    compared++;
  };
  // rectangles centred on real corridors, just inside, straddling and just outside their decks (frame coordinates)
  for (const o of plainCorridors) {
    for (const h of [0.5, 3, 9, 20]) {
      for (const frame of frames) check(o.cx - h, o.cx + h, o.cz - h, o.cz + h, frame);
    }
  }
  // random rects around the bridges and across the city
  for (let i = 0; i < 20000; i++) {
    const frame = frames[i % frames.length];
    const o = plainCorridors[Math.floor(rnd() * plainCorridors.length)];
    const cx = o.cx + (rnd() - 0.5) * 120, cz = o.cz + (rnd() - 0.5) * 120;
    const hx = 0.5 + rnd() * 40, hz = 0.5 + rnd() * 40;
    check(cx - hx, cx + hx, cz - hz, cz + hz, frame);
  }
  for (let i = 0; i < 5000; i++) {
    const frame = frames[i % frames.length];
    const cx = -4000 + rnd() * 9000, cz = -4000 + rnd() * 9000;
    const hx = 0.5 + rnd() * 60, hz = 0.5 + rnd() * 60;
    check(cx - hx, cx + hx, cz - hz, cz + hz, frame);
  }
  assert.ok(hits > 100, `the sampled rects include ${hits} deck hits`);
  assert.ok(compared > 20000);
});

test('the segment grid bbox reject keeps the same nearest segment', () => {
  const source = read('tram-infra.js');
  const slice = cut(source, 'function segmentGrid(cell = 24, walk = false) {', '\n// Distance to the nearest car lane');
  const reject = '            const lim = bestD + 1e-9;\n' +
    '            if (x < sg.x0 - lim || x > sg.x1 + lim || z < sg.z0 - lim || z > sg.z1 + lim) continue;\n';
  assert.ok(slice.includes(reject), 'segment-grid reject marker moved');
  const plain = slice.replace(reject, '');
  const fastContext = vm.createContext({ Math, Infinity });
  const plainContext = vm.createContext({ Math, Infinity });
  const fast = vm.runInContext(`${slice}\n;segmentGrid`, fastContext);
  const slow = vm.runInContext(`${plain}\n;segmentGrid`, plainContext);
  const a = fast(24), b = slow(24);
  let seed = 11;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const segments = [];
  for (let i = 0; i < 400; i++) {
    const ax = -400 + rnd() * 800, az = -400 + rnd() * 800;
    const len = rnd() < 0.1 ? 0 : 0.5 + rnd() * 120;
    const ang = rnd() * Math.PI;
    segments.push([ax, az, ax + Math.cos(ang) * len, az + Math.sin(ang) * len, i]);
  }
  // exact zero-length and axis-aligned segments, and one on a cell line
  segments.push([0, 0, 0, 0, 400], [24, 24, 24, 240, 401], [-24, 48, 24, 48, 402]);
  for (const s of segments) {
    a.add(s[0], s[1], s[2], s[3], s[4]);
    b.add(s[0], s[1], s[2], s[3], s[4]);
  }
  let compared = 0;
  for (let i = 0; i < 30000; i++) {
    const x = -450 + rnd() * 900, z = -450 + rnd() * 900;
    const r = 0.25 + rnd() * 45;
    const accept = i % 5 === 0 ? (sg) => sg.data % 3 !== 0 : null;
    const ha = a.nearest(x, z, r, accept);
    const hb = b.nearest(x, z, r, accept);
    if (!ha) {
      assert.equal(hb, null, `nearest at ${x},${z} r ${r}`);
    } else {
      assert.ok(hb, `nearest missing at ${x},${z} r ${r}`);
      assert.deepEqual(
        [ha.seg.ax, ha.seg.az, ha.seg.bx, ha.seg.bz, ha.seg.data, ha.d, ha.t, ha.qx, ha.qz],
        [hb.seg.ax, hb.seg.az, hb.seg.bx, hb.seg.bz, hb.seg.data, hb.d, hb.t, hb.qx, hb.qz],
        `nearest at ${x},${z} r ${r}`);
    }
    compared++;
  }
  assert.ok(compared > 20000);
});

test('the pole cell lookup returns the pole the linear scan found first', () => {
  const slice = cut(read('tram-infra.js'), '  const poleCells = new Map();\n  const poleCellKey',
    '  // March out from the track');
  const make = () => {
    const context = vm.createContext({ Math, poles: [] });
    const poleAt = vm.runInContext(`${slice}\n;poleAt`, context);
    return { context, poleAt };
  };
  const fast = make(), slow = make();
  const plainPoleAt = (poles, x, z, h) => {
    for (const q of poles) if (Math.abs(q.x - x) < 1.2 && Math.abs(q.z - z) < 1.2) return q;
    const q = { x, z, h };
    poles.push(q);
    return q;
  };
  let seed = 3;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  let compared = 0;
  for (let i = 0; i < 5000; i++) {
    let x, z;
    if (i % 4 === 0 && fast.context.poles.length) {
      const q = fast.context.poles[Math.floor(rnd() * fast.context.poles.length)];
      x = q.x + (rnd() - 0.5) * 3;
      z = q.z + (rnd() - 0.5) * 3;
    } else {
      x = -20 + rnd() * 40;
      z = -20 + rnd() * 40;
    }
    const h = 6 + rnd();
    const qa = fast.poleAt(x, z, h);
    const qb = plainPoleAt(slow.context.poles, x, z, h);
    assert.deepEqual([qa.x, qa.z, qa.h], [qb.x, qb.z, qb.h], `pole at ${x},${z}`);
    compared++;
  }
  const poleRows = (poles) => poles.map((q) => [q.x, q.z, q.h]);
  assert.deepEqual(poleRows(fast.context.poles), poleRows(slow.context.poles));
  assert.ok(fast.context.poles.length > 100, `${fast.context.poles.length} poles placed`);
  assert.ok(compared > 4000);
});

test('the curb edge grid gives the same nearest frame and reach answer', async () => {
  const { BLOCKS } = await import('../js/city-config.js');
  const source = read('street-details.js');
  const distSrc = cut(source, '  const distPointToSeg = (px, pz, ax, az, bx, bz) => {', '  const curbEdgeIndexes');
  const indexSrc = cut(source, '  const curbEdgeIndexes = new Map();', '  // With a reach the answer');
  const reachSrc = cut(source, '  const blockCurbDist = (px, pz, b, reach = 0) => {', '  // Design choice:');
  const frameSrc = cut(source, '  const nearestCurbFrame = (b, x, z) => {', '  const parkCollider = ');
  const context = vm.createContext({ Math, Infinity });
  const api = vm.runInContext(
    `${distSrc}\n${indexSrc}\n${reachSrc}\n${frameSrc}\n;({ blockCurbDist, nearestCurbFrame })`, context);
  const plainDistToSeg = (px, pz, ax, az, bx, bz) => {
    const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz;
    if (len2 < 1e-12) return Math.hypot(px - ax, pz - az);
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2));
    return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
  };
  const plainCurbDist = (px, pz, b) => {
    let best = Infinity;
    for (let i = 0; i < b.poly.length; i++) {
      const p1 = b.poly[i], p2 = b.poly[(i + 1) % b.poly.length];
      const d = plainDistToSeg(px, pz, p1.x, p1.z, p2.x, p2.z);
      if (d < best) best = d;
    }
    if (b.tramCut) {
      for (const [ax, az, bx, bz] of b.tramCut.segs) {
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 1e-6) continue;
        const half = b.tramCut.half;
        const ux = ((bx - ax) / len) * half, uz = ((bz - az) / len) * half;
        const quad = [
          { x: ax - ux + uz, z: az - uz - ux },
          { x: bx + ux + uz, z: bz + uz - ux },
          { x: bx + ux - uz, z: bz + uz + ux },
          { x: ax - ux - uz, z: az - uz + ux }
        ];
        for (let i = 0; i < 4; i++) {
          const q1 = quad[i], q2 = quad[(i + 1) % 4];
          const d = plainDistToSeg(px, pz, q1.x, q1.z, q2.x, q2.z);
          if (d < best) best = d;
        }
      }
    }
    return best;
  };
  const blockAt = () => null; // both paths ask it for the frame's facing; the stub keeps it out of the comparison
  const plainFrame = (b, x, z) => {
    let best = Infinity;
    let frame = { dist: Infinity, acrossX: true, narrow: false, pitRot: 0, squeeze: 0.82, tier: 1, grate: true, pitS: 1 };
    for (let i = 0; i < b.poly.length; i++) {
      const p0 = b.poly[i];
      const p1 = b.poly[(i + 1) % b.poly.length];
      const dx = p1.x - p0.x, dz = p1.z - p0.z;
      const len = Math.hypot(dx, dz);
      if (len < 1e-6) continue;
      const d = plainDistToSeg(x, z, p0.x, p0.z, p1.x, p1.z);
      if (d >= best) continue;
      let inx = -dz / len, inz = dx / len;
      const mx = (p0.x + p1.x) * 0.5, mz = (p0.z + p1.z) * 0.5;
      if (blockAt(mx + inx * 1.6, mz + inz * 1.6) !== b) { inx = -inx; inz = -inz; }
      const narrow = !!blockAt(mx - inx * 14, mz - inz * 14);
      best = d;
      frame = {
        dist: d, acrossX: Math.abs(dz) > Math.abs(dx), narrow, pitRot: Math.atan2(dx, dz),
        squeeze: narrow ? 0.7 : 0.82, tier: narrow ? 2 : 1, grate: !narrow, pitS: narrow ? 0.7 : 1
      };
    }
    return frame;
  };
  // the sliced functions call blockAt as a free variable
  context.blockAt = blockAt;
  const blocks = BLOCKS.filter((b) => b.poly.length >= 3).filter((b, i) => i % 25 === 0).slice(0, 80);
  const synthetic = [
    { poly: [{ x: 0, z: 0 }, { x: 40, z: 0 }, { x: 40, z: 0 }, { x: 40, z: 40 }, { x: 4, z: 40 }, { x: 4, z: 8 },
      { x: 0, z: 8 }] }
  ];
  let compared = 0;
  for (const b of [...blocks, ...synthetic]) {
    const seen = [];
    for (let i = 0; i < b.poly.length; i++) {
      const a = b.poly[i], c = b.poly[(i + 1) % b.poly.length];
      for (const t of [0, 0.5]) {
        for (const d of [0, -1e-6, 1e-6]) {
          seen.push([a.x + (c.x - a.x) * t + d, a.z + (c.z - a.z) * t]);
          seen.push([a.x + (c.x - a.x) * t, a.z + (c.z - a.z) * t + d]);
        }
      }
    }
    let seed = b.poly.length * 7 + 1;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let i = 0; i < 12; i++) seen.push([-10 + rnd() * 60, -10 + rnd() * 60]);
    for (const [x, z] of seen) {
      for (const reach of [0, 0.598, 0.7]) {
        const actual = api.blockCurbDist(x, z, b, reach);
        const expected = plainCurbDist(x, z, b);
        if (reach === 0) assert.equal(actual, expected, `curb distance ${x},${z}`);
        else assert.equal(actual < reach, expected < reach, `curb reach ${reach} at ${x},${z}`);
      }
      assert.deepEqual({ ...api.nearestCurbFrame(b, x, z) }, plainFrame(b, x, z), `frame at ${x},${z}`);
      compared += 4;
    }
  }
  assert.ok(compared > 100000, `compared ${compared} curb queries`);
});
