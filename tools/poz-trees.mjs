// tools/poz-trees.mjs — individually mapped street and park trees for tools/build-poznan.mjs.
// OSM has a surveyed node for tens of thousands of Poznań trees (`natural=tree`), many with a species and a measured
// height. The procedural rows stay for avenues that are mapped only as areas or not at all; this snapshot gives those
// individual trees priority and an exact world position.
//
// Input: tools/data/poz_trees.json (Overpass `node["natural"="tree"]` in the padded detail box, ODbL). Only nodes inside
// DETAIL_BOX are emitted. Species is mapped onto the four models in js/trees.js (lime 0, maple 1, chestnut 2, robinia 3);
// an unmapped or untagged taxon stays -1 and the runtime picks one deterministically. Height is the OSM `height` tag in
// metres, rounded to 0.1 m (0 when untagged); the runtime turns it into a tree scale.
//
// Exports: trees as a flat [x, z, species, height, ...] array (0.1 m position, species -1..3, height m).
import { load, log, toWorld, DETAIL_BOX, inDetailBox } from './poz-base.mjs';

const [BX0, BX1, BZ0, BZ1] = DETAIL_BOX;
const r1 = (v) => Math.round(v * 10) / 10;

// The models carry a lime, Norway maple, horse chestnut and black locust. Only the first four genera are mapped:
// Tilia, Acer, Aesculus and Robinia. Everything else (oak, ash, plane, birch, ...) is outside the atlas and gets the
// nearest deterministic model at runtime.
const TAXA = [
  [/^tilia(\s|$)/, 0],
  [/^acer(\s|$)/, 1],
  [/^aesculus(\s|$)/, 2],
  [/^robinia(\s|$)/, 3]
];

function speciesCode(tags) {
  const taxon = `${tags.species || ''} ${tags.genus || ''} ${tags.taxon || ''}`.trim().toLowerCase();
  if (!taxon) return -1;
  for (const [re, code] of TAXA) if (re.test(taxon)) return code;
  return -1;
}

function metres(value) {
  const m = /(-?\d+(?:[.,]\d+)?)/.exec(String(value ?? ''));
  return m ? Number.parseFloat(m[1].replace(',', '.')) : 0;
}

const trees = [];
const bySpecies = [0, 0, 0, 0, 0];
const kept = new Map(); // 1 m buckets, to drop nodes mapped twice at the same trunk
let nodes = 0, outside = 0, withHeight = 0, withSpecies = 0, duplicates = 0;
for (const e of load('poz_trees.json').elements) {
  if (e.type !== 'node' || !Number.isFinite(e.lat) || !Number.isFinite(e.lon)) continue;
  nodes++;
  const [x, z] = toWorld(e.lon, e.lat);
  if (!inDetailBox(x, z, 0)) { outside++; continue; }
  const tx = r1(x), tz = r1(z);
  let duplicate = false;
  for (let ix = Math.floor(tx) - 1; ix <= Math.floor(tx) + 1 && !duplicate; ix++) {
    for (let iz = Math.floor(tz) - 1; iz <= Math.floor(tz) + 1 && !duplicate; iz++) {
      for (const p of kept.get(ix * 100000 + iz) || []) {
        if ((tx - p[0]) ** 2 + (tz - p[1]) ** 2 < 0.25) { duplicate = true; break; }
      }
    }
  }
  if (duplicate) { duplicates++; continue; }
  const key = Math.floor(tx) * 100000 + Math.floor(tz);
  if (!kept.has(key)) kept.set(key, []);
  kept.get(key).push([tx, tz]);
  const tags = e.tags || {};
  const species = speciesCode(tags);
  const height = metres(tags.height);
  if (height > 0) withHeight++;
  if (species >= 0) withSpecies++;
  bySpecies[species + 1]++;
  trees.push(tx, tz, species, height > 0 ? r1(height) : 0);
}

log(`trees: ${nodes} natural=tree nodes, ${trees.length / 4} in the detail box ` +
  `(${withSpecies} mapped to a model species, ${withHeight} with height; ${outside} outside, ` +
  `${duplicates} duplicate positions)`);
log(`trees: lime ${bySpecies[1]}, maple ${bySpecies[2]}, chestnut ${bySpecies[3]}, robinia ${bySpecies[4]}, ` +
  `other/untagged ${bySpecies[0]}`);
// The box bounds are kept in the log so an accidental query-extent change is visible in the build output.
log(`trees: detail box x ${BX0.toFixed(0)}..${BX1.toFixed(0)}, z ${BZ0.toFixed(0)}..${BZ1.toFixed(0)}`);

export { trees };
