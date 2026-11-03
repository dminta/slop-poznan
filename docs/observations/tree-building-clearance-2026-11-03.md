# Tree-Building Clearance Audit and Implementation — 2026-11-03

## Executive Summary

Following player reports of buildings overlapping trees (trunks embedded in walls and crowns protruding through
facades), this investigation analyzed and resolved the spatial clearance between trees and building/landmark colliders
in the Poznań world model.

The issue was investigated in Phase 1 (measure and propose) and resolved in Phase 2 (implementation of root-cause
fixes, deterministic clearance, and regression testing).

### Audit & Resolution Summary

| Metric | Baseline (Pre-Fix) | Phase 2 Implemented |
|---|---:|---:|
| **Total city trees** | 55,381 | 50,019 |
| **Narrow street trees** | 15,096 | 15,084 |
| **Wide street trees** | 3,065 | 3,027 |
| **Park trees** | 37,084 | 31,775 |
| **Plaza planters** | 136 | 133 |
| **Leftover slabs** | 0 | 0 |
| **Trunks inside footprints (d <= 0 m)** | **1,721 (3.11%)** | **0 (0.00%)** |
| **Trunks within 1.0 m of wall (0 < d < 1 m)** | **378 (0.68%)** | **0 (0.00%)** |
| **Trunks within 1.0–2.0 m of wall** | **445 (0.80%)** | **1 (0.00%)** |
| **Trunks within 2.0–3.0 m of wall** | 455 (0.82%) | 24 (0.05%) |
| **Crown wall overlaps (d < R_crown)** | **4,062 (7.33%)** | **0 (0.00%)** |
| **41 built park blocks: generated built area** | 458.7 k m² (6.64%) | 238.8 k m² (3.46%) |
| **41 built park blocks: real OSM built area** | 303.1 k m² (4.39%) | 303.1 k m² (4.39%) |
| **41 built park blocks: building count** | 2,553 | 1,208 |

---

## Root Causes Identified

### Root Cause A: Park Blocks with Mapped Buildings
In `js/city-grid.js` (line 743), any block with `park > 0.6 && area > 250` was treated as a park block and paved and
planted throughout (lines 1027–1036). Meanwhile, `js/buildings.js` skipped only blocks with `park > 0.6 && !b.buildings`,
and the park-cell carve-out (`parkFreeCells`) was executed only for `park <= 0.6`.
As a result, 41 blocks that had both `b.park > 0.6` and `b.buildings > 0` were built over completely on top of park
paving and trees, causing 1,666 out of the 1,714 embedded park trunks.
The remaining 48 embedded park trees arose from part-park ring trees planted 10 m inside block boundaries
(`city-grid.js:1057, 1111`) overlapping the 20 m building cells (`PARK_CELL = 20`) in `buildings.js`.

### Root Cause B: Street Trees Missing Collider Checks
In `js/street-details.js` (`addStreetTree`), street trees sit 0.9–1.25 m inside the curb and checked exclusions for
plazas (`inPlaza`), tram track clearance, traffic signal poles, and bridge railings, but never checked
`buildingColliders`, despite `buildStreetDetails` receiving them in `main.js:96`. Where building footprints or
landmark oriented bounding boxes (OBBs) closely abutted sidewalks, street trees were placed through facades.

---

## Baseline Clearance Distribution (Phase 1)

At baseline, before Phase 2 fixes, the city tree population was distributed as follows against all colliders:

| Generation Source | Total Count | Inside (<= 0 m) | 0 < d < 1 m | 1 <= d < 2 m | 2 <= d < 3 m | 3 <= d < 5 m | d >= 5 m | Crown Wall Overlap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **Street trees (narrow)** | 15,096 | 1 (0.01%) | 0 (0.0%) | 1 (0.01%) | 12 (0.08%) | 2,164 (14.3%) | 12,918 (85.6%) | 2 (0.01%) |
| **Street trees (wide)** | 3,065 | 6 (0.20%) | 2 (0.07%) | 6 (0.20%) | 22 (0.72%) | 472 (15.4%) | 2,557 (83.4%) | 45 (1.47%) |
| **Park sites** | 37,084 | 1,714 (4.62%) | 375 (1.01%) | 438 (1.18%) | 421 (1.14%) | 879 (2.37%) | 33,257 (89.7%) | 4,012 (10.82%) |
| **Plaza planters** | 136 | 0 (0.0%) | 1 (0.74%) | 0 (0.0%) | 0 (0.0%) | 3 (2.21%) | 132 (97.1%) | 3 (2.21%) |
| **Leftover slabs (B6)** | 0 | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) |
| **BASELINE TOTAL** | **55,381** | **1,721 (3.11%)** | **378 (0.68%)** | **445 (0.80%)** | **455 (0.82%)** | **3,518 (6.35%)** | **48,864 (88.23%)** | **4,062 (7.33%)** |

