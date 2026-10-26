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
