import { GEO } from './geodata.js';
import {
  ROADS,
  BLOCKS,
  CITY_LANDMARKS,
  LANDMARK_SITES,
  CITY_BOUNDS,
  clampToLand,
  LAND_RINGS,
  LAND_HOLES,
  WATER,
  OUTSKIRTS,
  OUTSKIRTS_HOLES,
  PLAZAS,
  BRIDGES,
  RAIL,
  LABEL_ALIAS,
  getLocationLabel,
  isTypingInField,
  foldText,
  mapCaps,
  formatCount
} from './city-config.js';

// js/city-map.js
// GTA 6-Style Live Radar Minimap + Full-Screen Interactive Poznań Cartographic Atlas.
// Synchronized 1:1 with the 3D world (1 unit = 1 m; x = east, z = south, so both maps are drawn north up: Poznań's
// frame is not turned, GEO.frame.bearingDeg = 0). They draw the very geography the city is built from (GEO, from
// OpenStreetMap): the land in the detailed core and the low-detail outskirts out to the city line, the Warta, the
// Cybina, Malta & the ponds, every curb island (block) with the building footprints standing on it, the parks and
// squares, the real street centrelines (labelled along their course), the tram & rail lines and the bridges, with the
// district, quarter and water names from GEO.labels.

const FONT = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const MIN_ZOOM = 0.03; // full map, pixels per metre, when there is no city line to fit (minZoom fits it, ~24 km across)
const MAX_ZOOM = 3.0; // single lots
const RADAR_SCALE = 0.32; // radar pixels per metre on the ground (zooms out with altitude)
const GRID_BEARING = (GEO.frame && GEO.frame.bearingDeg) || 0; // the map's up direction, degrees east of true north

// The map compass's tooltip, from the bearing of the map's up direction (degrees east of true north)
function compassTitle(bearingDeg) {
  const deg = Math.round(Math.abs(bearingDeg));
  if (!deg) return 'True north';
  return `True north · the street grid runs ${deg}° ${bearingDeg > 0 ? 'east' : 'west'} of it`;
}

// Map palette, shared by the radar & the atlas (in step with css/style.css): graphite ground with the streets a shade
// lighter than the blocks they run between, muted parks & water; a yellow GPS route, white landmarks & player, cyan
// search hits, amber bridges, thin red tram lines and dashed grey railways
const MAP = {
  water: '#0a1118',
  beyond: '#12161b', // the land past the city line
  land: '#151a20', // the low-detail outskirts
  landEdge: '#252c35',
  streets: '#363f4b', // the detailed core: the roadway left between the blocks
  shore: '#4f5b6b',
  park: '#19301f',
  parkEdge: '#24432f',
  block: '#1c2128',
  blockEdge: '#272e37',
  plaza: '#2f3741',
  buildings: ['#242a32', '#2b323c', '#343c48'],
  buildingEdge: '#171b21',
  landmarkFill: 'rgba(255, 255, 255, 0.06)',
  landmarkEdge: 'rgba(255, 255, 255, 0.38)',
  mainRoads: '#3a434f',
  bridge: '#c08a3e',
  tram: '#b8434d',
  rail: '#5f6875',
  route: '#ffc21a',
  search: '#5fd0ff',
  halo: 'rgba(8, 11, 15, 0.9)'
};

// Area names at their real places (GEO.labels, world metres), by kind: the zoom range (pixels per metre) they show in
// and their type. Districts & quarters are set in spaced capitals (mapCaps upper-cases in Polish, so Ż/Ó/Ś stay), the
// water in italic mixed case. Placed in this order, so the larger names win a collision.
const AREA_STYLE = {
  suburb: { minS: 0, maxS: 0.3, font: '700 15px', color: 'rgba(168, 178, 192, 0.5)', tracking: '3px', caps: true },
  water: { minS: 0.04, maxS: 2, font: 'italic 500 12.5px', color: 'rgba(112, 168, 214, 0.6)', tracking: '1px' },
  quarter: { minS: 0.06, maxS: 1.5, font: '700 11.5px', color: 'rgba(168, 178, 192, 0.48)', tracking: '2px', caps: true },
  neighbourhood: { minS: 0.12, maxS: 1.5, font: '700 10.5px', color: 'rgba(168, 178, 192, 0.44)', tracking: '1.8px', caps: true }
};
const AREA_ORDER = Object.keys(AREA_STYLE);

// Grunwald and Winogrady are what Poznań calls these parts of the city (the dzielnice before 1990), but OSM places only
// their osiedla, so GEO.labels has "Stary Grunwald" and "Stare Winogrady" (kept: they name the smaller areas) and no
// GRUNWALD or WINOGRADY. Each is set as a suburb title at the area-weighted centroid of its osiedla's GEO.districts
// rings: Grunwald ≈ (-4170, 1280) in Grunwald Południe, Winogrady ≈ (310, -2250) in Stare Winogrady
const DISTRICT_GROUPS = {
  Grunwald: ['Grunwald Północ', 'Grunwald Południe', 'Stary Grunwald'],
  Winogrady: ['Stare Winogrady', 'Nowe Winogrady Południe', 'Nowe Winogrady Wschód', 'Nowe Winogrady Północ']
};

/** Suburb labels { name, kind, x, z } at the area-weighted centroid of each group's district rings (those present) */
function districtGroupLabels(districts, groups) {
  const out = [];
  for (const name in groups) {
    let a = 0;
    let mx = 0;
    let mz = 0;
    for (const d of districts) {
      if (!groups[name].includes(d.name) || !d.ring) continue;
      const { n, X, Z } = accessor(d.ring);
      let ra = 0;
      let rx = 0;
      let rz = 0;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const c = X(j) * Z(i) - X(i) * Z(j);
        ra += c;
        rx += (X(j) + X(i)) * c;
        rz += (Z(j) + Z(i)) * c;
      }
      // a ring's doubled area and moments share its winding's sign: flip clockwise rings so they add up
      const sign = ra < 0 ? -1 : 1;
      a += sign * ra;
      mx += sign * rx;
      mz += sign * rz;
    }
    if (a) out.push({ name, kind: 'suburb', x: mx / (3 * a), z: mz / (3 * a) });
  }
  return out;
}

const AREA_TITLES = [...(GEO.labels || []), ...districtGroupLabels(GEO.districts || [], DISTRICT_GROUPS)]
  .filter((l) => AREA_STYLE[l.kind])
  .sort((a, b) => AREA_ORDER.indexOf(a.kind) - AREA_ORDER.indexOf(b.kind))
  .map((l) => ({ text: AREA_STYLE[l.kind].caps ? mapCaps(l.name) : l.name, style: AREA_STYLE[l.kind], x: l.x, z: l.z }));

// ---------------------------------------------------------------------------------------------------------------------
// World-space vector layers: built once into Path2D objects (world metres) and drawn through a canvas transform
// ---------------------------------------------------------------------------------------------------------------------

// Point accessors for rings / polylines given as [{x, z}, ...] or flat [x0, z0, x1, z1, ...]
function accessor(pts) {
  const flat = typeof pts[0] === 'number';
  return {
    n: flat ? pts.length >> 1 : pts.length,
    X: flat ? (i) => pts[2 * i] : (i) => pts[i].x,
    Z: flat ? (i) => pts[2 * i + 1] : (i) => pts[i].z
  };
}

function boundsOf(pts) {
  const { n, X, Z } = accessor(pts);
  const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (let i = 0; i < n; i++) {
    const x = X(i);
    const z = Z(i);
    if (x < b.minX) b.minX = x;
    if (x > b.maxX) b.maxX = x;
    if (z < b.minZ) b.minZ = z;
    if (z > b.maxZ) b.maxZ = z;
  }
  return b;
}

// Appends a closed ring, always wound the same way as Path2D.rect (so overlapping rings of one path union under the
// nonzero fill rule instead of cancelling out), or the other way for a hole (which then cuts its outer ring)
function addRing(path, pts, hole = false) {
  if (!pts || pts.length < 3) return;
  const { n, X, Z } = accessor(pts);
  if (n < 3) return;
  let a = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) a += X(j) * Z(i) - X(i) * Z(j);
  if ((a >= 0) !== hole) {
    path.moveTo(X(0), Z(0));
    for (let i = 1; i < n; i++) path.lineTo(X(i), Z(i));
  } else {
    path.moveTo(X(n - 1), Z(n - 1));
    for (let i = n - 2; i >= 0; i--) path.lineTo(X(i), Z(i));
  }
  path.closePath();
}

