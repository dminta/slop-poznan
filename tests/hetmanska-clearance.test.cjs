const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
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
    apply: () => inert(),
    construct: () => inert()
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

function laneSnapshot(net) {
  const rows = Array.from(net.edges, (e) => [e.sx, e.sz, e.dx, e.dz, e.len, ...e.lanes]);
  assert.ok(rows.length > 4000, `${rows.length} real road edges are compared`);
  assert.ok(rows.every((r) => r.length > 5 && r.every(Number.isFinite)), 'lane snapshots contain real numeric geometry');
  return rows;
}

function crossingSnapshot(routes) {
  const rows = Array.from(routes.crosswalks, (c) => [c.ax, c.az, c.bx, c.bz]);
  assert.ok(rows.length > 2000, `${rows.length} real pedestrian crossings are compared`);
  assert.ok(rows.every((r) => r.every(Number.isFinite)), 'crossing snapshots contain real endpoint coordinates');
  return rows;
}

let world;
test.before(async () => {
  const config = await import('../js/city-config.js');
  const { GEO } = await import('../js/geodata.js');
  const source = (name) => readFileSync(join(__dirname, '../js', name + '.js'), 'utf8');
  const rendering = {
    'three/webgpu': inert(), 'three/tsl': inert(),
    'three/addons/utils/BufferGeometryUtils.js': inert(), './tsl-materials.js': inert()
  };
  const raised = [];
  const globals = { console: { info() {}, warn() {}, log() {} } };
  // Observe real curb and sidewalk extrusion, including their holes, rather than testing only a new height rule.
  const marker = 'const shape = createWorldXZShape(pts, holes);';
  const snapshot = '\nexport function snapshot() { return { pavedPlazaRects, parkTreeSites, parkLampSites, sidewalkBlocks }; }';
  assert.ok(source('city-grid').includes(marker), 'the actual extrusion recording seam remains present');
  const gridModule = loadModule(source('city-grid').replace(marker,
    'recordPolygon(pts, bottomY, height, holes);\n  ' + marker) + snapshot, {
    imports: { ...rendering, './city-config.js': config, './geodata.js': { GEO } },
    globals: { ...globals, recordPolygon: (poly, bottom, height, holes) => {
      if (bottom < 0.23 && bottom + height >= 0.17) raised.push({ poly, holes, bottom, height });
    } }
  });
  const grid = gridModule.buildCityGrid(inert());
  const createRoad = (cityConfig) => loadModule(source('road-network'), {
    imports: { './city-config.js': cityConfig, './geodata.js': { GEO } }, globals
  });
  const road = createRoad(config);
  const network = road.buildRoadNetwork(grid.sidewalks, grid.footprints);
  // Replay the original island geometry while retaining every other current block. This catches any accidental
  // change to the rectangles handed to the road network when only an empty-lot curb island needs a track cut.
  const configSource = source('city-config');
  const cutStart = configSource.indexOf('// The surveyed Hetmańska/Dmowskiego island');
  const cutEnd = configSource.indexOf('// Spatial index of the blocks', cutStart);
  assert.ok(cutStart >= 0 && cutEnd > cutStart, 'the surveyed correction can be omitted for the original-world replay');
  const legacyConfigSource = (configSource.slice(0, cutStart) + configSource.slice(cutEnd)).replace(
    "'./geodata.js'", JSON.stringify(pathToFileURL(join(__dirname, '../js/geodata.js')).href));
  // Keep the 11.6 M-cell land raster in native ESM, just like the app; running it in a vm makes this replay slow.
  const uncutConfig = await import('data:text/javascript;base64,' + Buffer.from(legacyConfigSource).toString('base64'));
  const uncutRaised = [];
  const uncutGridModule = loadModule(source('city-grid').replace(marker,
    'recordPolygon(pts, bottomY, height, holes);\n  ' + marker) + snapshot, {
    imports: { ...rendering, './city-config.js': uncutConfig, './geodata.js': { GEO } },
    globals: { ...globals, recordPolygon: (poly, bottom, height) => uncutRaised.push({ poly, bottom, height }) }
  });
  const uncutGrid = uncutGridModule.buildCityGrid(inert());
  const uncutNetwork = createRoad(uncutConfig).buildRoadNetwork(uncutGrid.sidewalks, uncutGrid.footprints);
  const furnished = (cityConfig, grid0, module0) => {
    const furnishedRoad = createRoad(cityConfig);
    const liveGrid = { ...module0, ...module0.snapshot() };
    const details = loadModule(source('street-details'), {
      imports: { ...rendering, './city-config.js': cityConfig, './geodata.js': { GEO },
        './road-network.js': furnishedRoad, './city-grid.js': liveGrid,
        './trees.js': { createTreeField: () => ({ group: inert() }) } },
      globals: { ...globals, document: inert() }
    }).buildStreetDetails(inert());
    const net = furnishedRoad.buildRoadNetwork(grid0.sidewalks, [...grid0.footprints, ...details.footprints]);
    const routes = loadModule(source('pedestrian-routes'), {
      imports: { './road-network.js': furnishedRoad }, globals
    }).createPedestrianRoutes(net, cityConfig.blockAt, module0.railClearance);
    return { details, net, routes };
  };
  const actual = furnished(config, grid, gridModule);
  const original = furnished(uncutConfig, uncutGrid, uncutGridModule);
  const layout = loadModule(source('tram-infra'), {
    imports: { ...rendering, './city-config.js': config, './geodata.js': { GEO } }, globals
  }).layoutTramInfrastructure(network);
  world = { config, GEO, raised, grid, network, layout, uncutGrid, uncutNetwork, uncutRaised, actual, original };
});

