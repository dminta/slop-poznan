// js/static-matrices.js
// The city is built once and almost nothing in it moves: 41k meshes, of which only the player's models, the traffic and
// tram light rigs, the animated Ratusz goats and the street/store light pools change their transforms. three.js would
// still walk the whole scene graph and recompute the same world matrices in every render pass, which measured 18.4% of
// the frame CPU in the 2026-11-11 older-device audit. This module freezes that walk after the build and updates an
// explicit list of dynamic roots each frame instead (see docs/rendering.md, "Static and dynamic transforms").
//
// The registry is explicit on purpose: a static root that starts moving without being listed here freezes in place. Any
// new runtime transform must be owned by one of these roots (or added to collectDynamicRoots), never by a bare child of
// the frozen scene.

// The roots that change locally or in their subtree at runtime. `scene.getObjectByName` keeps the list readable: a
// missing root (a reduced build, a test harness) is simply skipped.
function collectDynamicRoots(scene, lightingSystem, controllerManager) {
  const roots = [
    // The sun and hemisphere lights are re-posed by the time presets; the sky is re-parented into the PMREM bake
    // scene on every preset change. All three are single objects, so keeping them here costs nothing.
    lightingSystem.sky,
    lightingSystem.sunLight,
    lightingSystem.hemiLight,
    // The Ratusz goats and the doors they walk through (landmarks.js builds them outside the culled static root).
    scene.getObjectByName('LandmarksDynamic'),
    // Pooled spot/point lights are re-posed from a fixed site list every frame; their targets need their world
    // matrices for the light direction (street-details.js, buildings.js).
    scene.getObjectByName('StoreClusteredLights'),
    scene.getObjectByName('StreetClusteredLights'),
    // Vehicles, pedestrians and their light pools: the instanced meshes only rewrite instanceMatrix, but the pooled
    // headlights and emergency lights move their own (and their targets') transforms every frame.
    scene.getObjectByName('TrafficAndPedestrians'),
    scene.getObjectByName('Trams')
  ];
  // The player's four entity roots move, turn and tilt; the cyclist's helmet is a separate scene child that rides on
  // the rig's head, and the player's skinned crowds are scene children of their own.
  for (const entity of Object.values(controllerManager.entities)) roots.push(entity.mesh);
  roots.push(controllerManager.entities.cyclist.helmet);
  roots.push(...controllerManager.entities.person.crowd.meshes);
  roots.push(...controllerManager.entities.cyclist.riderCrowd.meshes);
  return roots.filter(Boolean);
}

// Records the current world matrices, then stops three.js from recomputing them in every render (main.js calls this
// once after the city, culling and the player entities are built, before the first compiled frame).
function freezeStaticMatrices(scene, dynamicRoots) {
  scene.updateMatrixWorld(true);
  scene.matrixWorldAutoUpdate = false;
  return dynamicRoots;
}

// Recomputes only the roots that move (main.js runs this last in the frame, before renderPipeline.render()).
function updateDynamicMatrices(dynamicRoots) {
  for (let i = 0; i < dynamicRoots.length; i++) dynamicRoots[i].updateMatrixWorld(true);
}

export { collectDynamicRoots, freezeStaticMatrices, updateDynamicMatrices };
