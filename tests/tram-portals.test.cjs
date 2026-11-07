const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

// Tram tunnels and the PST cutting (GEO.tramTunnels, built by tools/poz-roads.mjs). The covered stretches are not
// drawn on the surface at all; only the portals and their short approaches are built, and trams.js masks the sections
// inside the hidden corridor. Measured on the 2026-11-06 geodata: 17 covered ways (2.18 km of bore), 7 PST cutting ways
// (3.34 km), 4 bundle-aware frames + 4 Chartowo median ramps, 463 wall pieces, 462 railing segments and 14,130 keep-out cells (headless).
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

const lineLen = (p) => {
  let s = 0;
  for (let i = 0; i + 3 < p.length; i += 2) s += Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
  return s;
};
const distToLine = (x, z, pts) => {
  let best = Infinity;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i], az = pts[i + 1], bx = pts[i + 2], bz = pts[i + 3];
    const ex = bx - ax, ez = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)));
    best = Math.min(best, Math.hypot(ax + ex * t - x, az + ez * t - z));
  }
  return best;
};

test('tunnel and cutting data, portals, no lid, hidden stretch and keep-out', async () => {
  const config = await import('../js/city-config.js');
  const { GEO } = await import('../js/geodata.js');
  const { layoutTramTunnels } = loadModule(readFileSync(join(__dirname, '../js/tram-infra.js'), 'utf8'), {
    imports: {
      'three/webgpu': inert(), 'three/tsl': inert(), 'three/addons/utils/BufferGeometryUtils.js': inert(),
      './geodata.js': { GEO }, './city-config.js': config, './tsl-materials.js': inert()
    },
    globals: { Math, Object, Array, Set, Map, Number, Infinity, JSON, Symbol, Float32Array, Float64Array, Promise,
      String, Error, console: { info() {}, warn() {}, log() {} } },
    filename: 'tram-infra.js'
  });
  const layout = layoutTramTunnels();
  const covered = GEO.tramTunnels.filter((t) => t.kind === 'covered');
  const trench = GEO.tramTunnels.filter((t) => t.kind === 'trench');
  const park = (x, z) => {
    const b = config.blockAt(x, z);
    return !!(b && b.park > 0.6);
  };
  const clearStructure = (x, z) => config.roadClearance(x, z) > 0 && !park(x, z);

  // Górczyn's Hetmańska kerbside tracks are railway underpasses covered by rail viaducts, not tram tunnels
  assert.equal(GEO.tramTunnels.length, 24, '24 tunnel/cutting ways');
  assert.equal(covered.length, 17, '17 covered ways');
  assert.equal(trench.length, 7, '7 PST cutting ways');
  assert.equal(covered.filter((t) => distToLine(-1840, 2485, t.pts) < 30).length, 0, 'no Górczyn tunnel ways');
  assert.ok(covered.reduce((s, t) => s + lineLen(t.pts), 0) > 2100, 'over 2.1 km of covered bore');
  assert.ok(trench.reduce((s, t) => s + lineLen(t.pts), 0) > 3300, 'over 3.3 km of cutting bore');

  // A frame spans the whole track bundle. Kaponiera gets one two-track portal at each mouth; Franowo has its mouths
  // plus one median frame where the line surfaces in the tram strip.
  const expected = [
    [3042.2, 2149.9], [3713.2, 2715.3], [3034.2, 2215.1], [3030.5, 2212.6], [3027.9, 2231.1], [3034.2, 2220.8],
    [-1447.5, 174.0], [-1477.4, 268.5]
  ];
  assert.equal(layout.portals.length, expected.length, `${layout.portals.length} portals/ramps`);
  for (const [x, z] of expected) {
    const p = layout.portals.find((q) => Math.hypot(q.x - x, q.z - z) < 2);
    assert.ok(p, `a portal/ramp at ${x}, ${z}`);
    if (p.kind === 'ramp') {
      assert.equal(p.posts, false, 'a median ramp has no posts or head wall');
      assert.equal(p.approach, 0, 'a median ramp has no surface approach');
      assert.ok(p.width <= 6.5 && p.height < 0.5, 'the ramp lining is low and inside the tram strip');
      assert.equal(p.median, true, 'ramp marked as median');
      assert.ok(!layout.keepOut.has(p.x, p.z), 'no keep-out at a ramp mouth');
      for (let dx = -15; dx <= 15; dx += 2) {
        for (let dz = -15; dz <= 15; dz += 2) {
          const x = p.x + dx, z = p.z + dz;
          if (layout.keepOut.has(x, z)) {
            assert.ok(config.roadClearance(x, z) > 0 && !config.blockAt(x, z),
              `no ramp keep-out on a roadway or sidewalk at ${x.toFixed(1)}, ${z.toFixed(1)}`);
          }
        }
      }
      continue;
    }
    assert.ok(p.width >= 4.8 && p.width < 35, `portal width ${p.width.toFixed(2)} m`);
    assert.ok(p.height >= 4.8, 'the portal clears the tram');
    assert.equal(p.posts, true, 'every frame has both posts (or is omitted)');
    const lx = -p.dz, lz = p.dx;
    assert.ok(clearStructure(p.x, p.z), 'portal centre is clear of roadway and park');
    for (const sg of [1, -1]) {
      assert.ok(clearStructure(p.x + lx * sg * (p.width / 2 - 0.3), p.z + lz * sg * (p.width / 2 - 0.3)),
        'both portal posts clear of roadway and park');
    }
  }
  // Ramp parapets (when a lane distance is supplied) stay low and inside the 6.5 m tram strip.
  for (const w of layout.walls.filter((w) => w.kind === 'ramp')) {
    assert.ok(w.h <= 0.5, 'ramp parapet is low');
    const ramp = layout.portals.find((p) => p.kind === 'ramp' &&
      Math.hypot((w.ax + w.bx) / 2 - p.x, (w.az + w.bz) / 2 - p.z) < 10);
    assert.ok(ramp, 'ramp parapet belongs to a ramp mouth');
  }
  assert.equal(layout.roofs.length, 0, 'no lid is drawn over a covered stretch');
  assert.equal(layout.walls.filter((w) => w.kind === 'lintel' || w.kind === 'post').length, 0,
    'no free-standing lintel or post wall record');

  // Structures outside the cutting (portal wings and approach parapets) stay off roads and parks.
  for (const w of layout.walls) {
    if (w.kind === 'trench' || w.kind === 'ramp') continue;
    for (const [x, z] of [[w.ax, w.az], [(w.ax + w.bx) / 2, (w.az + w.bz) / 2], [w.bx, w.bz]]) {
      assert.ok(clearStructure(x, z), `${w.kind} wall clear at ${x.toFixed(1)}, ${z.toFixed(1)}`);
    }
  }
  assert.ok(layout.openings.every((o) => o.median || clearStructure(o.x, o.z)), 'dark linings clear of roadway/park unless in a tram median');

  // The hidden corridor covers every covered route sample; the open cutting does not.
  for (const tr of layout.tracks) {
    if (tr.kind !== 'covered') continue;
    for (let k = 0; k < tr.n; k += 2) {
      const x = tr.p[2 * k], z = tr.p[2 * k + 1];
      assert.ok(layout.hiddenAt(x, z), `hidden covered sample ${x.toFixed(1)}, ${z.toFixed(1)}`);
    }
  }
  let cutting = null;
  for (const tr of layout.tracks) {
    if (tr.kind !== 'trench' || cutting) continue;
    for (let k = 0; k < tr.n; k++) {
      const x = tr.p[2 * k], z = tr.p[2 * k + 1];
      if (config.roadClearance(x, z) > 2 && !layout.hiddenAt(x, z)) { cutting = { x, z }; break; }
    }
  }
  assert.ok(cutting && layout.trenchAt(cutting.x, cutting.z), 'the open cutting is not hidden');
  assert.ok(!layout.hiddenAt(cutting.x, cutting.z), 'a cutting sample is visible');

  // Keep-out: the cutting and the walled approaches only, never a roadway, never the covered stretch between portals.
  assert.ok(layout.keepOut.cells > 10000, `${layout.keepOut.cells} keep-out cells`);
  for (const tr of layout.tracks) {
    for (let k = 0; k < tr.n; k += 2) {
      const x = tr.p[2 * k], z = tr.p[2 * k + 1];
      if (config.roadClearance(x, z) < -0.5) assert.ok(!layout.keepOut.has(x, z), `road stays open at ${x.toFixed(1)}, ${z.toFixed(1)}`);
    }
  }
  let offPortal = null;
  for (const tr of layout.tracks) {
    if (tr.kind !== 'covered') continue;
    for (let k = 0; k < tr.n; k++) {
      const x = tr.p[2 * k], z = tr.p[2 * k + 1];
      if (layout.trenchAt(x, z)) continue;
      if (layout.portals.some((p) => Math.hypot(p.x - x, p.z - z) < 16)) continue;
      offPortal = { x, z };
      break;
    }
    if (offPortal) break;
  }
  assert.ok(offPortal && !layout.keepOut.has(offPortal.x, offPortal.z),
    'the ground over the covered stretch between portals is not a keep-out');
  // Wall colliders (oriented boxes) line the cutting and the approaches.
  assert.ok(layout.colliders.length > 400, `${layout.colliders.length} tunnel/cutting colliders`);
  assert.ok(layout.colliders.every((c) => c.maxY > 0.5 && c.obb && Number.isFinite(c.minX)), 'oriented wall colliders');
  // No structure (post/wall collider) within 1.35 m of a visible tram track's centreline
  const obbDist = (c, x, z) => {
    const o = c.obb;
    const lx = (x - o.cx) * o.cs - (z - o.cz) * o.sn;
    const lz = (x - o.cx) * o.sn + (z - o.cz) * o.cs;
    return Math.hypot(Math.max(0, Math.abs(lx) - o.hx), Math.max(0, Math.abs(lz) - o.hz));
  };
  const contacts = [];
  for (const r of GEO.rail) {
    if (r.kind !== 'tram') continue;
    const p = r.pts;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const L = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
      for (let s = 0; s <= L; s += 1) {
        const x = p[i] + (p[i + 2] - p[i]) * s / L;
        const z = p[i + 1] + (p[i + 3] - p[i + 1]) * s / L;
        if (layout.hiddenAt(x, z, 0.3)) continue;
        for (const c of layout.colliders) {
          if (x < c.minX - 2 || x > c.maxX + 2 || z < c.minZ - 2 || z > c.maxZ + 2) continue;
          if (obbDist(c, x, z) < 1.35) contacts.push(`${x.toFixed(1)},${z.toFixed(1)}`);
        }
      }
    }
  }
  assert.deepEqual(contacts.slice(0, 5), [], `structures on visible tracks: ${contacts.slice(0, 5).join('; ')}`);
});

