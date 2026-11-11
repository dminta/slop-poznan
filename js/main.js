import * as THREE from 'three/webgpu';
import { pass, mrt, output, normalView, positionView, metalness, roughness, vec2, smoothstep } from 'three/tsl';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { createPostProcessing } from './post-processing.js';
import { ClusteredLighting } from 'three/addons/lighting/ClusteredLighting.js';
import { getLocationLabel, STREET_JOIN, districtAt, isTypingInField, formatCount, ROADS, CITY_LANDMARKS, TELEPORT_LOCATIONS } from './city-config.js';
import { buildCityGrid, railClearance } from './city-grid.js';
import { buildAirport } from './airport.js';
import { buildCanopies } from './canopies.js';
import { buildOutskirts } from './outskirts.js';
import { buildBridges } from './bridges.js';
import { buildLandmarks } from './landmarks.js';
import { buildCityBlocks } from './buildings.js';
import { buildStreetDetails, plateLabel } from './street-details.js';
import { createTrafficSystem } from './traffic.js';
import { createTramSystem } from './trams.js';
import { buildRoadPaint } from './road-paint.js';
import { buildTramInfrastructure, layoutTramInfrastructure, layoutRailInfrastructure } from './tram-infra.js';
import { ThirdPersonControllerManager } from './controllers.js';
import { TouchControls } from './touch-controls.js';
import { GamepadControls } from './gamepad-controls.js';
import { CameraSystem, CAMERA_PRESETS } from './cameras.js';
import { LightingSystem } from './lighting.js';
import { CityMapSystem } from './city-map.js';
import { setupSceneCulling, updateSceneCulling } from './scene-culling.js';
import { collectDynamicRoots, freezeStaticMatrices, updateDynamicMatrices } from './static-matrices.js';
import { CityAudioSystem } from './audio-system.js';
import { QUALITY_TIERS, resolveQuality, clearStoredQuality } from './graphics-quality.js';
import { PerfStats } from './perf-stats.js';

// js/main.js
// Main entry point for Poznań in Three.js WebGPURenderer & TSL (three.js dev, see index.html)

