import * as THREE from 'three/webgpu';
import { cityUniforms } from './tsl-materials.js';
import {
  Fn,
  float,
  vec2,
  vec4,
  color,
  attribute,
  sin,
  abs,
  fract,
  floor,
  min,
  max,
  clamp,
  mix,
  step,
  smoothstep,
  length,
  fwidth,
  dFdx,
  dFdy,
  uniform,
  texture,
  time,
  instanceIndex,
  uv
} from 'three/tsl';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// js/actor-models.js
// Realistic 3D Lofted Vehicle Geometry + TSL Materials (the skinned, animated people are in pedestrians.js)
// Ported and adapted from Three.js webgpu_generator_city:
// - LoftGeometry.js (skinning 3D cross-section rings with arc-length UVs, smooth seam normals & Newell caps)
// - CarGenerator.js (lofted car bodies with circular wheel arches, curved cabin windscreens, crowned roofs,
//   LatheGeometry tyres & recessed 5-spoke alloy wheels, side mirrors, roof signs & TSL fascia/seams), reshaped here
//   into the saloon, hatchback, estate, crossover and van classes common in Poland

const _vector = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);

// ============================================================================
// 1. LOFT GEOMETRY (Ported from three/addons/geometries/LoftGeometry.js)
// ============================================================================
class LoftGeometry extends THREE.BufferGeometry {
  constructor(sections = [], options = {}) {
    super();
    this.type = 'LoftGeometry';

    const { closed = true, capStart = false, capEnd = false } = options;
    const rows = sections.length;
    if (rows < 2) return;
    const columns = sections[0].length;
    for (let i = 1; i < rows; i++) {
      if (sections[i].length !== columns) return;
    }

    const pointsPerRow = closed ? columns + 1 : columns;
    const indices = [];
    const vertices = [];
    const uvs = [];

    const rowU = [0];
    for (let i = 1; i < rows; i++) {
      let distance = 0;
      for (let j = 0; j < columns; j++) {
        distance += sections[i][j].distanceTo(sections[i - 1][j]);
      }
      rowU.push(rowU[i - 1] + distance / columns);
    }
    const totalU = rowU[rows - 1];

    for (let i = 0; i < rows; i++) {
      const section = sections[i];
      const colV = [0];
      for (let j = 1; j < pointsPerRow; j++) {
        colV.push(colV[j - 1] + section[j % columns].distanceTo(section[(j - 1) % columns]));
      }
      const totalV = colV[pointsPerRow - 1];

      for (let j = 0; j < pointsPerRow; j++) {
        const point = section[j % columns];
        vertices.push(point.x, point.y, point.z);
        uvs.push(
          totalU > 0 ? rowU[i] / totalU : i / (rows - 1),
          totalV > 0 ? colV[j] / totalV : j / (pointsPerRow - 1)
        );
      }
    }

    for (let i = 0; i < rows - 1; i++) {
      for (let j = 0; j < pointsPerRow - 1; j++) {
        const a = i * pointsPerRow + j;
        const b = i * pointsPerRow + j + 1;
        const c = (i + 1) * pointsPerRow + j + 1;
        const d = (i + 1) * pointsPerRow + j;
        indices.push(a, b, d);
        indices.push(b, c, d);
      }
    }

    function generateCap(sectionIndex) {
      const section = sections[sectionIndex];
      const centroid = new THREE.Vector3();
      const normal = new THREE.Vector3();

      for (let i = 0; i < columns; i++) {
        const p = section[i];
        const q = section[(i + 1) % columns];
        centroid.add(p);
        normal.x += (p.y - q.y) * (p.z + q.z);
        normal.y += (p.z - q.z) * (p.x + q.x);
        normal.z += (p.x - q.x) * (p.y + q.y);
      }
      centroid.divideScalar(columns);
      normal.normalize();

      const neighbor = sections[sectionIndex === 0 ? 1 : rows - 2];
      _vector.set(0, 0, 0);
      for (let i = 0; i < columns; i++) _vector.add(neighbor[i]);
      _vector.divideScalar(columns).sub(centroid);
      if (normal.dot(_vector) > 0) normal.negate();

      const tangent = new THREE.Vector3(1, 0, 0);
      if (Math.abs(normal.x) > 0.9) tangent.set(0, 1, 0);
      const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();
      tangent.crossVectors(bitangent, normal);

      const contour = [];
      const points = section.slice();
      for (let i = 0; i < columns; i++) {
        _vector.subVectors(points[i], centroid);
        contour.push(new THREE.Vector2(_vector.dot(tangent), _vector.dot(bitangent)));
      }

      if (THREE.ShapeUtils.isClockWise(contour) === true) {
        contour.reverse();
        points.reverse();
      }

      const faces = THREE.ShapeUtils.triangulateShape(contour, []);
      const minV = new THREE.Vector2(Infinity, Infinity);
      const maxV = new THREE.Vector2(-Infinity, -Infinity);
      for (let i = 0; i < columns; i++) {
        minV.min(contour[i]);
        maxV.max(contour[i]);
      }
      const width = Math.max(maxV.x - minV.x, Number.EPSILON);
      const height = Math.max(maxV.y - minV.y, Number.EPSILON);

      const indexOffset = vertices.length / 3;
      for (let i = 0; i < columns; i++) {
        const point = points[i];
        vertices.push(point.x, point.y, point.z);
        uvs.push((contour[i].x - minV.x) / width, (contour[i].y - minV.y) / height);
      }
      for (let i = 0; i < faces.length; i++) {
        const face = faces[i];
        indices.push(indexOffset + face[0], indexOffset + face[1], indexOffset + face[2]);
      }
    }

    if (capStart === true) generateCap(0);
    if (capEnd === true) generateCap(rows - 1);

    this.setIndex(indices);
    this.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    this.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    this.computeVertexNormals();

    if (closed === true) {
      const normals = this.getAttribute('normal');
      for (let i = 0; i < rows; i++) {
        const a = i * pointsPerRow;
        const b = i * pointsPerRow + (pointsPerRow - 1);
        _vector.set(
          normals.getX(a) + normals.getX(b),
          normals.getY(a) + normals.getY(b),
          normals.getZ(a) + normals.getZ(b)
        ).normalize();
        normals.setXYZ(a, _vector.x, _vector.y, _vector.z);
        normals.setXYZ(b, _vector.x, _vector.y, _vector.z);
      }
    }
  }
}

function part(geometry, id) {
  const g = geometry.index ? geometry : mergeVertices(geometry);
  if (!g.attributes.uv) {
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  }
  g.setAttribute('partId', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(id), 1));
  return g;
}

// ============================================================================
// 2. LOFTED VEHICLE GEOMETRY & TSL MATERIAL
// ============================================================================
// Car bodies are lofted from ~45 cross-sections generated along the car out of a few smooth side- & plan-view curves
// (monotone cubic splines) plus elliptical roundings into the nose and tail: rounded plan-view corners, a hood that
// rolls down into the fascia, a tucked-in sill, crowned hood & deck, fender flares and circular wheel arches. A second,
// open loft sits on the belt line as the glasshouse (raked windshield & backlight, tumblehome side glass, crowned roof
// with rounded rails). All the detail (glass, seals, pillars, lamps, grilles, plates, door seams, emergency & taxi liveries,
// brake lights & turn signals) is painted by one TSL material from object-space position & normal, so each body type
// stays a single instanced draw call.
const CAR_PARTS = {
  BODY: 0,
  WINDOW: 1,
  TYRE: 2,
  ALLOY: 3,
  TRIM: 4,
  MIRROR: 5,
  SIGN: 6,
  FRONT: 7,
  REAR: 8
};

// Design tables. Curves are [z, value] control points (z = +front); nose / tail entries are [length, tip value,
// superellipse exponent] roundings of the same quantities into the tips. The bodies are generic classes common on
// Polish streets, proportioned after the class and never after one model's design (no badges, no signature grilles):
// - saloon: a Corolla-class C-segment saloon, 4.60 x 1.78 x 1.44 m, 2.70 m wheelbase (the taxi body: most Poznań taxis
//   are saloons of this class);
// - hatch: a Golf / Fabia / Yaris-class five-door hatchback, 4.24 x 1.78 x 1.47 m, 2.60 m wheelbase;
// - estate: an Octavia-class kombi, 4.68 x 1.82 x 1.47 m, 2.69 m wheelbase (also the Policja car);
// - crossover: a Sportage / Duster-class compact SUV, 4.46 x 1.85 x 1.66 m, 2.68 m wheelbase;
// - van: a Ducato / Sprinter / Crafter-class high-roof panel van, 5.60 x 2.02 x 2.50 m, 3.44 m wheelbase (delivery
//   vans, the PRM ambulance and the PSP light rescue van).
// Optional keys: sideGlassRear (z behind which the side glass is panelled over: a hatch's thick C pillar, a van's
// cargo box), glassTop (y above which there is no glass: the high roof over a van's windscreen and doors), backlight
// (false: no rear window), panelVan (door and rear-door seams on the upper body too), band ([y0, y1] of the livery
// band), letterZ (centre of the livery lettering), barT (where along the roof the light bar stands, 0 front .. 1 rear).
const BODY_SPECS = {
  saloon: {
    name: 'saloon',
    zFront: 2.3,
    zRear: -2.3,
    wheelRadius: 0.32,
    wheelZ: 1.35,
    wheelX: 0.775,
    archGap: 0.06, // wheel arch radius = wheelRadius + archGap
    archFlare: 0.015, // extra half-width over the wheels
    tuck: 0.07, // sill tucked in from the widest point
    halfWidth: [[2.3, 0.85], [1.35, 0.868], [0, 0.874], [-1.35, 0.872], [-2.3, 0.86]],
    sill: [[2.3, 0.28], [1.2, 0.25], [-1.2, 0.25], [-2.3, 0.29]],
    shoulder: [[2.3, 0.64], [0, 0.68], [-2.3, 0.74]],
    edge: [[2.15, 0.76], [1.55, 0.82], [0.95, 0.91], [0.65, 0.94], [-1.0, 0.975], [-1.7, 0.975], [-2.15, 0.92]],
    crown: [[2.15, 0.035], [1.0, 0.03], [0.72, 0.004], [-1.62, 0.004], [-1.84, 0.016], [-2.3, 0.012]],
    tumble: [[2.3, 0.11], [0.9, 0.09], [-1.6, 0.085], [-2.3, 0.1]],
    nose: { halfWidth: [0.32, 0.64, 3], edge: [0.12, 0.74, 3], crown: [0.12, 0.01, 2], sill: [0.13, 0.32, 2], shoulder: [0.2, 0.57, 2.4] },
    tail: { halfWidth: [0.3, 0.68, 2.6], edge: [0.11, 0.9, 3], crown: [0.11, 0.008, 2], sill: [0.14, 0.34, 2], shoulder: [0.2, 0.67, 2.4] },
    cabin: {
      cowl: 0.95,
      roofFront: 0.02,
      roofRear: -1.0,
      deck: -1.78,
      roofY: [[0.02, 1.415], [-0.45, 1.435], [-1.0, 1.4]],
      rail: [0.6, 0.58], // roof rail half-width at the front & rear of the roof
      inset: 0.035, // side glass base inset from the body's top edge
      bulge: 0.012, // side glass outward curvature
      roofEdge: 0.05, // roof rail rounding height
      roofCrown: 0.035,
      roofRound: 4,
      pillars: [-0.28] // B (and C) pillar centres
    },
    doors: [0.92, -0.28, -1.08], // door shut lines
    handles: [-0.11, -0.92],
    headlight: [0.56, 0.68, 0.24, 0.05], // centre |x|, y, half-width, half-height
    taillight: [0.56, 0.8, 0.25, 0.055],
    grille: [0.66, 0.26, 0.04], // upper grille between the headlights: y, half-width, half-height
    intake: [0.36, 0.5, 0.06], // lower grille
    plates: [0.54, 0.66], // front / rear plate centre heights
    bumperLine: [0.76, 0.56], // hood / bumper and trunk / bumper shut lines on the nose & tail
    bumpers: [[0.44, 0.03], [0.47, 0.035]], // front / rear trim: centre height, half-height
    chrome: true, // chrome strip along the side windows' sills
    cladding: 0, // height of the unpainted lower body cladding (crossovers, vans)
    sign: false,
    rails: false,
    rearWiper: false
  },
  hatch: {
    name: 'hatch',
    zFront: 2.12,
    zRear: -2.12,
    wheelRadius: 0.315,
    wheelZ: 1.3,
    wheelX: 0.77,
    archGap: 0.06,
    archFlare: 0.015,
    tuck: 0.07,
    halfWidth: [[2.12, 0.85], [1.3, 0.868], [0, 0.874], [-1.3, 0.872], [-2.12, 0.862]],
    sill: [[2.12, 0.28], [1.15, 0.255], [-1.15, 0.255], [-2.12, 0.31]],
    shoulder: [[2.12, 0.66], [0, 0.7], [-2.12, 0.76]],
    edge: [[1.98, 0.78], [1.45, 0.84], [0.85, 0.93], [0.6, 0.955], [-1.0, 0.985], [-1.8, 1.0], [-2.12, 1.0]],
    crown: [[1.98, 0.035], [0.9, 0.03], [0.66, 0.004], [-2.12, 0.004]],
    tumble: [[2.12, 0.11], [0.9, 0.09], [-2.12, 0.1]],
    nose: { halfWidth: [0.3, 0.66, 3], edge: [0.12, 0.76, 3], crown: [0.12, 0.01, 2], sill: [0.13, 0.32, 2], shoulder: [0.2, 0.6, 2.4] },
    tail: { halfWidth: [0.22, 0.74, 2.6], edge: [0.07, 0.96, 3], crown: [0.07, 0, 2], sill: [0.13, 0.36, 2], shoulder: [0.16, 0.72, 2.4] },
    cabin: {
      cowl: 0.86,
      roofFront: 0.0,
      roofRear: -1.48,
      deck: -1.98,
      roofY: [[0.0, 1.45], [-0.75, 1.47], [-1.48, 1.41]],
      rail: [0.62, 0.58],
      inset: 0.035,
      bulge: 0.012,
      roofEdge: 0.05,
      roofCrown: 0.03,
      roofRound: 4,
      pillars: [-0.36]
    },
    sideGlassRear: -1.38,
    doors: [0.84, -0.36, -1.32],
    handles: [-0.18, -1.12],
    headlight: [0.56, 0.74, 0.24, 0.055],
    taillight: [0.64, 0.92, 0.2, 0.06],
    grille: [0.73, 0.3, 0.04],
    intake: [0.4, 0.46, 0.06],
    plates: [0.55, 0.72],
    bumperLine: [0.78, 0.6],
    bumpers: [[0.45, 0.03], [0.47, 0.035]],
    chrome: false,
    cladding: 0,
    sign: false,
    rails: false,
    rearWiper: true
  },
  estate: {
    name: 'estate',
    zFront: 2.34,
    zRear: -2.34,
    wheelRadius: 0.33,
    wheelZ: 1.345,
    wheelX: 0.79,
    archGap: 0.062,
    archFlare: 0.015,
    tuck: 0.07,
    halfWidth: [[2.34, 0.87], [1.345, 0.888], [0, 0.895], [-1.345, 0.893], [-2.34, 0.88]],
    sill: [[2.34, 0.29], [1.2, 0.26], [-1.2, 0.26], [-2.34, 0.31]],
    shoulder: [[2.34, 0.66], [0, 0.7], [-2.34, 0.76]],
    edge: [[2.18, 0.78], [1.6, 0.84], [1.0, 0.93], [0.7, 0.955], [-1.0, 0.99], [-2.0, 1.0], [-2.34, 1.0]],
    crown: [[2.18, 0.035], [1.05, 0.03], [0.78, 0.004], [-2.34, 0.004]],
    tumble: [[2.34, 0.11], [0.9, 0.09], [-2.34, 0.1]],
    nose: { halfWidth: [0.32, 0.66, 3], edge: [0.12, 0.76, 3], crown: [0.12, 0.01, 2], sill: [0.13, 0.33, 2], shoulder: [0.2, 0.6, 2.4] },
    tail: { halfWidth: [0.22, 0.76, 2.6], edge: [0.07, 0.97, 3], crown: [0.07, 0, 2], sill: [0.13, 0.37, 2], shoulder: [0.16, 0.73, 2.4] },
    cabin: {
      cowl: 0.98,
      roofFront: 0.1,
      roofRear: -1.98,
      deck: -2.2,
      roofY: [[0.1, 1.445], [-0.9, 1.47], [-1.98, 1.455]],
      rail: [0.63, 0.61],
      inset: 0.035,
      bulge: 0.012,
      roofEdge: 0.05,
      roofCrown: 0.03,
      roofRound: 4,
      pillars: [-0.26, -1.24]
    },
    doors: [0.95, -0.26, -1.24],
    handles: [-0.08, -1.04],
    headlight: [0.58, 0.74, 0.25, 0.055],
    taillight: [0.7, 0.93, 0.15, 0.065],
    grille: [0.72, 0.32, 0.05],
    intake: [0.4, 0.48, 0.06],
    plates: [0.55, 0.68],
    bumperLine: [0.78, 0.6],
    bumpers: [[0.45, 0.03], [0.48, 0.035]],
    chrome: true,
    cladding: 0,
    sign: false,
    rails: true,
    rearWiper: true
  },
  crossover: {
    name: 'crossover',
    zFront: 2.23,
    zRear: -2.23,
    wheelRadius: 0.36,
    wheelZ: 1.34,
    wheelX: 0.8,
    archGap: 0.07,
    archFlare: 0.03,
    tuck: 0.07,
    halfWidth: [[2.23, 0.87], [1.34, 0.888], [0, 0.895], [-1.34, 0.893], [-2.23, 0.885]],
    sill: [[2.23, 0.38], [1.15, 0.35], [-1.15, 0.35], [-2.23, 0.41]],
    shoulder: [[2.23, 0.78], [0, 0.82], [-2.23, 0.86]],
    edge: [[2.05, 0.96], [1.45, 1.03], [1.0, 1.08], [0.75, 1.1], [-1.0, 1.135], [-1.9, 1.17], [-2.23, 1.17]],
    crown: [[2.05, 0.035], [1.05, 0.03], [0.8, 0.004], [-2.23, 0.004]],
    tumble: [[2.23, 0.1], [0.9, 0.08], [-2.23, 0.08]],
    nose: { halfWidth: [0.27, 0.72, 3], edge: [0.13, 0.93, 3], crown: [0.13, 0.01, 2], sill: [0.12, 0.41, 2], shoulder: [0.2, 0.72, 2.4] },
    tail: { halfWidth: [0.22, 0.76, 2.6], edge: [0.08, 1.12, 3], crown: [0.08, 0, 2], sill: [0.14, 0.44, 2], shoulder: [0.18, 0.82, 2.4] },
    cabin: {
      cowl: 0.98,
      roofFront: 0.12,
      roofRear: -1.6,
      deck: -2.05,
      roofY: [[0.12, 1.645], [-0.75, 1.665], [-1.6, 1.61]],
      rail: [0.68, 0.64],
      inset: 0.035,
      bulge: 0.012,
      roofEdge: 0.055,
      roofCrown: 0.03,
      roofRound: 4,
      pillars: [-0.3]
    },
    sideGlassRear: -1.42,
    doors: [0.96, -0.3, -1.26],
    handles: [-0.15, -1.04],
    headlight: [0.6, 0.86, 0.23, 0.06],
    taillight: [0.72, 0.98, 0.1, 0.12],
    grille: [0.84, 0.36, 0.085],
    intake: [0.48, 0.44, 0.05],
    plates: [0.67, 0.8],
    bumperLine: [0.94, 0.66],
    bumpers: [[0.56, 0.04], [0.56, 0.04]],
    chrome: false,
    cladding: 0.5,
    sign: false,
    rails: true,
    rearWiper: true
  },
  van: {
    name: 'van',
    zFront: 2.8,
    zRear: -2.8,
    wheelRadius: 0.355,
    wheelZ: 1.72,
    wheelX: 0.88,
    archGap: 0.075,
    archFlare: 0.012,
    tuck: 0.05,
    halfWidth: [[2.8, 0.92], [2.2, 0.985], [1.72, 0.995], [0, 1.0], [-2.8, 1.0]],
    sill: [[2.8, 0.42], [1.5, 0.4], [-1.5, 0.4], [-2.8, 0.44]],
    shoulder: [[2.8, 0.8], [1.5, 0.95], [-2.8, 0.95]],
    edge: [[2.62, 0.98], [2.2, 1.06], [1.8, 1.16], [1.55, 1.2], [-2.8, 1.2]],
    crown: [[2.62, 0.04], [1.9, 0.03], [1.7, 0.0], [-2.8, 0.0]],
    tumble: [[2.8, 0.05], [1.5, 0.018], [-2.8, 0.018]],
    nose: { halfWidth: [0.4, 0.76, 2.6], edge: [0.16, 0.9, 3], crown: [0.16, 0.01, 2], sill: [0.12, 0.46, 2], shoulder: [0.24, 0.72, 2.4] },
    tail: { halfWidth: [0.07, 0.95, 3], edge: [0.05, 1.16, 3], crown: [0.05, 0, 2], sill: [0.08, 0.48, 2], shoulder: [0.06, 0.93, 2.4] },
    cabin: {
      cowl: 1.78,
      roofFront: 0.95,
      roofRear: -2.74,
      deck: -2.79,
      roofY: [[0.95, 2.48], [-1.0, 2.5], [-2.74, 2.5]],
      rail: [0.92, 0.95],
      inset: 0.006,
      bulge: 0.004,
      roofEdge: 0.1,
      roofCrown: 0.03,
      roofRound: 6,
      pillars: []
    },
    sideGlassRear: 0.84,
    glassTop: 2.0,
    backlight: false,
    panelVan: true,
    doors: [1.3, 0.78, 0.66, -0.66],
    handles: [0.9, -0.5],
    headlight: [0.66, 0.98, 0.2, 0.09],
    taillight: [0.89, 0.95, 0.06, 0.22],
    grille: [0.82, 0.5, 0.11],
    intake: [0.42, 0.6, 0.05],
    plates: [0.63, 0.64],
    bumperLine: [0.95, 0.74],
    bumpers: [[0.5, 0.06], [0.5, 0.06]],
    chrome: false,
    cladding: 0.44,
    band: [0.8, 1.04],
    letterZ: -0.6,
    barT: 0.03,
    sign: false,
    rails: false,
    rearWiper: false
  }
};
BODY_SPECS.taxi = Object.assign({}, BODY_SPECS.saloon, { name: 'taxi', sign: true });

