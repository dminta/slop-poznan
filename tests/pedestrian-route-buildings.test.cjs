const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const CROSSWALK = 4.3;
const CROSSWALK_REACH = 4;
const { createPedestrianRoutes } = loadModule(
  readFileSync(join(__dirname, '../js/pedestrian-routes.js'), 'utf8').replace(
    'return { along, across, next, crosswalks, segments, segmentsNear };',
    'return { along, across, next, crosswalks, segments, segmentsNear, links, fallbackPaths, crossings };'
  ),
  { imports: { './road-network.js': { CROSSWALK, CROSSWALK_REACH } } }
);

// A crosswalk-like landing whose ordinary corner links find nothing, so `links` must use the sparse fallback connector.
// The sidewalk track it reaches runs north-south 7.8 m to its right, and the whole area is one block with no lot rects:
// only a real building collider can stop the connector there. `startX` places the landing; `edgeX` the sidewalk edge.
function fallbackLinks(buildingColliders = null, startX = 0.5, edgeX = 10) {
  const block = { poly: [{ x: -100, z: 3 }, { x: 100, z: 3 }, { x: 100, z: -3 }, { x: -100, z: -3 }], rects: [] };
  const edge = { sx: edgeX, sz: -100, dx: 0, dz: 1, rx: -1, rz: 0, len: 200, half: 0 };
  const node = { x: 0, z: 0, signal: false, arms: [], in: [], out: [] };
  const track = { ax: startX - 0.5, az: 0, ux: 1, uz: 0, len: 0.5, node, side: 0, sides: null, group: 0, line: 0,
    from: node, to: node };
  const routes = createPedestrianRoutes({ nodes: [node], edges: [edge], walkable: () => true }, () => block, null,
    buildingColliders);
  return routes.links(track, 1);
}

// A landing whose node has one sidewalk port on the far side of a block seam. Base links reject it (the port's end is
// far and on another block), so only the fallback direct loop can join it; that loop is the one with the 8 m limits.
function directLinks({ startX = 0.5, edgeX = 10, halfZ = 6, wall = null, rail = null } = {}) {
  const blockA = { poly: [{ x: -100, z: halfZ }, { x: 100, z: halfZ }, { x: 100, z: -halfZ }, { x: -100, z: -halfZ }],
    rects: [] };
  const blockB = { poly: [{ x: 5, z: halfZ }, { x: 200, z: halfZ }, { x: 200, z: -halfZ }, { x: 5, z: -halfZ }],
    rects: [] };
  const edge = { sx: edgeX, sz: -100, dx: 0, dz: 1, rx: -1, rz: 0, len: 100.5, half: 0, from: null, to: null };
  const node = { x: 0, z: 0, signal: false, arms: [], in: [], out: [edge] };
  edge.to = node;
  const track = { ax: startX - 0.5, az: 0, ux: 1, uz: 0, len: 0.5, node, side: 0, sides: null, group: 0, line: 0,
    from: node, to: node };
  const routes = createPedestrianRoutes({ nodes: [node], edges: [edge], walkable: () => true },
    (x) => (x >= 5 ? blockB : blockA), rail, wall ? [wall] : null);
  return routes.links(track, 1);
}

// A landing with one crosswalk-like port 12 m away across a block seam. The direct loop skips it (over 8 m); the
// 32 m long loop must keep the 5 m corridor, not inherit the direct link's 8 m. `crossings` is seeded after creation,
// so the fake layout is the one `ports()` reads.
function longFallback(halfZ) {
  const blockA = { poly: [{ x: -100, z: halfZ }, { x: 100, z: halfZ }, { x: 100, z: -halfZ }, { x: -100, z: -halfZ }],
    rects: [] };
  const blockB = { poly: [{ x: 5, z: halfZ }, { x: 200, z: halfZ }, { x: 200, z: -halfZ }, { x: 5, z: -halfZ }],
    rects: [] };
  const node = { x: 0, z: 0, signal: false, arms: [], in: [], out: [] };
  const landing = { ax: 0, az: 0, ux: 1, uz: 0, len: 0.5, node, side: 0, sides: null, group: 0, line: 0,
    from: node, to: node };
  const port = { ax: 12.5, az: 0.5, ux: 1, uz: 0, len: 0.1, node, side: 1, sides: null, group: 0, line: 0.75,
    from: node, to: node };
  const routes = createPedestrianRoutes({ nodes: [node], edges: [], walkable: () => true },
    (x) => (x >= 5 ? blockB : blockA));
  routes.crossings.set(node, [port]);
  return routes.fallbackPaths(landing, 1);
}

