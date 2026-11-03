# Landmark height measurements and research — 2026-11-03

Investigation and sourced survey of landmark building heights in Poznań, comparing current model geometry
against primary municipal, architectural, owner, and heritage records.

## Survey methodology and source criteria

Each landmark's produced height and key sub-heights (eave, ridge, terrace, crown, and tower tops) were recorded
directly from the runtime landmark area modules (`js/landmarks-*.js`).
Real-world measurements were gathered prioritizing:
1. Primary / official sources: building owners, developers, municipal records (Urząd Miasta Poznania, ZDM, EMUiA),
   architects' portfolios (Pracownia Architektoniczna Ewy i Stanisława Sipińskich, JEMS Architekci, AD Artis Architects),
   and heritage register documentation (Narodowy Instytut Dziedzictwa — zabytek.pl).
2. Specialized building databases: CTBUH The Skyscraper Center, Urbanity.pl.
3. OpenStreetMap curated tags only when backed by official administrative survey imports (`source:addr=EMUiA`).
4. Wikipedia articles only when citing verified primary documents or municipal sources.
5. Where no documented measurement exists in primary records, the entry is explicitly recorded as "no source"
   and left unchanged to avoid inventing numbers.

## Research comparison table

| Landmark (Polish / English) | Current code height & sub-heights (file:line) | Sourced real height & scope | Primary source URL & attribution | Confidence | Difference (m) |
|---|---|---|---|:---:|:---:|
| **Ratusz**<br>Poznań Town Hall | Eave: 16.0 m (`js/landmarks-rynek.js:170`)<br>Attic screen: 24.5 m (`:171`)<br>Belfry gallery: 36.2 m (`:278`)<br>Spire / eagle tip: 61.0 m (`:305, 339`) | **61.0 m** to crowned eagle tip above ground;<br>16.0 m to main block eaves;<br>Eagle: 1.8 m tall, 2.0 m wingspan | [Lonely Planet](https://www.lonelyplanet.com/poland/wielkopolska/poznan/attractions/town-hall/a/poi-sig/480104/360352) (61 m tower height);<br>[Codzienny Poznań](https://codziennypoznan.pl/artykul/2016-07-08/na-szczycie-poznania-niezwykle-zdarzenie-na-wiezy-ratusza/) (2016 spire survey);<br>OSM way 30611684 (`height=16`, EMUiA) | Medium (spire)<br>High (eaves) | 0.0 m |
| **Fara**<br>Bazylika kolegiacka MB Nieustającej Pomocy | Aisle wall: 17.0 m (`js/landmarks-heritage.js:151`)<br>Nave wall: 29.0 m (`:149`)<br>Front upper cornice: 33.0 m (`:153`)<br>Pediment statue: 40.8 m (`:207`)<br>Roof ridge: 40.0 m (`:150, 217`) | Interior nave vault: **27.0 m**;<br>Pseudodome vault: **28.5 m**;<br>Column capitals: **17.5 m**;<br>Exterior roof ridge / facade: **No source** | [fara.archpoznan.pl](https://fara.archpoznan.pl/pl/wnetrze-kosciola/29-nawa-glowna) (Archidiecezja Poznańska / Parafia Farna);<br>NID register A-149 ([zabytek.pl](https://zabytek.pl/pl/obiekty/g-266950)) | None (exterior ridge)<br>High (interior nave) | N/A (no source) |
| **Zamek Królewski**<br>Royal Castle on Przemysł Hill | Wing eave / ridge: 13.0 / 21.0 m (`js/landmarks-heritage.js:228-229`)<br>Main eave / ridge: 16.0 / 28.0 m (`:226-227`)<br>Tower lower terrace: 33.0 m (`:230`)<br>Tower apex: 43.0 m (`:231, 289`) | Tower apex: **43.0 m**;<br>Covered viewing terrace: **30.0 m**;<br>Medieval base: **6.0 m** | [mnp.art.pl](https://mnp.art.pl/profile/zamek) (Muzeum Narodowe w Poznaniu);<br>[poznan.pl](https://www.poznan.pl/mim/turystyka/inne-atrakcje,poi,3391/-,61910.html) (Urząd Miasta Poznania) | High | Tower apex: 0.0 m<br>Terrace: +3.0 m (33.0 vs 30.0 m) |
| **Teatr Wielki**<br>Grand Theatre / Opera | Foyer eave / ridge: 14.0 / 17.6 m (`js/landmarks-centrum.js:170-172`)<br>Auditorium dome: 25.6 m (`:175`)<br>Portico pediment: 21.6 m (`:195`)<br>Stage fly tower: 27.0 m (`:23, 178, 220`) | Fly tower / exterior apex: **No source**;<br>(OSM `height=1` is corrupted; architectural monograph by J. A. Lux 1910 and NID A-213 give floor dimensions only) | [zabytek.pl](https://zabytek.pl/pl/obiekty/poznan-teatr-wielki) (NID register A-213);<br>[opera.poznan.pl](https://opera.poznan.pl/) (Teatr Wielki) | None | N/A (no source) |
| **Brama Poznania ICHOT**<br>Porta Posnania | Concrete block height: 18.0 m (`js/landmarks-heritage.js:296, 303, 316`)<br>Glazed viewing slit: 17.4 m (`:306`)<br>Interior walkways: 4.5, 9.0, 13.5 m (`:307`) | Architectural concrete largest external wall: **32.9 × 16.3 m** (Murator also notes height ≈ half base side, ~15 m) | [Architektura Murator](https://architektura.muratorplus.pl/prezentacje/realizacje/brama-poznania-miedzy-nowym-starym-aa-bLud-VvrV-cop1.html) (AD Artis Architects technical project record) | High | +1.7 m (18.0 vs 16.3 m) |
| **Iglica (Pawilon 11 MTP)**<br>MTP Spire Pavilion | Lower rotunda drum: 6.5 m (`js/landmarks-dworzec.js:261`)<br>Rotunda roof: 12.6–13.0 m (`:265, 276`)<br>Lattice spire: y = 13.0–58.0 m (`:276-277`)<br>Spire mast & star apex: 64.0 m (`:306, 312`) | **70.0 m** per Grupa MTP ("Licząca 70 m wysokości", measurement point unspecified); conflicting figures: pl.wikipedia & lazarz.pl cite 64 m, Głos Wielkopolski cites 73 m | [mtp.pl](https://www.mtp.pl/pl/o-nas/sladami-targowej-architektury/) (Grupa MTP official architectural history) | Medium | -6.0 m (64.0 vs 70.0 m) |
| **AND2 (Andersia Silver)**<br>Plac Andersa | NNE wing roof: 92.0 m (`js/landmarks-towers.js:262, 270`)<br>SSW tower roof slab: 106.0 m (`:261, 271`)<br>Crown screen apex: 116.0 m (`:273, 277`) | **115.37 m** above ground (±0.00; 183.57 m a.s.l.); 26 storeys;<br>116 m commercial rounded figure | [sipinski.eu](https://sipinski.eu/pl/project/79) (Pracownia Architektoniczna Ewy i Stanisława Sipińskich) | High | +0.63 m (116.0 vs 115.37 m) |
| **Bałtyk**<br>Rondo Kaponiera | Core top (level 17): 67.0 m (`js/landmarks-towers.js:31, 34, 163`)<br>NW terraces: 63.1 → 43.4 m (`:36-41`)<br>SW terraces: 63.1 → 19.7 m (`:43-54`) | **67.0 m** to architectural top / roof terrace;<br>17 storeys (16 office levels + roof restaurant) | [CTBUH Skyscraper Center](https://www.skyscrapercenter.com/);<br>[pl.wikipedia](https://pl.wikipedia.org/wiki/Biurowiec_Ba%C5%82tyk) (citing Garvest / MVRDV);<br>[mvrdv.com](https://www.mvrdv.com/projects/51/baltyk) | High | 0.0 m |
| **Collegium Altum**<br>Uniwersytet Ekonomiczny | Podium roof: 16.0 m (`js/landmarks-towers.js:177, 180`)<br>Solid crown: 67.7–78.45 m (`:202`)<br>Antenna mast tip: 103.35 m (`:210, 215`) | **103.35 m** to antenna mast tip;<br>78.45 m to crown / plant room roof | [ue.poznan.pl](https://ue.poznan.pl/aktualnosci/bieg-po-schodach-collegium-altum-2025/) (Uniwersytet Ekonomiczny w Poznaniu);<br>OSM ways 239809212–239809228 | High | 0.0 m |
| **Andersia Tower**<br>Plac Andersa 3 | Conference wing roof: 14.0 m (`js/landmarks-towers.js:237`)<br>Main slab roof: 84.0 m (`:227`)<br>Crown screen mast tip: 102.1 m (`:245, 249`) | **102.0 m** (102.1 m) to architectural mast tip;<br>84.0 m to main roof slab | [andersia-tower.pl](https://andersia-tower.pl/en/intro.html) (Andersia Tower management: "building height – 102 m");<br>OSM way 436542397 (`height=84`) | High | +0.1 m |
| **Poznań Financial Centre**<br>PFC, Plac Andersa 5 | Low wing: 44.0 m (`js/landmarks-towers.js:294`)<br>Main slab: 76.0 m (`:291`)<br>Curved glass crest apex: 91.0 m (`:305, 312`) | **91.1 m** (91.0 m) to barrel-vaulted crest apex above ground;<br>18 above-ground storeys | [CTBUH Skyscraper Center](https://www.skyscrapercenter.com/building/poznan-financial-centre/28509);<br>[Von der Heyden Group](https://www.vonderheydengroup.com/real-estate/poznan-financial-centre/) | High | 0.0 m |
| **Novotel Poznań Centrum**<br>Hotel Poznań, Plac Andersa 1 | Podium deck: 8.0 m (`js/landmarks-towers.js:343`)<br>Guest wings: 64.0 m (`:324, 333`)<br>Core plant room top: 68.0 m (`:337, 353`) | **No source**;<br>(model unchanged at 68 m; OSM way 36456643 tags `height=68` without source) | No source found | None | N/A (no source) |
| **Nowy Rynek E**<br>ul. Wierzbięcice 1a | Office volume roof: 54.0 m (`js/landmarks-towers.js:366`)<br>Top terrace & screen: 66.0 m (`:369-378, 382`) | **66.0 m** to top of 3-storey crown screen;<br>15 above-ground storeys | [en.wikipedia](https://en.wikipedia.org/wiki/List_of_tallest_buildings_in_Pozna%C5%84) (List of tallest buildings in Poznań);<br>[jems.pl](https://jems.pl/projekty/biurowe/nowy-rynek.html) (JEMS Architekci portfolio) | Medium | 0.0 m |
| **Biurowiec Delta**<br>ul. Towarowa 35 | Low west wing roof: 17.0 m (`js/landmarks-towers.js:404`)<br>High triangular block: 34.0 m (`:403`)<br>Stair towers / plant top: 37.4 m (`:406-408, 413`) | **43.5 m** above ground (dominanta 43,5 m);<br>11 storeys in high part, 6 in low part | [ataner.pl](https://www.ataner.pl/pl/ul-towarowa-delta) (Ataner Sp. z o.o., developer);<br>[sipinski.eu](https://sipinski.eu/pl/project/30) (Sipińscy) | High | -6.1 m (37.4 vs 43.5 m) |

## Key observations and candidate corrections for Phase 2

1. **Biurowiec Delta (Towarowa 35):** The model previously estimated 37.4 m based on an assumed 1970s 11 × 3.4 m
   storey schedule. The actual building, constructed in 2002–2004 by Ataner and designed by Pracownia Architektoniczna
   Ewy i Stanisława Sipińskich, has a documented height of **43.5 m** (an increase of +6.1 m or 16.3%, well over the 5% / 1.5 m
   threshold).
2. **Iglica (Pawilon 11 MTP):** Grupa MTP's official architectural history records the spire at 70 m ("Licząca 70 m
   wysokości iglica", measurement point unspecified). Conflicting secondary figures exist (pl.wikipedia MTP article and
   lazarz.pl state 64 m, while Głos Wielkopolski has cited 73 m). Following the owner's official figure, the model is
   adjusted to 70 m (+6.0 m diff, confidence medium).
3. **Brama Poznania ICHOT:** AD Artis Architects' technical project record in *Architektura Murator* documents the
   largest external monolithic architectural-concrete wall at 32.9 × 16.3 m (Murator also notes building height ≈
   half the base side, ~15 m). The model's concrete block is updated from 18.0 m to 16.3 m (-1.7 m diff).
4. **Zamek Królewski:** The tower apex matches the documented 43.0 m exactly. However, the covered viewing terrace
   authored at `towerShaft = 33 m` differs from the Muzeum Narodowe w Poznaniu and municipal records specifying the
   terrace at **30.0 m** (-3.0 m, 9.1% error, over 1.5 m).
5. **Fara, Teatr Wielki, and Novotel:** Exterior roof/ridge/fly-tower heights for Fara and Teatr Wielki, and Novotel's
   building height, lack documented primary measurements in municipal, owner, or heritage archives. Following the
   task rules, they are categorized as "no source" and left unchanged.