async function initApp() {
  const container = document.getElementById('canvas-container');
  const loadingOverlay = document.getElementById('loading-overlay');
  const loadingStatus = document.getElementById('loading-status');
  const loadingTrack = loadingOverlay ? loadingOverlay.querySelector('.loader-track') : null;
  const loadingFill = document.getElementById('loading-progress');
  // The loading bar sweeps while the city is being built (the main thread is busy) and fills as the shaders compile
  const setLoadingProgress = (p) => {
    if (!loadingFill) return;
    if (loadingTrack) loadingTrack.classList.remove('is-indeterminate');
    loadingFill.style.transform = `scaleX(${Math.min(1, Math.max(0, p))})`;
  };

  if (loadingStatus) {
    loadingStatus.textContent = `Inicjalizacja Three.js r${THREE.REVISION} WebGPURenderer i shaderów TSL…`;
  }

  // 1. Initialize Three.js WebGPURenderer with 32-bit float reversedDepthBuffer
  // ?backend=webgl forces the WebGL2 fallback for browser reviews without touching the default WebGPU path.
  const query = new URLSearchParams(window.location.search);
  const forceWebGL = query.get('backend') === 'webgl';
  const statsEnabled = query.get('stats') === '1';
  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    powerPreference: 'high-performance',
    reversedDepthBuffer: true,
    forceWebGL
  });
  renderer.setPixelRatio(1.0);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.lighting = new ClusteredLighting(256, 32, 28, 48);
  container.appendChild(renderer.domElement);

  // Start-up phase timings (logged once as "[init] ...") to keep load-time regressions traceable
  let initTimings = [];
  let initMark = performance.now();
  const markInit = (label) => {
    const now = performance.now();
    initTimings.push(`${label} ${Math.round(now - initMark)}ms`);
    initMark = now;
  };

  await renderer.init();
  markInit('renderer');

  // Quality is fixed for this page load: ?quality=low|high wins, otherwise a touch-first phone/tablet, the actual
  // WebGL2 backend (forced or a silent fallback), <= 4 threads or <= 4 GB starts low. Only this tier is built below;
  // a runtime switch would recompile every pipeline for the other attachment layout and freeze for seconds.
  const activeQuality = resolveQuality({
    url: query.get('quality'),
    webgl: !renderer.backend.isWebGPUBackend,
    coarsePointer: window.matchMedia('(pointer: coarse)').matches,
    finePointer: window.matchMedia('(pointer: fine)').matches,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: navigator.deviceMemory
  });
  clearStoredQuality(); // the removed toolbar toggle's key; drop a stale choice from the previous build
  document.body.dataset.quality = activeQuality;
  const qualitySettings = QUALITY_TIERS[activeQuality];

  // The brand line shows the tier this page loaded with. Its link is a full reload with the other value: a runtime
  // switch would rebuild the pass layout, which is the multi-second freeze this replaced.
  const qualityWords = { high: ['wysoka', 'wysoką'], low: ['niska', 'niską'] };
  const nextQuality = activeQuality === 'low' ? 'high' : 'low';
  const qualityLabel =
    `Grafika: ${qualityWords[activeQuality][0]} — przełącz na ${qualityWords[nextQuality][1]} (przeładuje stronę)`;
  const qualityLink = document.getElementById('quality-link');
  if (qualityLink) {
    const target = new URL(window.location.href);
    target.searchParams.set('quality', nextQuality);
    qualityLink.href = target.href;
    const tier = qualityLink.querySelector('.quality-tier');
    if (tier) tier.textContent = `: ${qualityWords[activeQuality][0]}`;
    qualityLink.title = qualityLabel;
    qualityLink.setAttribute('aria-label', qualityLabel);
  }

  renderer.setPixelRatio(qualitySettings.pixelRatio);

  // 2. Build Scene & Physical Atmospheric Sky / PMREM IBL / 4096x4096 Shadow Lighting
  const scene = new THREE.Scene();
  const lightingSystem = new LightingSystem(scene, renderer, activeQuality);
  markInit('lighting');

  if (loadingStatus) {
    loadingStatus.textContent = 'Budowanie ulic, zabytków i zabudowy Poznania…';
  }

  // 3. Build Poznań's Geography, Bridges, Landmarks, Blocks, Street Details & Traffic
  const landmarks = buildLandmarks(scene);
  const landmarkColliders = landmarks.colliders;
  markInit('landmarks');
  const cityBlocks = buildCityBlocks(scene);
  markInit('blocks');
  const buildingColliders = [...landmarkColliders, ...cityBlocks.colliders];
  const cityGrid = buildCityGrid(scene, {
    buildingFootprints: cityBlocks.footprintsByBlock,
    buildingColliders
  });
  markInit('cityGrid');
  // Ławica is cut out of the block raster, so its runway, taxiways, aprons and terminals are their own layer.
  const airport = buildAirport(scene);
  markInit('airport');
  // Open platform, tram-stop and forecourt canopies stand above the ground actors; only their columns collide
  const canopies = buildCanopies(scene);
  markInit('canopies');
  cityBlocks.populateLeftoverSlabs?.();
  const outskirts = buildOutskirts(scene);
  markInit('outskirts');
  const bridges = buildBridges(scene, { sidewalks: cityGrid.sidewalks });
  markInit('bridges');
  const allColliders = [
    ...landmarkColliders, ...cityBlocks.colliders, ...airport.colliders, ...canopies.colliders, ...outskirts.colliders,
    ...bridges.colliders, ...(cityGrid.colliders || [])
  ];

  // the building walls carry the street name plates at the signalised corners
  const streetDetails = buildStreetDetails(scene, { buildingColliders: allColliders, grid: cityGrid });
  markInit('streetDetails');
  // Buildings turned along non-grid streets have oriented colliders whose world bounds reach past their lots: they stay
  // inside the property line anyway, so the road network (lanes & sidewalks) doesn't need them.
  // Elevated building sections that clear even a bus don't obstruct ground traffic.
  const trafficSystem = createTrafficSystem(scene, cityGrid.sidewalks, [
    ...cityGrid.footprints,
    ...streetDetails.footprints,
    ...allColliders.filter((c) => !c.obb && (c.minY ?? 0) < 3.5)
  ], streetDetails.roadNetwork, buildingColliders, {
    population: qualitySettings.population
  });
  const tramLayout = layoutTramInfrastructure(trafficSystem.network);
  const railLayout = layoutRailInfrastructure(trafficSystem.network);
  const signalSupports = [...tramLayout.poles, ...railLayout.masts];
  streetDetails.addRuntimeSignalHeads(trafficSystem.network, trafficSystem.pedestrianRoutes, signalSupports);
  markInit('traffic');
  // The street furniture's player colliders join only now: its footprints already went to the network above
  allColliders.push(...streetDetails.colliders);
  // Likewise the square & park benches, lampposts, planters and tree trunks: none on the network's sidewalks
  allColliders.push(...cityGrid.propColliders);
  buildRoadPaint(scene, trafficSystem.network, trafficSystem.crosswalks, railClearance);
  markInit('roadPaint');
  // Rails, overhead line and stops, placed clear of the car lanes just built (none of it is a traffic obstacle);
  // the player collides with the poles and stop furniture; with the mainline railway's masts, end walls and fence too,
  // and its corridor (tramInfra.railCorridor) is a keep-out for the ground modes
  const tramInfra = buildTramInfrastructure(scene, trafficSystem.network, { tram: tramLayout, rail: railLayout });
  allColliders.push(...tramInfra.colliders);
  markInit('tramInfra');
  // Trams on the GEO.rail track graph, stopping at tramInfra's platforms and held at the road network's signals. They
  // brake for the cars and the player in their way; the cars yield to them and pedestrians wait (traffic.js setTrams)
  const tramSystem = createTramSystem(scene, {
    network: trafficSystem.network,
    stops: tramInfra.stops,
    traffic: trafficSystem
  });
  trafficSystem.setTrams(tramSystem);
  markInit('trams');

  // 4. Initialize Third-Person Controllers (Person, Car, Cyclist, Helicopter) & Multi-Camera System
  const controllerManager = new ThirdPersonControllerManager(scene, allColliders, { keepOut: tramInfra.railCorridor });
  // Reuse teleport placement so saved players return at rest, close to their last positions.
  // Version 2 is Poznań: a version 1 state (and the old 'nyc-player-state' key) holds a Manhattan position, which is
  // discarded rather than restored into Poznań.
  try {
    localStorage.removeItem('nyc-player-state');
    const saved = JSON.parse(localStorage.getItem('player-state'));
    if (saved?.version === 2) {
      for (const mode of Object.keys(controllerManager.entities)) {
        const p = saved.entities?.[mode];
        if (!p || ![p.x, p.y, p.z, p.heading].every(Number.isFinite)) continue;
        controllerManager.setMode(mode);
        controllerManager.teleportActiveTo(p.x, p.z, p.heading, p.y);
      }
      controllerManager.setMode(Object.hasOwn(controllerManager.entities, saved.activeMode) ? saved.activeMode : 'car');
    }
  } catch { /* Missing or unavailable storage does not prevent playing. */ }

  function savePlayerState() {
    try {
      const entities = Object.fromEntries(Object.entries(controllerManager.entities).map(([mode, entity]) => [mode, {
        x: entity.position.x, y: entity.position.y, z: entity.position.z, heading: entity.heading
      }]));
      localStorage.setItem('player-state', JSON.stringify({ version: 2, activeMode: controllerManager.activeMode, entities }));
    } catch { /* Storage may be disabled or full. */ }
  }

  const cameraSystem = new CameraSystem(renderer.domElement, controllerManager);
  const touchControls = new TouchControls(controllerManager);
  const soundButton = document.getElementById('btn-sound');
  const audioSystem = new CityAudioSystem({ controllerManager, trafficSystem, tramSystem, streetDetails }, {
    onStateChange: updateSoundButton
  });
  function updateSoundButton() {
    if (!soundButton) return;
    soundButton.disabled = !audioSystem.supported;
    soundButton.setAttribute('aria-pressed', String(audioSystem.enabled));
    soundButton.setAttribute('aria-label', audioSystem.enabled ? 'Wycisz dźwięk' : 'Włącz dźwięk');
    soundButton.title = audioSystem.supported ? `${audioSystem.enabled ? 'Wycisz' : 'Włącz'} dźwięk [N]` : 'Dźwięk niedostępny (brak Web Audio)';
    soundButton.querySelector('use').setAttribute('href', audioSystem.enabled ? '#i-sound' : '#i-sound-off');
  }
  soundButton?.addEventListener('click', () => audioSystem.setEnabled(!audioSystem.enabled));
  updateSoundButton();

  // pagehide also covers navigation away on mobile; preserve the context across back-forward cache restores.
  window.addEventListener('pagehide', (event) => {
    savePlayerState();
    if (!event.persisted) audioSystem.dispose();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) savePlayerState();
  });
  markInit('controllers');

  // City-wide static geometry: chunk & distance-cull the small props, shadow stand-ins for the big casters
  // (scene-culling.js)
  const cullingRoots = ['CityGrid', 'Airport', 'CityBlocks', 'Canopies', 'StreetDetails', 'Landmarks', 'Outskirts', 'Bridges', 'TramInfrastructure']
    .map((name) => scene.getObjectByName(name))
    .filter(Boolean);
  setupSceneCulling(scene, cullingRoots, lightingSystem.sunLight.shadow);
  markInit('culling');

  // On WebGPU, small InstancedMeshes (<= 1000 instances) keep their matrices in uniform buffers that three.js
  // re-uploads on every draw of every pass (~2.5 MB/frame with the shadow cascades, stalling the GPU queue).
  // Storage attributes only upload when needed; WebGL2 needs ordinary instanced attributes for correct transforms.
  if (renderer.backend.isWebGPUBackend) {
    scene.traverse((object) => {
      if (object.isInstancedMesh) {
        object.instanceMatrix = new THREE.StorageInstancedBufferAttribute(object.instanceMatrix.array, 16);
      }
    });
  }

  // The city no longer moves after the build. Freeze the scene's world matrices, which three.js would otherwise
  // recompute for all 41k meshes in every pass (18.4% of frame CPU in the 2026-11-11 audit), and keep only the roots
  // that really move updated every frame (static-matrices.js, docs/rendering.md).
  const dynamicRoots = collectDynamicRoots(scene, lightingSystem, controllerManager);
  freezeStaticMatrices(scene, dynamicRoots);

  // The low tier keeps the building and landmark shadow proxies baked by scene-culling but turns off tree, street
  // furniture/prop, tram and city-grid casters. Apply that once at boot; high leaves every caster exactly as built.
  if (!qualitySettings.shadowCasters) {
    for (const name of ['StreetDetails', 'CityGrid', 'TramInfrastructure', 'Trams']) {
      scene.getObjectByName(name)?.traverse((object) => {
        if (object.isMesh) object.castShadow = false;
      });
    }
  }

  // Materials with an explicit mrtNode (transparent decals/effects) assume the scene pass has the normal and metalRough
  // attachments. The low tier renders a single colour target for the whole page load, so clear their MRT graph once;
  // high keeps every mrtNode.
  if (!qualitySettings.postProcessing.ssr) {
    scene.traverse((object) => {
      const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
      for (const material of materials) {
        if (!material.mrtNode) continue;
        material.mrtNode = null;
        material.needsUpdate = true;
      }
    });
  }

  // 5. TSL RenderPipeline: half-res screen-space reflections, bloom and filmic toning on the high tier; a plain
  //    grading pass (no MRT, no SSR, no bloom) on the low tier. Only the chosen layout is ever built: switching would
  //    recompile every scene pipeline for the other attachment layout, which is the freeze this replaced.
  function createScenePass(withMRT) {
    const node = pass(scene, cameraSystem.camera);
    // The multisampled colour attachments (output, normal, metalRough) only need resolving, never storing: discarding
    // them spares the GPU writing 3 x 4 samples per pixel to memory every frame (transient, memoryless attachments where
    // the browser supports them). The multisampled depth stays stored: SSR reads it.
    node.renderTarget.storeMultisampledColorBuffer = false;
    if (!withMRT) return { node, mrt: null };
    const maxSSRRoughness = 0.75;
    const ssrFade = smoothstep(360.0, 180.0, positionView.z.negate());
    const mrtNode = mrt({
      output: output,
      normal: normalView,
      metalRough: vec2(roughness.lessThan(maxSSRRoughness).select(metalness.mul(ssrFade), 0), roughness)
    });
    mrtNode.setBlendMode('normal', new THREE.BlendMode(THREE.MaterialBlending));
    mrtNode.setBlendMode('metalRough', new THREE.BlendMode(THREE.MaterialBlending));
    node.setMRT(mrtNode);
    // Create the extra attachments now, so the render target has its final layout before precompileShaders() builds
    // every scene pipeline against it.
    node.getTextureNode('depth');
    node.getTextureNode('normal');
    node.getTextureNode('metalRough');
    return { node, mrt: mrtNode };
  }

  const scenePass = createScenePass(qualitySettings.postProcessing.ssr);
  const scenePassColor = scenePass.node.getTextureNode('output');
  let reflections = null;

  // Fade out distant and matte surfaces so SSR spends its rays on visible glossy reflections.
  if (qualitySettings.postProcessing.ssr) {
    const maxSSRRoughness = 0.75;
    const scenePassMetalRough = scenePass.node.getTextureNode('metalRough');
    const ssrPass = ssr(scenePassColor, scenePass.node.getTextureNode('depth'), scenePass.node.getTextureNode('normal'), {
      metalnessNode: scenePassMetalRough.r,
      roughnessNode: scenePassMetalRough.g,
      camera: cameraSystem.camera
    });
    ssrPass.resolutionScale = 0.5;
    ssrPass.blurQuality = 1;
    ssrPass.maxDistance.value = 42;
    ssrPass.thickness.value = 0.85;
    // Fewer coarse steps, then refine detected hits to keep reflection edges precise.
    ssrPass.quality.value = 0.25;
    ssrPass.binaryRefine = true;
    ssrPass.intensity.value = 0.50;
    ssrPass.screenEdgeFadeBlack = true;

    // Roughness mip blur must not spread reflections back onto matte or nonreflective surfaces.
    const reflectionMask = scenePassMetalRough.r.greaterThan(0).select(smoothstep(maxSSRRoughness, 0.55, scenePassMetalRough.g), 0);
    reflections = ssrPass.mul(reflectionMask);
  }

  const colorGrade = createPostProcessing(renderer, scenePassColor, reflections, {
    bloom: qualitySettings.postProcessing.bloom
  });
  const renderPipeline = new THREE.RenderPipeline(renderer, colorGrade.outputNode);

  // 6. Wire UI Controls (Strictly using safe DOM APIs: textContent, classList, addEventListener)
  const modeButtons = document.querySelectorAll('[data-mode]');
  const cameraButtons = document.querySelectorAll('[data-camera]');
  const timeButtons = document.querySelectorAll('[data-time]');
  const teleportButtons = document.querySelectorAll('[data-teleport]');
  const hudToggleBtn = document.getElementById('btn-toggle-hud');
  const modeSwitch = document.getElementById('mode-switch');
  touchControls.onAvailabilityChange = placeModeIndicator;

  const elFps = document.getElementById('hud-fps');
  const elMode = document.getElementById('hud-active-mode');
  const elCamera = document.getElementById('hud-active-camera');
  const elSpeed = document.getElementById('hud-speed');
  const elSpeedMeter = document.getElementById('hud-speed-meter');
  const elAltitude = document.getElementById('hud-altitude');
  const elLocation = document.getElementById('hud-location');
  const elControlsHint = document.getElementById('hud-controls-hint');
  const gamepadControls = new GamepadControls(controllerManager, cameraSystem, {
    onCycleMode: (step) => {
      const modes = ['person', 'car', 'cyclist', 'helicopter'];
      selectMode(modes[(modes.indexOf(controllerManager.activeMode) + step + modes.length) % modes.length]);
    },
    onCycleCamera: cycleCamera,
    onToggleMap: () => mapSystem.toggleFullMap(!mapSystem.isFullMapOpen),
    onCloseMap: () => mapSystem.toggleFullMap(false)
  });

  // Keyboard guide for each mode: [keys, action]
  const controlHints = {
    person: [[['W', 'S'], 'Chód'], [['A', 'D'], 'Obrót'], [['Shift'], 'Sprint'], [['Spacja'], 'Skok'], [['Mysz'], 'Obrót kamery']],
    car: [[['W', 'S'], 'Gaz / Wsteczny'], [['A', 'D'], 'Sterowanie'], [['Shift'], 'Turbo'], [['B'], 'Klakson'], [['Mysz'], 'Obrót kamery']],
    cyclist: [[['W', 'S'], 'Pedałowanie / Hamowanie'], [['A', 'D'], 'Przechył i skręt'], [['Shift'], 'Sprint'], [['Mysz'], 'Obrót kamery']],
    helicopter: [[['W', 'S'], 'Przód / tył'], [['A', 'D'], 'Obrót'], [['Spacja', 'E'], 'W górę'], [['Q', 'C'], 'W dół'], [['Shift'], 'Turbo']]
  };
  // Boosted top speeds in km/h (controllers.js caps them at 8.2, 36, 19 & 52 m/s, x 3.6 rounded): full scale of the speed
  // meter, so the bar fills exactly at each mode's cap
  const topSpeedKmh = { person: 30, car: 130, cyclist: 68, helicopter: 187 };

  function renderControlHints(mode) {
    if (!elControlsHint) return;
    const items = (controlHints[mode] || []).map(([keys, action]) => {
      const item = document.createElement('span');
      item.className = 'hint';
      for (const key of keys) {
        const kbd = document.createElement('kbd');
        kbd.textContent = key;
        item.appendChild(kbd);
      }
      const label = document.createElement('span');
      label.className = 'hint-label';
      label.textContent = action;
      item.appendChild(label);
      return item;
    });
    elControlsHint.replaceChildren(...items);
  }

  // The accent pill under the selected mode glides from button to button
  function placeModeIndicator() {
    const active = modeSwitch ? modeSwitch.querySelector('.mode-btn.active') : null;
    if (!active) return;
    modeSwitch.style.setProperty('--ind-x', `${active.offsetLeft}px`);
    modeSwitch.style.setProperty('--ind-w', `${active.offsetWidth}px`);
  }

  function selectMode(mode) {
    controllerManager.setMode(mode);
    touchControls.setMode(controllerManager.activeMode);
    gamepadControls.reset();
    modeButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-mode') === mode);
    });
    document.body.dataset.mode = mode;
    placeModeIndicator();
    const ent = controllerManager.getActiveEntity();
    if (elMode) elMode.textContent = ent.label;
    renderControlHints(mode);

    // If currently on a static scenic camera, switch to 3rd-Person Chase so user sees their selected character/vehicle
    const currentCam = cameraSystem.getActivePreset();
    if (currentCam.category !== 'follow') {
      selectCamera('chase', false);
    }
  }

  function selectCamera(camId, snap = false) {
    cameraSystem.setCameraPreset(camId, snap);
    cameraButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-camera') === camId);
    });
    const preset = cameraSystem.getActivePreset();
    if (elCamera) elCamera.textContent = preset.name;
  }

  // Steps through CAMERA_PRESETS (V / Shift+V, and the arrows either side of the camera name)
  function cycleCamera(step) {
    const n = CAMERA_PRESETS.length;
    const idx = CAMERA_PRESETS.findIndex((p) => p.id === cameraSystem.activePresetId);
    selectCamera(CAMERA_PRESETS[(idx + step + n) % n].id, true);
  }

  function selectTime(timeId) {
    lightingSystem.applyPreset(timeId);
    colorGrade.applyPreset(lightingSystem.activePresetId);
    timeButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-time') === timeId);
    });
  }

  // Popovers (native [popover]: light dismiss & Esc for free) open against the control that toggles them: data-anchor
  // names the element they sit above / below, data-align the one whose right edge they line up with
  const popovers = document.querySelectorAll('.popover[popover]');
  const supportsPopover = typeof HTMLElement.prototype.togglePopover === 'function';
  function closePopovers() {
    if (!supportsPopover) return;
    popovers.forEach((pop) => {
      if (pop.matches(':popover-open')) pop.hidePopover();
    });
  }
  popovers.forEach((pop) => {
    const invoker = document.querySelector(`[popovertarget="${pop.id}"]`);
    pop.addEventListener('beforetoggle', (e) => {
      const open = e.newState === 'open';
      if (invoker) invoker.classList.toggle('is-open', open);
      if (!open) return;
      const anchor = document.getElementById(pop.dataset.anchor) || invoker;
      const align = document.getElementById(pop.dataset.align) || invoker;
      if (!anchor || !align) return;
      const r = anchor.getBoundingClientRect();
      const spaceAbove = Math.max(0, r.top - 20);
      const spaceBelow = Math.max(0, window.innerHeight - r.bottom - 20);
      let above = pop.dataset.side === 'above';
      // The camera control moves to the top on touch screens; open toward the available space.
      if ((above ? spaceAbove : spaceBelow) < 160) above = spaceAbove > spaceBelow;
      pop.style.right = `${Math.max(8, window.innerWidth - align.getBoundingClientRect().right)}px`;
      if (above) {
        pop.style.top = 'auto';
        pop.style.bottom = `${window.innerHeight - r.top + 8}px`;
        pop.style.maxHeight = `${spaceAbove}px`;
      } else {
        pop.style.bottom = 'auto';
        pop.style.top = `${r.bottom + 8}px`;
        pop.style.maxHeight = `${spaceBelow}px`;
      }
    });
  });

  modeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      selectMode(btn.getAttribute('data-mode'));
    });
  });

  cameraButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      selectCamera(btn.getAttribute('data-camera'), true);
      closePopovers();
    });
  });

  const camPrevBtn = document.getElementById('cam-prev');
  const camNextBtn = document.getElementById('cam-next');
  if (camPrevBtn) camPrevBtn.addEventListener('click', () => cycleCamera(-1));
  if (camNextBtn) camNextBtn.addEventListener('click', () => cycleCamera(1));

  timeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      selectTime(btn.getAttribute('data-time'));
    });
  });

  // A mouse click mustn't leave the focus on a HUD button, or Space (jump / ascend) and Enter would press it again
  document.addEventListener('click', (e) => {
    const btn = e.target instanceof Element ? e.target.closest('button') : null;
    if (btn && e.detail > 0) btn.blur();
  });

  // Where you are: the place's name over its street corner, drawn as a pair of street-name plates in the style of the
  // in-world ones (street-details.js `plateLabel`): the kind as a small lowercase word with the patron's given names
  // ("ulica Jana Henryka" over "Dąbrowskiego"), the name large below, and the district on the blue bottom strip
  const roadNames = new Set(ROADS.map((r) => r.name));
  const placeNames = new Set(CITY_LANDMARKS.map((l) => l.name));
  let locationText = '';
  function renderLocation(label, district) {
    const key = `${label}|${district || ''}`;
    if (!elLocation || key === locationText) return;
    locationText = key;
    let place = '';
    let streets = label;
    const split = label.indexOf(' · ');
    if (split >= 0) {
      place = label.slice(0, split);
      streets = label.slice(split + 3);
    } else if (placeNames.has(label) || (!label.includes(STREET_JOIN) && !roadNames.has(label))) {
      place = label;
      streets = '';
    }
    const nodes = [];
    if (place) {
      const el = document.createElement('div');
      el.className = 'location-place';
      el.textContent = place;
      nodes.push(el);
    }
    if (streets) {
      const row = document.createElement('div');
      row.className = 'location-signs';
      if (streets.startsWith('w pobliżu: ')) {
        streets = streets.slice(11);
        const near = document.createElement('span');
        near.className = 'location-near';
        near.textContent = 'w pobliżu:';
        row.appendChild(near);
      }
      for (const name of streets.split(STREET_JOIN)) {
        const plate = plateLabel(name, district);
        const sign = document.createElement('span');
        sign.className = 'street-sign';
        for (const [cls, text] of [['kind', plate.kind], ['name', plate.name], ['district', plate.district]]) {
          if (!text) continue;
          const line = document.createElement('span');
          line.className = `street-sign-${cls}`;
          line.textContent = text;
          sign.appendChild(line);
        }
        row.appendChild(sign);
      }
      nodes.push(row);
    }
    elLocation.replaceChildren(...nodes);
  }

  function teleportTo(x, z, heading = Math.PI) {
    const destination = controllerManager.teleportActiveTo(x, z, heading);
    touchControls.reset();
    gamepadControls.reset();
    cameraSystem.resetForTeleport();
    selectCamera('chase', true);
    mapSystem.waypoint = {
      x: destination.x,
      z: destination.z,
      name: getLocationLabel(destination.x, destination.z)
    };
    return destination;
  }

  const mapSystem = new CityMapSystem({
    controllerManager,
    cameraSystem,
    trafficSystem,
    trams: tramSystem.trams,
    network: trafficSystem.network,
    allBlocks: cityBlocks.allBlocks,
    onToggle: (open) => {
      controllerManager.resetInput();
      touchControls.setEnabled(!open);
      gamepadControls.setEnabled(!open);
      const mapHint = document.getElementById('fullmap-hover-info');
      if (open && touchControls.available && mapHint) {
        mapHint.textContent = 'Dotknij, aby się teleportować · Przeciągnij, aby przesunąć · Użyj + / −, aby przybliżyć';
      }
    },
    onTeleport: teleportTo
  });

  teleportButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-teleport');
      const loc = TELEPORT_LOCATIONS[key];
      if (loc) {
        teleportTo(loc.x, loc.z, loc.heading);
      }
      closePopovers();
    });
  });

  const openMapBtn = document.getElementById('btn-open-map');
  if (openMapBtn) openMapBtn.addEventListener('click', () => mapSystem.toggleFullMap(true));

  if (hudToggleBtn) {
    hudToggleBtn.addEventListener('click', () => {
      document.body.classList.toggle('hud-minimized');
      const isMin = document.body.classList.contains('hud-minimized');
      hudToggleBtn.setAttribute('aria-pressed', String(isMin));
      hudToggleBtn.setAttribute('aria-label', isMin ? 'Pokaż interfejs' : 'Ukryj interfejs');
      hudToggleBtn.title = isMin ? 'Pokaż interfejs [H]' : 'Czysty widok: ukryj interfejs [H]';
      if (isMin) closePopovers();
    });
  }

  // Global keyboard shortcuts for modes (1-4), cameras (V / 5-0), and HUD (H)
  window.addEventListener('keydown', (e) => {
    if (isTypingInField(e)) return;
    switch (e.code) {
      case 'Digit1':
        selectMode('person');
        break;
      case 'Digit2':
        selectMode('car');
        break;
      case 'Digit3':
        selectMode('cyclist');
        break;
      case 'Digit4':
        selectMode('helicopter');
        break;
      case 'Digit5':
        selectCamera('chase', true);
        break;
      case 'Digit6':
        selectCamera('action', true);
        break;
      case 'Digit7':
        selectCamera('pov', true);
        break;
      case 'Digit8':
        selectCamera('rynek', true);
        break;
      case 'Digit9':
        selectCamera('katedra', true);
        break;
      case 'Digit0':
        selectCamera('zamek', true);
        break;
      case 'KeyV':
        cycleCamera(e.shiftKey ? -1 : 1);
        break;
      case 'KeyH':
        if (hudToggleBtn) hudToggleBtn.click();
        break;
      case 'KeyN':
        if (!e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) audioSystem.setEnabled(!audioSystem.enabled);
        break;
      case 'KeyB':
        if (!e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey && !mapSystem.isFullMapOpen) audioSystem.honk(controllerManager.getActiveEntity());
        break;
    }
  });

  window.addEventListener('resize', () => {
    cameraSystem.onResize(window.innerWidth, window.innerHeight);
    renderer.setSize(window.innerWidth, window.innerHeight);
    placeModeIndicator();
    if (mapSystem.isFullMapOpen) {
      mapSystem.resizeFullCanvas();
      mapSystem.renderFullMap();
    }
  });

  // Initialize the UI and chase camera around the restored player, or the default taxi on a first visit.
  selectMode(controllerManager.activeMode);
  selectCamera('chase', true);
  selectTime('golden');
  // the web fonts change the buttons' widths once they arrive
  if (document.fonts) document.fonts.ready.then(placeModeIndicator);
  markInit('ui');

  // The loading screen stays up while the shaders compile (precompileShaders() & the warm-up frame, see the loop) and
  // until the first frame is on screen
  if (loadingStatus) {
    loadingStatus.textContent = 'Kompilacja shaderów i potoków renderowania…';
  }

  // 6b. Shader pre-compilation behind the loading screen. compileAsync() builds the node graphs in slices and has the GPU
  //     process compile the pipelines in parallel, but after every 8 ms slice it waits for a rendered frame, which
  //     leaves the main thread idle about half the time while nothing else animates; several calls side by side keep
  //     it busy (warm cache: 2.1 s instead of 4.0 s). (Rendering straight away compiled ~500 pipelines one after
  //     another: ~25 s with a cold shader cache.)
  const COMPILE_POOL = 16;
  const nextTask = () => (globalThis.scheduler?.yield ? globalThis.scheduler.yield() : new Promise((resolve) => setTimeout(resolve, 0)));
  async function precompileShaders() {
    // An empty frame first: it sets up the post-processing chain, which configures the scene pass's render target
    // (MSAA samples, depth format), so the pipelines compiled below are the very ones the scene pass asks for
    scene.visible = false;
    renderPipeline.render();
    scene.visible = true;
    markInit('postFX');

    // Every visible object with frustum culling off (like the warm-up frame, see the loop). Plain meshes that share
    // a material share its shader, so one job compiles them in turn (the first build serves the rest); every
    // instanced mesh gets a build of its own unless its chunks share a pipeline
    const culled = [];
    const jobs = [];
    const jobByMaterial = new Map();
    const pipelines = new Set();
    scene.traverseVisible((o) => {
      if (o.frustumCulled) {
        culled.push(o);
        o.frustumCulled = false;
      }
      if (!o.isMesh && !o.isLine && !o.isPoints && !o.isSprite) return;
      // Use the first visible chunk: the original representative may be in an inactive tree cell. Shadow stand-ins
      // only draw in the shadow maps (the warm-up frame compiles those).
      if (o.userData.shadowProxy) return;
      const pipeline = o.userData.sharesPipelineWith || o;
      if (pipelines.has(pipeline)) return;
      pipelines.add(pipeline);
      if (o.isInstancedMesh || Array.isArray(o.material)) {
        jobs.push([o]);
        return;
      }
      let job = jobByMaterial.get(o.material);
      if (!job) {
        job = [];
        jobByMaterial.set(o.material, job);
        jobs.push(job);
      }
      job.push(o);
    });

    renderer.setRenderTarget(scenePass.node.renderTarget);
    if (scenePass.mrt) renderer.setMRT(scenePass.mrt);
    const compile = async (object) => {
      // Each compile starts in a task of its own: compileAsync() keeps one precompilation state on the renderer,
      // which must not be mid-step for two of them in the same microtask checkpoint
      await nextTask();
      try {
        await renderer.compileAsync(object, cameraSystem.camera, scene);
      } catch (e) {
        console.warn('[compile]', e); // the warm-up frame compiles it instead
      }
    };
    let next = 0;
    let done = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const job = jobs[next++];
        for (const object of job) await compile(object);
        done++;
        if (loadingStatus) {
          loadingStatus.textContent = `Kompilacja shaderów i potoków renderowania… ${Math.round((done / jobs.length) * 100)}%`;
        }
        setLoadingProgress(done / jobs.length);
      }
    };
    await Promise.all(Array.from({ length: COMPILE_POOL }, worker));
    renderer.setMRT(null);
    renderer.setRenderTarget(null);
    for (const o of culled) o.frustumCulled = true;
  }

  await precompileShaders();
  markInit('compile');

  // Opt-in (?stats=1) performance panel and copyable report. With the switch off, main.js passes null and the loop
  // only tests the reference: no DOM, no renderer.info reset, no timers. The panel reads the live systems through a
  // getter that runs once per copy, not per frame.
  const perfStats = statsEnabled
    ? new PerfStats({
      renderer,
      quality: activeQuality,
      getContext: () => {
        const entity = controllerManager.getActiveEntity();
        const preset = cameraSystem.getActivePreset();
        return {
          mode: controllerManager.activeMode,
          camera: preset.id,
          cameraName: preset.name,
          time: lightingSystem.activePresetId,
          player: { x: entity.position.x, y: entity.position.y, z: entity.position.z },
          cameraPosition: {
            x: cameraSystem.currentPos.x,
            y: cameraSystem.currentPos.y,
            z: cameraSystem.currentPos.z
          }
        };
      }
    })
    : null;

  // 6. Animation Loop
  let lastTime = performance.now();
  let elapsed = 0;
  let frameCount = 0;
  let fpsTimer = 0;
  let nextPlayerSave = 0;
  let warmedUp = false; // see the first frame below
  let firstFrameAt = 0; // rAF timestamp since navigation start, the panel's boot time

  if (elFps) elFps.textContent = '60';

  renderer.setAnimationLoop((now) => {
    if (perfStats) {
      perfStats.beginFrame(now);
      if (!firstFrameAt) firstFrameAt = now;
    }
    const rawDt = (now - lastTime) * 0.001;
    lastTime = now;
    const dt = Math.min(Math.max(rawDt, 0.001), 0.05);
    elapsed += dt;

    // Update 3rd-person controllers, camera, signals, traffic & vehicle collisions, building LODs, and dynamic shadow focus
    gamepadControls.update(dt);
    controllerManager.update(dt, elapsed);
    cameraSystem.update(dt, elapsed);
    streetDetails.signalClock.value = elapsed;
    // Trams first: the cars then take this frame's trams into their lanes and the player collides with them where they
    // are drawn (the trams brake for last frame's cars)
    if (perfStats) perfStats.beginSimulation();
    tramSystem.update(dt, elapsed, cameraSystem.currentPos, cameraSystem.camera, controllerManager.getActiveEntity(), controllerManager.activeMode);
    trafficSystem.update(
      dt,
      elapsed,
      cameraSystem.currentPos,
      controllerManager.getActiveEntity(),
      controllerManager.activeMode,
      cameraSystem.camera
    );
    if (perfStats) perfStats.endSimulation();
    if (!document.hidden && now >= nextPlayerSave) {
      savePlayerState();
      nextPlayerSave = now + 5000;
    }
    cityBlocks.update(cameraSystem.currentPos.x, cameraSystem.currentPos.z);
    if (cityBlocks.updateLights) cityBlocks.updateLights(cameraSystem.camera);
    if (streetDetails.update) streetDetails.update(cameraSystem.camera);
    landmarks.update(dt, elapsed, lightingSystem.activePresetId);
    lightingSystem.update(cameraSystem.currentPos);
    mapSystem.update();
    audioSystem.update(dt, elapsed, cameraSystem.camera, lightingSystem.activePresetId);
    if (warmedUp) updateSceneCulling(cameraSystem.camera.position); // the warm-up frame draws every chunk
    // The scene graph is frozen (see the freeze above): update the moving roots only, once, for both the shadow and the
    // scene passes that renderPipeline.render() submits
    updateDynamicMatrices(dynamicRoots);

    // Render frame via TSL RenderPipeline (SSR + Bloom)
    if (!warmedUp) {
      // First frame = pipeline warm-up behind the loading screen, for what precompileShaders() can't reach (the shadow
      // map passes): with frustum culling off, every visible material's pipelines compile now instead of stalling the
      // first time the camera turns towards it (one chunk / shadow stand-in per shared pipeline is enough)
      const culled = [];
      const pipelines = new Set();
      scene.traverseVisible((o) => {
        const pipeline = o.userData.sharesPipelineWith || o;
        if (pipelines.has(pipeline)) return;
        pipelines.add(pipeline);
        if (o.frustumCulled) {
          culled.push(o);
          o.frustumCulled = false;
        }
      });
      renderPipeline.render();
      for (const o of culled) o.frustumCulled = true;
      markInit('warmup');
    }
    if (perfStats) perfStats.beginRender();
    renderPipeline.render();
    if (perfStats) {
      perfStats.endRender();
      perfStats.endFrame();
    }
    if (!warmedUp) {
      warmedUp = true;
      markInit('firstFrame');
      // The loading screen stays up until the GPU has got through the first frame (and the pipelines its warm-up
      // compiled), i.e. until the city is actually on screen
      const device = renderer.backend.device;
      Promise.resolve(device && device.queue.onSubmittedWorkDone()).catch(() => {}).then(() => {
        markInit('gpu');
        if (perfStats) perfStats.setBoot({ firstFrameMs: firstFrameAt, readyMs: performance.now(), initTimings });
        console.log(`[init] ${initTimings.join(', ')}`);
        initTimings = null;
        if (loadingOverlay) loadingOverlay.classList.add('hidden');
        audioSystem.ready = true;
        setLoadingProgress(1);
      });
    }

    // Telemetry uses wall time, not the clamped simulation step, so slow frames and high-refresh displays report
    // their actual frame rate (updates DOM every 250ms).
    frameCount++;
    fpsTimer += Math.max(0, rawDt);
    if (fpsTimer >= 0.25) {
      const currentFps = Math.round(frameCount / fpsTimer);
      frameCount = 0;
      fpsTimer = 0;

      const activeEnt = controllerManager.getActiveEntity();
      const mode = controllerManager.activeMode;
      const kmh = Math.round(Math.abs(activeEnt.speed) * 3.6);
      const altM = Math.max(0, Math.round(activeEnt.position.y));

      if (elFps) {
        elFps.textContent = String(currentFps);
        elFps.className = currentFps >= 50 ? 'fps-ok' : currentFps >= 30 ? 'fps-warn' : 'fps-bad';
      }
      if (elSpeed) elSpeed.textContent = String(kmh);
      if (elSpeedMeter) elSpeedMeter.style.transform = `scaleX(${Math.min(1, kmh / (topSpeedKmh[mode] || 130))})`;
      document.body.classList.toggle('is-boosting', controllerManager.keys.boost && kmh > 0);
      if (elAltitude) elAltitude.textContent = formatCount(altM);
      // The street corner of the player on the follow cameras, of the camera itself on the scenic ones
      const where = cameraSystem.getActivePreset().category === 'follow' ? activeEnt.position : cameraSystem.currentPos;
      renderLocation(getLocationLabel(where.x, where.z), districtAt(where.x, where.z));
    }
  });
}

initApp();
