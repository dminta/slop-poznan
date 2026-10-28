import * as THREE from 'three/webgpu';
import { CROSSWALK, STOP_SETBACK } from './road-network.js';
import { createRoadPaintMaterial } from './tsl-materials.js';

// js/road-paint.js
// Road markings generated from the drivable road network (js/road-network.js), so the paint matches where traffic
// actually drives and stops. Polish markings, all white, sized after the annex on horizontal signs (Rozporządzenie
// Ministra Infrastruktury z 3 lipca 2003 r., załącznik nr 2; consolidated text Dz.U. 2019 poz. 2311,
// https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20190002311): P-1b dashed lines (P-1a above 70 km/h) between
// lanes going the same way; P-4 double solid between opposing lanes on roads with three lanes or more (the annex
// requires it there); P-1b/P-1a between single opposing lanes on carriageways 5.8 m or wider outside 30 zones (no
// centre line at 30 km/h or less is local practice, not the annex); P-10 zebras where pedestrian-routes.js lays its
// crosswalks (traffic.js hands them over); P-14 stop lines on every signalised approach and on unsignalised ones of
// major roads with a zebra (see STOP_W). No bike lanes: cyclists ride in the roadway.

const WHITE = new THREE.Color(0xe6e2d6);
const HEIGHT = 0.012; // above the asphalt
const LINE_W = 0.12; // P-1a/b, P-2a and each line of P-4 (annex 2.2.1); P-4's two lines are 0.12 m apart
const DASH_DUTY = 1 / 3;
const DASH_SHORT = 6; // P-1b, up to 70 km/h: 2 m dashes, 4 m gaps (annex 2.2.1.2)
const DASH_LONG = 12; // P-1a, above 70 km/h: 4 m dashes, 8 m gaps (annex 2.2.1.1)
const FAST = 70 / 3.6 + 0.01;
const CENTRE_MIN = 5.8; // no lane lines on a two-way carriageway narrower than this (annex 2.2.1)
const ZEBRA_PERIOD = 1.0; // P-10: 0.5 m stripes, 0.5 m gaps, 4.0 m deep (annex 4.2.1)
const ZEBRA_RAIL_KEEP = 1.7; // m from a track centreline left unpainted: a tram body's 1.2 m half width and its sway
const ZEBRA_MIN_PIECE = 1.0; // shorter pieces of a zebra cut by the tracks are not painted
// P-14: 0.5 m deep, 0.75 m rectangles 0.25 m apart, at least 2 m before the zebra (annex 4.2.5): 0.1 m inside the edge
// end, which is the edge's setbackTo (STOP_SETBACK 1.75 m) before the CROSSWALK band, whose zebra keeps 0.15 m off its
// edges, so setbackTo + 0.25 m of asphalt between them. Which approaches get one:
// - signalised: always, P-14 on every lane before the signals (annex 7.6.2.4). A short link squeezed between two
//   corners gives up some or all of the setback (road-network.js place); its line still goes at the edge end, where
//   traffic stops, only closer to the zebra than the 2 m (down to 0.25 m, never on it), rather than leave a signal
//   without one;
// - unsignalised, on a major road (axis 'ave', road-network.js isMajorRoad), with the full setback, before a zebra (an
//   approach with no crosswalk has nothing to stop before): the annex requires
//   P-14 before crossings at junctions "na wlotach drogi z pierwszeństwem" and only recommends it on subordinate and
//   equal-priority approaches (4.2.1). The geodata has no D-1/A-7 signs, so the major road stands in for the priority
//   road; the annex has no lane-count rule;
// - every other approach: none, and no P-12/P-13 either, which go only with a STOP or give-way sign (4.2.3, 4.2.4).
//   Drivers stop at the zebra's near edge then (4.1).
const STOP_W = 0.5;
const STOP_PERIOD = 1.0;
const STOP_DUTY = 0.75;

