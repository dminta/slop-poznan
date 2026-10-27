[out:json][timeout:240];
// Building footprints in the same padded detail box as q_poz_roads (52.389–52.428 N, 16.890–16.990 E), for the
// per-block built share and storeys (GEO.blockStats). building=construction is kept: a site under construction (AND2)
// is a built lot, not an empty one.
(
  way["building"](52.389,16.890,52.428,16.990);
  relation["building"]["type"="multipolygon"](52.389,16.890,52.428,16.990);
)->.b;
// Ways need only tags and geometry; relations need body verbosity, since `tags` drops the member list.
way.b;
out tags geom;
relation.b;
out body geom;
