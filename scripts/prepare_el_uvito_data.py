#!/usr/bin/env python3
"""Prepare a lightweight El Uvito 3D pilot from the supplied GIS layers.

Inputs:
  - Ricardo's GIS_layers archive, extracted beside this project.
  - Medellin's public ArcGIS ImageServer for the 2024 DEM and orthophoto.

Outputs:
  - assets/el-uvito-ortho-2024.jpg
  - assets/el-uvito-data.js

The browser model deliberately keeps building heights schematic because the
source package contains footprints but no measured building-height field.
"""

from __future__ import annotations

import json
import math
import os
from pathlib import Path
import urllib.parse
import urllib.request

import numpy as np
from PIL import Image
import shapefile
import tifffile
from pyproj import CRS, Transformer
from shapely.geometry import box, shape
from shapely.ops import transform as geom_transform


PROJECT_DIR = Path(__file__).resolve().parents[1]
WORKSPACE_DIR = PROJECT_DIR.parent
GIS_ROOT = WORKSPACE_DIR / "tmp/project_kickoff/gis/GIS_layers"
ASSET_DIR = PROJECT_DIR / "assets"

SERVICE_ROOT = "https://www.medellin.gov.co/servidormapas/rest/services/ServiciosImagen"
DEM_SERVICE = f"{SERVICE_ROOT}/Modelo_digital_de_elevacion_medellin_2024/ImageServer"
ORTHO_SERVICE = f"{SERVICE_ROOT}/Ortofoto_Medellin_2024/ImageServer"

TARGET_CRS = CRS.from_epsg(9377)
SOURCE_BUILDING_CRS = CRS.from_epsg(4326)
SOURCE_LOCAL_CRS = CRS.from_epsg(6257)

DEM_WIDTH = 320
ORTHO_WIDTH = 1600
PADDING_METRES = 100.0


def get_json(url: str, params: dict[str, str | int | float]) -> dict:
    query = urllib.parse.urlencode(params)
    request = urllib.request.Request(f"{url}?{query}", headers={"User-Agent": "ETH-climate-risk-prototype/1.0"})
    with urllib.request.urlopen(request, timeout=180) as response:
        return json.load(response)


def download(url: str, destination: Path) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "ETH-climate-risk-prototype/1.0"})
    with urllib.request.urlopen(request, timeout=240) as response:
        destination.write_bytes(response.read())


def export_image(service: str, extent: tuple[float, float, float, float], width: int, fmt: str, destination: Path) -> dict:
    xmin, ymin, xmax, ymax = extent
    height = max(2, round(width * (ymax - ymin) / (xmax - xmin)))
    params = {
        "bbox": ",".join(f"{value:.3f}" for value in extent),
        "bboxSR": 9377,
        "imageSR": 9377,
        "size": f"{width},{height}",
        "format": fmt,
        "interpolation": "RSP_BilinearInterpolation",
        "compressionQuality": 88,
        "f": "json",
    }
    result = get_json(f"{service}/exportImage", params)
    if "href" not in result:
        raise RuntimeError(f"ImageServer export failed: {result}")
    download(result["href"], destination)
    return result


def crs_from_shapefile(path: Path) -> CRS:
    prj = path.with_suffix(".prj")
    if not prj.exists():
        raise FileNotFoundError(f"Missing projection file for {path}")
    return CRS.from_wkt(prj.read_text(encoding="utf-8"))


def transformed_geometries(path: Path, target_crs: CRS, encoding: str = "utf-8"):
    source_crs = crs_from_shapefile(path)
    transformer = Transformer.from_crs(source_crs, target_crs, always_xy=True)
    reader = shapefile.Reader(str(path), encoding=encoding)
    fields = [field[0] for field in reader.fields[1:]]
    for record_shape in reader.iterShapeRecords():
        geometry = shape(record_shape.shape.__geo_interface__)
        if not geometry.is_valid:
            geometry = geometry.buffer(0)
        geometry = geom_transform(transformer.transform, geometry)
        attributes = dict(zip(fields, list(record_shape.record)))
        yield geometry, attributes


