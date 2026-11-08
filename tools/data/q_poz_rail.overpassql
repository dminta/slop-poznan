[out:json][timeout:180];
// Same padded detail box as q_poz_roads. Plus every track way of a route=tram relation, whatever its railway tag: a
// line closed for rebuilding is retagged railway=disused|razed|construction but stays in its routes (2026: Ostrów
// Tumski with Most Chrobrego and Most Mieszka I, Most Teatralny, Fredry).
relation["route"="tram"](52.377,16.795,52.437,17.005)->.routes;
(
  way["railway"~"^(tram|rail|light_rail)$"](52.377,16.795,52.437,17.005);
  way(r.routes)["railway"~"^(disused|razed|construction|abandoned)$"](52.377,16.795,52.437,17.005);
  way["landuse"="railway"](52.377,16.795,52.437,17.005);
  relation["landuse"="railway"](52.377,16.795,52.437,17.005);
);
out body geom;