test('Hetmańska/Dmowskiego rails stay at roadway height across the former curb conflict', () => {
  const beds = world.layout.beds.filter((p) => p.railIndex === 570 && p.s0 > 263 && p.s0 < 272);
  assert.equal(beds.length, 3, 'the original track pieces remain, including both formerly raised pieces');
  const raisedLength = beds.reduce((sum, p) => sum + (p.ground ? Math.hypot(p.bx - p.ax, p.bz - p.az) : 0), 0);
  assert.equal(raisedLength, 0, `${raisedLength.toFixed(3)} m of rail is lifted onto the curb island`);
  assert.ok(beds.every((p) => p.bed === 0), 'street-running rails remain flush without adding ballast');
});

test('the actual Hetmańska/Dmowskiego curb and sidewalk leave both rail heads uncovered', () => {
  const { GEO, raised } = world;
  const covered = (x, z) => raised.some(({ poly, holes }) => inside(poly, x, z) && !holes.some((h) => inside(h, x, z)));
  const track = GEO.rail[570].pts;
  const ax = track[2], az = track[3], bx = track[4], bz = track[5];
  const len = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / len, uz = (bz - az) / len;
  let samples = 0;
  for (let s = 0; s <= len; s += 0.1) {
    const x = ax + ux * s, z = az + uz * s;
    if (Math.hypot(x + 2446, z - 2204) > 7) continue;
    for (const offset of [-0.75, 0, 0.75]) {
      const px = x - uz * offset, pz = z + ux * offset;
      samples++;
      assert.ok(!covered(px, pz), `raised curb/slab buries a rail at ${px.toFixed(2)}, ${pz.toFixed(2)}`);
    }
  }
  assert.ok(samples > 200, `${samples} samples inspect the centreline and both rail heads`);
  // The opposite track also crosses the island: the union of both full-width corridors consumes this tiny slab.
  const curbArea = (polygons) => polygons.filter(({ poly, bottom, height }) => bottom === 0 && height === 0.18 &&
    poly.every((p) => p.x >= -2450 && p.x <= -2433 && p.z >= 2201 && p.z <= 2210.5))
    .reduce((sum, { poly }) => sum + Math.abs(poly.reduce((a, p, i) => {
      const q = poly[(i + 1) % poly.length];
      return a + p.x * q.z - q.x * p.z;
    }, 0)) / 2, 0);
  assert.equal(curbArea(world.uncutRaised), 47.5, 'the replay contains the measured original curb island');
  assert.equal(curbArea(raised), 0, 'all 47.5 m² of the conflicting raised curb is removed');
  assert.ok(covered(-2411.29, 2180.69), 'the neighbouring sidewalk keeps its rendered raised surface');
});

test('the Hetmańska cut changes ground queries without changing sidewalk or road-network inputs', () => {
  const { config, grid, uncutGrid, network, uncutNetwork } = world;
  assert.equal(config.blockAt(-2446, 2204), null, 'the cut is roadway ground for every block-height consumer');
  const neighbour = config.blockAt(-2411.29, 2180.69);
  assert.ok(neighbour && neighbour.area === 151.25, 'the neighbouring sidewalk remains raised');
  assert.equal(JSON.stringify(grid.sidewalks), JSON.stringify(uncutGrid.sidewalks), 'all road-bounding sidewalks remain');
  assert.equal(JSON.stringify(grid.footprints), JSON.stringify(uncutGrid.footprints), 'traffic and refuge footprints remain');
  assert.deepEqual(laneSnapshot(network), laneSnapshot(uncutNetwork), 'every drivable lane retains its original geometry');
});

test('the cut preserves furnished-network lanes and real pedestrian crossings', () => {
  const { actual, original } = world;
  assert.deepEqual(laneSnapshot(actual.net), laneSnapshot(original.net), 'furniture placement preserves every drivable lane');
  assert.deepEqual(crossingSnapshot(actual.routes), crossingSnapshot(original.routes),
    'all actual crossing endpoints remain usable');
  assert.equal(JSON.stringify(actual.details.footprints), JSON.stringify(original.details.footprints),
    'street furniture keeps its existing placements');
});
