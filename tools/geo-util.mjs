// tools/geo-util.mjs — pure geometry and raster helpers shared by the geodata builds. No inputs, no frame, no import-time
// work: anything that needs lon/lat in world metres takes a `project(lon, lat) -> [x, z]` function (toWorld). Points are
// [x, z] pairs, rings and polylines arrays of them.

// Round to 0.1 m (the output precision of every ring and polyline)
const r1 = (x) => Math.round(x * 10) / 10;
// Signed shoelace area in (x, z); the outputs reverse rings to a negative area
function ringArea(r) {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return a / 2;
}
function bbox(pts) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of pts) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  return { x0, x1, z0, z1 };
}
// Ramer-Douglas-Peucker on an open polyline
function rdp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, az] = pts[a];
    const [bx, bz] = pts[b];
    const dx = bx - ax, dz = bz - az;
    const L = Math.hypot(dx, dz) || 1e-9;
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dz - (pts[i][1] - az) * dx) / L;
      if (d > best) { best = d; bi = i; }
    }
    if (best > eps) {
      keep[bi] = 1;
      stack.push([a, bi], [bi, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}
// RDP on a closed ring (split at the two farthest-apart vertices)
function rdpRing(ring, eps) {
  let i0 = 0;
  let far = 0, i1 = 0;
  for (let i = 0; i < ring.length; i++) {
    const d = Math.hypot(ring[i][0] - ring[i0][0], ring[i][1] - ring[i0][1]);
    if (d > far) { far = d; i1 = i; }
  }
  const a = rdp(ring.slice(i0, i1 + 1), eps);
  const b = rdp([...ring.slice(i1), ring[i0]], eps);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}
function pointInRing(x, z, r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i];
    const [xj, zj] = r[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
const centroid = (r) => [r.reduce((t, p) => t + p[0], 0) / r.length, r.reduce((t, p) => t + p[1], 0) / r.length];

// ---------------------------------------------------------------------------------------------------------------------
// Raster tools (for cutting piers off the shoreline and merging polygons). Cell (i, j) covers
// [x0 + i·res, x0 + (i+1)·res) × [z0 + j·res, z0 + (j+1)·res); x0/z0 are snapped down to a multiple of res.
// ---------------------------------------------------------------------------------------------------------------------
class Raster {
  constructor(x0, z0, x1, z1, res) {
    this.res = res;
    this.x0 = Math.floor(x0 / res) * res;
    this.z0 = Math.floor(z0 / res) * res;
    this.w = Math.ceil((x1 - this.x0) / res) + 1;
    this.h = Math.ceil((z1 - this.z0) / res) + 1;
    this.d = new Uint8Array(this.w * this.h);
  }
  // Scanline fill of a ring (even-odd) with `val`
  fillRing(ring, val = 1) {
    const { res, x0, z0, w, h, d } = this;
    const bb = bbox(ring);
    const jy0 = Math.max(0, Math.floor((bb.z0 - z0) / res));
    const jy1 = Math.min(h - 1, Math.ceil((bb.z1 - z0) / res));
    const xs = [];
    for (let j = jy0; j <= jy1; j++) {
      const z = z0 + (j + 0.5) * res;
      xs.length = 0;
      for (let i = 0, k = ring.length - 1; i < ring.length; k = i++) {
        const [xa, za] = ring[k];
        const [xb, zb] = ring[i];
        if ((za > z) !== (zb > z)) xs.push(xa + ((z - za) * (xb - xa)) / (zb - za));
      }
      xs.sort((p, q) => p - q);
      for (let n = 0; n + 1 < xs.length; n += 2) {
        const i0 = Math.max(0, Math.ceil((xs[n] - x0) / res - 0.5));
        const i1 = Math.min(w - 1, Math.floor((xs[n + 1] - x0) / res - 0.5));
        for (let i = i0; i <= i1; i++) d[j * w + i] = val;
      }
    }
  }
  // Squared Euclidean distance (in cells) from every cell to the nearest cell where mask(v) is true (Felzenszwalb)
  edt(isSource) {
    const { w, h, d } = this;
    const INF = 1e20;
    const f = new Float64Array(Math.max(w, h));
    const out = new Float32Array(w * h);
    const v = new Int32Array(Math.max(w, h));
    const zz = new Float64Array(Math.max(w, h) + 1);
    const dt1 = (n, get, set) => {
      for (let q = 0; q < n; q++) f[q] = get(q);
      let k = 0;
      v[0] = 0;
      zz[0] = -INF;
      zz[1] = INF;
      for (let q = 1; q < n; q++) {
        let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        while (s <= zz[k]) {
          k--;
          s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        }
        k++;
        v[k] = q;
        zz[k] = s;
        zz[k + 1] = INF;
      }
      k = 0;
      for (let q = 0; q < n; q++) {
        while (zz[k + 1] < q) k++;
        set(q, (q - v[k]) * (q - v[k]) + f[v[k]]);
      }
    };
    for (let i = 0; i < w * h; i++) out[i] = isSource(d[i]) ? 0 : INF;
    for (let i = 0; i < w; i++) dt1(h, (q) => out[q * w + i], (q, val) => (out[q * w + i] = val));
    for (let j = 0; j < h; j++) dt1(w, (q) => out[j * w + q], (q, val) => (out[j * w + q] = val));
    return out;
  }
  // Morphological opening of the 1-cells with a disc of radius r metres
  open(r) {
    const rc = (r / this.res) ** 2;
    const toWater = this.edt((x) => x === 0);
    const eroded = new Uint8Array(this.d.length);
    for (let i = 0; i < eroded.length; i++) eroded[i] = toWater[i] > rc ? 1 : 0;
    const save = this.d;
    this.d = eroded;
    const toEroded = this.edt((x) => x === 1);
    this.d = save;
    for (let i = 0; i < this.d.length; i++) this.d[i] = this.d[i] && toEroded[i] <= rc + 1e-6 ? 1 : 0;
  }
  // Morphological closing (fills inlets / gaps narrower than 2r)
  close(r) {
    const rc = (r / this.res) ** 2;
    const toLand = this.edt((x) => x === 1);
    const dil = new Uint8Array(this.d.length);
    for (let i = 0; i < dil.length; i++) dil[i] = toLand[i] <= rc ? 1 : 0;
    const save = this.d;
    this.d = dil;
    const toGap = this.edt((x) => x === 0);
    this.d = save;
    for (let i = 0; i < this.d.length; i++) this.d[i] = dil[i] && toGap[i] > rc ? 1 : 0;
  }
  // Keep only the 4-connected component containing the most cells
  keepLargest() {
    const { w, h, d } = this;
    const lab = new Int32Array(w * h);
    let best = 0, bestN = 0, cur = 0;
    const stack = [];
    for (let s = 0; s < w * h; s++) {
      if (!d[s] || lab[s]) continue;
      cur++;
      let n = 0;
      stack.push(s);
      lab[s] = cur;
      while (stack.length) {
        const p = stack.pop();
        n++;
        const i = p % w, j = (p - i) / w;
        if (i > 0 && d[p - 1] && !lab[p - 1]) { lab[p - 1] = cur; stack.push(p - 1); }
        if (i < w - 1 && d[p + 1] && !lab[p + 1]) { lab[p + 1] = cur; stack.push(p + 1); }
        if (j > 0 && d[p - w] && !lab[p - w]) { lab[p - w] = cur; stack.push(p - w); }
        if (j < h - 1 && d[p + w] && !lab[p + w]) { lab[p + w] = cur; stack.push(p + w); }
      }
      if (n > bestN) { bestN = n; best = cur; }
    }
    for (let i = 0; i < w * h; i++) d[i] = lab[i] === best ? 1 : 0;
  }
  // Outer boundary of the (single) region as a ring of cell-corner points (Moore-neighbour style edge walk)
  traceOuter() {
    const { w, h, d, res, x0, z0 } = this;
    const at = (i, j) => (i >= 0 && j >= 0 && i < w && j < h ? d[j * w + i] : 0);
    // Directed boundary edges keep land on the left: start at the first land cell's top edge
    let si = -1, sj = -1;
    outer: for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (at(i, j)) { si = i; sj = j; break outer; }
    // Walk corners: position (cx, cz) in corner coordinates, direction index 0:+x 1:+z 2:-x 3:-z
    const DX = [1, 0, -1, 0], DZ = [0, 1, 0, -1];
    let cx = si, cz = sj, dir = 0; // top edge of cell (si, sj), walking +x with land below (on the right in screen, z down)
    const pts = [];
    const start = `${cx},${cz},${dir}`;
    let guard = 0;
    // For a corner walk with land on the right (z down means right = +z side when walking +x):
    // cells around corner (cx, cz): A=(cx-1,cz-1) B=(cx,cz-1) C=(cx-1,cz) D=(cx,cz)
    do {
      pts.push([x0 + cx * res, z0 + cz * res]);
      cx += DX[dir];
      cz += DZ[dir];
      // Cells ahead-left and ahead-right relative to the walking direction
      const cellAt = (dxl, dzl) => at(cx + dxl, cz + dzl);
      // Determine the cells: for each direction, the two cells in front of the corner
      let left, right;
      if (dir === 0) { left = cellAt(0, -1); right = cellAt(0, 0); }
      else if (dir === 1) { left = cellAt(0, 0); right = cellAt(-1, 0); }
      else if (dir === 2) { left = cellAt(-1, 0); right = cellAt(-1, -1); }
      else { left = cellAt(-1, -1); right = cellAt(0, -1); }
      if (left && right) dir = (dir + 3) % 4; // turn left (land ahead): keep land on the right
      else if (!left && right) { /* straight */ }
      else dir = (dir + 1) % 4; // turn right
      if (++guard > 50000000) throw new Error('trace runaway');
    } while (`${cx},${cz},${dir}` !== start);
    // Merge collinear runs, then take edge midpoints (turns the raster's stairs into 45° runs before simplifying)
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[(i + pts.length - 1) % pts.length], q = pts[i], n = pts[(i + 1) % pts.length];
      if ((q[0] - p[0]) * (n[1] - q[1]) - (q[1] - p[1]) * (n[0] - q[0]) !== 0) out.push(q);
    }
    return out.map((q, i) => {
      const n = out[(i + 1) % out.length];
      return [(q[0] + n[0]) / 2, (q[1] + n[1]) / 2];
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Overpass elements (`out geom`) to world rings
// ---------------------------------------------------------------------------------------------------------------------
// One ring per element: a way's geometry, or a relation's outer member with the most nodes
function elemRing(e, project) {
  if (e.type === 'way') return (e.geometry || []).map((g) => project(g.lon, g.lat));
  let best = [];
  for (const m of e.members || []) if (m.role === 'outer' && m.geometry && m.geometry.length > best.length) best = m.geometry.map((g) => project(g.lon, g.lat));
  return best;
}
function elemRings(e, project) {
  // relations (The Lake, Turtle Pond, Harlem Meer) come as several outer ways: chain them into closed rings
  if (e.type === 'way') return [(e.geometry || []).map((g) => project(g.lon, g.lat))];
  const parts = (e.members || []).filter((m) => m.role === 'outer' && m.geometry).map((m) => m.geometry.map((g) => project(g.lon, g.lat)));
  const rings = [];
  const close = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.5;
  while (parts.length) {
    let ring = parts.shift();
    for (let guard = 0; guard < 500 && !close(ring[0], ring[ring.length - 1]); guard++) {
      const i = parts.findIndex((p) => close(p[0], ring[ring.length - 1]) || close(p[p.length - 1], ring[ring.length - 1]));
      if (i < 0) break;
      const p = parts.splice(i, 1)[0];
      ring = ring.concat(close(p[0], ring[ring.length - 1]) ? p.slice(1) : p.reverse().slice(1));
    }
    rings.push(ring);
  }
  return rings;
}
// Chain OSM natural=coastline ways (land on the left) end to start into polylines, by shared node ids. Each chain starts
// at its first way: the walk back takes the earliest way (in element order) ending where the chain starts, which the
// byEnd lists reproduce in O(1) per step, so the output matches the former linear `ways.find` scan exactly.
function chainCoastline(osm, project) {
  const ways = osm.elements.filter((e) => e.type === 'way' && e.geometry);
  const byStart = new Map();
  const byEnd = new Map();
  for (const w of ways) {
    byStart.set(w.nodes[0], w);
    const end = w.nodes[w.nodes.length - 1];
    if (!byEnd.has(end)) byEnd.set(end, []);
    byEnd.get(end).push(w);
  }
  const used = new Set();
  const chains = [];
  for (const w of ways) {
    if (used.has(w.id)) continue;
    // Walk back to the chain's first way
    let first = w;
    const seen = new Set([w.id]);
    for (;;) {
      const prev = (byEnd.get(first.nodes[0]) || []).find((u) => !seen.has(u.id));
      if (!prev) break;
      seen.add(prev.id);
      first = prev;
    }
    const nodes = [];
    let cur = first;
    while (cur && !used.has(cur.id)) {
      used.add(cur.id);
      const g = cur.geometry.map((p) => project(p.lon, p.lat));
      nodes.push(...(nodes.length ? g.slice(1) : g));
      cur = byStart.get(cur.nodes[cur.nodes.length - 1]);
    }
    chains.push(nodes);
  }
  return chains;
}

// ---------------------------------------------------------------------------------------------------------------------
// Multi-component tracing (a river city has several land pieces, where Manhattan needed keepLargest + traceOuter)
// ---------------------------------------------------------------------------------------------------------------------
// 4-connected labels of the cells where pick(value) is true (1-based in scan order; 0 = not picked), with each
// component's cell count and first cell in scan order (its top-left-most cell, where a boundary walk starts)
function labelComponents(ras, pick) {
  const { w, h, d } = ras;
  const lab = new Int32Array(w * h);
  const cells = [0], first = [0];
  const stack = [];
  for (let s = 0; s < w * h; s++) {
    if (lab[s] || !pick(d[s])) continue;
    const id = cells.length;
    let n = 0;
    lab[s] = id;
    stack.push(s);
    while (stack.length) {
      const p = stack.pop();
      n++;
      const i = p % w;
      if (i > 0 && !lab[p - 1] && pick(d[p - 1])) { lab[p - 1] = id; stack.push(p - 1); }
      if (i < w - 1 && !lab[p + 1] && pick(d[p + 1])) { lab[p + 1] = id; stack.push(p + 1); }
      if (p >= w && !lab[p - w] && pick(d[p - w])) { lab[p - w] = id; stack.push(p - w); }
      if (p + w < w * h && !lab[p + w] && pick(d[p + w])) { lab[p + w] = id; stack.push(p + w); }
    }
    cells.push(n);
    first.push(s);
  }
  return { lab, cells, first };
}
// Boundary of the cells labelled `id`, walked from the top edge of its first cell with the region on the right (the
// same corner walk as Raster.traceOuter, numeric state instead of string keys), as the turning corners of the outline.
// Raster edges are kept exactly: corners next to an edge of at least `longCells` cells stay put, the rest of the
// staircase becomes edge midpoints as in traceOuter. Without this the midpoint pass chamfers a straight cut (a box edge,
// 6 km long) from its middle to the middle of the next edge.
function traceLabel(ras, lab, id, start, longCells) {
  const { w, h, res, x0, z0 } = ras;
  const at = (i, j) => i >= 0 && j >= 0 && i < w && j < h && lab[j * w + i] === id;
  const DX = [1, 0, -1, 0], DZ = [0, 1, 0, -1];
  const si = start % w, sj = (start - si) / w;
  let cx = si, cz = sj, dir = 0;
  const corners = [];
  let guard = 0;
  do {
    const prevDir = dir;
    cx += DX[dir];
    cz += DZ[dir];
    let left, right;
    if (dir === 0) { left = at(cx, cz - 1); right = at(cx, cz); }
    else if (dir === 1) { left = at(cx, cz); right = at(cx - 1, cz); }
    else if (dir === 2) { left = at(cx - 1, cz); right = at(cx - 1, cz - 1); }
    else { left = at(cx - 1, cz - 1); right = at(cx, cz - 1); }
    if (left && right) dir = (dir + 3) % 4;
    else if (!left && right) { /* straight */ }
    else dir = (dir + 1) % 4;
    if (dir !== prevDir) corners.push([cx, cz]);
    if (++guard > 50000000) throw new Error('trace runaway');
  } while (cx !== si || cz !== sj || dir !== 0);
  const n = corners.length;
  const len = (k) => {
    const a = corners[k], b = corners[(k + 1) % n];
    return Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
  };
  const out = [];
  const push = (cxp, czp) => {
    const x = x0 + cxp * res, z = z0 + czp * res;
    const l = out[out.length - 1];
    if (!l || l[0] !== x || l[1] !== z) out.push([x, z]);
  };
  for (let k = 0; k < n; k++) {
    const a = corners[k], b = corners[(k + 1) % n];
    if (len(k) >= longCells) { push(a[0], a[1]); push(b[0], b[1]); }
    else push((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  }
  if (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  return out;
}
// Every 4-connected component of non-zero cells with at least `minCells` cells, as { ring, cells, holes }, largest
// first. `holes` are the 4-connected zero regions of at least `minHoleCells` cells that touch no raster edge, each given
// to the component owning the cell above its first cell. Rings come in raster winding (positive shoelace area in x, z);
// callers reverse them as they need. `labels` (component id per cell, 0 for empty or dropped) backs point lookups.
function traceComponents(ras, { minCells = 1, minHoleCells = Infinity, longCells = 24 } = {}) {
  const { w, h } = ras;
  const fg = labelComponents(ras, (v) => v !== 0);
  const comps = new Map();
  for (let id = 1; id < fg.cells.length; id++) {
    if (fg.cells[id] >= minCells) comps.set(id, { id, cells: fg.cells[id], ring: traceLabel(ras, fg.lab, id, fg.first[id], longCells), holes: [] });
  }
  if (minHoleCells < Infinity) {
    const bg = labelComponents(ras, (v) => v === 0);
    const onEdge = new Uint8Array(bg.cells.length);
    for (let i = 0; i < w; i++) { onEdge[bg.lab[i]] = 1; onEdge[bg.lab[(h - 1) * w + i]] = 1; }
    for (let j = 0; j < h; j++) { onEdge[bg.lab[j * w]] = 1; onEdge[bg.lab[j * w + w - 1]] = 1; }
    for (let id = 1; id < bg.cells.length; id++) {
      if (onEdge[id] || bg.cells[id] < minHoleCells) continue;
      const owner = comps.get(fg.lab[bg.first[id] - w]);
      if (owner) owner.holes.push({ cells: bg.cells[id], ring: traceLabel(ras, bg.lab, id, bg.first[id], longCells) });
    }
  }
  const labels = fg.lab;
  for (let i = 0; i < labels.length; i++) if (labels[i] && !comps.has(labels[i])) labels[i] = 0;
  const components = [...comps.values()].sort((a, b) => b.cells - a.cells || a.id - b.id);
  return { components, labels };
}

export { r1, ringArea, bbox, rdp, rdpRing, pointInRing, centroid, Raster, elemRing, elemRings, chainCoastline, labelComponents, traceComponents };
