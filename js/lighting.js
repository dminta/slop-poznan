import * as THREE from 'three/webgpu';
import {
  Fn,
  float,
  vec3,
  vec4,
  uniform,
  mix,
  fog,
  pmremTexture,
  positionWorld,
  cameraPosition,
  length,
  normalize,
  max,
  exp,
  abs,
  select
} from 'three/tsl';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { SunLight } from 'three/addons/lights/SunLight.js';
import { SunLightNode } from 'three/addons/lights/SunLightNode.js';
import { cityUniforms } from './tsl-materials.js';

// js/lighting.js
// Physically-Based Atmospheric Sky (Preetham SkyMesh + Beer-Powder Clouds),
// Live PMREMGenerator IBL Cubemap, Three.js r186 SunLight (2-Cascade CSM),
// and Occlusion-Aware Urban Canyon Global Illumination for Three.js r186 WebGPURenderer

const DEG = Math.PI / 180;
// The solar position is computed for central Poznań (the frame origin at the Ratusz, 52.40856 N 16.93401 E, rounded),
// and the world's −z axis points at true bearing FRAME_BEARING_DEG (GEO.frame.bearingDeg: 0, the frame is not turned)
const SUN_LAT = 52.41;
const SUN_LON = 16.93;
const FRAME_BEARING_DEG = 0;

// The sun's position at `date` seen from (lat, lon), in degrees: azimuth clockwise from true north, and the geometric
// elevation above the horizon (no refraction: the apparent sunset is at −0.83°). NOAA's solar calculator equations
// (Meeus, Astronomical Algorithms), good to about 0.01° in 1800–2100. For Poznań they give a noon elevation of 61.0° at
// the summer solstice, 37.5° at the equinoxes and 14.2° at the winter solstice, and on 2026-06-21 solar noon at 12:53
// CEST and sunset at 21:18 CEST (15:40 CET on 2026-12-21); tests/lighting.test.cjs checks these
function sunPosition(date, lat = SUN_LAT, lon = SUN_LON) {
  const t = (date.getTime() / 86400000 + 2440587.5 - 2451545) / 36525; // Julian centuries since J2000.0
  const L0 = (((280.46646 + t * (36000.76983 + t * 0.0003032)) % 360) + 360) % 360; // geometric mean longitude
  const M = 357.52911 + t * (35999.05029 - 0.0001537 * t); // mean anomaly
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t); // orbit eccentricity
  const center = Math.sin(M * DEG) * (1.914602 - t * (0.004817 + 0.000014 * t))
    + Math.sin(2 * M * DEG) * (0.019993 - 0.000101 * t) + Math.sin(3 * M * DEG) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const lambda = L0 + center - 0.00569 - 0.00478 * Math.sin(omega * DEG); // apparent longitude
  const eps = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60
    + 0.00256 * Math.cos(omega * DEG); // corrected obliquity of the ecliptic
  const decl = Math.asin(Math.sin(eps * DEG) * Math.sin(lambda * DEG));
  const y = Math.tan(eps * DEG / 2) ** 2;
  const eqTime = 4 / DEG * (y * Math.sin(2 * L0 * DEG) - 2 * e * Math.sin(M * DEG)
    + 4 * e * y * Math.sin(M * DEG) * Math.cos(2 * L0 * DEG) - 0.5 * y * y * Math.sin(4 * L0 * DEG)
    - 1.25 * e * e * Math.sin(2 * M * DEG)); // minutes
  const utcMinutes = (((date.getTime() / 60000) % 1440) + 1440) % 1440;
  const hourAngle = ((utcMinutes + eqTime + 4 * lon) / 4 - 180) * DEG; // true solar time, 0 at solar noon
  const phi = lat * DEG;
  const elevation = Math.asin(Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(hourAngle));
  const azimuth = Math.atan2(Math.sin(hourAngle), Math.cos(hourAngle) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi));
  return { azimuth: azimuth / DEG + 180, elevation: elevation / DEG };
}

