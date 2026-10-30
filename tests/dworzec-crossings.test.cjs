const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

// Rendering is inert, but the grid's curb/median footprints and live plaza/park sites feed the next builders as in
// main.js. A bare road graph can accept a crossing that the raised median's traffic footprint later closes.
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

test('the Dworzec refuges connect the western sidewalk to the southern sidewalk with actual curbs and furniture', async () => {
  const config = await import('../js/city-config.js');
  const { GEO } = await import('../js/geodata.js');
  const source = (name) => readFileSync(join(__dirname, '../js', name + '.js'), 'utf8');
  const quiet = { info() {}, log() {}, warn() {} };
  // Record the rendered head directions as well as the matching audio plan; presence alone misses a backwards head.
  const headFacings = [];
  const load = (name, imports, extra = '') => loadModule(source(name).replace(
    '    dummy.rotation.set(0, Math.atan2(fx, fz), 0);',
    '    headFacings.push({ x, z, fx, fz });\n    dummy.rotation.set(0, Math.atan2(fx, fz), 0);'
  ).replace(
    'return { along, across, next, crosswalks };', 'return { along, across, next, crosswalks, links };'
  ) + extra, {
    imports,
    globals: { console: quiet, document: inert(), headFacings },
    filename: name + '.js'
  });
  const rendering = {
    'three/webgpu': inert(),
    'three/tsl': inert(),
    'three/addons/utils/BufferGeometryUtils.js': inert(),
    './tsl-materials.js': inert()
  };
  const road = load('road-network', { './city-config.js': config, './geodata.js': { GEO } });
  // loadModule returns exported lets by value. Read the populated values after the grid reassigns them.
  const gridModule = load('city-grid', { ...rendering, './city-config.js': config, './geodata.js': { GEO } },
    '\nexport function snapshot() { return { pavedPlazaRects, parkTreeSites, parkLampSites, sidewalkBlocks }; }');
  const grid = gridModule.buildCityGrid(inert());
  const liveGrid = { ...gridModule, ...gridModule.snapshot() };
  const street = load('street-details', {
    ...rendering,
    './city-config.js': config,
    './road-network.js': road,
    './city-grid.js': liveGrid,
    './trees.js': { createTreeField: () => ({ group: inert() }) }
  }).buildStreetDetails(inert());
  const network = road.buildRoadNetwork(grid.sidewalks, [...grid.footprints, ...street.footprints]);
  const blockedRefuges = road.buildRoadNetwork(grid.sidewalks, [
    ...grid.footprints.map((r) => ({ ...r, walkable: false })), ...street.footprints
  ]);
  const lanes = (net) => Array.from(net.edges, (e) => [e.sx, e.sz, e.dx, e.dz, e.len, ...e.lanes]);
  assert.deepEqual(lanes(network), lanes(blockedRefuges), 'opening pedestrian refuges preserves every car lane');
  const { createPedestrianRoutes } = load('pedestrian-routes', { './road-network.js': road });
  const routes = createPedestrianRoutes(network, config.blockAt, gridModule.railClearance);
  const central = network.nodes.find((n) => Math.hypot(n.x + 1567.23, n.z - 560.23) < 1);
  assert.ok(central, 'the central six-arm Dworzec junction is in the drivable network');
  assert.ok(routes.across(central).length > 0, 'the central Dworzec junction has a pedestrian connection');
  const before = createPedestrianRoutes(blockedRefuges, config.blockAt, gridModule.railClearance);
  const key = (c) => `${c.node.x},${c.node.z},${c.side}`;
  const originalCrossings = new Set(Array.from(before.crosswalks, key));
  const restored = routes.crosswalks.filter((c) => !originalCrossings.has(key(c)));
  const node = network.nodes.find((n) => Math.hypot(n.x + 1592.6, n.z - 579.6) < 1);
  assert.ok(node, 'the western Roosevelta / Most Dworcowy approach is in the drivable network');
  const crossings = routes.crosswalks.filter((c) => c.node === node &&
    Math.hypot((c.ax + c.bx) / 2 + 1588.93, (c.az + c.bz) / 2 - 562.39) < 1);
  assert.ok(crossings.length > 0, 'the crossing onto the existing western refuge is usable');
  const south = routes.crosswalks.find((c) => c.node === central && c.tracks.some((t) => t.sides?.length > 1));
  assert.ok(south, 'a compound crossing connects the western refuge to the southern sidewalk');
  function connected(starts, direction, targets, targetDirection) {
    const visited = new Map();
    const queue = starts.flatMap((c) => Array.from(c.tracks, (track) => ({ track, dir: direction })));
    for (let i = 0; i < queue.length && i < 10000; i++) {
      const { track, dir } = queue[i];
      const bit = dir > 0 ? 1 : 2;
      if ((visited.get(track) || 0) & bit) continue;
      visited.set(track, (visited.get(track) || 0) | bit);
      if (dir === targetDirection && targets.some((c) => c.tracks.includes(track))) return true;
      for (const path of routes.links(track, dir)) queue.push(path[path.length - 1]);
    }
    return false;
  }
  assert.ok(connected(crossings, 1, [south], 1), 'the western sidewalk reaches the southern sidewalk');
  assert.ok(connected([south], -1, crossings, -1), 'the southern sidewalk reaches the western sidewalk');
  const landing = south.tracks[0];
  assert.ok(Math.hypot(landing.ax + landing.ux * landing.len + 1558,
    landing.az + landing.uz * landing.len - 579.5) < 1, 'the compound walk ends on the exact southern sidewalk');
  const westEnd = { x: landing.ax, z: landing.az };
  const southEnd = { x: landing.ax + landing.ux * landing.len, z: landing.az + landing.uz * landing.len };
  const facingSouth = street.audioSignals.find((head) => {
    if (head.signalTiming !== central.signalTiming || head.isAvenue !== (south.group !== 0) ||
      Math.hypot(head.x - westEnd.x, head.z - westEnd.z) > 8) return false;
    const facing = headFacings.find((f) => Math.hypot(f.x - head.x, f.z - head.z) < 0.01);
    const dx = southEnd.x - head.x, dz = southEnd.z - head.z;
    return facing && (dx * facing.fx + dz * facing.fz) / Math.hypot(dx, dz) > 0.95;
  });
  assert.ok(facingSouth, 'pedestrians on the southern sidewalk can read their WALK head across the shared zebra');
  const pole = street.footprints.find((r) => r.kind === 'signal' &&
    Math.hypot((r.minX + r.maxX) / 2 - facingSouth.x, (r.minZ + r.maxZ) / 2 - facingSouth.z) < 0.3);
  assert.ok(pole, 'the extra head has a physical signal pole registered before the network is built');
  const poleX = (pole.minX + pole.maxX) / 2, poleZ = (pole.minZ + pole.maxZ) / 2;
  assert.ok(gridModule.railClearance(poleX, poleZ, 10) >= 2.22, 'the pole keeps its full footprint off the rails');
  assert.ok(config.roadClearance(poleX, poleZ) >= 0.8, 'the pole stays clear of the carriageways');
  const withoutPole = road.buildRoadNetwork(grid.sidewalks, [...grid.footprints, ...street.footprints.filter((r) => r !== pole)]);
  assert.deepEqual(lanes(network), lanes(withoutPole), 'the supplementary signal pole preserves every car lane');
  for (const crossing of [south, ...crossings]) {
    for (const track of crossing.tracks) {
      for (const direction of [-1, 1]) {
        for (const path of routes.links(track, direction)) {
          for (const { track: leg } of path) {
            const t = Math.max(0, Math.min(leg.len, (poleX - leg.ax) * leg.ux + (poleZ - leg.az) * leg.uz));
            assert.ok(Math.hypot(poleX - leg.ax - leg.ux * t, poleZ - leg.az - leg.uz * t) > 0.65,
              'the pole leaves the actual crossing and refuge links clear');
          }
        }
      }
    }
  }
  const peer = central.arms.find((a) => a.side === 0);
  const originalGroup = peer.group;
  peer.group = 1;
  const opposingPhase = createPedestrianRoutes({ ...network, configureCrosswalks: null }, config.blockAt,
    gridModule.railClearance);
  peer.group = originalGroup;
  assert.ok(!opposingPhase.across(central).some((t) => t.sides), 'different signal groups cannot share a compound walk');
  const mx = (south.ax + south.bx) / 2, mz = (south.az + south.bz) / 2;
  const queuedRoad = { sx: mx - south.ux * 10, sz: mz - south.uz * 10, dx: south.ux, dz: south.uz,
    x0: mx - south.ux * 10, z0: mz - south.uz * 10, len: 20, span: 20, half: 1 };
  const obstructed = createPedestrianRoutes({ ...network, edges: [...network.edges, queuedRoad],
    configureCrosswalks: null }, config.blockAt, gridModule.railClearance);
  assert.ok(!obstructed.across(central).some((t) => t.sides), 'another queued roadway still blocks a compound zebra');
  for (const compound of routes.crosswalks.filter((c) => c.tracks.some((t) => t.sides))) {
    const owned = compound.tracks[0].sides.map((s) => s.side);
    const length = Math.hypot(compound.bx - compound.ax, compound.bz - compound.az);
    const ux = (compound.bx - compound.ax) / length, uz = (compound.bz - compound.az) / length;
    for (const edge of compound.node.in) {
      for (const move of edge.moves) {
        for (let lane = 0; lane < edge.lanes.length; lane++) {
          const out = move.out[lane];
          if (out < 0) continue;
          const curve = network.connector(edge, lane, move.to, out);
          const p = {};
          let last = -Infinity;
          for (let s = 0; s <= curve.len; s += 0.1) {
            network.curvePoint(curve, s, p);
            const a = (p.x - compound.ax) * ux + (p.z - compound.az) * uz;
            const b = -(p.x - compound.ax) * uz + (p.z - compound.az) * ux;
            if (a >= -1.5 && a <= length + 1.5 && Math.abs(b) <= compound.h + 1.5) last = s;
          }
          if (last < 0) continue;
          assert.ok(owned.includes(edge.inSide) || owned.includes(move.to.outSide),
            'every movement crossing a compound zebra belongs to one of its protected arms');
          if (owned.includes(edge.inSide)) {
            assert.ok(curve.crosswalkEnd >= last, 'the incoming reservation covers the actual last curve intersection');
            assert.ok(edge.crosswalkEnd >= last, 'the entry horizon covers the actual last curve intersection');
            assert.ok(move.to.crosswalkTails.some((tail) => tail.node === compound.node &&
              tail.side === edge.inSide && tail.end >= last - curve.len), 'the outgoing edge preserves rear clearance');
          }
        }
      }
    }
  }
  for (const crossing of restored) {
    for (const track of crossing.tracks) {
      for (const end of [0, 1]) {
        const x = track.ax + track.ux * track.len * end;
        const z = track.az + track.uz * track.len * end;
        assert.ok(config.blockAt(x, z) || track.refuge?.[end]?.length, 'the walk reaches a curb island or refuge');
        if (!track.cramped?.[end]) {
          // Pedestrians wait KERB=1.6 m from the track endpoint, towards the carriageway.
          const direction = end ? -1 : 1;
          const waitX = x + track.ux * direction * 1.6;
          const waitZ = z + track.uz * direction * 1.6;
          assert.ok(gridModule.railClearance(waitX, waitZ, 3) >= 2, 'the waiting point stays 2 m off the rails');
        }
      }
    }
  }
});
