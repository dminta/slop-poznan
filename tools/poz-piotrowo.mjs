// The campus boundary is independent of street blocks: the northern island also contains non-university land.
import { load, toWorld } from './poz-base.mjs';
import { elemRings, pointInRing, centroid, r1 } from './geo-util.mjs';

const flat = r => r.flatMap(([x, z]) => [r1(x), r1(z)]);
const boundaries = elemRings(load('poz_piotrowo_campus.json').elements[0], toWorld);
const elements = load('poz_buildings.json').elements;
const members = new Set(elements.filter(e => e.type === 'relation' && e.tags?.building)
  .flatMap(e => (e.members || []).map(m => m.type + '/' + m.ref)));
const existing = new Set([9084535, 9084537, 497154325]);
const measured = new Map(load('poz_piotrowo_heights.json').measurements.map(m => [m.id, m]));
// Historical DSM predates the modern northern buildings; near-zero differences there are ground, not roof heights.
const estimated = new Set([300946610, 536004095, 1330185469, 497708234, 741982274, 922860630, 1537143706]);
const buildings = [];
for (const e of elements) {
  const t = e.tags || {};
  if (!t.building || t.building === 'roof' || existing.has(e.id) || members.has(e.type + '/' + e.id)) continue;
  const rings = elemRings(e, toWorld);
  if (!rings.length || !boundaries.some(r => pointInRing(...centroid(rings[0]), r))) continue;
  const levels = parseFloat(t['building:levels']);
  const tower = [497154322, 497154324].includes(e.id);
  const chemistry = e.id === 300946610;
  const tennis = [497629139, 497629140, 497629141, 497629148].includes(e.id);
  let h = parseFloat(t.height) || (tower ? 35 : chemistry ? 17 : e.id === 203590784 ? 7.7 :
    tennis ? 9 : levels ? levels * 3.4 : t.building === 'garage' ? 3.5 : 6);
  const m = measured.get(e.type + '/' + e.id);
  if (m && m.samples >= 10 && !estimated.has(e.id)) h = Math.round(m.p90 * 2) / 2;
  if (e.id === 203590784) h = 7.7; // PP's connector tender, measured from ground-floor finished floor.
  buildings.push({ id: e.type + '/' + e.id, name: t.name || t.ref || 'Budynek PP', h: r1(h),
    kind: tower ? 'tower' : chemistry ? 'chemistry' : tennis ? 'tennis' : 'university',
    ring: flat(rings[0]), holes: elemRings(e, toWorld, 'inner').map(flat) });
}
const grounds = [];
for (const e of load('poz_piotrowo_grounds.json').elements) {
  const r = elemRings(e, toWorld)[0];
  // Retain only complete campus patches; a river-bank lawn may extend beyond the university's property.
  if (!boundaries.some(b => r.every(([x, z]) => pointInRing(x, z, b)))) continue;
  grounds.push({ id: 'way/' + e.id, kind: e.tags.landuse === 'grass' ? 'grass' : 'pitch',
    ...(e.tags.leisure === 'pitch' ? { sport: e.tags.sport || '', surface: e.tags.surface || '' } : {}), ring: flat(r) });
}
const forecourtWay = load('poz_piotrowo_forecourt.json').elements[0];
const forecourt = { id: 'way/' + forecourtWay.id, surface: forecourtWay.tags.surface,
  ring: flat(elemRings(forecourtWay, toWorld)[0]) };
const piotrowo = { boundaries: boundaries.map(flat), buildings, grounds, forecourt };
export { piotrowo };
