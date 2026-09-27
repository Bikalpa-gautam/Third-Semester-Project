# El Uvito Climate Risk Lab

This is a static, Netlify-ready 3D prototype for the ETH project **3D pedagogical model of informal settlement for climate-risk training**.

## What is real in this prototype

- El Uvito terrain from the official **Medellín 2024 digital elevation model** ImageServer. The source has a native 1 m pixel size; the browser mesh is resampled for performance.
- A resampled **Medellín 2024 orthophoto** draped on the terrain. The source service reports a native 0.08 m pixel size.
- Detected building-footprint polygons from the supplied **Cuenca Alta 2010, 2019 and 2021** GIS layers.
- Supplied POT 2014 mass-movement, flood and torrential-flow hazard boundaries.
- Supplied riparian-buffer and stream layers.

## What remains schematic

- Building heights. No measured building-height attribute was included, so the vertical extrusions are only for visibility.
- Rainfall and heat controls. They change the educational presentation, not a hydrological, thermal or landslide calculation.
- Effects of placed interventions. They are discussion markers, not calculated reductions in risk.

## Publish on Netlify

1. Unzip the folder.
2. Upload the entire folder to a new GitHub repository, keeping `index.html` in the repository root.
3. In Netlify, choose **Add new site → Import an existing project** and select the repository.
4. Netlify should read `netlify.toml`. No build command is required; the publish directory is `.`.
5. Deploy the site.

You can also drag the unzipped folder directly into Netlify Drop.

## Test locally

Because the project uses JavaScript modules, serve the folder rather than double-clicking `index.html`.

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Regenerate the processed data

The optional script `scripts/prepare_el_uvito_data.py` repeats the extraction from Medellín's ArcGIS ImageServices and the supplied shapefiles. It requires Python packages `numpy`, `Pillow`, `pyshp`, `pyproj`, `shapely`, and `tifffile`. Update `GIS_ROOT` near the top if the extracted GIS folder is stored elsewhere.

## Privacy

The prototype deliberately excludes respondent names and exact household survey points.
