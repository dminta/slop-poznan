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
    population: { pedestrians: 340, vehicleDensity: 12, minVehicles: 30 },
    // Trees (js/trees.js): the historical LOD and draw distances, both crown variants and a whole-crown geometry per
    // species. Do not change these without re-checking the high tier's screenshots; high is the reference look.
    trees: {
      lodNear: 105,
      lodMid: 420,
      maxDist: [3000, 1600, 950],
      streetCutoff: 1150,
      lod1Variants: 2,
      farSpecies: null
    }
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
    population: { pedestrians: 180, vehicleDensity: 6, minVehicles: 15 },
    // Shorter tree LOD and draw distances, one LOD-1 crown variant and one shared whole-crown geometry for all species:
    // fewer meshes draw per visible cell and the far field ends before the silhouettes read at 0.75 pixel ratio.
    trees: {
      lodNear: 95,
      lodMid: 330,
      maxDist: [2200, 1500, 850],
      streetCutoff: 900,
      lod1Variants: 1,
      farSpecies: 0
    }
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

// GPU identity classes. The table is deliberately coarse: a class decides the tier and a model is only used for the
// reason string. Order matters. Software comes first; Apple's A-series needs a numeric generation check; Intel Arc and
// AMD's RX/Pro names must win over the integrated patterns; flagship mobile GPUs count as strong because the renderer
// uses CSS pixels (pixel ratio 1.0), so a 390 x 844 phone screen is about a third of a 1280 x 720 desktop's pixels.
// Unknown identity falls through to the CPU, memory and touch rules below.
// Sources:
// - GPUAdapterInfo (vendor, architecture, device, description, isFallbackAdapter):
//   https://www.w3.org/TR/webgpu/#gpuadapterinfo and https://developer.mozilla.org/en-US/docs/Web/API/GPUAdapterInfo
// - WEBGL_debug_renderer_info / UNMASKED_RENDERER_WEBGL:
//   https://developer.mozilla.org/en-US/docs/Web/API/WEBGL_debug_renderer_info
// - Renderer string examples used by the tests:
//   https://deviceandbrowserinfo.com/learning_zone/articles/webgl_renderer_values
// - Apple hides the exact model in Safari: WebKit bug 278542 makes every adapter field report "apple", and WebGL
//   reports "Apple GPU": https://bugs.webkit.org/show_bug.cgi?id=278542
// - A14 (iPhone 12, 2020) and M1 (2020) are the strong Apple cut; the same generation boundary separates the old
//   integrated/mobile classes below from the recent discrete and flagship-mobile ones.
const SOFTWARE_GPU =
  /swiftshader|llvmpipe|softpipe|swrast|software rasterizer|microsoft basic render|microsoft basic display|d3d11 warp|\bwarp\b|virgl|virtio|vmware|parallels|mesa offscreen/;
const APPLE_M_GPU = /\bapple[\s-]+m([1-9])(?![0-9])/;
const APPLE_A_GPU = /\bapple[\s-]+a(\d{1,2})(?![0-9])/;

const GPU_RULES = [
  // Flagship mobile: Adreno 7xx/8xx (Snapdragon 8 Gen 1+), Mali-G710/G715/G720 (Dimensity 9000+/Exynos 2200+) and
  // Immortalis-G7xx/G8xx/G9xx, Xclipse 9xx. A flagship tablet is the case the old touch-first rule got wrong.
  {
    id: 'mali-flagship',
    quality: 'high',
    test: /\bmali-g(?:7[1-9]\d|[89]\d{2})\b|\bimmortalis-g(?:7[1-9]\d|[89]\d{2})\b/
  },
  {
    id: 'adreno-flagship',
    quality: 'high',
    test: /\badreno\s*(?:\(tm\))?\s*(?:7\d{2}|8\d{2})(?!\d)|\badreno-(?:7|8)xx\b/
  },
  { id: 'xclipse', quality: 'high', test: /\bxclipse\s*9\d{2}\b/ },
  // AMD integrated: "Radeon(TM) Graphics", Vega 3-11, Radeon 5xxM-8xxM, HD and R-series. This runs before RX/Pro so a
  // RDNA2/3 integrated GPU is not called discrete just because its adapter architecture is rdna-2/rdna-3.
  {
    id: 'amd-integrated',
    quality: 'low',
    test: /\bradeon\s*(?:\(tm\))?\s+(?:graphics|hd|r[2-9]|[5-8]\d{2}[a-z]?)\b|\bvega\s*(?:[3-9]|1[01])\b/
  },
  // Intel Arc is the one strong Intel class; every HD/UHD/Iris/Xe Graphics is integrated. gen-* and xe-lpg are the
  // Chrome adapter architectures for the integrated parts.
  { id: 'intel-arc', quality: 'high', test: /\barc(?:\s*\(tm\))?\s+[ab]\d{3}m?\b|\bxe(?:2)?-hpg\b/ },
  {
    id: 'intel-integrated',
    quality: 'low',
    test: /\bintel\b[^|]*\b(?:hd|uhd|iris|xe)\b|\bintel\(r\)\s+graphics\b|\b(?:hd|uhd)\s+graphics\b|gen-(?:[6-9]|1[0-3])(?:lp)?\b|\bxe(?:2)?-lpg\b/
  },
  // NVIDIA entry-level mobile first: an MX450 is Turing in the adapter table but not a high-tier GPU.
  { id: 'geforce-mx', quality: 'low', test: /\bgeforce\s+mx\s*\d{3}\b/ },
  // Model names only: an adapter architecture (turing/ampere/ada) also covers the entry-level MX parts, so it is not
  // enough on its own to call a GPU strong.
  {
    id: 'nvidia-rtx',
    quality: 'high',
    test: /\bgeforce\s+rtx\b|\bquadro\s+rtx\b|\brtx\s+(?:a|pro|\d)/
  },
  { id: 'nvidia-gtx16', quality: 'high', test: /\bgtx\s*16\d0\b/ },
  // AMD discrete: RX 5000-9000, Radeon Pro 5000M+ and Radeon VII. Model names only: rdna-2/rdna-3 also cover the
  // integrated Radeon 6xxM-8xxM parts, which the rule above already took.
  {
    id: 'amd-rx',
    quality: 'high',
    test: /\brx\s*[5-9]\d{3}\b|\bradeon\s+pro\s+[5-9]\d{3}m?\b|\bradeon\s+vii\b/
  },
  // Older mobile and integrated classes. G710+ is matched as flagship above; G31-G78 and T-series are not.
  { id: 'mali-old', quality: 'low', test: /\bmali-g(?:[3-6]\d{1,2}|7[0-9])\b|\bmali-t\d{3}\b/ },
  {
    id: 'adreno-old',
    quality: 'low',
    test: /\badreno\s*(?:\(tm\))?\s*[3-6]\d{2}l?(?!\d)|\badreno-[3-6]xx\b/
  },
  { id: 'powervr', quality: 'low', test: /\bpowervr\b/ }
];