test('trams are hidden inside covered ways and visible in the PST cutting', async () => {
  const { GEO } = await import('../js/geodata.js');
  const { layoutTramTunnels } = loadModule(readFileSync(join(__dirname, '../js/tram-infra.js'), 'utf8'), {
    imports: {
      'three/webgpu': inert(), 'three/tsl': inert(), 'three/addons/utils/BufferGeometryUtils.js': inert(),
      './geodata.js': { GEO }, './city-config.js': await import('../js/city-config.js'), './tsl-materials.js': inert()
    },
    globals: { Math, Object, Array, Set, Map, Number, Infinity, JSON, Symbol, Float32Array, Float64Array, Promise,
      String, Error, console: { info() {}, warn() {}, log() {} } },
    filename: 'tram-infra.js'
  });
  const layout = layoutTramTunnels();
  const trams = loadModule(readFileSync(join(__dirname, '../js/trams.js'), 'utf8'), {
    imports: {
      'three/webgpu': inert(), './geodata.js': { GEO }, './city-config.js': { signalPhase: () => 'green' },
      './tsl-materials.js': { cityUniforms: { uInteriorGlow: { value: 0.3 } } },
      './actor-models.js': inert(),
      './vehicle-lights.js': {
        HEADLIGHTS: { busIntensity: 900 }, tramLightSpec: (len) => ({ headlight: [0.82, 0.9], zFront: len / 2 }),
        createVehicleHeadlight: () => inert(), placeVehicleHeadlight() {}
      }
    },
    globals: { Math, Object, Array, Set, Map, Number, Infinity, JSON, Symbol, Float32Array, Float64Array, Promise,
      String, Error, console },
    filename: 'trams.js'
  });
  const graph = trams.buildTrackGraph(GEO.rail, trams.SWITCH_TURN, layout.hidden);
  const point = { x: 0, z: 0, tx: 0, tz: 1 };
  let hiddenEdge = null;
  let openEdge = null;
  for (const e of graph.edges) {
    trams.edgePoint(e, e.len / 2, point);
    if (e.covered && layout.hiddenAt(point.x, point.z)) hiddenEdge = hiddenEdge || { e, x: point.x, z: point.z };
    if (!e.covered && layout.trenchAt(point.x, point.z, 1.5)) openEdge = openEdge || { e, x: point.x, z: point.z };
  }
  assert.ok(hiddenEdge, 'an edge inside a covered way carries a covered interval');
  assert.ok(openEdge, 'an edge in the open cutting has no covered interval');
  // The interval test used by the render loop
  const inside = hiddenEdge.e.covered.some((v, i) => i % 2 === 0 && hiddenEdge.e.len / 2 >= v &&
    hiddenEdge.e.len / 2 <= hiddenEdge.e.covered[i + 1]);
  assert.ok(inside, 'the covered interval contains the edge midpoint');
  // The mask interval ends exactly on a portal plane, not 2.6 m past it
  for (const p of layout.portals) {
    let best = null;
    for (const e of graph.edges) {
      if (!e.covered) continue;
      for (let i = 0; i < e.covered.length; i++) {
        trams.edgePoint(e, e.covered[i], point);
        const d = Math.hypot(point.x - p.x, point.z - p.z);
        if (d < 6 && (!best || d < best.d)) best = { d, x: point.x, z: point.z };
      }
    }
    if (!best) continue;
    const along = (best.x - p.x) * p.dx + (best.z - p.z) * p.dz;
    assert.ok(Math.abs(along) < 6.0, `mask ends ${along.toFixed(2)} m from the portal plane (half a Gamma section)`);
  }
});