// Overall footprint of a body spec for traffic (lane spacing, collisions, contact shadows): the half length, the widest
// half-width over the wheel flares, the wheel offset from the centre and the roof height
function carDimensions(spec) {
  if (spec._dims) return spec._dims;
  const halfWidth = Math.max(...spec.halfWidth.map((p) => p[1])) + spec.archFlare;
  const roof = Math.max(...spec.cabin.roofY.map((p) => p[1]));
  spec._dims = { half: (spec.zFront - spec.zRear) / 2, halfWidth, axle: spec.wheelZ, roof };
  return spec._dims;
}

const lerp = (a, b, t) => a + (b - a) * t;

// Monotone cubic (Fritsch-Carlson) interpolation through [x, y] control points: smooth, never overshoots
function smoothCurve(points) {
  const pts = points.slice().sort((a, b) => a[0] - b[0]);
  const n = pts.length;
  if (n === 1) return () => pts[0][1];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const h = [];
  const d = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(xs[i + 1] - xs[i]);
    d.push((ys[i + 1] - ys[i]) / h[i]);
  }
  const m = [d[0]];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) {
      m.push(0);
    } else {
      const w1 = 2 * h[i] + h[i - 1];
      const w2 = h[i] + 2 * h[i - 1];
      m.push((w1 + w2) / (w1 / d[i - 1] + w2 / d[i]));
    }
  }
  m.push(d[n - 2]);
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const t = (x - xs[i]) / h[i];
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1];
  };
}

// 1 along the body, falling to 0 at the tip along a superelliptic quarter (vertical tangent at the tip)
function endFactor(z, zTip, length, exponent = 2) {
  const u = zTip > 0 ? (z - (zTip - length)) / length : (zTip + length - z) / length;
  if (u <= 0) return 1;
  if (u >= 1) return 0;
  return Math.pow(1 - Math.pow(u, exponent), 1 / exponent);
}

/**
 * Evaluates a body spec's curves into the cross-section parameters along the vehicle (memoized on the spec):
 *   body(z) -> { W: half-width, yB: sill, yS: shoulder (widest), yE / xE: top edge, yT: crown, xB: sill half-width }
 */
function bodyProfile(spec) {
  if (spec._body) return spec._body;
  const W0 = smoothCurve(spec.halfWidth);
  const B0 = smoothCurve(spec.sill);
  const S0 = smoothCurve(spec.shoulder);
  const E0 = smoothCurve(spec.edge);
  const C0 = smoothCurve(spec.crown);
  const T0 = smoothCurve(spec.tumble);
  const archR = spec.wheelRadius + spec.archGap;
  const axles = [spec.wheelZ, -spec.wheelZ];

  const rounded = (z, value, key) => {
    const nose = spec.nose[key];
    const tail = spec.tail[key];
    if (nose && z > 0) value = nose[1] + (value - nose[1]) * endFactor(z, spec.zFront, nose[0], nose[2]);
    if (tail && z < 0) value = tail[1] + (value - tail[1]) * endFactor(z, spec.zRear, tail[0], tail[2]);
    return value;
  };

  const body = (z) => {
    let flare = 0;
    for (const axle of axles) {
      const d = (z - axle) / (archR + 0.4);
      if (Math.abs(d) < 1) flare = Math.max(flare, (1 - d * d) ** 2);
    }
    const W = rounded(z, W0(z) + spec.archFlare * flare, 'halfWidth');
    let yB = rounded(z, B0(z), 'sill');
    for (const axle of axles) {
      const d = Math.abs(z - axle);
      if (d < archR) yB = Math.max(yB, spec.wheelRadius + Math.sqrt(archR * archR - d * d));
    }
    const yE = rounded(z, E0(z), 'edge');
    const yT = yE + Math.max(0, rounded(z, C0(z), 'crown'));
    const yS = Math.min(Math.max(rounded(z, S0(z), 'shoulder'), yB + 0.035), yE - 0.035);
    const xE = Math.max(W - T0(z), W * 0.55);
    return { z, W, yB, yS, yE, yT, xE, xB: W - spec.tuck };
  };
  spec._body = body;
  return body;
}

/**
 * A car's body profile plus its glasshouse (memoized on the spec):
 *   cabin(z) -> { beltX, beltY: side glass base, railX, railY: top of the side glass, h: roof / glass crown height }
 */
function carLayout(spec) {
  if (spec._layout) return spec._layout;
  const body = bodyProfile(spec);
  const archR = spec.wheelRadius + spec.archGap;
  const cab = spec.cabin;
  const roofY = smoothCurve(cab.roofY);
  const H = cab.roofEdge + cab.roofCrown;
  const belt = (z) => {
    const s = body(z);
    return { x: s.xE - cab.inset, y: s.yE - 0.004 };
  };
  const bc = belt(cab.cowl);
  const bd = belt(cab.deck);
  const railF = { x: cab.rail[0], y: roofY(cab.roofFront) - H };
  const railR = { x: cab.rail[1], y: roofY(cab.roofRear) - H };
  const roofMid = (cab.roofFront + cab.roofRear) / 2;
  const railM = { x: (cab.rail[0] + cab.rail[1]) / 2, y: roofY(roofMid) - H };
  // At the cowl & deck the glass arch stays under the hood / trunk crown, so the glass grows out of the panel
  const hCowl = Math.max(0.006, body(cab.cowl).yT - bc.y - 0.008);
  const hDeck = Math.max(0.006, body(cab.deck).yT - bd.y - 0.008);

  const cabin = (z) => {
    const b = belt(z);
    let railX;
    let railY;
    let h;
    if (z >= cab.roofFront) {
      const t = (cab.cowl - z) / (cab.cowl - cab.roofFront);
      railX = lerp(bc.x, railF.x, t);
      railY = lerp(bc.y, railF.y, t);
      h = lerp(hCowl, H, Math.min(1, t * 1.6));
    } else if (z <= cab.roofRear) {
      const t = (z - cab.deck) / (cab.roofRear - cab.deck);
      railX = lerp(bd.x, railR.x, t);
      railY = lerp(bd.y, railR.y, t);
      h = lerp(hDeck, H, Math.min(1, t * 1.6));
    } else {
      const t = (cab.roofFront - z) / (cab.roofFront - cab.roofRear);
      railX = lerp(railF.x, railR.x, t);
      railY = roofY(z) - H;
      h = H;
    }
    return { z, beltX: Math.max(b.x, railX), beltY: Math.min(b.y, railY), railX, railY, h, bulge: cab.bulge };
  };

  // Height of the glasshouse's top surface (roof / windshield crown) at |x| for a cabin section
  const cabinTop = (c, x) => {
    const n = cab.roofRound;
    const ratio = Math.min(1, Math.abs(x) / Math.max(c.railX, 1e-4));
    const th = Math.acos(Math.pow(ratio, n / 2));
    return c.railY + c.h * Math.pow(Math.sin(th), 2 / n);
  };

  spec._layout = { spec, body, cabin, cabinTop, archR, belt: { cowl: bc, deck: bd }, rail: { front: railF, mid: railM, rear: railR, roofMid } };
  return spec._layout;
}

// Section winding used by every car loft in this file: left (-x) bottom, up & over the top, right (+x) bottom
function mirrorSection(right, center, z) {
  const pts = [];
  for (const [x, y] of right) pts.push(new THREE.Vector3(-x, y, z));
  if (center) pts.push(new THREE.Vector3(center[0], center[1], z));
  for (let i = right.length - 1; i >= 0; i--) pts.push(new THREE.Vector3(right[i][0], right[i][1], z));
  return pts;
}

const BODY_LOWER_ROUND = 2.8;
const BODY_UPPER_ROUND = 3.2;

// Right half of a body cross-section: superelliptic lower corner (sill -> widest point), superelliptic upper corner
// (widest point -> top edge) and a parabolic crown. Specs may sharpen the corners (lowerRound / upperRound) and sample
// the upper corner more densely (upperSamples).
function bodyHalfProfile(s, detail, spec = {}) {
  const n1 = spec.lowerRound || BODY_LOWER_ROUND;
  const n2 = spec.upperRound || BODY_UPPER_ROUND;
  const right = [];
  const low = detail ? [0, 0.32, 0.64, 1] : [0, 1];
  const up = detail ? spec.upperSamples || [0.38, 0.72, 1] : [1];
  const top = detail ? [0.66, 0.33] : [0.5];
  for (const a of low) {
    const th = (a * Math.PI) / 2;
    right.push([s.xB + (s.W - s.xB) * Math.pow(Math.sin(th), 2 / n1), s.yS - (s.yS - s.yB) * Math.pow(Math.cos(th), 2 / n1)]);
  }
  for (const a of up) {
    const th = (a * Math.PI) / 2;
    right.push([s.xE + (s.W - s.xE) * Math.pow(Math.cos(th), 2 / n2), s.yS + (s.yE - s.yS) * Math.pow(Math.sin(th), 2 / n2)]);
  }
  for (const f of top) right.push([s.xE * f, s.yE + (s.yT - s.yE) * (1 - f * f)]);
  return right;
}

function bodyStations(spec, detail) {
  const zs = [];
  const add = (z) => zs.push(Math.min(spec.zFront, Math.max(spec.zRear, z)));
  const step = detail ? spec.stationStep || 0.28 : 0.75;
  for (let z = spec.zRear; z < spec.zFront; z += step) add(z);
  add(spec.zFront);
  const noseLen = Math.max(...Object.values(spec.nose).map((v) => v[0]));
  const tailLen = Math.max(...Object.values(spec.tail).map((v) => v[0]));
  for (const u of detail ? [0, 0.3, 0.52, 0.7, 0.83, 0.92, 0.97, 0.993] : [0, 0.6, 0.92]) {
    add(spec.zFront - noseLen * (1 - u));
    add(spec.zRear + tailLen * (1 - u));
  }
  const archR = spec.wheelRadius + spec.archGap;
  const k = detail ? 8 : 4;
  for (const axle of [spec.wheelZ, -spec.wheelZ]) {
    for (let i = 0; i <= k; i++) add(axle + archR * Math.cos((i / k) * Math.PI));
    add(axle + archR + 0.006);
    add(axle - archR - 0.006);
  }
  if (detail && spec.cabin) {
    add(spec.cabin.cowl);
    add(spec.cabin.deck);
  }
  zs.sort((a, b) => b - a);
  const eps = detail ? 0.004 : 0.04;
  const out = [];
  for (const z of zs) {
    if (!out.length || out[out.length - 1] - z > eps) out.push(z);
  }
  out[0] = spec.zFront;
  out[out.length - 1] = spec.zRear;
  return out;
}

function buildBodyLoft(spec, detail = 1) {
  const body = bodyProfile(spec);
  const sections = bodyStations(spec, detail).map((z) => {
    const s = body(z);
    return mirrorSection(bodyHalfProfile(s, detail, spec), [0, s.yT], z);
  });
  return new LoftGeometry(sections, { capStart: true, capEnd: true });
}

function buildCarBody(spec, detail = 1) {
  return part(buildBodyLoft(spec, detail), CAR_PARTS.BODY);
}

function cabinSection(c, detail, roundness) {
  const right = [[c.beltX, c.beltY]];
  if (detail) {
    for (const s of [1 / 3, 2 / 3]) {
      right.push([lerp(c.beltX, c.railX, s) + c.bulge * 4 * s * (1 - s), lerp(c.beltY, c.railY, s)]);
    }
  }
  right.push([c.railX, c.railY]);
  for (const f of detail ? [0.2, 0.42, 0.68] : [0.5]) {
    const th = (f * Math.PI) / 2;
    right.push([c.railX * Math.pow(Math.cos(th), 2 / roundness), c.railY + c.h * Math.pow(Math.sin(th), 2 / roundness)]);
  }
  return mirrorSection(right, [0, c.railY + c.h], c.z);
}

function cabinStations(spec, detail) {
  const cab = spec.cabin;
  const zs = [];
  for (const t of detail ? [0, 0.1, 0.24, 0.42, 0.62, 0.82] : [0, 0.5]) zs.push(lerp(cab.cowl, cab.roofFront, t));
  for (const t of detail ? [0, 0.25, 0.5, 0.75] : [0, 0.5]) zs.push(lerp(cab.roofFront, cab.roofRear, t));
  for (const t of detail ? [1, 0.8, 0.6, 0.4, 0.22, 0.1, 0] : [1, 0.5, 0]) zs.push(lerp(cab.deck, cab.roofRear, t));
  return zs;
}

function buildCarCabin(spec, detail = 1) {
  const L = carLayout(spec);
  const sections = cabinStations(spec, detail).map((z) => cabinSection(L.cabin(z), detail, spec.cabin.roofRound));
  return part(new LoftGeometry(sections, { closed: false }), CAR_PARTS.WINDOW);
}

/**
 * Half-width of a body's outer skin at height y of the cross-section at z (for decals & signs that hug the sides)
 */
function carBodyHalfWidthAt(spec, z, y) {
  const s = bodyProfile(spec)(z);
  const n1 = spec.lowerRound || BODY_LOWER_ROUND;
  const n2 = spec.upperRound || BODY_UPPER_ROUND;
  const pts = [];
  for (let i = 0; i <= 16; i++) {
    const th = ((i / 16) * Math.PI) / 2;
    pts.push([s.xB + (s.W - s.xB) * Math.pow(Math.sin(th), 2 / n1), s.yS - (s.yS - s.yB) * Math.pow(Math.cos(th), 2 / n1)]);
  }
  for (let i = 1; i <= 16; i++) {
    const th = ((i / 16) * Math.PI) / 2;
    pts.push([s.xE + (s.W - s.xE) * Math.pow(Math.cos(th), 2 / n2), s.yS + (s.yE - s.yS) * Math.pow(Math.sin(th), 2 / n2)]);
  }
  if (y <= pts[0][1]) return pts[0][0];
  for (let i = 1; i < pts.length; i++) {
    if (y <= pts[i][1]) {
      const t = (y - pts[i - 1][1]) / Math.max(pts[i][1] - pts[i - 1][1], 1e-6);
      return lerp(pts[i - 1][0], pts[i][0], t);
    }
  }
  return s.xE;
}

/**
 * A thin grid patch lying `offset` m off the body side (side = +1: +x) over z0..z1, y0..y1. UVs read from the
 * front of the car to the back on both sides (u = 0 at the front on the +x side, at the back on the -x side).
 */
