# Height sources for Poznań buildings — 2026-11-19

Research record for the open backlog item "Additional height sources (nDSM/LoD1/LoD2) and GEOPOZ
machine-readable data: research candidates". The immediate consumer is the
[Piotrowo height verification](../backlog.md): A28/A29 use the 2024-09-17 NMPT−NMT, A30 uses the PP
11.80 m dimension, and the new rectorate's 16.31 m above-ground portion still needs a post-completion
check. No code, data or backlog file was changed; this is the only file written.

## What was asked

- Does GEOPOZ / Poznań's SIP publish machine-readable height data — nDSM/DSM/DTM rasters, LiDAR point
  clouds, LoD1/LoD2/CityGML — or only imagery and 2D parcels? Name endpoints, formats, licensing and
  bulk-download terms.
- What national GUGiK data covers Poznań: NMT/NMPT, LiDAR LAS/LAZ, EGiB building outlines with
  heights, and the reuse terms.
- Other candidates: OSM height/level completeness, city LoD2, free or commercial nDSM products.
- Rank by usefulness-to-effort for this repo, and state plainly what cannot be reached or is
  WMS-only.

## Method and scope

Read `AGENTS.md`, [`docs/geodata.md`](../geodata.md) (the current pipeline, frame and every height
source already used), the Piotrowo sections of [`docs/world.md`](../world.md) and the backlog bullet.
Then probed the live services on **2026-11-19**: service roots and `GetCapabilities`, the SIP 3D
viewer's `app.config.json` and module configs, the LoD2/LoD1 tileset JSON, sample `.b3dm` headers and
batch tables, EGiB WMS `GetFeatureInfo` and WFS `GetFeature`, the national EGiB WFS, the LIDAR sheet
WMS, and archive URLs with `HEAD`. OSM completeness was measured on the committed
`tools/data/poz_buildings.json` snapshot, not live OSM. Every endpoint quoted below answered on that
date unless marked otherwise. "Verified" means the response was fetched and parsed here; it does not
mean the source's height is a survey.

## Verdict in brief

**GEOPOZ does publish machine-readable heights, contrary to the "imagery and 2D parcels only"
hypothesis.** `https://sip.poznan.pl/model3d/` is a VC Map viewer whose LoD1 and LoD2 layers are plain
3D Tiles: 946 `.b3dm` tiles for LoD2, publicly fetchable without a token, each with a batch table of
per-building attributes. That includes `measuredHeight`, ground and roof elevations, EGiB building
ID, storey counts, function and source dates. The metadata calls it CityGML LoD2; the viewer serves
the tiled derivative, not a CityGML download.

The catch is recency and scope. The LoD2 roof geometry for the Piotrowo buildings comes from
2020–2021 photogrammetry, not from a 2026 survey; the layer's 2026-04-27 update is not reflected in
these buildings' roof-source dates. The new rectorate is present only as a LoD1 record with a
**12 m storey-derived height** (`S_WYS_L1 = 12`, source "liczba kondygnacji nadziemnych"), not a
measured roof. So the city model can cross-check A28/A29 but **cannot confirm the rectorate's
16.31 m**.

There is no national LoD2 for Poznań. The latest dated national elevation source is still the
2024-09-17 LiDAR/NMPT sheet already used; the 2025/2026 LIDAR index has no sheet for central
Poznań. The only realistic confirmation route is a future GUGiK LiDAR/NMPT flight or an as-built
survey, not any product available on 2026-11-19.

## Ranking by usefulness-to-effort

Ranked for the repo's broader need for additional height sources. For the single rectorate question,
only rank 6 (a future post-completion flight) would answer it, and it is not available yet.