// The world-frame unit vector toward (azimuth, elevation) in degrees: x east, y up, z south (north = −z)
function sunVector(azimuth, elevation, target = new THREE.Vector3()) {
  const a = (azimuth - FRAME_BEARING_DEG) * DEG;
  const c = Math.cos(elevation * DEG);
  return target.set(Math.sin(a) * c, Math.sin(elevation * DEG), -Math.cos(a) * c);
}

// Each preset is a real moment in Poznań: `when` is the local time (Europe/Warsaw, its UTC offset spelled out), and
// sunDir is computed from it below. Under the horizon neither the Preetham sky (black once the sun is ≈ 2.3° down) nor
// a shadow-casting light works, so a preset may raise the rendered sun to `minElevation` over the real sun's azimuth:
// the afterglow at dusk, the north-western glow of a midsummer night (the sun is only 10–14° down at 23:00–01:00).
// sunAzimuth / sunElevation keep the real position.
const TIME_PRESETS = {
  golden: {
    id: 'golden',
    name: 'Golden Hour · 17:45',
    // An hour before sunset in late September: the sun 8° up in the west-south-west, so long sharp shadows slice across
    // the streets
    when: '2026-09-25T17:45+02:00', // CEST
    sunColor: 0xffca92,
    sunIntensity: 5.8,
    hemiSky: 0x9abbe6,
    hemiGround: 0xc88a62, // Warm terracotta / limestone upward canyon bounce
    hemiIntensity: 1.48,
    skyTop: 0x2c568c,
    skyHorizon: 0xebd1b5,
    fogColor: 0xdcc5ae,
    fogDensity: 0.00024,
    interiorGlow: 0.48,
    roadWetness: 0.28,
    envIntensity: 0.54,
    canyonBounce: 0.52,
    turbidity: 8.0,
    rayleigh: 2.8,
    mieCoefficient: 0.008,
    mieDirectionalG: 0.88,
    cloudCoverage: 0.36,
    cloudDensity: 0.38,
    skyExposure: 0.148,
    nightFactor: 0.0
  },
  midday: {
    id: 'midday',
    name: 'Sunny Midday · 13:30',
    // Midsummer, 37 min after solar noon: the sun 60° up, a little west of south
    when: '2026-06-21T13:30+02:00', // CEST
    sunColor: 0xfff5e8,
    sunIntensity: 6.6,
    hemiSky: 0xaad2ff,
    hemiGround: 0xb89678, // Warm sunlit masonry & pavement bounce
    hemiIntensity: 1.58,
    skyTop: 0x225ea8,
    skyHorizon: 0xc8dff5,
    fogColor: 0xc6dcf2,
    fogDensity: 0.00018,
    interiorGlow: 0.24,
    roadWetness: 0.08,
    envIntensity: 0.58,
    canyonBounce: 0.58,
    turbidity: 6.5,
    rayleigh: 2.4,
    mieCoefficient: 0.006,
    mieDirectionalG: 0.86,
    cloudCoverage: 0.32,
    cloudDensity: 0.35,
    skyExposure: 0.142,
    nightFactor: 0.0
  },
  twilight: {
    id: 'twilight',
    name: 'Blue Hour · 19:15',
    // The same late-September evening as golden, 36 min after sunset: the sun 5.6° down in the west, its afterglow
    // the key light
    when: '2026-09-25T19:15+02:00', // CEST
    minElevation: 10,
    sunColor: 0xff9466,
    sunIntensity: 3.1,
    hemiSky: 0x4c6ca8,
    hemiGround: 0x6e5048,
    hemiIntensity: 0.85,
    skyTop: 0x102248,
    skyHorizon: 0xb86b6c,
    fogColor: 0x353c58,
    fogDensity: 0.00032,
    interiorGlow: 1.25,
    roadWetness: 0.55,
    envIntensity: 0.36,
    canyonBounce: 0.32,
    turbidity: 9.5,
    rayleigh: 3.4,
    mieCoefficient: 0.010,
    mieDirectionalG: 0.90,
    cloudCoverage: 0.40,
    cloudDensity: 0.42,
    skyExposure: 0.115,
    nightFactor: 0.28
  },
  midnight: {
    id: 'midnight',
    name: 'Poznań Night · 23:00',
    // Midsummer: the sun only 10° down in the north-north-west, so the night stays a blue twilight; the cold key light
    // is that glow, raised to keep the streets readable
    when: '2026-06-21T23:00+02:00', // CEST
    minElevation: 30,
    sunColor: 0x8cb0e8,
    sunIntensity: 1.45,
    hemiSky: 0x263a62,
    hemiGround: 0x382e36,
    hemiIntensity: 0.72,
    skyTop: 0x060c1a,
    skyHorizon: 0x182640,
    fogColor: 0x0c1424,
    fogDensity: 0.00036,
    interiorGlow: 1.55,
    roadWetness: 0.62,
    envIntensity: 0.30,
    canyonBounce: 0.18,
    turbidity: 4.0,
    rayleigh: 1.5,
    mieCoefficient: 0.004,
    mieDirectionalG: 0.80,
    cloudCoverage: 0.22,
    cloudDensity: 0.25,
    skyExposure: 0.022,
    nightFactor: 0.86
  }
};

