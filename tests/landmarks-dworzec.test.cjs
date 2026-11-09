// tests/landmarks-dworzec.test.cjs
// Avenida's glazed entrance halls used to sit on exactly the same z plane as the retail block behind them: the north
// hall's front at Z0 and the mass's north wall at Z0 gave two coplanar shaders, which z-fight from Most Dworcowy.
// The halls now stand proud of the block; this test keeps them there and checks their colliders follow.

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');
const { THREE } = require('./helpers/three-stub.cjs');

const cityConfig = require('../js/city-config.js');
const { LANDMARK_SITES } = cityConfig;

const tslStub = {
  createPreWarBuildingMaterial: (o) => ({ ...o }),
  createCurtainWallMaterial: (o) => ({ ...o }),
  createFacadeBoxes: () => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), {}),
  createLitWindowMaterial: (opts = {}) => Object.assign(new THREE.MeshStandardNodeMaterial({ color: 0x1c2a36, ...opts }), { isLitWindow: true, userData: { isLitWindow: true } })
};

const kitSource = readFileSync(join(__dirname, '../js/landmark-kit.js'), 'utf8');
const kit = loadModule(kitSource, {
  imports: {
    'three/webgpu': THREE,
    './city-config.js': cityConfig,
    './tsl-materials.js': tslStub
  },
  globals: { Math, console }
});

const M = kit.createLandmarkMaterials();

const dworzecSource = readFileSync(join(__dirname, '../js/landmarks-dworzec.js'), 'utf8');
const dworzec = loadModule(dworzecSource, {
  imports: {
    'three/webgpu': THREE,
    './landmark-kit.js': kit
  },
  globals: { Math, console }
});

function buildAvenida() {
  const group = new THREE.Group();
  const colliders = [];
  dworzec.buildDworzecLandmarks({ group, colliders, M });

  const site = LANDMARK_SITES['Avenida'];
  const avenida = group.children.find((child) => {
    const box = new THREE.Box3().setFromObject(child);
    const cx = (box.min.x + box.max.x) / 2;
    const cz = (box.min.z + box.max.z) / 2;
    return Math.hypot(cx - site.x, cz - site.z) < 25;
  });
  assert.ok(avenida, 'Found the built Avenida model on its site');
  group.updateMatrixWorld(true);
  return { avenida, colliders };
}

// Box parts keep their authored model-space position and size under fitToSite (the site transform sits on the group)
function boxParts(avenida) {
  const parts = [];
  avenida.traverse((n) => {
    if (!n.isMesh || n.geometry?.type !== 'BoxGeometry') return;
    const { width, height, depth } = n.geometry.parameters;
    parts.push({
      mesh: n,
      width,
      height,
      depth,
      zNorth: n.position.z - depth / 2,
      zSouth: n.position.z + depth / 2
    });
  });
  return parts;
}

function colliderContains(collider, point) {
  if (!collider.obb) return false;
  const { cx, cz, hx, hz, cs, sn } = collider.obb;
  const dx = point.x - cx;
  const dz = point.z - cz;
  const u = dx * cs - dz * sn;
  const w = dx * sn + dz * cs;
  return Math.abs(u) <= hx + 1e-6 && Math.abs(w) <= hz + 1e-6;
}

function frontCentre(mesh, side) {
  return new THREE.Vector3(0, 0, (side * mesh.geometry.parameters.depth) / 2).applyMatrix4(mesh.matrixWorld);
}

test('Avenida entrance halls project clear of the retail block instead of z-fighting with it', () => {
  const { avenida } = buildAvenida();
  const parts = boxParts(avenida);

  const northHall = parts.find((p) => p.width === 40 && p.height === 16 && p.depth === 6);
  const southHall = parts.find((p) => p.width === 34 && p.height === 16 && p.depth === 6);
  assert.ok(northHall, 'Found the 40 x 16 x 6 m north entrance hall');
  assert.ok(southHall, 'Found the 34 x 16 x 6 m south entrance hall');

  // The retail masses are the 10 m concrete storeys; the north wall plane is their northmost face and the south one
  // their southmost face.
  const retail = parts.filter((p) => p.mesh.material === M.facade.concrete && p.height === 10);
  assert.ok(retail.length >= 6, 'Found the Avenida retail storeys');
  const massNorth = Math.min(...retail.map((p) => p.zNorth));
  const massSouth = Math.max(...retail.map((p) => p.zSouth));

  assert.ok(
    northHall.zNorth <= massNorth - 1.5,
    `North entrance hall front ${northHall.zNorth.toFixed(2)} m stands at least 1.5 m proud of the retail wall ${massNorth.toFixed(2)} m`
  );
  assert.ok(
    southHall.zSouth >= massSouth + 1.5,
    `South entrance hall front ${southHall.zSouth.toFixed(2)} m stands at least 1.5 m proud of the retail wall ${massSouth.toFixed(2)} m`
  );

  // No other part may put a face back on either hall's front plane (the original bug).
  for (const p of parts) {
    if (p !== northHall) {
      assert.ok(Math.abs(p.zNorth - northHall.zNorth) > 0.1, `No part is coplanar with the north hall front (${p.width} x ${p.height} x ${p.depth} m at z ${p.zNorth.toFixed(2)})`);
      assert.ok(Math.abs(p.zSouth - northHall.zNorth) > 0.1, `No part ends on the north hall front plane (${p.width} x ${p.height} x ${p.depth} m at z ${p.zSouth.toFixed(2)})`);
    }
    if (p !== southHall) {
      assert.ok(Math.abs(p.zNorth - southHall.zSouth) > 0.1, `No part ends on the south hall front plane (${p.width} x ${p.height} x ${p.depth} m at z ${p.zNorth.toFixed(2)})`);
      assert.ok(Math.abs(p.zSouth - southHall.zSouth) > 0.1, `No part is coplanar with the south hall front (${p.width} x ${p.height} x ${p.depth} m at z ${p.zSouth.toFixed(2)})`);
    }
  }

  // The north canopy covers the projection with a light overhang, so its front edge is proud of the hall's own front.
  const northCanopy = parts.find((p) => p.mesh.material === M.plasterWhite && p.height === 0.8 && p.zNorth < northHall.zNorth);
  assert.ok(northCanopy, 'Found the north entrance canopy');
  assert.ok(
    northCanopy.zNorth <= northHall.zNorth - 0.3,
    `North canopy overhangs the hall by ${(northHall.zNorth - northCanopy.zNorth).toFixed(2)} m`
  );
});

test('Avenida entrance hall projections carry player colliders', () => {
  const { avenida, colliders } = buildAvenida();
  const parts = boxParts(avenida);
  const northHall = parts.find((p) => p.width === 40 && p.height === 16 && p.depth === 6);
  const southHall = parts.find((p) => p.width === 34 && p.height === 16 && p.depth === 6);
  assert.ok(northHall && southHall, 'Found both entrance halls');

  for (const [label, hall, side] of [['north', northHall, -1], ['south', southHall, 1]]) {
    const point = frontCentre(hall.mesh, side);
    assert.ok(
      colliders.some((c) => c.maxY >= 15.9 && colliderContains(c, point)),
      `${label} hall projection is covered by a player collider`
    );
  }
});
