[out:json][timeout:180];
// Aerodrome Ławica and its surfaces in the western detail box (52.377–52.437 N, 16.795–16.860 E). The aerodrome
// outline clears the block raster; runway, taxiways, aprons and terminal footprints become GEO.aeroway for
// js/airport.js (docs/observations/detailbox-west-expansion-2026-11-08.md §5).
(
  way["aeroway"](52.377,16.795,52.437,16.860);
  relation["aeroway"](52.377,16.795,52.437,16.860);
);
out tags geom;