function buildCarSidePatch(spec, side, z0, z1, y0, y1, offset = 0.003, nz = 10, ny = 6) {
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let j = 0; j <= ny; j++) {
    const v = j / ny;
    const y = lerp(y0, y1, v);
    for (let i = 0; i <= nz; i++) {
      const u = i / nz;
      const z = side > 0 ? lerp(z1, z0, u) : lerp(z0, z1, u);
      positions.push(side * (carBodyHalfWidthAt(spec, z, y) + offset), y, z);
      uvs.push(u, v);
      if (i < nz && j < ny) {
        const a = j * (nz + 1) + i;
        const b = a + 1;
        const c = a + nz + 1;
        const d = c + 1;
        if (side > 0) indices.push(a, b, c, b, d, c);
        else indices.push(a, c, b, b, c, d);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

function roundedRectShape(hw, hh, r) {
  const s = new THREE.Shape();
  s.moveTo(-hw + r, -hh);
  s.lineTo(hw - r, -hh);
  s.quadraticCurveTo(hw, -hh, hw, -hh + r);
  s.lineTo(hw, hh - r);
  s.quadraticCurveTo(hw, hh, hw - r, hh);
  s.lineTo(-hw + r, hh);
  s.quadraticCurveTo(-hw, hh, -hw, hh - r);
  s.lineTo(-hw, -hh + r);
  s.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
  return s;
}

// Rounded box extruded along z, centred on the origin
function roundedBox(hw, hh, depth, r, bevel = 0.012) {
  const g = new THREE.ExtrudeGeometry(roundedRectShape(hw - bevel, hh - bevel, Math.max(0.002, r - bevel)), {
    depth: Math.max(0.001, depth - 2 * bevel),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 2
  });
  return g.translate(0, 0, -(depth - 2 * bevel) / 2);
}

/**
 * Builds a single wheel assembly (LatheGeometry tyre + recessed alloy lip + dished hub)
 * centered at the origin (for steerable/spinning player wheels) or translated to (x, r, z).
 */
function buildWheelParts(spec, side, translateToAxle = false, z = 0) {
  const r = spec.wheelRadius;
  const rim = r * 0.64;
  const width = r * 0.68;
  const wheelProfile = [
    new THREE.Vector2(rim + 0.014, -width * 0.44),
    new THREE.Vector2(r * 0.96, -width * 0.33),
    new THREE.Vector2(r, -width * 0.05),
    new THREE.Vector2(r, width * 0.05),
    new THREE.Vector2(r * 0.96, width * 0.33),
    new THREE.Vector2(rim + 0.014, width * 0.44)
  ];

  const x = translateToAxle ? side * spec.wheelX : 0;
  const y = translateToAxle ? r : 0;
  const zOff = translateToAxle ? z : 0;

  const tyre = new THREE.LatheGeometry(wheelProfile, 20)
    .rotateZ(-side * Math.PI * 0.5)
    .translate(x, y, zOff);
  const lip = new THREE.LatheGeometry(
    [new THREE.Vector2(rim + 0.014, width * 0.44), new THREE.Vector2(rim, width * 0.29)],
    20
  )
    .rotateZ(-side * Math.PI * 0.5)
    .translate(x, y, zOff);
  const backLip = new THREE.LatheGeometry(
    [new THREE.Vector2(rim, -width * 0.29), new THREE.Vector2(rim + 0.014, -width * 0.44)],
    20
  )
    .rotateZ(-side * Math.PI * 0.5)
    .translate(x, y, zOff);
  const hub = new THREE.CircleGeometry(rim, 20);
  hub.attributes.position.setZ(0, -0.015);
  hub.computeVertexNormals();
  hub.rotateY(side * Math.PI * 0.5).translate(x + side * width * 0.29, y, zOff);

  const backHub = new THREE.CircleGeometry(rim, 20);
  backHub.attributes.position.setZ(0, -0.015);
  backHub.computeVertexNormals();
  backHub.rotateY(-side * Math.PI * 0.5).translate(x - side * width * 0.29, y, zOff);

  const list = [
    part(tyre, CAR_PARTS.TYRE),
    part(lip, CAR_PARTS.ALLOY),
    part(backLip, CAR_PARTS.ALLOY),
    part(hub, CAR_PARTS.ALLOY),
    part(backHub, CAR_PARTS.ALLOY)
  ];

  if (translateToAxle) list.push(buildWheelWell(spec, side, z));
  return list;
}

// Dark arch liner behind a wheel, so the arch never shows through to the other side of the car
function buildWheelWell(spec, side, z) {
  const r = spec.wheelRadius;
  const width = r * 0.68;
  const wellOuter = new THREE.CircleGeometry(spec.wheelRadius + spec.archGap + 0.01, 10, 0, Math.PI)
    .rotateY(side * Math.PI * 0.5)
    .translate(side * (spec.wheelX - (width * 0.5 + 0.02)), r, z);
  const wellInner = new THREE.CircleGeometry(spec.wheelRadius + spec.archGap + 0.01, 10, 0, Math.PI)
    .rotateY(-side * Math.PI * 0.5)
    .translate(side * (spec.wheelX - (width * 0.5 + 0.02)), r, z);
  return part(mergeGeometries([wellOuter, wellInner]), CAR_PARTS.TRIM);
}

function buildSteerableWheelGeo(spec, side) {
  return mergeGeometries(buildWheelParts(spec, side, false));
}

function buildMirrors(spec) {
  const L = carLayout(spec);
  const z = spec.cabin.cowl - 0.17;
  const c = L.cabin(z);
  const list = [];
  for (const side of [-1, 1]) {
    const housing = roundedBox(0.1, 0.06, 0.085, 0.035, 0.014)
      .rotateY(side * 0.12)
      .translate(side * (c.beltX + 0.15), c.beltY + 0.085, z - 0.02);
    const arm = new THREE.BoxGeometry(0.12, 0.035, 0.06)
      .rotateZ(side * 0.35)
      .translate(side * (c.beltX + 0.04), c.beltY + 0.045, z);
    list.push(part(housing, CAR_PARTS.MIRROR), part(arm, CAR_PARTS.TRIM));
  }
  return list;
}

function buildRoofRails(spec) {
  const L = carLayout(spec);
  const cab = spec.cabin;
  const list = [];
  for (const side of [-1, 1]) {
    const sections = [0.04, 0.1, 0.9, 0.96].map((t, i) => {
      const z = lerp(cab.roofFront, cab.roofRear, t);
      const c = L.cabin(z);
      const x = side * c.railX * 0.8;
      const y = L.cabinTop(c, x) + (i === 0 || i === 3 ? 0.004 : 0.05);
      return [
        new THREE.Vector3(x - 0.02, y - 0.016, z),
        new THREE.Vector3(x + 0.02, y - 0.016, z),
        new THREE.Vector3(x + 0.02, y + 0.016, z),
        new THREE.Vector3(x - 0.02, y + 0.016, z)
      ].reverse();
    });
    list.push(part(new LoftGeometry(sections, { capStart: true, capEnd: true }), CAR_PARTS.TRIM));
  }
  return list;
}

// Polish roof "TAXI" lamp: a small lit box across the roof on a black mount, lettered front and back (the lettering is
// painted by createLoftedCarMaterial from the livery atlas)
const TAXI_LAMP = { hw: 0.21, hh: 0.065, depth: 0.1, lift: 0.03 };

function taxiSignPlacement(spec) {
  const L = carLayout(spec);
  const cab = spec.cabin;
  const z = lerp(cab.roofFront, cab.roofRear, 0.45);
  const c = L.cabin(z);
  return { z, y: c.railY + c.h };
}

function buildTaxiSign(spec) {
  const { z, y } = taxiSignPlacement(spec);
  const { hw, hh, depth, lift } = TAXI_LAMP;
  const sign = roundedBox(hw, hh, depth, 0.03, 0.012).translate(0, y + lift + hh, z);
  const mount = new THREE.BoxGeometry(hw * 1.5, 0.035, depth).translate(0, y + 0.014, z);
  return [part(sign, CAR_PARTS.SIGN), part(mount, CAR_PARTS.TRIM)];
}

// Wrap the bumper strips around the nose and tail. Six rectangular sections cost just 44 triangles each;
// the inner faces sit in the body, while the outer faces stand 2.5 cm proud of the tips.
function buildBumpers(spec) {
  return spec.bumpers.map(([y, h], end) => {
    const direction = end === 0 ? 1 : -1;
    const tip = end === 0 ? spec.zFront : spec.zRear;
    const sections = [];
    for (const side of [-1, 1]) {
      for (const setback of side < 0 ? [0.3, 0.07, 0] : [0, 0.07, 0.3]) {
        const z = tip - direction * setback;
        const x = side * (carBodyHalfWidthAt(spec, z, y) + 0.012);
        const innerX = x - side * 0.05;
        const outerZ = z + direction * 0.025;
        const innerZ = z - direction * 0.105;
        const section = [
          new THREE.Vector3(x, y - h, outerZ),
          new THREE.Vector3(innerX, y - h, innerZ),
          new THREE.Vector3(innerX, y + h, innerZ),
          new THREE.Vector3(x, y + h, outerZ)
        ];
        sections.push(direction > 0 ? section : section.reverse());
      }
    }
    return part(new LoftGeometry(sections, { capStart: true, capEnd: true }), CAR_PARTS.TRIM);
  });
}

function buildCarGeometry(spec, includeWheels = true) {
  const parts = [buildCarBody(spec, 1), buildCarCabin(spec, 1), ...buildMirrors(spec), ...buildBumpers(spec)];
  for (const side of [-1, 1]) {
    for (const z of [-spec.wheelZ, spec.wheelZ]) {
      if (includeWheels) parts.push(...buildWheelParts(spec, side, true, z));
      else parts.push(buildWheelWell(spec, side, z));
    }
  }
  if (spec.rails) parts.push(...buildRoofRails(spec));
  if (spec.sign) parts.push(...buildTaxiSign(spec));
  return mergeGeometries(parts);
}

// A ~250-triangle stand-in for distant cars (a few pixels tall): the same body & glasshouse lofted from a handful of
// coarse sections, dark wheel blocks and the taxi's roof sign. Same attributes (partId, uv, normal) as the full
// model, so it renders with the same material and per-instance paint.
function buildCarProxyGeometry(spec) {
  const parts = [buildCarBody(spec, 0), buildCarCabin(spec, 0)];
  const r = spec.wheelRadius;
  for (const side of [-1, 1]) {
    for (const z of [-spec.wheelZ, spec.wheelZ]) {
      parts.push(part(new THREE.BoxGeometry(r * 0.6, r * 1.7, r * 1.7).translate(side * spec.wheelX, r * 0.88, z), CAR_PARTS.TYRE));
    }
  }
  if (spec.sign) {
    const { z, y } = taxiSignPlacement(spec);
    const { hw, hh, depth, lift } = TAXI_LAMP;
    parts.push(part(new THREE.BoxGeometry(hw * 2, hh * 2, depth).translate(0, y + lift + hh, z), CAR_PARTS.SIGN));
  }
  return mergeGeometries(parts);
}

// Where a body's emergency light bar stands: z along the roof (spec.barT, a third of the way back by default, at the
// front of a van's roof) and y, the top of the roof there (on the rails of a body that has them, 4.5 cm higher)
function lightbarPlacement(spec) {
  const L = carLayout(spec);
  const cab = spec.cabin;
  const z = lerp(cab.roofFront, cab.roofRear, spec.barT ?? 0.32);
  const c = L.cabin(z);
  return { z, y: c.railY + c.h + (spec.rails ? 0.045 : 0) };
}

// Emergency roof light bar (Policja, PRM, PSP: blue on both halves) for a body spec's roof, lit by
// createLightbarMaterial
function buildLightbarGeometry(spec) {
  const { z, y } = lightbarPlacement(spec);
  const bar = roundedBox(0.13, 0.045, 1.12, 0.04, 0.02).rotateY(Math.PI / 2).translate(0, y + 0.075, z);
  const parts = [part(bar, CAR_PARTS.SIGN)];
  for (const side of [-1, 1]) {
    parts.push(part(new THREE.BoxGeometry(0.06, 0.05, 0.16).translate(side * 0.42, y + 0.02, z), CAR_PARTS.TRIM));
  }
  return mergeGeometries(parts);
}

let _lightbarMat = null;

// Light bar lenses: Polish emergency vehicles flash blue only, so both halves are blue and alternate (double strobes,
// the -x half first), each car on its own phase, with a clear section between them
function createLightbarMaterial() {
  if (_lightbarMat) return _lightbarMat;
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.18, metalness: 0.1 });
  const lightbar = () => {
    const p = attribute('position', 'vec3');
    const partId = attribute('partId', 'float');
    const isLens = step(abs(partId.sub(CAR_PARTS.SIGN)), 0.25);
    const phase = fract(float(instanceIndex).mul(0.61803)).toVar();
    const t = fract(time.mul(1.6).add(phase)).toVar();
    const strobe = step(0.5, fract(t.mul(6.0)));
    const isLeft = step(p.x, -0.035);
    const isRight = step(0.035, p.x);
    const on = isLeft.mul(step(t, 0.5)).add(isRight.mul(step(0.5, t))).mul(strobe);
    return { isLens, on, isBlue: max(isLeft, isRight) };
  };
  mat.colorNode = Fn(() => {
    const s = lightbar();
    return mix(color(0x15181b), mix(color(0xd8dde2), color(0x0f3c9a), s.isBlue), s.isLens);
  })();
  mat.emissiveNode = Fn(() => {
    const s = lightbar();
    return color(0x2a6cff).mul(s.isBlue.mul(s.on).mul(7.0)).mul(s.isLens);
  })();
  _lightbarMat = mat;
  return mat;
}

// Filter-width anti-aliased 2D rounded rectangle SDF (ported from CarGenerator.js)
const roundedRect = Fn(([point, halfSize, radiusNode]) => {
  const pt = vec2(point).toVar();
  const hs = vec2(halfSize).toVar();
  const rad = float(radiusNode).toVar();
  const q = abs(pt).sub(hs).add(rad).toVar();
  const dist = length(max(q, vec2(0.0))).add(min(max(q.x, q.y), 0.0)).sub(rad).toVar();
  const edge = max(fwidth(dist), 0.001).toVar();
  return smoothstep(edge, edge.negate(), dist);
});

// IQ polynomial smooth maximum: rounds the corners of max()-combined half-plane distances
const smax = (a, b, k) => {
  const h = max(float(k).sub(abs(a.sub(b))), 0.0).div(k);
  return max(a, b).add(h.mul(h).mul(k * 0.25));
};

// Signed distance (approximate outside, exact inside) to a convex polygon given as outward half-planes [nx, ny, c]
const polygonDistance = (px, py, planes, k) => {
  let d = null;
  for (const [nx, ny, c] of planes) {
    const e = px.mul(nx).add(py.mul(ny)).sub(c);
    d = d === null ? e : smax(d, e, k);
  }
  return d;
};

// Outward half-planes of a counter-clockwise polygon, each edge moved in by its margin
function polygonPlanes(points, margins) {
  const planes = [];
  for (let i = 0; i < points.length; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[(i + 1) % points.length];
    const len = Math.hypot(bx - ax, by - ay);
    const nx = (by - ay) / len;
    const ny = -(bx - ax) / len;
    planes.push([nx, ny, ax * nx + ay * ny - margins[i]]);
  }
  return planes;
}

const coverage = (d) => {
  const w = max(fwidth(d), 0.0008);
  return smoothstep(w, w.negate(), d);
};

const _carMaterialCache = new Map();
let _carPlateTexture;
let _carLetteringTexture;

// EU plates (520 x 114 mm): white with the blue EU strip on the left, then a two-letter district code and the
// five-character individual part, front and rear (the rear one with the round registration sticker in the gap).
// Every car gets its own made-up registration from a seed: PO and PY are Poznań city's two series, PZ the county.
// The individual part follows the Polish layouts for two-letter districts (digits D, letters L; the letters skip
// B, D, I, O, Z, which read like digits). The material draws the glyphs from one 32-cell atlas.
const PLATE = { hw: 0.26, hh: 0.057 };
const PLATE_GLYPHS = '0123456789ACEFGHJKLMNPRSTUVWXYOZ';
const PLATE_LETTERS = 'ACEFGHJKLMNPRSTUVWXY';
const PLATE_DISTRICTS = [['PO', 0.55], ['PZ', 0.3], ['PY', 0.15]];
const PLATE_LAYOUTS = ['DDDDD', 'DDDDL', 'DDDLL', 'DLDDD', 'DLLDD', 'LDDDD', 'LLDDD'];

// A made-up registration such as 'PO 1AB23' or 'PZ 12345', the same for the same seed (mulberry32)
function polishRegistration(seed) {
  let t = (seed * 2654435761) >>> 0;
  const rand = () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
  let u = rand();
  let district = PLATE_DISTRICTS[0][0];
  for (const [code, share] of PLATE_DISTRICTS) {
    district = code;
    if ((u -= share) < 0) break;
  }
  const layout = PLATE_LAYOUTS[Math.floor(rand() * PLATE_LAYOUTS.length)];
  let rest = '';
  for (let k = 0; k < layout.length; k++) {
    if (layout[k] === 'L') rest += PLATE_LETTERS[Math.floor(rand() * PLATE_LETTERS.length)];
    else rest += String(k === 0 ? 1 + Math.floor(rand() * 9) : Math.floor(rand() * 10));
  }
  return `${district} ${rest}`;
}

// Packs a registration's seven glyphs into the per-instance `plateCode` vec4 the car material reads: two atlas indices
// per component (first * 32 + second; w holds the last one * 32), exact in float32
function encodeRegistration(text, out = new Float32Array(4)) {
  const glyphs = text.replace(' ', '');
  const index = (k) => Math.max(0, PLATE_GLYPHS.indexOf(glyphs[k] || '0'));
  for (let c = 0; c < 4; c++) out[c] = index(2 * c) * 32 + (2 * c + 1 < 7 ? index(2 * c + 1) : 0);
  return out;
}

// One row of 32 glyph cells (40 x 64 px) in a narrow bold face, white on black (the material uses it as a mask)
function carPlateGlyphTexture() {
  if (_carPlateTexture) return _carPlateTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 40 * PLATE_GLYPHS.length;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 62px "Arial Narrow", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let k = 0; k < PLATE_GLYPHS.length; k++) fitText(ctx, PLATE_GLYPHS[k], k * 40 + 20, 34, 29);
  _carPlateTexture = new THREE.CanvasTexture(canvas);
  _carPlateTexture.anisotropy = 4;
  return _carPlateTexture;
}