// crosswalks: pedestrian-routes.js `crosswalks` ({ node, ax, az, bx, bz, ux, uz }: a network node and the zebra's ends);
// railClearance(x, z, r): city-grid.js's distance to the nearest track centreline, capped at r (none: no tracks)
function buildRoadPaint(scene, network, crosswalks = [], railClearance = null) {
  const position = [];
  const side = [];
  const paint = [];
  const colors = [];
  const index = [];
  const lines = [];
  const bends = new Map();

  // Flat strip w wide from a to b, with a dash pattern (period, duty cycle) running along it
  function strip(ax, az, bx, bz, w, col, period = 1, duty = 1, phase = 0, flow = 1) {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05) return;
    const sx = ((az - bz) / len) * w * 0.5;
    const sz = ((bx - ax) / len) * w * 0.5;
    const i = position.length / 3;
    const end = phase + len * flow;
    for (const [x, z, s, u] of [[ax, az, -1, phase], [ax, az, 1, phase], [bx, bz, 1, end], [bx, bz, -1, end]]) {
      position.push(x + sx * s, HEIGHT, z + sz * s);
      side.push(sx * s, sz * s);
      paint.push(u, period, duty);
      colors.push(col.r, col.g, col.b);
    }
    index.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }

  // Edges run between stop lines; s is measured from the start one and o to the right of the centre line
  const at = (e, s, o) => [e.sx + e.dx * s + e.rx * o, e.sz + e.dz * s + e.rz * o];
  const along = (e, o, w, col, period = 1, duty = 1) => {
    const start = (e.sx - e.x0) * e.dx + (e.sz - e.z0) * e.dz;
    const ends = [at(e, e.from.shape ? -start : 0.9, o), at(e, e.to.shape ? e.span - start : e.len - 0.9, o)];
    lines.push({ e, o, w, col, period, duty, ends, joins: [] });
  };
  const across = (e, s, o0, o1, w, col, period, duty) => strip(...at(e, s, o0), ...at(e, s, o1), w, col, period, duty);
  const clearCentre = (e, o) => {
    if (!network.isRoadClear) return false;
    const steps = Math.max(1, Math.ceil((e.len - 1.8) / 2.5));
    for (let i = 0; i <= steps; i++) {
      const s = 0.9 + (e.len - 1.8) * i / steps;
      for (const offset of [o - 0.12, o + 0.12]) if (!network.isRoadClear(...at(e, s, offset), 0.15)) return false;
    }
    return true;
  };

  // The zebras at each junction (paint nodes stand where the network's do), to find the one across an approach
  const zebrasAt = new Map();
  const nodeKey = (n) => `${n.x},${n.z}`;
  for (const c of crosswalks) {
    const key = nodeKey(c.node);
    if (!zebrasAt.has(key)) zebrasAt.set(key, []);
    zebrasAt.get(key).push(c);
  }
  const zebraBefore = (f) => (zebrasAt.get(nodeKey(f.to)) || []).some((c) => c.ux * f.dx + c.uz * f.dz < -0.94);

  // The one or two directed edges of each road between a pair of intersections: two only where they run both ways along
  // one line (a divided road's two roadways keep their own lines, road-network.js 3., and are painted one by one)
  const roads = new Map();
  const oneLine = (e, f) => Math.hypot(f.x0 - e.x0 - e.dx * e.span, f.z0 - e.z0 - e.dz * e.span) < 0.05 &&
    Math.hypot(f.x0 + f.dx * f.span - e.x0, f.z0 + f.dz * f.span - e.z0) < 0.05;
  for (const e of network.paintEdges || network.edges) {
    const key = Math.min(e.from.id, e.to.id) * 65536 + Math.max(e.from.id, e.to.id);
    const road = roads.get(key);
    if (road && road.length === 1 && oneLine(road[0], e)) road.push(e);
    else roads.set(road ? `${key}:${roads.size}` : key, [e]);
  }

  for (const [e, back] of roads.values()) {
    const firstLine = lines.length;
    // Lanes of both directions, measured to the right of e, left to right
    const lanes = e.lanes.map((o) => ({ o, dir: 1 }));
    if (back) for (const o of back.lanes) lanes.push({ o: -o, dir: -1 });
    lanes.sort((p, q) => p.o - q.o);

    // P-1b dashed (P-1a above 70 km/h) between lanes going the same way; between opposing ones P-4 double solid where
    // either way has two lanes or more, dashed on a one-lane-each-way road faster than 30 km/h and at least CENTRE_MIN
    // wide, nothing on slower or narrower ones (nothing across a median or a lane closed off by an obstacle)
    const multi = e.lanes.length > 1 || (back && back.lanes.length > 1);
    const limit = Math.max(e.limit || 0, back ? back.limit || 0 : 0);
    const slow = limit <= 30 / 3.6 + 0.01 || 2 * e.half < CENTRE_MIN;
    const dash = limit > FAST ? DASH_LONG : DASH_SHORT;
    for (let k = 0; k + 1 < lanes.length; k++) {
      const p = lanes[k];
      const q = lanes[k + 1];
      const mid = (p.o + q.o) / 2;
      if (q.o - p.o > 4.5 && (p.dir === q.dir || !clearCentre(e, mid))) continue;
      if (p.dir === q.dir) {
        along(e, mid, LINE_W, WHITE, dash, DASH_DUTY);
      } else if (multi) {
        along(e, mid - LINE_W, LINE_W, WHITE);
        along(e, mid + LINE_W, LINE_W, WHITE);
      } else if (!slow) {
        along(e, mid, LINE_W, WHITE, dash, DASH_DUTY);
      }
    }

    // P-14 stop lines across the lanes arriving at each junction, before its zebra, from the centre line (or median) to
    // the curb (none where a street merely bends, a shape node of the centreline streets): at every signal, squeezed or
    // not, and on major roads' approaches with the full 2 m gap before a zebra (see STOP_W)
    for (const f of back ? [e, back] : [e]) {
      if (f.to.shape) continue;
      if (!f.to.signal && (f.axis !== 'ave' || f.setbackTo < STOP_SETBACK - 1e-6 || !zebraBefore(f))) continue;
      const left = back ? Math.max(0, f.lanes[0] - 1.8) : -f.half;
      across(f, f.len - 0.35, left + 0.1, f.half - 0.1, STOP_W, WHITE, STOP_PERIOD, STOP_DUTY);
    }

    for (const [end, node] of [[0, e.from], [1, e.to]]) {
      if (!node.shape) continue;
      if (!bends.has(node.id)) bends.set(node.id, []);
      bends.get(node.id).push({ e, end, lines: lines.slice(firstLine) });
    }
  }

  // P-10 zebras exactly where pedestrian-routes.js lays its crosswalks, curb to curb next to the intersection (between
  // it and the stop lines): only where both ends reach a curb island, and never on top of one another, so none is
  // painted on the short links inside a junction complex or ending in the roadway, and none where nobody crosses
  // A zebra stops short of the tram tracks it runs over: the trackway (the rails and ZEBRA_RAIL_KEEP either side of
  // the centreline, a tram body's swept reach) stays unpainted, as Polish crossings over tram track are mostly left
  // unmarked. Pieces under ZEBRA_MIN_PIECE (less than a stripe and its gap) are dropped.
  for (const c of crosswalks) {
    const len = Math.hypot(c.bx - c.ax, c.bz - c.az);
    if (!railClearance || len < 0.05 || railClearance((c.ax + c.bx) / 2, (c.az + c.bz) / 2, len / 2 + 4) > len / 2 + 3) {
      strip(c.ax, c.az, c.bx, c.bz, CROSSWALK - 0.3, WHITE, ZEBRA_PERIOD, 0.5);
      continue;
    }
    const ux = (c.bx - c.ax) / len, uz = (c.bz - c.az) / len;
    const h = (CROSSWALK - 0.3) / 2;
    // on the track's reach anywhere across the zebra's depth at s m along it
    const onTrack = (s) => {
      for (const d of [-h, 0, h]) {
        if (railClearance(c.ax + ux * s - uz * d, c.az + uz * s + ux * d, ZEBRA_RAIL_KEEP + 1) < ZEBRA_RAIL_KEEP) return true;
      }
      return false;
    };
    let start = -1;
    const steps = Math.ceil(len / 0.1);
    for (let i = 0; i <= steps; i++) {
      const s = (len * i) / steps;
      const blocked = onTrack(s);
      if (!blocked && start < 0) start = s;
      if ((blocked || i === steps) && start >= 0) {
        const end = blocked ? s - len / steps : s;
        if (end - start >= ZEBRA_MIN_PIECE) {
          // keep the stripe phase of the whole zebra, so the pieces line up with each other
          strip(c.ax + ux * start, c.az + uz * start, c.ax + ux * end, c.az + uz * end, CROSSWALK - 0.3, WHITE,
            ZEBRA_PERIOD, 0.5, start);
        }
        start = -1;
      }
    }
  }

  // At a simple bend, corresponding offset lines meet at a bounded miter, without an intersection-sized gap.
  for (const roadsAtBend of bends.values()) {
    if (roadsAtBend.length !== 2) continue;
    const [a, b] = roadsAtBend;
    const sign = a.end === b.end ? -1 : 1;
    if ((a.e.dx * b.e.dx + a.e.dz * b.e.dz) * sign < 0.5) continue;
    for (const p of a.lines) {
      let q = null;
      let distance = 0.5;
      for (const line of b.lines) {
        const d = Math.abs(p.o - line.o * sign);
        if (!line.joins[b.end] && line.col === p.col && line.w === p.w && line.period === p.period &&
          line.duty === p.duty && d < distance) {
          q = line;
          distance = d;
        }
      }
      if (!q) continue;
      const A = p.ends[a.end];
      const B = q.ends[b.end];
      const dx = B[0] - A[0];
      const dz = B[1] - A[1];
      const cross = a.e.dx * b.e.dz - a.e.dz * b.e.dx;
      let join;
      if (Math.abs(cross) < 0.001) {
        if (Math.hypot(dx, dz) > 0.5) continue;
        join = [(A[0] + B[0]) * 0.5, (A[1] + B[1]) * 0.5];
      } else {
        const t = (dx * b.e.dz - dz * b.e.dx) / cross;
        const u = (dx * a.e.dz - dz * a.e.dx) / cross;
        const limit = Math.min(6, a.e.span * 0.25, b.e.span * 0.25);
        if (Math.abs(t) > limit || Math.abs(u) > limit) continue;
        join = [A[0] + a.e.dx * t, A[1] + a.e.dz * t];
      }
      p.ends[a.end] = q.ends[b.end] = join;
      p.joins[a.end] = [q, b.end];
      q.joins[b.end] = [p, a.end];
    }
  }

  // Continue the same dash phase around bends, even when adjacent road edges point in opposite directions.
  for (const line of lines) {
    // An unmatched marking keeps its original gap instead of extending towards a curb at a sharp bend.
    for (const end of [0, 1]) {
      if (!line.joins[end]) line.ends[end] = at(line.e, end ? line.e.len - 0.9 : 0.9, line.o);
    }
    line.len = Math.hypot(line.ends[1][0] - line.ends[0][0], line.ends[1][1] - line.ends[0][1]);
  }
  for (const root of lines) {
    if (root.phase !== undefined) continue;
    root.phase = 0;
    root.flow = 1;
    const stack = [root];
    while (stack.length) {
      const line = stack.pop();
      for (let end = 0; end < 2; end++) {
        if (!line.joins[end]) continue;
        const [next, nextEnd] = line.joins[end];
        if (next.phase !== undefined) continue;
        next.flow = line.flow * (end === nextEnd ? -1 : 1);
        next.phase = line.phase + end * line.len * line.flow - nextEnd * next.len * next.flow;
        next.phase = ((next.phase % next.period) + next.period) % next.period;
        stack.push(next);
      }
      strip(...line.ends[0], ...line.ends[1], line.w, line.col, line.period, line.duty, line.phase, line.flow);
    }
  }

  const normal = new Float32Array(position.length);
  for (let i = 1; i < normal.length; i += 3) normal[i] = 1;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('side', new THREE.Float32BufferAttribute(side, 2));
  geometry.setAttribute('paint', new THREE.Float32BufferAttribute(paint, 3));
  geometry.setIndex(index);

  const mesh = new THREE.Mesh(geometry, createRoadPaintMaterial());
  mesh.name = 'RoadMarkings';
  mesh.receiveShadow = true;
  mesh.renderOrder = -1; // under the other see-through ground effects (contact shadows, headlight beams)
  scene.add(mesh);
  return mesh;
}

export { buildRoadPaint };
