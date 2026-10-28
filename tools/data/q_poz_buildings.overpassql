[out:json][timeout:240];
// Building footprints in the same padded detail box as q_poz_roads (52.380–52.437 N, 16.875–17.005 E), for the
// per-block built share and storeys (GEO.blockStats). building=construction is kept: a site under construction (AND2)
// is a built lot, not an empty one.
(
  way["building"](52.380,16.875,52.437,17.005);
  relation["building"]["type"="multipolygon"](52.380,16.875,52.437,17.005);
)->.b;
// Ways need only tags and geometry; relations need body verbosity, since `tags` drops the member list.
way.b;
out tags geom;
relation.b;
out body geom;
