const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const source = readFileSync(join(__dirname, '../js/satellite-sites.js'), 'utf8');
const { SATELLITE_SITES, satelliteClearance } = loadModule(source, { filename: 'satellite-sites.js' });

const site = (id) => SATELLITE_SITES.find((s) => s.id === id);

test('SATELLITE_SITES covers the audited out-of-box hubs', () => {
  const ids = SATELLITE_SITES.map((s) => s.id);
  for (const id of ['pestka', 'makro', 'poznan-plaza', 'm1-franowo', 'ikea-franowo', 'selgros',
    'homepark-franowo', 'obi-franowo', 'centrum-franowo', 'decathlon-franowo', 'hala-m-franowo',
    'volkswagen-antoninek', 'karolin']) {
    assert.ok(ids.includes(id), `missing satellite site ${id}`);
  }
  assert.equal(new Set(ids).size, ids.length, 'site ids are unique');
  for (const s of SATELLITE_SITES) {
    assert.equal(typeof s.name, 'string');
    assert.ok(s.name.length > 0);
    assert.ok(s.parts.length > 0);
  }
  assert.ok(site('volkswagen-antoninek').parts.length >= 5, 'VW Antoninek keeps its main halls');
  assert.ok(site('m1-franowo').parts.length >= 2, 'M1 is split into its two wings');
  assert.equal(site('king-cross'), undefined, 'King Cross is now a detail-box block, not a satellite');
});

test('satellite footprints are real-sized and centred outside the detail box', async () => {
  const { GEO } = await import('../js/geodata.js');
  const [minX, maxX, minZ, maxZ] = GEO.frame.detailBox;
  const inside = [];
  let area = 0;
  for (const s of SATELLITE_SITES) {
    let weight = 0;
    let cx = 0;
    let cz = 0;
    for (const p of s.parts) {
      for (const v of [p.x, p.z, p.w, p.d, p.angle, p.h]) assert.ok(Number.isFinite(v), `${s.id} has a finite part`);
      assert.ok(p.w >= 20 && p.w <= 420, `${s.id} width ${p.w} m`);
      assert.ok(p.d >= 20 && p.d <= 420, `${s.id} depth ${p.d} m`);
      assert.ok(p.h >= 8 && p.h <= 40, `${s.id} height ${p.h} m`);
      assert.ok(p.x > -8000 && p.x < 8000, `${s.id} x ${p.x} in the city frame`);
      assert.ok(p.z > -5000 && p.z < 4000, `${s.id} z ${p.z} in the city frame`);
      const a = p.w * p.d;
      weight += a;
      cx += p.x * a;
      cz += p.z * a;
      area += a;
    }
    if (cx / weight > minX && cx / weight < maxX && cz / weight > minZ && cz / weight < maxZ) {
      inside.push(`${s.id} (${(cx / weight).toFixed(0)}, ${(cz / weight).toFixed(0)})`);
    }
  }
  // M1, IKEA and Selgros overlap the box edge by a few hundred metres; their centres and most of their area stay out.
  assert.deepEqual(inside, [], 'every satellite site is centred outside the 8.2 x 5.7 km detail box');
  assert.ok(area > 350000 && area < 550000, `silhouette area ${Math.round(area)} m² is the expected order`);
});

test('Karolin keeps its cooling towers and 204 m chimney', () => {
  const karolin = site('karolin');
  const cooling = karolin.structures.filter((s) => s.kind === 'cooling');
  assert.equal(cooling.length, 2);
  for (const s of cooling) assert.ok(s.height >= 60 && s.height <= 90 && s.radius >= 10 && s.radius <= 30);
  const chimneys = karolin.structures.filter((s) => s.kind === 'chimney');
  assert.equal(chimneys.length, 1);
  assert.equal(chimneys[0].height, 204);
  assert.ok(chimneys[0].radius >= 4 && chimneys[0].radius <= 10);
});

test('satelliteClearance answers 0 on a footprint and stays clear at the Ratusz', () => {
  const first = SATELLITE_SITES[0].parts[0];
  assert.equal(satelliteClearance(first.x, first.z), 0);
  assert.ok(satelliteClearance(0, 0) > 2500, 'no satellite footprint reaches the centre');
});
