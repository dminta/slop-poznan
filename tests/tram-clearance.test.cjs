const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

// Trams do not collide with props, so no furniture may stand on their way (docs/poznan-plan.md Phase 15.1, reported
// at Plac Cyryla Ratajskiego): the square and park furniture of city-grid.js and the street furniture and trees of
// street-details.js keep their footprints 2 m from every GEO.rail centreline, no landmark outline takes in tram track,
// and the squares crossed by tram track (Plac Cyryla Ratajskiego, Plac Wielkopolski, Plac Ludwika Waryńskiego) are
// paved round it instead of burying the rails under the 0.24 m slab. The tram infrastructure itself (poles, platforms,
// shelters) is meant to stand beside the track and is not checked here. Measured 2026-10: 48 square and park props and
// 2 cut squares; the street furniture had 183 footprints and 74 street trees within 2 m of a tram track. Over the
// 8.2 × 5.7 km detail box (2026-10-28): 63 props kept off the tracks, 3 cut squares.
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

const KEEP = 2;
let world;
test.before(async () => {
  const config = await import('../js/city-config.js');
  const { GEO } = await import('../js/geodata.js');
  const logs = [];
  const gridModule = loadModule(readFileSync(join(__dirname, '../js/city-grid.js'), 'utf8'), {
    imports: {
      'three/webgpu': inert(), 'three/addons/utils/BufferGeometryUtils.js': inert(), './city-config.js': config,
      './geodata.js': { GEO }, './tsl-materials.js': inert()
    },
    globals: { console: { info: (line) => logs.push(line), log() {}, warn() {} } },
    filename: 'city-grid.js'
  });
  const grid = gridModule.buildCityGrid(inert());
  let trees = [];
  const streetDetails = (grid) => loadModule(readFileSync(join(__dirname, '../js/street-details.js'), 'utf8'), {
    imports: {
      'three/webgpu': inert(), 'three/tsl': inert(), 'three/addons/utils/BufferGeometryUtils.js': inert(),
      './city-config.js': config, './road-network.js': { CROSSWALK: 4.3, CROSSWALK_REACH: 3, STOP_SETBACK: 1.5 },
      './tsl-materials.js': inert(),
      './trees.js': { createTreeField: (_scene, sites) => { trees = sites; return { group: inert() }; } },
      './city-grid.js': grid
    },
    globals: { console: { info() {}, log() {}, warn() {} }, Math, Object, Array, Set, Map, Number, Infinity, JSON, Symbol,
      Float32Array, Uint8Array, Uint16Array, Uint32Array, Int32Array, Float64Array, Promise, String, Error,
      document: inert() },
    filename: 'street-details.js'
  }).buildStreetDetails(inert());
  // the street furniture as it would stand if the tracks were not there (built first: `trees` keeps the last build's)
  const noRails = streetDetails({ ...gridModule, clearOfRails: () => true });
  const details = streetDetails(gridModule);

  // every GEO.rail segment, bucketed in 32 m cells (an index of its own, not city-grid.js's)
  const cells = new Map();
  for (const r of GEO.rail) {
    for (let i = 0; i + 3 < r.pts.length; i += 2) {
      const s = { ax: r.pts[i], az: r.pts[i + 1], bx: r.pts[i + 2], bz: r.pts[i + 3], tram: r.kind === 'tram' };
      for (let ix = Math.floor(Math.min(s.ax, s.bx) / 32); ix <= Math.floor(Math.max(s.ax, s.bx) / 32); ix++) {
        for (let iz = Math.floor(Math.min(s.az, s.bz) / 32); iz <= Math.floor(Math.max(s.az, s.bz) / 32); iz++) {
          const k = `${ix},${iz}`;
          if (!cells.has(k)) cells.set(k, []);
          cells.get(k).push(s);
        }
      }
    }
  }
  const trackDist = (x, z, tramOnly = false) => {
    let best = Infinity;
    for (let ix = Math.floor(x / 32) - 1; ix <= Math.floor(x / 32) + 1; ix++) {
      for (let iz = Math.floor(z / 32) - 1; iz <= Math.floor(z / 32) + 1; iz++) {
        for (const s of cells.get(`${ix},${iz}`) || []) {
          if (tramOnly && !s.tram) continue;
          const ex = s.bx - s.ax, ez = s.bz - s.az, L2 = ex * ex + ez * ez;
          const t = L2 ? Math.max(0, Math.min(1, ((x - s.ax) * ex + (z - s.az) * ez) / L2)) : 0;
          best = Math.min(best, Math.hypot(s.ax + ex * t - x, s.az + ez * t - z));
        }
      }
    }
    return best;
  };
  world = { config, GEO, gridModule, grid, details, noRails, trees, trackDist, logs };
});