| Rank | Source | Height content | Recency | Licence / access | Effort | Verdict for this repo |
|---:|---|---|---|---|---|---|
| 1 | **GEOPOZ LoD2 3D Tiles** | per-building `measuredHeight`, ground/roof elevations, storeys, EGiB ID | roof geometry 2020–2021; attributes updated 2026-04-27 | free reuse with attribution (GEOPOZ BIP); static files, no bulk endpoint | medium: 946-tile crawl + batch-table JSON, no CityGML parser | Best new machine-readable height product; cross-checks A28/A29, brackets A30, **does not confirm the rectorate** |
| 2 | **GUGiK 2024 LAZ (12 p/m²)** | raw classified point cloud; build nDSM/roof heights yourself | 2024-09-17 | free, any use | high: LAZ decode, ground filter, per-footprint sampling | Same campaign as the NMPT already used; useful for a cleaner A30 ground/roof split, no post-completion check |
| 3 | **GUGiK national EGiB WFS / "Dane powiatowe"** | outlines, function, above/below-ground storeys; **no height** | daily WFS; 2025–2026 bulk product | free (`Fees none`, `AccessConstraints none` on the WFS) | low: WFS/GeoParquet/GPKG | Authoritative footprints and storeys; the join key for LoD2; not a height source by itself |
| 4 | **GUGiK LoD1 2024** | `measuredHeight` per building | 2024 | CC BY 4.0 (as recorded in `geodata.md`), free | low: one county ZIP | Already used; good fallback, but `measuredHeight` uses minimum terrain and overstates sloping sites |
| 5 | **GEOPOZ 2D EGiB WMS/WFS** | outlines, function, status; no height; buildings are WMS-only | daily | free reuse with attribution | low | Footprint/function authority; not a height source |
| 6 | **Future GUGiK LiDAR/NMPT (2025/2026)** | full point cloud / nDSM | not yet published for Poznań | free, any use | high | The only likely post-completion confirmation for the rectorate |
| 7 | **GlobalBuildingAtlas** | 3 m ML height raster + LoD1 | 2019 PlanetScope imagery | CC BY-NC 4.0 | medium | ML-derived, non-commercial, RMSE ≈ 4.1 m in Europe; not for verification |
| 8 | **OSM** | `height` 0.6%, `building:levels` 75.4% | current snapshot | ODbL | low | Already used; cannot supply missing heights |
| — | **GUGiK LoD2 (national)** | CityGML LoD2 | 2017 | free | — | **Not available for Poznań**: TERYT 3064 `LOD2 = FALSE`, archive 404 |
| — | **GEOPOZ point clouds** | 3D Tiles point clouds, 2019 GUGiK / 2021 MESIP | pre-2024 | free reuse with attribution | high | No post-completion data; not useful for the rectorate |

## 1. GEOPOZ / Poznań SIP

### 1.1 What is exposed

The public entry point is `https://sipgeoportal.geopoz.poznan.pl/` (the old `geoportal.poznan.pl`
does not resolve; `sip.poznan.pl` redirects to the SIP portal). The 3D viewer is
`https://sip.poznan.pl/model3d/`, and its app configuration is
`https://sip.poznan.pl/model3d/app.config.json`. The configuration lists these height-bearing layers:

| Layer | Tileset root | Metadata |
|---|---|---|
| `Db_budynki` (highest available LoD1/LoD2/LoD3) | `https://sip.poznan.pl/model3d/dane/94edf024-96b0-4716-8cf2-56aa41346a15/tileset.json` | CityGML buildings, EGiB + CityDB |
| `Db_budynki_lod1` | `https://sip.poznan.pl/model3d/dane/dadcaea8-79ee-4ae6-bf02-638a444266a9/tileset.json` | CityGML LoD1, classified by function |
| `Db_budynki_lod2` | `https://sip.poznan.pl/model3d/dane/7e33f7d8-1e49-4e91-84d0-d6be67b3b1de/tileset.json` | CityGML LoD2 |
| `Gml_budynki_projektowane` | `https://sip.poznan.pl/model3d/dane/ebd09c32-64da-4b5f-9f1b-fe49ebc5364c/tileset.json` | planned buildings from permits; roof type, no height |
| `Gml_budynki_podziemne` | `https://sip.poznan.pl/model3d/dane/6f713208-386d-4477-9fb1-d67c08a7d58d/tileset.json` | underground buildings |

The layer metadata is at `https://sip.poznan.pl/model3d/dane/metadane_images/warstwy.json`. It says
`Db_budynki_lod2` is "Modele budynków zgodne ze standardem CityGml, klasa buildings LOD2", source
"Ewidencja Gruntów i Budynków", created **2024-06-19**, updated **2026-04-27**. `Db_budynki` says
"LOD1, LOD2, LOD3; prezentowany jest najwyższy dostępny poziom szczegółowości".

