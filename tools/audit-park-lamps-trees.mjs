// tools/audit-park-lamps-trees.mjs
// Headless audit of park lamps (walk/edge/lawn, props, trees, buildings, water, roads, rails)
// and trees in park blocks with buildings (trunks/crowns vs building footprints & landmark colliders,
// and trees standing on walks/paths).
// Usage: node tools/audit-park-lamps-trees.mjs [--json] [--top N]

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAudit as buildFullWorld } from './audit-tree-clearance.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = (name) => readFileSync(join(root, 'js', name + '.js'), 'utf8');

function pointInPoly(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, zi = poly[i].z;
    const xj = poly[j].x, zj = poly[j].z;
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function distToRingEdge(ring, x, z) {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = ring[j].x, az = ring[j].z;
    const bx = ring[i].x, bz = ring[i].z;
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2)) : 0;
    const d = Math.hypot(x - (ax + t * dx), z - (az + t * dz));
    if (d < best) best = d;
  }
  return best;
}

function distToColliderXZ(x, z, c, yMin = -Infinity, yMax = Infinity) {
  if ((c.maxY !== undefined && c.maxY < yMin) || (c.minY !== undefined && c.minY > yMax)) {
    return Infinity;
  }
  const o = c.obb;
  const cs = o ? o.cs : 1, sn = o ? o.sn : 0;
  const hx = o ? o.hx : (c.maxX - c.minX) * 0.5;
  const hz = o ? o.hz : (c.maxZ - c.minZ) * 0.5;
  const dx = x - (o ? o.cx : (c.minX + c.maxX) * 0.5);
  const dz = z - (o ? o.cz : (c.minZ + c.maxZ) * 0.5);
  const lx = dx * cs - dz * sn;
  const lz = dx * sn + dz * cs;
  const ax = Math.abs(lx);
  const az = Math.abs(lz);
  if (ax <= hx && az <= hz) return -Math.min(hx - ax, hz - az);
  return Math.hypot(Math.max(0, ax - hx), Math.max(0, az - hz));
}

function distToFootprintPoly(poly, x, z) {
  const inside = pointInPoly(poly, x, z);
  const d = distToRingEdge(poly, x, z);
  return inside ? -d : d;
}

function buildSpatialGrid(items, getBounds, cellSize = 32) {
  const cells = new Map();
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const b = getBounds(item);
    const ix0 = Math.floor(b.minX / cellSize);
    const ix1 = Math.floor(b.maxX / cellSize);
    const iz0 = Math.floor(b.minZ / cellSize);
    const iz1 = Math.floor(b.maxZ / cellSize);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const k = `${ix},${iz}`;
        let list = cells.get(k);
        if (!list) { list = []; cells.set(k, list); }
        list.push(item);
      }
    }
  }
  return { cells, cellSize };
}

function querySpatialGrid(grid, x, z, radius) {
  const cs = grid.cellSize;
  const ix0 = Math.floor((x - radius) / cs);
  const ix1 = Math.floor((x + radius) / cs);
  const iz0 = Math.floor((z - radius) / cs);
  const iz1 = Math.floor((z + radius) / cs);
  const seen = new Set();
  const out = [];
  for (let ix = ix0; ix <= ix1; ix++) {
    for (let iz = iz0; iz <= iz1; iz++) {
      const list = grid.cells.get(`${ix},${iz}`);
      if (!list) continue;
      for (const item of list) {
        if (!seen.has(item)) {
          seen.add(item);
          out.push(item);
        }
      }
    }
  }
  return out;
}

