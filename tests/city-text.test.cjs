const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '../js/city-config.js'), 'utf8');

// prettyName with its tables, cut out of city-config.js and run against a stub GEO of the given version
function prettyNameFor(version) {
  const grab = (re) => {
    const match = re.exec(source);
    assert.ok(match, `city-config.js no longer matches ${re}`);
    return match[0];
  };
  const code = [/function ordinal\([\s\S]*?\n}\n/, /const PRETTY = \{[\s\S]*?\n};\n/, /function prettyName\([\s\S]*?\n}\n/]
    .map(grab).join('');
  return vm.runInNewContext(`${code}prettyName`, { GEO: { version } });
}

test('prettyName title-cases v1 names, Unicode letters included', () => {
  const prettyName = prettyNameFor(1);
  assert.equal(prettyName('W 42 ST'), 'W 42nd St');
  assert.equal(prettyName('AVE OF THE AMERICAS'), '6th Ave');
  assert.equal(prettyName('BROADWAY'), 'Broadway');
  assert.equal(prettyName("O'NEIL  AVE"), "O'Neil Ave");
  assert.equal(prettyName('E 125 ST'), 'E 125th St');
  assert.equal(prettyName('ST MARKS PL'), 'St Marks Pl');
  assert.equal(prettyName('ŚWIĘTY MARCIN'), 'Święty Marcin');
  assert.equal(prettyName('ULICA ŁĄKOWA'), 'Ulica Łąkowa');
});

test('prettyName keeps v2 display names as they are', () => {
  const prettyName = prettyNameFor(2);
  assert.equal(prettyName('Święty Marcin'), 'Święty Marcin');
  assert.equal(prettyName('al. Niepodległości'), 'al. Niepodległości');
});

test('map text helpers fold Polish letters, sort and upper-case in Polish', async () => {
  const { foldText, compareNames, mapCaps, formatCount, AREA_LABELS, LABEL_ALIAS } = await import('../js/city-config.js');
  assert.equal(foldText('Święty Marcin'), 'swiety marcin');
  assert.equal(foldText('Łazarz, Głogowska'), 'lazarz, glogowska');
  assert.equal(foldText('Żeromskiego ŹRÓDŁO'), 'zeromskiego zrodlo');
  assert.equal(foldText('Broadway'), 'broadway');
  const sorted = ['Żabikowo', 'Łazarz', 'Zielona', 'Lipowa', 'Śródka', 'Sołacz', 'Ogrody', 'Ostrów Tumski']
    .sort(compareNames);
  assert.deepEqual(sorted, ['Lipowa', 'Łazarz', 'Ogrody', 'Ostrów Tumski', 'Sołacz', 'Śródka', 'Zielona', 'Żabikowo']);
  assert.equal(mapCaps('Stare Miasto · Śródka'), 'STARE MIASTO · ŚRÓDKA');
  // New York (geodata v1) keeps its tables and US digit grouping
  assert.equal(formatCount(12345), '12,345');
  assert.ok(AREA_LABELS.some(([name]) => name === 'MANHATTAN'));
  assert.equal(LABEL_ALIAS['Franklin D Roosevelt Dr'], 'FDR Drive');
});