// a box's reach from its centre: an oriented box's own half diagonal, else its world AABB's
const boxReach = (c) => (c.obb ? Math.hypot(c.obb.hx, c.obb.hz) : Math.hypot(c.maxX - c.minX, c.maxZ - c.minZ) / 2);
const centre = (c) => (c.obb ? [c.obb.cx, c.obb.cz] : [(c.minX + c.maxX) / 2, (c.minZ + c.maxZ) / 2]);
function onTrack(list, reach, at) {
  return list.filter((c) => {
    const [x, z] = at(c);
    return world.trackDist(x, z) < KEEP + reach(c) - 1e-6;
  });
}
const where = (bad, at) => bad.slice(0, 5).map((c) => at(c).map((v) => v.toFixed(1)).join(',')).join(' ');

test('square and park furniture and its colliders keep 2 m off every track', () => {
  const { grid } = world;
  const bad = onTrack(grid.propColliders, boxReach, centre);
  assert.equal(bad.length, 0, `${bad.length} square & park colliders on a track: ${where(bad, centre)}`);
  // every lamppost, bench, planter and tree trunk has its collider (the module's live site exports are not reachable
  // through the vm harness, which copies the exports once at load)
  const [benches, lamps, trees, total] = /(\d+) benches, (\d+) lampposts, (\d+) park & plaza trees; (\d+) player/
    .exec(world.logs.join('\n')).slice(1).map(Number);
  assert.ok(benches > 200 && lamps > 1400 && trees > 14000 && total === grid.propColliders.length);
  assert.match(world.logs.join('\n'), /(\d+) props kept off the tracks; 3 squares paved round tram track/);
});

test('street furniture, its colliders and the street trees keep 2 m off every track', () => {
  const { details, trees } = world;
  for (const [what, list] of [['colliders', details.colliders], ['footprints', details.footprints]]) {
    const bad = onTrack(list, boxReach, centre);
    assert.equal(bad.length, 0, `${bad.length} street furniture ${what} on a track: ${where(bad, centre)} ` +
      `(${[...new Set(bad.map((c) => c.kind))].join(', ')})`);
  }
  const street = trees.filter((t) => t.tier);
  assert.ok(street.length > 5000, `${street.length} street trees`);
  const bad = onTrack(street, (t) => 0.4 * t.scale, (t) => [t.x, t.z]);
  assert.equal(bad.length, 0, `${bad.length} street trees on a track: ${where(bad, (t) => [t.x, t.z])}`);
});

test('keeping off the tracks costs next to no signal pole or vehicle head', () => {
  // One pedestrian head (an audio source) per signal pole. Measured 2026-10-28 on the 8.2 × 5.7 km box: 1823 poles
  // with the rail clearance, 1827 without; 13 more move 1.2–9.6 m along their curb. A vehicle head goes on the left
  // pole where the right curb has no spot, so only one approach (a 4 m link off Krucza / Zamenhofa, both curbs by the
  // tracks) is left without one
  const { details, noRails } = world;
  const poles = details.audioSignals.length, free = noRails.audioSignals.length;
  assert.ok(poles > 1500, `${poles} signal poles`);
  assert.ok(poles <= free && free - poles <= 6, `${free - poles} of ${free} signal poles lost to the tracks`);
  assert.ok(noRails.vehicleHeads - details.vehicleHeads <= 2,
    `${noRails.vehicleHeads - details.vehicleHeads} vehicle heads lost to the tracks`);
});

test('no landmark outline or the Śródka mural square takes in tram track', () => {
  const { config, GEO } = world;
  const inRing = (ring, x, z) => {
    let inside = false;
    for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
      const ax = ring[i], az = ring[i + 1], bx = ring[j], bz = ring[j + 1];
      if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
    }
    return inside;
  };
  const M = config.SRODKA_MURAL;
  for (const r of GEO.rail) {
    if (r.kind !== 'tram') continue;
    for (let i = 0; i + 3 < r.pts.length; i += 2) {
      const n = Math.max(1, Math.ceil(Math.hypot(r.pts[i + 2] - r.pts[i], r.pts[i + 3] - r.pts[i + 1])));
      for (let k = 0; k <= n; k++) {
        const x = r.pts[i] + ((r.pts[i + 2] - r.pts[i]) * k) / n, z = r.pts[i + 1] + ((r.pts[i + 3] - r.pts[i + 1]) * k) / n;
        for (const [name, site] of Object.entries(config.LANDMARK_SITES)) {
          if (site.ring && site.ring.length >= 6) assert.ok(!inRing(site.ring, x, z), `tram track inside ${name}`);
        }
        assert.ok(Math.hypot(x - M.cx, z - M.cz) > M.len + M.square + KEEP, 'tram track by the Śródka mural square');
      }
    }
  }
});

