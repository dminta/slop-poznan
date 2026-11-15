import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bootstrapMeanCI, compareMetric, deadlockSignature, districtKey, failures, newDeadlockPatterns, summarizeBench, summaryTable,
  verdictOf
} from '../tools/accept-stats.mjs';

const seedsOf = (values) => Object.fromEntries(values.map((v, i) => [String(i + 1), v]));

test('bootstrap interval is deterministic and brackets the mean', () => {
  const diffs = [2, 3, 1, 4, 2, 3, 5, 2];
  const a = bootstrapMeanCI(diffs);
  const b = bootstrapMeanCI(diffs);
  assert.deepEqual(a, b);
  const mean = diffs.reduce((x, y) => x + y, 0) / diffs.length;
  assert.ok(a.lo < mean && mean < a.hi);
  assert.ok(a.lo > 0, 'a consistent positive shift excludes zero');
});

test('identical trees and all-zero differences are within noise', () => {
  const c = compareMetric('pairs', 'lower', seedsOf([4, 5, 6, 3]), seedsOf([4, 5, 6, 3]));
  assert.deepEqual(c.ci, { lo: 0, hi: 0 });
  assert.equal(c.verdict, 'within noise');
});

test('noisy differences that straddle zero are within noise', () => {
  const c = compareMetric('pairs', 'lower', seedsOf([4, 9, 2, 7, 5, 3, 8, 1]), seedsOf([6, 4, 5, 5, 2, 7, 3, 4]));
  assert.equal(c.verdict, 'within noise');
});

test('clear shifts are worse or better by the metric direction', () => {
  const base = seedsOf([4, 5, 6, 3, 5, 4, 6, 5]);
  const work = seedsOf([9, 10, 10, 8, 9, 8, 11, 9]);
  assert.equal(compareMetric('pairs', 'lower', base, work).verdict, 'worse');
  assert.equal(compareMetric('pairs', 'lower', work, base).verdict, 'better');
  assert.equal(compareMetric('km/h', 'higher', work, base).verdict, 'worse');
  assert.equal(compareMetric('km/h', 'higher', base, work).verdict, 'better');
  assert.equal(verdictOf({ lo: -1, hi: 0.5 }, 'lower'), 'within noise');
  assert.equal(verdictOf({ lo: 0, hi: 2 }, 'lower'), 'within noise', 'an interval touching zero is not clear');
});

test('only seeds both trees have are paired, and a single outlier seed cannot clear the bar', () => {
  const c = compareMetric('holds', 'lower', { 1: 0, 2: 0, 3: 0, 4: 0, 9: 3 }, { 1: 0, 2: 0, 3: 0, 4: 5 });
  assert.deepEqual(c.seeds, ['1', '2', '3', '4']);
  assert.equal(c.verdict, 'within noise');
});

test('exit status fails only on clear gated regressions and new deadlock patterns', () => {
  const worse = { ...compareMetric('pairs', 'lower', seedsOf([1, 1, 1, 1]), seedsOf([5, 6, 5, 6])), gate: true };
  const info = { ...worse, name: 'km/h Wilda', gate: false };
  const calm = { ...compareMetric('holds', 'lower', seedsOf([1, 2, 1, 2]), seedsOf([1, 2, 1, 2])), gate: true };
  assert.equal(failures([calm, info], []).length, 0);
  assert.equal(failures([worse, calm], []).length, 1);
  assert.equal(failures([calm], [{ signature: 'Rataje@1,2', seeds: ['1', '2', '3'] }]).length, 1);
  assert.match(summaryTable([worse, info]), /car|pairs.*worse[\s\S]*km\/h Wilda \(info\)/);
});

test('deadlock signatures ignore vehicle ids and key on junctions', () => {
  const a = ['#12 car in box at (-1383, -214) (-1380, -210) straight', '#40 car at (-1383, -214) (-1390, -220) left'];
  const b = ['#7 car at (-1383, -214) (-1385, -216) left', '#99 car in box at (-1383, -214) (-1381, -213) straight'];
  assert.equal(deadlockSignature('Kaponiera', a), deadlockSignature('Kaponiera', b));
  assert.notEqual(deadlockSignature('Kaponiera', a), deadlockSignature('Jeżyce', a));
  assert.match(deadlockSignature('Rataje', ['tram 13 car (1100, 1430)']), /^Rataje@~1100,1450$/);
});

test('a deadlock pattern in several working seeds and no baseline seed is new', () => {
  const p = (signature) => ({ signature });
  const base = { 1: [p('A')], 2: [], 3: [], 4: [] };
  const work = { 1: [p('A'), p('B')], 2: [p('B')], 3: [p('B'), p('C')], 4: [p('A')] };
  assert.deepEqual(newDeadlockPatterns(base, work), [{ signature: 'B', seeds: ['1', '2', '3'] }]);
  assert.deepEqual(newDeadlockPatterns(base, { 1: [p('B')], 2: [p('B')], 3: [], 4: [] }), [], 'two seeds are not several');
});

test('bench reports are flattened per district', () => {
  assert.equal(districtKey('Rondo Kaponiera'), 'Kaponiera');
  assert.equal(districtKey('Stare Miasto'), 'Stare Miasto');
  assert.equal(districtKey('Jeżyce (Rynek Jeżycki)'), 'Jeżyce');
  const s = summarizeBench({
    districts: [
      { district: 'Rondo Kaponiera', meanKmh: 12.5, deadlockDetails: [{ members: ['#1 car at (1, 2) (3, 4) left'] }] },
      { district: 'Wilda', meanKmh: 16, deadlockDetails: [] }
    ],
    total: { held120: 3, deadlocks: 1, waitMax: 140, meanKmh: 14 }
  });
  assert.deepEqual(s.kmh, { Kaponiera: 12.5, Wilda: 16 });
  assert.equal(s.holds120, 3);
  assert.equal(s.deadlockPatterns[0].signature, 'Kaponiera@1,2');
});
