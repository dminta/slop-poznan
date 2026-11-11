const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const source = readFileSync(join(__dirname, '../js/graphics-quality.js'), 'utf8');
const quality = loadModule(source, { filename: 'graphics-quality.js' });
const {
  GRAPHICS_QUALITY_KEY, QUALITY_TIERS, normaliseQuality, isTouchFirstDevice, detectQuality, resolveQuality,
  clearStoredQuality
} = quality;

test('a touch-first phone or tablet starts low but a touch laptop with a fine pointer stays high', () => {
  assert.equal(isTouchFirstDevice({ coarsePointer: true, finePointer: false }), true);
  assert.equal(isTouchFirstDevice({ coarsePointer: true, finePointer: true }), false, 'a mouse or trackpad keeps high');
  assert.equal(isTouchFirstDevice({ coarsePointer: false, finePointer: true }), false);
  assert.equal(isTouchFirstDevice({}), false);
  assert.equal(detectQuality({ coarsePointer: true, finePointer: false, hardwareConcurrency: 16 }), 'low');
  assert.equal(detectQuality({ coarsePointer: true, finePointer: true, hardwareConcurrency: 16 }), 'high');
});

test('auto-detection lowers only known weak inputs and defaults to high', () => {
  assert.equal(detectQuality({}), 'high');
  assert.equal(detectQuality({ webgl: true, hardwareConcurrency: 16, deviceMemory: 16 }), 'low');
  assert.equal(detectQuality({ hardwareConcurrency: 4 }), 'low');
  assert.equal(detectQuality({ hardwareConcurrency: 8, deviceMemory: 4 }), 'low');
  assert.equal(detectQuality({ hardwareConcurrency: 8, deviceMemory: 8 }), 'high');
  assert.equal(detectQuality({ hardwareConcurrency: undefined, deviceMemory: undefined }), 'high');
  assert.equal(detectQuality({ hardwareConcurrency: 0, deviceMemory: 0 }), 'high', 'unknown values are not weak');
});

test('?quality wins over every device default, and an invalid value falls back to it', () => {
  assert.equal(resolveQuality({ url: 'low', hardwareConcurrency: 16, deviceMemory: 16 }), 'low');
  assert.equal(resolveQuality({ url: 'high', coarsePointer: true, finePointer: false, webgl: true }), 'high');
  assert.equal(resolveQuality({ url: 'bogus', hardwareConcurrency: 4 }), 'low');
  assert.equal(resolveQuality({ url: 'bogus' }), 'high');
  assert.equal(resolveQuality({ url: null, coarsePointer: true, finePointer: false }), 'low');
});

test('the retired graphics-quality key is removed at boot and storage errors never block', () => {
  const values = new Map([[GRAPHICS_QUALITY_KEY, 'low']]);
  const storage = { removeItem: (key) => values.delete(key) };
  assert.equal(clearStoredQuality(storage), true);
  assert.equal(values.has(GRAPHICS_QUALITY_KEY), false);
  assert.equal(clearStoredQuality({ removeItem() { throw new Error('blocked'); } }), false);
  assert.equal(clearStoredQuality(null), true, 'a missing localStorage is not an error');
});

test('tier presets carry the low-tier render, shadow and population changes', () => {
  assert.equal(normaliseQuality('high'), 'high');
  assert.equal(normaliseQuality('LOW'), null);
  assert.equal(QUALITY_TIERS.low.postProcessing.ssr, false);
  assert.equal(QUALITY_TIERS.low.postProcessing.bloom, false);
  assert.equal(QUALITY_TIERS.low.pixelRatio, 0.75);
  assert.equal(QUALITY_TIERS.low.shadowMapSize, 1024);
  assert.deepEqual({ ...QUALITY_TIERS.low.shadowRange }, { start: 120, perMetre: 1.0, min: 150, max: 360 });
  assert.equal(QUALITY_TIERS.low.shadowCasters, false, 'trees, furniture, trams and the city grid stop casting');
  assert.equal(QUALITY_TIERS.high.shadowCasters, true);
  assert.ok(QUALITY_TIERS.low.population.pedestrians >= 150 && QUALITY_TIERS.low.population.pedestrians <= 200);
  assert.equal(
    QUALITY_TIERS.low.population.vehicleDensity * 2,
    QUALITY_TIERS.high.population.vehicleDensity,
    'local vehicle density is roughly halved'
  );
});
