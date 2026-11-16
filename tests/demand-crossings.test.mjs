// Regression test for NPC pedestrian demand requests at demand crossings (two-arm signalised nodes),
// including node 2634 at (415.5, 523) (formerly 2422 in signals-2026-10-30.md).
// Checks that requests are served within the 20 s green + 5 s clearance bound and no walker crosses on road green
// (catching the float64 curbProgress <= KERB precision bug when p.dir === -1).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const audit = fileURLToPath(new URL('../tools/audit-demand-crossings.mjs', import.meta.url));

test('demand crossings serve NPC requests within bound and never release walkers on road green', () => {
  const run = spawnSync(
    process.execPath,
    [audit, '--seeds', '4242', '--minutes', '1.5', '--only', '2654,139,1667', '--json'],
    { encoding: 'utf8' }
  );
  assert.equal(run.status, 0, run.stderr);
  const { summary, rows } = JSON.parse(run.stdout);
  assert.equal(summary.demandNodes, 3);
  assert.equal(summary.unvisitedNodes, 0);
  assert.equal(summary.totalStarved, 0);
  assert.equal(summary.totalEnteredOnGreen, 0);
  assert.equal(summary.totalOnRoadwayDuringGreen, 0);
  assert.equal(summary.clearanceFailures, 0);
  assert.equal(summary.roadGreenFailures, 0);
  assert.equal(summary.requestDelayFailures, 0);

  const node2422 = rows.find((r) => Math.hypot(r.x - 415.5, r.z - 523) < 2);
  assert.ok(node2422, 'expected demand crossing at (415.5, 523)');
  for (const r of rows) {
    assert.ok(r.requests >= 1, `node ${r.id}: expected >= 1 request, got ${r.requests}`);
    assert.ok(r.phasesServed >= 1, `node ${r.id}: expected >= 1 phase served, got ${r.phasesServed}`);
    assert.ok(r.latMax !== null && r.latMax <= 26, `node ${r.id}: latency ${r.latMax} s exceeded bound`);
    assert.equal(r.enteredOnGreen, 0, `node ${r.id}: ${r.enteredOnGreen} walkers entered on road green`);
    assert.equal(r.onRoadwayDuringGreen, 0, `node ${r.id}: ${r.onRoadwayDuringGreen} walkers on roadway during green`);
    assert.equal(r.starved, 0, `node ${r.id}: ${r.starved} walkers starved`);
  }
});
