// Pins re-derived on poznan 15f9359 plus the tram cut; see the tram-bed-surfaces observation.
const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { auditCityLamps } = require('./helpers/lamp-clearance.cjs');

test('all city lamps (street, gas, park, plaza) sit on sidewalk/walk with >= 0.50 m curb clearance', () => {
  const root = join(__dirname, '..');
  const { allLamps, byType } = auditCityLamps({ root });

  // 1. Lamp counts per class (SCC chord-cut guards preserve main LED count). The Franowo/Selgros satellite trim
  // (2026-11-19) removes 17 side LED masts in this reduced fixture; the audit world drops 18 (one more mast depends on
  // the real grid/build inputs this helper omits).
  assert.equal(byType.main.count, 2559, 'expected 2,559 main LED streetlights');
  assert.equal(byType.side.count, 20556, 'expected 20,556 side LED streetlights');
  assert.equal(byType.gas.count, 1055, 'expected 1,055 historic gas lanterns');
  // Minimum 6 m lamp spacing in city-grid.js drops duplicate park/plaza lamps at corners and shared edges.
  // One park globe is excluded under the Piaśnicka tram deck.
  assert.equal(byType.park.count, 2781, 'expected 2,781 park walk and lawn lampposts');
  // 665 before Teatr Polski (+8 -> 673), then 615 after dropping duplicate plaza lamps (< 6 m apart).
  assert.equal(byType.plaza.count, 612, 'expected 612 square/plaza lampposts');
  assert.equal(allLamps.length, 27563, 'expected 27,563 total lamps citywide');

  // 2. Zero lamps overlapping curb stone or roadway (< 0.25 m from curb edge)
  for (const [type, t] of Object.entries(byType)) {
    assert.equal(t.overlapCurbStone, 0, `${type} lamps must not overlap curb stone (< 0.25 m) or roadway`);
    assert.equal(t.footprintOverlapCurbStone, 0, `${type} footprints must not overlap curb stone`);
    assert.equal(t.clearanceLt05, 0, `${type} poles must have >= 0.50 m clearance from curb face`);
  }

  // 3. Explicit check for ulica Za Cytadelą (park side and street side)
  const { GEO } = require(join(root, 'js/geodata.js'));
  const zcRoads = GEO.roads.filter((r) => r[0] === 'Za Cytadelą').map((r) => r[5]);
  const dSeg = (px, pz, ax, az, bx, bz) => {
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
    return Math.hypot(px - ax - t * dx, pz - az - t * dz);
  };
  const zcDist = (x, z) => {
    let best = Infinity;
    for (const p of zcRoads) {
      for (let i = 0; i + 3 < p.length; i += 2) {
        best = Math.min(best, dSeg(x, z, p[i], p[i + 1], p[i + 2], p[i + 3]));
      }
    }
    return best;
  };

  const zcParkLamps = allLamps.filter((l) => l.type === 'park' && zcDist(l.x, l.z) < 15);
  assert.equal(zcParkLamps.length, 22, 'expected 22 park lamps along Za Cytadelą park perimeter');
  for (const l of zcParkLamps) {
    const record = byType.park.worst.find((r) => r.lamp === l);
    assert.ok(record, 'record must exist for Za Cytadelą park lamp');
    assert.ok(record.poleClearance >= 0.80, `Za Cytadelą park lamp at ${l.x},${l.z} clearance ${record.poleClearance} >= 0.80 m`);
  }

  const zcSideLamps = allLamps.filter((l) => l.type === 'side' && zcDist(l.x, l.z) < 15);
  assert.equal(zcSideLamps.length, 55, 'expected 55 side LEDs along Za Cytadelą street side');
  for (const l of zcSideLamps) {
    const record = byType.side.worst.find((r) => r.lamp === l);
    assert.ok(record, 'record must exist for Za Cytadelą side lamp');
    assert.ok(record.poleClearance >= 0.80, `Za Cytadelą side lamp at ${l.x},${l.z} clearance ${record.poleClearance} >= 0.80 m`);
  }
});
