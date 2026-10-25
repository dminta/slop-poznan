const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const source = readFileSync(join(__dirname, '../js/nyc-map.js'), 'utf8');

for (const [width, height, dpr] of [[500, 300, 1], [320, 180, 1.5], [1920, 1080, 2]]) {
  test(`map clicks match rendered world positions at ${width}x${height}, DPR ${dpr}`, () => {
    const window = { innerWidth: width, innerHeight: height, devicePixelRatio: dpr };
    const { NYCMapSystem } = loadModule(source, {
      globals: { window, performance: { now: () => 0 } },
      imports: { './nyc-geodata.js': { GEO: {} }, './city-config.js': { ROADS: [], AREA_LABELS: [], LABEL_ALIAS: {} } }
    });
    const map = Object.create(NYCMapSystem.prototype);
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
  const config = {
    ROADS: [], BLOCKS: [], NYC_LANDMARKS: [],
    CITY_BOUNDS: { minX: -10000, maxX: 10000, minZ: -10000, maxZ: 10000 },
    clampToLand: (x, z) => ({ x, z }),
    LAND_RINGS: [],
    AREA_LABELS: [['Stare Miasto', 0, 0, 2]],
    LABEL_ALIAS: {},
    foldText: (text) => String(text).toLowerCase(),
    mapCaps: (text) => String(text).toUpperCase(),
    formatCount: String,
    getLocationLabel: (x, z) => `${x}, ${z}`,
    isTypingInField: () => false
  };
  const { NYCMapSystem } = loadModule(source, {
    globals: { window, document },
    imports: { './nyc-geodata.js': { GEO: { frame: {} } }, './city-config.js': config }
  });
  const teleports = [], toggles = [];
  const map = new NYCMapSystem({
    controllerManager: { getActiveEntity: () => ({ position: { x: 1000, z: 2000 } }) },
    onTeleport: (x, z) => teleports.push([x, z]),
    onToggle: (open) => toggles.push(open)
  });
  // Exercise the real viewport/input state without drawing the map's geographic layers.
  map.renderFullMap = () => {};
  map.viewZoom = 1;
  map.toggleFullMap(true);
  return {
    map, canvas, controls, wrapper, window, document, captured, teleports, toggles, zoomIn, zoomOut,
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

test('a normal map tap teleports once and releases capture', () => {
  const h = mapHarness();
  h.pointer(h.canvas, 'pointerdown', 1);
  h.pointer(h.canvas, 'pointerup', 1);
  assert.deepEqual(h.teleports, [[1000, 2000]]);
  assert.equal(h.map.waypoint.name, '1000, 2000');
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
    imports: { './nyc-geodata.js': { GEO: {} }, './city-config.js': { ROADS: [], AREA_LABELS: [], LABEL_ALIAS: {} } }
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
  const { NYCMapSystem } = routeModule();
  const map = Object.assign(Object.create(NYCMapSystem.prototype), routeState(routeNetwork(), { x: 210, z: 190 }));
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

  const bare = Object.assign(Object.create(NYCMapSystem.prototype), routeState(null, { x: 0, z: 0 }));
  bare.updateRoute(100, 100);
  assert.equal(bare.routeGraph, null);
  assert.equal(bare.routeNodes.length, 0, 'without a network the route runs straight to the waypoint');
});

test('the map compass tooltip states the grid bearing', () => {
  const { compassTitle } = routeModule();
  assert.equal(compassTitle(29.02), 'True north · the street grid runs 29° east of it');
  assert.equal(compassTitle(-12.6), 'True north · the street grid runs 13° west of it');
  assert.equal(compassTitle(0.2), 'True north');
});
