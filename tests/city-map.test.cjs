const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const source = readFileSync(join(__dirname, '../js/city-map.js'), 'utf8');

for (const [width, height, dpr] of [[500, 300, 1], [320, 180, 1.5], [1920, 1080, 2]]) {
  test(`map clicks match rendered world positions at ${width}x${height}, DPR ${dpr}`, () => {
    const window = { innerWidth: width, innerHeight: height, devicePixelRatio: dpr };
    const { CityMapSystem } = loadModule(source, {
      globals: { window, performance: { now: () => 0 } },
      imports: { './geodata.js': { GEO: {} }, './city-config.js': { ROADS: [], LABEL_ALIAS: {} } }
    });
    const map = Object.create(CityMapSystem.prototype);
    // Capture the production render viewport; drawing primitives are irrelevant to coordinate conversion.
    const context = new Proxy({}, { get: () => () => {} });
    let view;
    Object.assign(map, {
      fullCanvas: { clientWidth: width, clientHeight: height },
      fullCtx: context,
      fullStatic: { getContext: () => context },
      isFullMapOpen: true,
      viewCenterX: 200,
      viewCenterZ: -300,
      viewZoom: 0.5,
      controllerManager: { getActiveEntity: () => ({ position: { x: 200, z: -300 }, heading: 0 }) },
      renderFullMapStatic: (_context, viewport) => { view = viewport; }
    });
    map.resizeFullCanvas();
    map.renderFullMap();

    for (const point of [{ x: 200, z: -300 }, { x: 325, z: -375 }]) {
      // Convert the renderer's centred coordinates through the canvas backing store to CSS pixels.
      const screenX = (view.toX(point.x) + view.w / 2) * view.dpr * width / map.fullCanvas.width;
      const screenY = (view.toY(point.z) + view.h / 2) * view.dpr * height / map.fullCanvas.height;
      const clicked = map.screenToWorld(screenX, screenY, width, height);
      // The pixel budget can yield a fractional DPR; integer backing sizes may round by less than one pixel.
      const tolerance = 1 / (view.s * view.dpr);
      assert.ok(Math.abs(clicked.x - point.x) < tolerance, `clicked x ${clicked.x} should match drawn x ${point.x}`);
      assert.ok(Math.abs(clicked.z - point.z) < tolerance, `clicked z ${clicked.z} should match drawn z ${point.z}`);
    }
  });
}

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    dispatch(type, event = {}) {
      for (const listener of listeners.get(type) || []) listener(event);
    }
  };
}

function classList() {
  const names = new Set();
  return {
    add: (name) => names.add(name),
    remove: (name) => names.delete(name),
    contains: (name) => names.has(name),
    toggle(name, enabled) { if (enabled) names.add(name); else names.delete(name); }
  };
}

