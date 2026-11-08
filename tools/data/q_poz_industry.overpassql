[out:json][timeout:240];
// Industrial and utility structures in the same padded detail box as q_poz_buildings (52.380–52.437 N,
// 16.875–17.005 E). building=* alone misses cooling towers, chimneys, silos, storage tanks and works, and the
// power plants/substations that carry no building outline; EC Garbary and Karolin then have no chimney or cooling
// tower at all. Ways need tags and geometry; multipolygon relations need the member list (`out body geom`).
(
  way["man_made"~"^(cooling_tower|chimney|storage_tank|silo|works)$"](52.380,16.875,52.437,17.005);
  relation["man_made"~"^(cooling_tower|chimney|storage_tank|silo|works)$"](52.380,16.875,52.437,17.005);
  way["power"~"^(plant|substation)$"](52.380,16.875,52.437,17.005);
  relation["power"~"^(plant|substation)$"](52.380,16.875,52.437,17.005);
)->.i;
way.i;
out tags geom;
relation.i;
out body geom;
