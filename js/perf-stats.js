// js/perf-stats.js
// Opt-in performance panel and copyable report for measuring real devices (?stats=1). main.js imports this module
// statically, constructs the panel only when the query switch is on, and calls the frame hooks from the animation
// loop; with the switch off no DOM exists, renderer.info stays on automatic reset and the only cost is one null check
// per hook. The measurement code reuses ring buffers and preallocated objects: a frame allocates nothing, and the DOM
// is written twice a second through textContent. FrameWindow and formatReport are pure, so tests can run them directly.

const FRAME_WINDOW_MS = 5000;
const FRAME_CAPACITY = 1024;
const DISPLAY_INTERVAL_MS = 500;
// A gap longer than this is a hidden tab, a sleeping device or a file load, not a frame: it would poison p95/max.
const MAX_SAMPLE_MS = 1000;
const BYTES_PER_MB = 1024 * 1024;

const QUALITY_WORDS = { high: 'wysoka', low: 'niska' };

const ROWS = [
  ['fps', 'Klatka', false],
  ['frame', 'Czas klatki', false],
  ['render', 'CPU render', false],
  ['simulation', 'Symulacja', false],
  ['cpu', 'CPU klatki', false],
  ['draws', 'Rysowanie', false],
  ['programs', 'Programy', true],
  ['gpuMemory', 'Pamięć GPU', true],
  ['jsMemory', 'Pamięć JS', true],
  ['quality', 'Grafika', false],
  ['gpu', 'GPU', true],
  ['screen', 'Ekran', true],
  ['boot', 'Ładowanie', false]
];

function formatCount(value) {
  return Math.round(value).toLocaleString('pl');
}

function formatNumber(value) {
  return Number.isFinite(value) ? value.toFixed(1) : '—';
}

function formatMs(value) {
  return Number.isFinite(value) ? `${formatNumber(value)} ms` : '—';
}

function formatTriangles(value) {
  if (!Number.isFinite(value) || value <= 0) return '0';
  return value >= 1e6 ? `${(value / 1e6).toFixed(2)} M` : formatCount(value);
}

function formatMemory(value) {
  return `${Math.round(value)} MB`;
}

function formatSeconds(value) {
  return Number.isFinite(value) && value > 0 ? `${(value / 1000).toFixed(1)} s` : '—';
}

// Nearest-rank percentiles over the frames of the last window. `capacity` bounds the ring; 5 s at 120 Hz is 600
// samples, so 1024 also covers 240 Hz displays. The sortable buffer is sorted whole (stale slots filled with
// Infinity) so a read does not allocate a subarray every half second.
class FrameWindow {
  constructor(capacity = FRAME_CAPACITY, windowMs = FRAME_WINDOW_MS) {
    this.capacity = capacity;
    this.windowMs = windowMs;
    this.times = new Float64Array(capacity);
    this.stamps = new Float64Array(capacity);
    this.sortable = new Float64Array(capacity);
    this.count = 0;
    this.next = 0;
    this.lastStamp = -Infinity;
    this.summary = { samples: 0, mean: 0, p50: 0, p95: 0, max: 0 };
  }

  reset() {
    this.count = 0;
    this.next = 0;
    this.lastStamp = -Infinity;
  }

