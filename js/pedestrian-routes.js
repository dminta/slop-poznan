import { CROSSWALK, CROSSWALK_REACH } from './road-network.js';

// Small, lazily connected sidewalk tracks. Junctions only connect points on the same curb island;
// crossing the roadway is a separate, signal-controlled track owned by traffic.js, on the crosswalks laid out here once
// for the whole network (the zebras road-paint.js paints).
// `railClearance(x, z, r)` (city-grid.js: the distance to the nearest track centreline, capped at r) keeps the places
// people wait on a split crossing's strip clear of the trams; without it every strip has room.
function createPedestrianRoutes({ nodes = [], edges = [], walkable }, blockAt, railClearance = null) {
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
  // A divided road's median or tram strip is often no curb island (blockAt) at all, only the gap between its two
  // roadways, which are separate edges with their own junction nodes (the Dworzec complex had no zebra). An end with no
  // island in reach may instead stop at such a strip (`refuge`): STRIP_MIN-STRIP_MAX wide up to the next roadway, which
  // runs along this one, and running on STRIP_RUN m out of the junction with no other road across it (in a junction
  // complex's middle, the gap between its short links, a crossing road closes it within a few metres). Its crosswalk is
  // then one of a split crossing: kept only together with the crosswalk over the other roadway that stops at the same
  // strip from the other side (STRIP_OFFSET m along the road at most), the two tracks linked over the strip (`links`),
  // where people wait for the second roadway as at any curb. The tracks go STRIP_LAND onto the strip, so the curb
  // queue (traffic.js KERB, 1.6 m along a track) stands on it.
  // A tram strip is the trams' way: a strip end has room to wait (`stand`) only where its curb and the STRIP_LAND
  // behind it keep RAIL_KEEP from every track (a tram body reaches ~1.7 m from the centreline with its sway, plus a
  // person). Where only one end of a pair has room, the people bound over the other roadway wait at that end, short
  // of the rails, and cross the tracks and the second roadway in one go (the refuge's `hold`; the cramped end is
  // `track.cramped[end]`, where nobody is spawned waiting); a pair with no room at either end is no split crossing.
  // Measured on the furnished network: of the 16 strip ends paired, 9 lay within 2 m of a track (4 within 0.6 m).
  const ZEBRA_HALF = (CROSSWALK - 0.3) / 2; // the painted zebra, 0.15 m inside the CROSSWALK band
  const STRIP_MIN = 3.2, STRIP_MAX = 14, STRIP_RUN = 15, STRIP_OFFSET = 12, STRIP_LAND = 1.6;
  const RAIL_KEEP = 2.0;
  // Room to wait at a strip end: from its curb at (x, z) inward along (wx, wz), STRIP_LAND clear of RAIL_KEEP
  const roomToWait = (x, z, wx, wz) => {
    if (!railClearance) return true;
    for (let d = 0; d <= STRIP_LAND + 1e-6; d += 0.2) {
      if (railClearance(x + wx * d, z + wz * d, RAIL_KEEP + 1) < RAIL_KEEP) return false;
    }
    return true;
  };
  const PARALLEL = Math.cos(30 * Math.PI / 180);
  function reach(x, z, dx, dz) {
    for (let d = 0; d <= CROSSWALK_REACH; d += 0.25) if (blockAt(x + dx * d, z + dz * d)) return d;
    return -1;
  }
  // The roadways node to node (x0, z0 along d for span, half wide), in 32 m cells, filed by layOut: the one under (x, z)
  // but the edges of `arm`, or null
  const ways = new Map();
  function wayAt(x, z, arm) {
    for (const w of ways.get(Math.floor(x / 32) * 100000 + Math.floor(z / 32)) || []) {
      const e = w.e;
      if (e === arm.in || e === arm.out) continue;
      const s = (x - e.x0) * e.dx + (z - e.z0) * e.dz;
      if (s >= 0 && s <= e.span && Math.abs((x - e.x0) * e.rx + (z - e.z0) * e.rz) < e.half) return e;
    }
    return null;
  }
  // From the curb at (x, z), across along (wx, wz), with the arm's road along (ux, uz) out of the junction: the strip's
  // width up to the next roadway, or -1
  function refuge(x, z, wx, wz, ux, uz, arm) {
    let w = -1;
    for (let d = 0.25; d <= STRIP_MAX; d += 0.25) {
      const e = wayAt(x + wx * d, z + wz * d, arm);
      if (!e) continue;
      if (Math.abs(e.dx * ux + e.dz * uz) < PARALLEL) return -1; // a crossing road: the corner, not a strip
      w = d - 0.25;
      break;
    }
    if (w < STRIP_MIN) return -1;
    const mx = x + wx * w / 2, mz = z + wz * w / 2;
    for (let s = 1; s <= STRIP_RUN; s++) {
      const e = wayAt(mx + ux * s, mz + uz * s, arm);
      if (e && Math.abs(e.dx * ux + e.dz * uz) < PARALLEL) return -1;
    }
    return w;
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
    // one line over the widest road (group 0), set back from the box; two over the others
    const lines = arm.group === 0 ? [0.75] : [-0.75, 0.75];
    // Each end: on a curb island d m past the curb (the walk landing 2 m onto it), else at a strip w wide (the zebra
    // still running on to an island in reach, the walk landing STRIP_LAND past it, short of the strip's middle), else
    // nowhere
    const end = (curb, sx, sz) => {
      const d = reach(curb.x, curb.z, sx, sz);
      const x = curb.x + sx * (d + 2), z = curb.z + sz * (d + 2);
      if (d >= 0 && lines.some((line) => blockAt(x + ux * line, z + uz * line))) return { d, land: 2, w: -1 };
      const w = refuge(curb.x, curb.z, sx, sz, ux, uz, arm);
      return w >= 0 && Math.max(d, 0) + STRIP_LAND <= w / 2 ? { d: Math.max(d, 0), land: STRIP_LAND, w } : null;
    };
    const end0 = end(curb0, -cx, -cz), end1 = end0 && end(curb1, cx, cz);
    if (!end0 || !end1) return null;
    lo -= end0.d;
    hi += end1.d;
    const tracks = [];
    for (const line of lines) {
      const a = { x: cx * (lo - end0.land) + ux * (along + line), z: cz * (lo - end0.land) + uz * (along + line) };
      const b = { x: a.x + cx * (hi - lo + end0.land + end1.land), z: a.z + cz * (hi - lo + end0.land + end1.land) };
      if ((end0.w < 0 && !blockAt(a.x, a.z)) || (end1.w < 0 && !blockAt(b.x, b.z))) continue;
      // A raised median is walkable, but it can still be too close to a rail for the curb queue. Apply the same
      // normal clearance as on unmodelled strip refuges, including the space behind the first waiting person.
      if (end0.w < 0 && !roomToWait(a.x + cx * 1.6, a.z + cz * 1.6, -cx, -cz)) continue;
      if (end1.w < 0 && !roomToWait(b.x - cx * 1.6, b.z - cz * 1.6, cx, cz)) continue;
      if (!clear(a, b)) continue;
      tracks.push(segment(a, b, { node: n, side: arm.side, group: arm.group, line, from: n, to: n }));
    }
    if (!tracks.length) return null;
    const a = at(lo), b = at(hi);
    return { node: n, side: arm.side, group: arm.group, ax: a.x, az: a.z, bx: b.x, bz: b.z, h: ZEBRA_HALF, ux, uz, span,
      tracks, ends: [{ x: a.x, z: a.z, wx: -cx, wz: -cz, w: end0.w }, { x: b.x, z: b.z, wx: cx, wz: cz, w: end1.w }] };
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
    for (const e of edges) {
      const r = { e, ax: e.x0, az: e.z0, bx: e.x0 + e.dx * e.span, bz: e.z0 + e.dz * e.span, h: e.half };
      cells(r, (k) => {
        if (!ways.has(k)) ways.set(k, []);
        ways.get(k).push(r);
      });
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
    // Split crossings: each strip end pairs with the end of another crosswalk facing it across the strip (another strip
    // end at the same strip, or an island end on it: a curb island inside the strip but out of reach), the one least
    // offset along the road, where the choice is mutual and the walk over the strip is clear. The crosswalks paired up
    // form one group (a chain from curb island to curb island), kept or dropped whole.
    const ends = new Map();
    for (const c of found) {
      c.ends.forEach((end, k) => {
        Object.assign(end, { c, k, mate: null });
        const key = Math.floor(end.x / 32) * 100000 + Math.floor(end.z / 32);
        if (!ends.has(key)) ends.set(key, []);
        ends.get(key).push(end);
      });
    }
    // how far along the road strip end s is off end o across its strip, or Infinity where o does not face it there
    const offset = (s, o) => {
      if (s.wx * o.wx + s.wz * o.wz > -0.9) return Infinity;
      const dx = o.x - s.x, dz = o.z - s.z, across = dx * s.wx + dz * s.wz;
      if (o.w >= 0 ? Math.abs(across - s.w) > 1 || Math.abs(across - o.w) > 1 : across < -0.5 || across > s.w + 0.5) {
        return Infinity;
      }
      return Math.abs(dx * s.c.ux + dz * s.c.uz);
    };
    const best = (p) => {
      let mate = null, least = STRIP_OFFSET;
      const ix0 = Math.floor(p.x / 32), iz0 = Math.floor(p.z / 32);
      for (let ix = ix0 - 1; ix <= ix0 + 1; ix++) {
        for (let iz = iz0 - 1; iz <= iz0 + 1; iz++) {
          for (const q of ends.get(ix * 100000 + iz) || []) {
            if (q.c === p.c || (p.w < 0 && q.w < 0)) continue;
            const off = p.w >= 0 ? offset(p, q) : offset(q, p);
            if (off < least) { mate = q; least = off; }
          }
        }
      }
      return mate;
    };
    for (const list of ends.values()) {
      for (const p of list) {
        if (p.w < 0 || p.mate) continue;
        const q = best(p);
        if (q && !q.mate && best(q) === p) { p.mate = q; q.mate = p; }
      }
    }
    // the walks over the strip, track end to track end
    // (each line to the nearest line across: the walks of a two-line crosswalk cut across each other otherwise, and the
    // people on them wait for each other's way to clear for good, traffic.js walk)
    const strand = (p) => {
      const out = [];
      for (const a of p.c.tracks) {
        const pa = point(a, p.k);
        let best = null, least = Infinity;
        for (const b of p.mate.c.tracks) {
          const pb = point(b, p.mate.k), d = Math.hypot(pb.x - pa.x, pb.z - pa.z);
          if (d < least && clear(pa, pb)) { best = b; least = d; }
        }
        if (best) out.push({ a, b: best });
      }
      return out;
    };
    const groups = new Map(); // crosswalk -> its group: { members, span, ok }
    for (const c of found) {
      if (groups.has(c)) continue;
      const group = { members: [], span: 0, ok: true };
      const queue = [c];
      groups.set(c, group);
      while (queue.length) {
        const m = queue.pop();
        group.members.push(m);
        group.span = Math.max(group.span, m.span);
        for (const end of m.ends) {
          if (!end.mate) {
            if (end.w >= 0) group.ok = false;
            continue;
          }
          if (!strand(end).length) group.ok = false;
          end.stand = roomToWait(end.x, end.z, end.wx, end.wz);
          if (!end.stand && !roomToWait(end.mate.x, end.mate.z, end.mate.wx, end.mate.wz)) group.ok = false;
          if (!groups.has(end.mate.c)) {
            groups.set(end.mate.c, group);
            queue.push(end.mate.c);
          }
        }
      }
    }
    const sorted = [...new Set(groups.values())].filter((g) => g.ok).sort((p, q) => q.span - p.span);
    const kept = new Map();
    for (const group of sorted) {
      if (group.members.some((c) => hits(kept, c))) continue;
      for (const c of group.members) {
        file(kept, c);
        crosswalks.push(c);
        crossings.get(c.node).push(...c.tracks);
        for (const end of c.ends) {
          if (!end.mate) continue;
          for (const { a, b } of strand(end)) {
            if (!a.refuge) a.refuge = [null, null];
            (a.refuge[end.k] || (a.refuge[end.k] = [])).push({ track: b, end: end.mate.k, hold: !end.mate.stand });
          }
          if (!end.stand) for (const a of c.tracks) (a.cramped || (a.cramped = [false, false]))[end.k] = true;
        }
      }
    }
    for (const c of found) delete c.ends;
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
    const a = point(track, end);
    // on a split crossing's strip: over it to the crosswalk on the other roadway (and on along the island, if any); a
    // `hold` path's first leg names the crosswalk walkers wait here for (traffic.js), its own end having no room
    for (const { track: next, end: nextEnd, hold } of track.refuge?.[end] || []) {
      const b = point(next, nextEnd), path = [];
      if (Math.hypot(b.x - a.x, b.z - a.z) > 0.01) path.push({ track: segment(a, b), dir: 1 });
      path.push({ track: next, dir: nextEnd ? -1 : 1 });
      if (hold) path[0].hold = next;
      result.push(path);
    }
    const block = blockAt(a.x, a.z);
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
