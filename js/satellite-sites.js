// js/satellite-sites.js
// Big-box retail, logistics and utility silhouettes just outside the detailed core. They are not part of GEO.blocks
// (the 8 x 5.7 km detail box stops at 52.383-52.434 N / 16.85686-17.000 E), but they dominate the skyline from the
// drone, the helicopter and the high viewpoints: Galeria Pestka, Makro, Poznań Plaza, M1, IKEA, Selgros, the Franowo
// retail parks, Volkswagen Antoninek and Elektrociepłownia Karolin. King Cross Marcelin moved into the detail box in
// the 2026-11-08 west expansion.
//
// Source: OSM footprints from tools/data/poz_buildings.json (snapshot 2026-10-28) where present; the two objects
// outside the padded snapshot (Poznań Plaza, Volkswagen) were fetched from the OSM API on 2026-11-08
// (way 24440480 and the VW works buildings around 17.03 E). `x` / `z` are world metres in the game frame
// (x east, z south, origin at the Ratusz); `angle` is the footprint's long side in degrees east towards south, the same
// convention as the zone angles in outskirts.js. `w` / `d` / `h` are metres. Big concave footprints are split into two
// or three overlapping rectangles; the parts together approximate the OSM outline to within about a fifth of its area,
// which is enough for a silhouette several hundred metres away.
//
// Every part is rendered by outskirts.js as one instance of the shared unit box (`createBoroughBuildingMaterial`), so
// the whole set costs no new material pipeline. `finish` picks the facade style: `panels` (retail panels + glass),
// `steel` (industrial sheet metal) or `glass` (curtain wall on entrance wings). Cooling towers and chimneys are the
// only separate geometries: one instanced lathe and one instanced cylinder for the Karolin skyline.