// Fits a line of text into a box: centred, squeezed horizontally when it would be wider
function fitText(ctx, text, cx, cy, maxWidth) {
  const w = ctx.measureText(text).width;
  const k = w > maxWidth ? maxWidth / w : 1;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(k, 1);
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

// Livery lettering as a mask (white on black), one row each, read by createLoftedCarMaterial: carState.w - 1 picks
// the row on the doors; the taxi's roof lamp uses the last one
const LETTERING = ['POLICJA', 'AMBULANS', 'STRAŻ', 'TAXI'];

function carLetteringTexture() {
  if (_carLetteringTexture) return _carLetteringTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 64 * LETTERING.length;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 50px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  LETTERING.forEach((label, row) => fitText(ctx, label, 256, row * 64 + 34, 480));
  _carLetteringTexture = new THREE.CanvasTexture(canvas);
  return _carLetteringTexture;
}

/**
 * Paint of an EU plate (PLATE size, centred on x = 0 at height plateY) on a nose (atFront 1) or tail (0), for the car
 * and bus materials: the blue strip with its ring of stars on the viewer's left, then the registration packed in
 * plateCode (encodeRegistration; null: blank) in eight cells: district, a gap (the round registration sticker on the
 * rear plate), five characters. One glyph-atlas sample, whose gradients come from the continuous cell coordinate, so
 * the jumps between glyph cells pick no wrong mip level.
 */
function plateColor(p, plateY, atFront, plateCode) {
  const one = float(1.0);
  const plateU = p.x.mul(atFront.mul(2.0).sub(1.0)).div(2 * PLATE.hw).add(0.5);
  const plateV = p.y.sub(plateY).div(2 * PLATE.hh).add(0.5);
  const euStrip = step(plateU, 0.085);
  const starRing = length(vec2(plateU.sub(0.0425).mul(2 * PLATE.hw), plateV.sub(0.62).mul(2 * PLATE.hh)));
  const stars = smoothstep(0.004, 0.0015, abs(starRing.sub(0.0125)));
  let col = mix(mix(color(0xeceeea), color(0x1c3d9a), euStrip), color(0xf2c81a), stars.mul(euStrip));
  if (plateCode) {
    const cellU = plateU.sub(0.11).div(0.108);
    const cell = floor(cellU);
    const inText = step(0.0, cellU).mul(step(cellU, 8.0)).mul(one.sub(step(abs(cell.sub(2.0)), 0.5)));
    const glyphSlot = cell.sub(step(2.5, cell));
    const pair = floor(glyphSlot.mul(0.5));
    const packed = mix(mix(plateCode.x, plateCode.y, step(0.5, pair)), mix(plateCode.z, plateCode.w, step(2.5, pair)), step(1.5, pair));
    const high = floor(packed.div(32.0));
    const glyphIndex = mix(high, packed.sub(high.mul(32.0)), glyphSlot.sub(pair.mul(2.0)));
    const glyphGrad = vec2(cellU.div(PLATE_GLYPHS.length), plateV);
    const ink = texture(carPlateGlyphTexture(), vec2(glyphIndex.add(fract(cellU)).div(PLATE_GLYPHS.length), plateV))
      .grad(dFdx(glyphGrad), dFdy(glyphGrad)).r.mul(inText);
    col = mix(col, color(0x15171a), ink);
  }
  const stickerDist = length(vec2(plateU.sub(0.11 + 2.5 * 0.108).mul(2 * PLATE.hw), plateV.sub(0.5).mul(2 * PLATE.hh)));
  const sticker = smoothstep(0.024, 0.021, stickerDist).mul(one.sub(atFront));
  return mix(col, mix(color(0xb8262c), color(0xe6e1d6), smoothstep(0.017, 0.015, stickerDist)), sticker);
}

/**
 * Creates the TSL material for lofted vehicles.
 * Instanced traffic reads the per-instance `paintColor` (vec3) and `carState` (vec4: brake, left (+x) & right (-x)
 * turn signal, livery: 0 none, 1 Policja, 2 PRM ambulance, 3 PSP fire) and `plateCode` (vec4, encodeRegistration)
 * attributes; with a fixed `fixedColorHex` (the player's taxi, wheels) the state is the `material.userData.carState`
 * uniform instead and the painted plates are blank (the player's car carries its own plate meshes).
 * Every mask is built once and shared by the colour, roughness, metalness & emissive graphs (TSL turns nodes used
 * more than once into temporaries), so the fragment shader evaluates each SDF a single time.
 */
function createLoftedCarMaterial(spec, fixedColorHex = null) {
  const cacheKey = `${spec.name}_${fixedColorHex ?? 'instanced'}`;
  if (_carMaterialCache.has(cacheKey)) {
    return _carMaterialCache.get(cacheKey);
  }

  const L = carLayout(spec);
  const cab = spec.cabin;
  const fixed = fixedColorHex !== null;
  const stateUniform = fixed ? uniform(new THREE.Vector4(0, 0, 0, 0)) : null;
  const state = fixed ? stateUniform : attribute('carState', 'vec4');
  const paint = fixed ? color(fixedColorHex) : attribute('paintColor', 'vec3');

  const axleZ = float(spec.wheelZ);
  const wheelR = float(spec.wheelRadius);
  const archR = L.archR;

  // Glass outlines from the glasshouse layout: side windows in side view (z, y), windshield & backlight from above
  // (|x|, z). Each edge is pulled in by its pillar / frame width; the seal outline sits a little further out.
  const bc = L.belt.cowl;
  const bd = L.belt.deck;
  const rf = L.rail.front;
  const rm = L.rail.mid;
  const rr = L.rail.rear;
  const sidePoly = [[cab.cowl, bc.y], [cab.roofFront, rf.y], [L.rail.roofMid, rm.y], [cab.roofRear, rr.y], [cab.deck, bd.y]];
  const sideGlassPlanes = polygonPlanes(sidePoly, [0.05, 0.03, 0.03, 0.065, 0.02]);
  const sideSealPlanes = polygonPlanes(sidePoly, [0.034, 0.016, 0.016, 0.05, 0.004]);
  const frontPoly = [[-1, cab.cowl], [-1, cab.roofFront], [rf.x, cab.roofFront], [bc.x, cab.cowl]];
  const frontGlassPlanes = polygonPlanes(frontPoly, [0, 0.045, 0.06, 0.05]);
  const frontSealPlanes = polygonPlanes(frontPoly, [0, 0.03, 0.045, 0.035]);
  const rearPoly = [[-1, cab.roofRear], [-1, cab.deck], [bd.x, cab.deck], [rr.x, cab.roofRear]];
  const rearGlassPlanes = polygonPlanes(rearPoly, [0, 0.045, 0.065, 0.05]);
  const rearSealPlanes = polygonPlanes(rearPoly, [0, 0.03, 0.05, 0.035]);
  const [hlX, hlY, hlW, hlH] = spec.headlight;
  const [tlX, tlY, tlW, tlH] = spec.taillight;
  const [grY, grW, grH] = spec.grille;
  const [inY, inW, inH] = spec.intake;
  const [plateF, plateR] = spec.plates;
  const frontZone = spec.zFront - 0.55;
  const rearZone = spec.zRear + 0.55;
  const sillY = spec.sill[1][1];
  const rearSill = spec.tail.sill[1];
  const signY = taxiSignPlacement(spec).y + TAXI_LAMP.lift + TAXI_LAMP.hh;
  const one = float(1.0);

  const p = attribute('position', 'vec3');
  const n = attribute('normal', 'vec3');
  const partId = attribute('partId', 'float');
  const isPart = (id) => step(abs(partId.sub(id)), 0.25);
  const isBody = isPart(CAR_PARTS.BODY);
  const isWindow = isPart(CAR_PARTS.WINDOW);
  const isTyre = isPart(CAR_PARTS.TYRE);
  const isAlloy = isPart(CAR_PARTS.ALLOY);
  const isTrim = isPart(CAR_PARTS.TRIM);
  const isMirror = isPart(CAR_PARTS.MIRROR);
  const isSign = isPart(CAR_PARTS.SIGN);
  const ax = abs(p.x);
  const isSide = smoothstep(0.45, 0.7, abs(n.x));
  const front = smoothstep(0.12, 0.38, n.z).mul(step(frontZone, p.z)).mul(isBody);
  const rear = smoothstep(0.12, 0.38, n.z.negate()).mul(step(p.z, rearZone)).mul(isBody);
  const under = smoothstep(-0.25, -0.55, n.y).mul(isBody);
  const belt = mix(float(bd.y), float(bc.y), clamp(p.z.sub(cab.deck).div(cab.cowl - cab.deck), 0.0, 1.0));

  // Glasshouse: side windows (minus the B / C pillars), windshield & backlight, their black seals, chrome sill strip.
  // A hatch's thick C pillar and a van's cargo box panel the side glass over behind sideGlassRear; a van's high roof
  // has no glass above glassTop.
  let sideG = polygonDistance(p.z, p.y, sideGlassPlanes, 0.07);
  let sideS = polygonDistance(p.z, p.y, sideSealPlanes, 0.07);
  for (const zp of cab.pillars) sideG = max(sideG, float(0.036).sub(abs(p.z.sub(zp))));
  if (spec.sideGlassRear !== undefined) {
    sideG = max(sideG, float(spec.sideGlassRear).sub(p.z));
    sideS = max(sideS, float(spec.sideGlassRear - 0.016).sub(p.z));
  }
  let frontG = polygonDistance(ax, p.z, frontGlassPlanes, 0.09);
  let frontS = polygonDistance(ax, p.z, frontSealPlanes, 0.09);
  if (spec.glassTop !== undefined) {
    sideG = max(sideG, p.y.sub(spec.glassTop));
    sideS = max(sideS, p.y.sub(spec.glassTop + 0.016));
    frontG = max(frontG, p.y.sub(spec.glassTop));
    frontS = max(frontS, p.y.sub(spec.glassTop + 0.016));
  }
  const hasBacklight = spec.backlight !== false;
  const backlight = hasBacklight ? coverage(polygonDistance(ax, p.z, rearGlassPlanes, 0.09)).mul(isWindow) : float(0.0);
  const glass = max(max(coverage(sideG), coverage(frontG)), backlight.div(max(isWindow, 1e-4))).mul(isWindow);
  const rearSeal = hasBacklight ? coverage(polygonDistance(ax, p.z, rearSealPlanes, 0.09)) : float(0.0);
  const seal = max(coverage(sideS), max(coverage(frontS), rearSeal)).mul(isWindow);
  const chromeBelt = spec.chrome
    ? smoothstep(0.003, 0.006, p.y.sub(belt))
      .mul(smoothstep(0.016, 0.012, p.y.sub(belt)))
      .mul(smoothstep(0.5, 0.7, abs(n.x)))
      .mul(step(cab.deck + 0.05, p.z))
      .mul(step(p.z, cab.cowl - 0.08))
      .mul(isWindow)
    : float(0.0);
  const chmsl = roundedRect(vec2(p.x, p.z.sub(cab.roofRear - 0.075)), vec2(0.14, 0.012), 0.005).mul(backlight).mul(step(n.z, -0.1));
  const rearWiper = spec.rearWiper
    ? roundedRect(vec2(p.x.add(0.15), p.z.sub(cab.deck + 0.075)), vec2(0.22, 0.006), 0.003).mul(backlight)
    : float(0.0);

  // Wheel arches: distance from the nearest axle in side view (or from the hub of a centred, spinning wheel)
  const isCenteredWheel = step(abs(p.z), wheelR.add(0.05)).mul(max(isTyre, isAlloy));
  const wheelVec = mix(vec2(abs(p.z).sub(axleZ), p.y.sub(wheelR)), vec2(p.z, p.y), isCenteredWheel);
  const wheelDist = length(wheelVec);

  // Lamps, grilles & plates on the nose and tail (projected along z, so the lamps wrap around the corners)
  const hlUV = vec2(ax.sub(hlX), p.y.sub(hlY));
  const headlight = roundedRect(hlUV, vec2(hlW, hlH), 0.01).mul(smoothstep(0.02, 0.25, n.z)).mul(step(frontZone, p.z)).mul(isBody);
  const turnFront = smoothstep(hlX + hlW * 0.65, hlX + hlW * 0.72, ax).mul(headlight);
  const divider = smoothstep(max(fwidth(ax), 0.007), 0.002, abs(hlUV.x.add(hlW * 0.1)));
  const headlightLens = roundedRect(hlUV, vec2(hlW - 0.012, hlH - 0.012), 0.006)
    .mul(headlight).mul(one.sub(max(divider, turnFront)));
  const drlDist = abs(hlUV.y.add(hlH * 0.6));
  const drlEdge = max(fwidth(drlDist), 0.006);
  const drl = smoothstep(drlEdge, 0.0, drlDist).mul(headlight).mul(one.sub(turnFront));
  const grille = roundedRect(vec2(p.x, p.y.sub(grY)), vec2(grW, grH), 0.015).mul(front);
  const intake = roundedRect(vec2(p.x, p.y.sub(inY)), vec2(inW, inH), 0.04).mul(front);
  const plateFront = roundedRect(vec2(p.x, p.y.sub(plateF)), vec2(PLATE.hw, PLATE.hh), 0.008).mul(front);
  const tlUV = vec2(ax.sub(tlX), p.y.sub(tlY));
  const taillight = roundedRect(tlUV, vec2(tlW, tlH), 0.022)
    .mul(smoothstep(0.02, 0.25, n.z.negate()))
    .mul(step(p.z, rearZone))
    .mul(isBody);
  // Wide lamps use horizontal lenses; tall ones (crossover, van) stack their three sections vertically.
  const tailAxis = tlH > tlW ? tlUV.y.div(tlH) : tlUV.x.div(tlW);
  const tailDivider = coverage(min(abs(tailAxis.sub(0.52)), abs(tailAxis.add(0.55))).sub(0.025));
  const tailLens = roundedRect(tlUV, vec2(tlW - 0.006, tlH - 0.006), 0.017)
    .mul(taillight).mul(one.sub(tailDivider));
  const turnRearSection = smoothstep(0.50, 0.54, tailAxis);
  const reverseRearSection = smoothstep(-0.53, -0.57, tailAxis);
  const turnRear = turnRearSection.mul(tailLens);
  const redLens = tailLens.mul(one.sub(max(turnRearSection, reverseRearSection)));
  const plateRear = roundedRect(vec2(p.x, p.y.sub(plateR)), vec2(PLATE.hw, PLATE.hh), 0.008).mul(rear);
  const platePocket = roundedRect(vec2(p.x, p.y.sub(plateR + 0.01)), vec2(0.3, 0.1), 0.03).mul(rear);
  const trunkHandle = roundedRect(vec2(p.x, p.y.sub(plateR + 0.125)), vec2(0.18, 0.012), 0.008).mul(rear);
  const plateRecess = max(
    roundedRect(vec2(p.x, p.y.sub(plateF)), vec2(PLATE.hw + 0.016, 0.066), 0.012).mul(front),
    roundedRect(vec2(p.x, p.y.sub(plateR)), vec2(PLATE.hw + 0.02, 0.075), 0.02).mul(rear)
  );
  const rearValance = smoothstep(rearSill + 0.07, rearSill + 0.015, p.y).mul(rear);
  const reflector = roundedRect(vec2(ax.sub(0.64), p.y.sub(spec.bumpers[1][0] + 0.065)), vec2(0.065, 0.012), 0.006).mul(rear);
  const trunkWidth = mix(float(tlX - tlW - 0.025), float(tlX), smoothstep(tlY - tlH, spec.tail.edge[1], p.y));
  const trunkEdge = max(ax.sub(trunkWidth), float(spec.bumperLine[1]).sub(p.y));
  const panelSeam = max(
    smoothstep(0.006, 0.0025, abs(p.y.sub(spec.bumperLine[0]))).mul(step(ax, hlX - hlW * 0.6)).mul(front),
    coverage(abs(trunkEdge).sub(0.003)).mul(rear)
  );
  const cowlPanel = smoothstep(cab.cowl + 0.085, cab.cowl + 0.07, p.z)
    .mul(smoothstep(cab.cowl - 0.04, cab.cowl - 0.02, p.z))
    .mul(step(0.6, n.y))
    .mul(isBody);
  const signFace = smoothstep(0.55, 0.75, abs(n.z)).mul(isSign);
  const mirrorGlass = isMirror.mul(step(0.55, n.z.negate()));
  const lamp = max(headlight, taillight);
  const plates = max(plateFront, plateRear);
  const cladding =
    spec.cladding > 0
      ? max(smoothstep(spec.cladding + 0.01, spec.cladding - 0.01, p.y), smoothstep(archR + 0.075, archR + 0.06, wheelDist))
        .mul(isBody)
        .mul(one.sub(lamp))
        .mul(one.sub(plates))
      : float(0.0);

  // 5-spoke alloys (branchless 5-ray star SDF) with rim ring & hub, lug ribs on the tyre tread
  const wDir = wheelVec.div(max(wheelDist, 0.0001));
  let spokes = float(0.0);
  for (let k = 0; k < 5; k++) {
    const ang = (k * Math.PI * 2) / 5;
    const cs = Math.cos(ang);
    const sn = Math.sin(ang);
    const alongSpoke = wDir.x.mul(cs).add(wDir.y.mul(sn));
    const perp = abs(wDir.x.mul(sn).sub(wDir.y.mul(cs))).mul(wheelDist);
    spokes = max(spokes, smoothstep(0.034, 0.018, perp).mul(step(0.0, alongSpoke)));
  }
  const rimRing = smoothstep(wheelR.mul(0.56), wheelR.mul(0.6), wheelDist);
  const centerHub = smoothstep(0.068, 0.042, wheelDist);
  const centerCap = smoothstep(0.03, 0.018, wheelDist);
  const valveDot = smoothstep(0.028, 0.014, length(wheelVec.sub(vec2(0.0, wheelR.mul(-0.48)))));
  const alloyMetal = clamp(max(max(spokes, valveDot), max(rimRing, centerHub)).sub(centerCap.mul(0.85)), 0.0, 1.0);

  // Black plastic & rubber (grilles, seals, trims, tyres, cladding) is matte; lamps, glass & chrome are glossy
  const matte = max(
    max(max(isTyre, isTrim), max(intake, grille)),
    max(max(rearValance, under), max(max(cowlPanel, cladding), max(rearWiper, seal.mul(one.sub(max(glass, chromeBelt))))))
  );

  // ---- Colour ---------------------------------------------------------------------------------------------------
  // Liveries (carState.w; the paint comes from traffic.js): a reflective band along the sides with a pinstripe above
  // it and the lettering inside it over both doors, read left to right from either side. 1 Policja: blue band, white
  // POLICJA, light-blue pin; 2 PRM ambulance: red band, white AMBULANS, blue pin; 3 PSP: white band, red STRAŻ, white
  // pin. The band runs at spec.band (a van's higher up, over the cargo box), by default 0.5-0.64 m, 5 cm higher on a
  // body with lower cladding. Vans in PRM and PSP livery also carry red-and-white / red-and-yellow chevrons on the
  // rear doors (approximated: no crests or emblems anywhere).
  const livery = state.w;
  const police = step(0.5, livery).mul(step(livery, 1.5));
  const ambulance = step(1.5, livery).mul(step(livery, 2.5));
  const fire = step(2.5, livery);
  const pick = (a, b, c) => color(a).mul(police).add(color(b).mul(ambulance)).add(color(c).mul(fire));
  const onLivery = step(0.5, livery).mul(isSide).mul(isBody);
  const lift = spec.cladding > 0 ? 0.05 : 0;
  const [band0, band1] = spec.band || [0.5 + lift, 0.64 + lift];
  const along = smoothstep(spec.zRear + 0.22, spec.zRear + 0.3, p.z).mul(smoothstep(spec.zFront - 0.28, spec.zFront - 0.36, p.z));
  const band = smoothstep(band0 - 0.005, band0, p.y).mul(smoothstep(band1 + 0.005, band1, p.y)).mul(along);
  const pin = smoothstep(band1 + 0.023, band1 + 0.027, p.y).mul(smoothstep(band1 + 0.047, band1 + 0.043, p.y)).mul(along);
  // Lettering box: 8:1 like an atlas row, 80% of the band's height, centred on the band and on the doors
  const letterZ = spec.letterZ ?? (spec.doors[0] + spec.doors[spec.doors.length - 1]) / 2;
  const letterH = (band1 - band0) * 0.8;
  const facing = step(0.0, n.x).mul(-2.0).add(1.0); // +x side: the text runs towards -z
  let letterU = p.z.sub(letterZ).mul(facing).div(letterH * 8).add(0.5);
  let letterV = p.y.sub((band0 + band1) / 2).div(letterH).add(0.5);
  let letterRow = clamp(livery.sub(1.0), 0.0, 2.0);
  if (spec.sign) {
    // The roof lamp's TAXI faces front and back: a box 75% of the lamp's height at the atlas rows' 8:1 aspect (the word
    // fills about a quarter of its row, so about half the lamp's width)
    const faceSign = step(0.0, n.z).mul(2.0).sub(1.0);
    letterU = mix(letterU, p.x.mul(faceSign).div(TAXI_LAMP.hh * 12).add(0.5), isSign);
    letterV = mix(letterV, p.y.sub(signY).div(TAXI_LAMP.hh * 1.5).add(0.5), isSign);
    letterRow = mix(letterRow, float(LETTERING.length - 1), isSign);
  }
  const inBox = step(abs(letterU.sub(0.5)), 0.5).mul(step(abs(letterV.sub(0.5)), 0.5));
  const atlasV = letterV.add(float(LETTERING.length - 1).sub(letterRow)).div(LETTERING.length);
  const glyph = texture(carLetteringTexture(), vec2(letterU, atlasV)).r.mul(inBox);
  let painted = mix(paint, pick(0x1d3f8f, 0xc8161e, 0xf1f2f0), band.mul(onLivery));
  painted = mix(painted, pick(0x6fa8dc, 0x1f4fbf, 0xf1f2f0), pin.mul(onLivery));
  painted = mix(painted, pick(0xf4f6f8, 0xf4f6f8, 0xc8161e), glyph.mul(band).mul(onLivery));
  let signGlyph = float(0.0);
  if (spec.sign) {
    signGlyph = glyph.mul(signFace);
    // Poznań taxi side marking (local rules unverified, docs/poznan-plan.md Phase 10): a black & yellow chequered
    // strip (two rows of 3 cm squares) along both doors, a plain red badge ahead of it (no city crest: licensing) and
    // the side number on the rear door
    const [d0, d1, d2] = spec.doors;
    const onSide = isSide.mul(isBody);
    const strip = smoothstep(0.558, 0.562, p.y).mul(smoothstep(0.622, 0.618, p.y))
      .mul(step(d2 + 0.06, p.z)).mul(step(p.z, d0 - 0.14)).mul(onSide);
    const chequer = step(0.25, fract(floor(p.z.div(0.03)).add(floor(p.y.sub(0.56).div(0.03))).mul(0.5)));
    const crest = roundedRect(vec2(p.z.sub(d0 - 0.08), p.y.sub(0.59)), vec2(0.026, 0.034), 0.012).mul(onSide);
    const number = step(0.3, sin(p.z.mul(150.0)))
      .mul(step(abs(p.z.sub((d1 + d2) / 2)), 0.075))
      .mul(smoothstep(0.022, 0.018, abs(p.y.sub(0.68))))
      .mul(onSide);
    painted = mix(painted, mix(color(0x121417), color(0xf3c316), chequer), strip);
    painted = mix(painted, color(0xb4161e), crest);
    painted = mix(painted, color(0x121417), number);
  }

  // Panel shading: soft occlusion low down & under the arch lips; unpainted cladding (crossovers, vans); door shut lines &
  // handles; trunk / hood shut lines; black cowl panel under the windshield
  const archLip = smoothstep(archR + 0.05, archR - 0.005, wheelDist).mul(smoothstep(0.6, 0.9, ax));
  const ao = smoothstep(0.2, 0.62, p.y).mul(0.22).add(0.78).mul(one.sub(archLip.mul(0.55)));
  const onDoors = isSide.mul(smoothstep(sillY + 0.04, sillY + 0.07, p.y)).mul(smoothstep(0.0, -0.015, p.y.sub(belt)));
  let seams = float(0.0);
  for (const zd of spec.doors) seams = max(seams, smoothstep(0.009, 0.003, abs(p.z.sub(zd))));
  for (const zh of spec.handles) {
    seams = max(seams, roundedRect(vec2(p.z.sub(zh), p.y.sub(belt.sub(0.095))), vec2(0.06, 0.011), 0.008));
  }
  // A panel van's upper body is the glasshouse loft: carry the door shut lines up it, and split the rear doors
  let vanSeams = float(0.0);
  let chevrons = float(0.0);
  let vanStop = float(0.0);
  if (spec.panelVan) {
    const roofTop = L.rail.mid.y;
    const rearFace = smoothstep(0.12, 0.38, n.z.negate()).mul(step(p.z, rearZone)).mul(max(isBody, isWindow));
    const doorEdge = tlX - tlW - 0.025;
    const upper = step(p.y, roofTop - 0.06).mul(step(spec.bumperLine[1], p.y));
    const rearSeams = max(smoothstep(0.009, 0.003, ax), smoothstep(0.009, 0.003, abs(ax.sub(doorEdge)))).mul(upper).mul(rearFace);
    vanSeams = max(rearSeams, seams.mul(isSide).mul(isWindow).mul(step(p.y, roofTop - 0.06)).mul(step(p.z, spec.doors[0] - 0.02)));
    chevrons = step(1.5, livery).mul(rearFace).mul(step(ax, doorEdge - 0.02))
      .mul(step(spec.bumperLine[1] + 0.06, p.y)).mul(step(p.y, spec.bumperLine[1] + 0.56));
    vanStop = roundedRect(vec2(p.x, p.y.sub(roofTop - 0.12)), vec2(0.12, 0.018), 0.008).mul(rearFace).mul(isWindow);
  }
  // Chevrons point up the middle: red, alternating with white (PSP) or yellow (PRM), 10 cm stripes
  const chevronCol = mix(color(0xc8161e), mix(color(0xf2e33a), color(0xf1f2f0), fire), step(0.5, fract(ax.add(p.y).div(0.2))));

  let body = mix(painted.mul(ao), color(0x1e2124), cladding);
  body = body.mul(one.sub(seams.mul(onDoors).mul(0.55))).mul(one.sub(panelSeam.mul(0.5)));
  body = mix(body, color(0x15181b), cowlPanel);
  body = mix(body, chevronCol, chevrons.mul(isBody));
  body = body.mul(one.sub(vanSeams.mul(isBody).mul(0.55)));

  // Nose: slatted grilles and broad divided reflectors inside squared lamp housings, with outer amber indicators.
  const slats = step(0.5, fract(p.y.mul(42.0))).mul(0.4).add(0.6);
  body = mix(body, color(0x111417).mul(slats), max(intake, grille));
  const lensShade = smoothstep(0.0, hlH, abs(hlUV.y)).mul(0.35).add(0.65);
  const lampColor = mix(mix(color(0x30383e), color(0xc2ccd2).mul(lensShade), headlightLens), color(0xe4e9eb), drl);
  body = mix(body, mix(lampColor, color(0xc5802b), turnFront), headlight);
  // Tail: thin rubber seals around divided red, amber and clear lenses.
  const tailShade = smoothstep(0.0, tlH, abs(tlUV.y)).mul(-0.3).add(1.0);
  const tailColor = mix(mix(color(0xae1821).mul(tailShade), color(0xc56b18), turnRearSection), color(0xbac4c9), reverseRearSection);
  body = mix(body, color(0x15181b), rearValance);
  body = mix(body, color(0x7a0a10), reflector);
  body = mix(body, color(0x222326), taillight);
  body = mix(body, tailColor, tailLens);
  // Shaded recess and handle sit in the painted trunk / hatch, above the bumper.
  const pocketShade = smoothstep(plateR - 0.09, plateR + 0.115, p.y).mul(-0.25).add(0.9);
  body = mix(body, body.mul(pocketShade), platePocket);
  body = mix(body, color(0x303438), trunkHandle);
  body = mix(body, color(0x24292d), plateRecess);
  // EU plates, front and rear, each car with its own registration (blank on the fixed-colour variant)
  const atFront = step(0.0, p.z);
  const plateCode = fixed ? null : attribute('plateCode', 'vec4');
  body = mix(body, plateColor(p, mix(float(plateR), float(plateF), atFront), atFront, plateCode), plates);
  body = mix(body, color(0x0e1013), under);

  // Glasshouse: tinted glass, black seals & B / C pillars, painted roof & A pillars, chrome sill strip, CHMSL; on a
  // van the painted upper body with its seams, rear chevrons and the high stop lamp
  const glassCol = mix(color(0x0a1016), color(0x1a2632), smoothstep(0.2, 0.9, n.y));
  let windowCol = mix(mix(mix(mix(paint, color(0x111315), seal), glassCol, glass), color(0xc9ced3), chromeBelt), color(0x6a0a0e), chmsl);
  windowCol = mix(windowCol, color(0x15181b), rearWiper);
  if (spec.panelVan) {
    windowCol = mix(windowCol, chevronCol, chevrons);
    windowCol = windowCol.mul(one.sub(vanSeams.mul(one.sub(glass)).mul(0.55)));
    windowCol = mix(windowCol, color(0x6a0a0e), vanStop);
  }

  // Mirror caps (paint, glass facing back), taxi roof light, trims, alloys & tyres
  const mirrorCol = mix(paint, color(0x7c8a94), mirrorGlass);
  const signCol = mix(color(0xf2d75a), mix(color(0xfff1b8), color(0x15181b), signGlyph), signFace);
  const alloyCol = mix(color(0x0b0e12), color(0xd8e0e8), alloyMetal);
  const treadZone = smoothstep(wheelR.mul(0.74), wheelR.mul(0.83), wheelDist);
  const tyreBase = smoothstep(wheelR.mul(0.85), wheelR.mul(0.94), wheelDist).mul(0.22).add(0.78);
  const tyreCol = color(0x16181b).mul(tyreBase.add(spokes.mul(treadZone).mul(0.24)));

  let col = mix(body, windowCol, isWindow);
  col = mix(col, mirrorCol, isMirror);
  col = mix(col, signCol, isSign);
  col = mix(col, color(0x1b1e21), isTrim);
  col = mix(col, alloyCol, isAlloy);
  col = mix(col, tyreCol, isTyre);

  // ---- Roughness & metalness ---------------------------------------------------------------------------------------
  const alloySpokes = max(spokes, rimRing).mul(isAlloy);
  const glossy = max(max(max(glass, chromeBelt), mirrorGlass), lamp);
  let rough = mix(float(0.26), float(0.15), glossy);
  rough = mix(rough, float(0.4), plates);
  rough = mix(rough, float(0.35), isSign);
  rough = mix(rough, float(0.82), max(matte, isAlloy.sub(alloySpokes)));

  let metal = mix(float(0.34), float(0.14), glass);
  metal = mix(metal, float(0.6), max(lamp, mirrorGlass));
  metal = mix(metal, float(0.95), chromeBelt);
  metal = mix(metal, float(0.86), alloySpokes);
  metal = mix(metal, float(0.08), plates);
  metal = mix(metal, float(0.04), max(matte, isSign));

  // ---- Emissive: running lights, tail / brake lights & CHMSL, turn signals, taxi roof light -----------------------
  const brake = state.x;
  const blink = max(state.y.mul(step(0.0, p.x)), state.z.mul(step(p.x, 0.0)));
  const nightHeadlamp = smoothstep(0.60, 1.15, cityUniforms.uInteriorGlow);
  const headlamps = color(0xfff8ec)
    .mul(headlightLens.mul(2.2).add(drl.mul(0.65)))
    .mul(nightHeadlamp)
    .mul(one.sub(turnFront.mul(blink)));
  const tail = color(0xff0a12).mul(redLens.mul(tailShade).mul(brake.mul(2.1).add(nightHeadlamp.mul(0.4))));
  const stop = color(0xff0a12).mul(max(chmsl, vanStop).mul(brake).mul(2.1));
  const turn = color(0xff9a14).mul(max(turnFront, turnRear).mul(blink).mul(2.2));
  const sign = color(0xffe28a).mul(signFace.mul(one.sub(signGlyph.mul(0.9))).mul(1.65));

  const mat = new THREE.MeshStandardNodeMaterial();
  if (fixed) mat.userData.carState = stateUniform;
  mat.colorNode = col;
  mat.roughnessNode = rough;
  mat.metalnessNode = metal;
  mat.emissiveNode = headlamps.add(tail).add(stop).add(turn).add(sign);

  _carMaterialCache.set(cacheKey, mat);
  return mat;
}

// ============================================================================
// 3. TUBE SECTIONS ALONG A POLYLINE (the helicopter's skids; the people are built in pedestrians.js)
// ============================================================================
function ring(center, rx, rz, segments = 6, phase = 0) {
  return Array.from({ length: segments }, (_, i) => {
    const a = (i / segments) * Math.PI * 2 + phase;
    return new THREE.Vector3(center.x + Math.cos(a) * rx, center.y, center.z + Math.sin(a) * rz);
  });
}

function limbSections(joints, segments = 6, phase = 0) {
  const rotation = new THREE.Quaternion();
  return joints.map(([center, rx, rz], i) => {
    const before = joints[Math.max(0, i - 1)][0];
    const after = joints[Math.min(joints.length - 1, i + 1)][0];
    rotation.setFromUnitVectors(_down, after.clone().sub(before).normalize());
    return ring(new THREE.Vector3(), rx, rz, segments, phase).map((p) =>
      p.applyQuaternion(rotation).add(center)
    );
  });
}

// ============================================================================
// 4. LOFTED CITY BUS GEOMETRY & TSL MATERIAL
// ============================================================================
// A 12 m low-floor city bus shaped after MPK Poznań's rigid Solaris Urbino 12 (12.0 x 2.55 m, 5.9 m wheelbase, three
// double doors on the curb side, a tall near-vertical windshield) lofted with the car body machinery: rounded plan-view
// corners, a slightly raked windshield, a tight roof radius and arches over the wheels; bumpers, stalk mirrors and the
// roof AC & battery pods are separate pieces of the same mesh (partId). Windows, doors, livery & lamps are painted by
// createLoftedBusMaterial(); destination signs are textured panels (buildBusSignGeometry). The axles stay symmetric
// (traffic.js places both wheel pairs at ±wheelZ), so the overhangs are 3.05 m each where the Urbino's are 2.7 / 3.4 m.
const BUS_PARTS = {
  BODY: 0,
  TRIM: 1,
  POD: 2
};

const BUS_SPEC = {
  name: 'bus',
  headlight: [0.79, 0.8], // midpoint of each pair of white lamps; excludes the outer amber indicator
  zFront: 6.0,
  zRear: -6.0,
  wheelRadius: 0.48,
  wheelZ: 2.95,
  wheelX: 1.22,
  archGap: 0.09,
  archFlare: 0,
  tuck: 0.05,
  stationStep: 0.62,
  lowerRound: 2.6,
  upperRound: 6,
  upperSamples: [0.3, 0.56, 0.74, 0.88, 1],
  halfWidth: [[6.0, 1.275], [-6.0, 1.275]],
  sill: [[6.0, 0.36], [-6.0, 0.36]],
  shoulder: [[6.0, 1.05], [-6.0, 1.05]],
  edge: [[6.0, 2.96], [-6.0, 2.96]],
  crown: [[6.0, 0.045], [-6.0, 0.045]],
  tumble: [[6.0, 0.17], [-6.0, 0.17]],
  nose: { halfWidth: [0.28, 1.02, 2], edge: [0.24, 2.68, 2], crown: [0.24, 0.005, 2], sill: [0.07, 0.44, 2], shoulder: [0.2, 0.95, 2] },
  tail: { halfWidth: [0.24, 1.06, 2], edge: [0.2, 2.72, 2], crown: [0.2, 0.005, 2], sill: [0.09, 0.46, 2], shoulder: [0.2, 0.95, 2] },
  rake: 0.12, // how far the top of the windshield leans back
  window: [1.24, 2.44], // side window band (y)
  frontDoor: [4.42, 5.6], // curb-side (-x) double doors (z ranges): ahead of the front axle, mid-wheelbase, rear overhang
  midDoor: [-0.62, 0.62],
  rearDoor: [-4.98, -3.8]
};

// The windshield rake: the upper front leans back by up to BUS_SPEC.rake, fading out along the first metre
function busRake(y, z) {
  const s = BUS_SPEC;
  const along = Math.min(1, Math.max(0, (z - (s.zFront - 1.0)) / 1.0));
  const up = Math.min(1, Math.max(0, (y - 1.0) / 1.75));
  return s.rake * along * along * Math.pow(up, 1.3);
}

function buildLoftedBusBodyGeometry() {
  const s = BUS_SPEC;
  const body = buildBodyLoft(s, 1);
  const pos = body.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setZ(i, pos.getZ(i) - busRake(pos.getY(i), pos.getZ(i)));
  body.computeVertexNormals();
  const parts = [part(body, BUS_PARTS.BODY)];

  // Bumpers, stalk mirrors
  parts.push(part(roundedBox(1.24, 0.12, 0.24, 0.07, 0.03).translate(0, 0.5, s.zFront - 0.05), BUS_PARTS.TRIM));
  parts.push(part(roundedBox(1.24, 0.11, 0.22, 0.06, 0.03).translate(0, 0.48, s.zRear + 0.05), BUS_PARTS.TRIM));
  for (const side of [-1, 1]) {
    // Mirror stalk from the roof corner, curving forward & out to a tall mirror head ahead of the windshield corner
    const stalk = new THREE.BoxGeometry(0.035, 0.035, 0.5)
      .rotateX(0.55)
      .rotateY(side * 0.35)
      .translate(side * 1.2, 2.58, s.zFront - 0.12);
    const head = roundedBox(0.075, 0.2, 0.06, 0.03, 0.012).translate(side * 1.36, 2.24, s.zFront + 0.12);
    parts.push(part(stalk, BUS_PARTS.TRIM), part(head, BUS_PARTS.TRIM));
  }

  // Roof equipment: air-conditioning pod at the rear, battery pod ahead of it (the Urbino 12 electric)
  const roofY = s.edge[0][1] + s.crown[0][1];
  parts.push(part(roundedBox(0.98, 0.15, 2.5, 0.12, 0.05).translate(0, roofY + 0.1, -3.55), BUS_PARTS.POD));
  parts.push(part(roundedBox(0.82, 0.1, 3.0, 0.08, 0.04).translate(0, roofY + 0.06, 1.1), BUS_PARTS.POD));

  // Arch liners
  for (const side of [-1, 1]) {
    for (const z of [-s.wheelZ, s.wheelZ]) {
      const well = new THREE.CircleGeometry(s.wheelRadius + s.archGap + 0.01, 10, 0, Math.PI)
        .rotateY(side * Math.PI * 0.5)
        .translate(side * (s.wheelX - 0.2), s.wheelRadius, z);
      parts.push(part(well, BUS_PARTS.TRIM));
    }
  }
  return mergeGeometries(parts);
}

/**
 * Destination sign panels for the bus's sign texture (route badge + destination): above the windshield, on the curb
 * side by the front door, and the route badge alone above the rear window. Same object space as the bus body.
 */
function buildBusSignGeometry() {
  const s = BUS_SPEC;
  const panels = [];
  const yF = 2.55;
  const front = new THREE.PlaneGeometry(1.9, 0.27);
  front.rotateX(-Math.atan2(s.rake * 1.3 * 0.62, 1.75));
  front.translate(0, yF, s.zFront - busRake(yF, s.zFront) + 0.012);
  panels.push(front);
  const side = new THREE.PlaneGeometry(1.15, 0.2).rotateY(-Math.PI / 2);
  side.translate(-(carBodyHalfWidthAt(s, 3.9, 2.58) + 0.006), 2.58, 3.9);
  panels.push(side);
  const rear = new THREE.PlaneGeometry(0.52, 0.2);
  const uv = rear.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 0.29);
  rear.rotateY(Math.PI).translate(0, 2.55, s.zRear - 0.012);
  panels.push(rear);
  return mergeGeometries(panels);
}

