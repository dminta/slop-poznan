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

test('every mapped landmark site has a pin, and the location label names the nearest one', async () => {
  const { CITY_LANDMARKS, LANDMARK_SITES, getLocationLabel } = await import('../js/city-config.js');
  const pinned = new Map(CITY_LANDMARKS.map((l) => [`${l.x},${l.z}`, l]));
  for (const [name, s] of Object.entries(LANDMARK_SITES)) {
    // Piotrowo is deliberately model-only: the user requested no new map/UI entries.
    if (s.map === false) {
      assert.ok(!pinned.has(`${s.x},${s.z}`), `${name} stays absent from the map`);
      continue;
    }
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

test('shop signs and billboards have short single names without combined " · " slogans, with at least 20 shop themes', () => {
  const src = readFileSync(join(__dirname, '../js/buildings.js'), 'utf8');
  const match = src.match(/const signThemes = (\[[\s\S]*?\]);/);
  assert.ok(match, 'signThemes found');
  const texts = [...match[1].matchAll(/text:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.ok(texts.length >= 20, `expected at least 20 shop sign names, got ${texts.length}`);
  const unique = new Set(texts);
  assert.ok(unique.size >= 20, `expected at least 20 unique shop sign names, got ${unique.size}`);
  for (const t of texts) {
    assert.doesNotMatch(t, / · /, `shop sign "${t}" should not contain " · "`);
    assert.ok(!t.includes('&'), `shop sign "${t}" should not contain "&"`);
    assert.ok(!t.includes('/'), `shop sign "${t}" should not contain "/"`);
    assert.ok(!t.includes(','), `shop sign "${t}" should not contain ","`);
    assert.doesNotMatch(t, /\bOD \d{4}/, `shop sign "${t}" should not contain "OD YYYY"`);
    assert.ok(t.length <= 16, `shop sign "${t}" should be at most 16 characters (got ${t.length})`);
  }
  const wrapMatch = src.match(/const wrapThemes = \[([\s\S]*?)\]\.slice/);
  if (wrapMatch) {
    const wrapLines = [...wrapMatch[1].matchAll(/lines:\s*\[([^\]]+)\]/g)].flatMap((m) =>
      [...m[1].matchAll(/'([^']+)'/g)].map((lm) => lm[1])
    );
    for (const line of wrapLines) {
      assert.doesNotMatch(line, / · /, `billboard line "${line}" should not contain " · "`);
      assert.ok(!line.includes('&'), `billboard line "${line}" should not contain "&"`);
      assert.ok(!line.includes('/'), `billboard line "${line}" should not contain "/"`);
      assert.ok(!line.includes(','), `billboard line "${line}" should not contain ","`);
      assert.doesNotMatch(line, /\bOD \d{4}/, `billboard line "${line}" should not contain "OD YYYY"`);
      assert.ok(line.length <= 16, `billboard line "${line}" should be at most 16 characters (got ${line.length})`);
    }
  }
});

test('water location labels use "w pobliżu:" when near a street, without ungrammatical cases', async () => {
  const { getLocationLabel, isWater } = await import('../js/city-config.js');
  assert.equal(isWater(740, -200), true);
  const label = getLocationLabel(740, -200);
  assert.ok(label.startsWith('Warta · w pobliżu: '), `expected label to start with "Warta · w pobliżu: ", got "${label}"`);
  assert.doesNotMatch(label, /\b(obok|near|przy)\b/);
});
