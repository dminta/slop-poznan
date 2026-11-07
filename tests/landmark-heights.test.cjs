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

// Selects a landmark group child by matching its center against the authored site in LANDMARK_SITES
function findBySite(group, siteName) {
  const site = LANDMARK_SITES[siteName];
  assert.ok(site, `Site '${siteName}' exists in LANDMARK_SITES`);
  const landmark = group.children.find((child) => {
    const box = new THREE.Box3().setFromObject(child);
    const cx = (box.min.x + box.max.x) / 2;
    const cz = (box.min.z + box.max.z) / 2;
    return Math.hypot(cx - site.x, cz - site.z) < 25;
  });
  assert.ok(landmark, `Found landmark matching site '${siteName}'`);
  return landmark;
}

test('Brama Poznania ICHOT: height corrected to 16.3 m from AD Artis architectural project', () => {
  const heritageSource = readFileSync(join(__dirname, '../js/landmarks-heritage.js'), 'utf8');
  const heritage = loadModule(heritageSource, {
    imports: {
      'three/webgpu': THREE,
      './landmark-kit.js': kit,
      './city-config.js': cityConfig
    },
    globals: { Math, console }
  });

  const group = new THREE.Group();
  const colliders = [];
  heritage.buildHeritageLandmarks({ group, colliders, M });

  const brama = findBySite(group, 'Brama Poznania');
  const box = new THREE.Box3().setFromObject(brama);
  const height = box.max.y - box.min.y;

  assert.ok(Math.abs(height - 16.3) < 0.1, `Brama Poznania height ${height.toFixed(2)} m should be 16.3 m`);
  assert.ok(Math.abs(box.max.y - 16.3) < 0.1, `Brama Poznania top ${box.max.y.toFixed(2)} m should be 16.3 m`);

  // Verify collider maxY matches 16.3 m
  const bramaSite = LANDMARK_SITES['Brama Poznania'];
  const bramaCollider = colliders.find((c) => {
    const cx = (c.minX + c.maxX) * 0.5;
    const cz = (c.minZ + c.maxZ) * 0.5;
    return Math.hypot(cx - bramaSite.x, cz - bramaSite.z) < 20;
  });
  assert.ok(bramaCollider, 'Brama Poznania collider exists on site');
  assert.ok(Math.abs(bramaCollider.maxY - 16.3) < 0.1, `Collider maxY ${bramaCollider.maxY} matches 16.3 m`);
});

test('Iglica MTP: height corrected to 70.0 m from Grupa MTP architectural record', () => {
  const dworzecSource = readFileSync(join(__dirname, '../js/landmarks-dworzec.js'), 'utf8');
  const dworzec = loadModule(dworzecSource, {
    imports: {
      'three/webgpu': THREE,
      './landmark-kit.js': kit
    },
    globals: { Math, console }
  });

  const group = new THREE.Group();
  const colliders = [];
  dworzec.buildDworzecLandmarks({ group, colliders, M });

  const iglica = findBySite(group, 'Iglica');
  const box = new THREE.Box3().setFromObject(iglica);
  const height = box.max.y - box.min.y;

  assert.ok(Math.abs(height - 70.0) < 0.1, `Iglica height ${height.toFixed(2)} m should be 70.0 m`);
  assert.ok(Math.abs(box.max.y - 70.0) < 0.1, `Iglica star tip ${box.max.y.toFixed(2)} m should be 70.0 m`);

  // Spire lattice top / mast base stands at y = 64 m
  const mast = iglica.children.find((c) => c.geometry?.parameters?.height === 4 && c.geometry?.parameters?.radiusTop === 0.12);
  assert.ok(mast, 'Identified spire mast cylinder');
  const mastBox = new THREE.Box3().setFromObject(mast);
  assert.ok(Math.abs(mastBox.min.y - 64.0) < 0.1, `Mast stands at lattice top 64.0 m (got ${mastBox.min.y.toFixed(2)} m)`);

  // Rotunda drum colliders on site at maxY = 10.4 m
  const iglicaSite = LANDMARK_SITES['Iglica'];
  const iglicaColliders = colliders.filter((c) => {
    const cx = (c.minX + c.maxX) * 0.5;
    const cz = (c.minZ + c.maxZ) * 0.5;
    return Math.hypot(cx - iglicaSite.x, cz - iglicaSite.z) < 30;
  });
  assert.equal(iglicaColliders.length, 3, 'Iglica rotunda has 3 colliders on site');
  for (const c of iglicaColliders) {
    assert.ok(Math.abs(c.maxY - 10.4) < 0.1, `Iglica collider maxY ${c.maxY.toFixed(2)} m should be 10.4 m`);
  }
});