function mapHarness() {
  const window = { ...eventTarget(), innerWidth: 200, innerHeight: 200 };
  const canvas = {
    ...eventTarget(), style: {}, clientWidth: 200, clientHeight: 200,
    getContext: () => ({}),
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 200, height: 200 })
  };
  const controls = eventTarget();
  const wrapper = { classList: classList() };
  const zoomIn = eventTarget(), zoomOut = eventTarget();
  const elements = {
    'fullmap-canvas': canvas, 'fullmap-canvas-wrap': wrapper,
    'fullmap-modal': { classList: classList() },
    'map-zoom-in': zoomIn, 'map-zoom-out': zoomOut
  };
  const document = {
    ...eventTarget(), hidden: false,
    getElementById: (id) => elements[id] || null,
    querySelectorAll: () => []
  };
  const captured = new Set();
  canvas.setPointerCapture = (id) => captured.add(id);
  canvas.hasPointerCapture = (id) => captured.has(id);
  canvas.releasePointerCapture = (id) => {
    captured.delete(id);
    canvas.dispatch('lostpointercapture', { pointerId: id });
  };
  const clamps = [];
  const config = {
    ROADS: [], BLOCKS: [],
    CITY_LANDMARKS: [{ id: 'fara', name: 'Fara Poznańska', short: 'Fara', x: 5, z: 6 },
      { id: 'ratusz', name: 'Ratusz i Stary Rynek', short: 'Ratusz', x: 1, z: 2 }],
    LANDMARK_SITES: {},
    CITY_BOUNDS: { minX: -10000, maxX: 10000, minZ: -10000, maxZ: 10000 },
    // snaps every tap 12 m east, so the tests see that teleports go through it with both coordinates
    clampToLand: (x, z, margin) => {
      clamps.push([x, z, margin]);
      return { x: x + 12, z };
    },
    LAND_RINGS: [], LAND_HOLES: [], WATER: [], OUTSKIRTS: [], OUTSKIRTS_HOLES: [], PLAZAS: [], BRIDGES: [], RAIL: [],
    LABEL_ALIAS: {},
    foldText: (text) => String(text).toLowerCase(),
    mapCaps: (text) => String(text).toUpperCase(),
    formatCount: String,
    getLocationLabel: (x, z) => `${x}, ${z}`,
    isTypingInField: () => false
  };
  const { CityMapSystem } = loadModule(source, {
    globals: { window, document },
    imports: {
      './geodata.js': { GEO: { frame: {}, labels: [{ name: 'Stare Miasto', kind: 'suburb', x: 0, z: 0 }] } },
      './city-config.js': config
    }
  });
  const teleports = [], toggles = [];
  const map = new CityMapSystem({
    controllerManager: { getActiveEntity: () => ({ position: { x: 1000, z: 2000 } }) },
    onTeleport: (x, z) => teleports.push([x, z]),
    onToggle: (open) => toggles.push(open)
  });
  // Exercise the real viewport/input state without drawing the map's geographic layers.
  map.renderFullMap = () => {};
  map.viewZoom = 1;
  map.toggleFullMap(true);
  return {
    map, canvas, controls, wrapper, window, document, captured, teleports, toggles, clamps, zoomIn, zoomOut,
    pointer(target, type, id, x = 110, y = 120, pointerType = 'touch', button = 0) {
      const event = { pointerId: id, clientX: x, clientY: y, pointerType, button, preventDefault() {} };
      (captured.has(id) ? canvas : target).dispatch(type, event);
      window.dispatch(type, event);
    }
  };
}

test('unrelated touches cannot move or release the map pan', () => {
  const h = mapHarness();
  assert.equal(h.canvas.style.touchAction, 'none');
  h.pointer(h.canvas, 'pointerdown', 1);
  h.pointer(h.controls, 'pointerdown', 2);
  h.pointer(h.canvas, 'pointerdown', 3);
  h.pointer(h.controls, 'pointermove', 2, 190);
  h.pointer(h.canvas, 'pointermove', 3, 190);
  h.pointer(h.controls, 'pointerup', 2);
  h.pointer(h.canvas, 'pointercancel', 3);
  assert.equal(h.map.viewCenterX, 1000);
  assert.equal(h.map.isPanning, true);
  assert.equal(h.teleports.length, 0);

  h.pointer(h.controls, 'pointermove', 1, 130);
  assert.equal(h.map.viewCenterX, 980);
  h.pointer(h.controls, 'pointerup', 1, 130);
  assert.equal(h.map.isPanning, false);
  assert.equal(h.wrapper.classList.contains('is-panning'), false);
  assert.equal(h.teleports.length, 0);
});

test('the default waypoint is the Ratusz', () => {
  const h = mapHarness();
  assert.deepEqual({ ...h.map.waypoint }, { x: 1, z: 2, name: 'Ratusz i Stary Rynek' });
});

test('a normal map tap teleports once, onto land clear of the water, and releases capture', () => {
  const h = mapHarness();
  h.pointer(h.canvas, 'pointerdown', 1);
  h.pointer(h.canvas, 'pointerup', 1);
  assert.deepEqual(h.clamps, [[1000, 2000, 12]], 'the tapped point is clamped 12 m clear of the water');
  assert.deepEqual(h.teleports, [[1012, 2000]]);
  assert.equal(h.map.waypoint.x, 1012);
  assert.equal(h.map.waypoint.name, '1012, 2000');
  assert.equal(h.captured.size, 0);
  assert.equal(h.map.isPanning, false);
});

for (const interruption of ['pointercancel', 'lostpointercapture', 'blur', 'hidden', 'close']) {
  test(`${interruption} cancels a map tap without teleporting or leaving a drag active`, () => {
    const h = mapHarness();
    h.pointer(h.canvas, 'pointerdown', 1);
    if (interruption === 'blur') h.window.dispatch('blur');
    else if (interruption === 'hidden') {
      h.document.hidden = true;
      h.document.dispatch('visibilitychange');
    } else if (interruption === 'close') h.map.toggleFullMap(false);
    else if (interruption === 'lostpointercapture') h.canvas.releasePointerCapture(1);
    else h.pointer(h.canvas, interruption, 1);
    h.pointer(h.canvas, 'pointerup', 1);
    assert.equal(h.teleports.length, 0);
    assert.equal(h.map.isPanning, false);
    assert.equal(h.captured.size, 0);
    assert.equal(h.wrapper.classList.contains('is-panning'), false);
    if (interruption === 'close') {
      assert.deepEqual(h.toggles, [true, false]);
      h.map.toggleFullMap(true);
    }
    h.pointer(h.canvas, 'pointerdown', 2);
    h.pointer(h.canvas, 'pointerup', 2);
    assert.equal(h.teleports.length, 1);
  });
}

