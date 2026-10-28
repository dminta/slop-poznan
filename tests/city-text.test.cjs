const assert = require('node:assert/strict');
const { readdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

test('numbers in the UI are formatted in Polish, never in the browser locale', () => {
  const dir = join(__dirname, '../js');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const src = readFileSync(join(dir, file), 'utf8');
    assert.doesNotMatch(src, /\.toLocaleString\(\s*\)/, `${file}: use formatCount (city-config.js)`);
  }
});

test('map text helpers fold Polish letters, sort and upper-case in Polish', async () => {
  const { foldText, compareNames, mapCaps, formatCount, LABEL_ALIAS } = await import('../js/city-config.js');
  assert.equal(foldText('Święty Marcin'), 'swiety marcin');
  assert.equal(foldText('Łazarz, Głogowska'), 'lazarz, glogowska');
  assert.equal(foldText('Żeromskiego ŹRÓDŁO'), 'zeromskiego zrodlo');
  assert.equal(foldText('Garbary'), 'garbary');
  const sorted = ['Żabikowo', 'Łazarz', 'Zielona', 'Lipowa', 'Śródka', 'Sołacz', 'Ogrody', 'Ostrów Tumski']
    .sort(compareNames);
  assert.deepEqual(sorted, ['Lipowa', 'Łazarz', 'Ogrody', 'Ostrów Tumski', 'Sołacz', 'Śródka', 'Zielona', 'Żabikowo']);
  assert.equal(mapCaps('Stare Miasto · Śródka'), 'STARE MIASTO · ŚRÓDKA');
  // Polish digit grouping (a narrow no-break space)
  assert.equal(formatCount(12345).replace(/\s/g, ' '), '12 345');
  assert.deepEqual(LABEL_ALIAS, {});
});

test('every landmark site has a map pin, and the location label names the nearest one', async () => {
  const { CITY_LANDMARKS, LANDMARK_SITES, getLocationLabel } = await import('../js/city-config.js');
  const pinned = new Map(CITY_LANDMARKS.map((l) => [`${l.x},${l.z}`, l]));
  for (const [name, s] of Object.entries(LANDMARK_SITES)) {
    const lm = pinned.get(`${s.x},${s.z}`);
    assert.ok(lm, `${name} has no map pin`);
    assert.ok(getLocationLabel(s.x, s.z).startsWith(lm.name), `standing at ${name} names ${lm.name}`);
  }
  assert.equal(new Set(CITY_LANDMARKS.map((l) => l.id)).size, CITY_LANDMARKS.length, 'pin ids are unique');
  // Domki Budnicze stand 46 m from the Ratusz: the nearer one wins, not the first in the list
  const domki = LANDMARK_SITES['Domki Budnicze'];
  assert.match(getLocationLabel(domki.x, domki.z), /^Domki Budnicze/);
});

test('the location label joins two streets with a separator no road or landmark name contains', async () => {
  const { ROADS, CITY_LANDMARKS, STREET_JOIN, getLocationLabel } = await import('../js/city-config.js');
  // OSM has names with " & " ("Kiss & Ride" by the Dworzec), so that can't be the join
  assert.ok(ROADS.some((r) => r.name && r.name.includes(' & ')), 'the data still has a name with " & "');
  for (const r of ROADS) if (r.name) assert.ok(!r.name.includes(STREET_JOIN), `road ${r.name}`);
  for (const l of CITY_LANDMARKS) assert.ok(!l.name.includes(STREET_JOIN), `landmark ${l.name}`);
  // along the Kiss & Ride lane: splitting a crossing's label on the join gives whole road names
  const kiss = ROADS.find((r) => r.name === 'Kiss & Ride');
  const names = new Set(ROADS.map((r) => r.name));
  let joined = 0;
  for (const p of kiss.pts) {
    const label = getLocationLabel(p.x, p.z);
    const streets = label.includes(' · ') ? label.slice(label.indexOf(' · ') + 3) : label;
    if (!streets.includes(STREET_JOIN)) continue;
    joined++;
    for (const n of streets.split(STREET_JOIN)) assert.ok(names.has(n), `${label}: "${n}" is a road name`);
  }
  assert.ok(joined > 0, 'some point of the Kiss & Ride lane is at a crossing');
});