  push(frameMs, stamp) {
    // Resuming after a hidden tab or sleep starts a new window instead of mixing in the old samples.
    if (stamp - this.lastStamp > this.windowMs * 2) this.reset();
    this.lastStamp = stamp;
    if (!(frameMs > 0) || frameMs > MAX_SAMPLE_MS) return;
    this.times[this.next] = frameMs;
    this.stamps[this.next] = stamp;
    this.next = (this.next + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  read(now) {
    const { times, stamps, sortable, capacity } = this;
    const cutoff = now - this.windowMs;
    let index = (this.next - 1 + capacity) % capacity;
    let samples = 0;
    for (let i = 0; i < this.count; i++) {
      if (stamps[index] < cutoff) break;
      sortable[samples++] = times[index];
      index = (index - 1 + capacity) % capacity;
    }
    const summary = this.summary;
    summary.samples = samples;
    if (samples === 0) {
      summary.mean = 0;
      summary.p50 = 0;
      summary.p95 = 0;
      summary.max = 0;
      return summary;
    }
    let sum = 0;
    for (let i = 0; i < samples; i++) sum += sortable[i];
    summary.mean = sum / samples;
    sortable.fill(Infinity, samples);
    sortable.sort();
    summary.p50 = sortable[Math.max(0, Math.ceil(samples * 0.5) - 1)];
    summary.p95 = sortable[Math.max(0, Math.ceil(samples * 0.95) - 1)];
    summary.max = sortable[samples - 1];
    return summary;
  }
}

function adapterLabel(info) {
  if (!info) return '—';
  const parts = [];
  for (const value of [info.vendor, info.device, info.description, info.architecture]) {
    if (value && !parts.includes(value)) parts.push(value);
  }
  return parts.length ? parts.join(' · ') : '—';
}

function readWebGLGpu(renderer) {
  try {
    const gl = renderer.getContext();
    if (!gl) return '—';
    const extension = gl.getExtension('WEBGL_debug_renderer_info');
    const name = extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return name ? String(name) : '—';
  } catch {
    return '—';
  }
}

function readQualityReason() {
  try {
    return (typeof document !== 'undefined' && document.body && document.body.dataset.qualityReason) || '';
  } catch {
    return '';
  }
}

function readJsHeap(out) {
  const memory = typeof performance !== 'undefined' ? performance.memory : null;
  out.jsUsedMB = memory ? memory.usedJSHeapSize / BYTES_PER_MB : 0;
  out.jsLimitMB = memory ? memory.jsHeapSizeLimit / BYTES_PER_MB : 0;
  return out;
}

function formatReport(data) {
  const env = data.env || {};
  const frame = data.frame || {};
  const cpu = data.cpu || {};
  const render = data.render || {};
  const memory = data.memory || {};
  const boot = data.boot || {};
  const view = data.view || {};
  const player = view.player || {};
  const camera = view.cameraPosition || {};
  const quality = QUALITY_WORDS[env.quality] || env.quality || '—';
  const qualityReason = env.qualityReason ? ` (${env.qualityReason})` : '';
  const lines = [
    'Slop Poznań — raport wydajności',
    `Data: ${data.date || '—'}`,
    `URL: ${data.url || '—'}`,
    `Parametry URL: ${data.params || '—'}`,
    `UA: ${data.userAgent || '—'}`,
    `Platforma: ${data.platform || '—'}`,
    `Wątki CPU: ${data.hardwareConcurrency || '—'}`,
    `deviceMemory: ${data.deviceMemory ? `${data.deviceMemory} GB` : '—'}`,
    '',
    `Klatka: ${Math.round(frame.fps || 0)} fps · p50 ${formatMs(frame.p50)} · p95 ${formatMs(frame.p95)} · maks ${formatMs(frame.max)} (${frame.samples || 0} próbek)`,
    `CPU render: ${formatMs(cpu.render)}`,
    `CPU symulacja (tramwaje + ruch i piesi): ${formatMs(cpu.simulation)}`,
    `CPU klatki: ${formatMs(cpu.total)}`,
    `Rysowanie: ${formatCount(render.drawCalls || 0)} wywołań · ${formatTriangles(render.triangles)} trójkątów`,
    `Programy: ${memory.programs ? formatCount(memory.programs) : '—'} · cele renderowania: ${memory.renderTargets || '—'}`,
    `Pamięć GPU: ${memory.gpuMB ? formatMemory(memory.gpuMB) : '—'}${memory.textures ? ` · ${formatCount(memory.textures)} tekstur · ${formatCount(memory.geometries)} geometrii` : ''}`,
    `Pamięć JS: ${memory.jsUsedMB ? formatMemory(memory.jsUsedMB) : '—'}${memory.jsLimitMB ? ` / ${formatMemory(memory.jsLimitMB)}` : ''}`,
    `Ładowanie: ${formatSeconds(boot.firstFrameMs)} do pierwszej klatki · ${formatSeconds(boot.readyMs)} do gotowości GPU`,
    boot.initTimings && boot.initTimings.length ? `[init] ${boot.initTimings.join(', ')}` : '[init] —',
    `Grafika: ${quality}${qualityReason} · ${env.backend || '—'}`,
    `GPU: ${env.gpu || '—'}`,
    `Ekran: ${env.viewportWidth || '—'}×${env.viewportHeight || '—'} CSS · DPR ${env.dpr || '—'} · bufor ${env.bufferWidth || '—'}×${env.bufferHeight || '—'}`,
    `Widok: tryb ${view.mode || '—'} · kamera ${view.camera || '—'}${view.cameraName ? ` (${view.cameraName})` : ''} · pora dnia ${view.time || '—'}`,
    `Pozycja: x ${formatNumber(player.x)} · y ${formatNumber(player.y)} · z ${formatNumber(player.z)}`,
    `Kamera: x ${formatNumber(camera.x)} · y ${formatNumber(camera.y)} · z ${formatNumber(camera.z)}`
  ];
  return lines.join('\n');
}

class PerfStats {
  constructor({ renderer, quality, getContext = null }) {
    this.renderer = renderer;
    this.quality = quality;
    this.getContext = getContext;
    this.backend = renderer.backend && renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2';
    this.gpu = this.backend === 'WebGPU' ? '…' : readWebGLGpu(renderer);
    this.window = new FrameWindow();
    this.started = false;
    this.boot = { firstFrameMs: 0, readyMs: 0, initTimings: null };
    // Reused every display tick and read by the report without allocating.
    this.last = { fps: 0, p50: 0, p95: 0, max: 0, samples: 0, render: 0, simulation: 0, total: 0, drawCalls: 0, triangles: 0 };
    this.memory = { gpuMB: 0, textures: 0, geometries: 0, programs: 0, renderTargets: 0, jsUsedMB: 0, jsLimitMB: 0 };
    this._now = 0;
    this._previousNow = 0;
    this._frameStart = 0;
    this._simulationStart = 0;
    this._renderStart = 0;
    this._renderSum = 0;
    this._simulationSum = 0;
    this._totalSum = 0;
    this._drawSum = 0;
    this._triangleSum = 0;
    this._frames = 0;
    this._lastDisplay = 0;
    this._statusTimer = 0;
    this._values = Object.create(null);
    // Info accumulates across the scene pass, the shadow cascades and the post-processing passes until reset below;
    // main.js calls beginFrame() once per animation loop, so these are whole-frame counts. The internal loop resets
    // automatically only while autoReset stays true.
    renderer.info.autoReset = false;
    this._buildPanel();
    if (this.backend === 'WebGPU') this._readAdapter();
  }

  setBoot({ firstFrameMs = 0, readyMs = 0, initTimings = null } = {}) {
    this.boot.firstFrameMs = firstFrameMs;
    this.boot.readyMs = readyMs;
    this.boot.initTimings = initTimings ? initTimings.slice() : null;
    this.window.reset();
    this._resetSums();
    this._previousNow = 0;
    this.started = true;
    this._paint();
  }

  beginFrame(now) {
    this.renderer.info.reset();
    this._now = now;
    this._frameStart = performance.now();
  }

  beginSimulation() {
    this._simulationStart = performance.now();
  }

  endSimulation() {
    this._simulationSum += performance.now() - this._simulationStart;
  }

  beginRender() {
    this._renderStart = performance.now();
  }

  endRender() {
    this._renderSum += performance.now() - this._renderStart;
  }

  endFrame() {
    const frameMs = performance.now() - this._frameStart;
    const previous = this._previousNow;
    this._previousNow = this._now;
    if (!this.started) return;
    if (previous > 0) this.window.push(this._now - previous, this._now);
    this._totalSum += frameMs;
    this._drawSum += this.renderer.info.render.drawCalls;
    this._triangleSum += this.renderer.info.render.triangles;
    this._frames++;
    if (this._now - this._lastDisplay >= DISPLAY_INTERVAL_MS) this._paint();
  }

  copyReport() {
    const text = this.reportText();
    const copied = () => this._setStatus('Skopiowano ✓', false);
    const fallback = () => this._showReport(text);
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(copied, fallback);
    } else {
      fallback();
    }
  }

  reportText() {
    const summary = this.window.read(typeof performance !== 'undefined' ? performance.now() : this._now);
    this._useSummary(summary);
    readJsHeap(this.memory);
    const env = this._environment();
    const context = this.getContext ? this.getContext() : {};
    const locationHref = typeof location !== 'undefined' ? location.href : '—';
    const search = typeof location !== 'undefined' ? location.search : '';
    const params = search
      ? [...new URLSearchParams(search).entries()].map(([key, value]) => `${key}=${value}`).join(', ')
      : '—';
    const nav = typeof navigator !== 'undefined' ? navigator : {};
    const last = this.last;
    return formatReport({
      date: new Date().toISOString(),
      url: locationHref,
      params,
      userAgent: nav.userAgent || '—',
      platform: (nav.userAgentData && nav.userAgentData.platform) || nav.platform || '—',
      hardwareConcurrency: nav.hardwareConcurrency || 0,
      deviceMemory: nav.deviceMemory || 0,
      env,
      frame: {
        fps: last.fps,
        p50: last.p50,
        p95: last.p95,
        max: last.max,
        samples: last.samples
      },
      cpu: { render: last.render, simulation: last.simulation, total: last.total },
      render: { drawCalls: last.drawCalls, triangles: last.triangles },
      memory: {
        gpuMB: this.memory.gpuMB,
        textures: this.memory.textures,
        geometries: this.memory.geometries,
        programs: this.memory.programs,
        renderTargets: this.memory.renderTargets,
        jsUsedMB: this.memory.jsUsedMB,
        jsLimitMB: this.memory.jsLimitMB
      },
      boot: {
        firstFrameMs: this.boot.firstFrameMs,
        readyMs: this.boot.readyMs,
        initTimings: this.boot.initTimings
      },
      view: context
    });
  }

  _buildPanel() {
    const panel = document.createElement('aside');
    panel.id = 'perf-stats';
    panel.className = 'panel perf-stats';
    panel.setAttribute('aria-label', 'Panel wydajności (?stats=1)');
    panel.title = 'Wydajność zmierzona na tym urządzeniu (?stats=1)';

    const head = document.createElement('div');
    head.className = 'perf-head';
    const title = document.createElement('span');
    title.className = 'perf-title';
    title.textContent = 'Wydajność';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'perf-copy';
    button.textContent = 'Kopiuj raport';
    button.addEventListener('click', () => this.copyReport());
    head.append(title, button);

    const rows = document.createElement('div');
    rows.className = 'perf-rows';
    for (const [key, label, extra] of ROWS) {
      const labelEl = document.createElement('span');
      labelEl.className = 'perf-label';
      if (extra) labelEl.classList.add('perf-extra');
      labelEl.textContent = label;
      const valueEl = document.createElement('span');
      valueEl.className = 'perf-value';
      if (extra) valueEl.classList.add('perf-extra');
      valueEl.textContent = '—';
      rows.append(labelEl, valueEl);
      this._values[key] = valueEl;
    }

    const status = document.createElement('div');
    status.className = 'perf-copy-status';
    status.setAttribute('aria-live', 'polite');

    const report = document.createElement('textarea');
    report.className = 'perf-report';
    report.readOnly = true;
    report.spellcheck = false;
    report.hidden = true;
    report.setAttribute('aria-label', 'Raport wydajności do skopiowania');

    panel.append(head, rows, status, report);
    document.body.appendChild(panel);
    document.body.classList.add('perf-stats-on');
    this._panel = panel;
    this._status = status;
    this._reportField = report;
  }

  _readAdapter() {
    if (typeof navigator === 'undefined' || !navigator.gpu || !navigator.gpu.requestAdapter) return;
    navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }).then((adapter) => {
      if (!adapter) {
        this.gpu = '—';
        return;
      }
      if (adapter.info) {
        this.gpu = adapterLabel(adapter.info);
      } else if (typeof adapter.requestAdapterInfo === 'function') {
        adapter.requestAdapterInfo().then((info) => {
          this.gpu = adapterLabel(info);
        }).catch(() => {
          this.gpu = '—';
        });
      } else {
        this.gpu = '—';
      }
    }).catch(() => {
      this.gpu = '—';
    });
  }

  _resetSums() {
    this._renderSum = 0;
    this._simulationSum = 0;
    this._totalSum = 0;
    this._drawSum = 0;
    this._triangleSum = 0;
    this._frames = 0;
  }

  _useSummary(summary) {
    const last = this.last;
    last.samples = summary.samples;
    last.fps = summary.samples ? 1000 / summary.mean : 0;
    last.p50 = summary.p50;
    last.p95 = summary.p95;
    last.max = summary.max;
  }

  _paint() {
    const now = this._now || (typeof performance !== 'undefined' ? performance.now() : 0);
    this._useSummary(this.window.read(now));
    const last = this.last;
    const frames = this._frames || 1;
    last.render = this._renderSum / frames;
    last.simulation = this._simulationSum / frames;
    last.total = this._totalSum / frames;
    last.drawCalls = this._drawSum / frames;
    last.triangles = this._triangleSum / frames;
    this._readMemory();
    this._writeRows();
    this._resetSums();
    this._lastDisplay = now;
  }

  _readMemory() {
    const memory = this.renderer.info.memory || {};
    const out = this.memory;
    out.gpuMB = memory.total ? memory.total / BYTES_PER_MB : 0;
    out.textures = memory.textures || 0;
    out.geometries = memory.geometries || 0;
    out.programs = memory.programs || 0;
    out.renderTargets = memory.renderTargets || 0;
    readJsHeap(out);
    return out;
  }

  _environment() {
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    return {
      quality: this.quality,
      qualityReason: readQualityReason(),
      backend: this.backend,
      gpu: this.gpu,
      dpr,
      bufferWidth: this.renderer.domElement.width,
      bufferHeight: this.renderer.domElement.height,
      viewportWidth: typeof window !== 'undefined' ? window.innerWidth : 0,
      viewportHeight: typeof window !== 'undefined' ? window.innerHeight : 0
    };
  }

  _writeRows() {
    const last = this.last;
    const memory = this.memory;
    const reason = readQualityReason();
    const quality = QUALITY_WORDS[this.quality] || this.quality;
    this._set('fps', last.samples ? `${Math.round(last.fps)} fps` : '—');
    this._set('frame', last.samples
      ? `p50 ${last.p50.toFixed(1)} · p95 ${last.p95.toFixed(1)} · maks ${last.max.toFixed(1)} ms`
      : '—');
    this._set('render', formatMs(last.render));
    this._set('simulation', formatMs(last.simulation));
    this._set('cpu', formatMs(last.total));
    this._set('draws', `${formatCount(last.drawCalls)} wyw. · ${formatTriangles(last.triangles)} trójkątów`);
    this._set('programs', memory.programs
      ? `${formatCount(memory.programs)}${memory.renderTargets ? ` · ${memory.renderTargets} RT` : ''}`
      : '—');
    this._set('gpuMemory', memory.gpuMB
      ? `${formatMemory(memory.gpuMB)}${memory.textures ? ` · ${formatCount(memory.textures)} tekst.` : ''}`
      : '—');
    this._set('jsMemory', memory.jsUsedMB
      ? `${formatMemory(memory.jsUsedMB)}${memory.jsLimitMB ? ` / ${formatMemory(memory.jsLimitMB)}` : ''}`
      : '—');
    this._set('quality', `${quality}${reason ? ` (${reason})` : ''} · ${this.backend}`);
    this._set('gpu', this.gpu || '—');
    this._set('screen', `${window.innerWidth}×${window.innerHeight} · DPR ${window.devicePixelRatio || 1} · bufor ${this.renderer.domElement.width}×${this.renderer.domElement.height}`);
    this._set('boot', formatSeconds(this.boot.firstFrameMs));
  }

  _set(key, text) {
    const element = this._values[key];
    if (element && element.textContent !== text) element.textContent = text;
  }

  _setStatus(text, isError) {
    if (!this._status) return;
    this._status.textContent = text;
    this._status.classList.toggle('is-error', Boolean(isError));
    if (this._statusTimer) clearTimeout(this._statusTimer);
    this._statusTimer = setTimeout(() => {
      this._status.textContent = '';
      this._status.classList.remove('is-error');
    }, isError ? 8000 : 2500);
  }

  _showReport(text) {
    const field = this._reportField;
    if (!field) return;
    field.value = text;
    field.hidden = false;
    field.focus();
    field.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
    this._setStatus(copied ? 'Skopiowano ✓' : 'Zaznacz i skopiuj (Ctrl/Cmd+C)', !copied);
  }
}

export { FrameWindow, PerfStats, formatReport };
