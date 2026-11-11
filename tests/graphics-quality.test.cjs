const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const source = readFileSync(join(__dirname, '../js/graphics-quality.js'), 'utf8');
const quality = loadModule(source, { filename: 'graphics-quality.js' });
const {
  GRAPHICS_QUALITY_KEY, QUALITY_TIERS, normaliseQuality, isTouchFirstDevice, classifyGpu, detectQuality,
  resolveQuality, resolveQualityDecision, clearStoredQuality
} = quality;

function assertGpu(gpu, expectedQuality, expectedModel) {
  const result = classifyGpu(gpu);
  assert.ok(result, `expected a classification for ${JSON.stringify(gpu)}`);
  assert.equal(result.quality, expectedQuality, JSON.stringify(gpu));
  assert.equal(result.model, expectedModel, JSON.stringify(gpu));
}

function assertDecision(device, expectedQuality, expectedReason) {
  const result = resolveQualityDecision(device);
  assert.equal(result.quality, expectedQuality, JSON.stringify(device));
  assert.equal(result.reason, expectedReason, JSON.stringify(device));
}

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

test('GPU identity recognises Apple silicon and the A14 generation boundary', () => {
  const cases = [
    ['ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)', 'high', 'apple-m1'],
    ['ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)', 'high', 'apple-m2'],
    ['ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Max, Unspecified Version)', 'high', 'apple-m3'],
    ['ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Pro, Unspecified Version)', 'high', 'apple-m5'],
    ['Apple A12X Bionic GPU', 'low', 'apple-a12'],
    ['Apple A15 GPU', 'high', 'apple-a15'],
    ['Apple A17 Pro GPU', 'high', 'apple-a17']
  ];
  for (const [renderer, expectedQuality, expectedModel] of cases) {
    assertGpu({ renderer }, expectedQuality, expectedModel);
  }
});

