// tools/poz-aeroway.mjs — Ławica aerodrome surfaces for tools/build-poznan.mjs, from tools/data/poz_aeroway.json.
// The aerodrome outline is used by poz-blocks.mjs to cut the airport out of the block raster; the runway, taxiways,
// aprons, terminals and helipads become GEO.aeroway for js/airport.js (docs/observations/detailbox-west-expansion-
// 2026-11-08.md §5). Work happens at import time, like poz-water/poz-extra.
//
// Exports: aeroway [{ kind, ring, line?, h? }]
// - kind: 'runway' | 'taxiway' | 'apron' | 'terminal' | 'helipad'
// - ring: flat [x0, z0, x1, z1, ...], negative winding (the same convention as land, water and blocks); open
//   centrelines are rdp-simplified at 0.5 m, closed outlines keep their corners
// - line: the original centreline of a runway or taxiway mapped as an open way (OSM stores both as lines with a
//   width tag); js/airport.js uses it for curved taxiway centrelines and edge lights
// - h: terminal height in metres (building:levels × 3.4, minimum 8 m); absent on the flat surfaces
import { load, log, toWorld } from './poz-base.mjs';
import { r1, ringArea, rdp, elemRings } from './geo-util.mjs';

const MIN_M2 = 1; // zero-area chains are dropped; every short taxiway stub is kept (83 in the snapshot)
const TERMINAL_LEVEL_HEIGHT = 3.4;
const TERMINAL_MIN_H = 8;
const RUNWAY_WIDTH = 50;
const TAXIWAY_WIDTH = 15;

const osm = load('poz_aeroway.json');
const aeroway = [];
const counts = {};
let dropped = 0;

const openRing = (r) => (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]
  ? r.slice(0, -1) : r);
// Closed rings are rounded without RDP: a closed-ring rdp splits at the farthest vertex and can collapse a long thin
// outline to its end points. The aeroway snapshot is small enough to keep the corners.
const rounded = (ring) => ring.map(([x, z]) => [r1(x), r1(z)]);
const finish = (ring) => {
  if (ring.length < 3 || Math.abs(ringArea(ring)) < MIN_M2) return null;
  if (ringArea(ring) > 0) ring.reverse();
  return ring;
};

// A width-tagged centreline becomes a polygon: offset both sides by half the width, averaging the segment normals at
// each vertex so the ribbon does not kink at a bend.
function ribbon(line, width) {
  const half = width * 0.5;
  const left = [], right = [];
  for (let i = 0; i < line.length; i++) {
    const [x, z] = line[i];
    const [px, pz] = line[Math.max(0, i - 1)];
    const [nx, nz] = line[Math.min(line.length - 1, i + 1)];
    let dx = nx - px, dz = nz - pz;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    left.push([x - dz * half, z + dx * half]);
    right.push([x + dz * half, z - dx * half]);
  }
  return [...left, ...right.reverse()];
}

for (const e of osm.elements) {
  const t = e.tags || {};
  const kind = String(t.aeroway || '').toLowerCase();
  if (!['runway', 'taxiway', 'apron', 'terminal', 'helipad'].includes(kind)) continue;
  const levels = Number.parseFloat(t['building:levels']);
  const taggedWidth = Number.parseFloat(t.width);
  for (const raw of elemRings(e, toWorld)) {
    const closed = raw.length > 2 && raw[0][0] === raw[raw.length - 1][0] && raw[0][1] === raw[raw.length - 1][1];
    if (closed) {
      const ring = finish(rounded(openRing(raw)));
      if (!ring) { dropped++; continue; }
      const item = { kind, ring: ring.flat() };
      if (kind === 'terminal') item.h = Math.max(TERMINAL_MIN_H, (Number.isFinite(levels) ? levels : 0) * TERMINAL_LEVEL_HEIGHT);
      aeroway.push(item);
      counts[kind] = (counts[kind] || 0) + 1;
      continue;
    }
    // Open ways: the runway and every taxiway are centre lines with a width tag (or the default width).
    if (kind !== 'runway' && kind !== 'taxiway') { dropped++; continue; }
    const width = Number.isFinite(taggedWidth) && taggedWidth > 0
      ? taggedWidth : (kind === 'runway' ? RUNWAY_WIDTH : TAXIWAY_WIDTH);
    const line = rounded(rdp(raw, 0.5));
    const ring = finish(rounded(ribbon(line, width)));
    if (!ring) { dropped++; continue; }
    aeroway.push({ kind, ring: ring.flat(), line: line.flat() });
    counts[kind] = (counts[kind] || 0) + 1;
  }
}

const ringOf = (flat) => {
  const pts = [];
  for (let i = 0; i + 1 < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
  return pts;
};
const area = (kind) => aeroway.filter((a) => a.kind === kind)
  .reduce((sum, a) => sum + Math.abs(ringArea(ringOf(a.ring))), 0) / 1e4;
log(`aeroway: ${aeroway.length} surfaces (${Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', ')}${dropped ? `, ${dropped} degenerate` : ''})`);
log(`aeroway: runway ${area('runway').toFixed(1)} ha, taxiway ${area('taxiway').toFixed(1)} ha, apron ${area('apron').toFixed(1)} ha, terminal ${area('terminal').toFixed(1)} ha`);

export { aeroway };
