const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const source = readFileSync(join(__dirname, '../js/traffic.js'), 'utf8');
const start = source.indexOf('  function protectTramFollower(');
const end = source.indexOf('\n  function occupyTrams()', start);
assert.ok(start >= 0 && end > start, 'follower helper markers exist');
const protect = new Function(`${source.slice(start, end)}\nreturn protectTramFollower;`)();

function car(speed = 5) {
  return { half: 2, speed, driver: { b: 2, T: 1, s0: 2 }, _tramFollowGap: Infinity, conn: null };
}

function tram(speed = 1) {
  const t = { speed };
  t._followerProxy = { tram: t, speed: 0 };
  return t;
}

test('only the nearest car behind the tram follows its private leader', () => {
  const t = tram();
  const obstacle = car();
  const near = car();
  const far = car();
  protect(t, [{ v: far, s: 5 }, { v: near, s: 12 }, { v: obstacle, s: 30 }], obstacle, 20);
  assert.equal(near._tramFollowGap, 6);
  assert.equal(near._tramFollow.tram, t);
  assert.equal(near._tramFollow.speed, 1);
  assert.equal(far._tramFollowGap, Infinity);
  assert.equal(obstacle._tramFollowGap, Infinity);
});

test('the virtual leader is bounded by braking reach and ignores connector or overlapping cars', () => {
  const t = tram();
  const obstacle = car();
  const distant = car(1);
  protect(t, [{ v: distant, s: 5 }, { v: obstacle, s: 30 }], obstacle, 20);
  assert.equal(distant._tramFollowGap, Infinity);
  const connector = car();
  connector.conn = {};
  const overlap = car();
  protect(t, [{ v: connector, s: 15 }, { v: overlap, s: 19 }, { v: obstacle, s: 30 }], obstacle, 20);
  assert.equal(connector._tramFollowGap, Infinity);
  assert.equal(overlap._tramFollowGap, Infinity);
});

test('the closer of multiple tram leaders is retained', () => {
  const v = car(10);
  const obstacle = car();
  const first = tram(2);
  const second = tram(3);
  const list = [{ v, s: 10 }, { v: obstacle, s: 40 }];
  protect(first, list, obstacle, 25);
  protect(second, list, obstacle, 23);
  protect(first, list, obstacle, 27);
  assert.equal(v._tramFollowGap, 11);
  assert.equal(v._tramFollow.tram, second);
});
