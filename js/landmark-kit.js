import * as THREE from 'three/webgpu';
import { LANDMARK_SITES } from './city-config.js';
import { createPreWarBuildingMaterial, createCurtainWallMaterial, createFacadeBoxes } from './tsl-materials.js';

// js/landmark-kit.js
// The shared toolkit of the hand-modelled landmarks (landmarks.js and the landmarks-*.js area modules): fitting a model
// onto its real OpenStreetMap lot, the canonical landmark materials, the facade-box pass and a few geometry helpers.
//
// Modelling conventions (every area module follows them):
// - A landmark is modelled around a local origin in metres at its real size: +y up, its long or main axes along x and
//   z. fitToSite then scales it to its real height (as wide as the outline allows) and turns it by the site's `ang`
//   onto the outline: local +x becomes the site's u axis (world (cos ang, -sin ang)), local +z its w axis (world
//   (sin ang, cos ang)), so site.w spans local x and site.d local z.
// - Colliders are authored in the same local coordinates, as axis-aligned boxes { minX, maxX, minZ, maxZ, maxY },
//   pushed between `const c0 = colliders.length` and the fitToSite call, which transforms them with the model.
// - Box parts in a `boxLocalTwins` facade material (M.facade.*) are re-emitted as instanced facade boxes with whole
//   window bays; everything else is batched per material at the end of buildLandmarks, so share materials (M.*).
// - Animated parts go into ctx.dynamic, a separate root that is neither batched nor culled.

// -------------------------------------------------------------------------------------------------------------------
// Every landmark is modelled around a local origin, then fitted onto its real lot (LANDMARK_SITES: the OpenStreetMap
// outline's box): scaled up to its real height (as wide as the real outline allows, about the model's centre) and moved
// so its centre stands on the outline's centre. Its colliders (colliders[c0..]) follow.
// A site may carry `ang` (radians, the same turn as a frontage frame's θ and three.js rotation.y): its w and d are then
// the outline's extents along the turned axes, and the model is turned by ang about the site centre (offset turns with
// it). Sites without ang take the unrotated path.
// -------------------------------------------------------------------------------------------------------------------
function fitToSite(objs, site, colliders, c0, { height, horizontal, stretch = false, offset = [0, 0] } = {}) {
  if (!site) return;
  const box = new THREE.Box3();
  for (const o of objs) {
    o.updateMatrixWorld(true);
    box.expandByObject(o);
  }
  const size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  const sy = height ? height / size.y : 1;
  let sx;
  let sz;
  if (stretch) {
    // fill the site's box exactly (parks & plazas)
    sx = site.w / size.x;
    sz = site.d / size.z;
  } else {
    // as tall as the real building, but never wider than its real outline (+6%) in either direction
    const fit = Math.min(site.w / size.x, site.d / size.z) * 1.06;
    sx = sz = horizontal ?? Math.min(sy, fit);
  }
  if (site.ang) {
    fitTurned(objs, site, colliders, c0, c, sx, sy, sz, offset);
    return;
  }
  const tx = site.x + offset[0];
  const tz = site.z + offset[1];
  for (const o of objs) {
    o.position.set(tx + (o.position.x - c.x) * sx, o.position.y * sy, tz + (o.position.z - c.z) * sz);
    o.scale.multiply(new THREE.Vector3(sx, sy, sz));
  }
  for (let i = c0; i < colliders.length; i++) {
    const k = colliders[i];
    const x0 = tx + (k.minX - c.x) * sx;
    const x1 = tx + (k.maxX - c.x) * sx;
    const z0 = tz + (k.minZ - c.z) * sz;
    const z1 = tz + (k.maxZ - c.z) * sz;
    k.minX = Math.min(x0, x1);
    k.maxX = Math.max(x0, x1);
    k.minZ = Math.min(z0, z1);
    k.maxZ = Math.max(z0, z1);
    k.maxY *= sy;
  }
}

