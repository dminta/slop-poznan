// js/graphics-quality.js
// The two renderer presets. `high` is the look the app always had; `low` trades screen-space
// reflections, bloom, shadow reach/resolution and some population for older phones and GPUs.
// Keep the values here pure data so tests/boot selection stay independent of three.js.

const GRAPHICS_QUALITY_KEY = 'graphics-quality';

const QUALITY_TIERS = {
  high: {
    id: 'high',
    label: 'wysoka',
    pixelRatio: 1.0,
    postProcessing: { ssr: true, bloom: true },
    shadowMapSize: 3072,
    // Shadow camera far: start + altitude * perMetre, clamped. High is the historical 300-720 m reach.
    shadowRange: { start: 260, perMetre: 1.6, min: 300, max: 720 },
    population: { pedestrians: 340, vehicleDensity: 12, minVehicles: 30 }
  },
  low: {
    id: 'low',
    label: 'niska',
    pixelRatio: 0.75,
    postProcessing: { ssr: false, bloom: false },
    // 1024² per cascade: 75 MB less shadow depth storage than the 3072² tiles, and a 150-360 m reach.
    shadowMapSize: 1024,
    shadowRange: { start: 120, perMetre: 1.0, min: 150, max: 360 },
    population: { pedestrians: 180, vehicleDensity: 6, minVehicles: 15 }
  }
};

function normaliseQuality(value) {
  return value === 'high' || value === 'low' ? value : null;
}

// Auto-detect only ever starts low on hardware that cannot carry the high preset:
// the WebGL2 fallback, four or fewer CPU threads, or (where reported) 4 GB of memory or less.
function detectQuality({ webgl = false, hardwareConcurrency = null, deviceMemory = null } = {}) {
  if (webgl) return 'low';
  if (Number.isFinite(hardwareConcurrency) && hardwareConcurrency > 0 && hardwareConcurrency <= 4) return 'low';
  if (Number.isFinite(deviceMemory) && deviceMemory > 0 && deviceMemory <= 4) return 'low';
  return 'high';
}

// An explicit choice wins over auto-detection; only `auto` can be lowered later by the FPS watchdog.
function resolveQuality({
  url = null, stored = null, webgl = false, hardwareConcurrency = null, deviceMemory = null
} = {}) {
  const fromUrl = normaliseQuality(url);
  if (fromUrl) return { tier: fromUrl, source: 'url' };
  const fromStorage = normaliseQuality(stored);
  if (fromStorage) return { tier: fromStorage, source: 'stored' };
  return { tier: detectQuality({ webgl, hardwareConcurrency, deviceMemory }), source: 'auto' };
}

// Every localStorage access is wrapped: private mode, disabled storage and quota errors must never block play.
function readStoredQuality(storage = null) {
  try {
    const store = storage || globalThis.localStorage;
    return normaliseQuality(store?.getItem(GRAPHICS_QUALITY_KEY));
  } catch {
    return null;
  }
}

function storeQuality(tier, storage = null) {
  const value = normaliseQuality(tier);
  if (!value) return false;
  try {
    const store = storage || globalThis.localStorage;
    store?.setItem(GRAPHICS_QUALITY_KEY, value);
    return true;
  } catch {
    return false;
  }
}

// The FPS watchdog needs two full seconds below 30 fps. A single slow frame, a shader compile or a hitch never
// switches tiers, and neither does a user's explicit high choice or an auto start that is already low.
const WATCHDOG_LOW_FPS = 30;
const WATCHDOG_LOW_SECONDS = 2;
const WATCHDOG_FRAME_CAP = 0.5;

// One FPS telemetry window's contribution to the watchdog. A hidden tab or a window whose last frame took over half a
// second (a compile hitch or the first frame back from a hidden tab) resets the count; ordinary low windows add their
// own duration, capped so one huge sample cannot count as several seconds.
function accumulateLowSeconds(previous, fps, windowSeconds, frameSeconds, hidden) {
  if (hidden || frameSeconds > WATCHDOG_FRAME_CAP || fps >= WATCHDOG_LOW_FPS) return 0;
  return previous + Math.min(windowSeconds, WATCHDOG_FRAME_CAP);
}

function shouldAutoDowngrade(tier, source, lowSeconds) {
  return tier === 'high' && source === 'auto' && lowSeconds >= WATCHDOG_LOW_SECONDS;
}

export {
  GRAPHICS_QUALITY_KEY,
  QUALITY_TIERS,
  WATCHDOG_FRAME_CAP,
  WATCHDOG_LOW_FPS,
  WATCHDOG_LOW_SECONDS,
  normaliseQuality,
  detectQuality,
  resolveQuality,
  readStoredQuality,
  storeQuality,
  accumulateLowSeconds,
  shouldAutoDowngrade
};
