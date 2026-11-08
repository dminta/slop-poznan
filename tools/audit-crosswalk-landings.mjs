// Count the isolated crosswalk landings of the furnished pedestrian network and re-check every connector's clearance.
// An "empty end" is one direction of one crosswalk track with no link out of it; a "track with an empty end" is never
// entered by the full routing. The route factory is shared with the traffic benchmark, source-sliced to expose its
// lazy `links`/`fallbackPaths`/`curbStepPaths` (docs/testing.md). The JSON `empty` list is one record per track and
// carries every empty end in `ends` (a track whose first empty direction flips must not look like a new end in a diff).
//
//   node tools/audit-crosswalk-landings.mjs [--json out.json] [--list] [--near x,z,r]... [--full]
//
// `laneHits` repeats the exact segment-to-segment lane check the connector uses (edge half width + 0.8 m). The audit
// also reports rail and building hits, sibling-line U-turns and the number of fallback connector legs, so a corridor
// widening cannot pass by clipping a lane or a wall. `curbStep*` re-checks the third connector tier (the same-block
// kerb step a landing takes when the corner band and fallback both found nothing) the same way. `spur*` re-checks the
// short kerb tracks generated on tram-cut islands/medians: their whole path keeps 2.22 m from every rail centreline,
// stays out of buildings and on its block.
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
const full = args.includes('--full');
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

// `--full` builds the rendered world's colliders and city-grid curbs (landmarks, bridges and buildings, the same
// street-details network main.js hands to traffic) instead of the benchmark's city blocks. The benchmark stays the
// default so the counts match the recorded 2026-11-07/08 runs; the full pass says how much the omitted curbs and
// landmark/bridge walls move them.
let network, railClearance, buildingColliders, routes;
if (full) {
  const { runAudit } = await import('./audit-tree-clearance.mjs');
  const world = await runAudit({ worldOnly: true });
  network = world.details.roadNetwork;
  railClearance = world.gridModule.railClearance;
  buildingColliders = world.routeColliders;
  const rn = await import(pathToFileURL(join(ROOT, 'js/road-network.js')).href);
  routes = loadPedestrianRoutes(rn).createPedestrianRoutes(
    network, config.blockAt, railClearance, buildingColliders
  );
} else {
  const world = buildWorld({ noPeds: true, noTrams: true });
  network = world.network;
  railClearance = world.railClearance;
  buildingColliders = loadBuildingColliders();
  routes = loadPedestrianRoutes().createPedestrianRoutes(
    network, config.blockAt, railClearance, buildingColliders
  );
}
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
  // One record per track; `ends` keeps both empty ends so a before/after diff cannot mistake a track whose first
  // empty direction flipped for a newly opened or closed end.
  const endsAt = ends.map((dir) => {
    const p = { x: track.ax + track.ux * track.len * (dir > 0 ? 1 : 0),
      z: track.az + track.uz * track.len * (dir > 0 ? 1 : 0) };
    return { x: +p.x.toFixed(1), z: +p.z.toFixed(1), dir };
  });
  empty.push({
    x: endsAt[0].x, z: endsAt[0].z, ends: endsAt, dirs: ends, line: track.line, side: track.side,
    location: getLocationLabel(endsAt[0].x, endsAt[0].z), why: ends.map((dir) => routes.diagnoseFallback(track, dir))
  });
}