test('fallback pedestrian connectors reject real building colliders outside the lot rects', () => {
  assert.ok(fallbackLinks().length > 0, 'the unblocked landing connects to the nearby sidewalk');
  const wall = { minX: 4, maxX: 5, minZ: -1, maxZ: 1, minY: 0, maxY: 12 };
  assert.equal(fallbackLinks([wall]).length, 0, 'an axis-aligned wall blocks the connector');
  const turned = { minX: 3, maxX: 6, minZ: -2, maxZ: 2, minY: 0, maxY: 12,
    obb: { cx: 4.5, cz: 0, hx: 1.5, hz: 0.2, cs: Math.SQRT1_2, sn: Math.SQRT1_2 } };
  assert.equal(fallbackLinks([turned]).length, 0, 'a turned wall blocks the connector');
  const overhead = { minX: 4, maxX: 5, minZ: -1, maxZ: 1, minY: 2.0, maxY: 12 };
  assert.ok(fallbackLinks([overhead]).length > 0, 'a collider above the 1.9 m pedestrian clears the connector');
  const low = { minX: 4, maxX: 5, minZ: -1, maxZ: 1, minY: 1.8, maxY: 12 };
  assert.equal(fallbackLinks([low]).length, 0, 'an underside below the pedestrian height blocks it');
});

test('the OBB cell index covers the pad-sqrt(2) reach across a 32 m cell edge', () => {
  // The landing at x = 32.05 sits inside a turned wall's 0.4 m pad (its local x is 3.389 m against hx = 3), but the
  // wall's world AABB plus the unrotated pad ends at 31.9, in the previous 32 m cell. Only the wider OBB index files
  // this point into the landing's cell, so the connector is rejected instead of slipping through the cell edge.
  const wall = { minX: 23.014, maxX: 31.5, minZ: -4.243, maxZ: 4.243, minY: 0, maxY: 12,
    obb: { cx: 27.257, cz: 0, hx: 3, hz: 3, cs: Math.SQRT1_2, sn: Math.SQRT1_2 } };
  assert.ok(fallbackLinks().length > 0, 'the unblocked landing connects');
  assert.equal(fallbackLinks([wall], 32.05, 41).length, 0, 'the corner in the next cell still blocks');
});

test('a direct landing link reaches 8 m inside a wide block, but no farther', () => {
  // The nearest sidewalk port is 6.7 m from the landing. In a 12 m-wide block both points are 6 m from its edge, so
  // the old 5 m direct corridor rejected the link and the 5 m fallback corridor did too; the 8 m direct corridor keeps
  // it in the edge band. At 8.7 m the direct length limit rejects it, and in a 17 m-wide block the 8 m corridor does.
  const paths = directLinks();
  assert.ok(paths.length > 0, 'the 6.7 m direct link connects');
  assert.ok(paths.every((p) => p[0].track.len <= 8), 'and stays inside the 8 m direct limit');
  assert.equal(directLinks({ edgeX: 12 }).length, 0, '8.7 m is too long for a direct link');
  assert.equal(directLinks({ halfZ: 8.5 }).length, 0, 'a connector 8.5 m from the block edge is not direct');
  const wall = { minX: 3.5, maxX: 4.5, minZ: -1, maxZ: 1, minY: 0, maxY: 12 };
  assert.equal(directLinks({ wall }).length, 0, 'the wider corridor still rejects a building wall');
  const railAt = (z) => (_x, zz, r) => Math.min(r, Math.abs(zz - z));
  assert.equal(directLinks({ rail: railAt(2.2) }).length, 0, 'a track 1.7 m from the connector blocks it (2 m keep)');
  assert.ok(directLinks({ rail: railAt(2.7) }).length > 0, 'a track 2.2 m away clears it');
});

test('long fallback links keep the tighter 5 m corridor', () => {
  assert.ok(longFallback(4).length > 0, 'the 12 m link inside a 4 m edge band still connects');
  assert.equal(longFallback(6).length, 0, 'and the same link 6 m from the edge is not widened with the direct limit');
});

