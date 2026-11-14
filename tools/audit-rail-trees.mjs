// Headless mainline railway tree-footprint audit. No browser or rendering is used.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runAudit } from './audit-tree-clearance.mjs';

// Explicit neighbourhood enclosing both reported Niska runs, with 50 m around their bounding box.
const NISKA = { minX: -1451, maxX: -1191, minZ: -963, maxZ: -573 };
const nearNiska = (t) => t.x >= NISKA.minX && t.x <= NISKA.maxX && t.z >= NISKA.minZ && t.z <= NISKA.maxZ;

async function runRailTreeAudit({ before = false } = {}) {
  const oldSource = (name) => execFileSync('git', ['show', `eed1a16:js/${name}.js`], { encoding: 'utf8' });
  const world = await runAudit({ worldOnly: true, ...(before ? {
    gridSource: oldSource('city-grid'), streetSource: oldSource('street-details'), buildingSource: oldSource('buildings')
  } : {}) });
  const { sites, GEO, config, treesMod } = world;
  const cellSize = 32;
  const layout = world.tramMod.layoutRailInfrastructure(world.details.roadNetwork);
  const index = (segments) => {
    const cells = new Map();
    for (const s of segments) {
      for (let ix = Math.floor(Math.min(s.ax, s.bx) / cellSize); ix <= Math.floor(Math.max(s.ax, s.bx) / cellSize); ix++) {
        for (let iz = Math.floor(Math.min(s.az, s.bz) / cellSize); iz <= Math.floor(Math.max(s.az, s.bz) / cellSize); iz++) {
          const key = `${ix},${iz}`;
          if (!cells.has(key)) cells.set(key, []);
          cells.get(key).push(s);
        }
      }
    }
    return cells;
  };
  const tracks = [];
  for (const [railIndex, r] of GEO.rail.entries()) {
    if (r.kind === 'tram') continue;
    for (let i = 0; i + 3 < r.pts.length; i += 2) {
      const [ax, az, bx, bz] = r.pts.slice(i, i + 4);
      tracks.push({ ax, az, bx, bz, railIndex });
    }
  }
  const renderedSegments = layout.pieces.map((p) => {
    const len = Math.hypot(p.bx - p.ax, p.bz - p.az);
    const pitch = Math.atan2(p.yB - p.yA, len);
    const bedHeight = p.yMid + 0.3 + (p.railIndex % 5) * 0.004 - p.ground + 0.06;
    return { ...p, halfWidth: config.RAIL_BED_W / 2,
      endPad: 0.01 * Math.cos(pitch) + bedHeight / 2 * Math.abs(Math.sin(pitch)) };
  });
  for (const v of layout.viaducts) {
    for (const p of v.pieces) renderedSegments.push({ ...p, halfWidth: 2, endPad: 0.025 });
  }
  // Flush crossings have rail heads, with no ballast; retain their visible rail envelope too.
  for (const p of layout.level) renderedSegments.push({ ...p, halfWidth: 1.435 / 2 + 0.07, endPad: 0.015 });
  const cells = index(tracks), beds = index(renderedSegments);
  const hash = (x, y, z) => {
    const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
    return h - Math.floor(h);
  };
  const halfBed = config.RAIL_BED_W / 2;
  const bySource = {};
  const overlaps = [];
  const renderedOverlaps = [];
  let niskaTrees = 0;
  for (const t of sites) {
    const source = t.source || 'unlabelled';
    const counts = bySource[source] ||= { trees: 0, trunk: 0, canopy: 0, renderedTrunk: 0, niska: 0 };
    counts.trees++;
    if (nearNiska(t)) niskaTrees++;
    // Conservative circular envelope: squeezing one crown axis never shortens the other axis.
    const r1 = hash(t.x, 1.3, t.z), r2 = hash(t.z, 7.1, t.x), r3 = hash(t.x + t.z, 3.3, 0.7);
    const radius = config.SPECIES_CROWN_R[treesMod.treeSpecies(t)] * t.scale * (0.9 + r1 * 0.2) *
      Math.max((0.9 + r3 * 0.2) * (t.sx || 1), (0.9 + r2 * 0.2) * (t.sz || 1));
    const reach = halfBed + Math.max(radius, Math.SQRT2 * 0.28 * t.scale);
    let distance = reach, railIndex = null;
    const seen = new Set();
    for (let ix = Math.floor((t.x - reach) / cellSize); ix <= Math.floor((t.x + reach) / cellSize); ix++) {
      for (let iz = Math.floor((t.z - reach) / cellSize); iz <= Math.floor((t.z + reach) / cellSize); iz++) {
        for (const s of cells.get(`${ix},${iz}`) || []) {
          if (seen.has(s)) continue;
          seen.add(s);
          const dx = s.bx - s.ax, dz = s.bz - s.az;
          const u = Math.max(0, Math.min(1, ((t.x - s.ax) * dx + (t.z - s.az) * dz) / (dx * dx + dz * dz || 1)));
          const d = Math.hypot(t.x - s.ax - u * dx, t.z - s.az - u * dz);
          if (d < distance) { distance = d; railIndex = s.railIndex; }
        }
      }
    }
    // Query emitted beds/rails independently, including end extensions and pitched-bed thickness projection.
    let rendered = false, renderedTrunk = false;
    for (let ix = Math.floor((t.x - reach - 0.5) / cellSize); ix <= Math.floor((t.x + reach + 0.5) / cellSize); ix++) {
      for (let iz = Math.floor((t.z - reach - 0.5) / cellSize); iz <= Math.floor((t.z + reach + 0.5) / cellSize); iz++) {
        for (const p of beds.get(`${ix},${iz}`) || []) {
          const dx = p.bx - p.ax, dz = p.bz - p.az, len = Math.hypot(dx, dz);
          const ux = dx / len, uz = dz / len;
          const along = (t.x - p.ax) * ux + (t.z - p.az) * uz;
          const across = Math.abs((t.x - p.ax) * uz - (t.z - p.az) * ux);
          const q = 0.28 * t.scale, hx = len / 2 + p.endPad;
          const mx = (p.ax + p.bx) / 2, mz = (p.az + p.bz) / 2;
          const support = q * (Math.abs(ux) + Math.abs(uz));
          if (Math.abs(t.x - mx) < hx * Math.abs(ux) + p.halfWidth * Math.abs(uz) + q &&
              Math.abs(t.z - mz) < hx * Math.abs(uz) + p.halfWidth * Math.abs(ux) + q &&
              Math.abs(along - len / 2) < hx + support && across < p.halfWidth + support) renderedTrunk = true;
          if (Math.hypot(Math.max(0, -p.endPad - along, along - len - p.endPad),
            Math.max(0, across - p.halfWidth)) < Math.max(radius, Math.SQRT2 * 0.28 * t.scale)) rendered = true;
        }
      }
    }
    if (renderedTrunk) counts.renderedTrunk++;
    if (rendered) renderedOverlaps.push({ x: t.x, z: t.z, source, renderedTrunk, niska: nearNiska(t) });
    if (distance >= reach - 1e-9) continue;
    const trunk = distance < halfBed + Math.SQRT2 * 0.28 * t.scale;
    const canopy = distance < halfBed + radius;
    if (trunk) counts.trunk++;
    if (canopy) counts.canopy++;
    if (nearNiska(t)) counts.niska++;
    overlaps.push({ x: t.x, z: t.z, source, distance, radius, penetration: reach - distance,
      trunk, canopy, rendered, niska: nearNiska(t), railIndex });
  }
  overlaps.sort((a, b) => b.penetration - a.penetration);
  return { trees: sites.length, niskaTrees, segments: tracks.length, renderedPieces: layout.pieces.length, viaductPieces: layout.viaducts.reduce((n, v) => n + v.pieces.length, 0),
    levelPieces: layout.level.length,
    halfBed, niskaBounds: NISKA, bySource,
    count: overlaps.length, renderedCount: renderedOverlaps.length,
    renderedTrunkCount: renderedOverlaps.filter((t) => t.renderedTrunk).length,
    renderedNiskaCount: renderedOverlaps.filter((t) => t.niska).length,
    niskaCount: overlaps.filter((t) => t.niska).length, overlaps, renderedOverlaps, sites };
}

export { runRailTreeAudit };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runRailTreeAudit({ before: process.argv.includes('--before') });
  const { sites, ...report } = result;
  const output = process.argv.indexOf('--sites');
  if (output !== -1) writeFileSync(process.argv[output + 1], JSON.stringify(sites.map(({ collider, ...t }) => t)));
  console.log(JSON.stringify(report, null, 2));
  if (result.count || result.renderedCount) process.exitCode = 1;
}
