// No pedestrian route runs over a vehicle carriageway (docs/observations/ped-roadway-2026-11-16.md).
// Builds the furnished headless world (city grid footprints, sidewalks and park blocks as main.js hands them to the road
// network), samples every sidewalk line, way line and corner link at 0.5 m and counts the samples that lie inside a
// carriageway (tools/audit-ped-roadway.mjs, --envelope span: the lane centres' span plus 1 m either side). Crosswalk tracks are the crossings and are exempt.
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWorld } from '../tools/bench-world.mjs';
import { createRoadOracle, staticAudit } from '../tools/audit-ped-roadway.mjs';

test('no sidewalk, way or corner link runs over a carriageway on the furnished network', () => {
  let s = 1;
  Math.random = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const { traffic, network } = buildWorld({ furnished: true });
  const oracle = createRoadOracle(network, traffic.crosswalks, { envelope: 'span', connectors: false });
  const r = staticAudit(traffic, oracle, 'furnished');
  assert.ok(r.tracks > 600000, `the furnished network lays out its routes (${r.tracks} tracks)`);
  // 177bdc3 made park blocks walkable, so the roads restored through them lay inside accepted walks: 767.5 m inside the
  // lane span (sidewalks 86 m, ways 116 m, links 566 m) on poznan. Now only grazes of a trimmed lane end remain: 31 m in
  // 31 runs (2026-11-16).
  assert.ok(r.totalMetres <= 60, `${r.totalMetres} m of routes inside a carriageway`);
  assert.equal(r.byKind.way || 0, 0, 'no pedestrian-way line on a driven carriageway');
  const longest = r.offenders[0];
  assert.ok(!longest || longest.len <= 6, `the longest run inside a carriageway is ${longest && longest.len} m`);
  for (const o of r.offenders) {
    assert.ok(o.kind !== 'sidewalk' || o.len <= 6, `a ${o.len} m sidewalk run at ${o.x.toFixed(1)}, ${o.z.toFixed(1)} is on a carriageway`);
  }
});
