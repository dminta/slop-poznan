[out:json][timeout:240];
// Poznań admin_level=8 boundary (relation 165941) plus the districts and osiedla inside it.
area(id:3600165941)->.city;
(
  relation(165941);
  relation["boundary"="administrative"]["admin_level"~"^(9|10)$"](area.city);
  node["place"~"^(suburb|quarter|neighbourhood)$"](area.city);
  way["place"~"^(suburb|quarter|neighbourhood)$"](area.city);
  relation["place"~"^(suburb|quarter|neighbourhood)$"](area.city);
);
out body geom;