for (const preset of Object.values(TIME_PRESETS)) {
  const sun = sunPosition(new Date(preset.when));
  preset.sunAzimuth = sun.azimuth;
  preset.sunElevation = sun.elevation;
  preset.sunDir = sunVector(sun.azimuth, Math.max(sun.elevation, preset.minElevation ?? -90));
}

class LightingSystem {
  constructor(scene, renderer = null) {
    this.scene = scene;
    this.renderer = renderer;
    this.activePresetId = 'golden';

    // Assign SunLight its node implementation for WebGPURenderer (Light.registerNode since r187; r186 used the library)
    if (SunLight.registerNode) {
      SunLight.registerNode(SunLightNode);
    } else if (renderer && renderer.library) {
      renderer.library.addLight(SunLightNode, SunLight);
    }

    this.scene.fog = new THREE.FogExp2(0xdcc5ae, 0.00024);
    // Leave scene.background = null because SkyMesh renders the 360° sky dome, and setting
    // a THREE.Color on scene.background sets forceClear=true in WebGPURenderer's Background.update,
    // which would otherwise clear Cascade 0 when rendering Cascade 1 in SunShadowNode!
    this.scene.background = null;

    // Physical Preetham SkyMesh + Beer-Powder Clouds (from three/addons/objects/SkyMesh.js). Its unit box must contain
    // the camera wherever the helicopter flies (up to 6 km past the 6.1 × 3.7 km detail box); it renders at the far
    // plane whatever its size
    this.sky = new SkyMesh();
    this.sky.scale.setScalar(200000);
    this.sky.turbidity.value = 8.0;
    this.sky.rayleigh.value = 2.8;
    this.sky.mieCoefficient.value = 0.008;
    this.sky.mieDirectionalG.value = 0.88;
    this.sky.cloudScale.value = 0.00018;
    this.sky.cloudSpeed.value = 0.000015;
    this.sky.cloudCoverage.value = 0.36;
    this.sky.cloudDensity.value = 0.38;
    this.sky.cloudElevation.value = 0.52;

    // Calibrate SkyMesh raw radiance (EE=1000 * 0.04) into standard exposure=1.0 HDR range
    this.uSkyExposure = uniform(0.148);
    this.uNightFactor = uniform(0.0);
    this.uNightSkyColor = uniform(new THREE.Color(0x0b1528));
    const rawSkyNode = this.sky.material.colorNode;
    this.sky.material.colorNode = Fn(() => {
      const raw = rawSkyNode;
      const dayCol = raw.rgb.mul(this.uSkyExposure);
      const finalSky = mix(dayCol, this.uNightSkyColor, this.uNightFactor);
      return vec4(finalSky, float(1.0));
    })();

    // In reversedDepthBuffer mode ([1..0]), camera.far is z = 0.0 (whereas SkyMesh defaults to z = w)
    if (renderer && renderer.reversedDepthBuffer) {
      const rawSkyVertexNode = this.sky.material.vertexNode;
      this.sky.material.vertexNode = Fn(() => {
        const pos = rawSkyVertexNode.toVar();
        pos.z.assign(0.0);
        return pos;
      })();
    }

    this.scene.add(this.sky);

    // Reusable PMREMGenerator & offscreen envScene (mirrors webgpu_generator_city.html)
    this.pmremGenerator = renderer ? new THREE.PMREMGenerator(renderer) : null;
    this.envScene = new THREE.Scene();
    this.envRenderTarget = null;

    // Three.js r186 SunLight with automatic 2-Cascade Shadow Map (SunLightShadow + SunShadowNode)
    // Shines from its position vector toward the origin (no .target needed)
    this.sunLight = new SunLight(0xffca92, 5.8);
    this.sunLight.position.copy(TIME_PRESETS.golden.sunDir);
    this.sunLight.castShadow = true;
    // 3072x3072 per cascade = 6144x3072 2-cascade shadow atlas (an 8192x4096 one cost ~20% fps and caused hitches),
    // 2048 where the device allows less. The near cascade spans ~0.35-80 m of the view at street level (see update)
    const maxTex = (renderer && renderer.backend && renderer.backend.device && renderer.backend.device.limits.maxTextureDimension2D) || 4096;
    const tile = maxTex >= 6144 ? 3072 : 2048;
    this.sunLight.shadow.mapSize.set(tile, tile);
    this.sunLight.shadow.camera.near = 0.5;
    this.sunLight.shadow.camera.far = 300;
    // Suppress shadow acne along the surface normal in world units
    // so short casters like cars, curbs, tree trunks, and pedestrians keep crisp contact shadows
    this.sunLight.shadow.normalBias = 0.05;
    this.scene.add(this.sunLight);

    // Subtle Hemisphere Sky + Warm Terracotta/Limestone Ground Bounce Fill
    // (Kept intentionally lower than sunLight so urban canyon shadows remain deep and crisp)
    this.hemiLight = new THREE.HemisphereLight(0x9abbe6, 0xc88a62, 1.05);
    this.hemiLight.position.set(0, 300, 0);
    this.scene.add(this.hemiLight);

    this.applyPreset('golden');

    // Sky-matched aerial perspective (replaces the flat FogExp2 colour): distant surfaces fade into the baked sky
    // radiance just above the horizon in their view direction (sun glow included), through an exponential haze layer
    // so helicopter / Bałtyk terrace views stay clearer than the horizon.
    this.uFogDensity = uniform(TIME_PRESETS.golden.fogDensity);
    this.uFogHeight = uniform(900.0);
    if (this.envRenderTarget) this.scene.fogNode = this.createAerialFogNode();
  }

