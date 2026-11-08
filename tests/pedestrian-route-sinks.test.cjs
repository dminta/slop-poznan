const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

// A crosswalk end must never offer the other painted line of the same crossing as the next leg (a U-turn straight
// back over the road) and must never send a walker over a crossing whose far end has no way off it. Both made people
// cross back and forth forever at dead ends and funnel through one 1.5 m curb link until they stood on top of each
// other (docs/observations/ped-overlaps-2026-11-05.md).
test('pedestrian routes do not U-turn over a crossing line or cross into a dead end', async () => {
  const config = await import('../js/city-config.js');
  const { GEO } = await import('../js/geodata.js');
  const quiet = { info() {}, log() {}, warn() {} };
  const road = loadModule(readFileSync(join(__dirname, '../js/road-network.js'), 'utf8'), {
    imports: { './city-config.js': config, './geodata.js': { GEO } },
    globals: { console: quiet },
    filename: 'road-network.js'
  });
  const { createPedestrianRoutes } = loadModule(
    readFileSync(join(__dirname, '../js/pedestrian-routes.js'), 'utf8').replace(
      'return { along, across, next, crosswalks, segments, segmentsNear };',
      'return { along, across, next, crosswalks, segments, segmentsNear, links };'
    ),
    { imports: { './road-network.js': road } }
  );
  const network = road.buildRoadNetwork([], []);
  const routes = createPedestrianRoutes(network, config.blockAt, null);
  const sibling = (a, b) => a !== b && !!a.node && a.node === b.node && a.side === b.side &&
    a.group === b.group && a.line !== b.line;

  // Every actual link from every crosswalk end: none may step onto the sibling line of the same crossing.
  let ends = 0, emptyEnds = 0, emptyTracks = 0;
  for (const crossing of routes.crosswalks) {
    for (const track of crossing.tracks) {
      let anyEmpty = false;
      for (const dir of [-1, 1]) {
        ends++;
        const paths = routes.links(track, dir);
        if (!paths.length) {
          emptyEnds++;
          anyEmpty = true;
        }
        for (const path of paths) {
          const last = path[path.length - 1];
          assert.ok(!sibling(track, last.track), `line ${track.line} of the crossing at ${track.node.x},${track.node.z} U-turns onto its sibling`);
        }
      }
      if (anyEmpty) emptyTracks++;
    }
  }
  assert.ok(ends > 5000, `the whole network has crosswalk ends (${ends})`);
  // The 2026-11-07 landing work (sidewalk track ends in the long fallback, a 16 m corner corridor with a courtyard
  // sight line) left 109 empty ends / 98 tracks on this bare network. Splitting each sidewalk line into its clear
  // same-block runs, linking a landing to a kerb end within 8 m and keeping split runs clear of every lane brings that
  // to 38 / 33; tram-cut islands with no road-edge line at all get a short kerb track of their own. With no building or
  // rail input the bare network is more permissive than the furnished world (47 / 41), so these ceilings only catch a
  // regression that reopens dead ends.
  assert.ok(emptyEnds <= 40, `the bare network leaves isolated crosswalk ends (${emptyEnds})`);
  assert.ok(emptyTracks <= 40, `the bare network leaves tracks with an empty end (${emptyTracks})`);

  // Sample route choices across the city with several goals per end. A chosen crossing must have links at the landing
  // it walks to, and must not be a turn back onto the same crossing's other line.
  let chosen = 0, sampled = 0;
  for (let k = 0; k < routes.crosswalks.length; k += 31) {
    for (const track of routes.crosswalks[k].tracks) {
      for (const dir of [-1, 1]) {
        sampled++;
        for (const [gx, gz] of [[-2000, -1200], [0, 0], [1800, 1400]]) {
          const path = routes.next(track, dir, gx, gz);
          if (!path) continue;
          chosen++;
          const last = path[path.length - 1];
          assert.ok(!sibling(track, last.track), 'a route choice U-turns over the same crossing');
          if (last.track.node) {
            assert.ok(routes.links(last.track, last.dir).length > 0,
              `a route choice crosses into a dead end at ${last.track.node.x},${last.track.node.z}`);
          } else if (last.track.edge) {
            const end = last.dir > 0 ? 1 : 0;
            const x = last.track.ax + last.track.ux * last.track.len * end;
            const z = last.track.az + last.track.uz * last.track.len * end;
            assert.ok(!config.blockAt(x, z) || routes.links(last.track, last.dir).length > 0,
              `a route choice ends on a dead-end sidewalk track at ${x.toFixed(1)},${z.toFixed(1)}`);
          }
        }
      }
    }
  }
  assert.ok(sampled > 150 && chosen > 200, `route choices were sampled (${sampled} ends, ${chosen} paths)`);

  // The long fallback lands on sidewalk tracks, whose ends are `from`/`to` rather than a crosswalk `node`. A goal on
  // such a dead end used to route straight into it (151 of 230 bare-network links before the guard) and leave the
  // walker to reverse on the same short track. Every such link must now be filtered out of `next`, even when the goal
  // lies exactly on its landing. A tram-island kerb (`landing`) or a dead-end split run marked a terminus is the
  // exception: it is the legal end of the crossing, not a court or park-edge sink. The bare network still has ordinary
  // dead-end sidewalk links, so this cannot pass vacuously.
  let deadSidewalkLinks = 0, deadGoals = 0;
  const tracks = new Set();
  for (const crossing of routes.crosswalks) for (const track of crossing.tracks) tracks.add(track);
  for (const track of tracks) {
    for (const dir of [-1, 1]) {
      for (const path of routes.links(track, dir)) {
        const last = path[path.length - 1], target = last.track;
        if (!target.edge || target.node || target.landing || target.terminus) continue;
        if (routes.links(target, last.dir).length) continue;
        const end = last.dir > 0 ? 1 : 0;
        const x = target.ax + target.ux * target.len * end, z = target.az + target.uz * target.len * end;
        if (!config.blockAt(x, z)) continue;
        deadSidewalkLinks++;
        const chosenPath = routes.next(track, dir, x, z);
        if (!chosenPath) continue;
        deadGoals++;
        const chosenEnd = chosenPath[chosenPath.length - 1];
        assert.ok(chosenEnd.track !== target || chosenEnd.dir !== last.dir,
          `a goal on a dead-end sidewalk track routes into it at ${x.toFixed(1)},${z.toFixed(1)}`);
      }
    }
  }
  assert.ok(deadSidewalkLinks > 100, `the bare network has dead-end sidewalk links (${deadSidewalkLinks})`);
  assert.ok(deadGoals > 100, `goals on dead-end sidewalk links were routed (${deadGoals})`);
});

