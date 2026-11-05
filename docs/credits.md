# Credits and attribution

This document details third-party data sources, licences, typography, and visual identity used in **Slop Poznań**.

---

## 1. Source code

- **Slop Poznań**: © 2026 Dominik Minta · based on [Slop New York](https://github.com/mrdoob/slop-newyork) (© 2026 Mr.doob) · [MIT License](../LICENSE).

---

## 2. Map data

- **OpenStreetMap**: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the [Open Database License (ODbL 1.0)](https://opendatacommons.org/licenses/odbl/).
  - Street geometry, building footprints and levels, tram and railway infrastructure, water bodies, parks, and plazas are compiled from Overpass snapshots in `tools/data/poz_*.json` into `js/geodata.js`.

---

## 3. Elevation models (GUGiK)

- **Główny Urząd Geodezji i Kartografii (GUGiK)**: [geoportal.gov.pl](https://geoportal.gov.pl/).
  - Attribution: Źródło danych: Główny Urząd Geodezji i Kartografii (PZGiK).
  - NMT (Digital Terrain Model) and NMPT (Digital Surface Model) lidar data from the state geodetic registry were used only for reference architectural height calibration of Fara (nave ridge 40 → 37 m) and Teatr Wielki fly tower (27 → 31.7 m); see [observations/landmark-heights-2026-11-03.md](observations/landmark-heights-2026-11-03.md).
  - Terms under Polish geodetic law: NMT is free under art. 40a ust. 2 pkt 1 lit. d Pgik, and GUGiK provides NMPT free of charge; art. 40c ust. 3 requires citing the source.
  - Note: the runtime geodata build (`js/geodata.js`) uses pure OSM data. BDOT10k was audited for coverage verification ([observations/sparse-blocks-2026-11-04.md](observations/sparse-blocks-2026-11-04.md)) and omitted from the build.

---

## 4. Typography

- **Inter**: UI typeface designed by Rasmus Andersson, available via Google Fonts under the [SIL Open Font License 1.1](https://openfontlicense.org/).
- **Overpass**: Street-name plate typeface inspired by Highway Gothic, designed by Delve Fonts / Red Hat, available via Google Fonts under the [SIL Open Font License 1.1](https://openfontlicense.org/).

Both font families ship the `latin-ext` subset covering Polish diacritics (Ą, Ć, Ę, Ł, Ń, Ó, Ś, Ź, Ż).

---

## 5. Audio & Hejnał

- **Synthesized audio**: All vehicles, footsteps, horns, church bells, pedestrian conversations, and environmental sounds are synthesized procedurally at runtime using the Web Audio API (`js/audio-*.js`). The repository contains zero audio asset files.
- **Bugle call**: the Poznań bugle call melody (appendix 4 to the Statut Miasta Poznania), in our own synthesis.

---

## 6. City visual identity

- **Brand identity**: The start (loading) screen uses the City of Poznań's earlier visual identity ([logo manual PDF](https://www.poznan.pl/mim/public/sport/attachments.att?co=show&instance=1017&parent=37249&lang=pl&id=76107): "Podstawowe kolory występowania logo to ciemny błękit (100% cyan, 75% magenta), błękit (100%) i biel tła"; 2024 introduced a new identity with district colours, [poznan.pl](https://www.poznan.pl/mim/main/nowa-identyfikacja-wizualna,p,77224,77225,77232.html); blue retained here):
  - **Ciemny błękit** (primary brand blue): Pantone 2747, CMYK `100, 75, 0, 0`, RGB `35, 71, 146`, **`#234792`**.
  - **Błękit** (Process Blue / accent): Pantone Process Blue, CMYK `100, 0, 0, 0`, RGB `0, 156, 220`, **`#009CDC`**.
  - **Biel** (white background): **`#FFFFFF`**.
  - Contrast ratio of `#234792` on `#FFFFFF` is **8.79:1** (WCAG AA/AAA).
