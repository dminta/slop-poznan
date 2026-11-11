const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const source = readFileSync(join(__dirname, '../js/lighting.js'), 'utf8');
const qualitySource = readFileSync(join(__dirname, '../js/graphics-quality.js'), 'utf8');
const graphicsQuality = loadModule(qualitySource, { filename: 'graphics-quality.js' });

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
}

// Only the preset table and the solar maths run at import time; the renderer classes are never constructed here
const { TIME_PRESETS, sunPosition, sunVector } = loadModule(source, {
  filename: 'lighting.js',
  imports: {
    'three/webgpu': { Vector3 },
    'three/tsl': {},
    'three/addons/objects/SkyMesh.js': {},
    'three/addons/lights/SunLight.js': {},
    'three/addons/lights/SunLightNode.js': {},
    './tsl-materials.js': { cityUniforms: {} },
    './graphics-quality.js': graphicsQuality
  }
});

const DEG = Math.PI / 180;
const at = (iso) => sunPosition(new Date(iso));
const near = (actual, expected, tolerance, what) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: ${actual.toFixed(3)} should be ${expected} ± ${tolerance}`);
};

test('the solar position matches Poznań noon elevations, solar noon and sunsets', () => {
  near(at('2026-06-21T12:53+02:00').elevation, 61, 0.3, 'summer solstice noon elevation');
  near(at('2026-03-20T12:00+01:00').elevation, 38, 0.6, 'March equinox noon elevation');
  near(at('2026-09-23T12:47+02:00').elevation, 38, 0.6, 'September equinox noon elevation');
  near(at('2026-12-21T11:53+01:00').elevation, 14, 0.3, 'winter solstice noon elevation');

  // Solar noon ≈ 12:53 CEST at midsummer: the sun crosses due south then, and stands highest
  near(at('2026-06-21T12:53+02:00').azimuth, 180, 1, 'midsummer solar noon azimuth');
  const noon = at('2026-06-21T12:53+02:00').elevation;
  assert.ok(noon > at('2026-06-21T12:43+02:00').elevation && noon > at('2026-06-21T13:03+02:00').elevation);

  // Sunset: the centre 0.83° under the horizon (refraction and the solar radius), in the north-west / south-west
  near(at('2026-06-21T21:18+02:00').elevation, -0.83, 0.15, 'summer sunset 21:18 CEST');
  near(at('2026-12-21T15:40+01:00').elevation, -0.83, 0.15, 'winter sunset 15:40 CET');
  assert.ok(at('2026-06-21T21:18+02:00').azimuth > 300);
  assert.ok(at('2026-12-21T15:40+01:00').azimuth < 240);

  // Midsummer nights never get dark: the sun is ≈ 14° down at solar midnight, due north
  const midnight = at('2026-06-22T00:53+02:00');
  near(midnight.elevation, -14, 0.5, 'midsummer solar midnight elevation');
  assert.ok(midnight.azimuth < 2 || midnight.azimuth > 358);
});

test('sun vectors use the world frame: x east, y up, z south', () => {
  const south = sunVector(180, 0);
  near(south.z, 1, 1e-9, 'south is +z');
  const east = sunVector(90, 30);
  near(east.x, Math.cos(30 * DEG), 1e-9, 'east is +x');
  near(east.y, 0.5, 1e-9, 'elevation is y');
  near(sunVector(0, 0).z, -1, 1e-9, 'north is −z');
});

test('the world frame is not turned, as the sun vectors assume', async () => {
  const { GEO } = await import('../js/geodata.js');
  assert.equal(GEO.frame.bearingDeg, 0);
});

test('every preset is a stated Poznań moment whose label and sun direction agree with it', () => {
  assert.deepEqual(Object.keys(TIME_PRESETS), ['golden', 'midday', 'twilight', 'midnight']);
  for (const preset of Object.values(TIME_PRESETS)) {
    // `when` is an explicit local time: CET (+01:00) or CEST (+02:00), and the label shows that clock time
    const match = /^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2})\+0([12]):00$/.exec(preset.when);
    assert.ok(match, `${preset.id}: ${preset.when}`);
    assert.ok(preset.name.endsWith(`· ${match[1]}`), `${preset.id}: "${preset.name}" should show ${match[1]}`);
    assert.ok(!/Manhattan|New York|NYC/.test(preset.name));

    const sun = at(preset.when);
    near(preset.sunAzimuth, sun.azimuth, 1e-9, `${preset.id} azimuth`);
    near(preset.sunElevation, sun.elevation, 1e-9, `${preset.id} elevation`);
    const d = preset.sunDir;
    near(Math.hypot(d.x, d.y, d.z), 1, 1e-9, `${preset.id} unit sunDir`);
    near((Math.atan2(d.x, -d.z) / DEG + 360) % 360, sun.azimuth, 1e-6, `${preset.id} sunDir azimuth`);
    const rendered = Math.max(sun.elevation, preset.minElevation ?? -90);
    near(Math.asin(d.y) / DEG, rendered, 1e-6, `${preset.id} sunDir elevation`);
    assert.ok(d.y > 0.1, `${preset.id}: the rendered sun must stay above the horizon`);
  }
  const { golden, midday, twilight, midnight } = TIME_PRESETS;
  // Golden hour: low (under 10°) but up; blue hour: 4–8° under the horizon; midnight: a midsummer twilight sky
  assert.ok(golden.sunElevation > 4 && golden.sunElevation < 10 && golden.minElevation === undefined);
  assert.ok(midday.sunElevation > 55 && midday.minElevation === undefined);
  assert.ok(twilight.sunElevation < -4 && twilight.sunElevation > -8);
  assert.ok(midnight.sunElevation < -6 && midnight.sunElevation > -14);
});

test('the in-game clock starts each preset at its stated local time', () => {
  // city-clock.js keeps its own PRESET_CLOCK so the audio and the goats need not import the renderer modules
  const { PRESET_CLOCK } = loadModule(readFileSync(join(__dirname, '../js/city-clock.js'), 'utf8'), { filename: 'city-clock.js' });
  assert.deepEqual(Object.keys(PRESET_CLOCK).sort(), Object.keys(TIME_PRESETS).sort());
  for (const preset of Object.values(TIME_PRESETS)) {
    const [, hh, mm] = /T(\d{2}):(\d{2})/.exec(preset.when);
    assert.equal(PRESET_CLOCK[preset.id], Number(hh) * 60 + Number(mm), preset.id);
  }
});
