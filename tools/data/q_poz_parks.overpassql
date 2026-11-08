[out:json][timeout:240];
// Large green areas city-wide (outskirts need them): Poznań admin_level=8 boundary, relation 165941.
area(id:3600165941)->.city;
(
  way["leisure"="park"](area.city);
  relation["leisure"="park"](area.city);
  way["landuse"~"^(recreation_ground|cemetery|forest)$"](area.city);
  relation["landuse"~"^(recreation_ground|cemetery|forest)$"](area.city);
  way["natural"="wood"](area.city);
  relation["natural"="wood"](area.city);
  // Small green areas only in the padded detail box (52.377–52.437 N, 16.795–17.005 E). City-wide grass and gardens
  // were 34 MB of the 40 MB raw fetch, and 5,300 of the 8,000 grass ways here were under ~400 m², hence the perimeter
  // floor (metres) on grass and gardens.
  way["leisure"~"^(playground|pitch)$"](52.377,16.795,52.437,17.005);
  relation["leisure"~"^(garden|playground|pitch)$"](52.377,16.795,52.437,17.005);
  way["leisure"="garden"](52.377,16.795,52.437,17.005)(if:length() > 100);
  way["landuse"="grass"](52.377,16.795,52.437,17.005)(if:length() > 100);
  relation["landuse"="grass"](52.377,16.795,52.437,17.005);
);
out body geom;
