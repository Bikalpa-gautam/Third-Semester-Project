# El Uvito

An interactive terrain model for the ETH Zürich semester project **3D pedagogical model of informal settlement for climate-risk training**.

**Bikalpa Gautam**

Supervisors: **Ricardo Pérez-Restrepo** and **Prof. Dr. Guillaume Habert**.

[Chair of Sustainable Construction, ETH Zürich](https://sc.ibi.ethz.ch/en/)

Live site: https://eluvito.netlify.app/

## Explore

- Choose **El Uvito** or **La Palma** from the settlement menu beside the title. Each opens its own terrain, aerial image and clipped evidence layers.
- Aerial, elevation and slope views, with an orbiting 3D terrain model and a north-up 2D map.
- Detected building footprints for 2010, 2019 and 2021.
- Independent controls for the settlement boundary, streams, riparian buffers, mapped hazards and 50 m contours.
- Under **Settlement boundary**, enable **Blur outside boundary** to keep the settlement sharp while softening its surroundings. This works in 3D and Map view, follows the camera and is included in captures and shared view links.
- Click a terrain point to inspect elevation, slope, projected coordinates and historical hazard categories.
- Select the ruler and two points for horizontal distance and elevation change.
- Capture the view as a PNG or copy a link to its layer, camera and scenario settings.
- English and Spanish interfaces, keyboard navigation and a compact layout for small screens.

If WebGL 2 is unavailable, the site opens the functional 2D map. It does not leave the visitor on a loading screen.

## Proposals

Open **Plan**, choose drainage, a rain garden or tree planting, then click the terrain. A pin is a proposed location, not a dimensioned design or a computed benefit. Click a proposal in the list to edit its note or remove it.

Plans save in this browser's local storage. They are not uploaded to a server. **Export** downloads a JSON file; **Import** opens that file on another device. Replacing a plan requires confirmation and can be undone. Undo/redo also covers additions, deletions and note edits. A shared view link does **not** include proposals or notes.

Each settlement has its own saved plan. Imports check the settlement identifier as well as its coordinates, so an El Uvito plan cannot be imported into La Palma.

## La Palma data

La Palma follows the original El Uvito preparation workflow: Ricardo's `Methodology/La Palma.shp` boundary, a 100 m context margin, EPSG:9377, the municipal 2024 DEM and orthophoto, POT 2014 hazards, streams and riparian buffers. Its exported terrain is 320 × 203 samples (approximately 16.3 m east-west spacing); its aerial image is 1600 × 1016 pixels. Both Cuenca Alta and Cuenca Media footprint sets overlap this boundary. They are clipped to La Palma and geometry already covered by the first set is removed from the second to avoid drawing it twice. The resulting displayed polygon counts are 624 / 792 / 718 for 2010 / 2019 / 2021. These are detected polygon parts, not household totals or a reliable construction timeline.

The existing El Uvito dataset and orthophoto are unchanged. Mass movement now uses purple and riparian buffers use turquoise, consistently in both views, the layer controls and the legend.

To reproduce either dataset from the original archive:

```sh
python -m pip install numpy pillow pyshp tifffile pyproj shapely
python scripts/prepare_el_uvito_data.py --settlement la-palma --gis-root /path/to/GIS_layers
# Use --settlement el-uvito to reproduce the original pilot.
```

La Palma opens directly at https://eluvito.netlify.app/?settlement=la-palma.

Plan files use projected eastings and northings in **EPSG:9377**, explicitly recorded in the file. They are not GeoJSON. Up to 100 proposals are supported. Import validates file size, schema, coordinate reference system, proposal types and study-area bounds.

## Data and interpretation

| Layer              | Source                                                      | Display                                              |
| ------------------ | ----------------------------------------------------------- | ---------------------------------------------------- |
| Terrain            | Official Medellín 2024 DEM, 1 m native resolution           | Existing 320 × 177 grid, approximately 9.1 m spacing |
| Aerial imagery     | Official Medellín 2024 orthophoto, 0.08 m native resolution | Existing 1600 × 885 image                            |
| Buildings          | Supplied Cuenca Alta detections                             | 110 / 155 / 241 polygons for 2010 / 2019 / 2021      |
| Hazards            | Supplied POT 2014 polygons                                  | Mass movement, flooding and torrential flow          |
| Water and boundary | Supplied project GIS layers                                 | Streams, riparian buffers and settlement outline     |
| Slope              | Central differences on the displayed DEM                    | Degrees; not a landslide probability                 |
| Contours           | Marching triangles on the displayed DEM                     | 50 m interval                                        |

The supplied imagery and processed spatial datasets remain unchanged. No household survey points, participant names or private fieldwork records are added.

Building heights are schematic at 6 m. Footprint detections are not household counts and do not alone establish construction dates. Point inspection tests the supplied simplified polygon rings; missing mapped coverage does not establish safety. Distances are horizontal, not route or surface distances. Coordinate and elevation readouts should not be treated as surveying measurements. Hazard categories remain fixed when visual conditions change.

**Scenarios** controls rain particles and a warm rendering tint using dimensionless effect levels. It does not calculate precipitation, air temperature, flood depth, runoff, slope stability or intervention performance. Captures of an active scenario include this distinction.

Source service: https://www.medellin.gov.co/servidormapas/rest/services/ServiciosImagen

## Run and test

No package installation or build is needed to serve the application:

```sh
python -m http.server 8000
```

Open http://localhost:8000. JavaScript modules require an HTTP server; opening the HTML file directly is not supported.

The automated checks use Node.js (22 or newer), with no external test dependencies:

```sh
npm run check
npm test
```

The tests cover grid orientation, interpolation, slope, contours, horizontal distances, import validation, coordinate round-trips, translation coverage and actual terrain/building/skirt geometry. Browser checks should also cover layer toggles, measurement, proposal persistence, exports, English/Spanish, narrow screens and both WebGL and map-only devices. Open `tests/responsive.html` on the same server for a resizable device-width preview.

## Files

| File                               | Responsibility                                                            |
| ---------------------------------- | ------------------------------------------------------------------------- |
| `index.html`, `styles.css`         | Interface, responsive layout, dialogs and accessibility                   |
| `app.js`                           | Application state, controls, inspection, persistence, sharing and exports |
| `model.js`                         | Geographic calculations, contours and plan validation                     |
| `terrain-view.js`                  | Three.js terrain, solid terrain sides, draped overlays and proposal pins  |
| `boundary-focus.js`                | Camera-following settlement mask and outside-boundary blur in 3D          |
| `map-view.js`                      | Canvas 2D map, surface rasters, pan/zoom and fallback rendering           |
| `i18n.js`                          | English and Spanish interface messages                                    |
| `assets/`                          | Processed datasets and orthophotos for both settlements, plus favicon     |
| `vendor/`                          | Local Three.js and OrbitControls, with their upstream license             |
| `scripts/prepare_el_uvito_data.py` | Shared preparation workflow for El Uvito and La Palma                      |
| `tests/model.test.js`              | Geographic and geometry regression checks                                 |

Three.js is served locally. OrbitControls uses the same local module. The application requires no external fonts, analytics or remote JavaScript packages at runtime. The map loop pauses rendering in background tabs and respects reduced-motion preferences.

## Netlify

Connect this repository to the existing Netlify site, with production branch `main` and publish directory `.`. `netlify.toml` supplies the checks before publication. A GitHub commit triggers a Netlify deployment only when that connection is configured. The host's promotional badge is hidden in the map layout.

## Next research steps

1. Confirm the training questions and workshop format with Ricardo and community partners.
2. Review mapped layers against field knowledge, keeping dated sources and uncertainty visible in the reference panel.
3. Obtain measured building heights, current drainage/access information and the relevant hazard-model inputs before adding physical simulation.
4. Test the proposal workflow with participants. Add calibrated model outputs as separate data layers only after validation.
5. Use QGIS for source preparation. A later Unity implementation can reuse the learning activities and spatial evidence; the current JavaScript renderer is a separate implementation.
