# Future scenarios: El Uvito and La Palma

## What the map now does

The **Future** tab compares additional building demand, possible expansion zones and tree-cover change from **2025 to 2040**. Two housing models are available: a trend in the project's historical roof polygons, and demand associated with a population-growth scenario. Tree cover can follow a mapped linear trend or a chosen protection/restoration policy.

These are conditional scenarios for a training discussion. A highlighted zone means that the allocation rules selected it; it is not a prediction of a particular family's move, a planning permission or a declaration of safety. Population and land-cover totals apply to the **existing study boundaries**, including their rural surroundings, rather than only the informal housing clusters.

## New data and what each source measures

| Source | Dates used | Role | Important distinction |
| --- | --- | --- | --- |
| Original project building detections | 2010, 2019, 2021 | Historical roof-area trend and occupation mask | Polygon parts, not dwellings or households |
| Medellín historical cadastre, Construccion_2025 | 2025 | More recent outlines and occupation mask | Approximate outlines extracted from a georeferenced map export |
| Esri / Impact Observatory Sentinel-2 land cover | 2021, 2023, 2025 | Tree-cover history and current built-land mask | Classified 10 m pixels, not a forest inventory |
| WorldPop Global2 R2025A v1, Colombia constrained population | 2025, 2030 | Population baseline and default regional growth rate | Modelled people per 100 m cell; not a local census |
| Existing Medellín DEM and aerial image | 2024 | Terrain, slope and background image | The original map assets remain unchanged |
| Existing project hazard and riparian layers | POT 2014 / project GIS | Spatial exclusions | Dated mapped evidence, with no new hazard simulation |

The cadastre service returned attributes without vector geometry during preparation. Its public map export was therefore rendered with a uniform construction fill, georeferenced, polygonized and clipped. Overlapping storeys become a single outline. Pools, balconies, free areas and sports courts were excluded by construction type. The resulting 218 El Uvito and 490 La Palma patches are **map-derived outlines**, with uncertainty from rasterization, merging and cadastral coverage. The script does not publish owner identities or other personal fields.

Do not append those counts to the original detection series and call the difference housing growth: the datasets have different definitions and methods. Only the original 2010/2019/2021 roof series enters the historical housing model.

### Baselines within the study boundaries

| Measure | El Uvito | La Palma |
| --- | ---: | ---: |
| WorldPop 2025 estimated population | approximately 280 | approximately 1,810 |
| WorldPop 2030 projected population | approximately 310 | approximately 1,920 |
| Implied annual population growth, 2025–2030 | 2.08% | 1.21% |
| Mapped tree cover, 2021 | 74.13 ha | 565.41 ha |
| Mapped tree cover, 2023 | 49.28 ha | 531.42 ha |
| Mapped tree cover, 2025 | 54.54 ha | 540.53 ha |
| Original roof area, 2010 | 0.624 ha | 4.394 ha |
| Original roof area, 2019 | 0.833 ha | 5.731 ha |
| Original roof area, 2021 | 1.614 ha | 5.106 ha |

Population totals were calculated by intersecting each **native WorldPop cell** with the projected study polygon, then multiplying its people count by the intersecting area fraction. Counts were not resampled as if they were elevation values. The published Global2 product is an alpha release; local counts and validation are still needed, particularly in small informal areas.

## Models and assumptions

### 1. Building-footprint trend

An ordinary least-squares line is fitted to original roof area against year. It yields approximately **0.0696 ha/year** for El Uvito and **0.0903 ha/year** for La Palma. The scenario's additional roof area after 2025 is:

`extra roof area = max(0, fitted annual slope × (target year − 2025))`

Dividing this extra area by the average 2021 detected polygon area produces **footprint equivalents**. An equivalent is an area unit represented by a typical detected polygon, not an independently counted house. The default 2030 scenarios produce 52 and 64 equivalents respectively. The 2021–2025 period has no comparable roof observation: extending the trend across that gap is an assumption, not a measured 2025 roof total. La Palma's 2019–2021 decline also shows why a single linear line should be explored alongside alternatives.

### 2. Population-related housing demand

The default annual rate is the compound rate between the WorldPop 2025 and 2030 **modelled totals**:

`r = (P2030 / P2025)^(1/5) − 1`

`P(year) = P2025 × (1 + r)^(year − 2025)`