test('a pointer released outside the map or far from its start does not teleport', () => {
  const h = mapHarness();
  h.pointer(h.canvas, 'pointerdown', 1, 205);
  h.pointer(h.controls, 'pointerup', 1, 215);
  h.pointer(h.canvas, 'pointerdown', 2, 110);
  h.pointer(h.canvas, 'pointerup', 2, 130);
  assert.equal(h.teleports.length, 0);
});

test('mouse hover and zoom buttons remain available without a pan', () => {
  const h = mapHarness();
  h.pointer(h.canvas, 'pointermove', 1, 120, 130, 'mouse');
  assert.equal(h.map.hoverWorld.x, 1010);
  assert.equal(h.map.hoverWorld.z, 2010);
  h.pointer(h.canvas, 'pointermove', 2, 180, 130);
  assert.equal(h.map.hoverWorld.x, 1010, 'untracked touch does not update hover');
  h.zoomIn.dispatch('click');
  assert.equal(h.map.viewZoom, 1.45);
  h.zoomOut.dispatch('click');
  assert.equal(h.map.viewZoom, 1);
});

function routeModule() {
  return loadModule(source, {
    imports: { './geodata.js': { GEO: {} }, './city-config.js': { ROADS: [], LABEL_ALIAS: {} } }
  });
}

// A 3 x 3 block of junctions 100 m apart (ids row by row from the north-west), with directed edges as road-network.js
// returns them; the middle of the east column is missing, so the way down the east side detours through the centre.
// Node 9 stands apart, with no edges.
function routeNetwork() {
  const nodes = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) nodes.push({ x: c * 100, z: r * 100 });
  nodes.push({ x: 5000, z: 5000 });
  // one way each: the GPS treats them as two-way
  const links = [[0, 1], [1, 2], [3, 4], [6, 7], [7, 8], [0, 3], [3, 6], [1, 4], [4, 7], [4, 5]];
  return { nodes, edges: links.map(([a, b]) => ({ from: nodes[a], to: nodes[b] })) };
}

function routeState(network, waypoint) {
  return {
    network, waypoint, routeGraph: undefined, routeTree: null, routeNodes: [], routeStart: -1,
    routeFrom: { x: NaN, z: NaN }, routeTo: { x: NaN, z: NaN }
  };
}

test('the GPS route follows the shortest way along the road graph', () => {
  const { buildRouteGraph, nearestNode, routeTree, routePath } = routeModule();
  const graph = buildRouteGraph(routeNetwork());
  assert.equal(graph.n, 10);
  assert.equal(nearestNode(graph, 190, 12), 2);
  assert.equal(nearestNode(graph, 4000, 4000), 9);
  assert.equal(nearestNode(graph, 4000, 4000, 300), -1, 'nothing within reach');
  const tree = routeTree(graph, 8);
  assert.equal(tree.dist[2], 400, 'from the north-east corner: west to 1, then south via 4 and 7 to 8');
  assert.deepEqual(routePath(tree, 2, []).slice(), [2, 1, 4, 7, 8]);
  assert.deepEqual(routePath(tree, 5, []).slice(), [5, 4, 7, 8]);
  assert.deepEqual(routePath(tree, 8, []).slice(), [8]);
  const out = [1, 2, 3];
  assert.equal(routePath(tree, 9, out), out, 'fills the caller\'s array');
  assert.equal(out.length, 0, 'no way from an unconnected node');
  assert.equal(buildRouteGraph(null), null);
  assert.equal(buildRouteGraph({ nodes: [], edges: [] }), null);
});