test('squares crossed by tram track are paved round it, the rails in sight', () => {
  const { grid, gridModule, GEO } = world;
  const plazas = gridModule.pavedPlazas().filter((p) => p.tramSegs);
  const names = (list) => JSON.stringify(Array.from(list, (p) => p.name).sort());
  // the unnamed pedestrian area at the Ogrody tram loop (Dąbrowskiego) has a building on it too: left unpaved
  assert.equal(names(plazas), '["","Plac Cyryla Ratajskiego","Plac Ludwika Waryńskiego","Plac Wielkopolski"]');
  assert.equal(names(grid.cutPlazas), '["Plac Cyryla Ratajskiego","Plac Ludwika Waryńskiego","Plac Wielkopolski"]');
  const ringArea = (ring) => {
    let a = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j].x * ring[i].z - ring[i].x * ring[j].z;
    return a / 2;
  };
  const inConvex = (poly, x, z) => poly.every((p, i) => {
    const q = poly[(i + 1) % poly.length];
    return (q.x - p.x) * (z - p.z) - (q.z - p.z) * (x - p.x) > -1e-9;
  });
  const inRing = (ring, x, z) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
    }
    return inside;
  };
  for (const pl of plazas.filter((p) => p.name)) {
    const cut = grid.cutPlazas.find((c) => c.name === pl.name);
    const area = Math.abs(ringArea(pl.ring));
    for (const piece of [...cut.curb, ...cut.top]) assert.ok(ringArea(piece) > 0, 'pieces turn left');
    const paved = cut.curb.reduce((s, p) => s + ringArea(p), 0);
    // the square stays paved round the track: 4.6 m wide corridors take ~11% of Plac Cyryla Ratajskiego, ~17% of Plac
    // Wielkopolski
    assert.ok(paved > 0.75 * area && paved < area, `${pl.name}: ${paved.toFixed(0)} of ${area.toFixed(0)} m² paved`);
    let samples = 0;
    for (const r of GEO.rail) {
      if (r.kind !== 'tram') continue;
      for (let i = 0; i + 3 < r.pts.length; i += 2) {
        const ax = r.pts[i], az = r.pts[i + 1], bx = r.pts[i + 2], bz = r.pts[i + 3];
        const len = Math.hypot(bx - ax, bz - az);
        const nx = -(bz - az) / len, nz = (bx - ax) / len;
        for (let s = 0; s <= len; s += 0.5) {
          const x = ax + ((bx - ax) * s) / len, z = az + ((bz - az) * s) / len;
          if (!inRing(pl.ring, x, z)) continue;
          samples++;
          // the centreline, both rail heads and 1.4 m of clearance beyond them are under no slab piece
          for (const o of [0, 0.75, -0.75, 2.2, -2.2]) {
            const px = x + nx * o, pz = z + nz * o;
            const hit = [...cut.curb, ...cut.top].some((p) => inConvex(p, px, pz));
            assert.ok(!hit, `${pl.name}: slab over the track at ${px.toFixed(1)}, ${pz.toFixed(1)}`);
          }
        }
      }
    }
    assert.ok(samples > 200, `${pl.name}: ${samples} track samples on the square`);
  }
});

test('cutSlab leaves the track corridor out of a square slab and keeps the rest', () => {
  const { cutSlab } = world.gridModule;
  // a 20 x 20 m square, a track across it along z = 0 (the corridor 2 * 2 m wide) and an L-shaped ring
  const square = [{ x: -10, z: -10 }, { x: 10, z: -10 }, { x: 10, z: 10 }, { x: -10, z: 10 }];
  const area = (pieces) => pieces.reduce((s, p) => {
    let a = 0;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j].x * p[i].z - p[i].x * p[j].z;
    return s + a / 2;
  }, 0);
  assert.ok(Math.abs(area(cutSlab(square, [], 2)) - 400) < 1e-6);
  assert.ok(Math.abs(area(cutSlab(square, [[-30, 0, 30, 0]], 2)) - 320) < 1e-6);
  // a bend: two segments meeting inside the square leave no slab over the joint
  const bend = cutSlab(square, [[-30, 0, 0, 0], [0, 0, 0, 30]], 2);
  assert.ok(!bend.some((p) => p.every((q, i) => {
    const r = p[(i + 1) % p.length];
    return (r.x - q.x) * (0.0 - q.z) - (r.z - q.z) * (0.0 - q.x) > -1e-9;
  })), 'the joint is open');
  const ell = [{ x: 0, z: 0 }, { x: 20, z: 0 }, { x: 20, z: 10 }, { x: 10, z: 10 }, { x: 10, z: 20 }, { x: 0, z: 20 }];
  assert.ok(Math.abs(area(cutSlab(ell, [], 2)) - 300) < 1e-6, 'a concave ring is covered once');
});