`new dwelling demand = ceil(max(0, P(year) − P2025) / people per dwelling) + extra rehousing demand`

The initial assumption is three people per dwelling, adjustable in the interface. This converts **additional** population to extra demand; it does not infer an existing housing deficit. Rehousing demand is a manual workshop input, not an automatically detected displacement estimate. Rates beyond 2030 are user scenarios: WorldPop values for 2040 were not downloaded or implied. Shrinking population does not automatically demolish houses.

### 3. Where additional built area could fit

Analysis uses approximately **20 m cells** in EPSG:9377. Candidate housing cells must lie wholly inside the study boundary and outside:

- existing detected/cadastral footprints or any mapped 2025 built-land pixels;
- mapped high mass-movement categories, flood or torrential-flow polygons;
- riparian buffers, water, flooded vegetation and unknown/cloud classes.

Candidates must also meet the chosen slope limit (initially 25 degrees) and be within 800 m of the current built fabric. These are conservative prototype screening rules, not engineering design thresholds. Medium or unmapped hazards, tenure, services and road access still need review.

Eligible cells are ranked using:

**Show candidate land** displays the full eligible pool, including land not selected by the present demand. Click a point to inspect the relevant exclusions or see that it remains eligible but unused. The algorithm evaluates the whole boundary, not only its upper part. At target year 2025, ordinary growth demand is zero; existing cream buildings are baseline outlines. The revised tree-cover overlay uses a subtle olive tint so the aerial image remains legible.

`score = 0.58 × exp(−distance / distance scale) + 0.24 × (1 − slope / 40) + 0.18 × stable pattern variation`

The distance scale is 180 m for compact/restoration and 500 m for expansion. Weights and distances are transparent **heuristics**, not fitted probabilities. “Another pattern” changes a reproducible seed; it explores alternatives rather than sampling a calibrated uncertainty distribution.

The assumed share accommodated within existing fabric is removed from outward demand. Its structural and service capacity has not been measured. Remaining demand is converted to land using adjustable square metres per unit, then allocated to ranked cells. Unallocated demand is reported when eligible capacity runs out. Amber volumes are schematic **zones**, not individual building designs; their display height is 6 m.

| Preset | Assumed share within existing fabric | Land per unit | Tree protection from housing | Tree-cover gain target |
| --- | ---: | ---: | --- | ---: |
| Compact | 60% | 160 m² | On | 0 |
| Expansion | 20% | 240 m² | Off | 0 |
| Restoration | 70% | 160 m² | On | 1 ha/year |

These defaults are discussion parameters, not estimated local capacities or established ecological targets.

### 4. Tree-cover change

“Policy scenario” holds the 2025 tree baseline unless a rate, housing clearing or restoration target changes it. “Mapped linear trend” fits tree area in 2021, 2023 and 2025, and extends the fitted slope from the 2025 baseline, bounded at zero. The two fitted slopes are approximately −4.90 ha/year and −6.22 ha/year. They should not be read as confirmed deforestation rates: class changes and detection errors contribute to the series.

Housing-related clearing is deducted first. In policy mode it also lowers the target, so an expansion scenario does not silently compensate clearing by planting elsewhere. Gains require an explicit restoration target, positive policy rate or positive mapped trend. Additional loss is then allocated near the edge of the built fabric only to meet the net tree-cover target, so clearing is not counted twice. “Protect trees from housing” excludes every housing candidate containing mapped tree pixels; it does not erase independent tree-change assumptions. Gains use unoccupied crop/rangeland cells, giving preference to riparian buffers. Grid granularity can slightly overshoot a target; unmet targets are shown. Gain means a future cover scenario, not an immediate mature forest, a planting design or a quantified cooling benefit.

## Research basis and validation

This small implementation separates **quantity of change** from **spatial allocation**. That is also a useful distinction in the following research, although their full algorithms are not implemented here:

