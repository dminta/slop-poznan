const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { loadModule } = require('./helpers/module.cjs');

const trafficSource = readFileSync(join(__dirname, '../js/traffic.js'), 'utf8');

function trafficFunction(name) {
  const match = trafficSource.match(new RegExp(`  function ${name}\\([^]*?\\n  \\}`));
  assert.ok(match, `${name} is present`);
  return match[0];
}

// The pedestrian-only ways (Półwiejska, Wrocławska, the Stary Rynek lanes) are not curb islands: blockAt() is null
// along them, and the ordinary sidewalk builder never sees them. They get their own walking lines, joined at their
// ends to the sidewalk/crosswalk ends and to each other.
async function wayRoutes() {
  const config = await import('../js/city-config.js');
  const { createPedestrianRoutes } = loadModule(
    readFileSync(join(__dirname, '../js/pedestrian-routes.js'), 'utf8'),
    { imports: { './road-network.js': { CROSSWALK: 4.3, CROSSWALK_REACH: 4 } }, filename: 'pedestrian-routes.js' }
  );
  return createPedestrianRoutes(
    { nodes: [], edges: [], walkable: () => true }, () => null, null, null, config.PEDESTRIAN_WAYS
  );
}

test('Półwiejska and Wrocławska carry live pedestrian tracks, not only crosswalks', async () => {
  const routes = await wayRoutes();
  for (const name of ['Półwiejska', 'Wrocławska']) {
    const tracks = routes.ways.filter((track) => track.wayName === name);
    assert.ok(tracks.length > 0, `${name} has walking lines`);
    assert.ok(tracks.every((track) => track.way && track.len > 0 && track.insetLane === 3),
      `${name} lines are two-way walking tracks with a passing lane`);
  }
  const polwiejska = routes.waysNear(-300, 665, 40);
  assert.ok(polwiejska.some((track) => track.wayName === 'Półwiejska'), 'the street is found around its midpoint');
  const wroclawska = routes.waysNear(-60, 200, 80);
  assert.ok(wroclawska.some((track) => track.wayName === 'Wrocławska'), 'the street is found around its midpoint');
});

test('spawnPed can place a walker on a pedestrian-only street', async () => {
  const routes = await wayRoutes();
  const way = routes.ways.find((track) => track.wayName === 'Półwiejska');
  const midX = way.ax + way.ux * way.len * 0.5, midZ = way.az + way.uz * way.len * 0.5;
  const context = {
    Math: Object.assign(Object.create(Math), { random: () => 0.5 }),
    nearEdges: [], nearCrossings: [], nearWalks: [way], track: {}, KERB: 1.6, QUEUE_GAP: 0.62,
    focusX: midX, focusZ: midZ, player: { active: false }, clock: 0, PED_SPAWN_DISTANCE: 150,
    nearView: () => false, endConversation() {}, atCurb() {}
  };
  const spawnPed = vm.runInNewContext(
    `(function () {\n${trafficFunction('pedestrianStreetTrack')}\n${trafficFunction('spawnPed')}\nreturn spawnPed;\n})()`,
    context
  );
  const p = { crossesStreets: false, speed: 1.4, rig: {} };
  assert.equal(spawnPed(p, 0, 200, false), true);
  assert.equal(p.wayName, 'Półwiejska');
  assert.equal(p.route, way);
  assert.ok(p.len > 0 && p.v === p.speed, 'the walker starts along the street at walking pace');
});

test('refreshNear keeps pedestrian-only tracks around the focus', () => {
  const way = { ax: -230.5, az: 486.8, ux: 0, uz: 1, len: 20, way: true, wayName: 'Półwiejska' };
  const nearWalks = [];
  const context = {
    Math, clamp: (x, lo, hi) => Math.max(lo, Math.min(hi, x)),
    nearEdges: [], nearCrossings: [], nearWalks, crossingNodes: [], edges: [],
    focusX: way.ax, focusZ: way.az, nearX: Infinity, nearZ: Infinity,
    NEAR_RADIUS: 350, nearLanes: 0, nearTarget: 0, nearBusTarget: 0,
    vehicles: new Array(212), buses: [{ half: 6 }], MIN_VEHICLES: 30, VEHICLE_DENSITY: 12,
    pedRoutes: { waysNear: () => [way] }
  };
  vm.runInNewContext(`(${trafficFunction('refreshNear')})`, context)();
  assert.deepEqual(nearWalks, [way]);
});