def polygon_parts(geometry, clip_geometry, centre_x: float, centre_y: float, simplify: float = 0.0):
    clipped = geometry.intersection(clip_geometry)
    if clipped.is_empty:
        return []
    if simplify:
        clipped = clipped.simplify(simplify, preserve_topology=True)
    polygons = [clipped] if clipped.geom_type == "Polygon" else list(getattr(clipped, "geoms", []))
    output = []
    for polygon in polygons:
        if polygon.geom_type != "Polygon" or polygon.area < 1:
            continue
        ring = [[round(x - centre_x, 1), round(y - centre_y, 1)] for x, y in polygon.exterior.coords[:-1]]
        if len(ring) >= 3:
            output.append(ring)
    return output


def line_parts(geometry, clip_geometry, centre_x: float, centre_y: float, simplify: float = 0.0):
    clipped = geometry.intersection(clip_geometry)
    if clipped.is_empty:
        return []
    if simplify:
        clipped = clipped.simplify(simplify, preserve_topology=True)
    lines = [clipped] if clipped.geom_type in ("LineString", "LinearRing") else list(getattr(clipped, "geoms", []))
    output = []
    for line in lines:
        if line.geom_type not in ("LineString", "LinearRing"):
            continue
        coords = [[round(x - centre_x, 1), round(y - centre_y, 1)] for x, y in line.coords]
        if len(coords) >= 2:
            output.append(coords)
    return output


