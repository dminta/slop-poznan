import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
test('geodata builds with default paths in a checkout containing spaces and non-ASCII characters', { timeout: 180000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'New York 東京 '));
  try {
    fs.mkdirSync(path.join(dir, 'tools'));
    fs.mkdirSync(path.join(dir, 'js'));
    for (const name of fs.readdirSync(path.join(root, 'tools'))) {
      if (name.endsWith('.mjs')) fs.copyFileSync(path.join(root, 'tools', name), path.join(dir, 'tools', name));
    }
    fs.symlinkSync(path.join(root, 'tools/data'), path.join(dir, 'tools/data'), 'dir');
    const env = { ...process.env };
    delete env.GEO_DATA;
    const result = spawnSync(process.execPath, ['--max-old-space-size=8192', path.join(dir, 'tools/build-geodata.mjs')], {
      encoding: 'utf8', env, timeout: 180000
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const { GEO } = await import(pathToFileURL(path.join(dir, 'js/geodata.js')).href);
    assert.ok(GEO.roadGraph.links.length > 0);
    assert.ok(GEO.blocks.length > 0);
    // frame.ll is the affine lon/lat -> world map boroughs.js LL() uses: the tangent point (geo-base.mjs LAT0/LON0)
    // must land where the old hand constants put it, (-54.351, 69.424) from the 5th Ave & 42nd St origin
    const ll = GEO.frame.ll;
    assert.equal(ll.length, 6);
    const [lon, lat] = [-73.98185, 40.75318];
    assert.ok(Math.abs(ll[0] * lon + ll[1] * lat + ll[2] + 54.351) < 0.01);
    assert.ok(Math.abs(ll[3] * lon + ll[4] * lat + ll[5] - 69.424) < 0.01);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// The Poznań pipeline (docs/poznan-plan.md §4), built next to the NYC one until the Phase 5 cutover: same temp-checkout
// set-up, but an explicit output path, since its default is os.tmpdir() rather than js/geodata.js
test('Poznań geodata builds offline from the committed snapshots', { timeout: 180000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'Poznań Zażółć 東京 '));
  try {
    fs.mkdirSync(path.join(dir, 'tools'));
    for (const name of fs.readdirSync(path.join(root, 'tools'))) {
      if (name.endsWith('.mjs')) fs.copyFileSync(path.join(root, 'tools', name), path.join(dir, 'tools', name));
    }
    fs.symlinkSync(path.join(root, 'tools/data'), path.join(dir, 'tools/data'), 'dir');
    const env = { ...process.env };
    delete env.GEO_DATA;
    const out = path.join(dir, 'geodata-poznań.js');
    const result = spawnSync(process.execPath, ['--max-old-space-size=8192', path.join(dir, 'tools/build-poznan.mjs'), out], {
      encoding: 'utf8', env, timeout: 180000
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const { GEO } = await import(pathToFileURL(out).href);
    assert.equal(GEO.version, 2);
    assert.ok(GEO.land.length >= 3, 'west bank, east bank and Ostrów Tumski');
    assert.ok(GEO.water.some((w) => w.name === 'Warta'));
    assert.ok(GEO.roadGraph.links.some((l) => l[7] & 1), 'a bridge link');
    assert.ok(GEO.roadGraph.signals.length > 100);
    assert.ok(GEO.landmarks['Ratusz']);
    assert.ok(GEO.blocks.length > 500);
    // frame.ll puts the Ratusz (the D1 origin) at the world origin
    const ll = GEO.frame.ll;
    const [lon, lat] = [16.93401, 52.40856];
    assert.ok(Math.abs(ll[0] * lon + ll[1] * lat + ll[2]) < 0.01);
    assert.ok(Math.abs(ll[3] * lon + ll[4] * lat + ll[5]) < 0.01);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