test('the GPS route is cached per destination and re-snapped only when the player moves', () => {
  const { CityMapSystem } = routeModule();
  const map = Object.assign(Object.create(CityMapSystem.prototype), routeState(routeNetwork(), { x: 210, z: 190 }));
  map.updateRoute(195, 3);
  assert.deepEqual(map.routeNodes.slice(), [2, 1, 4, 7, 8]);
  const tree = map.routeTree;
  const nodes = map.routeNodes;
  map.updateRoute(197, 5);
  assert.equal(map.routeFrom.x, 195, 'small moves do not re-snap the player');
  map.updateRoute(110, 0);
  assert.deepEqual(map.routeNodes.slice(), [1, 4, 7, 8]);
  assert.equal(map.routeNodes, nodes, 'the path array is reused');
  map.waypoint = { x: 205, z: 205 };
  map.updateRoute(110, 0);
  assert.equal(map.routeTree, tree, 'a waypoint at the same node keeps its shortest-path tree');
  map.waypoint = { x: 0, z: 0 };
  map.updateRoute(110, 0);
  assert.notEqual(map.routeTree, tree);
  assert.deepEqual(map.routeNodes.slice(), [1, 0]);
  map.waypoint = { x: 1500, z: 1500 };
  map.updateRoute(110, 0);
  assert.equal(map.routeNodes.length, 0, 'a waypoint far from any road gets a straight line');

  const bare = Object.assign(Object.create(CityMapSystem.prototype), routeState(null, { x: 0, z: 0 }));
  bare.updateRoute(100, 100);
  assert.equal(bare.routeGraph, null);
  assert.equal(bare.routeNodes.length, 0, 'without a network the route runs straight to the waypoint');
});

test('the map compass tooltip states the grid bearing', () => {
  const { compassTitle } = routeModule();
  assert.equal(compassTitle(29.02), 'Północ geograficzna · siatka ulic jest odchylona o 29° na wschód');
  assert.equal(compassTitle(-12.6), 'Północ geograficzna · siatka ulic jest odchylona o 13° na zachód');
  assert.equal(compassTitle(0.2), 'Północ geograficzna');
});

test('pluralPl inflects Polish nouns correctly for 1, few and many', () => {
  const { pluralPl } = routeModule();
  assert.equal(pluralPl(1, 'ulica', 'ulice', 'ulic'), 'ulica');
  assert.equal(pluralPl(2, 'ulica', 'ulice', 'ulic'), 'ulice');
  assert.equal(pluralPl(4, 'ulica', 'ulice', 'ulic'), 'ulice');
  assert.equal(pluralPl(5, 'ulica', 'ulice', 'ulic'), 'ulic');
  assert.equal(pluralPl(12, 'ulica', 'ulice', 'ulic'), 'ulic');
  assert.equal(pluralPl(14, 'ulica', 'ulice', 'ulic'), 'ulic');
  assert.equal(pluralPl(22, 'ulica', 'ulice', 'ulic'), 'ulice');
  assert.equal(pluralPl(25, 'ulica', 'ulice', 'ulic'), 'ulic');
  assert.equal(pluralPl(733, 'ulica', 'ulice', 'ulic'), 'ulice');
  assert.equal(pluralPl(1422, 'kwartał', 'kwartały', 'kwartałów'), 'kwartały');
  assert.equal(pluralPl(1425, 'kwartał', 'kwartały', 'kwartałów'), 'kwartałów');
});

// A polyline from (x0, z0) heading `deg` degrees (atan2 convention: 0 east, 90 south) through `n` steps of `step` metres,
// turning `turn` degrees at every vertex
function polyline(x0, z0, deg, n, step, turn = 0) {
  const pts = [{ x: x0, z: z0 }];
  let a = deg * Math.PI / 180;
  for (let i = 0; i < n; i++) {
    const p = pts[pts.length - 1];
    pts.push({ x: p.x + Math.cos(a) * step, z: p.z + Math.sin(a) * step });
    a += turn * Math.PI / 180;
  }
  return pts;
}

test('street labels are spread by arc length and turned along a straight street, never upside down', () => {
  const { roadLabelAnchors } = routeModule();
  const east = roadLabelAnchors(polyline(0, 0, 0, 25, 40));
  assert.deepEqual([...east.map((a) => Math.round(a.x))], [125, 375, 625, 875], 'one name per 250 m share, mid-share');
  for (const a of east) {
    assert.ok(Math.abs(a.z) < 1e-9 && Math.abs(a.ang) < 1e-9);
    assert.ok(a.len >= 250 - 1e-6, 'the straight span is measured both ways from the anchor');
  }
  const west = roadLabelAnchors(polyline(1000, 0, 180, 25, 40));
  assert.ok(west.every((a) => Math.abs(a.ang) < 1e-9), 'westbound names read left to right');
  const south = roadLabelAnchors(polyline(0, 0, 90, 10, 40));
  assert.ok(south.every((a) => Math.abs(a.ang + Math.PI / 2) < 1e-9), 'vertical names read upwards');
  assert.equal(roadLabelAnchors(polyline(0, 0, 0, 1, 15)).length, 0, 'too short for a name');
});

