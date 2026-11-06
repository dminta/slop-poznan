[out:json][timeout:120];
(
  way["name"~"^(Ratusz|Bazylika Kolegiacka Matki Bożej Nieustającej Pomocy, Świętej Marii Magdaleny i Świętego Stanisława Biskupa|Zamek Królewski|Bazylika Archikatedralna Świętych Apostołów Piotra i Pawła|Brama Poznania ICHOT|Zamek Cesarski|Okrąglak|Collegium Minus|Teatr Wielki|Avenida Poznań|Stary Dworzec Główny|Stary Browar \\(Pasaż\\)|Stary Browar \\(Atrium\\)|Stary Browar-Pasaż|Stary Browar-Atrium|Stary Browar-Dziedziniec sztuki|Pawilon 11|Collegium Altum|Andersia Tower|Poznańskie Centrum Finansowe|Delta|Novotel Poznań Centrum|AND2|Wieża Wójtowska|Biblioteka Raczyńskich|Pałac Działyńskich|Muzeum Narodowe|Teatr Polski|Kościół pw. Świętego Franciszka Serafickiego|Kościół pw. Świętego Antoniego Padewskiego|Kościół pw. Najświętszej Maryi Panny|Kościół pw. Świętego Wojciecha|Kościół pw. Bożego Ciała)$"](52.383,16.880,52.434,17.000);
  relation["name"~"^(Ratusz|Zamek Królewski|Bazylika Archikatedralna Świętych Apostołów Piotra i Pawła|Zamek Cesarski|Avenida Poznań|Stary Dworzec Główny|Stary Browar-Pasaż|Stary Browar-Atrium|Stary Browar-Dziedziniec sztuki|Nowy Rynek|Collegium Maius)$"](52.383,16.880,52.434,17.000);
  // Platforms and stop areas share the station name, so only the station building is kept.
  way["building"]["name"="Poznań Główny"](52.383,16.880,52.434,17.000);
  // Bałtyk carries its name only in addr:housename.
  way["building"]["addr:housename"="Bałtyk"](52.383,16.880,52.434,17.000);
  // The Domki budnicze (the arcaded row south of the Ratusz) are one unnamed building way.
  way(343867707);
  // Hotel Bazar (the historic hotel on Marcinkowskiego/Paderewskiego) is an unnamed building way.
  way(363880964);
  // The Poznański Czerwiec 1956 crosses are mapped as a single memorial node.
  node["historic"="memorial"]["name"="Poznański Czerwiec 1956"](52.405,16.914,52.410,16.920);
)->.found;
// Relations need body verbosity: with `tags` Overpass drops the member list and its geometry.
way.found;
out tags geom;
(node.found;relation.found;);
out body geom;
// Nowy Rynek towers (A–E) are unnamed building ways inside the Nowy Rynek landuse relation.
rel(15819392);
map_to_area->.nowyRynek;
way["building"](area.nowyRynek);
out tags geom;
