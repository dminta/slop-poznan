[out:json][timeout:240];
// Whole city: Poznań admin_level=8 boundary, relation 165941 (area id = 3600000000 + relation id).
area(id:3600165941)->.city;
(
  way["natural"="water"]["water"~"^(river|reservoir|lake|pond|canal|oxbow)$"](area.city);
  relation["natural"="water"]["water"~"^(river|reservoir|lake|pond|canal|oxbow)$"](area.city);
  // Many small ponds carry no water=* subtag at all.
  way["natural"="water"][!"water"](area.city);
  relation["natural"="water"][!"water"](area.city);
  way["waterway"="riverbank"](area.city);
  relation["waterway"="riverbank"](area.city);
  way["waterway"~"^(river|stream|canal)$"](area.city);
  // Jezioro Maltańskie.
  relation(7550595);
);
// Relations need body verbosity so members (with their geometry) are listed.
out body geom;
