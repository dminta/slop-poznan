import { CROSSWALK, CROSSWALK_REACH } from './road-network.js';

// Small, lazily connected sidewalk tracks. Junctions only connect points on the same curb island;
// crossing the roadway is a separate, signal-controlled track owned by traffic.js, on the crosswalks laid out here once
// for the whole network (the zebras road-paint.js paints).
function createPedestrianRoutes({ nodes = [], edges = [], walkable }, blockAt) {
  const sidewalks = new Map(), crossings = new Map(), junctions = new Map(), connections = new WeakMap();
  const point = (track, end) => ({ x: track.ax + track.ux * track.len * end, z: track.az + track.uz * track.len * end });
  const segment = (a, b, extra = {}) => {
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    return { ax: a.x, az: a.z, ux: (b.x - a.x) / len, uz: (b.z - a.z) / len,
      len, node: null, side: 0, group: 0, line: 0, ...extra };
  };

  function clear(a, b, block = null) {
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z)));
    let x = a.x, z = a.z;
    for (let i = 0; i <= steps; i++) {
      const nx = a.x + (b.x - a.x) * i / steps, nz = a.z + (b.z - a.z) * i / steps;
      if (!walkable(Math.min(x, nx) - 0.4, Math.max(x, nx) + 0.4, Math.min(z, nz) - 0.4, Math.max(z, nz) + 0.4)) return false;
      if (block && blockAt(nx, nz) !== block) return false;
      x = nx; z = nz;
    }
    return true;
  }

  function along(e) {
    if (sidewalks.has(e)) return sidewalks.get(e);
    const result = [];
    sidewalks.set(e, result);
    // Two walking lines on each side leave room for people to pass or stop together.
    for (const sign of [-1, 1]) {
      for (const inset of [1.7, 2.8]) {
        const off = sign * (e.half + inset);
        const a = { x: e.sx + e.rx * off, z: e.sz + e.rz * off };
        const b = { x: a.x + e.dx * e.len, z: a.z + e.dz * e.len };
        const block = blockAt(a.x, a.z);
        if (!block || blockAt(b.x, b.z) !== block || !clear(a, b, block)) continue;
        result.push(segment(a, b, { edge: e, from: e.from, to: e.to, block }));
      }
    }
    return result;
  }

  // Crosswalks: at most one per junction arm (road-network.js step 7), at the band road-paint.js paints its zebra on
  // (CROSSWALK deep, next to the intersection, the edges' setbackFrom/To beyond their stop lines) and along the lateral
  // axis of the arm's road (clx/clz of its edge in, else out, the axis traffic.js measures lanes and walkers on). People
  // cross there with priority over turning and arriving traffic. They are laid out for the whole network at once (when
  // the routes are created, ~50 ms), since one junction's crosswalks can run into its neighbours', and they are the one
  // list road-paint.js paints its zebras from (`crosswalks`), so nobody crosses where no zebra is painted and no zebra
  // lies where nobody crosses. An arm gets one where:
  // - its node is a junction: a bend (shape node) has no corner and no crosswalk;
  // - both ends reach a curb island (`blockAt`: a sidewalk, a median or a tram island) within CROSSWALK_REACH of the
  //   curbs its edges' half width puts there, and land 2 m onto it: the zebra runs curb to curb, on to the real curb
  //   where the road model falls short of it (a merged junction's arm, a divided road), and a crosswalk ending in the
  //   roadway (inside a junction complex of short links, or by an open square with no curb) is none;
  // - the walk there is clear of obstacles (`walkable`: street furniture, buildings);
  // - its zebra lies on no other road's run, stop line to stop line, where cars queue;
  // - its zebra overlaps no zebra of a crosswalk kept before it, the arms of the longest roads first, so where the
  //   short links between the nodes of a junction complex (a divided road's or a tram corridor's corners) put zebras
  //   on top of each other or across each other, the ones on its outer approaches stay.
  const ZEBRA_HALF = (CROSSWALK - 0.3) / 2; // the painted zebra, 0.15 m inside the CROSSWALK band
  function reach(x, z, dx, dz) {
    for (let d = 0; d <= CROSSWALK_REACH; d += 0.25) if (blockAt(x + dx * d, z + dz * d)) return d;
    return -1;
  }
  function crosswalkOf(n, arm) {
    const road = arm.in || arm.out;
    const cx = road.clx, cz = road.clz, k = road.dx * arm.ux + road.dz * arm.uz > 0 ? 1 : -1;
    const ux = road.dx * k, uz = road.dz * k; // out of the junction, square to the crosswalk
    // depth of its centre line from n (the nearer band where its two edges stop at different depths, so the one zebra
    // keeps off both edges' lanes), and its span curb to curb (both roadways of a divided road)
    let depth = Infinity, lo = Infinity, hi = -Infinity, span = 0;
    for (const e of [arm.in, arm.out]) {
      if (!e) continue;
      const s = e === arm.in ? e.len + e.setbackTo + CROSSWALK / 2 : -e.setbackFrom - CROSSWALK / 2;
      const x = e.sx + e.dx * s, z = e.sz + e.dz * s, c = x * cx + z * cz;
      depth = Math.min(depth, (x - n.x) * ux + (z - n.z) * uz);
      lo = Math.min(lo, c - e.half);
      hi = Math.max(hi, c + e.half);
      span = Math.max(span, e.span ?? e.len);
    }
    const along = n.x * ux + n.z * uz + depth;
    const at = (c) => ({ x: cx * c + ux * along, z: cz * c + uz * along });
    const curb0 = at(lo), curb1 = at(hi);
    const d0 = reach(curb0.x, curb0.z, -cx, -cz), d1 = reach(curb1.x, curb1.z, cx, cz);
    if (d0 < 0 || d1 < 0) return null;
    lo -= d0;
    hi += d1;
    const tracks = [];
    // one line over the widest road (group 0), set back from the box; two over the others
    for (const line of arm.group === 0 ? [0.75] : [-0.75, 0.75]) {
      const a = { x: cx * (lo - 2) + ux * (along + line), z: cz * (lo - 2) + uz * (along + line) };
      const b = { x: a.x + cx * (hi - lo + 4), z: a.z + cz * (hi - lo + 4) };
      if (!blockAt(a.x, a.z) || !blockAt(b.x, b.z)) continue;
      if (!clear(a, b)) continue;
      tracks.push(segment(a, b, { node: n, side: arm.side, group: arm.group, line, from: n, to: n }));
    }
    if (!tracks.length) return null;
    const a = at(lo), b = at(hi);
    return { node: n, side: arm.side, group: arm.group, ax: a.x, az: a.z, bx: b.x, bz: b.z, h: ZEBRA_HALF, ux, uz, span,
      tracks };
  }
  // Rectangles { ax, az, bx, bz, h }: h either side of the line a-b. Two overlap when no side of either separates them;
  // two that only touch don't (at an acute fork, the zebras of its two roads may meet at a corner)
  function corners(r) {
    const L = Math.hypot(r.bx - r.ax, r.bz - r.az) || 1, px = -(r.bz - r.az) / L * r.h, pz = (r.bx - r.ax) / L * r.h;
    return [[r.ax - px, r.az - pz], [r.ax + px, r.az + pz], [r.bx + px, r.bz + pz], [r.bx - px, r.bz - pz]];
  }
  function overlap(p, q) {
    const P = p.corners || (p.corners = corners(p)), Q = q.corners || (q.corners = corners(q));
    for (const R of [P, Q]) {
      for (let i = 0; i < 2; i++) {
        const ax = R[i + 1][0] - R[i][0], az = R[i + 1][1] - R[i][1];
        let p0 = Infinity, p1 = -Infinity, q0 = Infinity, q1 = -Infinity;
        for (const [x, z] of P) { const d = x * ax + z * az; p0 = Math.min(p0, d); p1 = Math.max(p1, d); }
        for (const [x, z] of Q) { const d = x * ax + z * az; q0 = Math.min(q0, d); q1 = Math.max(q1, d); }
        if (p1 <= q0 || q1 <= p0) return false;
      }
    }
    return true;
  }
  // Calls fn(key) for each 32 m cell under r's bounds until it returns true
  function cells(r, fn) {
    const x0 = Math.floor((Math.min(r.ax, r.bx) - r.h) / 32), x1 = Math.floor((Math.max(r.ax, r.bx) + r.h) / 32);
    const z0 = Math.floor((Math.min(r.az, r.bz) - r.h) / 32), z1 = Math.floor((Math.max(r.az, r.bz) + r.h) / 32);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) if (fn(ix * 100000 + iz)) return true;
    return false;
  }
  const file = (grid, r) => cells(r, (k) => {
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(r);
  });
  // anything filed in grid overlapping r, but the edges of arm `own`
  const hits = (grid, r, own = null) => cells(r, (k) => (grid.get(k) || []).some((o) =>
    (!own || (o.e !== own.in && o.e !== own.out)) && overlap(r, o)));
  const crosswalks = [];
  function layOut() {
    if (crossings.size) return;
    // the roads' runs, stop line to stop line, where their lanes are: no zebra of another arm on them
    const runs = new Map();
    for (const e of edges) {
      file(runs, { e, ax: e.sx, az: e.sz, bx: e.sx + e.dx * e.len, bz: e.sz + e.dz * e.len, h: e.half });
    }
    const found = [];
    for (const n of nodes) {
      crossings.set(n, []);
      if (n.shape) continue;
      for (const arm of n.arms) {
        const c = crosswalkOf(n, arm);
        if (c && !hits(runs, c, arm)) found.push(c);
      }
    }
    found.sort((p, q) => q.span - p.span);
    const kept = new Map();
    for (const c of found) {
      if (hits(kept, c)) continue;
      file(kept, c);
      crosswalks.push(c);
      crossings.get(c.node).push(...c.tracks);
    }
  }
  function across(n) {
    layOut();
    return crossings.get(n) || [];
  }

  function ports(n) {
    if (junctions.has(n)) return junctions.get(n);
    const result = [], seen = new Set();
    junctions.set(n, result);
    for (const e of [...n.in, ...n.out]) {
      if (seen.has(e)) continue;
      seen.add(e);
      for (const track of along(e)) result.push({ track, end: e.from === n ? 0 : 1 });
    }
    for (const track of across(n)) result.push({ track, end: 0 }, { track, end: 1 });
    return result;
  }

  // Stay in the sidewalk band even where angled building colliders are deliberately omitted from the road graph.
  function cornerClear(a, b, block) {
    if (!clear(a, b, block)) return false;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z)));
    for (let i = 0; i <= steps; i++) {
      const x = a.x + (b.x - a.x) * i / steps, z = a.z + (b.z - a.z) * i / steps;
      let distance = Infinity;
      for (let j = 0, k = block.poly.length - 1; j < block.poly.length; k = j++) {
        const p = block.poly[j], q = block.poly[k], dx = q.x - p.x, dz = q.z - p.z;
        const t = Math.max(0, Math.min(1, ((x - p.x) * dx + (z - p.z) * dz) / (dx * dx + dz * dz || 1)));
        distance = Math.min(distance, Math.hypot(x - p.x - dx * t, z - p.z - dz * t));
      }
      if (distance > 4) return false;
    }
    return true;
  }

  function links(track, dir) {
    let ends = connections.get(track);
    if (!ends) connections.set(track, ends = []);
    const end = dir > 0 ? 1 : 0;
    if (ends[end]) return ends[end];
    const result = ends[end] = [];
    const n = end ? track.to : track.from;
    if (!n) return result;
    const a = point(track, end), block = blockAt(a.x, a.z);
    if (!block) return result;
    for (const port of ports(n)) {
      const next = port.track, nextDir = port.end ? -1 : 1;
      if (next === track) continue;
      const b = point(next, port.end), distance = Math.hypot(b.x - a.x, b.z - a.z);
      if (distance > 32 || blockAt(b.x, b.z) !== block) continue;
      const path = [];
      if (distance > 0.01) {
        if (cornerClear(a, b, block)) {
          path.push({ track: segment(a, b), dir: 1 });
        } else {
          // Meeting the two offset sidewalk lines rounds the curb instead of cutting diagonally through a lot.
          const ax = track.ux * dir, az = track.uz * dir, bx = next.ux * nextDir, bz = next.uz * nextDir;
          const cross = ax * bz - az * bx;
          if (Math.abs(cross) < 0.2) continue;
          const t = ((b.x - a.x) * bz - (b.z - a.z) * bx) / cross;
          const c = { x: a.x + ax * t, z: a.z + az * t };
          if (t < 0 || t > 20 || (b.x - c.x) * bx + (b.z - c.z) * bz < 0 || Math.hypot(b.x - c.x, b.z - c.z) > 20) continue;
          if (!cornerClear(a, c, block) || !cornerClear(c, b, block)) continue;
          if (t > 0.01) path.push({ track: segment(a, c), dir: 1 });
          if (Math.hypot(b.x - c.x, b.z - c.z) > 0.01) path.push({ track: segment(c, b), dir: 1 });
        }
      }
      path.push({ track: next, dir: nextDir });
      result.push(path);
    }
    return result;
  }

  function next(track, dir, goalX, goalZ) {
    let best = null, bestScore = -Infinity;
    const a = point(track, dir > 0 ? 1 : 0);
    const gx = goalX - a.x, gz = goalZ - a.z, distance = Math.hypot(gx, gz) || 1;
    for (const path of links(track, dir)) {
      const last = path[path.length - 1], target = last.track;
      const ux = target.ux * last.dir, uz = target.uz * last.dir;
      const back = ux * track.ux * dir + uz * track.uz * dir < -0.8;
      const score = (ux * gx + uz * gz) / distance + Math.random() * 0.7 - (back ? 2 : 0);
      if (score > bestScore) { best = path; bestScore = score; }
    }
    return best;
  }

  // every crosswalk kept, for road-paint.js: { node, side, group, ax, az, bx, bz (the zebra's ends, at the curbs),
  // ux, uz (out of the junction), span, tracks }
  layOut();
  return { along, across, next, crosswalks };
}

export { createPedestrianRoutes };
