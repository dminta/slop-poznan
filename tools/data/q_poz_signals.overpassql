[out:json][timeout:120];
// Point features for the road graph, same padded detail box as q_poz_roads.
(
  node["highway"="traffic_signals"](52.389,16.890,52.428,16.990);
  node["crossing"](52.389,16.890,52.428,16.990);
  node["railway"="tram_stop"](52.389,16.890,52.428,16.990);
);
out body;