const SATELLITE_SITES = [
  {
    id: 'pestka',
    name: 'Galeria Pestka',
    kind: 'mall',
    parts: [
      { x: -1089.5, z: -3238.5, w: 231, d: 117, angle: 0, h: 15, finish: 'panels', tint: [0.80, 0.78, 0.74] },
      { x: -1019.5, z: -3148.5, w: 91, d: 63, angle: 0, h: 15, finish: 'panels', tint: [0.76, 0.74, 0.70] }
    ]
  },
  {
    id: 'makro',
    name: 'Makro',
    kind: 'retail',
    parts: [
      { x: -1382.7, z: -3181.3, w: 114, d: 163, angle: 174.82, h: 11, finish: 'steel', tint: [0.67, 0.65, 0.61] }
    ]
  },
  {
    id: 'poznan-plaza',
    name: 'Poznań Plaza',
    kind: 'mall',
    parts: [
      { x: -1019.5, z: -3602.4, w: 309, d: 70, angle: 87.56, h: 18, finish: 'panels', tint: [0.82, 0.81, 0.78] }
    ]
  },
  {
    id: 'm1-franowo',
    name: 'M1 Poznań',
    kind: 'mall',
    parts: [
      { x: 4072.5, z: 2869.5, w: 329, d: 120, angle: -38.58, h: 15, finish: 'panels', tint: [0.80, 0.78, 0.74] },
      { x: 4259, z: 2813.5, w: 149, d: 80, angle: 38.72, h: 15, finish: 'glass', tint: [0.34, 0.42, 0.50] }
    ]
  },
  {
    id: 'ikea-franowo',
    name: 'IKEA Franowo',
    kind: 'retail',
    parts: [
      { x: 3633.4, z: 2857.3, w: 208.5, d: 102.6, angle: 145.72, h: 15, finish: 'panels', tint: [0.18, 0.32, 0.58] }
    ]
  },
  {
    id: 'selgros',
    name: 'Selgros',
    kind: 'retail',
    parts: [
      { x: 823.9, z: 2918, w: 121, d: 150, angle: -11, h: 10, finish: 'steel', tint: [0.66, 0.63, 0.60] }
    ]
  },
  {
    id: 'homepark-franowo',
    name: 'Homepark Franowo',
    kind: 'retail',
    parts: [
      { x: 3685, z: 3095, w: 280, d: 45, angle: -9, h: 10, finish: 'steel', tint: [0.70, 0.68, 0.64] },
      { x: 3738, z: 3138, w: 100, d: 45, angle: -40, h: 10, finish: 'steel', tint: [0.68, 0.66, 0.62] }
    ]
  },
  {
    id: 'obi-franowo',
    name: 'OBI Franowo',
    kind: 'retail',
    parts: [
      { x: 3212, z: 3160.4, w: 172.4, d: 62, angle: 116.77, h: 9, finish: 'steel', tint: [0.78, 0.45, 0.18] }
    ]
  },
  {
    id: 'centrum-franowo',
    name: 'Centrum Franowo',
    kind: 'mall',
    parts: [
      { x: 3380.9, z: 3207.9, w: 81.2, d: 130, angle: -153.33, h: 12, finish: 'panels', tint: [0.76, 0.74, 0.70] }
    ]
  },
  {
    id: 'decathlon-franowo',
    name: 'Decathlon Franowo',
    kind: 'retail',
    parts: [
      { x: 3436.4, z: 2982, w: 75.6, d: 65, angle: -124.5, h: 9, finish: 'steel', tint: [0.20, 0.38, 0.65] }
    ]
  },
  {
    id: 'hala-m-franowo',
    name: 'Hala M Franowo',
    kind: 'retail',
    parts: [
      { x: 3525.1, z: 3186.1, w: 90.9, d: 49, angle: -153.67, h: 9, finish: 'steel', tint: [0.62, 0.60, 0.57] }
    ]
  },
  {
    id: 'volkswagen-antoninek',
    name: 'Volkswagen Poznań Antoninek',
    kind: 'industrial',
    parts: [
      { x: 7075.2, z: -41.8, w: 250.1, d: 205.2, angle: 25.7, h: 18, finish: 'steel', tint: [0.74, 0.73, 0.70] },
      { x: 6700.4, z: -403.6, w: 277.5, d: 114, angle: -154.4, h: 20, finish: 'steel', tint: [0.68, 0.67, 0.64] },
      { x: 6580.5, z: -210.7, w: 168.3, d: 233.5, angle: 115.6, h: 16, finish: 'steel', tint: [0.72, 0.71, 0.68] },
      { x: 6506.4, z: -370.3, w: 320.3, d: 76.4, angle: 25.5, h: 15, finish: 'steel', tint: [0.66, 0.65, 0.62] },
      { x: 6466.1, z: -506.3, w: 99.8, d: 236.6, angle: -65.5, h: 22, finish: 'steel', tint: [0.70, 0.69, 0.66] },
      { x: 6454.8, z: -291.5, w: 281.4, d: 106.5, angle: 49.9, h: 16, finish: 'steel', tint: [0.72, 0.70, 0.67] }
    ]
  },
  {
    id: 'karolin',
    name: 'Elektrociepłownia Poznań Karolin EC-II',
    kind: 'utility',
    parts: [
      { x: 3592.4, z: -3075.2, w: 190.4, d: 31.4, angle: 90.18, h: 22, finish: 'steel', tint: [0.62, 0.61, 0.58] },
      { x: 3626.4, z: -3041.3, w: 108.9, d: 36.7, angle: 90.19, h: 24, finish: 'steel', tint: [0.58, 0.57, 0.54] },
      { x: 3628.1, z: -3063.7, w: 33.4, d: 32.2, angle: -179.81, h: 32, finish: 'steel', tint: [0.66, 0.64, 0.61] },
      { x: 3716, z: -3204, w: 129, d: 70, angle: 0, h: 18, finish: 'steel', tint: [0.60, 0.59, 0.56] }
    ],
    structures: [
      { kind: 'cooling', x: 3591, z: -2903, radius: 16, height: 65 },
      { kind: 'cooling', x: 3647, z: -2901, radius: 22, height: 75 },
      { kind: 'chimney', x: 3716, z: -3096, radius: 7, height: 204 }
    ]
  }
];

// Flat spatial lookup for the outskirts generator: no generic shed may grow through a satellite footprint. Each part
// carries its local frame so distance is a clamped point-to-rectangle test; structures are circles.
const FOOTPRINTS = [];
for (const site of SATELLITE_SITES) {
  for (const p of site.parts) {
    const a = (p.angle * Math.PI) / 180;
    FOOTPRINTS.push({ x: p.x, z: p.z, hw: p.w * 0.5, hd: p.d * 0.5, cs: Math.cos(a), sn: Math.sin(a) });
  }
  for (const s of site.structures || []) FOOTPRINTS.push({ x: s.x, z: s.z, radius: s.radius });
}

/** Distance in metres from (x, z) to the nearest satellite footprint (0 inside one). */
function satelliteClearance(x, z) {
  let best = Infinity;
  for (const f of FOOTPRINTS) {
    const dx = x - f.x;
    const dz = z - f.z;
    if (f.radius) {
      best = Math.min(best, Math.hypot(dx, dz) - f.radius);
      continue;
    }
    const u = dx * f.cs + dz * f.sn;
    const v = -dx * f.sn + dz * f.cs;
    const d = Math.hypot(Math.max(0, Math.abs(u) - f.hw), Math.max(0, Math.abs(v) - f.hd));
    if (d < best) best = d;
  }
  return best;
}

export { SATELLITE_SITES, satelliteClearance };