test('Biurowiec Delta: dominanta corrected to 43.5 m from Ataner / Sipińscy measurements', () => {
  const towersSource = readFileSync(join(__dirname, '../js/landmarks-towers.js'), 'utf8');
  const towers = loadModule(towersSource, {
    imports: {
      'three/webgpu': THREE,
      './landmark-kit.js': kit
    },
    globals: { Math, console }
  });

  const group = new THREE.Group();
  const colliders = [];
  towers.buildTowerLandmarks({ group, colliders, M });

  const delta = findBySite(group, 'Delta');
  const box = new THREE.Box3().setFromObject(delta);
  const height = box.max.y - box.min.y;

  assert.ok(Math.abs(height - 43.5) < 0.1, `Delta height ${height.toFixed(2)} m should be 43.5 m`);
  assert.ok(Math.abs(box.max.y - 43.5) < 0.1, `Delta plant top ${box.max.y.toFixed(2)} m should be 43.5 m`);

  delta.updateMatrixWorld(true);

  // Inspect high office volume (10 storeys) and low wing (6 storeys) tops
  let highOfficeTop = 0;
  let lowWingTop = 0;
  delta.traverse((node) => {
    if (node.isMesh && node.geometry && node.geometry.type === 'ExtrudeGeometry') {
      const b = new THREE.Box3().setFromObject(node);
      if (Math.abs(b.min.y) < 0.01 && b.max.y > 35 && b.max.y < 42) highOfficeTop = b.max.y;
      if (Math.abs(b.min.y) < 0.01 && b.max.y > 20 && b.max.y < 30) lowWingTop = b.max.y;
    }
  });
  assert.ok(highOfficeTop > 0, 'Found high office volume roof level');
  assert.ok(lowWingTop > 0, 'Found low wing roof level');

  // Verify colliders match the high office and low wing roofs without magic hardcoded constants
  const deltaSite = LANDMARK_SITES['Delta'];
  const deltaColliders = colliders.filter((c) => {
    const cx = (c.minX + c.maxX) * 0.5;
    const cz = (c.minZ + c.maxZ) * 0.5;
    return Math.hypot(cx - deltaSite.x, cz - deltaSite.z) < 50;
  });
  const highCols = deltaColliders.filter((c) => c.maxY > 30);
  const lowCols = deltaColliders.filter((c) => c.maxY < 30);
  assert.equal(highCols.length, 2, 'Delta has 2 high block colliders');
  assert.equal(lowCols.length, 1, 'Delta has 1 low wing collider');

  for (const c of highCols) {
    assert.ok(Math.abs(c.maxY - highOfficeTop) < 1.5,
      `High block collider maxY ${c.maxY.toFixed(2)} m matches high office roof ${highOfficeTop.toFixed(2)} m`);
  }
  assert.ok(Math.abs(lowCols[0].maxY - lowWingTop) < 1.5,
    `Low wing collider maxY ${lowCols[0].maxY.toFixed(2)} m matches low wing roof ${lowWingTop.toFixed(2)} m`);
});

