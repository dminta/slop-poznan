const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const source = readFileSync(join(__dirname, '../js/perf-stats.js'), 'utf8');
const stats = loadModule(source, { filename: 'perf-stats.js' });
const { FrameWindow, formatReport } = stats;

test('frame window reports nearest-rank p50/p95/max over its samples', () => {
  const window = new FrameWindow(16, 5000);
  const samples = [10, 20, 30, 40, 50, 60, 70, 80];
  samples.forEach((ms, index) => window.push(ms, index * 100));
  const summary = window.read(700);
  assert.equal(summary.samples, 8);
  assert.equal(summary.mean, 45);
  assert.equal(summary.p50, 40);
  assert.equal(summary.p95, 80);
  assert.equal(summary.max, 80);
});

test('frame window drops samples older than the five-second window and survives ring wrap', () => {
  const window = new FrameWindow(4, 5000);
  const values = [10, 20, 30, 40, 50];
  values.forEach((ms, index) => window.push(ms, index * 10));
  let summary = window.read(40);
  assert.equal(summary.samples, 4, 'the ring keeps only its capacity');
  assert.equal(summary.p50, 30);
  assert.equal(summary.max, 50);

  const timed = new FrameWindow(16, 5000);
  for (let index = 0; index <= 12; index++) timed.push(10, index * 500);
  summary = timed.read(6000);
  assert.equal(summary.samples, 11, 'cutoff is inclusive at 6000 - 5000 ms');
  assert.equal(summary.max, 10);
});

test('hidden-tab gaps and impossible frame times are not frame samples', () => {
  const window = new FrameWindow(8, 5000);
  window.push(16, 0);
  window.push(20, 16);
  window.push(5000, 20000); // a restored tab: starts a new window and is skipped
  window.push(30, 20016);
  const summary = window.read(20016);
  assert.equal(summary.samples, 1);
  assert.equal(summary.p50, 30);
  assert.equal(summary.max, 30);
  assert.equal(window.read(20200).samples, 1);
});

test('report formatting carries the device, frame, render and view lines', () => {
  const report = formatReport({
    date: '2026-11-11T21:00:00.000Z',
    url: 'https://slop-poznan.dominikminta.com/?stats=1&quality=low',
    params: 'stats=1, quality=low',
    userAgent: 'Mozilla/5.0 Test',
    platform: 'macOS',
    hardwareConcurrency: 8,
    deviceMemory: 8,
    env: {
      quality: 'low',
      qualityReason: 'touch',
      backend: 'WebGPU',
      gpu: 'apple · metal-3',
      dpr: 2,
      bufferWidth: 293,
      bufferHeight: 633,
      viewportWidth: 390,
      viewportHeight: 844
    },
    frame: { fps: 58, p50: 17.2, p95: 18.4, max: 42.1, samples: 312 },
    cpu: { render: 8.4, simulation: 1.2, total: 10.9 },
    render: { drawCalls: 1553, triangles: 7900000 },
    memory: {
      gpuMB: 412.5,
      textures: 53,
      geometries: 37865,
      programs: 290,
      renderTargets: 17,
      jsUsedMB: 903,
      jsLimitMB: 4096
    },
    boot: {
      firstFrameMs: 17032,
      readyMs: 17420,
      initTimings: ['renderer 10ms', 'lighting 21ms']
    },
    view: {
      mode: 'car',
      camera: 'rynek',
      cameraName: 'Stary Rynek i Ratusz',
      time: 'golden',
      player: { x: 12.5, y: 0, z: -45 },
      cameraPosition: { x: 0, y: 10, z: 140 }
    }
  });
  assert.match(report, /^Slop Poznań — raport wydajności/);
  assert.match(report, /Klatka: 58 fps · p50 17\.2 ms · p95 18\.4 ms · maks 42\.1 ms \(312 próbek\)/);
  assert.match(report, /CPU render: 8\.4 ms/);
  assert.match(report, /CPU symulacja \(tramwaje \+ ruch i piesi\): 1\.2 ms/);
  assert.match(report, /Rysowanie: .* wywołań · 7\.90 M trójkątów/);
  assert.match(report, /Programy: 290 · cele renderowania: 17/);
  assert.match(report, /Pamięć GPU: 413 MB · 53 tekstur · 37.865 geometrii/);
  assert.match(report, /Pamięć JS: 903 MB \/ 4096 MB/);
  assert.match(report, /Ładowanie: 17\.0 s do pierwszej klatki · 17\.4 s do gotowości GPU/);
  assert.match(report, /\[init\] renderer 10ms, lighting 21ms/);
  assert.match(report, /Grafika: niska \(touch\) · WebGPU/);
  assert.match(report, /Ekran: 390×844 CSS · DPR 2 · bufor 293×633/);
  assert.match(report, /Widok: tryb car · kamera rynek \(Stary Rynek i Ratusz\) · pora dnia golden/);
  assert.match(report, /Pozycja: x 12\.5 · y 0\.0 · z -45\.0/);
});

test('an empty report still formats without throwing', () => {
  assert.doesNotThrow(() => formatReport({}));
  assert.match(formatReport({}), /Pamięć GPU: —/);
});