// Every connector leg the fallback would offer, re-checked independently of the code that built it. `links` calls
// `fallbackPaths` only where the ordinary corner links found nothing, so an end with both is not a fallback route; the
// quotient of the two counts is reported next to the legs. The third tier, `curbStepPaths`, runs only when both found
// nothing, and its connector legs are re-checked exactly the same way.
let fallbackLegs = 0, fallbackEnds = 0, laneHits = 0, railHits = 0, buildingHits = 0;
let curbStepEnds = 0, curbStepLegs = 0, curbStepLaneHits = 0, curbStepRailHits = 0, curbStepBuildingHits = 0;
let curbStepMaxLen = 0;
const laneExamples = [];
const edges = network.edges;
const buildings = buildingColliders;
const BUILDING_CELL = 32, buildingCells = new Map();
for (const c of buildings) {
  if ((c.minY ?? 0) >= 1.9) continue;
  const reach = c.obb ? 0.4 * Math.SQRT2 : 0.4;
  const ix0 = Math.floor((c.minX - reach) / BUILDING_CELL), ix1 = Math.floor((c.maxX + reach) / BUILDING_CELL);
  const iz0 = Math.floor((c.minZ - reach) / BUILDING_CELL), iz1 = Math.floor((c.maxZ + reach) / BUILDING_CELL);
  for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
    const key = ix * 100000 + iz;
    if (!buildingCells.has(key)) buildingCells.set(key, []);
    buildingCells.get(key).push(c);
  }
}
const hitsBuilding = (x, z) => {
  const list = buildingCells.get(Math.floor(x / BUILDING_CELL) * 100000 + Math.floor(z / BUILDING_CELL));
  if (!list) return false;
  for (const c of list) {
    if (c.obb) {
      const { cx, cz, hx, hz, cs, sn } = c.obb;
      const dx = x - cx, dz = z - cz;
      if (Math.abs(dx * cs - dz * sn) <= hx + 0.4 && Math.abs(dx * sn + dz * cs) <= hz + 0.4) return true;
    } else if (x >= c.minX - 0.4 && x <= c.maxX + 0.4 && z >= c.minZ - 0.4 && z <= c.maxZ + 0.4) {
      return true;
    }
  }
  return false;
};
// One connector leg: the exact segment-to-segment lane check (edge half width + 0.8 m), then 0.5 m samples for the 2 m
// rail keep and the building colliders. Returns the three counts so the caller can attribute them to its tier.
function legHits(leg) {
  const ax = leg.ax, az = leg.az, bx = leg.ax + leg.ux * leg.len, bz = leg.az + leg.uz * leg.len;
  let lane = 0, rail = 0, building = 0;
  for (const e of edges) {
    const margin = e.half + 0.8;
    if (Math.min(ax, bx) > Math.max(e.sx, e.sx + e.dx * e.len) + margin ||
        Math.max(ax, bx) < Math.min(e.sx, e.sx + e.dx * e.len) - margin ||
        Math.min(az, bz) > Math.max(e.sz, e.sz + e.dz * e.len) + margin ||
        Math.max(az, bz) < Math.min(e.sz, e.sz + e.dz * e.len) - margin) continue;
    if (segmentDistance(ax, az, bx, bz, e.sx, e.sz, e.sx + e.dx * e.len, e.sz + e.dz * e.len) < margin) {
      lane = 1;
      if (laneExamples.length < 5) laneExamples.push({ x: +ax.toFixed(1), z: +az.toFixed(1),
        toX: +bx.toFixed(1), toZ: +bz.toFixed(1), half: e.half });
      break;
    }
  }
  const steps = Math.max(1, Math.ceil(leg.len / 0.5));
  for (let i = 0; i <= steps; i++) {
    const x = ax + (bx - ax) * i / steps, z = az + (bz - az) * i / steps;
    if (railClearance(x, z, RAIL_KEEP) < RAIL_KEEP) rail++;
    if (hitsBuilding(x, z)) building++;
  }
  return { lane, rail, building };
}
for (const track of tracks) {
  for (const dir of [-1, 1]) {
    if (routes.baseLinks(track, dir).length) continue;
    const paths = routes.fallbackPaths(track, dir);
    if (!paths.length) {
      // A same-block kerb step the 4 m corner band and the fallback both rejected.
      const steps = routes.curbStepPaths(track, dir);
      if (!steps.length) continue;
      curbStepEnds++;
      for (const path of steps) {
        const leg = path[0].track;
        curbStepLegs++;
        curbStepMaxLen = Math.max(curbStepMaxLen, leg.len);
        const hits = legHits(leg);
        curbStepLaneHits += hits.lane;
        curbStepRailHits += hits.rail;
        curbStepBuildingHits += hits.building;
      }
      continue;
    }
    fallbackEnds++;
    for (const path of paths) {
      const leg = path[0].track;
      if (leg.edge || leg.node) continue;
      fallbackLegs++;
      const hits = legHits(leg);
      laneHits += hits.lane;
      railHits += hits.rail;
      buildingHits += hits.building;
    }
  }
}

