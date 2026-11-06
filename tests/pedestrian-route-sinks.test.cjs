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
  let ends = 0;
  for (const crossing of routes.crosswalks) {
    for (const track of crossing.tracks) {
      for (const dir of [-1, 1]) {
        ends++;
        for (const path of routes.links(track, dir)) {
          const last = path[path.length - 1];
          assert.ok(!sibling(track, last.track), `line ${track.line} of the crossing at ${track.node.x},${track.node.z} U-turns onto its sibling`);
        }
      }
    }
  }
  assert.ok(ends > 5000, `the whole network has crosswalk ends (${ends})`);

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
          }
        }
      }
    }
  }
  assert.ok(sampled > 150 && chosen > 200, `route choices were sampled (${sampled} ends, ${chosen} paths)`);
});
