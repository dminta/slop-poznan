// Pins re-derived on poznan 15f9359 plus the tram cut; see the tram-bed-surfaces observation.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');
const test = require('node:test');
const { createHash } = require('node:crypto');

function audit(...args) {
  const output = execFileSync(process.execPath, [join(__dirname, '../tools/audit-signal-heads.mjs'), ...args],
    { encoding: 'utf8', timeout: 180000 });
  const rows = output.trim().split('\n').map((line) => JSON.parse(line));
  return { summary: rows.pop(), rows };
}

test('the furnished audit classifies historical approaches before and after runtime placement', async () => {
  const config = await import('../js/city-config.js');
  const before = audit('--before'), after = audit();
  assert.equal(before.rows.length, 210);
  assert.equal(after.rows.length, 210);
  assert.deepEqual(before.summary.counts, { A: 21, B: 72, C: 114, D: 3 });
  assert.deepEqual(after.summary.counts, { A: 207, B: 0, C: 0, D: 3 });
  // 20 static S-1 heads on the 9 remaining disabled plans are dropped at runtime pruning;
  // SCC & walkable-park fixes (2026-11-15) restore 12 more plans (21 -> 9 disabled, 3 historical D -> A).
  assert.equal(before.summary.vehicleHeads, 1101);
  assert.equal(after.summary.vehicleHeads, 1289);
  assert.equal(after.summary.pedestrianHeads, 1935);
  assert.equal(after.summary.runtimePoles, 109);
  assert.equal(after.summary.reusedPoles, 79);
  assert.equal(after.summary.overheadHeads, 113);
  assert.equal(after.summary.overheadPoles, 40);
  assert.equal(after.summary.overheadReused, 73);
  assert.equal(after.summary.overheadStrict, 99);
  assert.equal(after.summary.overheadBand, 101);
  assert.equal(after.summary.overheadException, 9);
  assert.deepEqual(after.summary.overheadFallbackAlong, [1.75, 1.75, 1.75, 0.031, 1.75, 1.75, 1.75, 1.738, 1.75]);
  assert.equal(after.summary.spanHeads, 44);
  assert.equal(after.summary.spanPoles, 34);
  assert.equal(after.summary.spanReused, 48);
  assert.equal(after.summary.spanNewHeads, 25);
  assert.equal(after.summary.spanExistingHeads, 19);
  assert.equal(after.summary.spanTractionHeads, 3);
  assert.equal(after.summary.spanTractionAnchors, 6);
  assert.equal(after.summary.cantileverPoles, 15);
  assert.equal(after.summary.spanStrict, 40);
  assert.equal(after.summary.spanBand, 41);
  assert.equal(after.summary.spanException, 3);
  assert.deepEqual(after.summary.spanFallbackAlong, [1.75, 1.75, 1.75]);
  assert.ok(after.summary.spanLengthMax > 53 && after.summary.spanLengthMax <= 55,
    'the longest span stay stays within the 55 m reach');
  assert.ok(after.summary.overheadFootRailMin >= 3.1, 'mast feet keep 0.5 m from a 2.6 m mast setback');
  assert.ok(after.summary.overheadArmRailMin >= 2.22, 'every sampled arm and head keeps 2.22 m from rails');
  assert.ok(after.summary.spanHeadRailMin >= 2.22, 'every span head keeps 2.22 m from rails');
  assert.ok(after.summary.overheadFallbackSupportMin > 12 && after.summary.overheadFallbackSupportMin < 13,
    'the closest fallback support misses the 12 m arm');
  assert.ok(after.summary.overheadArmMax > 11.7 && after.summary.overheadArmMax <= 12,
    'the longest overhead arm stays within the 12 m reach');
  assert.ok(after.summary.pedestrianApproaches.every((row) => row.class === 'A'),
    'every active pedestrian approach has an A head');
  for (const [x, z] of [[2848.05, -1512.5], [1169.4, -2431.9],
    [-7965.85, -537.55], [2024.63, 1666.8]]) {
    const row = after.summary.pedestrianApproaches.find((r) =>
      Math.hypot(r.node[0] - x, r.node[1] - z) < 0.01);
    assert.ok(row, `active pedestrian approach at ${x}, ${z}`);
    assert.equal(row.class, 'A', `pedestrian approach at ${x}, ${z} has its own-phase head`);
  }
  const placements = after.summary.placements.map((row) => row.map((v) =>
    typeof v === 'number' ? Number(v.toFixed(3)) : v));
  // Two active approaches previously reused poles from disabled plans and now place new poles.
  assert.equal(createHash('sha256').update(JSON.stringify(placements)).digest('hex'),
    'fc0038c94a4a04614dc65d416b9d7571104699b0bf7b164ea6b2c4c79c1e3ebc');
  const gorna = after.rows.find((r) => Math.hypot(r.node[0] + 448.825, r.node[1] - 947.425) < 0.01 &&
    r.direction[0] > 0.4 && r.direction[1] < -0.8);
  assert.ok(gorna, 'the Górna Wilda approach is still audited');
  assert.equal(gorna.class, 'A', 'the traction-anchored span serves the last C approach');
  assert.ok(Math.abs(gorna.along + 10.5) < 1e-6 && gorna.lateral > 3,
    `the Górna Wilda head sits on the clear side of the shared lane (${gorna.along}, ${gorna.lateral})`);
  for (const [x, z] of [[1374.2, 566.1], [1060.7, 1452.8]]) {
    assert.ok(before.rows.some((r) => Math.hypot(r.node[0] - x, r.node[1] - z) < 0.01 && r.class === 'B'));
    assert.ok(after.rows.some((r) => Math.hypot(r.node[0] - x, r.node[1] - z) < 0.01 && r.class === 'A'));
  }
  assert.ok(after.rows.filter((row) => row.class === 'A').every((row) =>
    row.along <= 2 && Math.abs(row.lateral) <= 15));
  const cycle = Math.max(120, ...config.SIGNAL_PLANS.map((plan) => plan.cycle || 0));
  let pedestrianA = 0;
  for (const [stage, report] of [['before', before], ['after', after]]) {
    for (const row of report.rows.filter((r) => r.class === 'A')) {
      assert.ok(row.head, `A row without a head at ${row.node} (${stage})`);
      assert.ok(Number.isInteger(row.plan) && Number.isInteger(row.nodePlan),
        `A row without a plan index at ${row.node} (${stage})`);
      const headPlan = { signalTiming: config.SIGNAL_PLANS[row.plan] };
      const edgePlan = { signalTiming: config.SIGNAL_PLANS[row.nodePlan] };
      for (let time = 0; time < cycle; time++) {
        assert.equal(config.signalPhase(time, row.group0, headPlan),
          config.signalPhase(time, row.axis0, edgePlan),
          `A head has the wrong phase at ${row.node}, ${time} s (${stage})`);
      }
      if (row.pedestrian) pedestrianA++;
    }
  }
  assert.ok(pedestrianA > 0, 'at least one A row is a pedestrian-only signal');
  assert.ok(before.rows.filter((row) => row.class === 'C').every((row) =>
    row.sampleCount === 300 && row.decisive.length && Object.keys(row.reasonCounts).length));
});
