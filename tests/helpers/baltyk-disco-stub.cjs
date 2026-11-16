// The Bałtyk party's TSL materials need a renderer; tests that only build the tower's geometry get this stand-in with
// the same shape: a group in the room frame and a no-op update
const { THREE } = require('./three-stub.cjs');

function createBaltykDisco({ room }) {
  const group = new THREE.Group();
  group.userData.room = room;
  return { group, update() {} };
}

module.exports = { createBaltykDisco };