// fitToSite on a turned site: scale in the site's own frame, then turn by ang about the site centre. Local (u, w) maps
// to world (x + u cos + w sin, z - u sin + w cos), as buildings.js does for frontage frames. The colliders, authored as
// model-space boxes, become oriented boxes inside their world AABB: the obb shape buildings.js pushCollider emits, which
// controllers.js and audio-acoustics.js test against and main.js keeps out of the traffic obstacles.
function fitTurned(objs, site, colliders, c0, c, sx, sy, sz, offset) {
  const cs = Math.cos(site.ang);
  const sn = Math.sin(site.ang);
  const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), site.ang);
  for (const o of objs) {
    const u = offset[0] + (o.position.x - c.x) * sx;
    const w = offset[1] + (o.position.z - c.z) * sz;
    o.position.set(site.x + u * cs + w * sn, o.position.y * sy, site.z - u * sn + w * cs);
    o.scale.multiply(new THREE.Vector3(sx, sy, sz));
    o.quaternion.premultiply(turn);
  }
  for (let i = c0; i < colliders.length; i++) {
    const k = colliders[i];
    const u = offset[0] + ((k.minX + k.maxX) * 0.5 - c.x) * sx;
    const w = offset[1] + ((k.minZ + k.maxZ) * 0.5 - c.z) * sz;
    const cx = site.x + u * cs + w * sn;
    const cz = site.z - u * sn + w * cs;
    const hx = (k.maxX - k.minX) * 0.5 * Math.abs(sx);
    const hz = (k.maxZ - k.minZ) * 0.5 * Math.abs(sz);
    const ex = Math.abs(cs) * hx + Math.abs(sn) * hz;
    const ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
    k.minX = cx - ex;
    k.maxX = cx + ex;
    k.minZ = cz - ez;
    k.maxZ = cz + ez;
    k.maxY *= sy;
    k.obb = { cx, cz, hx, hz, cs, sn };
  }
}

// Box-shaped facade parts (unrotated) become box-local facade boxes: every wall laid out in whole window bays between
// solid masonry corners, like the procedural blocks, so no window is cut by a corner. `boxLocalTwins` maps each
// world-space facade material to its `boxLocal: true` twin; rotated and non-box parts keep the world-space window grid.
function emitFacadeBoxes(group, boxLocalTwins) {
  group.updateMatrixWorld(true);
  const facadeBoxes = new Map();
  const boxParts = [];
  group.traverse((obj) => {
    if (obj.isMesh && boxLocalTwins.has(obj.material) && obj.geometry.type === 'BoxGeometry') boxParts.push(obj);
  });
  const partPos = new THREE.Vector3();
  const partRot = new THREE.Quaternion();
  const partScale = new THREE.Vector3();
  for (const m of boxParts) {
    m.matrixWorld.decompose(partPos, partRot, partScale);
    if (Math.abs(partRot.w) < 0.99999) continue;
    const { width, height, depth } = m.geometry.parameters;
    const twin = boxLocalTwins.get(m.material);
    if (!facadeBoxes.has(twin)) facadeBoxes.set(twin, []);
    facadeBoxes.get(twin).push({ x: partPos.x, y: partPos.y, z: partPos.z, w: width * partScale.x, h: height * partScale.y, d: depth * partScale.z });
    m.removeFromParent();
  }
  for (const [mat, boxes] of facadeBoxes) {
    const inst = createFacadeBoxes(mat, boxes);
    inst.castShadow = true;
    inst.receiveShadow = true;
    group.add(inst);
  }
}

// -------------------------------------------------------------------------------------------------------------------
// Canonical landmark materials, created once and shared by every area module: each distinct node material is another
// WGSL pipeline to precompile behind the loading screen. The facade styles are uniforms of one masonry and one curtain
// wall shader, so a new colour there is cheap; a new plain material is not, so reuse these before adding one.
// -------------------------------------------------------------------------------------------------------------------
let _materials = null;

