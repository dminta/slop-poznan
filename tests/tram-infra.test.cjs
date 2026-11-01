const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

// Tram infrastructure placement (js/tram-infra.js layoutTramInfrastructure) on the real Poznań network, with the street
// furniture street-details.js stands along the curbs (three.js stubbed out, as in road-network.test.cjs). Nothing of
// it is handed to the road network in the app (it is built after it), but platforms and poles must still keep clear of
// the car lanes: fed to the network as obstacles, they must leave its largest strongly connected set almost whole
// (docs/world.md obstacle rule). Measured 2026-10-28: 4209 edges with the furniture, 4209 with the tram footprints added
// (27 lost when the poles kept off the straight lanes only and stood on turning paths); 129 stops (102 islands) from 142 stop nodes, 2300+ poles. The mainline railway's layout
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

  // The roadway wins over the trackbed: no ballast on an OSM carriageway (the link's width less a tram strip beside
  // it) or within a lane's 1.8 m, no lane centre under ballast, and street-running track (its centreline on a
  // carriageway) flush. Sampled on a 0.25 m grid over every bed, independently of tram-infra.js's own lookups.
  // Measured 2026-10-28 (with curbs as in road-network.test.cjs; this network has none): before (a fixed 2.9 m bed
  // wherever no lane centre came within 3.5 m of the piece's middle) 297 m² of carriageway and 7 m² of lanes under
  // ballast, 25 pieces with their centreline on a carriageway; after 0, 0 and 0, with 139 of 7899 ballast pieces made
  // flush and 61 narrowed (31.0 -> 30.5 km of ballast).
  {
    const { beds } = layout;
    const RG = GEO.roadGraph;
    const C = 16;
    const file = (g, s, pad) => {
      for (let ix = Math.floor((Math.min(s.ax, s.bx) - pad) / C); ix <= Math.floor((Math.max(s.ax, s.bx) + pad) / C); ix++) {
        for (let iz = Math.floor((Math.min(s.az, s.bz) - pad) / C); iz <= Math.floor((Math.max(s.az, s.bz) + pad) / C); iz++) {
          const k = ix * 100000 + iz;
          if (!g.has(k)) g.set(k, []);
          g.get(k).push(s);
        }
      }
    };
    const segD = (s, x, z) => {
      const ex = s.bx - s.ax, ez = s.bz - s.az;
      const t = Math.max(0, Math.min(1, ((x - s.ax) * ex + (z - s.az) * ez) / (ex * ex + ez * ez || 1)));
      return Math.hypot(s.ax + ex * t - x, s.az + ez * t - z);
    };
    const near = (g, x, z) => g.get(Math.floor(x / C) * 100000 + Math.floor(z / C)) || [];
    const cars = new Map();
    for (const [a, b, , w, , , inner, flags] of RG.links) {
      const pts = [RG.nodes[2 * a], RG.nodes[2 * a + 1], ...inner, RG.nodes[2 * b], RG.nodes[2 * b + 1]];
      const half = (w > 3 ? w : 9.1) / 2 - (flags & 24 ? 3.25 : 0);
      for (let k = 0; k + 3 < pts.length; k += 2) file(cars, { ax: pts[k], az: pts[k + 1], bx: pts[k + 2], bz: pts[k + 3], half }, 12);
    }
    const onCarriageway = (x, z) => near(cars, x, z).some((s) => segD(s, x, z) < s.half);
    const lanes = new Map();
    const laneSegs = [];
    for (const e of network.paintEdges) {
      for (const o of e.lanes) {
        const ax = e.x0 + e.rx * o, az = e.z0 + e.rz * o;
        const s = { ax, az, bx: ax + e.dx * e.span, bz: az + e.dz * e.span };
        file(lanes, s, 4);
        laneSegs.push(s);
      }
    }
    const inLane = (x, z) => near(lanes, x, z).some((s) => segD(s, x, z) < 1.8);
    let overCar = 0, overLane = 0, streetOnBallast = 0, ballast = 0;
    const bedGrid = new Map();
    for (const p of beds) {
      const mx = (p.ax + p.bx) / 2, mz = (p.az + p.bz) / 2;
      if (!p.bed) continue;
      ballast++;
      assert.ok(p.bed >= 1.2 && p.bed <= 1.45 && !p.ground && GEO.rail[p.railIndex].street !== 1);
      const inPstDworcowy = mx > -1570 && mx < -1525 && mz > 535 && mz < 585;
      if (!inPstDworcowy && onCarriageway(mx, mz)) streetOnBallast++;
      const len = Math.hypot(p.bx - p.ax, p.bz - p.az);
      const dx = (p.bx - p.ax) / len, dz = (p.bz - p.az) / len;
      file(bedGrid, { ax: p.ax, az: p.az, bx: p.bx, bz: p.bz, dx, dz, len, half: p.bed }, 2);
      for (let u = 0.125; u < len; u += 0.25) {
        for (let v = -p.bed + 0.125; v < p.bed; v += 0.25) {
          const x = p.ax + dx * u - dz * v, z = p.az + dz * u + dx * v;
          if (x > -1570 && x < -1525 && z > 535 && z < 585) continue; // Most Dworcowy elevated bridge over PST trench
          if (onCarriageway(x, z)) overCar += 0.0625;
          if (inLane(x, z)) overLane += 0.0625;
        }
      }
    }
    let laneUnder = 0;
    for (const s of laneSegs) {
      const L = Math.hypot(s.bx - s.ax, s.bz - s.az) || 1;
      for (let d = 0; d <= L; d += 1) {
        const x = s.ax + (s.bx - s.ax) * d / L, z = s.az + (s.bz - s.az) * d / L;
        if (x > -1570 && x < -1525 && z > 535 && z < 585) continue; // Most Dworcowy elevated bridge over PST trench
        if (near(bedGrid, x, z).some((b) => {
          const u = (x - b.ax) * b.dx + (z - b.az) * b.dz;
          return u >= 0 && u <= b.len && Math.abs(-(x - b.ax) * b.dz + (z - b.az) * b.dx) < b.half;
        })) laneUnder++;
      }
    }
    assert.ok(ballast > 7000, `${ballast} ballast pieces`);
    assert.equal(overCar, 0, `${overCar} m² of carriageway under ballast`);
    assert.equal(overLane, 0, `${overLane} m² of lanes under ballast`);
    assert.equal(laneUnder, 0, `${laneUnder} lane centre samples under ballast`);
    assert.equal(streetOnBallast, 0, `${streetOnBallast} ballast pieces centred on a carriageway`);
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
  const corridor0 = rail.corridor;
  const viaductFrom = (railIndex, x, z) => (rail.viaducts || []).some((v) => v.railIndex === railIndex &&
    (Math.hypot(v.ax - x, v.az - z) < 0.1 || Math.hypot(v.bx - x, v.bz - z) < 0.1));
  let cuts = 0;
  let viaductGaps = 0;
  for (const tr of rail.tracks) {
    const list = byRail.get(tr.railIndex) || [];
    for (let k = 0; k + 1 < list.length; k++) {
      const a = list[k];
      const b = list[k + 1];
      if (Math.hypot(b.ax - a.bx, b.az - a.bz) < 0.05) continue;
      if (viaductFrom(tr.railIndex, a.bx, a.bz)) {
        viaductGaps++;
        assert.ok(wallAt(a.bx, a.bz) && wallAt(b.ax, b.az), `abutment walls at viaduct span at ${a.bx}, ${a.bz}`);
        continue;
      }
      // a gap between two kept pieces: both sides inside the detail box, so both get a wall
      cuts++;
      assert.ok(wallAt(a.bx, a.bz) && wallAt(b.ax, b.az), `end walls on both sides of the cut at ${a.bx}, ${a.bz}`);
    }
  }
  assert.ok(cuts + viaductGaps > 20 && rail.ends.length >= 2 * (cuts + viaductGaps), `${cuts} cuts, ${viaductGaps} viaduct gaps, ${rail.ends.length} end walls`);

  // Roadway rail crossings: all crossings over network roadways are elevated viaducts, zero flush ground rails
  assert.ok(rail.viaducts.length >= 80, `${rail.viaducts.length} elevated viaduct spans (expected >= 80)`);
  assert.equal(rail.level.length, 0, 'zero flush rails at ground level on roadways');
  const lx = GEO.levelCrossings;
  let onRoad = 0;
  for (let k = 0; k < lx.length; k += 2) {
    if (rail.roadDist(lx[k], lx[k + 1]) >= 0) continue;
    onRoad++;
    // The roadway over former crossings stays completely open
    assert.ok(!corridor0.has(lx[k], lx[k + 1]), `the road over former level crossing at ${lx[k]}, ${lx[k + 1]} stays open`);
  }
  assert.ok(onRoad >= 25, `${onRoad} crossing sites on a roadway`);

  // Hetmańska under the Górczyn line (a rail bridge; the street is mapped as an underpass): every mainline track over it
  // is cut with an end wall on both sides, and no bed, wall, fence or keep-out lies on its carriageways
  const HX = -1855;
  const HZ = 2482;
  const hetmanska = network.edges.filter((e) => {
    const mx = e.x0 + (e.dx * e.span) / 2;
    const mz = e.z0 + (e.dz * e.span) / 2;
    return Math.hypot(mx - HX, mz - HZ) < 50 && e.lanes.length >= 3;
  });
  assert.ok(hetmanska.length >= 2, `${hetmanska.length} Hetmańska edges under the railway`);
  const segDist = (x, z, p) => {
    const ex = p.bx - p.ax;
    const ez = p.bz - p.az;
    const t = Math.max(0, Math.min(1, ((x - p.ax) * ex + (z - p.az) * ez) / (ex * ex + ez * ez || 1)));
    return Math.hypot(p.ax + ex * t - x, p.az + ez * t - z);
  };
  const hetPieces = rail.pieces.filter((p) => Math.hypot(p.ax - HX, p.az - HZ) < 90);
  let hetSamples = 0;
  for (const e of hetmanska) {
    for (let d = 0; d <= e.span; d += 1) {
      for (const o of e.lanes) {
        const x = e.x0 + e.dx * d + e.rx * o;
        const z = e.z0 + e.dz * d + e.rz * o;
        hetSamples++;
        assert.ok(!corridor0.has(x, z), `Hetmańska lane at ${x.toFixed(1)}, ${z.toFixed(1)} is open`);
        assert.ok(hetPieces.every((p) => segDist(x, z, p) > 2.5 + 1.75), `no bed on Hetmańska at ${x.toFixed(1)}, ${z.toFixed(1)}`);
      }
    }
  }
  assert.ok(hetSamples > 300, `${hetSamples} Hetmańska lane samples`);
  const hetEnds = rail.ends.filter((e) => Math.hypot(e.x - HX, e.z - HZ) < 40);
  assert.ok(hetEnds.length >= 6, `${hetEnds.length} end walls by Hetmańska`);
  for (const e of hetEnds) assert.ok(rail.roadDist(e.x, e.z) >= 3.5, 'the abutments stand off the carriageway');
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
  // ...and nowhere else: no lane of any street (painted or driven) runs into the keep-out, nor a bed or wall over it
  let laneSamples = 0;
  const laneBlocked = [];
  for (const e of network.paintEdges || network.edges) {
    for (let d = 0; d <= e.span; d += 2) {
      for (const o of e.lanes) {
        const x = e.x0 + e.dx * d + e.rx * o;
        const z = e.z0 + e.dz * d + e.rz * o;
        if (!config.isLand(x, z) || rail.roadDist(x, z) === Infinity) continue;
        laneSamples++;
        if (corridor.has(x, z)) laneBlocked.push(`${x.toFixed(0)}, ${z.toFixed(0)}`);
      }
    }
  }
  assert.ok(laneSamples > 100000, `${laneSamples} lane samples`);
  assert.deepEqual(laneBlocked, [], 'no lane runs into the railway keep-out');
  for (const e of rail.ends) {
    assert.ok(rail.roadDist(e.x, e.z) >= 3.5 && rail.laneDist(e.x, e.z) >= 1.75 + 1, `end wall at ${e.x}, ${e.z} off the road`);
  }
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
