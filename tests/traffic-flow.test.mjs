// Gridlock regression on the real network (Phases 15.6 and 16): a seeded five-minute run in the two
// districts that jammed worst. Before the fixes Jeżyce ran at 4.9 km/h with 67% of cars stopped, cars held 190 s and
// cars and trams waiting on each other in a cycle; Centrum at 3.3 km/h, 78% stopped, a car stuck in a junction box
// behind a tram that waited for it.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const bench = fileURLToPath(new URL('../tools/bench-traffic.mjs', import.meta.url));

test('traffic flows at Jeżyce and Centrum: no deadlock, nobody held over 2 minutes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'traffic-flow-'));
  try {
    const out = join(dir, 'flow.json');
    const run = spawnSync(process.execPath, [bench, '--minutes', '5', '--only', 'jezyce,centrum', '--json', out], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const { districts } = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(districts.length, 2);
    for (const d of districts) {
      assert.equal(d.deadlocks, 0, `${d.district}: vehicles waiting on each other in a cycle`);
      assert.equal(d.switchHeld60, 0, `${d.district}: a tram held at a switch for over a minute`);
      assert.ok(d.longestHeld < 120, `${d.district}: a car held ${d.longestHeld} s`);
      assert.ok(d.stoppedPct < 40, `${d.district}: ${d.stoppedPct}% of cars stopped`);
      // With the smaller emergency fleet, the seeded Jeżyce mean is 12.8 km/h.
      assert.ok(d.meanKmh > 12, `${d.district}: mean ${d.meanKmh} km/h`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