// All identity fields as one lowercase haystack. The adapter's architecture can be a class ("ampere", "mali-g78")
// while the WebGL renderer usually carries the retail model ("GeForce RTX 3060", "Apple M5 Pro").
function gpuText(gpu = {}) {
  return [gpu.vendor, gpu.architecture, gpu.device, gpu.description, gpu.rendererVendor, gpu.renderer]
    .filter((value) => typeof value === 'string' && value)
    .join(' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// A short model token for `body[data-quality-reason]`, for example `apple-m5`, `mali-g78`, `adreno-650`,
// `intel-uhd-630` or `radeon-rx-6600`. Falls back to the class id when the string carries no model.
function gpuModel(id, text) {
  const appleM = text.match(APPLE_M_GPU);
  if (appleM) return `apple-m${appleM[1]}`;
  const appleA = text.match(APPLE_A_GPU);
  if (appleA) return `apple-a${Number(appleA[1])}`;
  const mali = text.match(/\bmali-(g\d{2,3}|t\d{3})\b/);
  if (mali) return `mali-${mali[1]}`;
  const immortalis = text.match(/\bimmortalis-(g\d{3})\b/);
  if (immortalis) return `immortalis-${immortalis[1]}`;
  const adreno = text.match(/\badreno\s*(?:\(tm\))?\s*([3-8]\d{2}l?)(?!\d)|\badreno-([3-8]xx)\b/);
  if (adreno) return `adreno-${adreno[1] || adreno[2]}`;
  const xclipse = text.match(/\bxclipse\s*(9\d{2})\b/);
  if (xclipse) return `xclipse-${xclipse[1]}`;
  const geforce = text.match(/\b(rtx|gtx|mx)\s*(\d{3,4})\b/);
  if (geforce) return geforce[1] === 'mx' ? `geforce-mx${geforce[2]}` : `${geforce[1]}-${geforce[2]}`;
  const rx = text.match(/\brx\s*(\d{3,4})\b/);
  if (rx) return `radeon-rx-${rx[1]}`;
  const pro = text.match(/\bradeon\s+pro\s+(\d{3,4}m?)\b/);
  if (pro) return `radeon-pro-${pro[1]}`;
  if (/\bradeon\s+vii\b/.test(text)) return 'radeon-vii';
  const radeonHd = text.match(/\bradeon\s+(hd|r[2-9])\s*(\d{3,4})\b/);
  if (radeonHd) return `radeon-${radeonHd[1]}-${radeonHd[2]}`;
  // Do not let an AMD "Radeon HD 620" borrow the generic Intel HD token below.
  if (/\bradeon\b/.test(text)) return 'amd-integrated';
  const arc = text.match(/\barc(?:\s*\(tm\))?\s+([ab]\d{3}m?)\b/);
  if (arc) return `intel-arc-${arc[1]}`;
  if (/\biris(?:\(r\)|\(tm\))?\s*xe\b/.test(text)) return 'intel-iris-xe';
  const intel = text.match(/\b(hd|uhd|iris)\s+(?:graphics\s*)?(\d{3})\b/);
  if (intel) return `intel-${intel[1]}-${intel[2]}`;
  if (/\bswiftshader\b/.test(text)) return 'swiftshader';
  if (/\bllvmpipe\b/.test(text)) return 'llvmpipe';
  if (/\bsoftpipe\b/.test(text)) return 'softpipe';
  if (/\bpowervr\b/.test(text)) return 'powervr';
  return id;
}

// Classify one identity string. Returns null when the text is empty or hides the model (Safari), so the caller can
// fall back to the touch/CPU/memory rules instead of guessing.
function classifyGpuText(text) {
  if (!text) return null;
  if (SOFTWARE_GPU.test(text)) {
    return { quality: 'low', id: 'software', model: gpuModel('software', text) };
  }
  const appleM = text.match(APPLE_M_GPU);
  if (appleM) return { quality: 'high', id: 'apple-m', model: `apple-m${appleM[1]}` };
  const appleA = text.match(APPLE_A_GPU);
  if (appleA) {
    const generation = Number(appleA[1]);
    return {
      quality: generation >= 14 ? 'high' : 'low',
      id: generation >= 14 ? 'apple-a14-plus' : 'apple-a-old',
      model: `apple-a${generation}`
    };
  }
  for (const rule of GPU_RULES) {
    if (rule.test.test(text)) return { quality: rule.quality, id: rule.id, model: gpuModel(rule.id, text) };
  }
  return null;
}

// Classify one adapter. The WebGL renderer and the adapter fields are classified separately: on a hybrid laptop they
// can name different GPUs, and the WebGL probe may land on the integrated one. A weak signal from either source wins
// over a strong one from the other, so the mismatch is conservative (a false low, never a false high). A strong signal
// is only used when neither source says weak.
function classifyGpu(gpu = {}) {
  const identity = gpu || {};
  if (identity.isFallbackAdapter) return { quality: 'low', id: 'fallback', model: 'fallback' };
  const rendererClass = classifyGpuText(gpuText({
    renderer: identity.renderer,
    rendererVendor: identity.rendererVendor
  }));
  const adapterClass = classifyGpuText(gpuText({
    vendor: identity.vendor,
    architecture: identity.architecture,
    device: identity.device,
    description: identity.description
  }));
  if (rendererClass?.quality === 'low') return rendererClass;
  if (adapterClass?.quality === 'low') return adapterClass;
  if (rendererClass?.quality === 'high') return rendererClass;
  if (adapterClass?.quality === 'high') return adapterClass;
  return null;
}

// The reason string is for the boot log and `body[data-quality-reason]`: url:*, gpu:*, backend:webgl2, cpu:*,
// memory:*, touch:unknown-gpu or default:high. A weak/software GPU is named before the backend so a WebGL2 review on
// an Intel laptop still says which GPU caused low.
function decideQuality({
  url = null, webgl = false, coarsePointer = false, finePointer = false, hardwareConcurrency = null,
  deviceMemory = null, gpu = null
} = {}) {
  const fromUrl = normaliseQuality(url);
  if (fromUrl) return { quality: fromUrl, reason: `url:${fromUrl}` };
  const gpuClass = classifyGpu(gpu);
  if (gpuClass?.quality === 'low') return { quality: 'low', reason: `gpu:${gpuClass.model}` };
  if (webgl) return { quality: 'low', reason: 'backend:webgl2' };
  if (Number.isFinite(hardwareConcurrency) && hardwareConcurrency > 0 && hardwareConcurrency <= 4) {
    return { quality: 'low', reason: `cpu:${hardwareConcurrency}-threads` };
  }
  if (Number.isFinite(deviceMemory) && deviceMemory > 0 && deviceMemory <= 4) {
    return { quality: 'low', reason: `memory:${deviceMemory}gb` };
  }
  // A strong GPU can lift a touch-first tablet out of the touch rule, but only after the CPU and memory checks: the
  // high tier's 340 rigs and traffic are still CPU-heavy.
  if (gpuClass?.quality === 'high') return { quality: 'high', reason: `gpu:${gpuClass.model}` };
  if (isTouchFirstDevice({ coarsePointer, finePointer })) return { quality: 'low', reason: 'touch:unknown-gpu' };
  return { quality: 'high', reason: 'default:high' };
}

// The device default only starts low on hardware that cannot carry the high preset: a weak/software GPU, the WebGL2
// fallback, four or fewer CPU threads, 4 GB of memory or less, or a touch-first device whose GPU is unknown.
function detectQuality(device = {}) {
  return decideQuality({ ...device, url: null }).quality;
}

// An explicit ?quality=low|high wins over the device default. The choice is fixed for the page load; the link in the
// brand line only reloads with the other value.
function resolveQuality({ url = null, ...device } = {}) {
  return decideQuality({ ...device, url }).quality;
}

// Same decision with the reason, for `body[data-quality-reason]` and the one-line boot log.
function resolveQualityDecision({ url = null, ...device } = {}) {
  return decideQuality({ ...device, url });
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
  classifyGpu,
  detectQuality,
  resolveQuality,
  resolveQualityDecision,
  clearStoredQuality
};
