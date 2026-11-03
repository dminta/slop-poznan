// Headless audit: measure streetlight, gas lantern, park and plaza lamp clearance from curb edges.
// Uses shared lamp-clearance.cjs harness to audit every lamp pole across Poznań.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { auditCityLamps } = require('../tests/helpers/lamp-clearance.cjs');

const before = process.argv.includes('--before');
const jsonMode = process.argv.includes('--json');

const { allLamps, byType } = auditCityLamps({ root, before });

const summary = {
  totalPoles: allLamps.length,
  classes: {}
};

for (const [cls, t] of Object.entries(byType)) {
  summary.classes[cls] = {
    count: t.count,
    overlapCurbStoneOrRoadway: t.overlapCurbStone,
    footprintOverlapCurbStone: t.footprintOverlapCurbStone,
    clearanceLt05: t.clearanceLt05,
    clearance05To08: t.clearance05To08,
    clearanceGt08: t.clearanceGt08,
    worstClearance: t.worst.length > 0 ? t.worst[0].poleClearance : null,
    worst5: t.worst.slice(0, 5).map((r) => ({
      x: Number(r.lamp.x.toFixed(2)),
      z: Number(r.lamp.z.toFixed(2)),
      clearance: Number(r.poleClearance.toFixed(3)),
      distToCurb: Number(r.dist.toFixed(3)),
      footprintClearance: Number(r.footprintClearance.toFixed(3))
    }))
  };
}

if (jsonMode) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`=== Streetlight, Park & Plaza Lamp Curb Clearance Audit (${before ? 'BEFORE FIX' : 'AFTER FIX'}) ===\n`);
  console.log(`Total lamps evaluated: ${summary.totalPoles}`);
  console.log('-'.repeat(80));
  console.log(
    'Class'.padEnd(10) +
    'Total'.padStart(8) +
    'Overlap (<0.25m)'.padStart(18) +
    '< 0.50m'.padStart(12) +
    '0.50–0.80m'.padStart(14) +
    '> 0.80m'.padStart(12) +
    'Min Clear'.padStart(12)
  );
  console.log('-'.repeat(80));

  for (const [cls, data] of Object.entries(summary.classes)) {
    console.log(
      cls.padEnd(10) +
      String(data.count).padStart(8) +
      String(data.overlapCurbStoneOrRoadway).padStart(18) +
      String(data.clearanceLt05).padStart(12) +
      String(data.clearance05To08).padStart(14) +
      String(data.clearanceGt08).padStart(12) +
      (data.worstClearance !== null ? `${data.worstClearance.toFixed(3)} m` : 'N/A').padStart(12)
    );
  }
  console.log('-'.repeat(80));

  console.log('\nWorst Clearance Examples per Class:');
  for (const [cls, data] of Object.entries(summary.classes)) {
    console.log(`\n[${cls.toUpperCase()}]`);
    for (const ex of data.worst5) {
      console.log(
        `  pos: (${ex.x.toFixed(2)}, ${ex.z.toFixed(2)}) | ` +
        `pole clearance: ${ex.clearance.toFixed(3)} m | ` +
        `dist to curb: ${ex.distToCurb.toFixed(3)} m | ` +
        `footprint clear: ${ex.footprintClearance.toFixed(3)} m`
      );
    }
  }
}