// Spur links: the short kerb tracks generated on tram-cut islands and medians (the Miła landing and its kin) are
// re-checked independently. Split road-edge runs are ordinary sidewalk lines, some of which legitimately pass under a
// railway viaduct where the 2D rail distance is small; the named key nodes are pinned at 2.22 m by
// tests/pedestrian-route-sinks.test.cjs. Rail, building and block membership apply to the whole spur path.
const CURB_RAIL_KEEP = 2.22;
let spurLinks = 0, spurRailHits = 0, spurBuildingHits = 0, spurBlockHits = 0, spurMinRail = Infinity;
const spurTracks = new Set(), spurEnds = new Set();
for (const track of tracks) {
  for (const dir of [-1, 1]) {
    const paths = routes.links(track, dir);
    for (const path of paths) {
      const last = path[path.length - 1].track;
      if (last.node || !last.landing) continue;
      spurLinks++;
      spurEnds.add(track);
      spurTracks.add(last);
      for (const { track: leg } of path) {
        const ax = leg.ax, az = leg.az, bx = leg.ax + leg.ux * leg.len, bz = leg.az + leg.uz * leg.len;
        const steps = Math.max(1, Math.ceil(leg.len / 0.5));
        for (let i = 0; i <= steps; i++) {
          const x = ax + (bx - ax) * i / steps, z = az + (bz - az) * i / steps;
          const rail = railClearance(x, z, CURB_RAIL_KEEP + 1);
          spurMinRail = Math.min(spurMinRail, rail);
          if (rail < CURB_RAIL_KEEP) spurRailHits++;
          if (hitsBuilding(x, z)) spurBuildingHits++;
          if (leg.block && !leg.node && !leg.underpass && config.blockAt(x, z) !== leg.block) spurBlockHits++;
        }
      }
    }
  }
}

// Split runs (`split: true`) are the new road-edge fragments. A lane check by projection: the old fallback test's
// segment distance is conservative at a lane end, while the signed lateral distance inside the lane segment is the
// number the review measured (Św. Marcin, -3.92 m against half 9.75). Every sample must keep half + 0.8 m.
const STREET_CELL = 64, streetCells = new Map();
for (const e of edges) {
  const x1 = e.sx, z1 = e.sz, x2 = x1 + e.dx * e.len, z2 = z1 + e.dz * e.len;
  const pad = e.half + 1;
  const ix0 = Math.floor((Math.min(x1, x2) - pad) / STREET_CELL);
  const ix1 = Math.floor((Math.max(x1, x2) + pad) / STREET_CELL);
  const iz0 = Math.floor((Math.min(z1, z2) - pad) / STREET_CELL);
  const iz1 = Math.floor((Math.max(z1, z2) + pad) / STREET_CELL);
  for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
    const key = ix * 100000 + iz;
    if (!streetCells.has(key)) streetCells.set(key, []);
    streetCells.get(key).push(e);
  }
}
let splitTracks = 0, splitLaneHits = 0, splitMinLane = Infinity;
const splitSeen = new Set();
for (const edge of edges) {
  for (const track of routes.along(edge)) {
    if (!track.split || splitSeen.has(track)) continue;
    splitSeen.add(track);
    splitTracks++;
    const steps = Math.max(1, Math.ceil(track.len / 0.5));
    for (let i = 0; i <= steps; i++) {
      const x = track.ax + track.ux * track.len * i / steps, z = track.az + track.uz * track.len * i / steps;
      for (const e of streetCells.get(Math.floor(x / STREET_CELL) * 100000 + Math.floor(z / STREET_CELL)) || []) {
        const s = (x - e.sx) * e.dx + (z - e.sz) * e.dz;
        if (s < 0 || s > e.len) continue;
        const lateral = Math.abs((x - e.sx) * e.rx + (z - e.sz) * e.rz);
        splitMinLane = Math.min(splitMinLane, lateral - e.half);
        if (lateral < e.half + 0.8) { splitLaneHits++; break; }
      }
    }
  }
}

// One count per empty end: every non-base reason any candidate or nearby track offers. `none` marks an end with no
// candidate at all beyond its own/sibling lines. The categories overlap, so the counts sum above `emptyEnds`.
const reasonCounts = {};
for (const e of empty) {
  for (const w of e.why) {
    const reasons = new Set();
    for (const c of w.candidates) if (!['self', 'sibling', 'zero'].includes(c.why)) reasons.add(c.why);
    for (const c of w.near) reasons.add(c.why);
    if (!reasons.size) reasons.add('none');
    for (const reason of reasons) reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
  }
}
const summary = {
  full,
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
  laneExamples,
  curbStepEnds,
  curbStepLegs,
  curbStepLaneHits,
  curbStepRailHits,
  curbStepBuildingHits,
  curbStepMaxLen: +curbStepMaxLen.toFixed(1),
  spurLinks,
  spurEnds: spurEnds.size,
  spurTracks: spurTracks.size,
  spurRailHits,
  spurBuildingHits,
  spurBlockHits,
  spurMinRail: Number.isFinite(spurMinRail) ? +spurMinRail.toFixed(2) : null,
  splitTracks,
  splitLaneHits,
  splitMinLane: Number.isFinite(splitMinLane) ? +splitMinLane.toFixed(2) : null,
  reasonCounts
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