- **Meentemeyer et al. (2013), FUTURES.** Models urban growth with development pressure, suitability and patch growth. A later calibrated implementation would be appropriate once consistent historical transitions, roads and planning covariates exist. [Paper, DOI: 10.1080/00045608.2012.707591](https://doi.org/10.1080/00045608.2012.707591), [official project](https://cnr.ncsu.edu/geospatial/research/futures/), [GRASS implementation and requirements](https://grass.osgeo.org/grass-stable/manuals/addons/r.futures.html).
- **Liang et al. (2021), PLUS.** Learns land-expansion drivers and allocates competing land-use patches. It provides a route to a joint housing/forest model after training data and calibration are available. [Paper, DOI: 10.1016/j.compenvurbsys.2020.101569](https://doi.org/10.1016/j.compenvurbsys.2020.101569), [author manuscript](https://arxiv.org/abs/2010.11541).
- **Brown et al. (2022), Dynamic World.** A 10 m near-real-time land-cover dataset with class probabilities. Useful for a future consistent multi-date cover series with explicit confidence filtering. It is not the raster used in this version. [Open-access paper](https://pmc.ncbi.nlm.nih.gov/articles/PMC9184477/), DOI: 10.1038/s41597-022-01307-4.
- **Sirko et al., Open Buildings temporal work.** Shows how multi-year satellite imagery can support building-change analysis. Google's public temporal dataset covers 2016–2023; its model outputs require local validation and do not replace surveyed building heights. [Technical paper](https://arxiv.org/html/2310.11622v3), [official temporal data](https://sites.research.google/gr/open-buildings/temporal/).
- **Pontius et al. (2008).** Explains comparison of predicted and reference land change and why unchanged land can inflate apparent accuracy. [Paper, DOI: 10.1007/s00168-007-0138-2](https://doi.org/10.1007/s00168-007-0138-2), [author repository](https://commons.clarku.edu/faculty_geography/771/).

A preliminary map-agreement diagnostic extrapolated **2021–2023 classified built-land change** into 2025 and compared selected cells with 2023–2025 classified transitions. Figure of merit was **7.3% for El Uvito and 11.5% for La Palma**. This is weak agreement, not successful validation. Reference maps are classified imagery, not field truth; quantity changes and classifier error are intertwined. The test is a diagnostic of a simple land-cover allocation, not a validation of the roof-trend or population models. A naive forest extrapolation also missed the later mapped tree area by approximately −40.5% and −7.3%.

Consequently, the interface calls these scenarios, keeps alternatives selectable and defaults tree cover to a policy assumption rather than treating the short historical trend as a reliable forecast. Results are suitable for asking “what would these assumptions imply?” rather than “where will people certainly live?”

## Reproduce and extend

```sh
python -m pip install numpy pillow rasterio scipy pyproj shapely
python scripts/prepare_future_data.py --cache-dir /path/to/public-data-cache
python scripts/check_historical_change.py --cache-dir /path/to/public-data-cache
npm run check
npm test
```

Preparation records source URLs and input raster checksums in `assets/*-future.json`. Source downloads are cached outside the repository. Existing project datasets provide the boundaries, terrain, historical roofs and mapped constraints. Browser processing uses local prepared assets, with no external API request needed during a workshop.

Use **Export scenario** to download parameters, totals and zone rings in EPSG:9377. This JSON is not GeoJSON. A shared link preserves model choices and assumptions; it does not contain proposal notes or participant information.

The next useful work is to validate recent occupation against the 2024 aerial image and local knowledge; obtain settlement-level population/household counts; check legal and practical building capacity, access and services; agree scenario assumptions with participants; and then train/back-test a consistent change model. These additions would justify replacing the present heuristic allocator with FUTURES, PLUS or a locally fitted cellular model. Physical runoff, temperature or slope-stability outputs need their own input data and calibration.

## Public sources

- [Medellín Construccion_2025 layer](https://www.medellin.gov.co/servidormapas/rest/services/ServiciosCatastro/HistoricoCatastral/MapServer/170)
- [Esri Sentinel2_10m_LandCover service](https://ic.imagery1.arcgis.com/arcgis/rest/services/Sentinel2_10m_LandCover/ImageServer), Impact Observatory / Microsoft / Esri, CC BY 4.0
- [WorldPop Colombia 2025 product](https://hub.worldpop.org/geodata/summary?id=72991), DOI: [10.5258/SOTON/WP00839](https://doi.org/10.5258/SOTON/WP00839), CC BY 4.0
- [WorldPop Global2 methods overview](https://www.worldpop.org/blog/worldpop-global2-global-high-resolution-population-estimates-for-2015-2030/)
- [Global2 R2025A release statement](https://data.worldpop.org/repo/prj/Global_2015_2030/R2025A/doc/Global2_Release_Statement_R2025A_v1.pdf)
