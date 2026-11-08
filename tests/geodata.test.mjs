import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const EXPECTED_LANDMARKS = [
  'Ratusz', 'Fara', 'Zamek Królewski', 'Wieża Wójtowska', 'Domki Budnicze', 'Katedra', 'Brama Poznania',
  'Zamek Cesarski', 'Bałtyk', 'Okrąglak', 'Collegium Minus', 'Teatr Wielki', 'Pomnik Czerwca 1956',
  'Poznań Główny', 'Stary Dworzec', 'Avenida', 'Stary Browar', 'Iglica', 'Collegium Altum', 'Andersia',
  'Poznań Financial Centre', 'Novotel', 'AND2', 'Nowy Rynek', 'Delta',
  'Biblioteka Raczyńskich', 'Pałac Działyńskich', 'Hotel Bazar', 'Muzeum Narodowe', 'Teatr Polski',
  'Collegium Maius', 'Kościół Bernardynów', 'Kościół Franciszkanów', 'Kościół Najświętszej Marii Panny',
  'Kościół św. Wojciecha', 'Kościół Bożego Ciała'
];
// Built in a temp checkout whose path has spaces and non-ASCII characters, with the default paths (tools/data in,
// js/geodata.js out), offline from the committed snapshots. Reuse that build to detect stale committed output.
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
    assert.ok(fs.readFileSync(path.join(dir, 'js/geodata.js')).equals(fs.readFileSync(path.join(root, 'js/geodata.js'))),
      'fresh build must match committed js/geodata.js byte for byte; rebuild after changing tools or snapshots');
    const { GEO } = await import(pathToFileURL(path.join(dir, 'js/geodata.js')).href);
    assert.equal(GEO.version, 2);
    assert.ok(GEO.land.length >= 3, 'west bank, east bank and Ostrów Tumski');
    assert.ok(GEO.water.some((w) => w.name === 'Warta'));
    assert.ok(GEO.roadGraph.links.some((l) => l[7] & 1), 'a bridge link');
    // flags: bit 0 bridge, 1 tram, 2 roundabout, 3/4 the tram strip right / left of a -> b, beside the carriageway (a
    // divided road's median tracks; 35 right, 475 left on the 2026-10-25 snapshot), only ever on tram links
    const links = GEO.roadGraph.links;
    assert.ok(links.every((l) => (l[7] & ~31) === 0 && (!(l[7] & 24) || ((l[7] & 2) && (l[7] & 24) !== 24))), 'flags');
    assert.ok(links.filter((l) => l[7] & 24).length > 300, 'tram strips beside their carriageways');
    assert.ok(GEO.roadGraph.signals.length > 100);
    // Speed limits (km/h) on every link: the built-up 50 on most, with many 30/20 zones and a few 70 km/h arteries
    const limits = GEO.roadGraph.links.map((l) => l[8]);
    assert.ok(limits.every((v) => [5, 10, 15, 20, 30, 40, 50, 60, 70, 80, 90, 100].includes(v)), 'plausible limits');
    const share = (f) => limits.filter(f).length / limits.length;
    assert.ok(share((v) => v === 50) > 0.3, '50 km/h is the common limit');
    assert.ok(share((v) => v <= 30) > 0.3, 'many 30 and 20 zones');
    assert.ok(limits.includes(70), 'a 70 km/h artery');
    assert.deepEqual(Object.keys(GEO.landmarks).sort(), EXPECTED_LANDMARKS.slice().sort(), 'all 36 landmark sites survive the build');
    const [x0, x1, z0, z1] = GEO.frame.detailBox;
    for (const [name, site] of Object.entries(GEO.landmarks)) {
      assert.ok(['x', 'z', 'w', 'd', 'h', 'area', 'ang'].every((key) => Number.isFinite(site[key])), `${name}: finite placement and dimensions`);
      assert.ok(site.x >= x0 && site.x <= x1 && site.z >= z0 && site.z <= z1, `${name}: inside the detail box`);
      assert.ok(site.w > 0 && site.d > 0 && site.h > 0 && site.area > 0, `${name}: positive dimensions and footprint area`);
      const ring = site.ring;
      assert.ok(Array.isArray(ring) && ring.length >= 6 && ring.length % 2 === 0 && ring.every(Number.isFinite),
        `${name}: finite polygon footprint`);
      let twiceArea = 0;
      for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
        twiceArea += ring[j] * ring[i + 1] - ring[i] * ring[j + 1];
      }
      assert.ok(Math.abs(twiceArea) > 0, `${name}: non-degenerate footprint`);
    }
    assert.ok(GEO.blocks.length > 500);
    // Plac Wolności's beds and fountain are not buildings or holes in its paving.
    const inside = (ring, x, z) => {
      let hit = false;
      for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
        if ((ring[i + 1] > z) !== (ring[j + 1] > z) &&
          x < (ring[j] - ring[i]) * (z - ring[i + 1]) / (ring[j + 1] - ring[i + 1]) + ring[i]) hit = !hit;
      }
      return hit;
    };
    for (const [x, z] of [[-400, 37], [-400, 75], [-395, 58]]) {
      const paved = (p) => inside(p.ring, x, z) && !(p.holes || []).some((h) => inside(h, x, z));
      assert.ok(GEO.plazas.some(paved), 'paved plaza');
      assert.ok(!GEO.blocks.some((b) => inside(b[0], x, z)), `no building block at ${x}, ${z}`);
    }
    const plaza = GEO.plazas.find((p) => p.name === 'Plac Wolności').ring;
    for (const b of GEO.blocks) {
      const xs = b[0].filter((_, i) => i % 2 === 0), zs = b[0].filter((_, i) => i % 2 === 1);
      if (Math.max(...xs) < -620 || Math.min(...xs) > -300 ||
        Math.max(...zs) < -50 || Math.min(...zs) > 150) continue;
      for (const [th, px, pz, rects] of b[5] || [[0, 0, 0, b[1]]]) {
        const cs = Math.cos(th), sn = Math.sin(th);
        for (const [lx, hx, lz, hz] of rects) {
          // Sample each lot at most 1 m apart in its local frame, including its centre.
          const nx = Math.ceil(hx - lx), nz = Math.ceil(hz - lz);
          for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
            const x = lx + (i + 0.5) * (hx - lx) / nx, z = lz + (j + 0.5) * (hz - lz) / nz;
            const wx = px + (x - px) * cs + (z - pz) * sn;
            const wz = pz - (x - px) * sn + (z - pz) * cs;
            assert.ok(!inside(plaza, wx, wz), `building lot inside Plac Wolności at ${wx}, ${wz}`);
          }
        }
      }
    }
    for (const [x, z] of [[-450, -50], [-450, 120]]) {
      const built = (b, i) => inside(b[0], x, z) && GEO.blockStats[i][2] > 0;
      assert.ok(GEO.blocks.some(built), 'square frontage remains built');
    }
    // blockStats: [built share, median levels, buildings, program] per block, from the OSM footprints and the industry
    // snapshot (poz-buildings.mjs); program 0 none, 1 hospital/clinic campus, 2 university campus, 3 retail/mall,
    // 4 industrial, 5 rail/depot, 6 sport/stadium/arena, 7 utility, 8 leisure/water park, 9 office campus. A
    // non-campus programme needs >= 40 % of the block's footprint area.
    const stats = GEO.blockStats;
    assert.equal(stats.length, GEO.blocks.length);
    assert.ok(stats.every(([s, lv, n, p = 0]) => s >= 0 && s <= 1 && lv >= 0 && lv < 60 && Number.isInteger(n) && n >= 0 &&
      Number.isInteger(p) && p >= 0 && p <= 9));
    assert.ok(stats.filter(([, , , p = 0]) => p === 1).length >= 5, 'hospital campuses tagged');
    assert.ok(stats.filter(([, , , p = 0]) => p === 2).length >= 5, 'university campuses tagged');
    const programs = new Map();
    for (const [, , , p] of stats) programs.set(p, (programs.get(p) || 0) + 1);
    for (const p of [3, 4, 5, 6, 7]) assert.ok((programs.get(p) || 0) >= 1, `programme ${p} tagged`);
    // Posnania (953), Castorama (21), ZNTK Robocza (846), Szpital Kliniczny (826) and Szpital Strusia (989); the
    // 2026-11-08 west expansion moved the ids by 2 (21 stays put).
    for (const [id, program] of [[953, 3], [21, 3], [846, 4], [826, 1], [989, 1]]) {
      assert.equal(stats[id][3], program, `block ${id} programme ${program}`);
    }
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
    // blockFootprints: [x0, x1, z0, z1, area] sport/show/public envelopes in park blocks, for parkFreeCells
    const footprints = GEO.blockFootprints;
    assert.ok(footprints && Object.keys(footprints).length >= 20, 'park facility envelopes emitted');
    const holds = (id, area) => (footprints[id] || []).some(([x0, x1, z0, z1, a]) => x1 > x0 && z1 > z0 &&
      a >= area * 0.95 && a <= area * 1.05);
    assert.ok(holds(925, 7843), 'Hala Arena envelope in block 925');
    assert.ok(holds(937, 52909), 'Enea Stadion envelope in block 937');
    assert.ok(Object.values(footprints).every((list) => list.every((f) => f.length === 5 && f.every(Number.isFinite))));
    // blockParkBuildings: ordinary mapped buildings in blocks with > 40 % park land, kept as non-facility lots
    const parkBuildings = GEO.blockParkBuildings;
    assert.ok(parkBuildings && Object.keys(parkBuildings).length >= 50, 'ordinary park building envelopes emitted');
    assert.ok(Object.values(parkBuildings).every((list) => list.every((f) => f.length === 5 && f.every(Number.isFinite))));
    assert.ok((parkBuildings[873] || []).length >= 5, '873 Antoninek keeps its mapped park buildings');
    // industry: industrial structures and power/substation sites from poz_industry.json inside the detail box
    const industry = GEO.industry;
    assert.ok(Array.isArray(industry) && industry.length > 100, 'industry snapshot consumed');
    assert.ok(industry.every((s) => ['cooling', 'chimney', 'silo', 'tank', 'works', 'plant', 'substation'].includes(s.kind) &&
      Number.isFinite(s.x) && Number.isFinite(s.z) && s.w > 0 && s.d > 0 && s.h > 0));
    assert.ok(industry.some((s) => s.kind === 'chimney'), 'mapped chimney kept');
    assert.ok(industry.some((s) => s.kind === 'tank'), 'storage tanks kept');
    assert.ok(stats[846][3] === 4, 'ZNTK block classified industrial');
    assert.ok(stats[266][3] === 7, 'EC Garbary block classified utility');
    // canopies: open building=roof outlines (platforms, tram stops, fuel forecourts) as oriented rectangles with
    // their audited column posts. The clearance is above a train/tram body and a pedestrian, and the columns keep
    // 2.5 m from every track centreline (checked in tests/canopies.test.cjs).
    const canopies = GEO.canopies;
    assert.ok(Array.isArray(canopies) && canopies.length >= 140, `canopies emitted (${canopies?.length})`);
    const canopyKinds = new Set(['platform', 'tram', 'fuel', 'market', 'shelter', 'roof']);
    for (const c of canopies) {
      for (const key of ['x0', 'x1', 'z0', 'z1', 'h', 'clearance', 'cx', 'cz', 'w', 'd', 'ang', 'area']) {
        assert.ok(Number.isFinite(c[key]), `canopy ${key}`);
      }
      assert.ok(c.x0 <= c.cx && c.cx <= c.x1 && c.z0 <= c.cz && c.cz <= c.z1, 'centre in the bounds');
      assert.ok(c.w >= 2 && c.d >= 1 && c.w >= c.d, 'long side first');
      assert.ok(c.area >= 60, `canopy area ${c.area}`);
      assert.ok(c.clearance >= 4.5 && c.clearance < c.h, 'underside above the ground actors');
      assert.ok(c.h >= 4.8 && c.h <= 6.5, `canopy top ${c.h}`);
      assert.ok(canopyKinds.has(c.kind), `canopy kind ${c.kind}`);
      assert.ok(Array.isArray(c.columns) && c.columns.length >= 4 && c.columns.length % 2 === 0, 'columns');
      assert.ok(c.columns.every(Number.isFinite));
      const cx = c.cx, cz = c.cz;
      assert.ok(cx >= x0 && cx <= x1 && cz >= z0 && cz <= z1, 'canopy centre inside the detail box');
    }
    assert.ok(canopies.filter((c) => c.kind === 'platform').length >= 8, 'railway platform canopies');
    assert.ok(canopies.filter((c) => c.kind === 'fuel').length >= 5, 'petrol-station canopies');
    const mainStation = canopies.filter((c) => c.kind === 'platform' &&
      Math.hypot(c.cx + 1580, c.cz - 800) < 300);
    assert.ok(mainStation.length >= 5, 'Poznań Główny platform canopies');
    assert.ok(mainStation.some((c) => c.w > 200), 'the long platform canopy');
    // blockAnchors: the 1-3 largest mapped non-residential footprints of each block, [x0, x1, z0, z1, area, use,
    // levels]; use 1 retail/mall, 2 industrial/warehouse, 3 rail/depot, 4 sport/leisure, 5 utility. buildings.js builds
    // each anchor on its own envelope and keeps the rest of the block as yard/auxiliary.
    const anchors = GEO.blockAnchors;
    assert.ok(anchors && Object.keys(anchors).length >= 30, 'block anchors emitted');
    const anchorHolds = (id, minArea, use) => (anchors[id] || []).some((a) => a[1] > a[0] && a[3] > a[2] &&
      a[4] >= minArea && a[5] === use);
    assert.ok(anchorHolds(953, 70000, 1), 'Posnania mall anchor in block 953');
    assert.ok(anchorHolds(21, 7000, 1), 'Castorama retail anchor in block 21');
    assert.ok(anchorHolds(846, 20000, 2), 'ZNTK industrial anchor in block 846');
    assert.ok(anchorHolds(925, 7000, 4), 'Hala Arena sports anchor in block 925');
    assert.ok(anchorHolds(1248, 6000, 3), 'Głogowska depot anchor in block 1248');
    assert.ok(Object.values(anchors).every((list) => list.every((a) => a.length === 7 && a.every(Number.isFinite) &&
      a[1] > a[0] && a[3] > a[2] && a[4] > 0 && [1, 2, 3, 4, 5].includes(a[5]) && a[6] >= 0 && a[6] < 60)));
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
    // By length: the depot yard at Głogowska is many short chains no route uses (479/642 chains and 95.5% of
    // 127.4 km on a route after the terminal/boundary extensions, measured 2026-10-29).
    const trackLen = (rails) => {
      let sum = 0;
      for (const r of rails) for (let i = 0; i + 3 < r.pts.length; i += 2) sum += Math.hypot(r.pts[i + 2] - r.pts[i], r.pts[i + 3] - r.pts[i + 1]);
      return sum;
    };
    assert.ok(trackLen(tramRail.filter((r) => r.routes.length)) > 0.9 * trackLen(tramRail), 'most tram track is on a route');
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
    for (const [name, x, z, refs] of [
      ['Zawady loop', 1657.1, -539.5, ['5']],
      ['Ogrody loop', -3518.1, -901.8, ['2', '7', '8', '18']],
      ['Starołęka boundary', 658.9, 2855.8, ['7', '12', '13']]
    ]) {
      const assigned = new Set(over(x, z).flatMap((r) => r.routes.map((i) => GEO.tramRoutes[i].ref)));
      for (const ref of refs) assert.ok(assigned.has(ref), `${name}: line ${ref} remains on its route`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