/**
 * Unlit material for the destination sign panels: `map` holds one sign per row (`rows` of them, the first at the
 * top) and each bus shows the row in its `busState.w`. The state is per bus, not per instance slot, because slots
 * are handed out again every frame to whichever buses are in view.
 */
function createBusSignMaterial(map, rows) {
  const route = attribute('busState', 'vec4').w;
  const signUV = uv();
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.colorNode = texture(map, vec2(signUV.x, signUV.y.add(float(rows - 1).sub(route)).div(rows)));
  return mat;
}

// Bus wheel: tall tyre with a deep steel disc, 10 lug nuts and a hub cap on both outer and inner faces (spins about x, centred on the origin)
function buildBusWheelGeo(side) {
  const r = BUS_SPEC.wheelRadius;
  const w = 0.3;
  const tyre = new THREE.LatheGeometry(
    [
      new THREE.Vector2(r * 0.72, -w * 0.5),
      new THREE.Vector2(r * 0.97, -w * 0.38),
      new THREE.Vector2(r, 0),
      new THREE.Vector2(r * 0.97, w * 0.38),
      new THREE.Vector2(r * 0.72, w * 0.5)
    ],
    20
  );
  const disc = new THREE.LatheGeometry(
    [new THREE.Vector2(r * 0.72, w * 0.5), new THREE.Vector2(r * 0.66, w * 0.4), new THREE.Vector2(r * 0.56, w * 0.18), new THREE.Vector2(0.15, w * 0.16)],
    20
  );
  const backDisc = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0, -w * 0.16),
      new THREE.Vector2(0.15, -w * 0.16),
      new THREE.Vector2(r * 0.56, -w * 0.18),
      new THREE.Vector2(r * 0.66, -w * 0.4),
      new THREE.Vector2(r * 0.72, -w * 0.5)
    ],
    20
  );
  const cap = new THREE.CylinderGeometry(0.1, 0.13, 0.12, 14).translate(0, w * 0.2, 0);
  const backCap = new THREE.CylinderGeometry(0.13, 0.1, 0.12, 14).translate(0, -w * 0.2, 0);
  const parts = [
    part(tyre, CAR_PARTS.TYRE),
    part(disc, CAR_PARTS.ALLOY),
    part(backDisc, CAR_PARTS.ALLOY),
    part(cap, CAR_PARTS.ALLOY),
    part(backCap, CAR_PARTS.ALLOY)
  ];
  for (const g of parts) g.rotateZ(-side * Math.PI * 0.5);
  return mergeGeometries(parts);
}

