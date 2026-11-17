# Canopy underside SSR — 2026-11-17

The Piaśnicka Rynek tram canopy's underside reflected the platform and buildings on both WebGPU high and WebGL2 high. The same view on WebGPU low, which has no SSR, was flat. The deck material used roughness 0.5 and metalness 0.42 on every face, so it passed the high-tier 0.75 roughness mask. Making only its downward face matte removes the reflections in both high-tier backends. This implicates the deck material and SSR together; it does not establish a defect in the general SSR pass.

The instanced box now uses geometry-local normals to give the bottom face roughness 0.85 and metalness 0.05, representing painted sheet. The top and sides retain 0.5 and 0.42, with no new mesh or draw. The low-tier underside also changes slightly because it is now less metallic; no after-fix low-tier frame was taken. The WebGPU and WebGL2 aerial frames show the top looking much the same. All canopy kinds share this material, so platform, fuel and ordinary roofs receive the same treatment; those kinds were not individually visually checked, and there are no market records in this snapshot. Other glossy box surfaces, including tram infrastructure and rooftop equipment, exist; they were not surveyed visually and this change does not affect them.

## Setup and captures

Headless Chrome with `--headless=new --enable-unsafe-webgpu --use-angle=metal`, HTTP 8320, CDP 9520, profile `/tmp/cx-canopy-ssr/chrome`; 1280 × 720, DPR 1, midday, seed 4242, cache disabled. The scratch server injected camera pinning and exposed scene controls without editing production files. Each navigation reset local storage; the camera poses are fixed, but moving actors may differ. Page console capture (`/tmp/cx-canopy-ssr/console.jsonl`) recorded no warnings or errors. Chrome stderr reported headless macOS display-link errors and a sandbox extension warning; rendering and both backends initialized. Browser processes and server were stopped after the checks.

All paths below are under `/tmp/cx-canopy-ssr/shots/`. Each before/after pair uses the same camera, look target and FOV:

- WebGPU high underside: `before-webgpu-back.png` / `after-webgpu-back.png` and `before-webgpu-side.png` / `after-webgpu-side.png`.
- WebGL2 high underside: `before-webgl-back.png` / `after-webgl-back.png` and `before-webgl-side.png` / `after-webgl-side.png`.
- WebGPU high top: `before-webgpu-top.png` / `after-webgpu-top.png`; WebGL2 high top: `before-webgl-top.png` / `after-webgl-top.png`.
- Low control before the fix: `before-low-back.png` (also `before-low-side.png`, `before-low-top.png`).

Back eye `(3255, 4.5, 2318)`, target `(3274, 5.6, 2324)`, FOV 55°; side eye `(3270, 4, 2315)`, same target and FOV; top eye `(3245, 35, 2298)`, target `(3274, 6, 2324)`, FOV 55°. No other time of day, device, canopy kind or performance benchmark was checked.
