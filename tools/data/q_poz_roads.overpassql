[out:json][timeout:180];
// Detail box D3 (52.383–52.434 N, 16.85686–17.000 E) padded by ~300 m so ways crossing its edge are whole.
// Foot/cycle/track classes, driveways and parking aisles are dropped; pedestrian streets and areas stay.
(
  way["highway"]["highway"!~"^(footway|path|cycleway|steps|track|bridleway|proposed|construction|corridor|elevator|platform|raceway|abandoned|razed|disused|bus_stop|via_ferrata)$"]["service"!~"^(driveway|parking_aisle|drive-through)$"](52.380,16.852,52.437,17.005);
  // Plazas: pedestrian area:highway outlines (the other ~5,500 area:highway ways are sidewalks, islands and lane
  // surfaces, 2/3 of the raw size) and squares, as ways or multipolygons.
  way["area:highway"="pedestrian"](52.380,16.852,52.437,17.005);
  relation["highway"="pedestrian"](52.380,16.852,52.437,17.005);
  relation["area:highway"="pedestrian"](52.380,16.852,52.437,17.005);
  way["place"="square"](52.380,16.852,52.437,17.005);
  relation["place"="square"](52.380,16.852,52.437,17.005);
);
// body keeps the node id list on every way (needed to split ways at shared nodes); geom adds coordinates.
out body geom;
