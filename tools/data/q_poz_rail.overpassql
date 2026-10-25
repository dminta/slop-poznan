[out:json][timeout:180];
// Same padded detail box as q_poz_roads.
(
  way["railway"~"^(tram|rail|light_rail)$"](52.389,16.890,52.428,16.990);
  way["landuse"="railway"](52.389,16.890,52.428,16.990);
  relation["landuse"="railway"](52.389,16.890,52.428,16.990);
);
out body geom;