function addLine(path, pts) {
  if (!pts || pts.length < 2) return;
  const { n, X, Z } = accessor(pts);
  path.moveTo(X(0), Z(0));
  for (let i = 1; i < n; i++) path.lineTo(X(i), Z(i));
}

/**
 * A vector layer split into square tiles of Path2D, so a view only rasterizes the tiles it overlaps. Every item goes
 * to the tile holding its centre; a tile's bounds grow to cover its items.
 */
class TiledLayer {
  constructor(size = 500) {
    this.size = size;
    this.tiles = new Map();
  }

  pathFor(b) {
    const ix = Math.floor((b.minX + b.maxX) * 0.5 / this.size);
    const iz = Math.floor((b.minZ + b.maxZ) * 0.5 / this.size);
    const key = `${ix},${iz}`;
    let t = this.tiles.get(key);
    if (!t) {
      t = { path: new Path2D(), minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ };
      this.tiles.set(key, t);
    } else {
      t.minX = Math.min(t.minX, b.minX);
      t.maxX = Math.max(t.maxX, b.maxX);
      t.minZ = Math.min(t.minZ, b.minZ);
      t.maxZ = Math.max(t.maxZ, b.maxZ);
    }
    return t.path;
  }

  ring(pts, holes = null) {
    if (!pts || pts.length < 3) return;
    const path = this.pathFor(boundsOf(pts));
    addRing(path, pts);
    if (holes) for (const h of holes) addRing(path, h, true);
  }

  line(pts) {
    if (pts && pts.length > 1) addLine(this.pathFor(boundsOf(pts)), pts);
  }

  rect(x0, z0, x1, z1) {
    this.pathFor({ minX: x0, maxX: x1, minZ: z0, maxZ: z1 }).rect(x0, z0, x1 - x0, z1 - z0);
  }

  /** Calls fn(path) for every tile overlapping the view */
  each(v, fn) {
    for (const t of this.tiles.values()) {
      if (t.maxX < v.minX || t.minX > v.maxX || t.maxZ < v.minZ || t.minZ > v.maxZ) continue;
      fn(t.path);
    }
  }
}

let LAYERS = null;
function mapLayers() {
  if (LAYERS) return LAYERS;
  const L = {};

  // The city's land (the background beyond the city line is land too, so water is drawn on top): the low-detail
  // outskirts out to the boundary and their lakes, the detailed core (roadway colour: the streets are the gaps between
  // the blocks) and its ponds, then the Warta, the Cybina, Malta & the ponds (holes: their islands)
  L.outskirts = new Path2D();
  for (const ring of OUTSKIRTS) addRing(L.outskirts, ring);
  L.outskirtsLakes = new Path2D();
  for (const h of OUTSKIRTS_HOLES) addRing(L.outskirtsLakes, h.ring);
  L.core = new Path2D();
  for (const ring of LAND_RINGS) addRing(L.core, ring);
  for (const h of LAND_HOLES) addRing(L.core, h.ring, true);
  L.water = new Path2D();
  for (const w of WATER) {
    addRing(L.water, w.ring);
    for (const h of w.holes) addRing(L.water, h, true);
  }

  // Parkland, squares & pedestrian areas (holes: the buildings standing on them), the curb islands (blocks: raised
  // sidewalks & lots) and the park blocks, exactly as city-grid.js / buildings.js treat them
  L.parkLand = new TiledLayer();
  for (const park of GEO.parks || []) for (const ring of park.rings || []) L.parkLand.ring(ring);
  L.plazas = new TiledLayer();
  for (const p of PLAZAS) L.plazas.ring(p.ring, p.holes);
  L.blocks = new TiledLayer();
  L.parkBlocks = new TiledLayer();
  for (const b of BLOCKS) (b.park > 0.6 && !b.median ? L.parkBlocks : L.blocks).ring(b.poly);

  // Street network at low zoom: the wide streets, once the gaps between blocks are under a pixel (Poznań's GEO.roads
  // flags no expressway, so there is no separate highway layer)
  L.mainRoads = new TiledLayer(1000);
  for (const r of ROADS) if (r.w >= 15) L.mainRoads.line(r.pts);

  // Tram tracks (street-running and on their own right of way) and the railways
  L.trams = new TiledLayer(1000);
  L.rail = new TiledLayer(1000);
  for (const r of RAIL || []) (r.kind === 'tram' ? L.trams : L.rail).line(r.pts);

  // Landmark lots (real OpenStreetMap outlines)
  L.landmarks = new Path2D();
  for (const name in LANDMARK_SITES) {
    const site = LANDMARK_SITES[name];
    if (site && site.ring) addRing(L.landmarks, site.ring);
  }

  // Bridge decks along their road-graph links, deck width to scale
  L.bridges = [];
  for (const br of BRIDGES) {
    for (const link of br.links) {
      const path = new Path2D();
      addLine(path, link.pts);
      L.bridges.push({ path, width: link.width || 12 });
    }
  }

  LAYERS = L;
  return L;
}

// Building footprints as generated by buildings.js, by height: up to 45 m, 95 m, taller
let FOOTPRINTS = null;
function footprintLayers(all) {
  if (!all || !all.length) return null;
  if (FOOTPRINTS && FOOTPRINTS.src === all && FOOTPRINTS.n === all.length) return FOOTPRINTS;
  const tones = [new TiledLayer(), new TiledLayer(), new TiledLayer()];
  for (const blk of all) {
    for (const f of blk.footprints || []) {
      const layer = tones[f.h > 95 ? 2 : f.h > 45 ? 1 : 0];
      if (f.pts) layer.ring(f.pts); // turned to follow a non-grid street
      else layer.rect(f.x0, f.z0, f.x1, f.z1);
    }
  }
  FOOTPRINTS = { src: all, n: all.length, tones, version: FOOTPRINTS ? FOOTPRINTS.version + 1 : 1 };
  return FOOTPRINTS;
}

// Street name labels: anchors spread by arc length along each real centreline (fixed in the world, so labels never
// slide while the map pans), each at the straightest stretch of its share of the street. OSM centrelines bend through
// many short segments (≈ 38 m on average), so an anchor measures how far the street runs either way before it turns
// more than LABEL_BEND from the direction there; `len` is that straight span, and a name is drawn only where it fits.
const LABEL_SPACING = 260; // metres of street per anchor
const LABEL_BEND = 0.2; // radians (≈ 11°) the street may turn under half a label
const LABEL_REACH = 400; // farthest an anchor looks along the street for a bend, metres
const LABEL_MIN_LEN = 20; // shortest straight span worth an anchor, metres

function angleGap(a, b) {
  let d = Math.abs(a - b) % (2 * Math.PI);
  return d > Math.PI ? 2 * Math.PI - d : d;
}

// The point `at` metres along a polyline with cumulative lengths `cum`, into out (index of its segment in out.i)
function pointAlong(pts, cum, at, out) {
  const n = pts.length;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= at) lo = mid;
    else hi = mid;
  }
  const seg = cum[hi] - cum[lo];
  const t = seg > 0 ? Math.min(1, Math.max(0, (at - cum[lo]) / seg)) : 0;
  out.i = lo;
  out.x = pts[lo].x + (pts[hi].x - pts[lo].x) * t;
  out.z = pts[lo].z + (pts[hi].z - pts[lo].z) * t;
  return out;
}

// The label anchor at `at` metres along the street: { x, z, ang, len } with ang the chord across the straight span
// (kept upright: never upside down, vertical names read upwards)
function labelSpan(pts, cum, at) {
  const n = pts.length;
  const p = pointAlong(pts, cum, at, {});
  let i = p.i;
  while (i < n - 2 && cum[i + 1] - cum[i] < 1e-6) i++;
  const dirOf = (j) => Math.atan2(pts[j + 1].z - pts[j].z, pts[j + 1].x - pts[j].x);
  const dir = dirOf(i);
  let fwd = Math.max(0, cum[i + 1] - at);
  for (let j = i + 1; j < n - 1 && fwd < LABEL_REACH; j++) {
    const len = cum[j + 1] - cum[j];
    if (len < 1e-6) continue;
    if (angleGap(dirOf(j), dir) > LABEL_BEND) break;
    fwd += len;
  }
  let back = Math.max(0, at - cum[i]);
  for (let j = i - 1; j >= 0 && back < LABEL_REACH; j--) {
    const len = cum[j + 1] - cum[j];
    if (len < 1e-6) continue;
    if (angleGap(dirOf(j), dir) > LABEL_BEND) break;
    back += len;
  }
  const half = Math.min(fwd, back, LABEL_REACH);
  let ang = dir;
  if (half > 1) {
    const a = pointAlong(pts, cum, at - half, {});
    const b = pointAlong(pts, cum, at + half, {});
    ang = Math.atan2(b.z - a.z, b.x - a.x);
  }
  if (ang >= Math.PI * 0.5 - 0.01) ang -= Math.PI;
  else if (ang < -Math.PI * 0.5 - 0.01) ang += Math.PI;
  return { x: p.x, z: p.z, ang, len: 2 * half };
}

