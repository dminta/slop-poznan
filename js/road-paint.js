import * as THREE from 'three/webgpu';
import { CROSSWALK } from './road-network.js';
import { createRoadPaintMaterial } from './tsl-materials.js';

// js/road-paint.js
// Road markings generated from the drivable road network (js/road-network.js), so the paint matches where traffic
// actually drives and stops. Polish markings, all white: P-1 dashed lines between lanes going the same way, P-4 double
// solid between opposing lanes on roads with two or more lanes each way, P-1 dashed between single opposing lanes
// outside 30 zones (a residential street at 30 km/h or less has no centre line), P-14 stop lines at signalised
// approaches only (unsignalised Polish junctions carry P-12/P-13 only with a STOP or give-way sign, which the geodata
// does not have), P-10 zebras across every intersection approach, and red bike lanes along the curbs OSM tags with
// cycleway=lane (road-network.js edge.bike) where the outer lane leaves room for one.

const WHITE = new THREE.Color(0xe6e2d6);
const RED = new THREE.Color(0xa8392c); // the red asphalt of Polish bike lanes
const HEIGHT = 0.012; // above the asphalt
const LINE_W = 0.12; // the standard Polish line width
const DASH_PERIOD = 12; // P-1: 4 m dashes, 8 m gaps
const DASH_DUTY = 1 / 3;
const ZEBRA_PERIOD = 1.0; // P-10: 0.5 m stripes, 0.5 m gaps
const STOP_W = 0.5; // P-14: 0.5 m deep, 1 m rectangles 0.5 m apart
const STOP_PERIOD = 1.5;
const STOP_DUTY = 2 / 3;
const BIKE_EDGE_W = 0.24; // the wide solid line between a bike lane and the traffic lane
const BIKE_W = 1.5; // the bike lane at most, and 1 m at least
const BIKE_CURB = 0.2; // gap from the curb
const CAR_HALF = 1.0; // a car's half width, which must stay off the bike lane's line
const NO_BIKE = [false, false];

function buildRoadPaint(scene, network) {
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

  // The one or two directed edges of each road between a pair of intersections
  const roads = new Map();
  for (const e of network.paintEdges || network.edges) {
    const key = Math.min(e.from.id, e.to.id) * 65536 + Math.max(e.from.id, e.to.id);
    if (roads.has(key)) roads.get(key).push(e);
    else roads.set(key, [e]);
  }

  for (const [e, back] of roads.values()) {
    const firstLine = lines.length;
    // Lanes of both directions, measured to the right of e, left to right
    const lanes = e.lanes.map((o) => ({ o, dir: 1 }));
    if (back) for (const o of back.lanes) lanes.push({ o: -o, dir: -1 });
    lanes.sort((p, q) => p.o - q.o);

    // P-1 dashed between lanes going the same way; between opposing ones P-4 double solid where either way has two
    // lanes or more, P-1 dashed on a one-lane-each-way road faster than 30 km/h, nothing on slower ones (nothing
    // across a median or a lane closed off by an obstacle)
    const multi = e.lanes.length > 1 || (back && back.lanes.length > 1);
    const slow = Math.max(e.limit || 0, back ? back.limit || 0 : 0) <= 30 / 3.6 + 0.01;
    for (let k = 0; k + 1 < lanes.length; k++) {
      const p = lanes[k];
      const q = lanes[k + 1];
      const mid = (p.o + q.o) / 2;
      if (q.o - p.o > 4.5 && (p.dir === q.dir || !clearCentre(e, mid))) continue;
      if (p.dir === q.dir) {
        along(e, mid, LINE_W, WHITE, DASH_PERIOD, DASH_DUTY);
      } else if (multi) {
        along(e, mid - LINE_W, LINE_W, WHITE);
        along(e, mid + LINE_W, LINE_W, WHITE);
      } else if (!slow) {
        along(e, mid, LINE_W, WHITE, DASH_PERIOD, DASH_DUTY);
      }
    }

    // Red bike lanes along the curbs OSM tags with one (e.bike: [left, right] of its way of travel; the left curb of a
    // two-way road is the right one of the way back), BIKE_CURB off the curb and edged by a wide solid line, as wide as
    // the room the outer lane leaves (BIKE_W at most): none where a car in it would cover the line
    const right = (e.bike || NO_BIKE)[1];
    const left = back ? (back.bike || NO_BIKE)[1] : (e.bike || NO_BIKE)[0];
    for (const [has, sign, outer] of [[right, 1, lanes[lanes.length - 1].o], [left, -1, lanes[0].o]]) {
      if (!has) continue;
      const curb = sign * e.half;
      const w = Math.min(BIKE_W, (curb - outer) * sign - CAR_HALF - BIKE_EDGE_W - BIKE_CURB);
      if (w < 1) continue;
      along(e, curb - sign * (BIKE_CURB + w / 2), w, RED);
      along(e, curb - sign * (BIKE_CURB + w + BIKE_EDGE_W / 2), BIKE_EDGE_W, WHITE);
    }

    // P-14 stop lines across the lanes arriving at each signalised stop line, from the centre line (or median) to the
    // curb (none where a street merely bends: a shape node of the centreline streets)
    for (const f of back ? [e, back] : [e]) {
      if (f.to.shape || !f.to.signal) continue;
      const left = back ? Math.max(0, f.lanes[0] - 1.8) : -f.half;
      across(f, f.len - 0.35, left + 0.1, f.half - 0.1, STOP_W, WHITE, STOP_PERIOD, STOP_DUTY);
    }

    // P-10 zebras curb to curb, between the stop lines and the intersections at both ends
    if (!e.from.shape) across(e, -CROSSWALK / 2, -e.half, e.half, CROSSWALK - 0.3, WHITE, ZEBRA_PERIOD, 0.5);
    if (!e.to.shape) across(e, e.len + CROSSWALK / 2, -e.half, e.half, CROSSWALK - 0.3, WHITE, ZEBRA_PERIOD, 0.5);

    for (const [end, node] of [[0, e.from], [1, e.to]]) {
      if (!node.shape) continue;
      if (!bends.has(node.id)) bends.set(node.id, []);
      bends.get(node.id).push({ e, end, lines: lines.slice(firstLine) });
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
