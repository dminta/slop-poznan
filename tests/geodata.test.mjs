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
    // flags: bits 0-2 only (bridge, tram, roundabout); the bike-lane bits 3/4 are gone with the bike lanes
    assert.ok(GEO.roadGraph.links.every((l) => (l[7] & ~7) === 0), 'no flags beyond bit 2');
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
    // blockStats: [built share, median levels, buildings] per block, from the OSM footprints (poz-buildings.mjs)
    const stats = GEO.blockStats;
    assert.equal(stats.length, GEO.blocks.length);
    assert.ok(stats.every(([s, lv, n]) => s >= 0 && s <= 1 && lv >= 0 && lv < 60 && Number.isInteger(n) && n >= 0));
    const blockArea = (f) => { let a = 0; for (let i = 0, j = f.length - 2; i < f.length; j = i, i += 2) a += f[j] * f[i + 1] - f[i] * f[j + 1]; return Math.abs(a) / 2; };
    const nearRatusz = (f) => { const x = f.filter((_, i) => i % 2 === 0), z = f.filter((_, i) => i % 2); return Math.hypot(x.reduce((t, v) => t + v, 0) / x.length, z.reduce((t, v) => t + v, 0) / z.length) < 150; };
    // the Stary Rynek frontages and the central block: 52-85 % built, 3-4 storeys on the 2026-10-27 snapshot
    const core = stats.filter((_, i) => nearRatusz(GEO.blocks[i][0]));
    assert.ok(core.length >= 8 && core.every(([s, lv]) => s > 0.4 && lv >= 2), 'Old Town blocks densely built');
    // 3.67 km² built of 18.69 km² of block land (20 %): parks, Cytadela and the rail land pull it down
    let built = 0, land = 0;
    GEO.blocks.forEach((b, i) => { const a = blockArea(b[0]); built += a * stats[i][0]; land += a; });
    assert.ok(built / land > 0.12 && built / land < 0.35, `area-weighted built share ${(built / land).toFixed(3)}`);
    assert.ok(stats.reduce((t, s) => t + s[2], 0) > 8000, 'buildings counted in blocks');
    // frame.ll puts the Ratusz (the D1 origin) at the world origin
    const ll = GEO.frame.ll;
    const [lon, lat] = [16.93401, 52.40856];
    assert.ok(Math.abs(ll[0] * lon + ll[1] * lat + ll[2]) < 0.01);
    assert.ok(Math.abs(ll[3] * lon + ll[4] * lat + ll[5]) < 0.01);
    // Tram track closed for rebuilding (railway=disused|razed|construction, still in its route=tram relations) is kept:
    // the Ostrów Tumski line over Most Chrobrego and Most Mieszka I, and Most Teatralny
    const tramPts = GEO.rail.filter((r) => r.kind === 'tram').map((r) => r.pts);
    const tramDist = (x, z) => {
      let best = Infinity;
      for (const p of tramPts) {
        for (let i = 0; i + 3 < p.length; i += 2) {
          const dx = p[i + 2] - p[i], dz = p[i + 3] - p[i + 1];
          const t = Math.max(0, Math.min(1, ((x - p[i]) * dx + (z - p[i + 1]) * dz) / (dx * dx + dz * dz || 1)));
          best = Math.min(best, Math.hypot(p[i] + dx * t - x, p[i + 1] + dz * t - z));
        }
      }
      return best;
    };
    const { nodes, names } = GEO.roadGraph;
    for (const bridge of ['Most Bolesława Chrobrego', 'Most Mieszka I', 'Most Teatralny']) {
      const links = GEO.roadGraph.links.filter((l) => names[l[2]] === bridge);
      assert.ok(links.length > 0 && links.every((l) => l[7] & 2), `${bridge}: every link carries the tram`);
      for (const l of links) {
        const x = (nodes[2 * l[0]] + nodes[2 * l[1]]) / 2, z = (nodes[2 * l[0] + 1] + nodes[2 * l[1] + 1]) / 2;
        assert.ok(tramDist(x, z) < 8, `${bridge}: a tram track on the deck`);
      }
    }
    for (const stop of ['Katedra', 'Rondo Śródka', 'Fredry', 'Most Teatralny', 'Małe Garbary']) {
      const at = GEO.tramStops.filter((s) => s.name === stop);
      assert.ok(at.length > 0 && at.every((s) => tramDist(s.x, s.z) < 1), `${stop}: every stop node lies on a tram track`);
    }
    // Tram line routes: one per direction of the day lines, and every tram chain lists the routes using it
    assert.ok(GEO.tramRoutes.length >= 30 && GEO.tramRoutes.every((r) => /^\d+$/.test(r.ref) && r.to), 'tram routes');
    const tramRail = GEO.rail.filter((r) => r.kind === 'tram');
    assert.ok(tramRail.every((r) => Array.isArray(r.routes) && r.routes.every((i) => i >= 0 && i < GEO.tramRoutes.length)));
    assert.ok(tramRail.filter((r) => r.routes.length).length > 0.9 * tramRail.length, 'most tram track is on a route');
    const over = (x, z) => tramRail.filter((r) => {
      for (let i = 0; i + 3 < r.pts.length; i += 2) {
        const dx = r.pts[i + 2] - r.pts[i], dz = r.pts[i + 3] - r.pts[i + 1];
        const t = Math.max(0, Math.min(1, ((x - r.pts[i]) * dx + (z - r.pts[i + 1]) * dz) / (dx * dx + dz * dz || 1)));
        if (Math.hypot(r.pts[i] + dx * t - x, r.pts[i + 1] + dz * t - z) < 8) return true;
      }
      return false;
    });
    const chrobrego = new Set(over(746, -149).flatMap((r) => r.routes.map((i) => GEO.tramRoutes[i].ref)));
    assert.deepEqual([...chrobrego].sort(), ['17', '7', '8'], 'lines 7, 8 and 17 cross Most Chrobrego');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
