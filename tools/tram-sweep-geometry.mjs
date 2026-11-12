// Offline geometry shared by the stop-line audit and its reference tests. No simulation state is changed.
// A section can occupy any station on a path: articulation gaps change when it gets there, not its swept set.
function rectangleDepth(a, b) {
  let depth = Infinity;
  for (const h of [a.heading, a.heading + Math.PI / 2, b.heading, b.heading + Math.PI / 2]) {
    const x = Math.sin(h), z = Math.cos(h);
    const radius = (r) => r.halfLength * Math.abs(Math.sin(r.heading) * x + Math.cos(r.heading) * z) +
      r.halfWidth * Math.abs(Math.cos(r.heading) * x - Math.sin(r.heading) * z);
    depth = Math.min(depth, radius(a) + radius(b) - Math.abs((a.x - b.x) * x + (a.z - b.z) * z));
  }
  return depth;
}

function buildSectionSweep(graph, models, edgePoint, poseSections, { step = 0.25, margin = 0.1 } = {}) {
  if (!(step > 0) || !(margin >= 0)) throw new Error('Invalid sweep sampling');
  const lengths = [...new Set(Object.values(models).flatMap((m) => m.sections.map((s) => s.len)))];
  const cells = new Map();
  let count = 0;
  const cell = 16;
  const out = [{}], rear = {}, front = {}, middle = {};
  // Include short switch pieces recursively; extrapolating a chain's end would miss the turning body there.
  function ends(edge, s, path, starts, visit) {
    if (s <= edge.len || !edge.next.length) {
      edgePoint(edge, s, front);
      visit(path, starts);
      return;
    }
    for (const next of edge.next) {
      if (!next.routes.length || path.includes(next)) continue;
      ends(next, s - edge.len, [...path, next], [...starts, starts.at(-1) + edge.len], visit);
    }
  }
  for (const edge of graph.edges) {
    if (!edge.routes.length) continue;
    for (const len of lengths) {
      const model = { sections: [{ len }], gap: 0 };
      for (let s = 0; s < edge.len; s += step) {
        edgePoint(edge, s, rear);
        ends(edge, s + len, [edge], [0], (path, starts) => {
          const ux = front.x - rear.x, uz = front.z - rear.z;
          const d = Math.hypot(ux, uz);
          if (!d) return;
          // Straight shared lanes need following, not a permanent stop-line retreat along the entire street.
          const trackPath = { pointAt(u, p) {
            let k = starts.length - 1;
            while (k > 0 && starts[k] > u) k--;
            return edgePoint(path[k], u - starts[k], p);
          } };
          trackPath.pointAt(s + len / 2, middle);
          let curved = Math.abs(ux * rear.tz - uz * rear.tx) / d > 1e-6 ||
            Math.abs(ux * front.tz - uz * front.tx) / d > 1e-6 ||
            Math.abs(ux * (middle.z - rear.z) - uz * (middle.x - rear.x)) / d > 1e-6;
          // An S bend can have parallel end tangents and its midpoint on the chord. Check its intervening vertices
          // too; binary search avoids scanning a whole long track for each short section station.
          for (let i = 0; !curved && i < path.length; i++) {
            const e = path[i], start = s - starts[i], end = s + len - starts[i];
            let lo = 0, hi = e.cum.length;
            while (lo < hi) {
              const mid = (lo + hi) >> 1;
              if (e.cum[mid] <= start) lo = mid + 1;
              else hi = mid;
            }
            for (let k = lo; k < e.cum.length && e.cum[k] < end; k++) {
              if (Math.abs(ux * (e.pts[2 * k + 1] - rear.z) - uz * (e.pts[2 * k] - rear.x)) / d > 1e-6) {
                curved = true;
                break;
              }
            }
          }
          if (!curved) return;
          poseSections(trackPath, s + len, model, out);
          const r = { ...out[0], halfWidth: out[0].halfWidth + margin,
            halfLength: out[0].halfLength + margin, chain: edge.chain, station: s, sectionLength: len };
          const hx = Math.abs(Math.sin(r.heading)) * r.halfLength + Math.abs(Math.cos(r.heading)) * r.halfWidth;
          const hz = Math.abs(Math.cos(r.heading)) * r.halfLength + Math.abs(Math.sin(r.heading)) * r.halfWidth;
          for (let ix = Math.floor((r.x - hx) / cell); ix <= Math.floor((r.x + hx) / cell); ix++) {
            for (let iz = Math.floor((r.z - hz) / cell); iz <= Math.floor((r.z + hz) / cell); iz++) {
              const key = `${ix},${iz}`;
              if (!cells.has(key)) cells.set(key, []);
              cells.get(key).push(r);
            }
          }
          count++;
        });
      }
    }
  }
  function intrusion(rect) {
    const reach = Math.hypot(rect.halfLength, rect.halfWidth);
    let depth = 0, hit = null;
    const seen = new Set();
    for (let ix = Math.floor((rect.x - reach) / cell); ix <= Math.floor((rect.x + reach) / cell); ix++) {
      for (let iz = Math.floor((rect.z - reach) / cell); iz <= Math.floor((rect.z + reach) / cell); iz++) {
        for (const r of cells.get(`${ix},${iz}`) || []) {
          if (seen.has(r)) continue;
          seen.add(r);
          const value = rectangleDepth(rect, r);
          if (value > depth) { depth = value; hit = r; }
        }
      }
    }
    return { depth, hit };
  }
  return { intrusion, count, step, margin };
}

function standingRectangle(edge, offset, retreat = 0, halfLength = 2.8, halfWidth = 1.01) {
  const s = edge.len - halfLength - retreat;
  // laneShiftAt's interpolation is supplied by the caller for profiled lanes.
  return { x: edge.sx + edge.dx * s + edge.rx * offset,
    z: edge.sz + edge.dz * s + edge.rz * offset,
    heading: Math.atan2(edge.dx, edge.dz), halfLength, halfWidth };
}

function findStandingRetreat(rectAt, sweep, available) {
  let required = 0;
  while (required <= 60 && sweep.intrusion(rectAt(required)).depth > 0) required += 0.25;
  const requiredRetreat = required <= 60 ? required : null;
  return { requiredRetreat, retreat: requiredRetreat !== null && required <= available ? required : null };
}

export { rectangleDepth, buildSectionSweep, standingRectangle, findStandingRetreat };