/**
 * Label anchors along a street ([{x, z}, ...]): one per ~`spacing` metres of its length, each the straightest of a few
 * candidates across its share of the street (the middle one when several fit, so a straight street gets evenly spaced
 * names). Anchors with less than LABEL_MIN_LEN of straight street are dropped. Built once at load.
 */
function roadLabelAnchors(pts, spacing = LABEL_SPACING) {
  const anchors = [];
  const n = pts ? pts.length : 0;
  if (n < 2) return anchors;
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  const total = cum[n - 1];
  if (total < LABEL_MIN_LEN) return anchors;
  const k = Math.max(1, Math.round(total / spacing));
  const share = total / k;
  // an odd number of candidates, ~spacing / 4 apart, so the middle of the share is one of them
  const per = 2 * Math.floor(share / (spacing * 0.25) / 2) + 1;
  for (let b = 0; b < k; b++) {
    const mid = (b + 0.5) * share;
    let best = null;
    let bestScore = -Infinity;
    for (let c = 0; c < per; c++) {
      const at = (b + (c + 0.5) / per) * share;
      const a = labelSpan(pts, cum, at);
      const score = Math.min(a.len, share) - 0.01 * Math.abs(at - mid);
      if (score > bestScore) {
        bestScore = score;
        best = a;
      }
    }
    if (best && best.len >= LABEL_MIN_LEN) anchors.push(best);
  }
  return anchors;
}

/**
 * Joins pieces of one street ([[{x, z}, ...], ...]) into longer polylines: OSM splits a street wherever its width,
 * lanes or direction change (Głogowska is 20 pieces, many of 2-3 points), and a name placed per piece would get only the
 * piece's few metres. Two pieces join where an end of each meets (within 0.5 m) and no third piece ends there, so the
 * carriageways of a dual street and its side branches stay separate. Returns [{ pts, pieces: [indices] }].
 */
function chainRoadPieces(list) {
  const key = (p) => `${Math.round(p.x * 2)},${Math.round(p.z * 2)}`;
  const ends = new Map(); // endpoint -> [piece index, ...] (a closed piece counts twice)
  list.forEach((pts, i) => {
    for (const p of [pts[0], pts[pts.length - 1]]) {
      const k = key(p);
      if (!ends.has(k)) ends.set(k, []);
      ends.get(k).push(i);
    }
  });
  const used = new Uint8Array(list.length);
  // the other piece ending at point p, when exactly two do
  const partner = (p, i) => {
    const at = ends.get(key(p));
    if (!at || at.length !== 2 || at[0] === at[1]) return -1;
    const j = at[0] === i ? at[1] : at[0];
    return used[j] ? -1 : j;
  };
  const chains = [];
  for (let i = 0; i < list.length; i++) {
    if (used[i] || list[i].length < 2) continue;
    used[i] = 1;
    let pts = list[i].slice();
    const pieces = [i];
    for (let grew = true; grew;) {
      grew = false;
      const tail = pts[pts.length - 1];
      let j = partner(tail, pieces[pieces.length - 1]);
      if (j >= 0) {
        const q = list[j];
        const along = key(q[0]) === key(tail) ? q : q.slice().reverse();
        pts = pts.concat(along.slice(1));
        used[j] = 1;
        pieces.push(j);
        grew = true;
      }
      const head = pts[0];
      j = partner(head, pieces[0]);
      if (j >= 0) {
        const q = list[j];
        const along = key(q[q.length - 1]) === key(head) ? q : q.slice().reverse();
        pts = along.slice(0, -1).concat(pts);
        used[j] = 1;
        pieces.unshift(j);
        grew = true;
      }
    }
    chains.push({ pts, pieces });
  }
  return chains;
}

// One label entry per chained stretch of a named street (searchable even where no name fits)
const ROAD_LABELS = [];
{
  const byName = new Map();
  for (const r of ROADS) {
    const text = LABEL_ALIAS[r.name] || r.name;
    if (!text || /^Unnamed/.test(text) || !r.pts || r.pts.length < 2) continue;
    if (!byName.has(r.name)) byName.set(r.name, []);
    byName.get(r.name).push(r);
  }
  for (const [name, roads] of byName) {
    const text = LABEL_ALIAS[name] || name;
    for (const { pts, pieces } of chainRoadPieces(roads.map((r) => r.pts))) {
      ROAD_LABELS.push({
        text,
        lower: foldText(text),
        raw: foldText(name),
        pts,
        major: pieces.some((i) => roads[i].w >= 15),
        anchors: roadLabelAnchors(pts),
        ...boundsOf(pts)
      });
    }
  }
}
const ROAD_NAME_COUNT = new Set(ROAD_LABELS.map((l) => l.text)).size;

// The city out to its boundary (the outskirts and the detailed core): what the full map fits when zoomed out all the way
const CITY_EXTENT = (() => {
  const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const ring of [...(OUTSKIRTS || []), ...(LAND_RINGS || [])]) {
    const r = boundsOf(ring);
    b.minX = Math.min(b.minX, r.minX);
    b.maxX = Math.max(b.maxX, r.maxX);
    b.minZ = Math.min(b.minZ, r.minZ);
    b.maxZ = Math.max(b.maxZ, r.maxZ);
  }
  return b.maxX > b.minX && b.maxZ > b.minZ ? b : null;
})();

/** A map viewport: centre (cx, cz) in world metres, s pixels per metre, w x h CSS pixels on a canvas of pixel ratio dpr */
class MapView {
  constructor(cx, cz, s, w, h, dpr = 1) {
    this.cx = cx;
    this.cz = cz;
    this.s = s;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.minX = cx - w / (2 * s);
    this.maxX = cx + w / (2 * s);
    this.minZ = cz - h / (2 * s);
    this.maxZ = cz + h / (2 * s);
  }

  /** Canvas transform for world metres */
  world(ctx) {
    const { s, dpr } = this;
    ctx.setTransform(s * dpr, 0, 0, s * dpr, dpr * (this.w * 0.5 - this.cx * s), dpr * (this.h * 0.5 - this.cz * s));
  }

  /** Canvas transform for CSS pixels from the canvas centre (what toX / toY return) */
  screen(ctx) {
    ctx.setTransform(this.dpr, 0, 0, this.dpr, this.dpr * this.w * 0.5, this.dpr * this.h * 0.5);
  }

  toX(x) {
    return (x - this.cx) * this.s;
  }

  toY(z) {
    return (z - this.cz) * this.s;
  }

  sees(b) {
    return b && b.maxX >= this.minX && b.minX <= this.maxX && b.maxZ >= this.minZ && b.minZ <= this.maxZ;
  }
}

// Player heading arrow at the (already rotated) origin: white, on a dark halo
function drawPlayerArrow(ctx, tipY, halfWidth, tailY) {
  ctx.beginPath();
  ctx.moveTo(0, tipY);
  ctx.lineTo(halfWidth, tailY);
  ctx.lineTo(0, tailY * 0.45);
  ctx.lineTo(-halfWidth, tailY);
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = MAP.halo;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
}

// ---------------------------------------------------------------------------------------------------------------------
// GPS route: the shortest way along the road graph road-network.js builds for traffic
// ---------------------------------------------------------------------------------------------------------------------

const ROUTE_SNAP = 300; // farthest a route end snaps to the road graph, metres (a few blocks)

/**
 * The road network's { nodes, edges } as a compact undirected adjacency list weighted by length (node positions,
 * since an edge's own `len` runs only between stop lines). One-way streets count both ways: the GPS serves walkers,
 * cyclists and the helicopter as well as the car. Returns null without a usable network.
 */
