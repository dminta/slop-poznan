// OSM API /api/0.6/{relation,way}/{id}/full.json used on 2026-11-12 when Overpass returned 406/403.
// Equivalent Overpass query; © OpenStreetMap contributors, ODbL.
[out:json][timeout:60];
(relation(9084535);relation(9084537);way(497154325););
out body geom;
