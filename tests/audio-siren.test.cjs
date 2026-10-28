const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { loadModule } = require('./helpers/module.cjs');

// The Polish two-tone siren (audio-synthesis.js): the carrier is centred between the two tones and the stepped
// control wave (sent through createPeriodicWave) moves it by ± half their gap. Rebuild the control wave from its
// Fourier series, as the oscillator plays it, and check the frequencies and tone lengths a listener would hear.
const { SIREN, controlWaveCoefficients, sirenWailing, twoToneControl } = loadModule(
  readFileSync(join(__dirname, '../js/audio-synthesis.js'), 'utf8'), { filename: 'audio-synthesis.js' }
);

function synthesize({ real, imaginary }, phase) {
  let value = 0;
  for (let k = 1; k < real.length; k++) {
    value += real[k] * Math.cos(2 * Math.PI * k * phase) + imaginary[k] * Math.sin(2 * Math.PI * k * phase);
  }
  return value;
}

test('the hi-lo alternates ≈ 435 and ≈ 580 Hz, about 0.55 s each, with short steps', () => {
  const coefficients = controlWaveCoefficients(twoToneControl, 128);
  const samples = 4096;
  const raw = Array.from({ length: samples }, (_, i) => synthesize(coefficients, i / samples));
  // createPeriodicWave normalises the waveform to a peak of 1
  const peak = Math.max(...raw.map(Math.abs));
  const centre = (SIREN.low + SIREN.high) / 2;
  const depth = (SIREN.high - SIREN.low) / 2;
  const frequency = raw.map((v) => centre + depth * v / peak);
  const period = 2 * SIREN.tone;
  const high = frequency.filter((f) => Math.abs(f - 580) < 6).length * period / samples;
  const low = frequency.filter((f) => Math.abs(f - 435) < 6).length * period / samples;
  assert.ok(high > 0.5 && high < 0.56, `high tone held ${high.toFixed(3)} s`);
  assert.ok(low > 0.5 && low < 0.56, `low tone held ${low.toFixed(3)} s`);
  assert.ok(Math.min(...frequency) > 425 && Math.max(...frequency) < 590, 'no ringing beyond the two tones');
  assert.ok(SIREN.tone >= 0.5 && SIREN.tone <= 0.6);
});

test('each vehicle wails 6 s in every 30 s, at its own offset', () => {
  let wailing = 0;
  for (let i = 0; i < 3000; i++) if (sirenWailing(i * 0.1, 0.3)) wailing++;
  assert.ok(Math.abs(wailing / 3000 - 0.2) < 0.01, `${wailing / 30} s wailing in 300 s`);
  assert.notEqual(sirenWailing(25, 0), sirenWailing(25, 0.5));
});