let _busWheelMat = null;

function createBusWheelMaterial() {
  if (_busWheelMat) return _busWheelMat;
  const p = attribute('position', 'vec3');
  const partId = attribute('partId', 'float');
  const isTyre = step(abs(partId.sub(CAR_PARTS.TYRE)), 0.25);
  const radial = length(vec2(p.z, p.y));
  const angle = vec2(p.z, p.y).div(max(radial, 0.0001));
  let lugs = float(0.0);
  for (let k = 0; k < 10; k++) {
    const a = (k * Math.PI * 2) / 10;
    lugs = max(lugs, smoothstep(0.024, 0.014, length(vec2(p.z, p.y).sub(vec2(Math.cos(a) * 0.205, Math.sin(a) * 0.205)))));
  }
  const groove = smoothstep(0.006, 0.0, abs(radial.sub(0.29)));
  const steel = color(0xb9c0c6).mul(float(1.0).sub(groove.mul(0.5)));
  const hub = mix(steel, color(0x6b7176), smoothstep(0.13, 0.1, radial));
  const disc = mix(hub, color(0x2a2e33), lugs.mul(0.8));
  const sidewall = smoothstep(0.37, 0.43, radial).mul(0.25).add(0.75);
  const tread = step(0.5, fract(angle.y.mul(9.0).add(angle.x.mul(9.0)))).mul(0.08);
  const mat = new THREE.MeshStandardNodeMaterial();
  mat.colorNode = mix(disc, color(0x17191c).mul(sidewall.add(tread)), isTyre);
  mat.roughnessNode = mix(float(0.35), float(0.88), isTyre);
  mat.metalnessNode = mix(float(0.75), float(0.0), isTyre);
  _busWheelMat = mat;
  return mat;
}

let _busLoftedMat = null;

/**
 * Creates the TSL procedural material for the city buses:
 * - Tall wraparound windshield with gasket & centre post down to the bumper's lamp line, destination sign band above
 *   it; rear window & engine louvres on the rear face
 * - Continuous side window band with mullions, the driver's window, three glazed curb-side double doors
 * - MPK Poznań livery: green with yellow sill stripe, cornice and front, light grey roof, dark skirt
 * - Headlamps, turn signals (per-instance `busState`: brake, left (+x), right (-x), route), tail / brake light
 *   columns, EU plates; black trims & light-grey roof pods
 */
function createLoftedBusMaterial() {
  if (_busLoftedMat) return _busLoftedMat;
  const s = BUS_SPEC;
  const p = attribute('position', 'vec3');
  const n = attribute('normal', 'vec3');
  const partId = attribute('partId', 'float');
  const state = attribute('busState', 'vec4');
  const isBody = step(abs(partId.sub(BUS_PARTS.BODY)), 0.25);
  const isTrim = step(abs(partId.sub(BUS_PARTS.TRIM)), 0.25);
  const isPod = step(abs(partId.sub(BUS_PARTS.POD)), 0.25);
  const ax = abs(p.x);
  const one = float(1.0);

  const front = smoothstep(0.1, 0.35, n.z).mul(step(s.zFront - 0.9, p.z)).mul(isBody);
  const rear = smoothstep(0.1, 0.35, n.z.negate()).mul(step(p.z, s.zRear + 0.9)).mul(isBody);
  const side = smoothstep(0.5, 0.75, abs(n.x)).mul(isBody);
  const curb = step(p.x, 0.0);

  // Tall windshield (wrapping round the corners, 1.0-2.38 m), sign band, gasket; rear window & engine louvres
  const frontGlass = roundedRect(vec2(p.x, p.y.sub(1.69)), vec2(1.18, 0.69), 0.14).mul(smoothstep(0.012, 0.024, ax)).mul(front);
  const frontSeal = roundedRect(vec2(p.x, p.y.sub(1.69)), vec2(1.22, 0.73), 0.16).mul(front);
  const signBand = roundedRect(vec2(p.x, p.y.sub(2.55)), vec2(1.02, 0.16), 0.04).mul(front);
  const rearGlass = roundedRect(vec2(p.x, p.y.sub(2.06)), vec2(0.92, 0.36), 0.08).mul(rear);
  const rearSeal = roundedRect(vec2(p.x, p.y.sub(2.06)), vec2(0.96, 0.4), 0.1).mul(rear);
  const louvres = roundedRect(vec2(p.x, p.y.sub(0.98)), vec2(0.78, 0.34), 0.05).mul(rear);
  const slats = step(0.5, fract(p.y.mul(16.0))).mul(0.45).add(0.4);

  // Side window band with mullions; driver's window; curb-side doors (glazed leaves, frames)
  const [wy0, wy1] = s.window;
  const winMid = (wy0 + wy1) / 2;
  const winHalf = (wy1 - wy0) / 2;
  const sideBand = roundedRect(vec2(p.z.add(0.5), p.y.sub(winMid)), vec2(4.9, winHalf), 0.08).mul(side);
  const mullion = smoothstep(0.03, 0.045, abs(fract(p.z.mul(0.72).add(0.35)).sub(0.5).mul(1.39)));
  const sideSeal = roundedRect(vec2(p.z.add(0.5), p.y.sub(winMid)), vec2(4.94, winHalf + 0.04), 0.1).mul(side);
  const driverWin = roundedRect(vec2(p.z.sub(5.0), p.y.sub(winMid + 0.04)), vec2(0.55, winHalf + 0.04), 0.1).mul(side).mul(one.sub(curb));
  const door = (z0, z1) => {
    const zc = (z0 + z1) / 2;
    const hw = (z1 - z0) / 2;
    const frame = roundedRect(vec2(p.z.sub(zc), p.y.sub(1.44)), vec2(hw, 1.0), 0.05);
    const leaves = roundedRect(vec2(abs(p.z.sub(zc)).sub(hw * 0.5), p.y.sub(1.5)), vec2(hw * 0.4, 0.84), 0.035);
    return { frame: frame.mul(side).mul(curb), glass: leaves.mul(side).mul(curb) };
  };
  const d0 = door(s.frontDoor[0], s.frontDoor[1]);
  const d1 = door(s.midDoor[0], s.midDoor[1]);
  const d2 = door(s.rearDoor[0], s.rearDoor[1]);
  const doorFrame = max(max(d0.frame, d1.frame), d2.frame);
  const doorGlass = max(max(d0.glass, d1.glass), d2.glass);
  const glass = clamp(max(max(frontGlass, rearGlass), max(max(sideBand.mul(mullion), driverWin), doorGlass)), 0.0, 1.0);
  const seal = clamp(max(max(frontSeal, rearSeal), max(max(sideSeal, signBand), doorFrame)), 0.0, 1.0);

  // MPK Poznań livery (approximate, the trams' colours): green, a yellow sill stripe under the windows and a yellow
  // cornice above them, a yellow front below the windshield, light grey roof and a dark skirt
  const shadeY = smoothstep(0.34, 1.2, p.y).mul(0.2).add(0.8);
  const yellow = color(0xf3c316);
  const sillStripe = smoothstep(1.06, 1.09, p.y).mul(smoothstep(1.2, 1.17, p.y));
  const cornice = smoothstep(2.48, 2.51, p.y);
  const frontCap = front.mul(smoothstep(1.02, 0.98, p.y));
  const roofTop = smoothstep(0.55, 0.8, n.y);
  const skirt = smoothstep(0.53, 0.5, p.y);
  let livery = mix(color(0x15703a), yellow, max(max(sillStripe, cornice), frontCap));
  livery = mix(livery, color(0xd9dcde), roofTop);
  livery = mix(livery, color(0x1c2026), skirt).mul(shadeY);

  // Lamps: twin round headlamps & amber turn signals in black pods; red tail / brake light columns, amber turn &
  // white reverse lamps at the rear corners; plates
  const pod = roundedRect(vec2(ax.sub(0.86), p.y.sub(0.8)), vec2(0.27, 0.085), 0.06).mul(front);
  const headLamp = max(
    smoothstep(0.05, 0.04, length(vec2(ax.sub(0.72), p.y.sub(0.8)))),
    smoothstep(0.05, 0.04, length(vec2(ax.sub(0.86), p.y.sub(0.8))))
  ).mul(pod);
  const turnFront = smoothstep(0.045, 0.035, length(vec2(ax.sub(1.02), p.y.sub(0.8)))).mul(pod);
  const tailCol = roundedRect(vec2(ax.sub(1.04), p.y.sub(0.92)), vec2(0.075, 0.27), 0.05).mul(rear);
  const tailLamp = tailCol.mul(smoothstep(0.93, 0.95, p.y));
  const turnRear = tailCol.mul(smoothstep(0.92, 0.9, p.y)).mul(smoothstep(0.76, 0.78, p.y));
  const reverse = tailCol.mul(smoothstep(0.75, 0.73, p.y));
  const plateFront = roundedRect(vec2(p.x, p.y.sub(0.77)), vec2(PLATE.hw, PLATE.hh), 0.008).mul(front).mul(step(ax, 0.3));
  const plateRear = roundedRect(vec2(p.x, p.y.sub(0.77)), vec2(PLATE.hw, PLATE.hh), 0.008).mul(rear);
  const plate = max(plateFront, plateRear);
  // The cars' EU plates, one made-up Poznań registration shared by the fleet
  const busPlate = plateColor(p, float(0.77), step(0.0, p.z), vec4(...encodeRegistration(polishRegistration(9001))));

  let body = mix(livery, color(0x15191e), seal);
  body = mix(body, color(0x1a1e23).mul(slats), louvres);
  body = mix(body, color(0x111418), pod);
  body = mix(body, mix(color(0xdcefff), color(0xffa21a), turnFront), max(headLamp, turnFront));
  body = mix(body, color(0x9a0d14), tailLamp);
  body = mix(body, color(0xc8641a), turnRear);
  body = mix(body, color(0xe8eef2), reverse);
  body = mix(body, busPlate, plate);
  const glassTint = mix(color(0x0e1a26), color(0x1b3046), clamp(p.y.sub(1.3).mul(0.8), 0.0, 1.0));
  body = mix(body, glassTint, glass);

  const col = mix(mix(body, color(0x1b1f24), isTrim), color(0xc9ced3), isPod);

  const mat = new THREE.MeshStandardNodeMaterial();
  mat.colorNode = col;
  mat.roughnessNode = mix(mix(mix(float(0.3), float(0.16), max(glass, max(headLamp, tailCol))), float(0.7), max(isTrim, seal.mul(one.sub(glass)))), float(0.45), isPod);
  mat.metalnessNode = mix(mix(float(0.22), float(0.7), glass), float(0.05), max(isTrim, isPod));

  const brake = state.x;
  const blink = max(state.y.mul(step(0.0, p.x)), state.z.mul(step(p.x, 0.0)));
  const nightHeadlamp = smoothstep(0.60, 1.15, cityUniforms.uInteriorGlow);
  mat.emissiveNode = color(0xd9efff)
    .mul(pod.mul(0.45).add(headLamp.mul(1.35)))
    .mul(nightHeadlamp)
    .add(color(0xff9a14).mul(max(turnFront, turnRear).mul(blink).mul(2.0)))
    .add(color(0xff0a12).mul(tailLamp.mul(brake.mul(1.5).add(0.75))));

  _busLoftedMat = mat;
  return mat;
}

// ============================================================================
// 5. 3D LOFTED LPR AIR AMBULANCE HELICOPTER GEOMETRY & TSL MATERIAL
// ============================================================================
const HELI_PARTS = {
  FUSELAGE: 0,
  COWLING: 1,
  FIN: 2,
  SKID: 3,
  ROTOR: 4,
  EXHAUST: 5
};

/**
 * Helper to create a 12-point symmetric helicopter fuselage cross-section
 * with flattened belly floor, rounded lower chines, wide panoramic cabin flanks,
 * tumblehome upper glass/shoulder, and crowned roof/tailboom.
 */
function heliFuselageSection(z, halfW, botY, topY, bellyFlat = 0.68, shoulderRatio = 0.52) {
  const h = Math.max(0.08, topY - botY);
  const chineY = botY + h * 0.16;
  const shoulderY = botY + h * shoulderRatio;
  const eaveY = botY + h * 0.86;

  const right = [
    new THREE.Vector3(halfW * bellyFlat * 0.55, botY, z),
    new THREE.Vector3(halfW * 0.92, chineY, z),
    new THREE.Vector3(halfW, shoulderY, z),
    new THREE.Vector3(halfW * 0.88, eaveY, z),
    new THREE.Vector3(halfW * 0.46, topY - h * 0.03, z),
    new THREE.Vector3(0.0, topY, z)
  ];
  const left = right
    .slice(0, 5)
    .reverse()
    .map((p) => new THREE.Vector3(-p.x, p.y, p.z));
  const bottomCenter = [new THREE.Vector3(0.0, botY, z)];
  return [...bottomCenter, ...right, ...left].reverse();
}

/**
 * Helper to create an 8-point symmetric airfoil / cowling cross-section.
 */
function heliAirfoilSection(xCenter, yCenter, zCenter, halfThickX, halfHeightY, chordZ) {
  // Airfoil lying along Z (for vertical fin) or X (for horizontal stabilizer)
  return [
    new THREE.Vector3(xCenter, yCenter, zCenter + chordZ * 0.5),
    new THREE.Vector3(xCenter + halfThickX, yCenter, zCenter + chordZ * 0.18),
    new THREE.Vector3(xCenter + halfThickX * 0.65, yCenter, zCenter - chordZ * 0.25),
    new THREE.Vector3(xCenter, yCenter, zCenter - chordZ * 0.5),
    new THREE.Vector3(xCenter - halfThickX * 0.65, yCenter, zCenter - chordZ * 0.25),
    new THREE.Vector3(xCenter - halfThickX, yCenter, zCenter + chordZ * 0.18)
  ];
}