test('street labels follow a curve and keep off sharp bends', () => {
  const { roadLabelAnchors } = routeModule();
  // an L: 300 m east, then 300 m south
  const corner = roadLabelAnchors([{ x: 0, z: 0 }, { x: 300, z: 0 }, { x: 300, z: 300 }]);
  assert.equal(corner.length, 2);
  for (const a of corner) {
    const along = a.z === 0 ? 300 - a.x : a.z;
    assert.ok(a.len / 2 <= along + 1e-6, `the label at (${a.x}, ${a.z}) does not reach round the corner`);
  }
  assert.ok(Math.abs(corner[0].ang) < 1e-9 && Math.abs(corner[1].ang + Math.PI / 2) < 1e-9);
  // a gentle arc (1° per 10 m vertex, radius ≈ 573 m): each name is turned to the street's direction where it sits
  const arc = polyline(0, 0, 0, 120, 10, 1);
  const anchors = roadLabelAnchors(arc);
  assert.ok(anchors.length >= 4);
  for (const a of anchors) {
    let i = 0;
    let best = Infinity;
    arc.forEach((p, j) => {
      const d = Math.hypot(p.x - a.x, p.z - a.z);
      if (d < best) { best = d; i = j; }
    });
    let tangent = Math.atan2(arc[Math.min(i + 1, arc.length - 1)].z - arc[Math.max(i - 1, 0)].z,
      arc[Math.min(i + 1, arc.length - 1)].x - arc[Math.max(i - 1, 0)].x);
    if (tangent >= Math.PI / 2 - 0.01) tangent -= Math.PI;
    else if (tangent < -Math.PI / 2 - 0.01) tangent += Math.PI;
    assert.ok(best < 10 && Math.abs(a.ang - tangent) < 0.05, `anchor at ${i} turned ${a.ang} vs ${tangent}`);
    assert.ok(a.len > 100 && a.len < 500, 'the span stops where the arc has turned ~11° either way');
  }
  // a hairpin turning 30° per 5 m vertex has no straight stretch long enough for a name
  assert.equal(roadLabelAnchors(polyline(0, 0, 0, 12, 5, 30)).length, 0);
});

test('pieces of one street are chained end to end, but not through a fork', () => {
  const { chainRoadPieces } = routeModule();
  const p = (x, z) => ({ x, z });
  // a, b reversed, c: one street of three pieces; d and e fork from c's far end
  const pieces = [[p(0, 0), p(100, 0)], [p(200, 0), p(100.2, 0)], [p(200, 0), p(300, 0)],
    [p(300, 0), p(400, 50)], [p(300, 0), p(400, -50)]];
  const chains = chainRoadPieces(pieces);
  assert.equal(chains.length, 3);
  assert.deepEqual([...chains[0].pieces].sort(), [0, 1, 2]);
  assert.deepEqual([...chains[0].pts.map((q) => q.x)], [0, 100, 200, 300], 'b is reversed to run on from a');
  assert.deepEqual(Array.from(chains.slice(1), (c) => [...c.pieces]), [[3], [4]]);
});

