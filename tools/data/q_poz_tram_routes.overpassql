[out:json][timeout:120];
// Tram line routes (route=tram relations, PTv2: one relation per direction) with a member in the padded detail box.
// Members only (no geometry): the track ways are in poz_rail.json, which also fetches the route members.
relation["route"="tram"](52.380,16.875,52.437,17.005);
out body;