  createAerialFogNode() {
    const toFrag = positionWorld.sub(cameraPosition);
    const dist = length(toFrag);
    const dir = toFrag.div(max(dist, 0.001));
    const horizonDir = normalize(vec3(dir.x, max(dir.y, 0.015), dir.z));
    const skyColor = pmremTexture(this.envRenderTarget.texture, horizonDir, float(0.3)).rgb;
    // Mean haze density exp(-y / H) along the ray between the fragment and the camera
    const H = this.uFogHeight;
    const ya = max(positionWorld.y, 0.0);
    const yb = max(cameraPosition.y, 0.0);
    const dy = yb.sub(ya);
    const ea = exp(ya.div(H).negate());
    const eb = exp(yb.div(H).negate());
    const meanDensity = select(abs(dy).greaterThan(1.0), ea.sub(eb).mul(H).div(dy), ea);
    const tau = this.uFogDensity.mul(dist).mul(meanDensity);
    return fog(skyColor, float(1.0).sub(exp(tau.mul(tau).negate())));
  }

  bakeEnvironmentMap() {
    if (!this.pmremGenerator) return;
    // Bake physical SkyMesh (without solar disc) into scene.environment for realistic canyon IBL.
    // Reuses a single RenderTarget so texture identity never changes.
    this.sky.showSunDisc.value = 0;
    this.envScene.add(this.sky);
    this.envRenderTarget = this.pmremGenerator.fromScene(this.envScene, 0, 0.1, 100, {
      renderTarget: this.envRenderTarget
    });
    this.scene.environment = this.envRenderTarget.texture;
    this.sky.showSunDisc.value = 1;
    this.scene.add(this.sky);
  }