test('GPU identity separates integrated/old desktop parts from recent discrete ones', () => {
  const cases = [
    ['ANGLE (Intel, Intel(R) HD Graphics 620 (0x00005916) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'low', 'intel-hd-620'],
    ['ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E9B) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'low', 'intel-uhd-630'],
    ['ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'low', 'intel-iris-xe'],
    ['ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics (0x000056A0) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'high', 'intel-arc-a770'],
    ['ANGLE (Intel, Intel(R) Arc(TM) A770M Graphics, D3D11)', 'high', 'intel-arc-a770m'],
    ['ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'low', 'amd-integrated'],
    ['ANGLE (AMD, AMD Radeon(TM) Vega 8 Graphics (0x000015D8) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'low', 'amd-integrated'],
    ['ANGLE (AMD, AMD Radeon 780M Graphics, D3D11)', 'low', 'amd-integrated'],
    ['ANGLE (AMD, AMD Radeon 560X Series Direct3D11 vs_5_0 ps_5_0, D3D11)', 'low', 'amd-integrated'],
    ['ANGLE (AMD, AMD Radeon HD 620 Series Direct3D11 vs_5_0 ps_5_0, D3D11)', 'low', 'radeon-hd-620'],
    ['ANGLE (AMD, AMD Radeon RX 6600 (0x000073FF) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'high', 'radeon-rx-6600'],
    ['ANGLE (ATI Technologies Inc., AMD Radeon Pro 5500M OpenGL Engine, OpenGL 4.1)', 'high', 'radeon-pro-5500m'],
    ['ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 (0x00001F91) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'high', 'gtx-1650'],
    ['ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'high', 'rtx-3060'],
    ['ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 (0x00002684) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'high', 'rtx-4090'],
    ['ANGLE (NVIDIA, NVIDIA GeForce MX450 (0x00001F97) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'low', 'geforce-mx450']
  ];
  for (const [renderer, expectedQuality, expectedModel] of cases) {
    assertGpu({ renderer }, expectedQuality, expectedModel);
  }
});

test('GPU identity covers mobile classes and software renderers', () => {
  const cases = [
    ['Mali-G52', 'low', 'mali-g52'],
    ['Mali-G78 MC14', 'low', 'mali-g78'],
    ['Mali-G710 MC10', 'high', 'mali-g710'],
    ['Mali-G715-Immortalis', 'high', 'mali-g715'],
    ['Adreno (TM) 610', 'low', 'adreno-610'],
    ['Adreno (TM) 650', 'low', 'adreno-650'],
    ['Adreno (TM) 740', 'high', 'adreno-740'],
    ['Adreno 642L', 'low', 'adreno-642l'],
    ['PowerVR Rogue GE8320', 'low', 'powervr'],
    ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', 'low', 'swiftshader'],
    ['Google SwiftShader', 'low', 'swiftshader'],
    ['Mesa/X.org llvmpipe (LLVM 15.0.7, 256 bits)', 'low', 'llvmpipe'],
    ['ANGLE (Mesa, llvmpipe (LLVM 15.0.7, 256 bits), OpenGL 4.5)', 'low', 'llvmpipe']
  ];
  for (const [renderer, expectedQuality, expectedModel] of cases) {
    assertGpu({ renderer }, expectedQuality, expectedModel);
  }
});

test('GPU identity reads WebGPU adapter fields and treats masked/empty strings as unknown', () => {
  assertGpu({ vendor: 'apple', architecture: 'apple-m1' }, 'high', 'apple-m1');
  assertGpu({ vendor: 'apple', architecture: 'apple-a13' }, 'low', 'apple-a13');
  assertGpu({ vendor: 'apple', architecture: 'metal-3', description: 'Apple M1' }, 'high', 'apple-m1');
  // A desktop family alone is ambiguous (turing/ampere also cover the MX parts), so it stays unknown.
  assert.equal(classifyGpu({ vendor: 'nvidia', architecture: 'ampere' }), null);
  assert.equal(classifyGpu({ vendor: 'amd', architecture: 'rdna-3' }), null);
  assertGpu({ vendor: 'intel', architecture: 'gen-12lp' }, 'low', 'intel-integrated');
  assertGpu({ vendor: 'arm', architecture: 'mali-g78' }, 'low', 'mali-g78');
  assertGpu({ vendor: 'qualcomm', architecture: 'adreno-6xx' }, 'low', 'adreno-6xx');
  assertGpu({ isFallbackAdapter: true }, 'low', 'fallback');
  // Arc must win over the generic Intel integrated rule; an RDNA2 iGPU must stay integrated.
  assertGpu({
    vendor: 'intel',
    architecture: 'xe-hpg',
    renderer: 'ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics, D3D11)'
  }, 'high', 'intel-arc-a770');
  assertGpu({
    vendor: 'amd',
    architecture: 'rdna-2',
    renderer: 'ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638), D3D11)'
  }, 'low', 'amd-integrated');
  // A hybrid mismatch is conservative: a weak source lowers even when the other source names a strong GPU.
  assertGpu({
    vendor: 'intel',
    architecture: 'gen-12lp',
    renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060, D3D11)'
  }, 'low', 'intel-integrated');
  // Turing in the adapter table does not make an entry-level MX laptop strong.
  assertGpu({
    vendor: 'nvidia',
    architecture: 'turing',
    renderer: 'ANGLE (NVIDIA, NVIDIA GeForce MX450, D3D11)'
  }, 'low', 'geforce-mx450');
  // Safari reports only vendor "apple" and WebGL "Apple GPU"; the model is hidden, so this is not a guess.
  assert.equal(classifyGpu({ vendor: 'apple', architecture: 'metal-3', renderer: 'Apple GPU' }), null);
  assert.equal(classifyGpu({ vendor: 'apple', architecture: 'metal-3' }), null);
  assert.equal(classifyGpu({}), null);
  assert.equal(classifyGpu({
    vendor: '', architecture: '', device: '', description: '', rendererVendor: '', renderer: ''
  }), null);
});

test('quality reasons name the GPU, backend, CPU, memory or touch fallback', () => {
  const strongApple = { renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)' };
  const weakIntel = { renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630, D3D11)' };
  assertDecision({ url: 'low', gpu: { isFallbackAdapter: true } }, 'low', 'url:low');
  assertDecision({ url: 'high', webgl: true, gpu: { renderer: 'Google SwiftShader' } }, 'high', 'url:high');
  assertDecision({ gpu: { isFallbackAdapter: true } }, 'low', 'gpu:fallback');
  assertDecision({ gpu: weakIntel, hardwareConcurrency: 16 }, 'low', 'gpu:intel-uhd-630');
  assertDecision({ gpu: weakIntel, webgl: true }, 'low', 'gpu:intel-uhd-630');
  assertDecision({ gpu: strongApple, coarsePointer: true, finePointer: false }, 'high', 'gpu:apple-m1');
  assertDecision({ coarsePointer: true, finePointer: false }, 'low', 'touch:unknown-gpu');
  assertDecision({ gpu: strongApple, hardwareConcurrency: 4 }, 'low', 'cpu:4-threads');
  assertDecision({ gpu: strongApple, deviceMemory: 4 }, 'low', 'memory:4gb');
  assertDecision({ gpu: strongApple, webgl: true }, 'low', 'backend:webgl2');
  assertDecision({ webgl: true }, 'low', 'backend:webgl2');
  assertDecision({}, 'high', 'default:high');
  assertDecision({ hardwareConcurrency: 8, deviceMemory: 8 }, 'high', 'default:high');
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

test('the low tier shortens tree LOD and draw distances and merges distant draw meshes', () => {
  const high = QUALITY_TIERS.high.trees;
  const low = QUALITY_TIERS.low.trees;
  // The high tree profile is the historical look: trees.js must reproduce it exactly.
  assert.deepEqual({ ...high, maxDist: [...high.maxDist] }, {
    lodNear: 105,
    lodMid: 420,
    maxDist: [3000, 1600, 950],
    streetCutoff: 1150,
    lod1Variants: 2,
    farSpecies: null
  });
  assert.ok(low.lodNear < high.lodNear, 'full detail ends sooner');
  assert.ok(low.lodMid < high.lodMid, 'whole-crown cards start sooner');
  assert.ok(low.streetCutoff < high.streetCutoff, 'street-level trees stop sooner');
  for (let tier = 0; tier < 3; tier++) {
    assert.ok(low.maxDist[tier] < high.maxDist[tier], `draw distance of site tier ${tier} is shorter`);
  }
  assert.equal(low.lod1Variants, 1, 'variant 1 reuses variant 0 geometry at LOD 1');
  assert.equal(low.farSpecies, 0, 'all species share one whole-crown geometry');
});
