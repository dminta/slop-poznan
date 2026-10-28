const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

// Tram infrastructure placement (js/tram-infra.js layoutTramInfrastructure) on the real Poznań network, with the street
// furniture street-details.js stands along the curbs (three.js stubbed out, as in road-network.test.cjs). Nothing of
// it is handed to the road network in the app (it is built after it), but platforms and poles must still keep clear of
// the car lanes: fed to the network as obstacles, they must leave its largest strongly connected set almost whole
// (docs/world.md obstacle rule). Measured 2026-10: 4294 edges / 193.5 km with the furniture, 4282 / 193.1 km with the
// tram footprints added; 129 stops (102 islands) from 142 stop nodes, 2300+ poles. The mainline railway's layout
// (layoutRailInfrastructure) is checked on the same network: 8453 pieces (66 km; 3009 outside the detail box, 29 over
// water, 282 at roads, 43 at tram tracks), 143 end walls, 1007 masts (827 cantilevers, 113 portals), and 29.3 km of
// corridor boundary in 266 runs (46 of them gap stubs; 25.9 km over a solid wall, 5.6 km round the Poznań Główny
// yard), and a player keep-out raster of 344k 1 m cells.
function inert() {
  const store = {};
  return new Proxy(function () {}, {
    get(_target, key) {
      if (key === Symbol.iterator) return function* () {};
      if (key === Symbol.toPrimitive) return () => 0;
      if (key === 'then') return undefined;
      if (key === 'length') return 0;
      return key in store ? store[key] : (store[key] = inert());
    },
    set(_target, key, value) { store[key] = value; return true; },
    apply: () => inert(),
    construct: () => inert()
  });
}

