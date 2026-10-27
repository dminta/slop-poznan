import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
// Built in a temp checkout whose path has spaces and non-ASCII characters, with the default paths (tools/data in,
// js/geodata.js out), offline from the committed snapshots
test('Poznań geodata builds offline with default paths in a checkout containing spaces and non-ASCII characters', { timeout: 180000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'Poznań Zażółć 東京 '));
  try {
    fs.mkdirSync(path.join(dir, 'tools'));
    fs.mkdirSync(path.join(dir, 'js'));
    for (const name of fs.readdirSync(path.join(root, 'tools'))) {
      if (name.endsWith('.mjs')) fs.copyFileSync(path.join(root, 'tools', name), path.join(dir, 'tools', name));
    }
    fs.symlinkSync(path.join(root, 'tools/data'), path.join(dir, 'tools/data'), 'dir');
    const env = { ...process.env };
    delete env.GEO_DATA;
    const result = spawnSync(process.execPath, ['--max-old-space-size=8192', path.join(dir, 'tools/build-poznan.mjs')], {
      encoding: 'utf8', env, timeout: 180000
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const { GEO } = await import(pathToFileURL(path.join(dir, 'js/geodata.js')).href);
    assert.equal(GEO.version, 2);
    assert.ok(GEO.land.length >= 3, 'west bank, east bank and Ostrów Tumski');
    assert.ok(GEO.water.some((w) => w.name === 'Warta'));
    assert.ok(GEO.roadGraph.links.some((l) => l[7] & 1), 'a bridge link');
    // painted bike lanes (OSM cycleway=lane): flags bit 3 right of a -> b, bit 4 left; ~270 links on the 2026-10-25 snapshot
    assert.ok(GEO.roadGraph.links.filter((l) => l[7] & 24).length > 150, 'bike lane links');
    assert.ok(GEO.roadGraph.signals.length > 100);
    // Speed limits (km/h) on every link: the built-up 50 on most, with many 30/20 zones and a few 70 km/h arteries
    const limits = GEO.roadGraph.links.map((l) => l[8]);
    assert.ok(limits.every((v) => [5, 10, 15, 20, 30, 40, 50, 60, 70, 80].includes(v)), 'plausible limits');
    const share = (f) => limits.filter(f).length / limits.length;
    assert.ok(share((v) => v === 50) > 0.3, '50 km/h is the common limit');
    assert.ok(share((v) => v <= 30) > 0.3, 'many 30 and 20 zones');
    assert.ok(limits.includes(70), 'a 70 km/h artery');
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