function buildRouteGraph(network) {
  const nodes = network && network.nodes;
  const edges = network && network.edges;
  if (!nodes || !nodes.length || !edges) return null;
  const n = nodes.length;
  const index = new Map();
  const xs = new Float64Array(n);
  const zs = new Float64Array(n);
  nodes.forEach((node, i) => {
    index.set(node, i);
    xs[i] = node.x;
    zs[i] = node.z;
  });
  const start = new Int32Array(n + 1);
  const pairs = [];
  for (const e of edges) {
    const a = index.get(e.from);
    const b = index.get(e.to);
    if (a === undefined || b === undefined || a === b) continue;
    pairs.push(a, b);
    start[a + 1]++;
    start[b + 1]++;
  }
  for (let i = 0; i < n; i++) start[i + 1] += start[i];
  const to = new Int32Array(start[n]);
  const w = new Float64Array(start[n]);
  const fill = start.slice(0, n);
  for (let k = 0; k < pairs.length; k += 2) {
    const a = pairs[k];
    const b = pairs[k + 1];
    const len = Math.hypot(xs[b] - xs[a], zs[b] - zs[a]);
    to[fill[a]] = b;
    w[fill[a]++] = len;
    to[fill[b]] = a;
    w[fill[b]++] = len;
  }
  return { n, xs, zs, start, to, w };
}

/**
 * Index of the graph node nearest (x, z), or -1 when none is within maxDist (a linear scan over the road graph's nodes,
 * 2 µs in Node: callers run it only when the point has moved)
 */
function nearestNode(graph, x, z, maxDist = Infinity) {
  if (!graph) return -1;
  let best = -1;
  let bestD = maxDist * maxDist;
  for (let i = 0; i < graph.n; i++) {
    const dx = graph.xs[i] - x;
    const dz = graph.zs[i] - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * Dijkstra from `goal` over the whole graph: for every node, the next node on its shortest way to the goal. Computed
 * once per destination, so the route from wherever the player gets to is a walk along `next`.
 */
function routeTree(graph, goal) {
  const n = graph.n;
  const dist = new Float64Array(n).fill(Infinity);
  const next = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  // binary min-heap of (distance, node) with lazy deletion: stale entries are skipped when popped
  const heapD = [];
  const heapN = [];
  const push = (d, v) => {
    let i = heapD.length;
    heapD.push(d);
    heapN.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapD[p] <= d) break;
      heapD[i] = heapD[p];
      heapN[i] = heapN[p];
      i = p;
    }
    heapD[i] = d;
    heapN[i] = v;
  };
  const pop = () => {
    const v = heapN[0];
    const lastD = heapD.pop();
    const lastN = heapN.pop();
    const m = heapD.length;
    if (m) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= m) break;
        if (c + 1 < m && heapD[c + 1] < heapD[c]) c++;
        if (heapD[c] >= lastD) break;
        heapD[i] = heapD[c];
        heapN[i] = heapN[c];
        i = c;
      }
      heapD[i] = lastD;
      heapN[i] = lastN;
    }
    return v;
  };
  if (goal >= 0 && goal < n) {
    dist[goal] = 0;
    push(0, goal);
  }
  while (heapD.length) {
    const u = pop();
    if (done[u]) continue;
    done[u] = 1;
    for (let k = graph.start[u]; k < graph.start[u + 1]; k++) {
      const v = graph.to[k];
      const d = dist[u] + graph.w[k];
      if (d < dist[v]) {
        dist[v] = d;
        next[v] = u;
        push(d, v);
      }
    }
  }
  return { goal, dist, next };
}

/** Node indices from `start` to the tree's goal into `out` (emptied first; left empty when there is no way there) */
function routePath(tree, start, out) {
  out.length = 0;
  if (!tree || start < 0 || start >= tree.dist.length || tree.dist[start] === Infinity) return out;
  for (let i = start; i >= 0 && out.length <= tree.dist.length; i = tree.next[i]) out.push(i);
  return out;
}

// GPS route from the player to the waypoint through the route's graph nodes (straight across without any): yellow
// on a dark casing
function drawRoute(ctx, v, px, pz, wx, wz, graph, nodes, width) {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(v.toX(px), v.toY(pz));
  if (graph) for (const i of nodes) ctx.lineTo(v.toX(graph.xs[i]), v.toY(graph.zs[i]));
  ctx.lineTo(v.toX(wx), v.toY(wz));
  ctx.strokeStyle = MAP.halo;
  ctx.lineWidth = width + 3;
  ctx.stroke();
  ctx.strokeStyle = MAP.route;
  ctx.lineWidth = width;
  ctx.stroke();
}

// Waypoint: a yellow target
function drawWaypoint(ctx, x, y, r) {
  ctx.fillStyle = MAP.halo;
  ctx.beginPath();
  ctx.arc(x, y, r + 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = MAP.route;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = MAP.halo;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.38, 0, Math.PI * 2);
  ctx.fill();
}

const overlaps = (boxes, b) => boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);

class CityMapSystem {
  constructor({ controllerManager, cameraSystem, trafficSystem, trams = null, network = null, allBlocks = [], onTeleport, onToggle }) {
    this.controllerManager = controllerManager;
    this.cameraSystem = cameraSystem;
    this.trafficSystem = trafficSystem;
    this.trams = trams; // trams.js active trams (kept apart from the cars & buses)
    this.network = network; // road-network.js graph, for the GPS route
    this.allBlocks = allBlocks;
    this.onTeleport = onTeleport;
    this.onToggle = onToggle;

    this.miniCanvas = document.getElementById('minimap-canvas');
    this.miniCtx = this.miniCanvas ? this.miniCanvas.getContext('2d') : null;
    this.miniScale = RADAR_SCALE;
    this.miniCache = null; // { canvas, cx, cz, s, version }: the radar's ground layers, twice the radar's size
    const elCounts = document.getElementById('fullmap-counts');
    if (elCounts) elCounts.textContent = `${ROAD_NAME_COUNT} streets · ${formatCount(BLOCKS.length)} blocks`;
    // The legend's bridge, tram & rail swatches take their colours from the palette the map draws them with
    const elLegend = document.getElementById('fullmap-legend');
    if (elLegend) {
      elLegend.style.setProperty('--map-bridge', MAP.bridge);
      elLegend.style.setProperty('--map-tram', MAP.tram);
      elLegend.style.setProperty('--map-rail', MAP.rail);
    }

    // The map is drawn grid north up; the compass needle points to true north, the grid's bearing to its left
    const needle = document.getElementById('map-compass-needle');
    if (needle) needle.setAttribute('transform', `rotate(${-GRID_BEARING} 22 22)`);
    const compass = document.getElementById('map-compass');
    if (compass) compass.title = compassTitle(GRID_BEARING);

    this.modal = document.getElementById('fullmap-modal');
    this.fullCanvas = document.getElementById('fullmap-canvas');
    this.fullCanvasWrap = document.getElementById('fullmap-canvas-wrap');
    this.fullCtx = this.fullCanvas ? this.fullCanvas.getContext('2d') : null;
    this.fullDpr = 1;
    this.fullStatic = null; // the full map's ground layers & labels for the current view
    this.fullStaticKey = '';
    this.elHoverInfo = document.getElementById('fullmap-hover-info');
    this.elPlayerInfo = document.getElementById('fullmap-player-info');
    this.elSearchInput = document.getElementById('fullmap-search');
    if (this.elSearchInput) this.elSearchInput.placeholder = 'Św. Marcin, Głogowska, Stary Rynek…';

    this.isFullMapOpen = false;
    // Full map viewport state (world metres; zoom in CSS pixels per metre)
    this.viewCenterX = 0;
    this.viewCenterZ = 0;
    this.viewZoom = 0.22;
    this.isPanning = false;
    this.panPointerId = null;
    this.panStart = { x: 0, y: 0, cx: 0, cz: 0 };
    this.dragMoved = false;

    this.hoverWorld = null;
    this.searchHighlight = '';
    this.searchPath = null;
    this.textWidths = new Map();
    // Default GPS waypoint: the Ratusz on Stary Rynek (the world origin)
    const ratusz = CITY_LANDMARKS.find((l) => l.id === 'ratusz') || { x: 0, z: 0, name: 'Ratusz & Stary Rynek' };
    this.waypoint = { x: ratusz.x, z: ratusz.z, name: ratusz.name };
    // GPS route state (updateRoute): the graph (built on first use), the shortest-path tree towards the waypoint's
    // node, and the node path from the player's node, recomputed only when one of those nodes changes
    this.routeGraph = undefined;
    this.routeTree = null;
    this.routeNodes = [];
    this.routeStart = -1;
    this.routeFrom = { x: NaN, z: NaN };
    this.routeTo = { x: NaN, z: NaN };

    // Street names measured before the web font arrived would be spaced for the fallback font: measure & draw again
    if (document.fonts) {
      document.fonts.ready.then(() => {
        this.textWidths.clear();
        this.miniCache = null;
        this.fullStaticKey = '';
      });
    }

    this.initEvents();
  }

