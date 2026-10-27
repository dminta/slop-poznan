const assert = require('node:assert/strict');
const test = require('node:test');

test('map text helpers fold Polish letters, sort and upper-case in Polish', async () => {
  const { foldText, compareNames, mapCaps, formatCount, LABEL_ALIAS } = await import('../js/city-config.js');
  assert.equal(foldText('Święty Marcin'), 'swiety marcin');
  assert.equal(foldText('Łazarz, Głogowska'), 'lazarz, glogowska');
  assert.equal(foldText('Żeromskiego ŹRÓDŁO'), 'zeromskiego zrodlo');
  assert.equal(foldText('Broadway'), 'broadway');
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