### Verified Worst In-Game Examples at Baseline

1. **`(-1410.9, 689.7)` through `(-1435.9, 810.3)` (Avenida shopping centre)**: 6 wide street trees embedded inside the
   `AVENIDA` landmark footprint (clearance -0.85 m to -0.02 m).
2. **`(1324.9, -311.0)` (Śródka mural)**: Narrow street tree trunk embedded -1.69 m inside `SRODKA_MURAL` collider on
   Śródka (note: 146 m from Brama Poznania).
3. **`(4242.1, 1168.0)` through `(4434.1, 853.7)` (Antoninek-Zieliniec-Kobylepole, block 874)**: Park trees embedded
   -10.5 m to -11.4 m inside commercial `lowrise` building footprints due to uncarved park blocks.

---

## Arboricultural and Statutory Grounding

A review of arboricultural guidelines and construction standards established objective setback parameters:

### 1. British Standard BS 5837:2012
- **BS 5837:2012 Table A.1** (*Minimum distance between tree stem and structure*):
  - Stem diameter 300–600 mm: minimum distance **0.5 m**.
  - Stem diameter > 600 mm: minimum distance **1.2 m**.
- **BS 5837:2012 §5.6.2.1**: Tree canopies should be selected and positioned such that they reach maturity without
  touching structures or requiring mutilating canopy pruning.

### 2. Polish Statutory Building Regulations
- **Technical Conditions for Buildings (*Warunki Techniczne*, Rozporządzenie Ministra Infrastruktury)**:
  - **WT § 266 ust. 4**: Mandates at least **6.0 m** clearance from smoke/flue chimney outlets to tree crowns (a
    fire-safety rule for exhausts, not a general building facade planting distance).
  - Underground gas distribution pipelines require 2.0 m (low/medium pressure) to 3.0 m (high pressure) clearance from
    tree stems (*Rozporządzenie MG*).
- **Poznań Municipal Greenery Standards (*Standardy ochrony drzew w Poznaniu*)**:
  - Zarządzenie Prezydenta Miasta Poznania nr 399/2022/P z dnia 17 maja 2022 r. governs tree protection in construction
    zones (establishing Tree Protection Zones based on crown drip line), but contains no statutory minimum planting
    distance from facades. (Note: earlier citation to 536/2021/P was erroneous).
- **German FLL / Warsaw 2016 Guidelines**:
  - Unverified municipal guidelines suggest 2.5–5.0 m depending on tree size, consistent with crown radius clearance.

### Adopted Clearance Rule
For every tree (street and park), the required horizontal trunk-to-wall distance is:
  d_min = max(floor, R_crown * squeeze)
where:
- Species mature crown radii (R_crown) from `js/trees.js`:
  - Lime (*Tilia cordata*): 4.53 m
  - Maple (*Acer platanoides*): 4.74 m
  - Horse Chestnut (*Aesculus hippocastanum*): 6.07 m
  - Black Locust (*Robinia pseudoacacia*): 4.55 m
- Scaled by individual tree instance `scale` (typically 0.6–1.2).
- Hard floor from BS 5837 Table A.1:
  - Large species (lime, maple, chestnut, robinia): **1.2 m**
  - Small / narrow street trees (Tier 2): **0.5 m**
- Squeeze factor: squeeze applies in every direction during the clearance check.
- Height filter: colliders are ignored if their vertical interval [minY, maxY] does not intersect the crown height
  band [y, y + 13 * scale].

---

## Phase 2 Implementation Details

### 1. Fix Root Cause A at the Source
- **Exported Shared Helpers in `js/city-config.js`**:
  - `pointInPark`, `parkFreeCells`, `blockLots`, and `distToLots`.
  - Fixed coordinate transform in `pieceInPark` to properly un-rotate block coordinates into world coordinates.
- **`js/buildings.js`**:
  - Carves out park cells via `parkFreeCells` for **all** blocks with `b.park > 0 && b.buildings > 0`, ensuring
    buildings are only placed in cells clear of park rings.
