# Slop Poznań

A Poznań simulation built with [three.js](https://threejs.org/), WebGPURenderer, and TSL. Explore the real streets of Poznań, from Stary Rynek and Ostrów Tumski to Jeżyce, Łazarz and Jezioro Maltańskie, on foot, by car, by bicycle, or by helicopter.

[Try it live](https://slop-poznan.dominikminta.com/)

Ported from [Slop New York](https://github.com/mrdoob/slop-newyork).

## Run locally

From the repository root, run `python3 -m http.server 8000`, then open `http://localhost:8000/` in a WebGPU browser.
There is no build or npm install. The page needs network access for three.js (`three@dev` through jsDelivr) and fonts.
Explore on foot, drive, cycle or fly using the mode buttons; the map provides search, destinations and teleports.

Run the tests with Node 22+: `node --test tests/`. See [testing and local development](docs/testing.md) for focused
commands and browser verification.

## Development docs

- [Architecture, controls and UI](docs/architecture.md)
- [World building](docs/world.md), [actors and traffic](docs/actors.md), [rendering](docs/rendering.md) and [audio](docs/audio.md)
- [Geodata and rebuilding the OSM snapshots](docs/geodata.md)
- [Remaining work](docs/backlog.md) and the [archived Poznań port plan](docs/archive/poznan-plan.md)
- [Credits and attribution](docs/credits.md)

## Credits and attribution

© 2026 Dominik Minta · based on [Slop New York](https://github.com/mrdoob/slop-newyork) (© 2026 Mr.doob) · [MIT license](LICENSE).

### Data sources & external assets

- **Map data**: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) ([Open Database License - ODbL 1.0](https://opendatacommons.org/licenses/odbl/)). Streets, buildings, water, parks, and landmarks are compiled from Overpass snapshots in `tools/data/` into `js/geodata.js`.
- **National elevation models**: Data source: the Head Office of Geodesy and Cartography (GUGiK), State Geodetic and Cartographic Resources (PZGiK). NMT and NMPT elevation models from the state geodetic registry were used only as a reference for calibrating the architectural heights of Fara (nave ridge 40 → 37 m) and the Teatr Wielki fly tower (27 → 31.7 m); see [observations/landmark-heights-2026-11-03.md](docs/observations/landmark-heights-2026-11-03.md). Under Polish geodetic law, NMT data is free under art. 40a ust. 2 pkt 1 lit. d of the Geodetic and Cartographic Law, and GUGiK provides NMPT free of charge. Note: the runtime geodata build (`js/geodata.js`) uses pure OSM data; BDOT10k was audited for coverage verification only and is not included.
- **Typography**: [Inter](https://fonts.google.com/specimen/Inter) designed by Rasmus Andersson ([SIL Open Font License 1.1](https://openfontlicense.org/)) and [Overpass](https://fonts.google.com/specimen/Overpass) designed by Delve Fonts / Red Hat ([SIL Open Font License 1.1](https://openfontlicense.org/)).
- **Audio and the bugle call**: All game audio is synthesized procedurally in real time using the Web Audio API, with zero external audio sample files. The Poznań bugle call is the city's official melody (appendix 4 to the Poznań City Statute), in our own synthesis.
- **City visual identity**: The earlier visual identity of the City of Poznań ([logo manual PDF](https://www.poznan.pl/mim/public/sport/attachments.att?co=show&instance=1017&parent=37249&lang=pl&id=76107); 2024 introduced a new identity with district colours, [poznan.pl](https://www.poznan.pl/mim/main/nowa-identyfikacja-wizualna,p,77224,77225,77232.html); the blue palette is retained here): dark blue Pantone 2747 (`#234792`), Process Blue (`#009CDC`), and white (`#FFFFFF`). Contrast ratio on white: 8.79:1.