test('Zamek Królewski: tower apex at 43.0 m and covered terrace floor at 30.0 m', () => {
  const heritageSource = readFileSync(join(__dirname, '../js/landmarks-heritage.js'), 'utf8');
  const heritage = loadModule(heritageSource, {
    imports: {
      'three/webgpu': THREE,
      './landmark-kit.js': kit,
      './city-config.js': cityConfig
    },
    globals: { Math, console }
  });

  const group = new THREE.Group();
  const colliders = [];
  heritage.buildHeritageLandmarks({ group, colliders, M });

  const zamek = findBySite(group, 'Zamek Królewski');
  const box = new THREE.Box3().setFromObject(zamek);
  const height = box.max.y - box.min.y;

  assert.ok(Math.abs(height - 43.0) < 0.1, `Zamek Królewski height ${height.toFixed(2)} m should be 43.0 m`);
  assert.ok(Math.abs(box.max.y - 43.0) < 0.1, `Zamek Królewski tower apex ${box.max.y.toFixed(2)} m should be 43.0 m`);

  // Specifically identify the 11 × 11 × 30 m tower shaft mesh and the viewing terrace cornice slab
  const towerShaft = zamek.children.find((node) =>
    node.isMesh && node.geometry?.type === 'BoxGeometry' &&
    node.geometry.parameters.width === 11 && node.geometry.parameters.depth === 11 &&
    node.geometry.parameters.height === 30
  );
  assert.ok(towerShaft, 'Identified Zamek tower shaft mesh (11 × 11 × 30 m)');
  const shaftBox = new THREE.Box3().setFromObject(towerShaft);
  assert.ok(Math.abs(shaftBox.max.y - 30.0) < 0.05,
    `Tower shaft top reaches covered viewing terrace level at 30.0 m (got ${shaftBox.max.y.toFixed(2)} m)`);

  const terraceSlab = zamek.children.find((node) =>
    node.isMesh && node.geometry?.type === 'BoxGeometry' &&
    node.geometry.parameters.width === 11.8 && node.geometry.parameters.depth === 11.8 &&
    node.geometry.parameters.height === 0.6
  );
  assert.ok(terraceSlab, 'Identified viewing terrace cornice slab (11.8 × 11.8 × 0.6 m)');
  const slabBox = new THREE.Box3().setFromObject(terraceSlab);
  assert.ok(Math.abs(slabBox.min.y - 30.0) < 0.05,
    `Viewing terrace cornice slab base is at 30.0 m (got ${slabBox.min.y.toFixed(2)} m)`);

  // Tower shaft collider (11 × 11 m footprint, local half-extents hx = hz = 5.5 m) on Zamek site specifically has maxY = 30.0 m
  const zamekSite = LANDMARK_SITES['Zamek Królewski'];
  const zamekColliders = colliders.filter((c) => {
    const cx = (c.minX + c.maxX) * 0.5;
    const cz = (c.minZ + c.maxZ) * 0.5;
    return Math.hypot(cx - zamekSite.x, cz - zamekSite.z) < 40;
  });
  const towerCol = zamekColliders.find((c) =>
    c.obb && Math.abs(c.obb.hx - 5.5) < 0.1 && Math.abs(c.obb.hz - 5.5) < 0.1
  );
  assert.ok(towerCol, 'Identified Zamek Królewski tower shaft collider');
  assert.ok(Math.abs(towerCol.maxY - 30.0) < 0.1,
    `Zamek Królewski tower shaft collider maxY matches 30.0 m (got ${towerCol.maxY})`);
});

test('Teatr Wielki: stage fly tower corrected to 31.7 m from GUGiK NMPT − NMT', () => {
  const centrumSource = readFileSync(join(__dirname, '../js/landmarks-centrum.js'), 'utf8');
  const centrum = loadModule(centrumSource, {
    imports: {
      'three/webgpu': THREE,
      './landmark-kit.js': kit
    },
    globals: { Math, console }
  });

  const group = new THREE.Group();
  const colliders = [];
  centrum.buildCentrumLandmarks({ group, colliders, M });

  const teatr = findBySite(group, 'Teatr Wielki');
  const box = new THREE.Box3().setFromObject(teatr);
  const height = box.max.y - box.min.y;

  assert.ok(Math.abs(height - 31.7) < 0.1, `Teatr Wielki height ${height.toFixed(2)} m should be 31.7 m`);
  assert.ok(Math.abs(box.max.y - 31.7) < 0.1,
    `Teatr Wielki fly-tower ridge ${box.max.y.toFixed(2)} m should be 31.7 m`);

  // Fly tower body rises from the 22 m stage house to 26.5 m, under a 5.2 m gable roof with the ridge along local z
  const flyTower = teatr.children.find((node) =>
    node.isMesh && node.geometry?.type === 'BoxGeometry' &&
    node.geometry.parameters.width === 26 && node.geometry.parameters.depth === 21 &&
    node.geometry.parameters.height === 4.5
  );
  assert.ok(flyTower, 'Identified Teatr Wielki fly tower body (26 × 4.5 × 21 m)');
  const flyBox = new THREE.Box3().setFromObject(flyTower);
  assert.ok(Math.abs(flyBox.min.y - 22.0) < 0.05,
    `Fly tower starts at stage-house eaves 22.0 m (got ${flyBox.min.y.toFixed(2)} m)`);
  assert.ok(Math.abs(flyBox.max.y - 26.5) < 0.05, `Fly tower eaves ${flyBox.max.y.toFixed(2)} m should be 26.5 m`);
});