- **`js/city-grid.js`**:
  - Computes `blockLots(b)` deterministically for built blocks. In Sections 6 and 6B, park trees are skipped if:
    distToLots(tx, tz, bLots) < max(1.2, 6.07 * scale)
  - `PARK_TREE_EDGE` remains at 10 m inside part-park rings.

#### Density Impact on the 41 Park Blocks with Buildings
- Total land area: **6.91 km²**
- Real OSM built area from `GEO.blockStats`: **303.1 k m² (4.39% built share)**
- Baseline generated built area: **458.7 k m² (6.64%)** across 2,553 building footprints.
- Post-fix generated built area: **238.8 k m² (3.46%)**, after steering the carved blocks by their full lot area.
- *Analysis*: Baseline generated built area over-built the park blocks (6.64% vs 4.39% real). The park cell carve-out
  restricts building placement to non-park terrain, bringing generated density closer to the true character of green
  park blocks while maintaining district-wide density within +-20% tolerances (verified by
  `tests/buildings-density.test.cjs`).

### 2. Fix Root Cause B and General Clearance Rule
- **Spatial Index in `js/street-details.js`**:
  - Pre-indexes `buildingColliders` (landmarks, buildings, bridges) into a 32 m spatial hash grid.
  - Clearance function `isClearOfWalls` tests candidate tree positions against nearby collider AABBs and OBBs within
    the tree crown height band [y, y + 13 * scale].
- **Street Tree Jitter & Sliding**:
  - Evaluates `r` thinning hash and species at the jittered position exactly as in base code.
  - On sidewalk/plaza/pole/rail failure, the tree is skipped (no retry, preserving original spacing).
  - When only the wall check fails, the tree attempts sliding along the curb within standard jitter bounds
    (shifts +-0.4 m, +-0.8 m, +-1.2 m, +-1.6 m) before dropping.
- **Orphan Collider Removal**:
  - `street-details.js` drops 29 park/planter trees that collide with building/bridge/landmark walls (23 under bridge
    colliders, 1 at Pomnik Czerwca 1956, 3 at Domki Budnicze / Stary Browar, 2 others).
  - Each dropped site has its trunk prop collider removed from `grid.propColliders`.
  - All remaining 31,908 trunk colliders match active tree sites, leaving exactly 0 orphan trunk colliders.

### 3. Performance Overhead
- Spatial grid construction: ~15 ms for 37.8k colliders.
- Full `street-details.js` build time in headless harness:
  - Without colliders: mean 6,350 ms
  - With colliders: mean 7,285 ms
  - Overhead: ~935 ms in headless Node across the entire city; sub-frame in browser execution.

---

## Post-Fix Audit Results (Phase 2)

Running `tools/audit-tree-clearance.mjs` on the completed implementation produces:

```
========================================================================================
SUMMARY TABLE: TREE-BUILDING CLEARANCE BY SOURCE AND DISTANCE BUCKET
========================================================================================
Source                   Total  Inside (<=0)     < 1 m     1–2 m     2–3 m     3–5 m     > 5 m  Crown Wall Overlap
----------------------------------------------------------------------------------------------------------------------------
street trees narrow      15084             0         0         1        15      2173     12895                   0
street trees wide         3027             0         0         0         9       467      2551                   0
park sites               31775             0         0         0         0         1     31774                   0
plaza planters             133             0         0         0         0         1       132                   0
leftover slabs               0             0         0         0         0         0         0                   0
----------------------------------------------------------------------------------------------------------------------------
CITY TOTAL               50019             0         0         1        24      2642     47352                   0
```

- **Trunks inside footprints (d <= 0 m):** **0**
- **Trunks < 1.0 m:** **0**
- **Trunks 1.0–2.0 m:** **1** (narrow street tree at (-858.2, 2755.1) at 1.92 m, crown clearing wall)
- **Crown wall overlaps:** **0**
- **Orphan trunk prop colliders:** **0** (all 31,908 trunk colliders match active tree sites)

---

## Test Verification

1. **Regression Test `tests/tree-clearance.test.mjs`**:
   - Asserts 0 trunks inside building/landmark/bridge colliders, 0 crown-wall overlaps under the clearance rule, and
     0 orphan trunk prop colliders across all 50,019 trees.
2. **Snapshot Test `tests/tree-distribution.test.cjs`**:
   - Tested against partial fixture with block colliders only (excluding landmarks and bridges), verifying 50,092
     trees with updated snapshots.
3. **Density Test `tests/buildings-density.test.cjs`**:
   - All 6 districts pass within target density tolerances.
4. **Full Test Suite `node --test tests/`**:
   - All tests pass.