  initEvents() {
    const closeBtn = document.getElementById('close-fullmap-btn');
    const miniCard = document.getElementById('minimap-card');
    const zoomInBtn = document.getElementById('map-zoom-in');
    const zoomOutBtn = document.getElementById('map-zoom-out');
    const centerPlayerBtn = document.getElementById('map-center-player');
    const viewAllBtn = document.getElementById('map-view-all');

    if (miniCard) {
      miniCard.addEventListener('click', () => this.toggleFullMap(true));
    }
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.toggleFullMap(false));
    }

    if (zoomInBtn) {
      zoomInBtn.addEventListener('click', () => {
        this.viewZoom = Math.min(MAX_ZOOM, this.viewZoom * 1.45);
        this.renderFullMap();
      });
    }
    if (zoomOutBtn) {
      zoomOutBtn.addEventListener('click', () => {
        this.viewZoom = Math.max(this.minZoom(), this.viewZoom / 1.45);
        this.renderFullMap();
      });
    }
    if (centerPlayerBtn) {
      centerPlayerBtn.addEventListener('click', () => {
        const ent = this.controllerManager.getActiveEntity();
        this.viewCenterX = ent.position.x;
        this.viewCenterZ = ent.position.z;
        this.viewZoom = 0.9; // Street-by-street detail zoom
        this.renderFullMap();
      });
    }
    if (viewAllBtn) {
      viewAllBtn.addEventListener('click', () => {
        // Fits the detail box (GEO.frame.detailBox), Jeżyce to Malta; the outskirts stay in view around it
        const b = CITY_BOUNDS;
        const { w, h } = this.fullSize();
        this.viewCenterX = (b.minX + b.maxX) * 0.5;
        this.viewCenterZ = (b.minZ + b.maxZ) * 0.5;
        this.viewZoom = Math.max(this.minZoom(), Math.min(w / ((b.maxX - b.minX) * 1.15), h / ((b.maxZ - b.minZ) * 1.06)));
        this.renderFullMap();
      });
    }

    if (this.elSearchInput) {
      this.elSearchInput.addEventListener('input', () => this.search(this.elSearchInput.value));
    }

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.isFullMapOpen) {
        this.toggleFullMap(false);
      } else if (e.code === 'KeyM' && !isTypingInField(e)) {
        this.toggleFullMap(!this.isFullMapOpen);
      }
    });

    if (this.fullCanvas) {
      this.fullCanvas.style.touchAction = 'none';
      this.fullCanvas.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || !this.isFullMapOpen || this.panPointerId !== null) return;
        e.preventDefault();
        this.panPointerId = e.pointerId;
        this.fullCanvas.setPointerCapture(e.pointerId);
        this.isPanning = true;
        this.dragMoved = false;
        this.panStart.x = e.clientX;
        this.panStart.y = e.clientY;
        this.panStart.cx = this.viewCenterX;
        this.panStart.cz = this.viewCenterZ;
        if (this.fullCanvasWrap) this.fullCanvasWrap.classList.add('is-panning');
      });

      this.fullCanvas.addEventListener('pointermove', (e) => {
        if (!this.isFullMapOpen || !this.fullCanvas) return;
        if (this.isPanning ? e.pointerId !== this.panPointerId : e.pointerType !== 'mouse') return;
        const rect = this.fullCanvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        if (this.isPanning) {
          e.preventDefault();
          const dx = e.clientX - this.panStart.x;
          const dy = e.clientY - this.panStart.y;
          if (Math.hypot(dx, dy) > 5) this.dragMoved = true;
          this.viewCenterX = this.panStart.cx - dx / this.viewZoom;
          this.viewCenterZ = this.panStart.cz - dy / this.viewZoom;
          this.renderFullMap();
          return;
        }

        if (mx >= 0 && mx <= rect.width && my >= 0 && my <= rect.height) {
          const wPos = this.screenToWorld(mx, my, rect.width, rect.height);
          this.hoverWorld = wPos;
          if (this.elHoverInfo) {
            this.elHoverInfo.textContent = `${getLocationLabel(wPos.x, wPos.z)} · Click to teleport here`;
          }
        }
      });

      this.fullCanvas.addEventListener('pointerup', (e) => {
        if (e.pointerId !== this.panPointerId) return;
        const clicked = !this.dragMoved && Math.hypot(e.clientX - this.panStart.x, e.clientY - this.panStart.y) <= 5;
        this.cancelPan();
        if (clicked && this.isFullMapOpen && this.fullCanvas) {
          const rect = this.fullCanvas.getBoundingClientRect();
          const mx = e.clientX - rect.left;
          const my = e.clientY - rect.top;
          if (mx >= 0 && mx <= rect.width && my >= 0 && my <= rect.height) {
            // teleports land on the detailed core's land, 12 m clear of the water
            const p = this.screenToWorld(mx, my, rect.width, rect.height);
            const wPos = clampToLand(p.x, p.z, 12);
            this.waypoint = {
              x: wPos.x,
              z: wPos.z,
              name: getLocationLabel(wPos.x, wPos.z)
            };
            if (this.onTeleport) {
              this.onTeleport(wPos.x, wPos.z);
            }
            this.renderFullMap();
          }
        }
      });
      for (const type of ['pointercancel', 'lostpointercapture']) {
        this.fullCanvas.addEventListener(type, (e) => {
          if (e.pointerId === this.panPointerId) this.cancelPan();
        });
      }
      window.addEventListener('blur', () => this.cancelPan());
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.cancelPan();
      });

      // Wheel zoom about the cursor (the place under it stays put)
      this.fullCanvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const rect = this.fullCanvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const before = this.screenToWorld(mx, my, rect.width, rect.height);
        const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
        this.viewZoom = Math.max(this.minZoom(), Math.min(MAX_ZOOM, this.viewZoom * factor));
        this.viewCenterX = before.x - (mx - rect.width * 0.5) / this.viewZoom;
        this.viewCenterZ = before.z - (my - rect.height * 0.5) / this.viewZoom;
        this.renderFullMap();
      }, { passive: false });
    }
  }

  /**
   * Street / landmark search: highlights every stretch of the matching streets and frames them (or flies to the
   * matching landmark)
   */
  search(text) {
    const q = foldText(String(text || '').trim());
    this.searchHighlight = q;
    this.searchPath = null;
    if (q.length > 0) {
      const lmMatch = CITY_LANDMARKS.find((l) => foldText(l.name).includes(q) || foldText(l.short).includes(q));
      const roads = ROAD_LABELS.filter((l) => l.lower.includes(q) || l.raw.includes(q));
      if (roads.length) {
        this.searchPath = new Path2D();
        const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
        for (const l of roads) {
          addLine(this.searchPath, l.pts);
          b.minX = Math.min(b.minX, l.minX);
          b.maxX = Math.max(b.maxX, l.maxX);
          b.minZ = Math.min(b.minZ, l.minZ);
          b.maxZ = Math.max(b.maxZ, l.maxZ);
        }
        this.searchBounds = b;
      }
      if (lmMatch) {
        this.viewCenterX = lmMatch.x;
        this.viewCenterZ = lmMatch.z;
        this.viewZoom = Math.max(this.viewZoom, 0.9);
      } else if (roads.length) {
        const b = this.searchBounds;
        const { w, h } = this.fullSize();
        this.viewCenterX = (b.minX + b.maxX) * 0.5;
        this.viewCenterZ = (b.minZ + b.maxZ) * 0.5;
        const fit = Math.min(w / ((b.maxX - b.minX) * 1.3 + 1), h / ((b.maxZ - b.minZ) * 1.3 + 1));
        this.viewZoom = Math.max(0.05, Math.min(1.2, fit));
      }
    }
    this.renderFullMap();
  }

  cancelPan() {
    const id = this.panPointerId;
    this.panPointerId = null;
    this.isPanning = false;
    if (this.fullCanvasWrap) this.fullCanvasWrap.classList.remove('is-panning');
    if (id !== null && this.fullCanvas && this.fullCanvas.hasPointerCapture(id)) this.fullCanvas.releasePointerCapture(id);
  }

  toggleFullMap(open) {
    this.isFullMapOpen = Boolean(open);
    if (!this.isFullMapOpen) this.cancelPan();
    if (this.onToggle) this.onToggle(this.isFullMapOpen);
    if (!this.modal) return;
    this.modal.classList.toggle('hidden', !this.isFullMapOpen);
    if (this.isFullMapOpen) {
      // the HUD's popovers live in the top layer, above the map
      for (const pop of document.querySelectorAll('.popover[popover]')) {
        if (typeof pop.hidePopover === 'function' && pop.matches(':popover-open')) pop.hidePopover();
      }
      const ent = this.controllerManager.getActiveEntity();
      this.viewCenterX = ent.position.x;
      this.viewCenterZ = ent.position.z;
      this.resizeFullCanvas();
      this.renderFullMap();
    }
  }

  resizeFullCanvas() {
    if (!this.fullCanvas) return;
    // Layout size (the opening animation's transforms don't change it), at most ~6 megapixels however large the screen
    const w = this.fullCanvas.clientWidth || window.innerWidth;
    const h = this.fullCanvas.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(6e6 / Math.max(1, w * h)));
    this.fullDpr = dpr;
    this.fullCanvas.width = Math.max(1, Math.floor(w * dpr));
    this.fullCanvas.height = Math.max(1, Math.floor(h * dpr));
  }

  // Full map size in CSS pixels
  fullSize() {
    const dpr = this.fullDpr || 1;
    if (!this.fullCanvas) return { w: 1200, h: 800 };
    return { w: this.fullCanvas.width / dpr, h: this.fullCanvas.height / dpr };
  }

  /** The farthest the full map zooms out: the whole city out to its boundary, with a small margin */
  minZoom() {
    const b = CITY_EXTENT;
    if (!b) return MIN_ZOOM;
    const { w, h } = this.fullSize();
    const fit = Math.min(w / ((b.maxX - b.minX) * 1.04), h / ((b.maxZ - b.minZ) * 1.04));
    return Number.isFinite(fit) && fit > 0 ? Math.min(fit, MAX_ZOOM) : MIN_ZOOM;
  }

  screenToWorld(sx, sy, width, height) {
    return {
      x: this.viewCenterX + (sx - width * 0.5) / this.viewZoom,
      z: this.viewCenterZ + (sy - height * 0.5) / this.viewZoom
    };
  }

  textWidth(ctx, text) {
    const key = `${ctx.font}|${ctx.letterSpacing || ''}|${text}`;
    let w = this.textWidths.get(key);
    if (w === undefined) {
      w = ctx.measureText(text).width;
      this.textWidths.set(key, w);
    }
    return w;
  }

  /**
   * The ground: land & water, parkland, squares, blocks, building footprints, landmark lots, the main streets at low
   * zoom, the railways, bridges, tram lines and the search highlight (world transform of view v)
   */
  drawWorld(ctx, v, isMinimap) {
    const L = mapLayers();
    const s = v.s;
    const px = (n) => n / s; // screen pixels -> metres (line widths)
    v.world(ctx);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // 1. The outskirts (outlined along the city line) & their lakes, the detailed core & its ponds, then the water
    // (outlined along the shore)
    ctx.fillStyle = MAP.land;
    ctx.fill(L.outskirts);
    if (!isMinimap) {
      ctx.lineWidth = px(1.4);
      ctx.strokeStyle = MAP.landEdge;
      ctx.stroke(L.outskirts);
    }
    ctx.fillStyle = MAP.water;
    ctx.fill(L.outskirtsLakes);
    ctx.fillStyle = MAP.streets;
    ctx.fill(L.core);
    ctx.fillStyle = MAP.water;
    ctx.fill(L.water);
    ctx.strokeStyle = MAP.shore;
    ctx.lineWidth = px(isMinimap ? 1.2 : 1.4);
    ctx.stroke(L.water);

    // 2. Parkland, squares, blocks (curb islands) and park blocks
    ctx.fillStyle = MAP.park;
    L.parkLand.each(v, (p) => ctx.fill(p));
    ctx.fillStyle = MAP.plaza;
    L.plazas.each(v, (p) => ctx.fill(p));
    ctx.fillStyle = MAP.block;
    L.blocks.each(v, (p) => ctx.fill(p));
    if (s >= 0.22) {
      ctx.strokeStyle = MAP.blockEdge;
      ctx.lineWidth = px(Math.min(1.2, 0.5 + s));
      L.blocks.each(v, (p) => ctx.stroke(p));
    }
    ctx.fillStyle = MAP.park;
    L.parkBlocks.each(v, (p) => ctx.fill(p));
    if (s >= 0.1) {
      ctx.strokeStyle = MAP.parkEdge;
      ctx.lineWidth = px(1);
      L.parkBlocks.each(v, (p) => ctx.stroke(p));
    }

    // 3. Building footprints, lowest first
    if (s >= 0.18) {
      const fp = footprintLayers(this.allBlocks);
      if (fp) {
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = MAP.buildings[i];
          fp.tones[i].each(v, (p) => ctx.fill(p));
        }
        if (s >= 0.6) {
          ctx.strokeStyle = MAP.buildingEdge;
          ctx.lineWidth = px(0.8);
          for (let i = 0; i < 3; i++) fp.tones[i].each(v, (p) => ctx.stroke(p));
        }
      }
    }

    // 4. Landmark lots (real OpenStreetMap outlines)
    if (s >= 0.05) {
      ctx.fillStyle = MAP.block;
      ctx.fill(L.landmarks);
      ctx.fillStyle = MAP.landmarkFill;
      ctx.fill(L.landmarks);
      ctx.strokeStyle = MAP.landmarkEdge;
      ctx.lineWidth = px(Math.max(0.9, Math.min(1.6, 1.4 * s)));
      ctx.stroke(L.landmarks);
    }

    // 5. Main streets as lines at low zoom
    if (s < 0.16) {
      ctx.strokeStyle = MAP.mainRoads;
      ctx.lineWidth = px(s < 0.05 ? 0.7 : 1.1);
      L.mainRoads.each(v, (p) => ctx.stroke(p));
    }

    // 6. Railways (dashed grey)
    if (s >= 0.035) {
      ctx.strokeStyle = MAP.rail;
      ctx.lineWidth = px(s < 0.1 ? 1 : 1.4);
      ctx.lineCap = 'butt';
      ctx.setLineDash([px(6), px(4)]);
      L.rail.each(v, (p) => ctx.stroke(p));
      ctx.setLineDash([]);
      ctx.lineCap = 'round';
    }

    // 7. Bridge decks over the water
    ctx.strokeStyle = MAP.bridge;
    ctx.lineCap = 'butt';
    for (const br of L.bridges) {
      ctx.lineWidth = Math.max(px(2), br.width);
      ctx.stroke(br.path);
    }
    ctx.lineCap = 'round';

    // 8. Tram lines: thin red, over the streets and the bridges they cross (a track pair reads as one line)
    ctx.strokeStyle = MAP.tram;
    ctx.lineWidth = px(Math.min(2.4, Math.max(isMinimap ? 1.4 : 0.9, 1.2 * s)));
    L.trams.each(v, (p) => ctx.stroke(p));

    // 9. Search highlight: every stretch of the matching streets
    if (this.searchPath && !isMinimap) {
      ctx.strokeStyle = MAP.search;
      ctx.lineWidth = Math.max(px(3), 9);
      ctx.stroke(this.searchPath);
    }
  }

  /**
   * Street names along the streets (screen transform of view v): the best anchor of each street that fits its name,
   * one label per street per `sameNameGap` pixels, none overlapping another (or the boxes already in `placed`)
   */
  drawRoadLabels(ctx, v, { fontPx = 10, maxLabels = 400, sameNameGap = 260, placed = [], majorOnly = false } = {}) {
    const s = v.s;
    const q = this.searchHighlight;
    ctx.font = `600 ${fontPx}px ${FONT}`;
    const inset = (fontPx * 2.5) / s;
    const minX = v.minX + inset;
    const maxX = v.maxX - inset;
    const minZ = v.minZ + inset;
    const maxZ = v.maxZ - inset;
    const cands = [];
    for (const l of ROAD_LABELS) {
      if (l.maxX < minX || l.minX > maxX || l.maxZ < minZ || l.minZ > maxZ) continue;
      const hit = q.length > 0 && (l.lower.includes(q) || l.raw.includes(q));
      if (majorOnly && !l.major && !hit) continue;
      const width = this.textWidth(ctx, l.text);
      const need = (width + 14) / s;
      for (const a of l.anchors) {
        if (a.len < need || a.x < minX || a.x > maxX || a.z < minZ || a.z > maxZ) continue;
        const d = Math.hypot(a.x - v.cx, a.z - v.cz) * s;
        cands.push({ l, a, width, hit, score: (hit ? 1e6 : 0) + (l.major ? 2000 : 0) + Math.min(a.len * s, 400) - d * 0.5 });
      }
    }
    cands.sort((a, b) => b.score - a.score);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = MAP.halo;
    const byName = new Map();
    let n = 0;
    for (const c of cands) {
      if (n >= maxLabels) break;
      const X = v.toX(c.a.x);
      const Y = v.toY(c.a.z);
      const same = byName.get(c.l.text);
      if (same && same.some(([x, y]) => Math.hypot(x - X, y - Y) < sameNameGap)) continue;
      const hw = c.width * 0.5 + 3;
      const hh = fontPx * 0.5 + 2;
      const ca = Math.abs(Math.cos(c.a.ang));
      const sa = Math.abs(Math.sin(c.a.ang));
      const bx = hw * ca + hh * sa;
      const by = hw * sa + hh * ca;
      const box = [X - bx, Y - by, X + bx, Y + by];
      if (overlaps(placed, box)) continue;
      placed.push(box);
      if (same) same.push([X, Y]);
      else byName.set(c.l.text, [[X, Y]]);
      ctx.save();
      ctx.translate(X, Y);
      ctx.rotate(c.a.ang);
      ctx.fillStyle = c.hit ? MAP.search : c.l.major ? '#e8ebf0' : '#9ba5b3';
      ctx.strokeText(c.l.text, 0, 0);
      ctx.fillText(c.l.text, 0, 0);
      ctx.restore();
      n++;
    }
    ctx.textBaseline = 'alphabetic';
  }

  /**
   * Brings the GPS route up to date for a player at (px, pz): a new shortest-path tree when the waypoint moves to
   * another node, a new path when the player reaches another node. Snapping waits for 8 m of movement, so a frame
   * normally costs two comparisons. Either end farther than ROUTE_SNAP from the road graph (out over the water, in
   * the outskirts) leaves the path empty, and the route is drawn straight to the waypoint.
   */
  updateRoute(px, pz) {
    const wp = this.waypoint;
    if (!wp) return;
    if (this.routeGraph === undefined) this.routeGraph = buildRouteGraph(this.network);
    const graph = this.routeGraph;
    if (!graph) return;
    let changed = false;
    if (wp.x !== this.routeTo.x || wp.z !== this.routeTo.z) {
      this.routeTo.x = wp.x;
      this.routeTo.z = wp.z;
      const goal = nearestNode(graph, wp.x, wp.z, ROUTE_SNAP);
      if (!this.routeTree || this.routeTree.goal !== goal) {
        this.routeTree = routeTree(graph, goal);
        changed = true;
      }
    }
    const from = this.routeFrom;
    if (changed || Number.isNaN(from.x) || Math.abs(px - from.x) > 8 || Math.abs(pz - from.z) > 8) {
      from.x = px;
      from.z = pz;
      const start = nearestNode(graph, px, pz, ROUTE_SNAP);
      if (changed || start !== this.routeStart) {
        this.routeStart = start;
        routePath(this.routeTree, start, this.routeNodes);
      }
    }
  }

  update() {
    // The full map covers the whole screen, radar included
    if (this.isFullMapOpen) {
      this.renderFullMap();
    } else {
      this.renderMinimap();
    }
  }

  // =========================================================================
  // 1. GTA 6-STYLE LIVE RADAR MINIMAP (BOTTOM-LEFT HUD)
  // =========================================================================
  renderMinimap() {
    if (!this.miniCtx || !this.miniCanvas) return;
    // Nothing to draw while the radar is hidden (narrow screens, clean view)
    if (!this.miniCanvas.offsetParent || document.body.classList.contains('hud-minimized')) return;
    const ctx = this.miniCtx;
    // Radar size in CSS pixels, backed at the device pixel ratio (crisp street names on HiDPI screens)
    const w = this.miniCanvas.clientWidth;
    const h = this.miniCanvas.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    if (this.miniCanvas.width !== bw || this.miniCanvas.height !== bh) {
      this.miniCanvas.width = bw;
      this.miniCanvas.height = bh;
      this.miniCache = null;
    }

    const ent = this.controllerManager.getActiveEntity();
    const px = ent.position.x;
    const pz = ent.position.z;
    // Ground-level radar shows ~800 m of the city; it zooms out as the camera climbs (helicopter)
    const target = Math.max(0.05, RADAR_SCALE / (1 + Math.max(0, ent.position.y - 25) / 180));
    this.miniScale += (target - this.miniScale) * 0.08;
    const scale = this.miniScale;

    // Ground layers & street names come from a cached render twice the radar's size, redrawn when the player nears its
    // edge or the zoom drifts (or the buildings arrive)
    const fp = footprintLayers(this.allBlocks);
    const version = fp ? fp.version : 0;
    let c = this.miniCache;
    if (!c || c.version !== version || Math.abs(scale / c.s - 1) > 0.12 ||
      Math.abs(px - c.cx) > w / c.s - w / (2 * scale) - 8 / scale ||
      Math.abs(pz - c.cz) > h / c.s - h / (2 * scale) - 8 / scale) {
      if (!c) {
        c = this.miniCache = { canvas: document.createElement('canvas') };
        c.canvas.width = bw * 2;
        c.canvas.height = bh * 2;
        c.ctx = c.canvas.getContext('2d');
      }
      c.cx = px;
      c.cz = pz;
      c.s = scale;
      c.version = version;
      c.ctx.setTransform(1, 0, 0, 1, 0, 0);
      c.ctx.fillStyle = MAP.beyond;
      c.ctx.fillRect(0, 0, bw * 2, bh * 2);
      const cv = new MapView(px, pz, scale, w * 2, h * 2, dpr);
      this.drawWorld(c.ctx, cv, true);
      cv.screen(c.ctx);
      this.drawRoadLabels(c.ctx, cv, { fontPx: 9.5, maxLabels: 28, sameNameGap: 180 });
    }

    const v = new MapView(px, pz, scale, w, h, dpr);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = MAP.beyond;
    ctx.fillRect(0, 0, bw, bh);
    const k = scale / c.s;
    ctx.drawImage(c.canvas, dpr * ((c.cx - w / c.s - px) * scale + w * 0.5), dpr * ((c.cz - h / c.s - pz) * scale + h * 0.5),
      dpr * w * 2 * k, dpr * h * 2 * k);

    v.screen(ctx);
    const toX = (wx) => v.toX(wx);
    const toY = (wz) => v.toY(wz);

    // Live moving traffic blips on radar
    if (this.trafficSystem && this.trafficSystem.cars) {
      ctx.fillStyle = 'rgba(226, 232, 240, 0.34)';
      for (let i = 0; i < this.trafficSystem.cars.length; i += 2) {
        const car = this.trafficSystem.cars[i];
        const cx = toX(car.x);
        const cy = toY(car.z);
        if (Math.abs(cx) < w * 0.5 && Math.abs(cy) < h * 0.5) {
          ctx.fillRect(cx - 1, cy - 1, 2, 2);
        }
      }
    }

    // Trams: each section as a short yellow bar, so a tram reads as a 32 m bendy line
    if (this.trams && this.trams.length) {
      ctx.strokeStyle = 'rgba(243, 195, 22, 0.9)';
      ctx.lineWidth = Math.max(2, 2.4 * scale);
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (const tram of this.trams) {
        const tx = toX(tram.x);
        const ty = toY(tram.z);
        if (Math.abs(tx) > w * 0.5 + 30 || Math.abs(ty) > h * 0.5 + 30) continue;
        for (const s of tram.sections) {
          ctx.moveTo(toX(s.fx), toY(s.fz));
          ctx.lineTo(toX(s.rx), toY(s.rz));
        }
      }
      ctx.stroke();
    }

    // GPS route to the active waypoint
    if (this.waypoint) {
      const wx = toX(this.waypoint.x);
      const wy = toY(this.waypoint.z);
      this.updateRoute(px, pz);
      drawRoute(ctx, v, px, pz, this.waypoint.x, this.waypoint.z, this.routeGraph, this.routeNodes, 3);
      drawWaypoint(ctx, wx, wy, 4.5);
    }

    // Landmark blips
    for (const lm of CITY_LANDMARKS) {
      const lx = toX(lm.x);
      const ly = toY(lm.z);
      if (Math.abs(lx) < w * 0.48 && Math.abs(ly) < h * 0.48) {
        ctx.fillStyle = MAP.halo;
        ctx.beginPath();
        ctx.arc(lx, ly, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(lx, ly, 2.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Camera FOV Cone & Player Arrow at center (0, 0)
    const camDir = this.cameraSystem.currentLookAt.clone().sub(this.cameraSystem.currentPos);
    const camAngle = Math.atan2(camDir.x, camDir.z);

    ctx.save();
    ctx.rotate(-camAngle + Math.PI);
    const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, 58);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 58, -Math.PI * 0.72, -Math.PI * 0.28);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Player heading arrow
    ctx.save();
    ctx.rotate(-ent.heading + Math.PI);
    drawPlayerArrow(ctx, -9, 6.5, 7);
    ctx.restore();

    ctx.restore();
  }

  // =========================================================================
  // 2. FULL POZNAŃ INTERACTIVE STREET MAP MODAL ([M])
  // =========================================================================
  renderFullMap() {
    if (!this.fullCtx || !this.fullCanvas || !this.isFullMapOpen) return;
    const ctx = this.fullCtx;
    const dpr = this.fullDpr || 1;
    const { w, h } = this.fullSize();
    const v = new MapView(this.viewCenterX, this.viewCenterZ, this.viewZoom, w, h, dpr);

    const ent = this.controllerManager.getActiveEntity();
    if (this.elPlayerInfo) {
      const text = `You are at ${getLocationLabel(ent.position.x, ent.position.z)}`;
      if (text !== this.playerInfoText) {
        this.playerInfoText = text;
        this.elPlayerInfo.textContent = text;
      }
    }

    // Ground layers, names & landmark pins: re-rendered only when the view, the search or the buildings change
    const fp = footprintLayers(this.allBlocks);
    const key = `${v.cx}|${v.cz}|${v.s}|${this.fullCanvas.width}|${this.fullCanvas.height}|${this.searchHighlight}|${fp ? fp.version : 0}`;
    if (!this.fullStatic) this.fullStatic = document.createElement('canvas');
    if (key !== this.fullStaticKey) {
      this.fullStaticKey = key;
      const sc = this.fullStatic;
      if (sc.width !== this.fullCanvas.width || sc.height !== this.fullCanvas.height) {
        sc.width = this.fullCanvas.width;
        sc.height = this.fullCanvas.height;
      }
      this.renderFullMapStatic(sc.getContext('2d'), v);
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.fullStatic, 0, 0);
    v.screen(ctx);
    const toX = (wx) => v.toX(wx);
    const toY = (wz) => v.toY(wz);

    // GPS route on the full map
    if (this.waypoint) {
      const wx = toX(this.waypoint.x);
      const wy = toY(this.waypoint.z);
      this.updateRoute(ent.position.x, ent.position.z);
      drawRoute(ctx, v, ent.position.x, ent.position.z, this.waypoint.x, this.waypoint.z, this.routeGraph, this.routeNodes, 4);
      drawWaypoint(ctx, wx, wy, 7);
    }

    // Live Player Blip & Heading Arrow, with a slow pulse to find it at a glance
    const px = toX(ent.position.x);
    const py = toY(ent.position.z);

    ctx.save();
    ctx.translate(px, py);
    const pulse = (performance.now() % 1800) / 1800;
    ctx.fillStyle = `rgba(255, 255, 255, ${0.24 * (1 - pulse)})`;
    ctx.beginPath();
    ctx.arc(0, 0, 10 + pulse * 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.beginPath();
    ctx.arc(0, 0, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate(-ent.heading + Math.PI);
    drawPlayerArrow(ctx, -11, 7.5, 8);
    ctx.restore();

    ctx.restore();
  }

  renderFullMapStatic(ctx, v) {
    const { w, h, s } = v;
    ctx.save();
    // 1. Land base (the country past the city line): the water is drawn on top of it
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = MAP.beyond;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // 2. The ground: outskirts, the core's blocks, water, parks, footprints, rail, bridges & trams
    this.drawWorld(ctx, v, false);

    v.screen(ctx);
    const toX = (wx) => v.toX(wx);
    const toY = (wz) => v.toY(wz);

    // 3. Iconic Landmark Pins & Collision-Free Labels (placed first: their boxes keep the other names clear)
    ctx.font = `700 11px ${FONT}`;
    const placed = [];
    const pins = [];
    for (const lm of CITY_LANDMARKS) {
      const lx = toX(lm.x);
      const ly = toY(lm.z);
      if (Math.abs(lx) > w * 0.48 || Math.abs(ly) > h * 0.48) continue;
      const labelW = this.textWidth(ctx, lm.short) + 6;
      const box = [lx + 6, ly - 8, lx + 8 + labelW, ly + 7];
      const showLabel = !overlaps(placed, box);
      placed.push([lx - 6, ly - 6, lx + 6, ly + 6]);
      if (showLabel) placed.push(box);
      pins.push({ lm, lx, ly, showLabel });
    }

    // 4. District, quarter, neighbourhood & water watermark titles (wherever they fit, larger kinds first),
    // letter-spaced like a printed atlas
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tracking = 'letterSpacing' in ctx;
    for (const { text, style, x, z } of AREA_TITLES) {
      if (s < style.minS || s > style.maxS) continue;
      const dx = toX(x);
      const dy = toY(z);
      if (Math.abs(dx) > w * 0.47 || Math.abs(dy) > h * 0.47) continue;
      ctx.font = `${style.font} ${FONT}`;
      ctx.fillStyle = style.color;
      if (tracking) ctx.letterSpacing = style.tracking;
      const half = this.textWidth(ctx, text) * 0.5 + 4;
      const box = [dx - half, dy - 8, dx + half, dy + 8];
      if (overlaps(placed, box)) continue;
      placed.push(box);
      ctx.fillText(text, dx, dy);
    }
    if (tracking) ctx.letterSpacing = '0px';
    ctx.textBaseline = 'alphabetic';

    // 5. Street names along their real course (collision-free at all zoom levels)
    const fontPx = Math.max(9, Math.min(12, Math.round(9.5 * Math.sqrt(Math.max(s, 0.4)))));
    this.drawRoadLabels(ctx, v, { fontPx, maxLabels: 420, sameNameGap: 300, placed, majorOnly: s < 0.3 });

    ctx.font = `700 11px ${FONT}`;
    ctx.textAlign = 'left';
    for (const { lm, lx, ly, showLabel } of pins) {
      ctx.fillStyle = MAP.halo;
      ctx.beginPath();
      ctx.arc(lx, ly, 6.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(lx, ly, 4.2, 0, Math.PI * 2);
      ctx.fill();
      if (showLabel) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = MAP.halo;
        ctx.strokeText(lm.short, lx + 9, ly + 4);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(lm.short, lx + 9, ly + 4);
      }
    }

    // 6. Scale bar (true metres); the true-north compass sits with the map controls (index.html)
    this.drawScaleBar(ctx, v);
    ctx.restore();
  }

  drawScaleBar(ctx, v) {
    const target = 120 / v.s; // metres in ~120 px
    const pow = Math.pow(10, Math.floor(Math.log10(target)));
    const step = [1, 2, 5, 10].map((m) => m * pow).filter((m) => m <= target).pop() || pow;
    const len = step * v.s;
    const x0 = -v.w * 0.5 + 24;
    const y0 = v.h * 0.5 - 26;
    const label = step >= 1000 ? `${step / 1000} km` : `${step} m`;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x0, y0 - 6);
    ctx.lineTo(x0, y0);
    ctx.lineTo(x0 + len, y0);
    ctx.lineTo(x0 + len, y0 - 6);
    ctx.strokeStyle = MAP.halo;
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(236, 239, 244, 0.92)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.font = `650 11px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.lineWidth = 3;
    ctx.strokeStyle = MAP.halo;
    ctx.strokeText(label, x0 + len + 8, y0 + 3);
    ctx.fillStyle = 'rgba(236, 239, 244, 0.95)';
    ctx.fillText(label, x0 + len + 8, y0 + 3);
  }
}

export { CityMapSystem, buildRouteGraph, nearestNode, routeTree, routePath, compassTitle, roadLabelAnchors, chainRoadPieces, districtGroupLabels, DISTRICT_GROUPS };