function createLandmarkMaterials() {
  if (_materials) return _materials;
  const std = (color, roughness, metalness = 0, extra = {}) => new THREE.MeshStandardNodeMaterial({ color, roughness, metalness, ...extra });

  // Windowed walls (createPreWarBuildingMaterial / createCurtainWallMaterial styles)
  const FACADE = {
    plasterCream: { stoneColor: 0xe8dcc0, trimColor: 0xb8a888, windowGlassColor: 0x1a2430, windowWidth: 2.6, floorHeight: 4.2, litProbability: 0.5, seed: 11.3 },
    plasterOchre: { stoneColor: 0xd9b26a, trimColor: 0xa88a52, windowGlassColor: 0x1a2430, windowWidth: 2.6, floorHeight: 4.0, litProbability: 0.5, seed: 12.7 },
    plasterPink: { stoneColor: 0xdba3a0, trimColor: 0xeee4d6, windowGlassColor: 0x1a2430, windowWidth: 2.8, floorHeight: 4.4, litProbability: 0.45, seed: 13.1 },
    sandstone: { stoneColor: 0xb9ab90, trimColor: 0x8c8068, windowGlassColor: 0x161e28, windowWidth: 2.4, floorHeight: 4.6, litProbability: 0.4, seed: 14.9 },
    brick: { stoneColor: 0x9a4a32, trimColor: 0xc8b494, windowGlassColor: 0x161e28, windowWidth: 2.6, floorHeight: 4.2, litProbability: 0.55, seed: 15.5 },
    concrete: { stoneColor: 0xc4c0b8, trimColor: 0x8e8a84, windowGlassColor: 0x1c2a36, windowWidth: 2.2, floorHeight: 3.4, litProbability: 0.55, seed: 16.2 }
  };
  const CURTAIN = {
    glassBlue: { glassTint: 0x1e3e5a, frameTint: 0xb8c4d0, windowWidth: 1.5, floorHeight: 3.7, litProbability: 0.6, warmth: 0.5, reflectivity: 0.94, seed: 21.4 },
    glassDark: { glassTint: 0x14191f, frameTint: 0x2a2c30, windowWidth: 1.8, floorHeight: 3.6, litProbability: 0.55, warmth: 0.7, reflectivity: 0.9, seed: 22.8 },
    glassGreen: { glassTint: 0x2a4a48, frameTint: 0xa8b4b4, windowWidth: 1.6, floorHeight: 3.8, litProbability: 0.6, warmth: 0.55, reflectivity: 0.92, seed: 23.6 }
  };
  const facade = {};
  const boxLocalTwins = new Map();
  for (const [k, o] of Object.entries(FACADE)) {
    facade[k] = createPreWarBuildingMaterial(o);
    boxLocalTwins.set(facade[k], createPreWarBuildingMaterial({ ...o, boxLocal: true }));
  }
  for (const [k, o] of Object.entries(CURTAIN)) {
    facade[k] = createCurtainWallMaterial(o);
    boxLocalTwins.set(facade[k], createCurtainWallMaterial({ ...o, boxLocal: true }));
  }

  _materials = {
    facade,
    boxLocalTwins,
    // Plain walls and trim
    plasterWhite: std(0xeee8dc, 0.82),
    plasterCream: std(0xe8dcc0, 0.82),
    plasterOchre: std(0xd9b26a, 0.84),
    plasterPink: std(0xdba3a0, 0.84),
    sandstone: std(0xc8b48c, 0.78),
    stoneGrey: std(0x8f8d88, 0.86),
    granite: std(0x5d5b58, 0.7),
    brick: std(0x9a4a32, 0.88),
    clinker: std(0x6a2a1e, 0.8),
    concrete: std(0xb8b4ac, 0.9),
    // Roofs
    copper: std(0x5f9a7e, 0.55, 0.3), // patina
    tileRed: std(0xa4442c, 0.74),
    slate: std(0x34383e, 0.62, 0.1),
    zinc: std(0x8a9096, 0.4, 0.6),
    // Metals and glass
    gold: std(0xd8aa48, 0.28, 1.0),
    steel: std(0xb8c0c8, 0.3, 0.85),
    darkMetal: std(0x26282c, 0.45, 0.6),
    bronze: std(0x5a4632, 0.42, 0.75),
    glass: std(0x1c2a36, 0.08, 0.6), // plain dark window panes on non-facade parts
    wood: std(0x4e3424, 0.8),
    hedge: std(0x3d5a2c, 0.95), // clipped box and privet in planters
    // Lit at night: clock faces and lanterns
    warmLit: std(0xfff0c8, 0.3, 0, { emissive: 0xffc870, emissiveIntensity: 1.2 })
  };
  return _materials;
}

// -------------------------------------------------------------------------------------------------------------------
// Geometry helpers. Positions are the part's base centre (y at its bottom), as buildings are drawn; every mesh casts
// and receives shadows. All geometry carries position, normal and uv (batchStaticGroupMeshes skips meshes without).
// -------------------------------------------------------------------------------------------------------------------
function addMesh(parent, geometry, material, x = 0, y = 0, z = 0, ry = 0) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  if (ry) m.rotation.y = ry;
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

// A w (x) × h × d (z) box standing on y
function box(parent, w, h, d, material, x = 0, y = 0, z = 0, ry = 0) {
  return addMesh(parent, new THREE.BoxGeometry(w, h, d), material, x, y + h / 2, z, ry);
}

// A cylinder (or cone, rTop 0) standing on y
function cylinder(parent, rTop, rBottom, h, segments, material, x = 0, y = 0, z = 0) {
  return addMesh(parent, new THREE.CylinderGeometry(rTop, rBottom, h, segments), material, x, y + h / 2, z);
}

// A lathe of [r, y] profile points (bottom to top) about the y axis, standing at y: helmets, domes, lanterns, spires
function lathe(parent, profile, segments, material, x = 0, y = 0, z = 0) {
  const g = new THREE.LatheGeometry(profile.map(([r, py]) => new THREE.Vector2(r, py)), segments);
  return addMesh(parent, g, material, x, y, z);
}