  applyPreset(presetId, force = false) {
    const p = TIME_PRESETS[presetId] || TIME_PRESETS.golden;
    if (!force && this.activePresetId === p.id && this.envRenderTarget !== null) {
      return;
    }
    this.activePresetId = p.id;

    this.sunLight.color.setHex(p.sunColor);
    this.sunLight.intensity = p.sunIntensity;
    this.sunLight.position.copy(p.sunDir);
    this.sunLight.updateMatrixWorld();

    this.hemiLight.color.setHex(p.hemiSky);
    this.hemiLight.groundColor.setHex(p.hemiGround);
    this.hemiLight.intensity = p.hemiIntensity;

    this.scene.fog.color.setHex(p.fogColor);
    this.scene.fog.density = p.fogDensity;
    if (this.uFogDensity) this.uFogDensity.value = p.fogDensity;

    // Update physical Preetham SkyMesh uniforms
    this.sky.turbidity.value = p.turbidity;
    this.sky.rayleigh.value = p.rayleigh;
    this.sky.mieCoefficient.value = p.mieCoefficient;
    this.sky.mieDirectionalG.value = p.mieDirectionalG;
    this.sky.cloudCoverage.value = p.cloudCoverage;
    this.sky.cloudDensity.value = p.cloudDensity;
    this.sky.sunPosition.value.copy(p.sunDir);
    this.uSkyExposure.value = p.skyExposure;
    this.uNightFactor.value = p.nightFactor;

    cityUniforms.uSunColor.value.setHex(p.sunColor);
    cityUniforms.uSkyTopColor.value.setHex(p.skyTop);
    cityUniforms.uSkyHorizonColor.value.setHex(p.skyHorizon);
    cityUniforms.uSkySunDir.value.copy(p.sunDir);
    cityUniforms.uInteriorGlow.value = p.interiorGlow;
    cityUniforms.uRoadWetness.value = p.roadWetness;
    if (cityUniforms.uCanyonBounce) {
      cityUniforms.uCanyonBounce.value = p.canyonBounce;
    }

    this.scene.environmentIntensity = p.envIntensity;
    this.bakeEnvironmentMap();
  }

  update(focusPos) {
    // SunLightShadow automatically fits & texel-snaps its 2 cascades to the view camera frustum
    // every frame inside SunShadowNode.renderShadow(), splitting [near, far] halfway between a uniform and a
    // logarithmic split (the near cascade ends at ~far / 4). Keep far at 300 m at street level so the near cascade
    // stays sharp, and expand it with altitude (helicopter / Bałtyk terrace) so shadows reach all the way down to street level.
    const altitude = focusPos && Number.isFinite(focusPos.y) ? Math.max(0, focusPos.y) : 0;
    this.sunLight.shadow.camera.far = Math.max(300, Math.min(720, 260 + altitude * 1.6));
  }
}

export { LightingSystem, TIME_PRESETS, sunPosition, sunVector };
