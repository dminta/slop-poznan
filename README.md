# Slop Poznań

A Poznań simulation built with [three.js](https://threejs.org/), WebGPURenderer, and TSL. Explore the real streets of Poznań, from Stary Rynek and Ostrów Tumski to Jeżyce, Łazarz and Jezioro Maltańskie, on foot, by car, by bicycle, or by helicopter.

[Try it live](https://dminta.github.io/slop-poznan/)

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

## Make it your own

Fork it, remix it, improve it, break it. Make games, animations, films, experiments, or something completely different. Use it as a starting point and take it wherever you want. Have fun!

## License and data

The project code is available under the [MIT License](LICENSE).

Map data: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/). Streets, buildings, water, parks and landmarks come from Overpass snapshots in `tools/data/` and are compiled into `js/geodata.js`. Third-party data and dependencies retain their respective licenses.