test('Fara and Novotel: sourced heights retained (40.0 m and 68.0 m)', () => {
  const heritageSource = readFileSync(join(__dirname, '../js/landmarks-heritage.js'), 'utf8');
  const heritage = loadModule(heritageSource, {
    imports: {
      'three/webgpu': THREE,
      './landmark-kit.js': kit,
      './city-config.js': cityConfig
    },
    globals: { Math, console }
  });
  const heritageGroup = new THREE.Group();
  heritage.buildHeritageLandmarks({ group: heritageGroup, colliders: [], M });
  const fara = findBySite(heritageGroup, 'Fara');
  const faraBox = new THREE.Box3().setFromObject(fara);
  // The authored 37 m nave ridge sits under the 40 m overall top (the rear gable/attic); fitToSite scales the 40.8 m
  // pediment statue down with the rest, so the ridge renders at ~36.3 m. The old 40 m ridge rendered at ~39.2 m.
  assert.ok(Math.abs(faraBox.max.y - 40.0) < 0.1, 'Fara tops out at 40.0 m');
  let ridgeTop = 0;
  fara.traverse((node) => {
    if (node.isMesh && node.material === M.tileRed) {
      ridgeTop = Math.max(ridgeTop, new THREE.Box3().setFromObject(node).max.y);
    }
  });
  assert.ok(ridgeTop > 36.0 && ridgeTop < 37.2, `Fara nave ridge ${ridgeTop.toFixed(2)} m should be about 37 m`);

  const towersSource = readFileSync(join(__dirname, '../js/landmarks-towers.js'), 'utf8');
  const towers = loadModule(towersSource, {
    imports: {
      'three/webgpu': THREE,
      './landmark-kit.js': kit
    },
    globals: { Math, console }
  });
  const towersGroup = new THREE.Group();
  towers.buildTowerLandmarks({ group: towersGroup, colliders: [], M });
  const novotel = findBySite(towersGroup, 'Novotel');
  assert.ok(Math.abs(new THREE.Box3().setFromObject(novotel).max.y - 68.0) < 0.1, 'Novotel tops out at 68.0 m');
});

test('Unchanged landmarks retain accurate heights selected by site', () => {
  const cityClock = require('../js/city-clock.js');
  const rynekSource = readFileSync(join(__dirname, '../js/landmarks-rynek.js'), 'utf8');
  const rynek = loadModule(rynekSource, {
    imports: {
      'three/webgpu': THREE,
      './landmark-kit.js': kit,
      './city-clock.js': cityClock
    },
    globals: { Math, console }
  });

  const rynekGroup = new THREE.Group();
  rynek.buildRynekLandmarks({ group: rynekGroup, colliders: [], M, dynamic: new THREE.Group() });
  const ratusz = findBySite(rynekGroup, 'Ratusz');
  const ratuszBox = new THREE.Box3().setFromObject(ratusz);
  assert.ok(Math.abs(ratuszBox.max.y - 61.0) < 0.1, `Ratusz tower top ${ratuszBox.max.y.toFixed(2)} m matches 61.0 m`);

  const towersSource = readFileSync(join(__dirname, '../js/landmarks-towers.js'), 'utf8');
  const towers = loadModule(towersSource, {
    imports: {
      'three/webgpu': THREE,
      './landmark-kit.js': kit
    },
    globals: { Math, console }
  });

  const towersGroup = new THREE.Group();
  towers.buildTowerLandmarks({ group: towersGroup, colliders: [], M });

  const baltyk = findBySite(towersGroup, 'Bałtyk');
  const baltykBox = new THREE.Box3().setFromObject(baltyk);
  assert.ok(Math.abs(baltykBox.max.y - 67.0) < 0.1, `Bałtyk top ${baltykBox.max.y.toFixed(2)} m matches 67.0 m`);

  const altum = findBySite(towersGroup, 'Collegium Altum');
  const altumBox = new THREE.Box3().setFromObject(altum);
  assert.ok(Math.abs(altumBox.max.y - 103.35) < 0.1, `Altum mast tip ${altumBox.max.y.toFixed(2)} m matches 103.35 m`);

  const andersia = findBySite(towersGroup, 'Andersia');
  const andersiaBox = new THREE.Box3().setFromObject(andersia);
  assert.ok(Math.abs(andersiaBox.max.y - 102.1) < 0.1, `Andersia top ${andersiaBox.max.y.toFixed(2)} m matches 102.1 m`);

  const pfc = findBySite(towersGroup, 'Poznań Financial Centre');
  const pfcBox = new THREE.Box3().setFromObject(pfc);
  assert.ok(Math.abs(pfcBox.max.y - 91.0) < 0.1, `PFC top ${pfcBox.max.y.toFixed(2)} m matches 91.0 m`);

  const and2 = findBySite(towersGroup, 'AND2');
  const and2Box = new THREE.Box3().setFromObject(and2);
  assert.ok(Math.abs(and2Box.max.y - 116.0) < 0.1, `AND2 top ${and2Box.max.y.toFixed(2)} m matches 116.0 m`);
});