// Pitched roof over a w (x) × d (z) base, rising h above y. ridge 'x' runs the ridge along x (gables at ±x); 'z'
// along z. hip (0..1) pulls the gable ends in by that fraction of the half-span (0 gable, 1 full hip / pyramid on a
// square). Flat-shaded, with uvs in metres.
function pitchedRoofGeometry(w, d, h, { ridge = 'x', hip = 0 } = {}) {
  const alongX = ridge === 'x';
  const L = (alongX ? w : d) / 2; // half-length along the ridge
  const S = (alongX ? d : w) / 2; // half-span across it
  const r = Math.max(0, L - hip * S); // ridge half-length
  // In (a, b) = (along, across) coordinates
  const eaves = [[-L, -S], [L, -S], [L, S], [-L, S]];
  const ridgePts = [[-r, 0], [r, 0]];
  const tris = [
    [eaves[0], eaves[1], ridgePts[1]], [eaves[0], ridgePts[1], ridgePts[0]], // -S slope
    [eaves[2], eaves[3], ridgePts[0]], [eaves[2], ridgePts[0], ridgePts[1]], // +S slope
    [eaves[1], eaves[2], ridgePts[1]], // +L end (gable or hip)
    [eaves[3], eaves[0], ridgePts[0]] // -L end
  ];
  const pos = [];
  const uvs = [];
  const toXYZ = ([a, b], isRidge) => (alongX ? [a, isRidge ? h : 0, b] : [b, isRidge ? h : 0, a]);
  for (const t of tris) {
    for (const p of t) {
      const isRidge = p === ridgePts[0] || p === ridgePts[1];
      const v = toXYZ(p, isRidge);
      pos.push(...v);
      uvs.push(v[0] + v[2], v[1]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  // Wind every triangle outward (normal away from the base centre, upward)
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const mid = new THREE.Vector3();
  for (let i = 0; i < pos.length; i += 9) {
    a.fromArray(pos, i);
    b.fromArray(pos, i + 3);
    c.fromArray(pos, i + 6);
    n.subVectors(b, a).cross(mid.subVectors(c, a));
    mid.copy(a).add(b).add(c).multiplyScalar(1 / 3);
    mid.y -= h * 0.5;
    if (n.dot(mid) < 0) {
      for (let k = 0; k < 3; k++) {
        const t = pos[i + 3 + k];
        pos[i + 3 + k] = pos[i + 6 + k];
        pos[i + 6 + k] = t;
      }
      const j = (i / 3) * 2;
      for (let k = 0; k < 2; k++) {
        const t = uvs[j + 2 + k];
        uvs[j + 2 + k] = uvs[j + 4 + k];
        uvs[j + 4 + k] = t;
      }
    }
  }
  g.attributes.position.needsUpdate = true;
  g.attributes.uv.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

function pitchedRoof(parent, w, d, h, material, x = 0, y = 0, z = 0, opts = {}) {
  return addMesh(parent, pitchedRoofGeometry(w, d, h, opts), material, x, y, z, opts.ry || 0);
}

// A prism of a 2D outline ([x, z] points, either winding) extruded up by h from y: gables, stepped attics, wedges
function prism(parent, outline, h, material, x = 0, y = 0, z = 0) {
  const shape = new THREE.Shape(outline.map(([px, pz]) => new THREE.Vector2(px, -pz)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  return addMesh(parent, g, material, x, y, z);
}

// A vertical face outline ([u, y] points in the x-y plane) extruded by depth along z, centred on z: gable walls,
// arches, stepped attic parapets
function profileSlab(parent, outline, depth, material, x = 0, y = 0, z = 0, ry = 0) {
  const shape = new THREE.Shape(outline.map(([u, v]) => new THREE.Vector2(u, v)));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  g.translate(0, 0, -depth / 2);
  return addMesh(parent, g, material, x, y, z, ry);
}

// An axis-aligned collider in the model's local frame (fitToSite transforms it)
function collider(colliders, minX, maxX, minZ, maxZ, maxY) {
  colliders.push({ minX, maxX, minZ, maxZ, maxY });
}

const site = (name) => LANDMARK_SITES[name];

export {
  fitToSite,
  emitFacadeBoxes,
  createLandmarkMaterials,
  addMesh,
  box,
  cylinder,
  lathe,
  pitchedRoofGeometry,
  pitchedRoof,
  prism,
  profileSlab,
  collider,
  site
};
