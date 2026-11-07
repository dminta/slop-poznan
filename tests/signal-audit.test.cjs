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
  assert.equal(before.rows.length, 167);
  assert.equal(after.rows.length, 167);
  assert.deepEqual(before.summary.counts, { A: 17, B: 74, C: 66, D: 10 });
  assert.deepEqual(after.summary.counts, { A: 117, B: 0, C: 40, D: 10 });
  assert.equal(before.summary.vehicleHeads, 903);
  assert.equal(after.summary.vehicleHeads, 1004);
  assert.equal(after.summary.pedestrianHeads, 1572);
  assert.equal(after.summary.runtimePoles, 81);
  assert.equal(after.summary.reusedPoles, 20);
  assert.equal(after.summary.overheadHeads, 26);
  assert.equal(after.summary.overheadPoles, 12);
  assert.equal(after.summary.overheadReused, 14);
  assert.equal(after.summary.overheadStrict, 10);
  assert.equal(after.summary.overheadBand, 11);
  assert.equal(after.summary.overheadException, 15);
  assert.deepEqual(after.summary.overheadFallbackAlong,
    [1.75, 1.75, 1.75, 1.75, 1.75, 1.75, 1.75, 0.031, 1.75, 1.75, -0.816, 1.75, 1.75, 1.75, 1.75]);
  assert.ok(after.summary.overheadFootRailMin >= 3.1, 'mast feet keep 0.5 m from a 2.6 m mast setback');
  assert.ok(after.summary.overheadArmRailMin >= 2.22, 'every sampled arm and head keeps 2.22 m from rails');
  assert.ok(after.summary.overheadFallbackSupportMin > 12 && after.summary.overheadFallbackSupportMin < 13,
    'the closest fallback support misses the 12 m arm');
  assert.ok(after.summary.overheadArmMax > 11.7 && after.summary.overheadArmMax <= 12,
    'the longest overhead arm stays within the 12 m reach');
  assert.ok(after.summary.pedestrianApproaches.every((row) => row.class === 'A'),
    'every active pedestrian approach has an A head');
  for (const [x, z] of [[-359.7, -887.7], [2848.05, -1512.5], [1169.4, -2431.9],
    [-3513.4, 2170.5], [2024.63, 1666.8]]) {
    const row = after.summary.pedestrianApproaches.find((r) =>
      Math.hypot(r.node[0] - x, r.node[1] - z) < 0.01);
    assert.ok(row, `active pedestrian approach at ${x}, ${z}`);
    assert.equal(row.class, 'A', `pedestrian approach at ${x}, ${z} has its own-phase head`);
  }
  const placements = after.summary.placements.map((row) => row.map((v) =>
    typeof v === 'number' ? Number(v.toFixed(3)) : v));
  assert.equal(createHash('sha256').update(JSON.stringify(placements)).digest('hex'),
    '636398ec0efe2462b097f78fae04d5c51391ae81996189916e66c8b2ade48976');
  for (const [x, z] of [[1374.2, 566.1], [-2086.95, 2421.3]]) {
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
