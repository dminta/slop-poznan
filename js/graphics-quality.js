// js/graphics-quality.js
// The two renderer presets. `high` is the look the app always had; `low` trades screen-space
// reflections, bloom, shadow reach/resolution and some population for older phones and GPUs.
// The tier is chosen once at boot and never switched: changing the pass layout at runtime
// recompiles every scene pipeline and freezes the page for seconds. Keep the values here pure
// data so tests/boot selection stay independent of three.js.

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
    shadowCasters: true,
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
    shadowCasters: false,
    population: { pedestrians: 180, vehicleDensity: 6, minVehicles: 15 }
  }
};

function normaliseQuality(value) {
  return value === 'high' || value === 'low' ? value : null;
}

// A phone or tablet starts low: its primary pointer is a finger and no fine pointer is available. A touch laptop with
// a trackpad or mouse reports a fine pointer and stays high.
function isTouchFirstDevice({ coarsePointer = false, finePointer = false } = {}) {
  return Boolean(coarsePointer) && !finePointer;
}

// The device default only starts low on hardware that cannot carry the high preset: a touch-first phone/tablet, the
// WebGL2 fallback, four or fewer CPU threads, or (where reported) 4 GB of memory or less.
function detectQuality({
  webgl = false, coarsePointer = false, finePointer = false, hardwareConcurrency = null, deviceMemory = null
} = {}) {
  if (webgl) return 'low';
  if (isTouchFirstDevice({ coarsePointer, finePointer })) return 'low';
  if (Number.isFinite(hardwareConcurrency) && hardwareConcurrency > 0 && hardwareConcurrency <= 4) return 'low';
  if (Number.isFinite(deviceMemory) && deviceMemory > 0 && deviceMemory <= 4) return 'low';
  return 'high';
}

// An explicit ?quality=low|high wins over the device default. The choice is fixed for the page load; the link in the
// brand line only reloads with the other value.
function resolveQuality({ url = null, ...device } = {}) {
  return normaliseQuality(url) || detectQuality(device);
}

// The old toolbar toggle wrote this key; nothing writes it any more. Remove a stale value once at boot so a choice
// from the previous build cannot linger. Storage access is wrapped: private mode, disabled storage and quota errors
// must never block play.
function clearStoredQuality(storage = null) {
  try {
    const store = storage || globalThis.localStorage;
    store?.removeItem(GRAPHICS_QUALITY_KEY);
    return true;
  } catch {
    return false;
  }
}

export {
  GRAPHICS_QUALITY_KEY,
  QUALITY_TIERS,
  normaliseQuality,
  isTouchFirstDevice,
  detectQuality,
  resolveQuality,
  clearStoredQuality
};
