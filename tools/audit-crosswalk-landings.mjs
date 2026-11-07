// Count the isolated crosswalk landings of the furnished pedestrian network and re-check every fallback connector's
// clearance. An "empty end" is one direction of one crosswalk track with no link out of it; a "track with an empty
// end" is never entered by the full routing. The route factory is shared with the traffic benchmark, source-sliced to
// expose its lazy `links`/`fallbackPaths` (docs/testing.md).
//
//   node tools/audit-crosswalk-landings.mjs [--json out.json] [--list] [--near x,z,r]...
//
// `laneHits` repeats the exact segment-to-segment lane check the connector uses (edge half width + 0.8 m). The audit
// also reports rail and building hits, sibling-line U-turns and the number of fallback connector legs, so a corridor
// widening cannot pass by clipping a lane or a wall.
import { writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildWorld, loadBuildingColliders, loadPedestrianRoutes } from './bench-world.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const config = await import(pathToFileURL(join(ROOT, 'js/city-config.js')).href);
const { getLocationLabel } = config;
const RAIL_KEEP = 2;

const args = process.argv.slice(2);
const option = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
};
const jsonOut = option('--json');
const list = args.includes('--list');
const near = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] !== '--near' || i + 1 >= args.length) continue;
  const [x, z, r = 60] = args[i + 1].split(',').map(Number);
  near.push({ x, z, r });
}

function pointSegmentDistance(px, pz, ax, az, bx, bz) {
  const rx = bx - ax, rz = bz - az, len2 = rx * rx + rz * rz;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * rx + (pz - az) * rz) / len2)) : 0;
  return Math.hypot(px - ax - rx * t, pz - az - rz * t);
}
function segmentDistance(ax, az, bx, bz, cx, cz, dx, dz) {
  const best = Math.min(
    pointSegmentDistance(ax, az, cx, cz, dx, dz),
    pointSegmentDistance(bx, bz, cx, cz, dx, dz),
    pointSegmentDistance(cx, cz, ax, az, bx, bz),
    pointSegmentDistance(dx, dz, ax, az, bx, bz)
  );
  if (best === 0) return 0;
  const o1 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const o2 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
  const o3 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx);
  const o4 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
  return o1 * o2 < 0 && o3 * o4 < 0 ? 0 : best;
}

const { network, railClearance } = buildWorld({ noPeds: true, noTrams: true });
const routes = loadPedestrianRoutes().createPedestrianRoutes(
  network, config.blockAt, railClearance, loadBuildingColliders()
);
const sibling = (a, b) => a !== b && !!a.node && a.node === b.node && a.side === b.side &&
  a.group === b.group && a.line !== b.line;

const tracks = new Set();
for (const crossing of routes.crosswalks) for (const track of crossing.tracks) tracks.add(track);

const empty = [];
let emptyEnds = 0, tracksWithEmpty = 0, siblingLinks = 0, routedEnds = 0;
for (const track of tracks) {
  const ends = [];
  for (const dir of [-1, 1]) {
    routedEnds++;
    const paths = routes.links(track, dir);
    if (!paths.length) {
      emptyEnds++;
      ends.push(dir);
      continue;
    }
    for (const path of paths) if (sibling(track, path[path.length - 1].track)) siblingLinks++;
  }
  if (!ends.length) continue;
  tracksWithEmpty++;
  const p = { x: track.ax + track.ux * track.len * (ends[0] > 0 ? 1 : 0),
    z: track.az + track.uz * track.len * (ends[0] > 0 ? 1 : 0) };
  empty.push({
    x: +p.x.toFixed(1), z: +p.z.toFixed(1), dirs: ends, line: track.line, side: track.side,
    location: getLocationLabel(p.x, p.z), why: ends.map((dir) => routes.diagnoseFallback(track, dir))
  });
}

// Every connector leg the fallback would offer, re-checked independently of the code that built it. `links` calls
// `fallbackPaths` only where the ordinary corner links found nothing, so an end with both is not a fallback route; the
// quotient of the two counts is reported next to the legs.
let fallbackLegs = 0, fallbackEnds = 0, laneHits = 0, railHits = 0, buildingHits = 0;
const laneExamples = [];
const edges = network.edges;
const buildings = loadBuildingColliders();
for (const track of tracks) {
  for (const dir of [-1, 1]) {
    const paths = routes.fallbackPaths(track, dir);
    if (!paths.length || routes.baseLinks(track, dir).length) continue;
    fallbackEnds++;
    for (const path of paths) {
      const leg = path[0].track;
      if (leg.edge || leg.node) continue;
      fallbackLegs++;
      const ax = leg.ax, az = leg.az, bx = leg.ax + leg.ux * leg.len, bz = leg.az + leg.uz * leg.len;
      for (const e of edges) {
        const margin = e.half + 0.8;
        if (Math.min(ax, bx) > Math.max(e.sx, e.sx + e.dx * e.len) + margin ||
            Math.max(ax, bx) < Math.min(e.sx, e.sx + e.dx * e.len) - margin ||
            Math.min(az, bz) > Math.max(e.sz, e.sz + e.dz * e.len) + margin ||
            Math.max(az, bz) < Math.min(e.sz, e.sz + e.dz * e.len) - margin) continue;
        if (segmentDistance(ax, az, bx, bz, e.sx, e.sz, e.sx + e.dx * e.len, e.sz + e.dz * e.len) < margin) {
          laneHits++;
          if (laneExamples.length < 5) laneExamples.push({ x: +ax.toFixed(1), z: +az.toFixed(1),
            toX: +bx.toFixed(1), toZ: +bz.toFixed(1), half: e.half });
          break;
        }
      }
      const steps = Math.max(1, Math.ceil(leg.len / 0.5));
      for (let i = 0; i <= steps; i++) {
        const x = ax + (bx - ax) * i / steps, z = az + (bz - az) * i / steps;
        if (railClearance(x, z, RAIL_KEEP) < RAIL_KEEP) railHits++;
        for (const c of buildings) {
          if ((c.minY ?? 0) >= 1.9) continue;
          if (x < c.minX - 0.4 || x > c.maxX + 0.4 || z < c.minZ - 0.4 || z > c.maxZ + 0.4) continue;
          if (c.obb) {
            const { cx, cz, hx, hz, cs, sn } = c.obb;
            const dx = x - cx, dz = z - cz;
            if (Math.abs(dx * cs - dz * sn) > hx + 0.4 || Math.abs(dx * sn + dz * cs) > hz + 0.4) continue;
          }
          buildingHits++;
          break;
        }
      }
    }
  }
}

const summary = {
  crosswalks: routes.crosswalks.length,
  tracks: tracks.size,
  routedEnds,
  emptyEnds,
  tracksWithEmpty,
  siblingLinks,
  fallbackEnds,
  fallbackLegs,
  laneHits,
  railHits,
  buildingHits,
  laneExamples
};
console.log(JSON.stringify(summary, null, 2));

const inside = (p) => near.some((n) => Math.hypot(p.x - n.x, p.z - n.z) <= n.r);
const shown = empty.filter(inside);
if (list || near.length) {
  const out = near.length ? shown : empty;
  for (const e of out) {
    console.log(`${e.x},${e.z}  ${e.location}  line ${e.line} side ${e.side} dirs ${e.dirs.join('/')}`);
  }
  console.log(`${out.length} empty end${out.length === 1 ? '' : 's'} shown`);
}
if (jsonOut) {
  writeFileSync(isAbsolute(jsonOut) ? jsonOut : join(ROOT, jsonOut), JSON.stringify({ summary, empty }, null, 2));
  console.log(`wrote ${jsonOut}`);
}