function buildHelicopterBodyGeometry() {
  const parts = [];

  // 1. Continuous 3D Lofted Monocoque Fuselage-to-Tailboom (15 stations from z = +2.82 nose to z = -5.85 tail)
  // [z, halfW, botY, topY, bellyFlat, shoulderRatio]
  const fuselageProfile = [
    [2.82, 0.16, 0.88, 1.02, 0.50, 0.50], // Aerodynamic nose tip
    [2.62, 0.54, 0.72, 1.18, 0.62, 0.48], // Lower nose chin window
    [2.20, 0.88, 0.58, 1.48, 0.72, 0.46], // Lower windshield base
    [1.55, 1.10, 0.52, 1.86, 0.78, 0.44], // Front pilot cabin & wide panoramic windscreen
    [0.75, 1.16, 0.50, 2.02, 0.80, 0.45], // Main cabin (widest section)
    [-0.15, 1.14, 0.50, 2.02, 0.80, 0.46], // Rear passenger cabin
    [-0.95, 1.02, 0.54, 1.96, 0.74, 0.50], // Cabin-to-cowling transition
    [-1.65, 0.74, 0.72, 1.84, 0.62, 0.54], // Rear baggage & tapered clamshell bay
    [-2.35, 0.42, 1.12, 1.74, 0.45, 0.55], // Forward tailboom root
    [-3.25, 0.31, 1.24, 1.72, 0.40, 0.55], // Mid tailboom
    [-4.35, 0.24, 1.32, 1.70, 0.38, 0.55], // Stabilizer station
    [-5.35, 0.18, 1.38, 1.68, 0.36, 0.55], // Rear tailboom before fin
    [-5.85, 0.12, 1.43, 1.65, 0.35, 0.55]  // Tailboom tip cap
  ];

  const fuselageSections = fuselageProfile.map((s) => heliFuselageSection(...s));
  parts.push(part(new LoftGeometry(fuselageSections, { capStart: true, capEnd: true }), HELI_PARTS.FUSELAGE));

  // 2. Sculpted Twin-Turbine Upper Engine Cowling & Mast Doghouse (lofted from z = +0.55 to -2.25)
  const cowlingProfile = [
    [0.55, 0.32, 1.94, 2.12, 0.85, 0.45],
    [0.10, 0.56, 1.96, 2.38, 0.85, 0.48],
    [-0.55, 0.62, 1.94, 2.44, 0.85, 0.50],
    [-1.25, 0.56, 1.88, 2.36, 0.82, 0.50],
    [-1.85, 0.38, 1.76, 2.10, 0.78, 0.50],
    [-2.28, 0.20, 1.68, 1.82, 0.70, 0.50]
  ];
  const cowlingSections = cowlingProfile.map((s) => heliFuselageSection(...s));
  parts.push(part(new LoftGeometry(cowlingSections, { capStart: true, capEnd: true }), HELI_PARTS.COWLING));

  // Twin Canted Turbine Exhaust Nozzles tucked cleanly into rear of engine cowling
  for (const side of [-1, 1]) {
    const exhaust = new THREE.CylinderGeometry(0.10, 0.125, 0.34, 14)
      .rotateX(Math.PI * 0.46)
      .rotateY(side * 0.10)
      .translate(side * 0.24, 2.08, -1.72);
    parts.push(part(exhaust, HELI_PARTS.EXHAUST));
  }

  // 3. 3D Lofted Swept Vertical Tail Fin (Airfoil cross-sections sweeping from z = -5.15 to -6.15)
  // Upper swept fin + lower ventral tail bumper fin
  const vFinProfile = [
    [-0.02, 0.88, -5.28, 0.05, 0.0, 0.44], // Ventral tail fin tip
    [0.0,   1.48, -5.25, 0.12, 0.0, 0.88], // Tailboom junction root
    [0.0,   1.95, -5.52, 0.10, 0.0, 0.76], // Mid swept vertical fin
    [0.0,   2.48, -5.82, 0.08, 0.0, 0.60], // Upper swept vertical fin
    [0.0,   2.82, -6.04, 0.05, 0.0, 0.42]  // Top anti-collision beacon tip
  ];
  const vFinSections = vFinProfile.map(([x, y, z, hx, hy, cz]) =>
    heliAirfoilSection(x, y, z, hx, hy, cz).reverse()
  );
  parts.push(part(new LoftGeometry(vFinSections, { capStart: true, capEnd: true }), HELI_PARTS.FIN));

  // 4. 3D Lofted Horizontal Stabilizer Wing + Angled Endplate Winglets at z = -4.25
  const hStabSections = [-1.08, -0.55, 0.0, 0.55, 1.08].map((x) => {
    const taper = 1.0 - Math.abs(x) * 0.24;
    const chord = 0.46 * taper;
    const thick = 0.045 * taper;
    const y = 1.54;
    const z = -4.22 - Math.abs(x) * 0.12;
    return [
      new THREE.Vector3(x, y, z + chord * 0.5),
      new THREE.Vector3(x, y + thick, z + chord * 0.15),
      new THREE.Vector3(x, y + thick * 0.6, z - chord * 0.25),
      new THREE.Vector3(x, y, z - chord * 0.5),
      new THREE.Vector3(x, y - thick * 0.6, z - chord * 0.25),
      new THREE.Vector3(x, y - thick, z + chord * 0.15)
    ];
  });
  parts.push(part(new LoftGeometry(hStabSections, { capStart: true, capEnd: true }), HELI_PARTS.FIN));

  // Endplate Winglets on Horizontal Stabilizer tips
  for (const side of [-1, 1]) {
    const wx = side * 1.08;
    const wz = -4.35;
    const winglet = [
      [-0.22, 0.028, 0.30],
      [0.0,   0.036, 0.38],
      [0.26,  0.024, 0.26]
    ].map(([dy, hx, cz]) =>
      heliAirfoilSection(wx + side * Math.abs(dy) * 0.12, 1.54 + dy, wz - Math.abs(dy) * 0.15, hx, 0, cz).reverse()
    );
    parts.push(part(new LoftGeometry(winglet, { capStart: true, capEnd: true }), HELI_PARTS.FIN));
  }

  // 5. Tubular Landing Skids (LoftGeometry curved skids with upturned front runners + arched cross-tubes + steps)
  for (const side of [-1, 1]) {
    const sx = side * 1.12;
    // Skid runner tube from upturned front tip (z = +2.15, y = 0.28) along ground (y = 0.07) to rear tip (z = -1.75)
    const skidJoints = [
      [new THREE.Vector3(sx, 0.28, 2.15), 0.036, 0.036],
      [new THREE.Vector3(sx, 0.12, 1.88), 0.045, 0.045],
      [new THREE.Vector3(sx, 0.07, 1.45), 0.048, 0.048],
      [new THREE.Vector3(sx, 0.07, 0.0),  0.048, 0.048],
      [new THREE.Vector3(sx, 0.07, -1.45), 0.048, 0.048],
      [new THREE.Vector3(sx, 0.12, -1.75), 0.038, 0.038]
    ];
    const skidSections = skidJoints.map(([c, rx, ry]) =>
      Array.from({ length: 8 }, (_, k) => {
        const a = (k / 8) * Math.PI * 2;
        return new THREE.Vector3(c.x + Math.cos(a) * rx, c.y + Math.sin(a) * ry, c.z);
      }).reverse()
    );
    parts.push(part(new LoftGeometry(skidSections, { capStart: true, capEnd: true }), HELI_PARTS.SKID));

    // Passenger boarding step plate
    const stepBar = new THREE.BoxGeometry(0.14, 0.03, 0.88).translate(side * 1.02, 0.28, 0.42);
    parts.push(part(stepBar, HELI_PARTS.SKID));
  }

  // Front & Rear Arched Skid Cross-Tubes hugging the fuselage belly
  for (const cz of [1.05, -0.82]) {
    const crossPoints = [
      [new THREE.Vector3(-1.12, 0.09, cz), 0.042, 0.042],
      [new THREE.Vector3(-0.92, 0.42, cz), 0.044, 0.044],
      [new THREE.Vector3(-0.62, 0.56, cz), 0.046, 0.046],
      [new THREE.Vector3(0.62,  0.56, cz), 0.046, 0.046],
      [new THREE.Vector3(0.92,  0.42, cz), 0.044, 0.044],
      [new THREE.Vector3(1.12,  0.09, cz), 0.042, 0.042]
    ];
    const crossSections = limbSections(crossPoints, 8);
    parts.push(part(new LoftGeometry(crossSections, { capStart: true, capEnd: true }), HELI_PARTS.SKID));
  }

  // Wire-strike cutter & pitot tube on nose
  const pitot = new THREE.CylinderGeometry(0.015, 0.025, 0.35, 6)
    .rotateX(Math.PI * 0.5)
    .translate(0, 0.88, 2.88);
  parts.push(part(pitot, HELI_PARTS.SKID));

  return mergeGeometries(parts);
}

/**
 * Builds the 4-Bladed Main Rotor Hub, Swashplate, and Tapered Airfoil Rotor Blades.
 */
function buildHelicopterMainRotorGeometry() {
  const parts = [];

  // Rotor mast, swashplate collar & aerodynamic hub dome
  const mast = new THREE.CylinderGeometry(0.11, 0.14, 0.52, 14).translate(0, -0.18, 0);
  const swash = new THREE.CylinderGeometry(0.24, 0.26, 0.08, 16).translate(0, -0.12, 0);
  const hubCap = new THREE.SphereGeometry(0.28, 16, 10)
    .scale(1.0, 0.42, 1.0)
    .translate(0, 0.04, 0);
  parts.push(
    part(mast, HELI_PARTS.SKID),
    part(swash, HELI_PARTS.EXHAUST),
    part(hubCap, HELI_PARTS.ROTOR)
  );

  // 4 Tapered Airfoil Main Rotor Blades with pitch cuff grips
  for (let b = 0; b < 4; b++) {
    const angle = (b * Math.PI) / 2;
    const cuff = new THREE.BoxGeometry(0.65, 0.045, 0.14)
      .translate(0.52, 0, 0)
      .rotateY(angle);
    const blade = new THREE.BoxGeometry(4.45, 0.024, 0.26)
      .rotateX(0.08) // Realistic collective blade pitch
      .translate(2.68, 0, 0)
      .rotateY(angle);
    parts.push(part(cuff, HELI_PARTS.SKID), part(blade, HELI_PARTS.ROTOR));
  }

  return mergeGeometries(parts);
}

/**
 * Builds the 4-Bladed Tail Rotor Assembly.
 */
function buildHelicopterTailRotorGeometry() {
  const parts = [];
  const hub = new THREE.CylinderGeometry(0.09, 0.09, 0.18, 12)
    .rotateZ(Math.PI * 0.5);
  parts.push(part(hub, HELI_PARTS.EXHAUST));

  for (let b = 0; b < 4; b++) {
    const angle = (b * Math.PI) / 2;
    const blade = new THREE.BoxGeometry(0.022, 0.76, 0.13)
      .translate(0, 0.42, 0)
      .rotateX(angle);
    parts.push(part(blade, HELI_PARTS.ROTOR));
  }
  return mergeGeometries(parts);
}

let _heliLoftedMat = null;

/**
 * Creates the TSL procedural material for the 3D Lofted Helicopter, an EC135 of Lotnicze Pogotowie Ratunkowe (the
 * Polish air ambulance, with a base at Poznań-Ławica):
 * - Renders wrap-around panoramic windscreen, chin bubble windows, cabin side windows,
 *   and overhead skylight glass using anti-aliased `roundedRect` SDFs with rubber seals & frame pillars.
 * - Renders the LPR livery (approximate): colza yellow (RAL 1021) all over, a traffic-red (RAL 3020) belly and
 *   cheat line, an ultramarine (RAL 5002) belt along the cabin and red bands on the tail; graphite (RAL 7024) cowling.
 * - Renders slatted turbine air intakes on the engine cowling and white tips on the rotor blades.
 */
function createLoftedHelicopterMaterial() {
  if (_heliLoftedMat) return _heliLoftedMat;

  const mat = new THREE.MeshStandardNodeMaterial();

  const evaluateHeliSurface = Fn(() => {
    const partId = attribute('partId', 'float');
    const isCowling = step(abs(partId.sub(HELI_PARTS.COWLING)), 0.25);
    const isFin = step(abs(partId.sub(HELI_PARTS.FIN)), 0.25);
    const isSkid = step(abs(partId.sub(HELI_PARTS.SKID)), 0.25);
    const isRotor = step(abs(partId.sub(HELI_PARTS.ROTOR)), 0.25);
    const isExhaust = step(abs(partId.sub(HELI_PARTS.EXHAUST)), 0.25);
    const isFuselage = step(abs(partId.sub(HELI_PARTS.FUSELAGE)), 0.25);

    const p = attribute('position', 'vec3').toVar();
    const n = attribute('normal', 'vec3').toVar();

    // 1. Panoramic Wrap-Around Cockpit Windscreen & Side Cabin Windows (on Fuselage)
    // Front windscreen: z in [0.95, 2.52], y in [0.98, 1.88], split by narrow center post at x = 0
    const frontGlassOuter = roundedRect(vec2(p.z.sub(1.74), p.y.sub(1.42)), vec2(0.76, 0.42), 0.14)
      .mul(step(0.65, p.z));
    const centerPost = smoothstep(0.022, 0.036, abs(p.x));
    const aPillar = smoothstep(0.028, 0.044, abs(p.z.sub(1.06)));
    const bPillar = smoothstep(0.026, 0.042, abs(p.z.sub(0.08)));

    // Lower nose chin bubble windows (for pilot downward visibility)
    const chinWindow = roundedRect(vec2(abs(p.x).sub(0.28), p.y.sub(0.84)), vec2(0.19, 0.11), 0.04)
      .mul(smoothstep(1.95, 2.15, p.z))
      .mul(smoothstep(2.68, 2.52, p.z));

    // Wide side cabin windows: z in [-0.78, 1.02], y in [1.02, 1.74]
    const sideWindow = roundedRect(vec2(p.z.sub(0.12), p.y.sub(1.38)), vec2(0.88, 0.34), 0.10)
      .mul(step(0.45, abs(n.x)));

    // Overhead cockpit eyebrow skylight windows
    const skylight = roundedRect(vec2(abs(p.x).sub(0.32), p.z.sub(1.25)), vec2(0.20, 0.38), 0.06)
      .mul(step(1.72, p.y));

    const rawWindowMask = max(
      max(frontGlassOuter.mul(centerPost), sideWindow),
      max(chinWindow, skylight)
    )
      .mul(aPillar)
      .mul(bPillar)
      .mul(isFuselage)
      .toVar();

    // Rubber window weatherstripping seal around glass panes
    const rawSealMask = max(
      roundedRect(vec2(p.z.sub(1.74), p.y.sub(1.42)), vec2(0.80, 0.46), 0.15).mul(step(0.60, p.z)),
      roundedRect(vec2(p.z.sub(0.12), p.y.sub(1.38)), vec2(0.92, 0.38), 0.12).mul(step(0.40, abs(n.x)))
    )
      .mul(isFuselage)
      .toVar();

    // 2. LPR livery: yellow over a red belly whose edge sweeps up towards the tail, a thin red cheat line above it, and
    // the ultramarine belt (where the real one carries LOTNICZE POGOTOWIE RATUNKOWE) between them and the windows
    const bellyY = float(0.80).add(p.z.mul(-0.085));
    const edgeW = max(fwidth(p.y), 0.008);
    const isLowerRed = smoothstep(bellyY.add(edgeW), bellyY.sub(edgeW), p.y);
    const isBelt = smoothstep(0.075, 0.06, abs(p.y.sub(bellyY.add(0.15)))).mul(step(-0.95, p.z));
    const isCheatLine = smoothstep(0.02, 0.011, abs(p.y.sub(bellyY.add(0.05))));
    // Two red bands round the tail boom
    const isTailBand = max(
      smoothstep(0.17, 0.15, abs(p.z.add(3.0))),
      smoothstep(0.17, 0.15, abs(p.z.add(4.0)))
    );

    // Cabin door panel seams & handles
    const doorSeam1 = smoothstep(0.012, 0.004, abs(p.z.sub(1.06)));
    const doorSeam2 = smoothstep(0.012, 0.004, abs(p.z.sub(0.08)));
    const doorSeam3 = smoothstep(0.012, 0.004, abs(p.z.sub(-0.82)));
    const doorHandle = roundedRect(vec2(p.z.sub(0.24), p.y.sub(0.94)), vec2(0.065, 0.014), 0.006);
    const panelLines = max(max(doorSeam1, max(doorSeam2, doorSeam3)), doorHandle)
      .mul(step(0.55, abs(n.x)))
      .mul(smoothstep(0.55, 0.62, p.y))
      .mul(smoothstep(1.75, 1.65, p.y));

    const yellowPaint = color(0xf2c200);
    const redPaint = color(0xc1121c);
    const bluePaint = color(0x1f2a6b);
    const graphitePaint = color(0x45484e);
    const whitePaint = color(0xf2f3f0);

    const baseLivery = mix(mix(yellowPaint, redPaint, max(max(isLowerRed, isCheatLine), isTailBand)), bluePaint, isBelt)
      .mul(float(1.0).sub(panelLines.mul(0.45)));

    const glassCol = mix(color(0x102234), color(0x1e3c58), clamp(n.y.mul(0.5).add(0.5), 0.0, 1.0));
    const fuselageCol = mix(mix(baseLivery, color(0x14181e), rawSealMask), glassCol, rawWindowMask);

    // 3. Engine Cowling: graphite with a yellow lower edge and a dark slatted turbine intake grille
    const intakeGrille = roundedRect(vec2(p.z.sub(-0.45), p.y.sub(2.18)), vec2(0.52, 0.13), 0.04)
      .mul(step(0.35, abs(n.x)));
    const louverSlats = step(0.45, fract(p.y.mul(55.0))).mul(0.4).add(0.35);
    const cowlingCol = mix(
      mix(graphitePaint, yellowPaint, smoothstep(2.02, 1.97, p.y)),
      color(0x181c22).mul(louverSlats),
      intakeGrille
    );

    // 4. Swept Tail Fin & Stabilizer: yellow with a red band
    const finRedBand = smoothstep(2.42, 2.45, p.y).mul(smoothstep(2.62, 2.59, p.y));
    const finCol = mix(yellowPaint, redPaint, finRedBand);

    // 5. Rotor Blades: Matte Anthracite Carbon with white tips
    const radialDist = length(vec2(p.x, p.z));
    const isBladeTip = smoothstep(4.35, 4.42, radialDist).add(
      smoothstep(0.65, 0.68, abs(p.y)).mul(step(radialDist, 0.35))
    );
    const rotorCol = mix(color(0x1e232a), whitePaint, clamp(isBladeTip, 0.0, 1.0));

    const skidCol = color(0x22272e);
    const exhaustBore = step(0.65, n.z.negate());
    const exhaustCol = mix(color(0x484f58), color(0x101318), exhaustBore);

    return mix(
      mix(
        mix(
          mix(
            mix(fuselageCol, cowlingCol, isCowling),
            finCol,
            isFin
          ),
          skidCol,
          isSkid
        ),
        rotorCol,
        isRotor
      ),
      exhaustCol,
      isExhaust
    );
  });

  mat.colorNode = evaluateHeliSurface();

  mat.roughnessNode = Fn(() => {
    const partId = attribute('partId', 'float');
    const isFuselage = step(abs(partId.sub(HELI_PARTS.FUSELAGE)), 0.25);
    const isSkid = step(abs(partId.sub(HELI_PARTS.SKID)), 0.25);
    const isRotor = step(abs(partId.sub(HELI_PARTS.ROTOR)), 0.25);
    const p = attribute('position', 'vec3');
    const n = attribute('normal', 'vec3');
    const frontGlass = roundedRect(vec2(p.z.sub(1.74), p.y.sub(1.42)), vec2(0.76, 0.42), 0.14).mul(step(0.65, p.z));
    const sideGlass = roundedRect(vec2(p.z.sub(0.12), p.y.sub(1.38)), vec2(0.88, 0.34), 0.10).mul(step(0.45, abs(n.x)));
    const isGlass = max(frontGlass, sideGlass).mul(isFuselage);
    return mix(mix(float(0.20), float(0.05), isGlass), float(0.55), max(isSkid, isRotor));
  })();

  mat.metalnessNode = Fn(() => {
    const partId = attribute('partId', 'float');
    const isFuselage = step(abs(partId.sub(HELI_PARTS.FUSELAGE)), 0.25);
    const isExhaust = step(abs(partId.sub(HELI_PARTS.EXHAUST)), 0.25);
    const p = attribute('position', 'vec3');
    const n = attribute('normal', 'vec3');
    const frontGlass = roundedRect(vec2(p.z.sub(1.74), p.y.sub(1.42)), vec2(0.76, 0.42), 0.14).mul(step(0.65, p.z));
    const sideGlass = roundedRect(vec2(p.z.sub(0.12), p.y.sub(1.38)), vec2(0.88, 0.34), 0.10).mul(step(0.45, abs(n.x)));
    const isGlass = max(frontGlass, sideGlass).mul(isFuselage);
    return mix(mix(float(0.35), float(0.88), isGlass), float(0.82), isExhaust);
  })();

  _heliLoftedMat = mat;
  return mat;
}

