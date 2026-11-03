const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');
const { busReport, formatBusReport } = require('./helpers/bus-report.cjs');

function inert() {
  const values = {};
  return new Proxy(function () {}, {
    get(_target, key) {
      if (key === Symbol.iterator) return function* () {};
      if (key === Symbol.toPrimitive) return () => 0;
      if (key === 'then') return undefined;
      if (key === 'length') return 0;
      return key in values ? values[key] : (values[key] = inert());
    },
    set(_target, key, value) { values[key] = value; return true; },
    apply: () => inert(),
    construct: () => inert()
  });
}

// Clip a rendered marking quad to a bed's box in the bed's local frame. Positive area means the bed occludes paint;
// testing whole quads is stricter than testing white stripes alone, and catches narrow overlaps between samples.
function overlapArea(quad, bed) {
  const len = Math.hypot(bed.bx - bed.ax, bed.bz - bed.az);
  const dx = (bed.bx - bed.ax) / len, dz = (bed.bz - bed.az) / len;
  let poly = quad.map(([x, z]) => [(x - bed.ax) * dx + (z - bed.az) * dz,
    -(x - bed.ax) * dz + (z - bed.az) * dx]);
  for (const [axis, bound, sign] of [[0, -0.01, 1], [0, len + 0.01, -1], [1, -bed.bed, 1], [1, bed.bed, -1]]) {
    const next = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const da = (a[axis] - bound) * sign, db = (b[axis] - bound) * sign;
      if (da >= 0) next.push(a);
      if ((da >= 0) !== (db >= 0)) {
        const t = da / (da - db);
        next.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    poly = next;
  }
  let twiceArea = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    twiceArea += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(twiceArea) / 2;
}

test('rendered zebra quads stay clear of raised tram ballast on the furnished Poznań network', async (t) => {
  const config = await import('../js/city-config.js');
  const { GEO } = await import('../js/geodata.js');
  const source = (name) => readFileSync(join(__dirname, '../js', name + '.js'), 'utf8');
  const rendering = {
    'three/webgpu': inert(), 'three/tsl': inert(),
    'three/addons/utils/BufferGeometryUtils.js': inert(), './tsl-materials.js': inert()
  };
  // Expose the reason on the paint snapshot solely for this measurement; the production network stays unchanged.
  const instrument = (name) => name === 'road-network' ? source(name).replace(
    'setbackTo, half, lanes, limit, busWay, busLanes:',
    "setbackTo, half, lanes, limit, busWay, busStatus: !busVector || !busVector.includes(1) ? 'direction' : " +
    "busVector.length !== cand.length ? 'count' : lanes.length !== cand.length ? 'blocked' : 'eligible', busLanes:"
  ) : source(name);
  const load = (name, imports, extra = '') => loadModule(instrument(name) + extra, {
    imports, globals: { document: inert() }, filename: name + '.js'
  });
  const road = load('road-network', { './city-config.js': config, './geodata.js': { GEO } });
  const gridModule = load('city-grid', { ...rendering, './city-config.js': config, './geodata.js': { GEO } },
    '\nexport function snapshot() { return { pavedPlazaRects, parkTreeSites, parkLampSites, sidewalkBlocks }; }');
  const grid = gridModule.buildCityGrid(inert());
  const street = load('street-details', {
    ...rendering, './city-config.js': config, './road-network.js': road,
    './city-grid.js': { ...gridModule, ...gridModule.snapshot() },
    './trees.js': { createTreeField: () => ({ group: inert() }) }
  }).buildStreetDetails(inert());
  const network = road.buildRoadNetwork(grid.sidewalks, [...grid.footprints, ...street.footprints]);
  const routes = load('pedestrian-routes', { './road-network.js': road })
    .createPedestrianRoutes(network, config.blockAt, gridModule.railClearance);
  const { beds } = load('tram-infra', { ...rendering, './city-config.js': config, './geodata.js': { GEO } })
    .layoutTramInfrastructure(network);
  class Attribute { constructor(array) { this.array = array; } }
  class FloatAttribute extends Attribute { constructor(array) { super(new Float32Array(array)); } }
  class Geometry {
    constructor() { this.attributes = {}; }
    setAttribute(name, attr) { this.attributes[name] = attr; }
    setIndex() {}
  }
  class Color { constructor() { this.r = this.g = this.b = 1; } }
  class Mesh { constructor(geometry) { this.geometry = geometry; } }
  const { buildRoadPaint, layoutBusMarkings } = load('road-paint', {
    'three/webgpu': { Color, Mesh, BufferGeometry: Geometry, BufferAttribute: Attribute, Float32BufferAttribute: FloatAttribute,
      InstancedMesh: class { setMatrixAt() {} }, MeshBasicMaterial: class {}, Object3D: inert(), DoubleSide: 2 },
    './road-network.js': road, './tsl-materials.js': { createRoadPaintMaterial: () => ({}), createBusPaintMaterial: () => ({}) }
  });
  const mesh = buildRoadPaint({ add() {} }, network, routes.crosswalks, gridModule.railClearance);
  const marks = layoutBusMarkings(network.paintEdges, routes.crosswalks, gridModule.railClearance);
  const ways = JSON.parse(readFileSync(join(__dirname, '../tools/data/poz_roads.json'), 'utf8')).elements;
  const report = busReport(ways, network.paintEdges, marks,
    layoutBusMarkings(network.paintEdges, routes.crosswalks, null), layoutBusMarkings(network.paintEdges, [], null));
  const summary = formatBusReport(report);
  t.diagnostic(summary);
  assert.ok(readFileSync(join(__dirname, '../docs/geodata.md'), 'utf8').includes(summary),
    'geodata documentation contains the current reproducible P-22 report');
  assert.ok(marks.some((m) => m.way === 50258410 && Math.hypot(m.x + 1739.39, m.z + 1270.07) < 1),
    'the mapped bus lane at (-1739, -1270) receives P-22');
  assert.ok(network.paintEdges.some((e) => !e.busWay && !e.busLanes.length));
  const oldGraph = { ...GEO.roadGraph, links: GEO.roadGraph.links.map((l) => l.slice(0, 9)) };
  const oldRoad = load('road-network', { './city-config.js': config, './geodata.js': { GEO: { ...GEO, roadGraph: oldGraph } } });
  const oldNetwork = oldRoad.buildRoadNetwork(grid.sidewalks, [...grid.footprints, ...street.footprints]);
  const geometry = (n) => JSON.stringify(n.edges.map((e) => [e.x0, e.z0, e.dx, e.dz, e.len, ...e.lanes]));
  assert.equal(geometry(network), geometry(oldNetwork), 'bus tags do not alter traffic edges or lanes');
  const oldMesh = buildRoadPaint({ add() {} }, oldNetwork, routes.crosswalks, gridModule.railClearance);
  for (const key of ['position', 'paint', 'color']) {
    assert.deepEqual(mesh.geometry.attributes[key].array, oldMesh.geometry.attributes[key].array,
      `existing ${key} markings are unchanged`);
  }
  // tram-infra renders each bed as a box lengthened by 0.02 m, 2 × bed wide, with its top at ground + 0.14 m.
  const ballast = beds.filter((b) => b.bed > 0);
  const cells = new Map();
  for (const bed of ballast) {
    for (let x = Math.floor((Math.min(bed.ax, bed.bx) - 2) / 8); x <= Math.floor((Math.max(bed.ax, bed.bx) + 2) / 8); x++) {
      for (let z = Math.floor((Math.min(bed.az, bed.bz) - 2) / 8); z <= Math.floor((Math.max(bed.az, bed.bz) + 2) / 8); z++) {
        const k = `${x},${z}`;
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push(bed);
      }
    }
  }
  const measure = (mesh) => {
    const { position, paint } = mesh.geometry.attributes;
    const p = position.array;
    let zebras = 0, covered = 0;
    const places = [];
    for (let v = 0; v < p.length / 3; v += 4) {
      if (paint.array[3 * v + 1] !== 1 || paint.array[3 * v + 2] !== 0.5) continue;
      zebras++;
      const quad = Array.from({ length: 4 }, (_, i) => [p[3 * (v + i)], p[3 * (v + i) + 2]]);
      const candidates = new Set();
      const xs = quad.map((q) => q[0]), zs = quad.map((q) => q[1]);
      for (let x = Math.floor(Math.min(...xs) / 8); x <= Math.floor(Math.max(...xs) / 8); x++) {
        for (let z = Math.floor(Math.min(...zs) / 8); z <= Math.floor(Math.max(...zs) / 8); z++) {
          for (const bed of cells.get(`${x},${z}`) || []) candidates.add(bed);
        }
      }
      for (const bed of candidates) {
        const area = overlapArea(quad, bed);
        if (area < 1e-7) continue;
        covered += area;
        if (places.length < 5) places.push(`${quad[0][0].toFixed(1)},${quad[0][1].toFixed(1)}`);
      }
    }
    return { zebras, covered, places };
  };
  const current = measure(mesh);
  assert.ok(current.zebras > 2000 && ballast.length > 7000,
    `${current.zebras} zebra pieces, ${ballast.length} ballast pieces`);
  assert.equal(current.covered, 0,
    `${current.covered.toFixed(6)} m² of zebra quads under ballast near ${current.places.join('; ')}`);
  // Positive control: without the real rail cuts the same crossings extend under actual ballast. This proves the
  // overlap assertion reaches the reported failure instead of passing because no painted crossing is near a bed.
  const uncut = measure(buildRoadPaint({ add() {} }, network, routes.crosswalks));
  assert.ok(uncut.covered > 1, `${uncut.covered.toFixed(6)} m² covered without rail cuts`);
});