The LoD2 tileset has **946 content tiles**; the LoD1 tileset 956; `Db_budynki` 1,254. The tiles we
sampled around Piotrowo were 65 KB–1.1 MB each. Tiles are static `.b3dm` files under
`/model3d/dane/<dataset-uuid>/<z>/<x>/<y>.b3dm`; a `tileset.json` walk is enough to enumerate them.
There is no token, cookie or referer check on the files we fetched.

### 1.2 The per-building batch table

A `.b3dm` starts with a 28-byte header, then a feature table JSON, an optional batch table JSON, and
a GLB. The batch table is plain JSON; no geometry decode is needed to read the attributes. Fields
observed in the Piotrowo tiles:

| Field | Meaning observed |
|---|---|
| `OBJECTID` | EGiB building object id (matches the city's EGiB WMS `OBJECTID`) |
| `E_IDG5` | EGiB building identifier, e.g. `0004.AR_14.24/8.1_BUD` |
| `E_LKON_N` / `E_LKON_P` | above-ground / below-ground storeys |
| `E_RFUN_NAZWA`, `E_RFUN_OZN` | building function (name and code) |
| `E_STATUS_OP`, `E_DTUTW`, `E_ROK_BUD` | status, EGiB insert date, year built |
| `S_ZNMPT_L1`, `S_DTUOB_L1`, `S_WYS_L1` | LoD1 source, source date, source height |
| `S_ZNMPT_L2`, `S_DTUOB_L2` | LoD2 source, source date |
| `BREC_GroundLevel`, `BREC_HighestRoof`, `BREC_LowestRoof` | ground, highest roof, lowest roof elevation (m) |
| `measuredHeight` | `BREC_HighestRoof − BREC_GroundLevel`, rounded to 0.1 m |
| `gml:id` | `BID_<OBJECTID>_<uuid>` |
| `GOOGLE_URL` | a Google Maps link with a lat/lon; **not a reliable centroid**, see 1.6 |

`measuredHeight` is not a facade or eaves datum: it is the highest roof minus the **minimum** ground
level. On a sloping site it overstates the above-ground mass. The field is also absent when the
building has no LoD2/photogrammetric roof (as for the rectorate).

The per-feature source dates matter more than the layer metadata. For the Piotrowo buildings the
LoD2 roof source `S_DTUOB_L2` is **2020-01-23** for A28 and A29 and **2021-01-07** for A30, not 2026.
The 2026-04-27 layer update did not change these roof-source dates; treat it as an attribute refresh,
not a new roof survey.

### 1.3 Piotrowo check

The four buildings were located by their EGiB `ID_BUDYNKU` from the national WFS (section 2.5); the
LoD2/LoD1 batch tables carry the same `E_IDG5` suffix. This avoids the unreliable `GOOGLE_URL`.

| Building | EGiB `ID_BUDYNKU` | EGiB storeys above / below | GEOPOZ `measuredHeight` | GEOPOZ ground / highest roof | Repo height | Reading |
|---|---|---|---:|---|---:|---|
| Chemistry A28 | `306401_1.0004.AR_14.29/3.1_BUD` | 4 / 1 | 19.7 m | 61.1 / 80.8 m | 18 m | +1.7 m; likely roof plant/parapet, not verified; older 2020 LoD2. Do not replace the 2024 p90 without a facade check |
| Sports hall A29 | `306401_1.0004.AR_17.18/6.8_BUD` | 2 / 1 | 11.7 m | 59.0 / 70.8 m | 12 m | agrees within 0.3 m; independent confirmation |
| A30 | `306401_1.0004.AR_14.24/2.49_BUD` | 3 / 1 | 20.5 m | 58.5 / 79.0 m | 11.80 m documented | `measuredHeight` uses ground 58.5 m, near the site minimum 58.59 m; above the true 63.58 m ground the highest roof is 15.4 m and the lowest roof 11.6 m. The model does not resolve the architectural datum; keep 11.80 m |
| New rectorate | `306401_1.0004.AR_14.24/8.1_BUD` | 4 / 1 | **none**; `S_WYS_L1 = 12 m` | — | 16.31 m documented | `S_ZNMPT_L1` says "liczba kondygnacji nadziemnych" — a storey-derived 12 m LoD1 mass, not a survey. **Cannot confirm 16.31 m** |

A30 demonstrates the min-ground bias numerically: `BREC_HighestRoof 79.0 − BREC_GroundLevel 58.5 =
20.5 m`, while the repository's 2024 DTM spans 58.59–63.58 m at the footprint. The city's own
`BREC_LowestRoof 75.2 − 63.58 = 11.62 m` is the value closest to the documented 11.80 m. A city-wide
use of `measuredHeight` must therefore re-ground each building on a local DTM, not trust the field
as an above-ground height.

The rectorate's 12 m is the clearest negative result of this check. It is not a missing record: the
EGiB insert date `E_DTUTW` is 2025-09-04, the function is "budynki biurowe", the storey counts are
4/1 (matching the PFU's four above-ground and one underground floor), and the row is present in the
`Db_budynki` tileset. It simply has no measured roof: `measuredHeight` and the `BREC_*` elevations are
absent, and `S_ZNMPT_L1` names storey count as the height source. The 2024 NMPT's 338 rectorate
samples are construction-era (geodata.md), so they do not close the gap either.

### 1.4 Licensing and bulk access

The GEOPOZ reuse terms are on the BIP page
`https://bip.geopoz.poznan.pl/gpb/ponowne-wykorzystywanie/1696,Ponowne-wykorzystywanie-informacji-sektora-publicznego.html`.
They allow reuse free of charge under the 2021 open-data act with these conditions: give the full
name of the Zarząd Geodezji i Katastru Miejskiego GEOPOZ as the source; give the date the information
was created and the date it was obtained; add a note if the content was modified; and accept the
disclaimer. The page also says a fee may be charged only where preparing or transmitting the data in
the requested form incurs additional cost.

The 3D viewer is a viewing application, not a documented bulk-download service. There is no ZIP link
or "download all" button in the app config. The tiles are nevertheless public static files, so a
one-off crawl of 946 LoD2 tiles is technically feasible. For a repeatable pipeline, ask GEOPOZ for a
CityGML or database extract rather than treating the viewer as an API. The layer is described as
CityGML, but the viewer serves only 3D Tiles; no CityGML file is exposed.

### 1.5 The earlier "metadata position links did not match" problem

`docs/geodata.md` records that the GEOPOZ city model's "metadata position links did not reliably match
these footprints". This check explains it: the batch-table `GOOGLE_URL` is systematically about
**160–170 m south** of the EGiB footprint in the three Piotrowo records measured (A28 −170 m, A29
−171 m, A30 −163 m in latitude; longitude is within a few metres). It is not a random mismatch and
not a georeferencing error in the tiles.

The reliable key is `E_IDG5` (or `OBJECTID`), which matches the national EGiB `ID_BUDYNKU` suffix.
A join by that key works; a join by `GOOGLE_URL` does not. This is the main practical result for
anyone revisiting the model.

### 1.6 2D EGiB and the other city services

The city's GeoServer is at `https://wms2.geopoz.poznan.pl/geoserver/`. The `egib` workspace has WFS
feature types for parcels, obręby, city boundary and **planned** buildings
(`egib:budynki_projektowane_sql`), but **not** for built buildings. Built buildings are available as
WMS layer `egib:budynki_ewidencyjne_sql`; its `GetFeatureInfo` returns only `OBJECTID`, `STATUS_OPIS`,
`STATUS`, `FUNKCJA` and `OZNACZENIE_FUNKCJI` — no height and no storeys. The WFS does serve parcel
records (`egib:dzialki_ewidencyjne_sql`), which is how the rectorate parcel `04/14/24/8` was located.

The 3D viewer also has `PC_2019` (GUGiK 2019, 12 p/m², no RGB) and `PC_2021` (MESIP 2021, 24 p/m²,
RGB) point clouds, plus small park scans. Both predate the rectorate. No city DSM/DTM/nDSM raster
service was found in the 3D layer list or the `egib`, `urbanistyka` and `adresy_nazwy` workspaces
checked; the height-bearing city product is the 3D building tileset. That is a bounded negative, not
an exhaustive audit of every GEOPOZ workspace.

## 2. National GUGiK sources

### 2.1 NMT and NMPT

`https://www.geoportal.gov.pl/pl/dane/numeryczny-model-terenu-nmt/` and
`https://www.geoportal.gov.pl/pl/dane/numeryczny-model-pokrycia-terenu-nmpt/` document the grids:
NMT 1 m × 1 m (5 m available), NMPT 0.5 m × 0.5 m in cities and 1 m elsewhere. Both are free and
"możliwe do dowolnego wykorzystania". Access is via the "Pobierz dane" module, WMS `GetFeatureInfo`
sheet indexes, WFS sheet indexes, and WCS. The repository already uses the WCS coverages
`DSM_PL-KRON86-NH` / `DTM_PL-KRON86-NH` and the 2024-09-17 ASC sheets; nothing new was found here.
The WCS path does not expose acquisition dates, which is why the dated ASC sheet is preferred.

### 2.2 LiDAR LAS/LAZ

`https://www.geoportal.gov.pl/pl/dane/dane-pomiarowe-lidar-lidar/` says the ALS point clouds are free
and may be used for any purpose, in LAS/LAZ, with classes 2 (ground), 6 (buildings), etc. Coverage is
national at 4–20 p/m², with city flights up to 20 p/m². Two height systems are indexed:
PL-KRON86-NH (older years) and PL-EVRF2007-NH (2018–2025). Downloads come from the "Pobierz dane"
module or the WMS/WFS sheet indexes; the actual file is a direct `opendata.geoportal.gov.pl` link.

The PL-EVRF2007-NH sheet index at
`https://mapy.geoportal.gov.pl/wss/service/PZGIK/DanePomiaroweNMT/WMS/SkorowidzeUkladEVRF2007`
returned one sheet at the campus:

| Field | Value |
|---|---|
| Sheet | `N-33-130-D-d-2-1-3-2` |
| Date | **2024-09-17** |
| Format | LAZ |
| Density | 12 p/m² |
| Horizontal / vertical CRS | PL-1992 / PL-EVRF2007-NH |
| Height / position error | 0.02 m / 0.03 m |
| Scale | 1:1250 |
| Work number | `GK-FOTO.6201.26.2024` |
| Added to PZGiK | 2024-12-06 |
| URL | `https://opendata.geoportal.gov.pl/NumDaneWys/DanePomiaroweLAZ/80269/80269_1538137_N-33-130-D-d-2-1-3-2.laz` |

This is the raw ALS sheet for the same 2024-09-17 campaign that produced the 2024 NMPT already used.
It is not a new date and it predates the rectorate's completion. The 2025 and 2026 layers in the same
EVRF2007 index returned no LAZ link at the campus or at Stary Rynek on 2026-11-19; at those
locations the latest dated sheet remains 2024-09-17. A LAZ-based pass would let us redo the ground
filtering and roof sampling more rigorously, especially for A30's slope, but it would not answer the
rectorate question.

### 2.3 LoD1 2024

The county archive is
`https://opendata.geoportal.gov.pl/InneDane/Budynki3D/LOD1/2024/30/3064.zip` (Poznań, TERYT 3064).
It is CityGML 2.0, free, CC BY 4.0 (as recorded in geodata.md), with `measuredHeight` added in the
2024 release. The repository already uses A30 `measuredHeight = 16.70 m` and A29 `12.78 m` from it.
The same min-ground caveat applies: the LoD1 height is a median ALS roof height above the lowest
terrain point, not an above-ground architectural dimension.

### 2.4 LoD2

The national LoD2 product covers 236 powiaty in 10 voivodeships (CAPAP); Wielkopolskie is not one of
them. `https://kadyb.github.io/rgugik/reference/county_names.html` lists Poznań TERYT `3064` with
`LOD2 = FALSE`. The archive path
`https://opendata.geoportal.gov.pl/InneDane/Budynki3D/LOD2/2017/30/3064.zip` returned **404**; the
alternative `.../LOD2/30/3064.zip` and `.../LOD2/2017/3064.zip` also returned 404. The national LoD2
is therefore not a candidate for Poznań. The city's own LoD2 (section 1) is the only LoD2 available.

### 2.5 EGiB building outlines and storeys

The national aggregate WFS is
`https://mapy.geoportal.gov.pl/wss/service/PZGIK/EGIB/WFS/UslugaZbiorcza` (advertised in
`https://www.geoportal.gov.pl/pl/dane/ewidencja-gruntow-i-budynkow-egib/`). The `ms:budynki`
response carried `ID_BUDYNKU`, `RODZAJ`, `KONDYGNACJE_NADZIEMNE` and `KONDYGNACJE_PODZIEMNE`; the
documented bulk schema adds `pozostale_atrybuty` and `czas_pozyskania`. It answered for the campus
with:

| Building | `ID_BUDYNKU` | `RODZAJ` | above / below |
|---|---|---|---:|
| A28 | `306401_1.0004.AR_14.29/3.1_BUD` | education/science | 4 / 1 |
| A29 | `306401_1.0004.AR_17.18/6.8_BUD` | education/science | 2 / 1 |
| A30 | `306401_1.0004.AR_14.24/2.49_BUD` | education/science | 3 / 1 |
| New rectorate | `306401_1.0004.AR_14.24/8.1_BUD` | office | 4 / 1 |

The GUGiK news item
`https://www.geoportal.gov.pl/aktualnosci/budynki-z-egib-dostepne-do-pobrania-w-serwisie-www-geoportal-gov-pl/`
(2026-02-04) documents the bulk "Budynki" layers: GeoParquet for national/voivodeship and GeoPackage
for voivodeship/powiat, with the same attributes plus `pozostale_atrybuty` and `czas_pozyskania`.
There is **no height field**; this is a footprint and storey source, not a height source. It is
valuable as the authoritative join key for the GEOPOZ LoD2 `E_IDG5` and as a replacement for OSM
`building:levels` where the OSM tag is missing.

The WFS `GetCapabilities` reports `Fees: none` and `AccessConstraints: none`. We did not find a
separate licence statement on the EGiB page; the service terms are the practical reuse statement,
and attribution to GUGiK is the safe default. Personal data from the EGiB register (owners) is not
part of the published building layer.

## 3. Other candidates

### 3.1 OSM height/level completeness

Measured on the committed `tools/data/poz_buildings.json` snapshot (2026-10-28/11-08, padded box
52.377–52.437 N, 16.795–17.005 E):

| Measure | Value |
|---|---:|
| building elements | 43,344 |
| with `height` | 244 (0.56%) |
| with `building:levels` | 32,677 (75.4%) |
| with `roof:levels` | 646 (1.5%) |
| numeric `height` min / median / max | 0.1 / 11.75 / 204.0 m |
| Piotrowo campus bbox elements | 89 |
| campus with `height` | 0 |
| campus with `building:levels` | 64 (72%) |

The `height` tag is too sparse and unqualified (0.1 m to 204 m; no eaves/base distinction) to be a
height source. `building:levels` is usable for a storey-based fallback, which is what the repo
already does. The campus has no `height` tag at all, so OSM cannot confirm the rectorate.

### 3.2 GlobalBuildingAtlas

`https://github.com/zhu-xlab/GlobalBuildingAtlas` and
`https://mediatum.ub.tum.de/1782307` provide a global 3 m height raster and LoD1 models derived from
PlanetScope imagery (2019) with ML. The Europe RMSE is about 4.1 m for the LoD1 product (5.6 m for
the height raster); the height/LoD1 parts are **CC BY-NC 4.0**, and the polygon part is ODbL. It is
global and complete, but it is not a survey, it is 2019 imagery (pre-rectorate), and the
non-commercial clause is a constraint. Not recommended for this repo's verification work.

### 3.3 EUBUCCO, Overture, Google Open Buildings, Microsoft footprints

- **EUBUCCO v0.2** (`https://eubucco.com/`) harmonises 55 cadastral/OSM/Microsoft sources across 30
  countries (EU-27 + UK, NO, CH) with `height` and `floors` plus confidence/provenance. The heights
  are ground truth where a registry supplies them, otherwise merged or ML-estimated; it is a
  continental research product, not a Poznań survey. Not evaluated for the exact Poznań rows here;
  licence is in its docs and was not needed for the negative ranking.
- **Overture Maps buildings** (`https://docs.overturemaps.org/schema/reference/buildings/building/`)
  supports `height`, `num_floors`, `min_height` and roof fields, but the values are optional and come
  from OSM/Microsoft/other sources. Given the 0.56% OSM `height` rate in Poznań, the local height
  coverage is not promising; no Poznań extract was downloaded.
- **Google Open Buildings** (`https://sites.research.google/open-buildings/`) covers Africa, South
  Asia, South-East Asia, Latin America and the Caribbean; **Poland is not in the country list**. It
  has no heights in the released product anyway.
- **Microsoft Global ML Building Footprints** (`https://github.com/microsoft/GlobalMLBuildingFootprints`)
  is a 2D footprint dataset; it has no heights. EUBUCCO and Overture fold Microsoft footprints into
  their products, so it is not a separate height candidate.

### 3.4 Commercial nDSM

No commercial provider was purchased or evaluated. The free national NMPT−NMT is the only free nDSM
raster with a documented date for Poznań; a commercial nDSM would have to be bought and would still
need a post-completion acquisition date to answer the rectorate question. Not a practical candidate
for this repo.

## 4. What it would take to consume the best candidate

The best available candidate is the **GEOPOZ LoD2 3D Tiles**. A minimal consumer does not need a
CityGML or glTF parser:

1. Fetch `https://sip.poznan.pl/model3d/dane/7e33f7d8-1e49-4e91-84d0-d6be67b3b1de/tileset.json`
   and recursively collect every `content.uri` (946 for LoD2).
2. Download each `.b3dm`. Parse the 28-byte header, the feature-table JSON (`BATCH_LENGTH`,
   `RTC_CENTER`) and the batch-table JSON. No GLB geometry decode is needed for attributes.
3. Emit one row per feature: `E_IDG5`, `OBJECTID`, `measuredHeight`, `BREC_GroundLevel`,
   `BREC_HighestRoof`, `BREC_LowestRoof`, `E_LKON_N`, `E_RFUN_NAZWA`, `S_DTUOB_L1`,
   `S_DTUOB_L2`, `S_ZNMPT_L1`, `S_ZNMPT_L2`. Keep per-part rows; if a single value per building is
   needed, aggregate by `OBJECTID` and state whether the highest roof or a chosen main part is used.
4. Join by `E_IDG5` to the national EGiB `ID_BUDYNKU` suffix (`306401_1.<E_IDG5>`). For OSM
   footprints, use a spatial join; do **not** use `GOOGLE_URL`, which is ~170 m south.
5. Recompute above-ground height as `BREC_HighestRoof − local DTM ground` (the 2024 NMT/ASC already
   used), not `measuredHeight`/`BREC_GroundLevel`, especially on sloping sites like A30. Keep the raw
   `BREC_*` values in the derived record.
6. Do not treat the rectorate's `S_WYS_L1 = 12` as a survey; it is storey-derived. A post-completion
   LiDAR/NMPT or an as-built survey is still required for 16.31 m.
7. If the derived heights are shipped, keep only the statistics/derived values, not the tiles, and
   attribute ZGiKM GEOPOZ with the creation date (2024-06-19) and acquisition date. The repository
   already follows this pattern for GUGiK raster data.

A one-off crawl is ~946 requests. For a repeatable pipeline, request a CityGML/DB extract from
GEOPOZ/MODGiK; the viewer is not a documented bulk service.

## 5. Limits of this check

- The LoD2 crawl was sampled, not exhaustive: the Piotrowo tiles and the four buildings were read,
  but all 946 tiles were not downloaded. The batch-table schema was consistent in the sample.
- The 2024 LAZ file was identified and its metadata read, but the point cloud was not downloaded or
  classified here. A LAZ-based height would need a ground filter and a footprint sampler.
- The national EGiB WFS was queried for the campus; the "Dane powiatowe" GeoParquet/GPKG bulk files
  were not downloaded. The schema is documented in the 2026-02-04 news item.
- The 2025/2026 LIDAR index was checked at the campus and Stary Rynek only. A sheet could exist
  elsewhere in Poznań; none covers the rectorate.
- The batch-table field semantics are observed, not documented publicly. `measuredHeight =
  BREC_HighestRoof − BREC_GroundLevel` was verified on A28, A29 and A30; other fields are named but
  not independently validated.
- OSM counts are from the committed snapshot, not live OSM; the snapshot predates this check by
  about three weeks.
- No commercial provider was contacted, and no paid data was purchased.

## 6. Recommended next step

Do not change the A28/A29/A30/rectorate heights on the strength of this check. The city model is a
useful independent cross-check for existing buildings, but it is 2020–2021 roof geometry and its
`measuredHeight` is min-ground based. For the rectorate, the documented 16.31 m remains the best
available figure; the 12 m city value is storey-derived and would be a regression. Revisit when
GUGiK publishes a post-completion LiDAR/NMPT sheet for Poznań, or when PP supplies an as-built
survey.

If the city-wide height join is wanted before then, the LoD2 batch-table crawl is the lowest-effort
path; it needs no new dependency and no CityGML parser. Keep it as a research tool, not a runtime
data source.

## Sources and access dates

All URLs were fetched on **2026-11-19**.

| Source | URL |
|---|---|
| SIP portal | `https://sipgeoportal.geopoz.poznan.pl/` |
| 3D viewer | `https://sip.poznan.pl/model3d/` |
| 3D app config | `https://sip.poznan.pl/model3d/app.config.json` |
| Layer metadata | `https://sip.poznan.pl/model3d/dane/metadane_images/warstwy.json` |
| LoD2 tileset | `https://sip.poznan.pl/model3d/dane/7e33f7d8-1e49-4e91-84d0-d6be67b3b1de/tileset.json` |
| LoD1 tileset | `https://sip.poznan.pl/model3d/dane/dadcaea8-79ee-4ae6-bf02-638a444266a9/tileset.json` |
| `Db_budynki` tileset | `https://sip.poznan.pl/model3d/dane/94edf024-96b0-4716-8cf2-56aa41346a15/tileset.json` |
| GEOPOZ reuse terms | `https://bip.geopoz.poznan.pl/gpb/ponowne-wykorzystywanie/1696,Ponowne-wykorzystywanie-informacji-sektora-publicznego.html` |
| GEOPOZ EGiB WMS | `https://wms2.geopoz.poznan.pl/geoserver/egib/wms` |
| GEOPOZ EGiB WFS | `https://wms2.geopoz.poznan.pl/geoserver/egib/wfs` |
| National EGiB WFS | `https://mapy.geoportal.gov.pl/wss/service/PZGIK/EGIB/WFS/UslugaZbiorcza` |
| EGiB page | `https://www.geoportal.gov.pl/pl/dane/ewidencja-gruntow-i-budynkow-egib/` |
| EGiB buildings bulk news | `https://www.geoportal.gov.pl/aktualnosci/budynki-z-egib-dostepne-do-pobrania-w-serwisie-www-geoportal-gov-pl/` |
| LIDAR page | `https://www.geoportal.gov.pl/pl/dane/dane-pomiarowe-lidar-lidar/` |
| LIDAR sheet index (EVRF2007) | `https://mapy.geoportal.gov.pl/wss/service/PZGIK/DanePomiaroweNMT/WMS/SkorowidzeUkladEVRF2007` |
| 2024 LAZ sheet | `https://opendata.geoportal.gov.pl/NumDaneWys/DanePomiaroweLAZ/80269/80269_1538137_N-33-130-D-d-2-1-3-2.laz` |
| NMT page | `https://www.geoportal.gov.pl/pl/dane/numeryczny-model-terenu-nmt/` |
| NMPT page | `https://www.geoportal.gov.pl/pl/dane/numeryczny-model-pokrycia-terenu-nmpt/` |
| 3D building models page | `https://www.geoportal.gov.pl/pl/dane/modele-3d-budynkow/` |
| LoD1 2024 Poznań | `https://opendata.geoportal.gov.pl/InneDane/Budynki3D/LOD1/2024/30/3064.zip` |
| LoD2 Poznań attempt (404) | `https://opendata.geoportal.gov.pl/InneDane/Budynki3D/LOD2/2017/30/3064.zip` |
| rgugik LOD2 availability | `https://kadyb.github.io/rgugik/reference/county_names.html` |
| GlobalBuildingAtlas | `https://github.com/zhu-xlab/GlobalBuildingAtlas` |
| GlobalBuildingAtlas DOI | `https://mediatum.ub.tum.de/1782307` |
| EUBUCCO | `https://eubucco.com/` |
| Overture buildings schema | `https://docs.overturemaps.org/schema/reference/buildings/building/` |
| Google Open Buildings | `https://sites.research.google/open-buildings/` |