// ============================================================================
// 6. POZNAŃ TRAMS (trams.js): ARTICULATED LOW-FLOOR SECTIONS, BELLOWS & TSL MATERIAL
// ============================================================================
// One lofted body per section kind (trams.js TRAM_MODELS: { len, cab, doors, bogies, pantograph }), +z forward and
// centred on the section, so trams.js poses every section with one matrix. Cab sections taper into a raked, rounded
// nose at +z (cab 1, the front) or -z (cab -1, the rear end). Roof equipment fairings, the bogies under the skirt, a
// coupler cover and the single-arm pantograph are separate pieces of the same mesh (partId). Windows, doors, livery
// and lamps are painted by createTramMaterial() from object-space position and normal plus a constant per-vertex
// `tramInfo` (half length, cab, two door centres) and the per-instance `tramState` (brake, livery, doors open, display
// row).
const TRAM_PARTS = {
  BODY: 0,
  TRIM: 1,
  POD: 2,
  PANTO: 3,
  BELLOWS: 4
};
// Right half of the cross-section (x, y), skirt to roof, and the roof centre: 2.4 m wide, low floor
const TRAM_PROFILE = [[1.1, 0.3], [1.19, 0.38], [1.2, 0.6], [1.2, 2.3], [1.18, 2.7], [1.1, 2.96], [0.86, 3.1], [0.42, 3.16]];
const TRAM_ROOF = 3.18;
// The nose over its last `len` metres: plan taper, windscreen rake (top back), rounded corners, chin
const TRAM_NOSE = { len: 1.6, taper: 0.14, rake: 0.42, round: 0.45, chin: 0.12, u: [0, 0.3, 0.55, 0.75, 0.9, 1] };
// Height the pantograph head is raised to: its top (head + 0.03) meets the 5.8 m contact wire (tram-infra.js WIRE_Y)
const TRAM_PANTOGRAPH_HEAD = 5.77;

function tramRing(z, u, cab) {
  const ring = mirrorSection(TRAM_PROFILE, [0, TRAM_ROOF], z);
  if (u <= 0) return ring;
  const n = TRAM_NOSE;
  for (const p of ring) {
    const up = Math.min(1, Math.max(0, (p.y - 1.1) / 2.0));
    const low = Math.min(1, Math.max(0, (0.75 - p.y) / 0.45));
    const across = Math.abs(p.x) / 1.2;
    p.x *= 1 - n.taper * u * u;
    p.z -= cab * u * (n.rake * up * up + n.round * across ** 3 * u + n.chin * low);
  }
  return ring;
}

// A thin box from a to b (pantograph arms)
function tramBeam(a, b, t) {
  const d = b.distanceTo(a);
  const g = new THREE.BoxGeometry(t, t, d);
  const m = new THREE.Matrix4().lookAt(b, a, new THREE.Vector3(1, 0, 0));
  m.setPosition((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g.applyMatrix4(m);
}

function buildTramPantograph() {
  const v = (x, y, z) => new THREE.Vector3(x, y, z);
  const base = TRAM_ROOF + 0.3;
  const head = TRAM_PANTOGRAPH_HEAD;
  const knee = v(0, base + (head - base) * 0.48, 0.7);
  const parts = [roundedBox(0.5, 0.05, 1.3, 0.03).translate(0, base, 0)];
  for (const x of [-0.4, 0.4]) parts.push(new THREE.CylinderGeometry(0.05, 0.06, 0.16, 6).translate(x, base - 0.1, -0.5));
  for (const x of [-0.16, 0.16]) parts.push(tramBeam(v(x, base + 0.05, -0.55), v(x * 0.4, knee.y, knee.z), 0.05));
  parts.push(tramBeam(v(0, knee.y, knee.z), v(0, head - 0.06, -0.3), 0.045));
  parts.push(tramBeam(v(0, base + 0.08, -0.35), v(0, knee.y - 0.1, knee.z - 0.1), 0.025)); // the guide rod
  parts.push(new THREE.BoxGeometry(1.3, 0.05, 0.1).translate(0, head, -0.3)); // collector strip
  for (const s of [-1, 1]) {
    parts.push(new THREE.BoxGeometry(0.3, 0.04, 0.08).rotateZ(s * 0.5).translate(s * 0.78, head - 0.07, -0.3)); // horns
  }
  return mergeGeometries(parts.map((g) => part(g, TRAM_PARTS.PANTO)));
}

function buildTramSectionGeometry(section) {
  const { len, cab, doors, bogies, pantograph } = section;
  const h = len / 2;
  const stations = [[h, 0], [-h, 0]];
  if (cab) {
    stations.length = 0;
    stations.push([-cab * h, 0]);
    for (const u of TRAM_NOSE.u) stations.push([cab * (h - TRAM_NOSE.len * (1 - u)), u]);
  }
  stations.sort((a, b) => b[0] - a[0]);
  const body = new LoftGeometry(stations.map(([z, u]) => tramRing(z, u, cab || 1)), { capStart: true, capEnd: true });
  const parts = [part(body, TRAM_PARTS.BODY)];

  // Roof equipment fairing (kept off the nose), bogie frames under the skirt
  const podLen = len * (cab ? 0.5 : 0.62);
  parts.push(part(roundedBox(0.74, 0.14, podLen, 0.08, 0.03).translate(0, TRAM_ROOF + 0.12, -cab * len * 0.12), TRAM_PARTS.POD));
  for (const z of bogies) parts.push(part(roundedBox(0.98, 0.17, 2.3, 0.05, 0.02).translate(0, 0.21, z), TRAM_PARTS.TRIM));
  if (pantograph) parts.push(buildTramPantograph());
  if (cab) {
    // Coupler cover and the camera/mirror arms at the cab's top corners
    const zEnd = cab * (h - 0.32);
    parts.push(part(roundedBox(0.7, 0.1, 0.3, 0.05, 0.02).translate(0, 0.42, zEnd), TRAM_PARTS.TRIM));
    for (const side of [-1, 1]) {
      parts.push(part(new THREE.BoxGeometry(0.22, 0.04, 0.04).translate(side * 1.28, 2.62, cab * (h - 0.7)), TRAM_PARTS.TRIM));
      parts.push(part(roundedBox(0.05, 0.13, 0.08, 0.025, 0.01).translate(side * 1.4, 2.5, cab * (h - 0.7)), TRAM_PARTS.TRIM));
    }
  }
  const geo = mergeGeometries(parts);
  const info = new Float32Array(geo.attributes.position.count * 4);
  for (let i = 0; i < info.length; i += 4) {
    info[i] = h;
    info[i + 1] = cab;
    info[i + 2] = doors[0];
    info[i + 3] = doors[1];
  }
  geo.setAttribute('tramInfo', new THREE.BufferAttribute(info, 4));
  return geo;
}

// Bellows between two sections: a unit-length ribbed box (scaled along z per joint), inset from the body sides
function buildTramBellowsGeometry() {
  const geo = part(roundedBox(1.1, 1.3, 1.0, 0.25, 0.02).translate(0, 1.7, 0), TRAM_PARTS.BELLOWS);
  geo.setAttribute('tramInfo', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 4), 4));
  return geo;
}

// Cab destination displays (amber LED, as on the MPK Gamma and Tramino): one row per tram line route, row 0 blank and
// row i + 1 GEO.tramRoutes[i], the line number in the first 22% of the width and the terminus after it, then a dark grid
// for the dot-matrix look. 7:1 rows, the shape of the display's text area (1.24 × 0.18 m).
function createTramDestinationTexture(routes) {
  const c = document.createElement('canvas');
  const rowH = 64;
  c.width = 448;
  c.height = rowH * (routes.length + 1);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#07080a';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#ffa31a';
  ctx.textBaseline = 'middle';
  const fit = (text, x, y, maxWidth, align) => {
    const w = ctx.measureText(text).width;
    const k = w > maxWidth ? maxWidth / w : 1;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(k, 1);
    ctx.textAlign = align;
    ctx.fillText(text, 0, 0);
    ctx.restore();
  };
  routes.forEach((r, i) => {
    const y = (i + 1) * rowH + rowH / 2 + 2;
    ctx.font = '800 48px Arial, sans-serif';
    fit(r.ref, 50, y, 88, 'center');
    ctx.font = '700 36px Arial, sans-serif';
    fit(r.to, 110, y, 326, 'left');
  });
  ctx.fillStyle = 'rgba(7, 8, 10, 0.75)';
  for (let x = 0; x < c.width; x += 4) ctx.fillRect(x, 0, 1, c.height);
  for (let y = 0; y < c.height; y += 4) ctx.fillRect(0, y, c.width, 1);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let _tramMat = null;

/**
 * The TSL material shared by every tram section and the bellows:
 * - Cab ends: a large raked windscreen with the LED destination display above it (row `tramState.w` of `signMap`, which
 *   holds `rows` rows, the first at the top; without a map, a generic dot pattern); LED headlamps (front cab) or
 *   red tail / brake lamps (rear cab)
 * - Continuous dark window band with thin pillars, glazed double doors on the right (-x) side, opening dark (doors
 *   open, `tramState.z`); interiors glow at night
 * - MPK Poznań livery (approximate): livery 0 (Gamma) green below the windows with yellow sill & cornice stripes and a
 *   yellow cab front; livery 1 (Tramino) metallic green with thin yellow accents, yellow door frames and a yellow
 *   front band; light grey roof & fairings, dark skirt, ribbed black bellows
 */
function createTramMaterial(signMap = null, rows = 1) {
  if (_tramMat) return _tramMat;
  const p = attribute('position', 'vec3');
  const n = attribute('normal', 'vec3');
  const partId = attribute('partId', 'float');
  const info = attribute('tramInfo', 'vec4');
  const state = attribute('tramState', 'vec4');
  const isPart = (id) => step(abs(partId.sub(id)), 0.25);
  const isBody = isPart(TRAM_PARTS.BODY);
  const isTrim = isPart(TRAM_PARTS.TRIM);
  const isPod = isPart(TRAM_PARTS.POD);
  const isPanto = isPart(TRAM_PARTS.PANTO);
  const isBellows = isPart(TRAM_PARTS.BELLOWS);
  const one = float(1.0);
  const halfLen = info.x;
  const cab = info.y;
  const tramino = state.y;
  const ax = abs(p.x);

  const side = smoothstep(0.55, 0.8, abs(n.x)).mul(isBody);
  const roof = smoothstep(0.55, 0.8, n.y).mul(isBody);
  const curb = step(p.x, 0.0);
  // The cab's end face (cab +1: at +z, -1: at -z)
  const cabFace = smoothstep(0.25, 0.5, n.z.mul(cab)).mul(step(halfLen.sub(1.9), p.z.mul(cab))).mul(abs(cab)).mul(isBody);
  const isFront = step(0.5, cab);
  const isRear = step(cab, -0.5);
  const windscreen = roundedRect(vec2(p.x, p.y.sub(2.0)), vec2(1.0, 0.74), 0.2).mul(cabFace);
  const display = roundedRect(vec2(p.x, p.y.sub(2.9)), vec2(0.66, 0.11), 0.03).mul(cabFace);
  // Text area 1.24 × 0.18 m, read left to right from outside the cab (+x is the tram's left, so mirrored by cab)
  const signU = clamp(p.x.mul(cab).add(0.62).div(1.24), 0.0, 1.0);
  const signV = clamp(p.y.sub(2.81).div(0.18), 0.0, 1.0);
  const displayText = signMap
    ? texture(signMap, vec2(signU, signV.add(float(rows - 1).sub(state.w)).div(rows))).rgb.mul(1.6)
    : color(0xffa020).mul(step(0.45, fract(p.x.mul(9.0))).mul(roundedRect(vec2(p.x.add(0.1), p.y.sub(2.9)), vec2(0.46, 0.06), 0.01)));

  // Window band (pillars every 1.6 m), doors with glazed leaves
  const band = smoothstep(1.1, 1.14, p.y).mul(smoothstep(2.6, 2.56, p.y)).mul(side).mul(step(abs(p.z), halfLen.sub(0.3)));
  const pillar = smoothstep(0.035, 0.05, abs(fract(p.z.mul(0.625).add(0.5)).sub(0.5)));
  const doorAt = (dz) => roundedRect(vec2(p.z.sub(dz), p.y.sub(1.33)), vec2(0.68, 1.03), 0.06).mul(side).mul(curb);
  const leafAt = (dz) => roundedRect(vec2(abs(p.z.sub(dz)).sub(0.33), p.y.sub(1.45)), vec2(0.28, 0.86), 0.04).mul(side).mul(curb);
  const door = max(doorAt(info.z), doorAt(info.w));
  const leaf = max(leafAt(info.z), leafAt(info.w));
  const doorsOpen = state.z;
  const glass = clamp(max(max(band.mul(pillar).mul(one.sub(door)), windscreen), leaf.mul(one.sub(doorsOpen))), 0.0, 1.0);
  const doorway = leaf.mul(doorsOpen);

  // Livery
  const lower = smoothstep(1.03, 0.99, p.y);
  const sill = smoothstep(0.96, 0.99, p.y).mul(smoothstep(1.12, 1.09, p.y));
  const cornice = smoothstep(2.6, 2.63, p.y).mul(smoothstep(2.9, 2.87, p.y));
  const thin = smoothstep(1.0, 1.02, p.y).mul(smoothstep(1.08, 1.06, p.y));
  const skirt = smoothstep(0.46, 0.42, p.y);
  const yellow = color(0xf3c316);
  const gammaCol = mix(mix(color(0x15703a), color(0x1c7d42), lower), yellow, max(max(sill, cornice), cabFace.mul(step(p.y, 1.62))));
  const frontBand = cabFace.mul(smoothstep(0.62, 0.66, p.y)).mul(smoothstep(0.84, 0.8, p.y));
  const traminoCol = mix(color(0x2a6a4b), yellow, max(thin, max(door.mul(one.sub(leaf)), frontBand)));
  let body = mix(gammaCol, traminoCol, tramino);
  body = mix(body, color(0x1f2327), door.mul(one.sub(leaf)).mul(one.sub(tramino)));
  body = mix(body, color(0xd9dcde), roof.mul(one.sub(cabFace)));
  body = mix(body, color(0x1a1d21), skirt);
  body = mix(body, color(0x15191d), band.mul(one.sub(pillar)).mul(one.sub(door)));
  body = mix(body, color(0x0c0e10), display);
  body = mix(body, color(0x2b2622), doorway);

  // Lamps on the cab faces
  const headLamp = roundedRect(vec2(ax.sub(0.82), p.y.sub(0.9)), vec2(0.15, 0.055), 0.04).mul(cabFace).mul(isFront);
  const tailLamp = roundedRect(vec2(ax.sub(0.92), p.y.sub(1.0)), vec2(0.06, 0.16), 0.03).mul(cabFace).mul(isRear);
  body = mix(body, color(0xe2eef8), headLamp);
  body = mix(body, color(0x8e0d12), tailLamp);
  const glassTint = mix(color(0x0d1820), color(0x1a2e3e), clamp(p.y.sub(1.3).mul(0.8), 0.0, 1.0));
  body = mix(body, glassTint, glass);

  const ribs = step(0.5, fract(p.z.mul(6.0).add(0.5)));
  const bellowsCol = mix(color(0x1a1c1f), color(0x2c3035), ribs);
  const col = mix(mix(mix(mix(body, color(0x1b1f24), isTrim), color(0xc9ced3), isPod), color(0x34383d), isPanto), bellowsCol, isBellows);

  const mat = new THREE.MeshStandardNodeMaterial();
  mat.colorNode = col;
  const paintRough = mix(float(0.38), float(0.3), tramino);
  const paintMetal = mix(float(0.12), float(0.5), tramino).mul(one.sub(max(sill, cornice)));
  mat.roughnessNode = mix(mix(mix(paintRough, float(0.12), glass), float(0.7), max(isTrim, isBellows)), float(0.45), max(isPod, isPanto));
  mat.metalnessNode = mix(mix(paintMetal, float(0.6), glass), float(0.05), max(max(isTrim, isBellows), isPod)).add(isPanto.mul(0.5));

  const brake = state.x;
  const night = smoothstep(0.6, 1.15, cityUniforms.uInteriorGlow);
  mat.emissiveNode = color(0xd9efff)
    .mul(headLamp.mul(night.mul(1.3).add(0.12)))
    .add(color(0xff0a12).mul(tailLamp.mul(brake.mul(1.5).add(0.7))))
    .add(displayText.mul(display).mul(0.9))
    .add(color(0xffe2b8).mul(max(band.mul(pillar).mul(one.sub(door)), max(leaf, doorway)).mul(night).mul(0.32)));

  _tramMat = mat;
  return mat;
}

export {
  CAR_PARTS,
  BODY_SPECS,
  carDimensions,
  polishRegistration,
  encodeRegistration,
  carLayout,
  carBodyHalfWidthAt,
  buildCarSidePatch,
  buildSteerableWheelGeo,
  buildCarGeometry,
  buildCarProxyGeometry,
  createLoftedCarMaterial,
  lightbarPlacement,
  buildLightbarGeometry,
  createLightbarMaterial,
  BUS_SPEC,
  buildLoftedBusBodyGeometry,
  buildBusSignGeometry,
  createBusSignMaterial,
  buildBusWheelGeo,
  createBusWheelMaterial,
  createLoftedBusMaterial,
  buildHelicopterBodyGeometry,
  buildHelicopterMainRotorGeometry,
  buildHelicopterTailRotorGeometry,
  createLoftedHelicopterMaterial,
  TRAM_PARTS,
  TRAM_PANTOGRAPH_HEAD,
  buildTramSectionGeometry,
  buildTramBellowsGeometry,
  createTramMaterial,
  createTramDestinationTexture
};