// The five keys named in docs/backlog.md: Okrąglak, Okrąglak / Święty Marcin, Miła / Dąbrowskiego, Promienista /
// Grochowska and Wierzbięcice / Górna Wilda. Each crosswalk end must reach a real kerb track on its own block (a
// split road-edge run, or a generated spur on a tram-cut island), not only a connector across a lane or the rails.
test('the named tram-island landings reach a legal kerb track', async () => {
  const config = await import('../js/city-config.js');
  const { buildWorld, loadBuildingColliders, loadPedestrianRoutes } = await import('../tools/bench-world.mjs');
  const { network, railClearance } = buildWorld({ noPeds: true, noTrams: true });
  const buildings = loadBuildingColliders();
  const routes = loadPedestrianRoutes().createPedestrianRoutes(
    network, config.blockAt, railClearance, buildings
  );
  const RAIL_KEEP = 2.22;
  const laneClearAt = (x, z) => !network.edges.some((e) => {
    const s = (x - e.sx) * e.dx + (z - e.sz) * e.dz;
    if (s < 0 || s > e.len) return false;
    return Math.abs((x - e.sx) * e.rx + (z - e.sz) * e.rz) < e.half + 0.8;
  });
  const goals = [[-2000, -1200], [0, 0], [1800, 1400], [-3541, 1448], [1000, 1000], [-800, 1600]];
  const hitsBuilding = (x, z) => {
    for (const c of buildings) {
      if ((c.minY ?? 0) >= 1.9) continue;
      if (c.obb) {
        const { cx, cz, hx, hz, cs, sn } = c.obb;
        const dx = x - cx, dz = z - cz;
        if (Math.abs(dx * cs - dz * sn) <= hx + 0.4 && Math.abs(dx * sn + dz * cs) <= hz + 0.4) return true;
      } else if (x >= c.minX - 0.4 && x <= c.maxX + 0.4 && z >= c.minZ - 0.4 && z <= c.maxZ + 0.4) {
        return true;
      }
    }
    return false;
  };
  const tracks = new Set();
  for (const crossing of routes.crosswalks) for (const track of crossing.tracks) tracks.add(track);
  const points = [[-841.5, 30.6], [-1120.1, 112], [-3269.1, -884.3], [-3541.4, 1448.4], [-3540.3, 1449.4],
    [-851.4, 1662.7], [-851.4, 1664.2]];
  for (const [x, z] of points) {
    let found = 0, sidewalk = 0;
    for (const track of tracks) {
      for (const dir of [-1, 1]) {
        const end = dir > 0 ? 1 : 0;
        const px = track.ax + track.ux * track.len * end, pz = track.az + track.uz * track.len * end;
        if (Math.hypot(px - x, pz - z) > 1) continue;
        found++;
        for (const path of routes.links(track, dir)) {
          const last = path[path.length - 1].track;
          if (!last.node && (last.edge || last.landing)) sidewalk++;
          for (const { track: leg } of path) {
            const steps = Math.max(1, Math.ceil(leg.len / 0.5));
            for (let i = 0; i <= steps; i++) {
              const lx = leg.ax + leg.ux * leg.len * i / steps, lz = leg.az + leg.uz * leg.len * i / steps;
              assert.ok(railClearance(lx, lz, RAIL_KEEP + 1) >= RAIL_KEEP,
                `a landing leg at ${x},${z} keeps ${RAIL_KEEP} m from the rails`);
              assert.ok(!hitsBuilding(lx, lz), `a landing leg at ${x},${z} stays out of buildings`);
              assert.ok(laneClearAt(lx, lz), `a landing leg at ${x},${z} keeps half a lane + 0.8 m clear`);
              if (leg.block && !leg.node) {
                assert.equal(config.blockAt(lx, lz), leg.block, `a kerb track at ${x},${z} stays on its block`);
              }
            }
          }
        }
        for (const [gx, gz] of goals) {
          assert.ok(routes.next(track, dir, gx, gz),
            `the landing at ${x},${z} routes toward the goal at ${gx},${gz}`);
        }
      }
    }
    assert.ok(found > 0, `the named landing at ${x},${z} is a crosswalk end`);
    assert.ok(sidewalk > 0, `the landing at ${x},${z} reaches a kerb track`);
  }
});
