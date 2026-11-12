const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

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
    apply: () => inert(), construct: () => inert()
  });
}

function inside(poly, x, z) {
  let result = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) result = !result;
  }
  return result;
}

const area = (ring) => Math.abs(ring.reduce((sum, p, i) => {
  const q = ring[(i + 1) % ring.length];
  return sum + p.x * q.z - q.x * p.z;
}, 0)) / 2;

// The Teatr Polski site is the one place where city-grid draws lawns outside the 80 % part-park rule, cuts them with
// surveyed paths, and adds a car park with bay markings and its own furniture. This test builds the real
// grid and observes the polygons and player colliders it emits, rather than repeating the layout in the test.
test('the Teatr Polski lawns are drawn whole and the car park is furnished', async () => {
  const config = await import('../js/city-config.js');
  const { GEO } = await import('../js/geodata.js');
  const source = readFileSync(join(__dirname, '../js/city-grid.js'), 'utf8');
  const shapeMarker = 'const shape = createWorldXZShape(pts, holes);';
  const parkingMarker = 'group.add(createFlatPolygonMesh(ring, 0.232, roadMat));';
  const pathMarker = 'const mesh = createFlatPolygonMesh(path.ring, 0.238 + i * 0.0004, pavingMat);';
  for (const marker of [shapeMarker, parkingMarker, pathMarker]) assert.ok(source.includes(marker), marker);
  const lawns = [];
  const parking = [];
  const paths = [];
  const module = loadModule(source
    .replace(shapeMarker, 'recordPolygon(pts, bottomY, height);\n  ' + shapeMarker)
    .replace(parkingMarker, 'recordParking(ring); ' + parkingMarker)
    .replace(pathMarker, 'recordPath(path); ' + pathMarker), {
    imports: {
      'three/webgpu': inert(), 'three/tsl': inert(),
      'three/addons/utils/BufferGeometryUtils.js': inert(), './tsl-materials.js': inert(),
      './city-config.js': config, './geodata.js': { GEO }
    },
    globals: {
      console: { info() {}, warn() {}, log() {} },
      recordPolygon: (pts, bottom, height) => {
        if (Math.abs(bottom - 0.2) < 1e-9 && Math.abs(height - 0.06) < 1e-9) lawns.push(pts);
      },
      recordParking: (ring) => parking.push(ring),
      recordPath: (path) => paths.push(path)
    }
  });
  const grid = module.buildCityGrid(inert());

  // The three mapped lawns, with their real areas. Their south edges reach the 27 Grudnia kerb; the drawn pieces lose
  // only the 0.35 m pavement inset and the paths cut through them (portico walk, promenade, service driveway).
  const mapped = config.TEATR_POLSKI_LAWNS;
  assert.equal(mapped.length, 3, 'the three flagged OSM lawns');
  assert.equal(mapped.reduce((sum, p) => sum + p.area_m2, 0), 2288, 'mapped lawn area');
  const siteLawns = lawns.filter((ring) => ring.some((p) => p.x > -745 && p.x < -610 && p.z > 10 && p.z < 55));
  assert.ok(siteLawns.length >= 20, `the three lawns are drawn in pieces: ${siteLawns.length}`);
  const drawnArea = siteLawns.reduce((sum, ring) => sum + area(ring), 0);
  assert.ok(drawnArea > 1650, `the drawn lawns keep their full outlines, not slivers: ${drawnArea.toFixed(0)} m²`);
  for (const park of mapped) {
    for (const flat of park.rings) {
      const ring = [];
      for (let i = 0; i + 1 < flat.length; i += 2) ring.push({ x: flat[i], z: flat[i + 1] });
      const xs = ring.map((p) => p.x), zs = ring.map((p) => p.z);
      let samples = 0, covered = 0;
      for (let x = Math.min(...xs); x <= Math.max(...xs); x += 1.5) {
        for (let z = Math.min(...zs); z <= Math.max(...zs); z += 1.5) {
          if (!inside(ring, x, z)) continue;
          samples++;
          if (siteLawns.some((piece) => inside(piece, x, z))) covered++;
        }
      }
      assert.ok(samples > 100, 'the lawn outline is sampled');
      assert.ok(covered / samples > 0.6, `${park.area_m2} m² lawn keeps ${(100 * covered / samples).toFixed(0)} %`);
      assert.ok(covered / samples < 0.98, 'the paths are cut out of the lawn');
    }
  }

  // Parking: the three surveyed OSM polygons are drawn as asphalt, and the paths are the promenade, the portico axis
  // and the two halves of the service drive.
  assert.equal(parking.length, 3, 'three mapped car parks');
  assert.ok(parking.reduce((sum, ring) => sum + area(ring), 0) > 2800, 'the car parks cover their mapped ground');
  assert.equal(paths.length, 4, 'promenade, portico walk and two driveway halves');
  const promenade = paths.find((p) => p.name === 'promenada');
  assert.ok(promenade && promenade.ring.some((p) => p.x < -800) && promenade.ring.some((p) => p.x > -620),
    'the promenade runs from Okrąglak to Ratajczaka');

  // Player colliders: nine benches and the site lamps/planters; the bays stay empty (no parked-car boxes). The
  // portico corridor stays clear of all of them.
  const props = grid.propColliders;
  const carBoxes = props.filter((c) => c.obb && Math.abs(c.obb.hx - 0.98) < 1e-6 && Math.abs(c.obb.hz - 2.28) < 1e-6);
  assert.equal(carBoxes.length, 0, 'no parked cars stand in the bays');
  const benches = props.filter((c) => {
    const hx = c.obb ? c.obb.hx : (c.maxX - c.minX) * 0.5;
    const hz = c.obb ? c.obb.hz : (c.maxZ - c.minZ) * 0.5;
    const cx = c.obb ? c.obb.cx : (c.minX + c.maxX) * 0.5;
    const cz = c.obb ? c.obb.cz : (c.minZ + c.maxZ) * 0.5;
    return Math.abs(hx - 0.95) < 1e-6 && Math.abs(hz - 0.27) < 1e-6 &&
      cx > -745 && cx < -610 && cz > 15 && cz < 55;
  });
  assert.ok(benches.length >= 9, `benches on the promenade and forecourt: ${benches.length}`);
  const lamps = props.filter((c) => !c.obb && Math.abs(c.maxX - c.minX - 0.4) < 1e-6 &&
    c.minX > -745 && c.maxX < -610 && c.minZ > 15 && c.maxZ < 60);
  assert.ok(lamps.length >= 6, `site lamps: ${lamps.length}`);
  const planters = props.filter((c) => !c.obb && Math.abs(c.maxX - c.minX - 2.4) < 1e-6 &&
    c.minX > -715 && c.maxX < -685 && c.minZ > 25 && c.maxZ < 35);
  assert.equal(planters.length, 2, 'the two forecourt planters');
  const blocked = props.filter((c) => c.maxX > -705.6 && c.minX < -702.4 && c.maxZ > 18 && c.minZ < 40 &&
    (c.minY ?? 0) < 2);
  assert.equal(blocked.length, 0, 'the portico walk is clear of site furniture');

  // The garden trees and the plane rows: the nine surveyed crowns and at least twelve OSM promenade nodes feed the
  // normal mapped-tree placement (tree-distribution.test.cjs checks where they land).
  assert.equal(config.TEATR_POLSKI_GARDEN_TREES.length, 9, 'surveyed garden trees');
  const treeRibbon = config.TEATR_POLSKI_PROMENADE;
  const promenadeNodes = config.OSM_TREES.filter((t) => {
    let result = false;
    for (let i = 0, j = treeRibbon.length - 1; i < treeRibbon.length; j = i++) {
      const a = treeRibbon[i], b = treeRibbon[j];
      if ((a.z > t.z) !== (b.z > t.z) && t.x < (b.x - a.x) * (t.z - a.z) / (b.z - a.z) + a.x) result = !result;
    }
    return result;
  });
  assert.ok(promenadeNodes.length >= 12, `mapped trees on the promenade ribbon: ${promenadeNodes.length}`);
});
