// tools/poz-base.mjs — the Poznań frame and the snapshot loader, for tools/build-poznan.mjs. Frame: 1 unit = 1 m,
// x = east, z = south (north = -z), origin at the Ratusz on Stary Rynek, bearing 0° (true north). Poznań has no single
// street grid, so the frame is not turned (docs/poznan-plan.md D1, D2). Side-effect free apart from reading
// GEO_DATA: every poz-*.mjs imports it, and nothing here touches the NYC pipeline (geo-base.mjs reads CSCL on import).
//
// Inputs (tools/data/poz_*.json; OpenStreetMap via Overpass, ODbL; queries, extents and dates in docs/geodata.md)
//
// usage: GEO_DATA=tools/data node --max-old-space-size=8192 tools/build-poznan.mjs [out.js]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = process.env.GEO_DATA || fileURLToPath(new URL('data/', import.meta.url));
const load = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
const log = (...a) => console.log('[geodata]', ...a);

const LAT0 = 52.40856;
const LON0 = 16.93401;
const BEARING_DEG = 0;
const A = 6378137.0;
const E2 = 6.69437999014e-3;
const PHI0 = (LAT0 * Math.PI) / 180;
const SIN0 = Math.sin(PHI0);
const NRAD = A / Math.sqrt(1 - E2 * SIN0 * SIN0);
const MRAD = (A * (1 - E2)) / Math.pow(1 - E2 * SIN0 * SIN0, 1.5);
// ≈ 67.97 km/° east and ≈ 111.27 km/° north at 52.4° N
const KX = (Math.PI / 180) * NRAD * Math.cos(PHI0);
const KY = (Math.PI / 180) * MRAD;

const toWorld = (lon, lat) => [(lon - LON0) * KX, -(lat - LAT0) * KY];
// toWorld as GEO.frame.ll affine coefficients: x = a*lon + b*lat + c, z = d*lon + e*lat + f
const llAffine = () => [KX, 0, -KX * LON0, 0, -KY, KY * LAT0];

// The detailed core (D3): 52.392–52.425 N, 16.895–16.985 E, ≈ 6.1 km east-west × 3.7 km north-south
const DETAIL_LL = { s: 52.392, n: 52.425, w: 16.895, e: 16.985 };
const [DX0, DZ1] = toWorld(DETAIL_LL.w, DETAIL_LL.s);
const [DX1, DZ0] = toWorld(DETAIL_LL.e, DETAIL_LL.n);
const DETAIL_BOX = [DX0, DX1, DZ0, DZ1];
const inDetailBox = (x, z, pad = 0) => x >= DX0 - pad && x <= DX1 + pad && z >= DZ0 - pad && z <= DZ1 + pad;

log(`frame: origin Ratusz ${LAT0} N ${LON0} E, bearing ${BEARING_DEG}°, KX ${(KX / 1000).toFixed(3)} km/°, KY ${(KY / 1000).toFixed(3)} km/°`);
log(`detail box: x ${DX0.toFixed(0)}..${DX1.toFixed(0)}, z ${DZ0.toFixed(0)}..${DZ1.toFixed(0)}`);

export { load, log, toWorld, llAffine, LAT0, LON0, BEARING_DEG, DETAIL_LL, DETAIL_BOX, inDetailBox };