test('every element the map looks up exists in index.html, and the legend names only what the map draws', () => {
  const html = readFileSync(join(__dirname, '../index.html'), 'utf8');
  const ids = [...source.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(ids.length > 10);
  for (const id of new Set(ids)) assert.ok(html.includes(`id="${id}"`), `#${id} is missing from index.html`);
  // Poznań's GEO.roads flags no expressway, so the map has no highway layer for the legend to name
  const legend = html.slice(html.indexOf('id="fullmap-legend"'), html.indexOf('id="fullmap-counts"'));
  assert.doesNotMatch(legend, /Hwy|Highway/i);
  assert.doesNotMatch(source, /\.highways?\b/);
});

test('Grunwald and Winogrady are labelled over their osiedla, whatever way the rings wind', async () => {
  const { districtGroupLabels, DISTRICT_GROUPS } = routeModule();
  // a 100 m square and a 200 m one wound the other way (centroids (50, 50) and (400, 100)), plus one outside the group:
  // the title sits 4:1 towards the larger square
  const districts = [
    { name: 'A', ring: [0, 0, 100, 0, 100, 100, 0, 100] },
    { name: 'B', ring: [300, 0, 300, 200, 500, 200, 500, 0] },
    { name: 'C', ring: [9000, 9000, 9010, 9000, 9010, 9010] }
  ];
  const [label] = districtGroupLabels(districts, { AB: ['A', 'B', 'missing'] });
  assert.equal(label.name, 'AB');
  assert.equal(label.kind, 'suburb');
  assert.ok(Math.abs(label.x - 330) < 1e-6 && Math.abs(label.z - 90) < 1e-6, `${label.x}, ${label.z}`);

  // On the real districts, each title lands inside one of its own osiedla
  const { GEO } = await import('../js/geodata.js');
  const { districtAt } = await import('../js/city-config.js');
  const labels = districtGroupLabels(GEO.districts, DISTRICT_GROUPS);
  assert.deepEqual(Array.from(labels, (l) => l.name), ['Grunwald', 'Winogrady']);
  for (const l of labels) {
    assert.ok(DISTRICT_GROUPS[l.name].includes(districtAt(l.x, l.z)), `${l.name} lands in ${districtAt(l.x, l.z)}`);
  }

  // A name OSM already places (GEO.labels) gets no second title: the 8.2 × 5.7 km box takes in OSM's place=suburb nodes
  // for both, so the map draws each once, at OSM's point, inside one of its osiedla
  assert.equal(districtGroupLabels(districts, { AB: ['A', 'B'] }, [{ name: 'AB', kind: 'suburb', x: 0, z: 0 }]).length, 0);
  for (const name of ['Grunwald', 'Winogrady']) {
    const osm = GEO.labels.filter((l) => l.name === name);
    assert.equal(osm.length, 1, `${name} placed once by OSM`);
    assert.ok(DISTRICT_GROUPS[name].includes(districtAt(osm[0].x, osm[0].z)), `${name} lands in ${districtAt(osm[0].x, osm[0].z)}`);
  }
  assert.equal(districtGroupLabels(GEO.districts, DISTRICT_GROUPS, GEO.labels).length, 0);
});

test('landmark pins that would overlap merge into one dot under the top-ranked pin and split as you zoom in', async () => {
  const { CityMapSystem } = routeModule();
  const { CITY_LANDMARKS } = await import('../js/city-config.js');
  const groupsAt = (s) => CityMapSystem.clusterPins(CITY_LANDMARKS.map((lm) => ({ lm, lx: lm.x * s, ly: lm.z * s })));
  const ids = (g) => Array.from(g.members, (l) => l.id);
  for (const s of [0.05, 0.1, 0.2, 0.5, 1, 2]) {
    const groups = groupsAt(s);
    assert.equal(groups.reduce((n, g) => n + g.members.length, 0), CITY_LANDMARKS.length, 'every pin is drawn once');
    for (const g of groups) {
      assert.equal(g.lm, g.members[0], 'a group is drawn at its top-ranked pin');
      for (const l of g.members) assert.ok(CITY_LANDMARKS.indexOf(l) >= CITY_LANDMARKS.indexOf(g.lm));
    }
    // no two dots drawn closer than their halos
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const d = Math.hypot(groups[i].lx - groups[j].lx, groups[i].ly - groups[j].ly);
        assert.ok(d >= 14, `${groups[i].lm.id} and ${groups[j].lm.id} ${d.toFixed(1)} px apart at ${s} px/m`);
      }
    }
  }
  // City-wide: Stary Rynek is one Ratusz dot, the Andersia group one Andersia dot
  const rynek = groupsAt(0.1).find((g) => g.lm.id === 'ratusz');
  for (const id of ['domki', 'wieza']) assert.ok(ids(rynek).includes(id), `${id} merges into the Ratusz`);
  const andersia = groupsAt(0.1).find((g) => g.lm.id === 'andersia');
  for (const id of ['and2', 'pfc']) assert.ok(ids(andersia).includes(id), `${id} merges into Andersia`);
  // further out the whole group, Novotel too, is one dot (with the higher-ranked Stary Browar, 160 m off)
  const towers = groupsAt(0.05).find((g) => g.members.some((l) => l.id === 'andersia'));
  for (const id of ['and2', 'pfc', 'novotel']) assert.ok(ids(towers).includes(id), `${id} merges at 0.05 px/m`);
  // Close in, every landmark has its own dot
  assert.equal(groupsAt(1).length, CITY_LANDMARKS.length);
});
