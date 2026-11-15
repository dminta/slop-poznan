const assert = require('node:assert/strict');
const test = require('node:test');
const { auditBridgeParapets } = require('./helpers/bridge-parapets.cjs');

// docs/observations/bridge-parapets-2026-11-15.md: bridge parapets, overpass balustrade panels and lamp posts against the
// 3.6 m car lane envelopes of the painted network (tools/audit-bridge-parapets.mjs)
let result;
test.before(() => {
  result = auditBridgeParapets();
});

test('no bridge balustrade or lamp post stands on a Krzywoustego lane, and the balustrade is still there', () => {
  const k = result.rows.filter((r) => /Krzywoustego/.test(r.name || ''));
  assert.deepEqual(k, [], 'Krzywoustego members on a lane');
  // 2026-11-15: 528 panels and 40 lamps follow both curved carriageways in eight straight sections (521 / 40 on the old
  // straight chord, 166 / 13 of them on the lanes)
  const m = result.membersByBridge['Bolesława Krzywoustego'];
  assert.ok(m.panel >= 500 && m.lamp >= 38, `Krzywoustego keeps its balustrade (${JSON.stringify(m)})`);
  assert.equal(result.structures.filter((s) => s.name === 'Bolesława Krzywoustego').length, 10);
});

test('bridge parapets and lamps keep out of car lanes city-wide, except the Dworcowa slip road mouth', () => {
  // The residual is at junctions the network merges: off Most Uniwersytecki it moves the Dworcowa mouth 11 m west of
  // the slip road's own node, so a turning curve crosses its gore-side balustrade (1.94 m deep over 4.8 m) at (-1423.5,
  // 122.7); Most Dworcowy's turning curve grazes one rail by 0.07 m at (-1363.1, 614.5). Before the fix: 210 members
  // (15 lamps) and 32 colliders.
  const residual = result.rows.map((r) => `${r.name}:${r.type}`).sort();
  assert.deepEqual(residual, ['Dworcowa:panel', 'Dworcowa:panel', 'Dworcowa:parapet', 'Most Dworcowy:parapet']);
  assert.ok(result.rows.every((r) => r.curve), 'the residual is on junction turning curves only');
  assert.ok(result.rows.find((r) => r.name === 'Most Dworcowy').depth <= 0.07);
  assert.equal(result.rows.filter((r) => r.type === 'lamp').length, 0, 'no lamp post on a lane');
  assert.equal(result.colliderRows.length, 2, 'parapet colliders on a lane (the same two pieces)');
});
