// tools/merge-extent.mjs — one-off additive merge of a wider OSM snapshot into the committed tools/data snapshots.
// Growing the detail box west would otherwise refresh the whole core: the 2026-11-08 OSM base drops 40 blocks east of
// the old edge and renumbers most block ids (docs/observations/detailbox-west-expansion-2026-11-08.md). This keeps every
// committed element as it is and appends only the new ones from the western sliver, so the core stays frozen.
//
// usage: node tools/merge-extent.mjs <new-data-dir> [out-data-dir]
//   <new-data-dir>  a full fetch of the wider padded box (tools/data/poz_*.json)
//   [out-data-dir]  defaults to tools/data/ (the committed snapshots, updated in place)
//
// The merge is deterministic: the old elements keep their order and new ones are sorted by type and id. Run it once,
// commit the result as input data, and rebuild js/geodata.js from it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = fileURLToPath(new URL('data/', import.meta.url));
const NEW = process.argv[2];
const OUT = process.argv[3] || BASE;
if (!NEW) {
  console.error('usage: node tools/merge-extent.mjs <new-data-dir> [out-data-dir]');
  process.exit(1);
}

// The new padded detail box reaches 16.795 E (Ławica, Etap 2); 16.883 E is the old query edge plus the sliver needed
// to join the core. Only elements that reach the new padded box are added, so a wide fetch of the airport does not
// bloat the data.
const WEST_PAD_LON = 16.795;
const JOIN_LON = 16.883;
const FILES = ['poz_roads', 'poz_signals', 'poz_rail', 'poz_tram_routes', 'poz_parks', 'poz_buildings', 'poz_industry'];

const lonRange = (e) => {
  if (e.type === 'node') return [e.lon, e.lon];
  const g = [];
  for (const p of e.geometry || []) g.push(p.lon);
  if (e.bounds) g.push(e.bounds.minlon, e.bounds.maxlon);
  const m = e.members || [];
  for (const p of m) {
    for (const q of p.geometry || []) g.push(q.lon);
    if (p.lon !== undefined) g.push(p.lon);
  }
  return g.length ? [Math.min(...g), Math.max(...g)] : [-Infinity, -Infinity];
};
const key = (e) => `${e.type}/${e.id}`;

fs.mkdirSync(OUT, { recursive: true });
for (const name of FILES) {
  const base = JSON.parse(fs.readFileSync(path.join(BASE, `${name}.json`), 'utf8'));
  const next = JSON.parse(fs.readFileSync(path.join(NEW, `${name}.json`), 'utf8'));
  const seen = new Set(base.elements.map(key));
  const added = [];
  let fresh = 0;
  for (const e of next.elements) {
    if (seen.has(key(e))) continue;
    fresh++;
    const [, maxLon] = lonRange(e);
    if (maxLon < WEST_PAD_LON || maxLon > JOIN_LON) continue;
    added.push(e);
  }
  added.sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : a.id - b.id));
  base.elements.push(...added);
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(base));
  console.log(`[merge] ${name}: ${fresh} new in source, ${added.length} added, ${base.elements.length} total`);
}