def main() -> None:
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    settlement_path = GIS_ROOT / "Methodology/El Uvito.shp"
    settlement_geometry, _ = next(transformed_geometries(settlement_path, TARGET_CRS))
    xmin, ymin, xmax, ymax = settlement_geometry.bounds
    extent = (xmin - PADDING_METRES, ymin - PADDING_METRES, xmax + PADDING_METRES, ymax + PADDING_METRES)
    centre_x = (extent[0] + extent[2]) / 2
    centre_y = (extent[1] + extent[3]) / 2
    clip_geometry = box(*extent)

    dem_path = ASSET_DIR / "el-uvito-dem-2024.tif"
    dem_export = export_image(DEM_SERVICE, extent, DEM_WIDTH, "tiff", dem_path)
    elevation = tifffile.imread(dem_path).astype(np.float32)
    if elevation.ndim > 2:
        elevation = elevation.squeeze()
    if elevation.shape != (dem_export["height"], dem_export["width"]):
        elevation = elevation.reshape((dem_export["height"], dem_export["width"]))
    finite = np.isfinite(elevation)
    if not finite.any():
        raise RuntimeError("DEM export contains no finite elevation values")
    fill_value = float(np.nanmedian(elevation[finite]))
    elevation[~finite] = fill_value
    dem_min = float(elevation.min())
    dem_max = float(elevation.max())

    ortho_path = ASSET_DIR / "el-uvito-ortho-2024.jpg"
    ortho_export = export_image(ORTHO_SERVICE, extent, ORTHO_WIDTH, "jpg", ortho_path)
    with Image.open(ortho_path) as image:
        image.convert("RGB").save(ortho_path, quality=88, optimize=True)

    buildings: dict[str, list[list[list[float]]]] = {}
    for year in (2010, 2019, 2021):
        path = GIS_ROOT / f"urban_sprawl/Cuenca Alta {year}.shp"
        year_parts = []
        for geometry, _ in transformed_geometries(path, TARGET_CRS):
            if not geometry.intersects(settlement_geometry):
                continue
            for ring in polygon_parts(geometry, settlement_geometry, centre_x, centre_y, simplify=0.15):
                year_parts.append(ring)
        buildings[str(year)] = year_parts

    hazards = {}
    hazard_specs = {
        "massMovement": (GIS_ROOT / "Risk/pot48_2014_amenaza_movimi.shp", "grado_amen"),
        "flood": (GIS_ROOT / "Risk/pot48_2014_amenaza_inunda.shp", "grado_amen"),
        "torrential": (GIS_ROOT / "Risk/pot48_2014_amenaza_avenid.shp", "grado_amen"),
    }
    for key, (path, grade_field) in hazard_specs.items():
        features = []
        for geometry, attributes in transformed_geometries(path, TARGET_CRS):
            if not geometry.intersects(clip_geometry):
                continue
            grade = str(attributes.get(grade_field, "Unknown"))
            for ring in polygon_parts(geometry, clip_geometry, centre_x, centre_y, simplify=3.0):
                features.append({"grade": grade, "ring": ring})
        hazards[key] = features

    riparian = []
    riparian_path = GIS_ROOT / "Natural Environmentl/All_Riparian_Buffers_San_Cristobal.shp"
    for geometry, attributes in transformed_geometries(riparian_path, TARGET_CRS):
        if not geometry.intersects(clip_geometry):
            continue
        distance = attributes.get("faja_retir")
        for ring in polygon_parts(geometry, clip_geometry, centre_x, centre_y, simplify=2.0):
            riparian.append({"distance": distance, "ring": ring})

    rivers = []
    river_path = GIS_ROOT / "Natural Environmentl/Riverbed_La_Iguaná.shp"
    for geometry, attributes in transformed_geometries(river_path, TARGET_CRS):
        if not geometry.intersects(clip_geometry):
            continue
        for line in line_parts(geometry, clip_geometry, centre_x, centre_y, simplify=1.0):
            rivers.append({"name": str(attributes.get("NMG", "Stream")), "line": line})

    boundary = polygon_parts(settlement_geometry, clip_geometry, centre_x, centre_y, simplify=1.0)

    payload = {
        "name": "El Uvito",
        "crs": "EPSG:9377",
        "extent": [round(value, 3) for value in extent],
        "centre": [round(centre_x, 3), round(centre_y, 3)],
        "width": int(elevation.shape[1]),
        "height": int(elevation.shape[0]),
        "minimumElevation": round(dem_min, 2),
        "maximumElevation": round(dem_max, 2),
        "heights": [round(float(value), 1) for value in elevation.ravel()],
        "orthophoto": "assets/el-uvito-ortho-2024.jpg",
        "orthophotoSize": [ortho_export["width"], ortho_export["height"]],
        "buildings": buildings,
        "hazards": hazards,
        "riparian": riparian,
        "rivers": rivers,
        "boundary": boundary,
        "notes": {
            "terrain": "Medellín 2024 digital elevation model, 1 m native pixel size, resampled for browser display.",
            "imagery": "Medellín 2024 orthophoto, 0.08 m native pixel size, resampled for browser display.",
            "buildings": "Supplied Cuenca Alta detected-footprint layers; displayed heights are schematic because no measured heights were provided.",
            "hazards": "Supplied POT 2014 hazard polygons. Scenario controls change display emphasis and do not predict an event.",
        },
    }

    output_path = ASSET_DIR / "el-uvito-data.js"
    output_path.write_text("window.EL_UVITO_DATA=" + json.dumps(payload, separators=(",", ":"), ensure_ascii=False) + ";\n", encoding="utf-8")
    dem_path.unlink(missing_ok=True)

    summary = {
        "terrainGrid": [payload["width"], payload["height"]],
        "elevationRange": [payload["minimumElevation"], payload["maximumElevation"]],
        "orthophoto": payload["orthophotoSize"],
        "buildingCounts": {year: len(parts) for year, parts in buildings.items()},
        "hazardCounts": {key: len(features) for key, features in hazards.items()},
        "riparianParts": len(riparian),
        "riverParts": len(rivers),
    }
    print(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