test('tram stops, platforms, poles and railway masts keep clear of the car lanes', async () => {
  const config = await import('../js/city-config.js');
  const { GEO } = await import('../js/geodata.js');
  const logs = [];
  const { buildRoadNetwork, CROSSWALK, CROSSWALK_REACH, STOP_SETBACK } = loadModule(readFileSync(join(__dirname, '../js/road-network.js'), 'utf8'), {
    imports: { './city-config.js': config, './geodata.js': { GEO } },
    globals: { console: { info: (line) => logs.push(line) } },
    filename: 'road-network.js'
  });
  // street furniture keeps off the tram tracks through city-grid.js's track index (the module, not the built grid)
  const { clearOfRails } = loadModule(readFileSync(join(__dirname, '../js/city-grid.js'), 'utf8'), {
    imports: { 'three/webgpu': inert(), 'three/addons/utils/BufferGeometryUtils.js': inert(), './city-config.js': config,
      './geodata.js': { GEO }, './tsl-materials.js': inert() },
    filename: 'city-grid.js'
  });
  const { buildStreetDetails } = loadModule(readFileSync(join(__dirname, '../js/street-details.js'), 'utf8'), {
    imports: {
      'three/webgpu': inert(), 'three/tsl': inert(), 'three/addons/utils/BufferGeometryUtils.js': inert(),
      './city-config.js': config, './road-network.js': { CROSSWALK, CROSSWALK_REACH, STOP_SETBACK }, './tsl-materials.js': inert(),
      './trees.js': { createTreeField: () => ({ group: inert() }) },
      './city-grid.js': { pavedPlazaRects: [], parkTreeSites: [], parkLampSites: [], clearOfRails }
    },
    globals: { console: { info() {}, log() {}, warn() {} }, Math, Object, Array, Set, Map, Number, Infinity, JSON, Symbol,
      Float32Array, Uint8Array, Uint16Array, Uint32Array, Int32Array, Float64Array, Promise, String, Error,
      document: inert() },
    filename: 'street-details.js'
  });
  const { layoutTramInfrastructure, layoutRailInfrastructure } = loadModule(readFileSync(join(__dirname, '../js/tram-infra.js'), 'utf8'), {
    imports: {
      'three/webgpu': {}, 'three/tsl': {}, 'three/addons/utils/BufferGeometryUtils.js': {},
      './geodata.js': { GEO }, './city-config.js': config, './tsl-materials.js': {}
    },
    globals: { Math, Object, Array, Set, Map, Number, Float64Array },
    filename: 'tram-infra.js'
  });
  const km = (net) => net.edges.reduce((sum, e) => sum + e.span, 0) / 1000;

  const { footprints } = buildStreetDetails(inert());
  const network = buildRoadNetwork([], footprints);
  const layout = layoutTramInfrastructure(network);
  const { stops, poles, spans, arms, laneDist, tracks } = layout;

  assert.ok(stops.length >= 100, `${stops.length} stops`);
  assert.ok(stops.filter((s) => s.kind === 'island').length >= 80, 'most stops get a platform island');
  assert.ok(poles.length > 1500 && spans.length + arms.length > 1000, `${poles.length} poles`);
  for (const s of stops) {
    const rail = GEO.rail[s.railIndex];
    assert.equal(rail.kind, 'tram');
    const tr = tracks.find((t) => t.railIndex === s.railIndex);
    assert.ok(s.s >= 0 && s.s <= tr.len + 1e-6 && Number.isFinite(s.heading) && Math.abs(s.dir) === 1);
    if (rail.oneway) assert.equal(s.dir, 1, `${s.name} runs the one-way track's way`);
    // the platform (or sidewalk stop) is on the right of the travel direction
    assert.equal(s.side, s.dir, `${s.name} platform on the right`);
  }
  assert.ok(poles.every((q) => laneDist(q.x, q.z) >= 2), 'poles keep 2 m from every lane centreline');
  // The Ostrów Tumski line (closed for rebuilding in the OSM data, kept through its route=tram relations), Most
  // Teatralny and Fredry: their stops have track now
  for (const name of ['Katedra', 'Rondo Śródka', 'Fredry', 'Most Teatralny', 'Pl. Wielkopolski', 'Stare Zoo']) {
    assert.ok(stops.some((s) => s.name === name), `a stop named ${name}`);
  }

  // Mainline railway: pieces only on land, cut clear of every roadway and tram track with an end wall at each cut,
  // masts clear of roads, tram and rail tracks, portals reaching over neither, wires supported
  const rail = layoutRailInfrastructure(network);
  assert.ok(rail.tracks.length > 300 && rail.tracks.every((t) => GEO.rail[t.railIndex].kind === 'rail'));
  assert.ok(rail.pieces.length > 6000, `${rail.pieces.length} rail pieces`);
  const { dropped } = rail;
  assert.ok(dropped.water > 0 && dropped.road > 0 && dropped.tram > 0, JSON.stringify(dropped));
  const mid = (p) => [(p.ax + p.bx) / 2, (p.az + p.bz) / 2];
  let tooClose = 0;
  for (const p of rail.pieces) {
    assert.ok(Math.hypot(p.bx - p.ax, p.bz - p.az) <= 8.01, 'pieces are at most 8 m');
    assert.ok(config.isLand(...mid(p)), 'no piece over open water');
    for (let t = 0; t <= 1; t += 0.125) {
      const x = p.ax + (p.bx - p.ax) * t;
      const z = p.az + (p.bz - p.az) * t;
      if (rail.roadDist(x, z) < 3.5 || rail.tramDist(x, z) < 5) tooClose++;
    }
  }
  assert.equal(tooClose, 0, 'no bed within 3.5 m of a roadway (2.5 m half bed + 1 m) or 5 m of a tram track');
  const station = rail.pieces.filter((p) => {
    const [x, z] = mid(p);
    return x > -1700 && x < -900 && z > 300 && z < 1100;
  });
  assert.ok(station.length > 1000, `${station.length} pieces in the Poznań Główny yard`);
  // every cut against a road, tram line or water ends in a wall: count the kept pieces next to a gap on their track
  const byRail = new Map();
  for (const p of rail.pieces) {
    if (!byRail.has(p.railIndex)) byRail.set(p.railIndex, []);
    byRail.get(p.railIndex).push(p);
  }
  const wallAt = (x, z) => rail.ends.some((e) => Math.hypot(e.x - x, e.z - z) < 0.05);
  let cuts = 0;
  for (const tr of rail.tracks) {
    const list = byRail.get(tr.railIndex) || [];
    for (let k = 0; k + 1 < list.length; k++) {
      const a = list[k];
      const b = list[k + 1];
      if (Math.hypot(b.ax - a.bx, b.az - a.bz) < 0.05) continue;
      // a gap between two kept pieces: both sides inside the detail box, so both get a wall
      cuts++;
      assert.ok(wallAt(a.bx, a.bz) && wallAt(b.ax, b.az), `end walls on both sides of the cut at ${a.bx}, ${a.bz}`);
    }
  }
  assert.ok(cuts > 20 && rail.ends.length >= 2 * cuts, `${cuts} cuts, ${rail.ends.length} end walls`);
  assert.ok(rail.masts.length > 500 && rail.arms.length > 400 && rail.portals.length > 20, `${rail.masts.length} masts`);
  for (const q of rail.masts) {
    assert.ok(rail.roadDist(q.x, q.z) >= 2 && rail.tramDist(q.x, q.z) >= 3, `mast at ${q.x}, ${q.z} clear of roads and trams`);
    assert.ok(rail.laneDist(q.x, q.z) >= 2, 'masts keep 2 m from every lane centreline');
  }
  for (const p of rail.portals) {
    const L = Math.hypot(p.bx - p.ax, p.bz - p.az);
    for (let d = 0; d <= L; d += 1) {
      const t = d / L;
      const x = p.ax + (p.bx - p.ax) * t;
      const z = p.az + (p.bz - p.az) * t;
      assert.ok(rail.roadDist(x, z) >= 0.5 && rail.tramDist(x, z) >= 1, 'portals reach over no road or tram track');
    }
  }
  // Corridor boundary: runs along the outer edges, the station yard fenced, clear of roads, tram tracks and every bed
  assert.ok(rail.runs.length > 50, `${rail.runs.length} boundary runs`);
  let fenceLen = 0;
  let yardFence = 0;
  let solidLen = 0;
  const fenceBad = { road: 0, tram: 0, bed: 0 };
  for (const r of rail.runs) {
    assert.equal(r.solid.length, r.pts.length - 1);
    for (let k = 0; k + 1 < r.pts.length; k++) {
      const a = r.pts[k];
      const b = r.pts[k + 1];
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      fenceLen += L;
      if (r.solid[k]) solidLen += L;
      if (a.x > -1700 && a.x < -900 && a.z > 300 && a.z < 1100) yardFence += L;
      for (let d = 0; d <= L; d += 0.5) {
        const x = a.x + ((b.x - a.x) * d) / (L || 1);
        const z = a.z + ((b.z - a.z) * d) / (L || 1);
        if (rail.roadDist(x, z) < 0.75) fenceBad.road++;
        if (rail.tramDist(x, z) < 2.75) fenceBad.tram++;
        if (rail.railDist(x, z) < 2.5) fenceBad.bed++;
      }
    }
  }
  assert.deepEqual({ ...fenceBad }, { road: 0, tram: 0, bed: 0 }, 'the boundary keeps off roads, tram tracks and beds');
  assert.ok(fenceLen > 15000 && yardFence > 2000, `${fenceLen.toFixed(0)} m of boundary, ${yardFence.toFixed(0)} m at the yard`);
  assert.ok(solidLen > 0 && solidLen < fenceLen, `${solidLen.toFixed(0)} m of solid wall`);
  assert.ok(rail.masts.every((q) => rail.runs.every((r) => r.pts.every((p) => Math.hypot(p.x - q.x, p.z - q.z) > 0.3))),
    'no mast stands on a boundary vertex');

  // Player keep-out: the whole bed of every kept piece, none of the roadway at the cuts, nothing just outside the fence
  const { corridor } = rail;
  assert.equal(rail.pieces.filter((p) => !corridor.has(...mid(p))).length, 0, 'every kept piece lies in the keep-out');
  assert.ok(rail.pieces.every((p) => {
    const len = Math.hypot(p.bx - p.ax, p.bz - p.az);
    const nx = -(p.bz - p.az) / len;
    const nz = (p.bx - p.ax) / len;
    const [x, z] = mid(p);
    return corridor.has(x + nx * 2.5, z + nz * 2.5) && corridor.has(x - nx * 2.5, z - nz * 2.5);
  }), 'the keep-out covers the bed to its foot');
  let roadSamples = 0;
  let roadBlocked = 0;
  for (const e of rail.ends) {
    for (let d = 0.5; d <= 20; d += 0.5) {
      const x = e.x + e.dx * d;
      const z = e.z + e.dz * d;
      if (rail.roadDist(x, z) >= 0) continue;
      roadSamples++;
      if (corridor.has(x, z)) roadBlocked++;
    }
  }
  assert.ok(roadSamples > 500 && roadBlocked === 0, `${roadBlocked} of ${roadSamples} roadway points at the cuts blocked`);
  let outside = 0;
  let outsideBlocked = 0;
  for (const r of rail.runs) {
    for (let k = 0; k + 1 < r.pts.length; k++) {
      const a = r.pts[k];
      const b = r.pts[k + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const nx = -(b.z - a.z) / len;
      const nz = (b.x - a.x) / len;
      const x = (a.x + b.x) / 2;
      const z = (a.z + b.z) / 2;
      const sg = rail.railDist(x + nx, z + nz, 8) > rail.railDist(x - nx, z - nz, 8) ? 1 : -1;
      outside++;
      if (corridor.has(x + nx * sg * 0.8, z + nz * sg * 0.8)) outsideBlocked++;
    }
  }
  assert.ok(outsideBlocked <= outside * 0.01, `${outsideBlocked} of ${outside} points 0.8 m outside the fence blocked`);
  assert.ok(rail.runs.some((r) => r.stub), 'gaps between run ends are closed by stubs');

  const carried = [...rail.arms.map((a) => [a.bx, a.bz]), ...rail.droppers.map((d) => [d.x, d.z])];
  const near = (x, z, r) => carried.some(([sx, sz]) => Math.hypot(sx - x, sz - z) < r);
  const loose = rail.pieces.filter((p) => !near(...mid(p), 45));
  assert.ok(loose.length < rail.pieces.length * 0.01, `${loose.length} of ${rail.pieces.length} pieces with no support within 45 m`);
  const openEnds = rail.ends.filter((e) => !near(e.x, e.z, 10));
  assert.ok(openEnds.length <= rail.ends.length * 0.05, `${openEnds.length} of ${rail.ends.length} cut ends with no mast within 10 m`);

  logs.length = 0;
  const withTrams = buildRoadNetwork([], [...footprints, ...layout.footprints, ...rail.footprints]);
  assert.ok(withTrams.edges.length >= network.edges.length - 20, `${network.edges.length} -> ${withTrams.edges.length} edges`);
  assert.ok(km(withTrams) > 0.995 * km(network), `${km(network).toFixed(1)} -> ${km(withTrams).toFixed(1)} km`);
});