test('no street furniture or street tree stands inside the PST cutting', async () => {
  const config = await import('../js/city-config.js');
  const { GEO } = await import('../js/geodata.js');
  const { buildRoadNetwork, CROSSWALK, CROSSWALK_REACH, STOP_SETBACK } = loadModule(
    readFileSync(join(__dirname, '../js/road-network.js'), 'utf8'), {
      imports: { './city-config.js': config, './geodata.js': { GEO } },
      globals: { console: { info: () => {} } }, filename: 'road-network.js'
    });
  const { clearOfRails } = loadModule(readFileSync(join(__dirname, '../js/city-grid.js'), 'utf8'), {
    imports: { 'three/webgpu': inert(), 'three/addons/utils/BufferGeometryUtils.js': inert(), './city-config.js': config,
      './geodata.js': { GEO }, './tsl-materials.js': inert() }, filename: 'city-grid.js'
  });
  const { buildStreetDetails } = loadModule(readFileSync(join(__dirname, '../js/street-details.js'), 'utf8'), {
    imports: {
      'three/webgpu': inert(), 'three/tsl': inert(), 'three/addons/utils/BufferGeometryUtils.js': inert(),
      './city-config.js': config, './road-network.js': { buildRoadNetwork, CROSSWALK, CROSSWALK_REACH, STOP_SETBACK },
      './tsl-materials.js': inert(), './trees.js': { createTreeField: () => ({ group: inert() }) },
      './city-grid.js': { pavedPlazaRects: [], parkTreeSites: [], parkLampSites: [], clearOfRails }
    },
    globals: { console: { info() {}, log() {}, warn() {} }, Math, Object, Array, Set, Map, Number, Infinity, JSON, Symbol,
      Float32Array, Uint8Array, Uint16Array, Uint32Array, Int32Array, Float64Array, Promise, String, Error,
      document: inert() }, filename: 'street-details.js'
  });
  const { footprints, colliders } = buildStreetDetails(inert());
  const cutting = GEO.tramTunnels.filter((g) => g.kind === 'trench');
  const minDist = (x, z) => {
    let best = Infinity;
    for (const g of cutting) best = Math.min(best, distToLine(x, z, g.pts));
    return best;
  };
  // The cutting parapet is 0.2 m thick with its inner face at 1.8 m; furniture keeps 2.3 m off the centreline.
  const KEEP = 2.3;
  const bad = [];
  for (const f of footprints) {
    const x = (f.minX + f.maxX) / 2, z = (f.minZ + f.maxZ) / 2;
    if (minDist(x, z) < KEEP) bad.push(`${f.kind} ${x.toFixed(1)}, ${z.toFixed(1)}`);
  }
  for (const c of colliders) {
    if (!c.isTrunk) continue;
    const x = (c.minX + c.maxX) / 2, z = (c.minZ + c.maxZ) / 2;
    if (minDist(x, z) < KEEP) bad.push(`tree ${x.toFixed(1)}, ${z.toFixed(1)}`);
  }
  assert.deepEqual(bad, [], `street furniture/trees inside the cutting: ${bad.slice(0, 8).join('; ')}`);
});