export async function runParkAudit() {
  const parkBlocksData = new Map(); // blockId -> { b, slabPieces, beds, lawns, ponds, bedHoles, roadCuts }
  const partParkLawns = new Map(); // blockId -> [ring, ...]
  const capturedParkLamps = []; // { blockId, x, y, z }
  const capturedAllLamps = []; // { kind, x, y, z }

  let gridSrc = source('city-grid');
  // Capture park block geometry (even if bed is null, capture slabPieces/ponds)
  gridSrc = gridSrc.replace(
    '    const bed = offsetPolygonInward(parkBedOutline(b), parkBedInset(b, roadCuts));',
    '    const bed = offsetPolygonInward(parkBedOutline(b), parkBedInset(b, roadCuts));\n' +
    '    capture({ type: "parkBlockBase", blockId: b.id, parkName: b.parkName, minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ, poly: b.poly, slabPieces, ponds, roadCuts, unionHoles });'
  );
  gridSrc = gridSrc.replace(
    '    const lampsStart = lampMatrices.length;',
    '    const lampsStart = lampMatrices.length;'
  );
  // Capture beds, lawns, bedHoles right before lamp placement
  gridSrc = gridSrc.replace(
    '    const lampLine = offsetPolygonInward(b.poly, 1.05);',
    '    capture({ type: "parkBlockBeds", blockId: b.id, beds, lawns, bedHoles });\n' +
    '    const lampLine = offsetPolygonInward(b.poly, 1.05);'
  );
  // Capture all lamps added via addLamp
  gridSrc = gridSrc.replace(
    '    lampMatrices.push(new THREE.Matrix4().makeTranslation(x, y, z));',
    '    lampMatrices.push(new THREE.Matrix4().makeTranslation(x, y, z)); capture({ type: "anyLamp", x, y, z });'
  );
  // Capture park lamps added in Section 6
  gridSrc = gridSrc.replace(
    '          addLamp(px, y, pz);',
    '          if (addLamp(px, y, pz)) capture({ type: "parkLamp", blockId: b.id, x: px, y, z: pz });'
  );
  // Capture partial-park lawns in Section 6B
  gridSrc = gridSrc.replace(
    '          for (const piece of pieces) parkLawnGeos.push(createExtrudedPolygonMesh(piece, SW_TOP - 0.02, 0.06, lawnMat).geometry);',
    '          for (const piece of pieces) { capture({ type: "partParkLawn", blockId: b.id, piece }); parkLawnGeos.push(createExtrudedPolygonMesh(piece, SW_TOP - 0.02, 0.06, lawnMat).geometry); }'
  );

  const capture = (ev) => {
    if (!ev || typeof ev !== 'object') return;
    if (ev.type === 'parkBlockBase') {
      parkBlocksData.set(ev.blockId, {
        blockId: ev.blockId,
        parkName: ev.parkName,
        minX: ev.minX, maxX: ev.maxX, minZ: ev.minZ, maxZ: ev.maxZ,
        poly: ev.poly,
        slabPieces: ev.slabPieces,
        ponds: ev.ponds,
        roadCuts: ev.roadCuts,
        unionHoles: ev.unionHoles,
        beds: [], lawns: [], bedHoles: []
      });
    } else if (ev.type === 'parkBlockBeds') {
      const rec = parkBlocksData.get(ev.blockId);
      if (rec) {
        rec.beds = ev.beds;
        rec.lawns = ev.lawns;
        rec.bedHoles = ev.bedHoles;
      }
    } else if (ev.type === 'parkLamp') {
      capturedParkLamps.push({ blockId: ev.blockId, x: ev.x, y: ev.y, z: ev.z });
    } else if (ev.type === 'anyLamp') {
      capturedAllLamps.push({ x: ev.x, y: ev.y, z: ev.z });
    } else if (ev.type === 'partParkLawn') {
      let arr = partParkLawns.get(ev.blockId);
      if (!arr) { arr = []; partParkLawns.set(ev.blockId, arr); }
      arr.push(ev.piece);
    }
  };

  const world = await buildFullWorld({ worldOnly: true, gridSource: gridSrc, capture });
  const { sites, details, grid, gridModule, liveGrid, buildingColliders, footprintsByBlock, treesMod, config, GEO } = world;
  const { treeSpecies } = treesMod;
  const { SPECIES_CROWN_R, BLOCKS, LANDMARK_SITES, isWater, distToWater, blockAt } = config;

  // Build spatial indexes for fast queries
  const bldGrid = buildSpatialGrid(buildingColliders, (c) => c, 32);
  const treeGrid = buildSpatialGrid(sites, (t) => ({ minX: t.x - 1, maxX: t.x + 1, minZ: t.z - 1, maxZ: t.z + 1 }), 24);
  const allProps = [...grid.propColliders, ...(details.colliders || [])];
  const propGrid = buildSpatialGrid(allProps, (c) => c, 24);

  // Road carriageway index from details.roadNetwork
  const roadNet = details.roadNetwork;
  const roadSegs = [];
  for (const e of roadNet.edges) {
    if (e.isSidewalk || e.isCrosswalk || e.isPath) continue;
    const hw = (e.roadWidth || (e.lanes ? e.lanes.length * 3.2 : 6)) * 0.5;
    roadSegs.push({
      ax: e.x0, az: e.z0,
      bx: e.x0 + e.dx * e.span, bz: e.z0 + e.dz * e.span,
      hw,
      minX: Math.min(e.x0, e.x0 + e.dx * e.span) - hw,
      maxX: Math.max(e.x0, e.x0 + e.dx * e.span) + hw,
      minZ: Math.min(e.z0, e.z0 + e.dz * e.span) - hw,
      maxZ: Math.max(e.z0, e.z0 + e.dz * e.span) + hw
    });
  }
  const roadGrid = buildSpatialGrid(roadSegs, (s) => s, 32);

  function distToRoad(x, z) {
    const near = querySpatialGrid(roadGrid, x, z, 20);
    let best = Infinity;
    for (const s of near) {
      const dx = s.bx - s.ax, dz = s.bz - s.az;
      const l2 = dx * dx + dz * dz;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / l2)) : 0;
      const d = Math.hypot(x - (s.ax + t * dx), z - (s.az + t * dz)) - s.hw;
      if (d < best) best = d;
    }
    return best;
  }

  // =========================================================================
  // PART 1: PARK LAMPS AUDIT
  // =========================================================================
  const lampResults = [];
  const lampCounts = {
    totalParkLampSites: liveGrid.parkLampSites.length,
    parkBlockLamps: capturedParkLamps.length,
    onWalk: 0,
    onWalkEdge: 0,
    onLawn: 0,
    treeTrunkOverlap: 0,
    treeCrownOverlap: 0,
    propOverlap: 0,
    buildingOverlap: 0,
    waterOverlap: 0,
    roadOverlap: 0,
    railOverlap: 0
  };

  for (const lamp of capturedParkLamps) {
    const pb = parkBlocksData.get(lamp.blockId);
    const { x, y, z } = lamp;

    // Classify walk / walk edge (<= 0.6 m outside) / lawn (> 0.6 m outside)
    // A point is in a bed if it's inside pb.beds and NOT inside pb.bedHoles (the 2 m pond path).
    const inBed = pb.beds.some((bed) => pointInPoly(bed, x, z)) &&
      !pb.bedHoles.some((h) => pointInPoly(h, x, z));
    const inSlab = pb.slabPieces.some((s) => pointInPoly(s, x, z)) || pointInPoly(pb.poly, x, z);

    let cls = 'onWalk';
    let distOutsideWalk = 0;

    if (inBed) {
      // Nearest walk edge is the nearest edge of any bed polygon (or bedHole polygon)
      let best = Infinity;
      for (const bed of pb.beds) {
        const d = distToRingEdge(bed, x, z);
        if (d < best) best = d;
      }
      for (const h of pb.bedHoles) {
        const d = distToRingEdge(h, x, z);
        if (d < best) best = d;
      }
      distOutsideWalk = best;
      if (distOutsideWalk <= 0.6) {
        cls = 'onWalkEdge';
        lampCounts.onWalkEdge++;
      } else {
        cls = 'onLawn';
        lampCounts.onLawn++;
      }
    } else if (inSlab) {
      cls = 'onWalk';
      distOutsideWalk = 0;
      lampCounts.onWalk++;
    } else {
      // Outside slab/poly (shouldn't happen)
      distOutsideWalk = distToRingEdge(pb.poly, x, z);
      cls = distOutsideWalk <= 0.6 ? 'onWalkEdge' : 'onLawn';
      if (cls === 'onWalkEdge') lampCounts.onWalkEdge++;
      else lampCounts.onLawn++;
    }

    // Check trees
    let minTrunkClear = Infinity;
    let minCrownClear = Infinity;
    let nearestTree = null;
    for (const t of querySpatialGrid(treeGrid, x, z, 12)) {
      const d = Math.hypot(x - t.x, z - t.z);
      const trunkR = 0.28 * (t.scale || 1);
      const trunkClear = d - (0.2 + trunkR);
      if (trunkClear < minTrunkClear) {
        minTrunkClear = trunkClear;
        nearestTree = { x: t.x, z: t.z, scale: t.scale, source: t.source || 'unknown', d };
      }
      const sp = treeSpecies(t);
      const crownR = SPECIES_CROWN_R[sp] * (t.scale || 1);
      const crownClear = d - crownR;
      if (crownClear < minCrownClear) minCrownClear = crownClear;
    }
    if (minTrunkClear < 0) lampCounts.treeTrunkOverlap++;
    if (minCrownClear < 0) lampCounts.treeCrownOverlap++;

    // Check props (benches, planters, other lamps, street furniture; skip own 0.4x0.4 collider and tree trunks)
    let minPropClear = Infinity;
    for (const p of querySpatialGrid(propGrid, x, z, 5)) {
      if (p.isTrunk) continue;
      // Skip own lamp collider
      if (!p.obb && Math.abs((p.minX + p.maxX) * 0.5 - x) < 0.01 && Math.abs((p.minZ + p.maxZ) * 0.5 - z) < 0.01 &&
          Math.abs(p.maxX - p.minX - 0.4) < 0.05) continue;
      const d = distToColliderXZ(x, z, p, y, y + 4.45) - 0.2;
      if (d < minPropClear) minPropClear = d;
    }
    if (minPropClear < 0) lampCounts.propOverlap++;

    // Check buildings
    let minBldClear = Infinity;
    for (const c of querySpatialGrid(bldGrid, x, z, 5)) {
      const d = distToColliderXZ(x, z, c, y, y + 4.45) - 0.2;
      if (d < minBldClear) minBldClear = d;
    }
    const bFps = footprintsByBlock.get(lamp.blockId) || [];
    for (const fp of bFps) {
      const d = distToFootprintPoly(fp, x, z) - 0.2;
      if (d < minBldClear) minBldClear = d;
    }
    if (minBldClear < 0) lampCounts.buildingOverlap++;

    // Check water
    const waterD = isWater(x, z) ? -1 : distToWater(x, z);
    const inPond = pb.ponds.some((p) => pointInPoly(p, x, z));
    if (waterD < 0.2 || inPond) lampCounts.waterOverlap++;

    // Check roads
    const roadD = distToRoad(x, z);
    if (roadD < 0.2) lampCounts.roadOverlap++;

    // Check rails
    const railD = gridModule.railClearance(x, z, 5);
    if (railD < 2.0) lampCounts.railOverlap++;

    lampResults.push({
      blockId: lamp.blockId,
      parkName: pb.parkName || '(unnamed)',
      x, y, z,
      cls,
      distOutsideWalk,
      minTrunkClear,
      nearestTree,
      minCrownClear,
      minPropClear,
      minBldClear,
      waterD,
      roadD,
      railD
    });
  }

  // =========================================================================
  // PART 2: TREES IN PARK BLOCKS WITH BUILDINGS + AVENIDA
  // =========================================================================
  const isParkBlock = (b) => b.park > 0.6 && !b.median && b.area > 250;
  const parkBlocksWithBld = BLOCKS.filter((b) => b.park > 0 && !b.median && b.buildings > 0);
  const fullParkBldCount = parkBlocksWithBld.filter(isParkBlock).length;
  const parkBldIds = new Set(parkBlocksWithBld.map((b) => b.id));

  // Tag each tree in `sites` with its block
  const makeBucket = () => ({ trees: 0, procTrees: 0, osmTrees: 0, trunkInside: 0, crownInWall: 0, procCrownInWall: 0, osmCrownInWall: 0, onWalk: 0, procOnWalk: 0, osmOnWalk: 0, worst: [] });
  const treeParkAudit = {
    avenida: { totalNear: 0, trunkInside: 0, crownInWall: 0, worst: [] },
    parkNadWarta: { blocks: [], ...makeBucket() },
    antoninek876: { blockInfo: BLOCKS[876] ? { id: 876, park: BLOCKS[876].park, area: BLOCKS[876].area, buildings: BLOCKS[876].buildings, isPark: isParkBlock(BLOCKS[876]) } : null, ...makeBucket() },
    fullParkBldBlocks: { blockCount: fullParkBldCount, ...makeBucket() },
    allParkBldBlocks: { blockCount: parkBlocksWithBld.length, ...makeBucket() }
  };

  const avenidaSite = LANDMARK_SITES.Avenida;
  const avenidaColliders = buildingColliders.filter((c) => c.kind === 'Avenida');

  for (const t of sites) {
    const sp = treeSpecies(t);
    const crownR = SPECIES_CROWN_R[sp] * (t.scale || 1);
    const treeY = t.y ?? 0.22;
    const topY = treeY + 14.0 * (t.scale || 1);

    // 1. Avenida check (trees within 120 m of Avenida landmark site)
    if (avenidaSite && Math.hypot(t.x - avenidaSite.x, t.z - avenidaSite.z) < 250) {
      let minAv = Infinity;
      for (const c of avenidaColliders) {
        const d = distToColliderXZ(t.x, t.z, c, treeY, topY);
        if (d < minAv) minAv = d;
      }
      if (minAv < 30) {
        treeParkAudit.avenida.totalNear++;
        if (minAv <= 0) treeParkAudit.avenida.trunkInside++;
        if (minAv < crownR) treeParkAudit.avenida.crownInWall++;
        if (minAv < crownR) {
          treeParkAudit.avenida.worst.push({ x: t.x, z: t.z, scale: t.scale, sp, crownR, dist: minAv, source: t.source || (t.pitRot !== undefined ? 'street' : 'park') });
        }
      }
    }

    // 2. Park blocks with buildings
    const b = blockAt(t.x, t.z);
    if (!b || !parkBldIds.has(b.id)) continue;
    // Only count park/lawn trees (not street trees on the outer sidewalk, unless we want to distinguish)
    const isParkTree = t.pitRot === undefined && t.tier !== 2 && !t.planter;
    if (!isParkTree) continue;

    // Nearest building collider or footprint in this block
    let minWall = Infinity;
    let wallKind = '';
    for (const c of querySpatialGrid(bldGrid, t.x, t.z, 20)) {
      const d = distToColliderXZ(t.x, t.z, c, treeY, topY);
      if (d < minWall) { minWall = d; wallKind = c.kind || 'building'; }
    }
    const fps = footprintsByBlock.get(b.id) || [];
    for (const fp of fps) {
      const d = distToFootprintPoly(fp, t.x, t.z);
      if (d < minWall) { minWall = d; wallKind = 'footprint'; }
    }

    // Check if standing on walk/path
    let onWalk = false;
    const pb = parkBlocksData.get(b.id);
    if (pb) {
      const inBed = pb.beds.some((bed) => pointInPoly(bed, t.x, t.z)) &&
        !pb.bedHoles.some((h) => pointInPoly(h, t.x, t.z));
      if (!inBed) onWalk = true;
    } else {
      // Partial park block: on walk if not inside any partParkLawn piece
      const lawns = partParkLawns.get(b.id) || [];
      if (lawns.length > 0 && !lawns.some((l) => pointInPoly(l, t.x, t.z))) {
        onWalk = true;
      }
    }

    const isProcPark = t.source === 'park sites';
    const trunkInside = minWall <= 0;
    const crownInWall = minWall < crownR;

    const entry = {
      blockId: b.id,
      parkName: b.parkName || '(unnamed)',
      isFullPark: isParkBlock(b),
      source: isProcPark ? 'park sites' : (t.source || 'osm'),
      x: t.x, z: t.z, scale: t.scale, sp, crownR,
      minWall, wallKind, trunkInside, crownInWall, onWalk
    };

    const addTo = (rec) => {
      rec.trees++;
      if (isProcPark) rec.procTrees++; else rec.osmTrees++;
      if (trunkInside) rec.trunkInside++;
      if (crownInWall) {
        rec.crownInWall++;
        if (isProcPark) rec.procCrownInWall++; else rec.osmCrownInWall++;
      }
      if (onWalk) {
        rec.onWalk++;
        if (isProcPark) rec.procOnWalk++; else rec.osmOnWalk++;
      }
      if (trunkInside || crownInWall || onWalk) rec.worst.push(entry);
    };

    addTo(treeParkAudit.allParkBldBlocks);
    if (isParkBlock(b)) addTo(treeParkAudit.fullParkBldBlocks);

    if (b.parkName && /Nad Wart/i.test(b.parkName)) {
      if (!treeParkAudit.parkNadWarta.blocks.includes(b.id)) treeParkAudit.parkNadWarta.blocks.push(b.id);
      addTo(treeParkAudit.parkNadWarta);
    }
    if (b.id === 876) {
      addTo(treeParkAudit.antoninek876);
    }
  }

  // Sort worst lists
  lampResults.sort((a, b) => b.distOutsideWalk - a.distOutsideWalk);
  treeParkAudit.allParkBldBlocks.worst.sort((a, b) => a.minWall - b.minWall);
  treeParkAudit.fullParkBldBlocks.worst.sort((a, b) => a.minWall - b.minWall);
  treeParkAudit.parkNadWarta.worst.sort((a, b) => a.minWall - b.minWall);
  treeParkAudit.antoninek876.worst.sort((a, b) => a.minWall - b.minWall);
  treeParkAudit.avenida.worst.sort((a, b) => a.dist - b.dist);

  // Also find Za Cytadelą park blocks (blocks within 40 m of Za Cytadelą road segments)
  const zaCytSegs = [];
  for (const r of GEO.roads) {
    if (!/Za Cytadel/i.test(r[0])) continue;
    const p = r[5];
    for (let i = 0; i + 3 < p.length; i += 2) {
      zaCytSegs.push({ ax: p[i], az: p[i + 1], bx: p[i + 2], bz: p[i + 3] });
    }
  }
  const zaCytBlockIds = new Set();
  for (const [bid, pb] of parkBlocksData) {
    for (const s of zaCytSegs) {
      const mx = (s.ax + s.bx) * 0.5, mz = (s.az + s.bz) * 0.5;
      if (mx >= pb.minX - 40 && mx <= pb.maxX + 40 && mz >= pb.minZ - 40 && mz <= pb.maxZ + 40) {
        if (distToRingEdge(pb.poly, mx, mz) < 40 || pointInPoly(pb.poly, mx, mz)) {
          zaCytBlockIds.add(bid);
        }
      }
    }
  }

  // Check ALL captured lamps (including plazas and Teatr Polski) for trunk/prop/building/water/road/rail overlaps
  const allLampOverlaps = [];
  const lampPairs = [];
  for (let i = 0; i < capturedAllLamps.length; i++) {
    const a = capturedAllLamps[i];
    for (let j = i + 1; j < capturedAllLamps.length; j++) {
      const b = capturedAllLamps[j];
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d < 6.0) lampPairs.push({ i, j, d, a, b });
    }
  }
  lampPairs.sort((p, q) => p.d - q.d);

  for (const s of capturedAllLamps) {
    const x = s.x, z = s.z, y = s.y;
    let minTrunkClear = Infinity, nearestTree = null;
    for (const t of querySpatialGrid(treeGrid, x, z, 5)) {
      const d = Math.hypot(x - t.x, z - t.z);
      const tc = d - (0.2 + 0.28 * (t.scale || 1));
      if (tc < minTrunkClear) { minTrunkClear = tc; nearestTree = t; }
    }
    let minPropClear = Infinity;
    for (const p of querySpatialGrid(propGrid, x, z, 5)) {
      if (p.isTrunk) continue;
      if (!p.obb && Math.abs((p.minX + p.maxX) * 0.5 - x) < 0.01 && Math.abs((p.minZ + p.maxZ) * 0.5 - z) < 0.01 &&
          Math.abs(p.maxX - p.minX - 0.4) < 0.05) continue;
      const d = distToColliderXZ(x, z, p, y, y + 4.45) - 0.2;
      if (d < minPropClear) minPropClear = d;
    }
    let minBldClear = Infinity;
    for (const c of querySpatialGrid(bldGrid, x, z, 5)) {
      const d = distToColliderXZ(x, z, c, y, y + 4.45) - 0.2;
      if (d < minBldClear) minBldClear = d;
    }
    const waterD = isWater(x, z) ? -1 : distToWater(x, z);
    const roadD = distToRoad(x, z);
    const railD = gridModule.railClearance(x, z, 5);
    if (minTrunkClear < 0 || minPropClear < 0 || minBldClear < 0 || waterD < 0.2 || roadD < 0.2 || railD < 2.0) {
      allLampOverlaps.push({ x, y, z, minTrunkClear, nearestTree, minPropClear, minBldClear, waterD, roadD, railD });
    }
  }

  // Also check ALL full park blocks for procedural park trees on walks
  const allProcOnWalk = [];
  for (const t of sites) {
    if (t.source !== 'park sites') continue;
    const b = blockAt(t.x, t.z);
    if (!b || !isParkBlock(b)) continue;
    const pb = parkBlocksData.get(b.id);
    if (!pb) continue;
    const inBed = pb.beds.some((bed) => pointInPoly(bed, t.x, t.z)) &&
      !pb.bedHoles.some((h) => pointInPoly(h, t.x, t.z));
    if (!inBed) allProcOnWalk.push({ blockId: b.id, parkName: b.parkName || '(unnamed)', x: t.x, z: t.z });
  }

  return { lampCounts, lampResults, allLampOverlaps, lampPairs, allProcOnWalk, treeParkAudit, parkBlocksData, zaCytBlockIds };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const jsonMode = process.argv.includes('--json');
  const topIdx = process.argv.indexOf('--top');
  const topN = topIdx >= 0 ? Number(process.argv[topIdx + 1]) || 15 : 15;
  const res = await runParkAudit();
  if (jsonMode) {
    console.log(JSON.stringify({
      lampCounts: res.lampCounts,
      worstLamps: res.lampResults.slice(0, topN),
      treeParkAudit: res.treeParkAudit
    }, null, 2));
  } else {
    const c = res.lampCounts;
    console.log('\n=== 1. PARK LAMPS AUDIT ===');
    console.log(`Total parkLampSites (plazas + parks + Teatr Polski): ${c.totalParkLampSites}`);
    console.log(`Park-block lamps (Section 6): ${c.parkBlockLamps}`);
    console.log(`  On walk:                 ${c.onWalk}`);
    console.log(`  On walk edge (<= 0.6 m): ${c.onWalkEdge}`);
    console.log(`  On lawn (> 0.6 m):       ${c.onLawn}`);
    console.log(`Defects / overlaps among park-block lamps:`);
    console.log(`  Tree trunk overlap (< 0.2 + 0.28*scale): ${c.treeTrunkOverlap}`);
    console.log(`  Within tree crown (< R_crown*scale):     ${c.treeCrownOverlap}`);
    console.log(`  Bench / prop overlap:                    ${c.propOverlap}`);
    console.log(`  Building overlap:                        ${c.buildingOverlap}`);
    console.log(`  Water / pond overlap:                    ${c.waterOverlap}`);
    console.log(`  Road carriageway (< 0.2 m):              ${c.roadOverlap}`);
    console.log(`  Rail clearance (< 2.0 m):                ${c.railOverlap}`);

    // Distribution of distOutsideWalk for onLawn lamps
    const lawnLamps = res.lampResults.filter((r) => r.cls === 'onLawn');
    if (lawnLamps.length) {
      const b06_1 = lawnLamps.filter((r) => r.distOutsideWalk <= 1.0).length;
      const b1_15 = lawnLamps.filter((r) => r.distOutsideWalk > 1.0 && r.distOutsideWalk <= 1.5).length;
      const b15_2 = lawnLamps.filter((r) => r.distOutsideWalk > 1.5 && r.distOutsideWalk <= 2.0).length;
      const b2p = lawnLamps.filter((r) => r.distOutsideWalk > 2.0).length;
      console.log(`On-lawn distance distribution: (0.6, 1.0]: ${b06_1}, (1.0, 1.5]: ${b1_15}, (1.5, 2.0]: ${b15_2}, > 2.0: ${b2p}`);
    }

    console.log(`\nWorst ${topN} park lamps by distance outside walk:`);
    for (const r of res.lampResults.slice(0, topN)) {
      console.log(`  block ${r.blockId} (${r.parkName}) at (${r.x.toFixed(2)}, ${r.z.toFixed(2)}): ${r.cls}, distOutsideWalk=${r.distOutsideWalk.toFixed(3)} m, crownClear=${r.minCrownClear.toFixed(2)} m`);
    }

    // Specific check: block 212 and Za Cytadelą
    const b212 = res.lampResults.filter((r) => r.blockId === 212);
    console.log(`\nBlock 212 lamps (${b212.length}): ${b212.filter((r) => r.cls === 'onLawn').length} onLawn, ${b212.filter((r) => r.cls === 'onWalk').length} onWalk`);
    for (const r of b212.slice(0, 5)) {
      console.log(`  (${r.x.toFixed(2)}, ${r.z.toFixed(2)}) ${r.cls} dist=${r.distOutsideWalk.toFixed(3)} m`);
    }
    const zaLamps = res.lampResults.filter((r) => res.zaCytBlockIds.has(r.blockId));
    const zaByBlock = new Map();
    for (const r of zaLamps) {
      let s = zaByBlock.get(r.blockId);
      if (!s) { s = { parkName: r.parkName, total: 0, onWalk: 0, onWalkEdge: 0, onLawn: 0 }; zaByBlock.set(r.blockId, s); }
      s.total++;
      s[r.cls]++;
    }
    console.log(`\nZa Cytadelą park blocks (${[...res.zaCytBlockIds].join(', ')}): ${zaLamps.length} lamps`);
    for (const [bid, s] of zaByBlock) {
      console.log(`  block ${bid} (${s.parkName}): total=${s.total}, onWalk=${s.onWalk}, onWalkEdge=${s.onWalkEdge}, onLawn=${s.onLawn}`);
    }

    // Any lamps with trunk/prop/building/water/road/rail overlaps
    const badLamps = res.lampResults.filter((r) => r.minTrunkClear < 0 || r.minPropClear < 0 || r.minBldClear < 0 || r.waterD < 0.2 || r.roadD < 0.2 || r.railD < 2.0);
    console.log(`\nPark lamps with hard overlaps (${badLamps.length}):`);
    for (const r of badLamps.slice(0, topN)) {
      console.log(`  block ${r.blockId} (${r.parkName}) (${r.x.toFixed(2)}, ${r.z.toFixed(2)}) [${r.cls}]: trunk=${r.minTrunkClear.toFixed(3)} (tree ${r.nearestTree?.source} at ${r.nearestTree?.x.toFixed(2)}, ${r.nearestTree?.z.toFixed(2)}, scale=${r.nearestTree?.scale.toFixed(2)}), prop=${r.minPropClear.toFixed(3)}, bld=${r.minBldClear.toFixed(3)}, water=${r.waterD.toFixed(2)}, road=${r.roadD.toFixed(2)}, rail=${r.railD.toFixed(2)}`);
    }

    console.log(`\nALL parkLampSites hard overlaps (${res.allLampOverlaps.length} of ${c.totalParkLampSites}):`);
    for (const r of res.allLampOverlaps) {
      console.log(`  (${r.x.toFixed(2)}, ${r.z.toFixed(2)}): trunk=${r.minTrunkClear.toFixed(3)} (${r.nearestTree?.source} ${r.nearestTree?.x.toFixed(2)}, ${r.nearestTree?.z.toFixed(2)}), prop=${r.minPropClear.toFixed(3)}, bld=${r.minBldClear.toFixed(3)}, water=${r.waterD.toFixed(2)}, road=${r.roadD.toFixed(2)}, rail=${r.railD.toFixed(2)}`);
    }
    console.log(`\nALL parkLampSites spacing < 6 m (${res.lampPairs.length}; < 3 m: ${res.lampPairs.filter((p) => p.d < 3).length}; < 1 m: ${res.lampPairs.filter((p) => p.d < 1).length}):`);
    for (const p of res.lampPairs.slice(0, 25)) {
      console.log(`  d=${p.d.toFixed(3)} m: (${p.a.x.toFixed(2)}, ${p.a.z.toFixed(2)}, y=${p.a.y.toFixed(2)}) vs (${p.b.x.toFixed(2)}, ${p.b.z.toFixed(2)}, y=${p.b.y.toFixed(2)})`);
    }
    console.log(`\nALL full-park procedural trees on walk (${res.allProcOnWalk.length}):`);
    for (const t of res.allProcOnWalk.slice(0, topN)) {
      console.log(`  block ${t.blockId} (${t.parkName}) (${t.x.toFixed(2)}, ${t.z.toFixed(2)})`);
    }

    console.log('\n=== 2. TREES IN PARK BLOCKS WITH BUILDINGS & AVENIDA ===');
    const ta = res.treeParkAudit;
    console.log(`Avenida (within 30 m of collider): near=${ta.avenida.totalNear}, trunkInside=${ta.avenida.trunkInside}, crownInWall=${ta.avenida.crownInWall}`);
    console.log(`Park Nad Wartą (blocks ${ta.parkNadWarta.blocks.join(', ')}): trees=${ta.parkNadWarta.trees} (proc=${ta.parkNadWarta.procTrees}, osm=${ta.parkNadWarta.osmTrees}), trunkInside=${ta.parkNadWarta.trunkInside}, crownInWall=${ta.parkNadWarta.crownInWall} (proc=${ta.parkNadWarta.procCrownInWall}, osm=${ta.parkNadWarta.osmCrownInWall}), onWalk=${ta.parkNadWarta.onWalk} (proc=${ta.parkNadWarta.procOnWalk}, osm=${ta.parkNadWarta.osmOnWalk})`);
    console.log(`Antoninek block 876 (was 874 pre-west-expansion; ${JSON.stringify(ta.antoninek876.blockInfo)}): trees=${ta.antoninek876.trees} (proc=${ta.antoninek876.procTrees}, osm=${ta.antoninek876.osmTrees}), trunkInside=${ta.antoninek876.trunkInside}, crownInWall=${ta.antoninek876.crownInWall}, onWalk=${ta.antoninek876.onWalk}`);
    console.log(`FULL park blocks with buildings (${ta.fullParkBldBlocks.blockCount} blocks): trees=${ta.fullParkBldBlocks.trees} (proc=${ta.fullParkBldBlocks.procTrees}, osm=${ta.fullParkBldBlocks.osmTrees}), trunkInside=${ta.fullParkBldBlocks.trunkInside}, crownInWall=${ta.fullParkBldBlocks.crownInWall} (proc=${ta.fullParkBldBlocks.procCrownInWall}, osm=${ta.fullParkBldBlocks.osmCrownInWall}), onWalk=${ta.fullParkBldBlocks.onWalk} (proc=${ta.fullParkBldBlocks.procOnWalk}, osm=${ta.fullParkBldBlocks.osmOnWalk})`);
    console.log(`ALL park blocks with buildings (${ta.allParkBldBlocks.blockCount} blocks): trees=${ta.allParkBldBlocks.trees} (proc=${ta.allParkBldBlocks.procTrees}, osm=${ta.allParkBldBlocks.osmTrees}), trunkInside=${ta.allParkBldBlocks.trunkInside}, crownInWall=${ta.allParkBldBlocks.crownInWall} (proc=${ta.allParkBldBlocks.procCrownInWall}, osm=${ta.allParkBldBlocks.osmCrownInWall}), onWalk=${ta.allParkBldBlocks.onWalk} (proc=${ta.allParkBldBlocks.procOnWalk}, osm=${ta.allParkBldBlocks.osmOnWalk})`);
    console.log(`\nProcedural park trees on walk in FULL park blocks with buildings (${ta.fullParkBldBlocks.procOnWalk}):`);
    for (const t of ta.fullParkBldBlocks.worst.filter((x) => x.source === 'park sites' && x.onWalk)) {
      console.log(`  block ${t.blockId} (${t.parkName}) (${t.x.toFixed(2)}, ${t.z.toFixed(2)}): wall=${t.minWall.toFixed(2)} m`);
    }
    console.log(`\nWorst ${topN} trees in FULL park blocks with buildings (by wall clearance):`);
    for (const t of ta.fullParkBldBlocks.worst.slice(0, topN)) {
      console.log(`  block ${t.blockId} (${t.parkName}) [${t.source}] (${t.x.toFixed(2)}, ${t.z.toFixed(2)}): wall=${t.minWall.toFixed(3)} m (${t.wallKind}), crownR=${t.crownR.toFixed(2)} m, onWalk=${t.onWalk}`);
    }
  }
}
