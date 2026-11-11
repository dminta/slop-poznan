const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const source = readFileSync(join(__dirname, '../js/graphics-quality.js'), 'utf8');
const quality = loadModule(source, { filename: 'graphics-quality.js' });
const {
  GRAPHICS_QUALITY_KEY, QUALITY_TIERS, WATCHDOG_FRAME_CAP, normaliseQuality, detectQuality,
  resolveQuality, readStoredQuality, storeQuality, accumulateLowSeconds, shouldAutoDowngrade
} = quality;

test('auto-detection lowers only known weak inputs and defaults to high', () => {
  assert.equal(detectQuality({}), 'high');
  assert.equal(detectQuality({ webgl: true, hardwareConcurrency: 16, deviceMemory: 16 }), 'low');
  assert.equal(detectQuality({ hardwareConcurrency: 4 }), 'low');
  assert.equal(detectQuality({ hardwareConcurrency: 8, deviceMemory: 4 }), 'low');
  assert.equal(detectQuality({ hardwareConcurrency: 8, deviceMemory: 8 }), 'high');
  assert.equal(detectQuality({ hardwareConcurrency: undefined, deviceMemory: undefined }), 'high');
  assert.equal(detectQuality({ hardwareConcurrency: 0, deviceMemory: 0 }), 'high', 'unknown values are not weak');
});

test('a stored or URL choice overrides auto-detection', () => {
  assert.deepEqual(
    { ...resolveQuality({ stored: 'high', hardwareConcurrency: 2 }) },
    { tier: 'high', source: 'stored' }
  );
  assert.deepEqual(
    { ...resolveQuality({ url: 'low', stored: 'high', hardwareConcurrency: 16 }) },
    { tier: 'low', source: 'url' }
  );
  assert.deepEqual(
    { ...resolveQuality({ stored: 'bogus', hardwareConcurrency: 4 }) },
    { tier: 'low', source: 'auto' }
  );
  assert.deepEqual({ ...resolveQuality({ url: 'bogus' }) }, { tier: 'high', source: 'auto' });
});

test('the graphics-quality key stores only high or low and survives unavailable storage', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };
  assert.equal(storeQuality('low', storage), true);
  assert.equal(values.get(GRAPHICS_QUALITY_KEY), 'low');
  assert.equal(readStoredQuality(storage), 'low');
  assert.equal(storeQuality('bogus', storage), false);
  assert.equal(readStoredQuality(storage), 'low');
  assert.equal(readStoredQuality({ getItem() { throw new Error('blocked'); } }), null);
  assert.equal(storeQuality('high', { setItem() { throw new Error('quota'); } }), false);
  assert.equal(readStoredQuality(null), null, 'a missing localStorage is not an error');
});

test('only an auto-detected high tier can be lowered after two accumulated slow seconds', () => {
  assert.equal(shouldAutoDowngrade('high', 'auto', 2), true);
  assert.equal(shouldAutoDowngrade('high', 'auto', 1.9), false);
  assert.equal(shouldAutoDowngrade('high', 'stored', 30), false);
  assert.equal(shouldAutoDowngrade('high', 'url', 30), false);
  assert.equal(shouldAutoDowngrade('low', 'auto', 30), false);
});

test('the watchdog counts low telemetry windows, not a single long frame or a hidden tab', () => {
  let seconds = 0;
  for (let i = 0; i < 8; i++) seconds = accumulateLowSeconds(seconds, 20, 0.25, 0.016, false);
  assert.equal(seconds, 2);
  assert.equal(shouldAutoDowngrade('high', 'auto', seconds), true);

  // One 2 s shader-compile hitch (a single long frame) must reset, even after otherwise slow windows.
  assert.equal(accumulateLowSeconds(0, 0, 2.0, 2.0, false), 0);
  assert.equal(accumulateLowSeconds(1.9, 0, 2.0, 2.0, false), 0);
  assert.equal(shouldAutoDowngrade('high', 'auto', 0), false);

  // A backgrounded tab pauses rAF: neither its hidden window nor the first huge frame back counts.
  assert.equal(accumulateLowSeconds(1.9, 10, 0.25, 0.25, true), 0);
  assert.equal(accumulateLowSeconds(0, 0, 5.0, 5.0, false), 0);

  // A healthy window and an already-high-fps window reset the count.
  assert.equal(accumulateLowSeconds(1.9, 30, 0.25, 0.016, false), 0);
  assert.equal(accumulateLowSeconds(1.9, 60, 0.25, 0.016, false), 0);

  // One huge low window is capped at half a second instead of counting as several.
  assert.equal(accumulateLowSeconds(0, 20, 10, 0.016, false), WATCHDOG_FRAME_CAP);
});

test('tier presets carry the low-tier render, shadow and population changes', () => {
  assert.equal(normaliseQuality('high'), 'high');
  assert.equal(normaliseQuality('LOW'), null);
  assert.equal(QUALITY_TIERS.low.postProcessing.ssr, false);
  assert.equal(QUALITY_TIERS.low.postProcessing.bloom, false);
  assert.equal(QUALITY_TIERS.low.pixelRatio, 0.75);
  assert.equal(QUALITY_TIERS.low.shadowMapSize, 1024);
  assert.deepEqual({ ...QUALITY_TIERS.low.shadowRange }, { start: 120, perMetre: 1.0, min: 150, max: 360 });
  assert.ok(QUALITY_TIERS.low.population.pedestrians >= 150 && QUALITY_TIERS.low.population.pedestrians <= 200);
  assert.equal(
    QUALITY_TIERS.low.population.vehicleDensity * 2,
    QUALITY_TIERS.high.population.vehicleDensity,
    'local vehicle density is roughly halved'
  );
});
