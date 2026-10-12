#!/usr/bin/env python3
"""Reproducible, public-data baselines for the two settlement scenario models.

pip install numpy scipy shapely pyproj rasterio
python scripts/prepare_future_data.py --cache-dir ../research/raw
Only geometry and aggregate population are published; no cadastral personal fields.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import urllib.parse
import urllib.request

import numpy as np
from pyproj import Transformer
import rasterio
from rasterio.features import rasterize, shapes
from rasterio.transform import from_bounds
from rasterio.warp import reproject, Resampling
from scipy.ndimage import distance_transform_edt, map_coordinates
from shapely.geometry import Polygon, box, shape, mapping
from shapely.ops import transform, unary_union
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
LC = "https://ic.imagery1.arcgis.com/arcgis/rest/services/Sentinel2_10m_LandCover/ImageServer"
CAD = "https://www.medellin.gov.co/servidormapas/rest/services/ServiciosCatastro/HistoricoCatastral/MapServer/170"
WP = "https://data.worldpop.org/GIS/Population/Global_2015_2030/R2025A/{year}/COL/v1/100m/constrained/col_pop_{year}_CN_100m_R2025A_v1.tif"
TO_LOCAL = Transformer.from_crs(4326, 9377, always_xy=True)

def request(url, params=None):
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "ETH-climate-risk-semester-project/2.0"})
    return urllib.request.urlopen(req, timeout=180)

def get_json(url, params=None):
    with request(url, params) as stream:
        data = json.load(stream)
    if "error" in data:
        raise RuntimeError(data["error"])
    return data

def download(url, path):
    if path.exists() and path.stat().st_size > 0:
        return path
    part = path.with_suffix(path.suffix + ".part")
    with request(url) as response, part.open("wb") as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)
    part.replace(path)
    return path

def load_site(slug):
    text = (ROOT / f"assets/{slug}-data.js").read_text()
    return json.loads(text.split("=", 1)[1].rstrip(";\n"))

def boundary_for(data):
    cx, cy = data["centre"]
    return unary_union([Polygon([(x + cx, y + cy) for x, y in ring]) for ring in data["boundary"]])

def landcover(data, slug, year, cache):
    path = cache / f"{slug}-landcover-{year}.tif"
    if not path.exists():
        e = data["extent"]
        w, h = math.ceil((e[2] - e[0]) / 10), math.ceil((e[3] - e[1]) / 10)
        params = {"bbox": ",".join(map(str, e)), "bboxSR": 9377, "imageSR": 9377,
                  "size": f"{w},{h}", "format": "tiff", "pixelType": "U8",
                  "interpolation": "RSP_NearestNeighbor", "f": "json",
                  "renderingRule": json.dumps({"rasterFunction": "None"}),
                  "mosaicRule": json.dumps({"mosaicMethod": "esriMosaicAttribute", "where": f"Year={year}",
                                            "sortField": "Year", "sortValue": str(year), "mosaicOperation": "MT_FIRST"})}
        exported = get_json(LC + "/exportImage", params)
        (cache / f"{slug}-landcover-{year}-export.json").write_text(json.dumps({"params": params, "result": exported}))
        download(exported["href"], path)
    return path

def cadastre(data, slug, cache):
    path = cache / f"{slug}-cadastre-2025.json"
    if not path.exists():
        e = data["extent"]
        envelope = dict(zip(("xmin", "ymin", "xmax", "ymax"), e))
        envelope["spatialReference"] = {"wkid": 9377}
        params = {"where": "tipo_construccion IN ('N','E','BQ','M','FL','T')",
                  "geometry": json.dumps(envelope), "geometryType": "esriGeometryEnvelope", "inSR": 9377,
                  "spatialRel": "esriSpatialRelIntersects", "returnGeometry": "true", "outSR": 4326,
                  "outFields": "objectid", "orderByFields": "objectid", "resultRecordCount": 1000, "f": "geojson"}
        features, offset = [], 0
        while True:
            params["resultOffset"] = offset
            result = get_json(CAD + "/query", params)
            batch = result.get("features", [])
            features.extend(batch)
            if len(batch) < 1000:
                break
            offset += len(batch)
        path.write_text(json.dumps({"type": "FeatureCollection", "features": features}))
    data_json = json.loads(path.read_text())
    boundary = boundary_for(data)
    polygons = []
    for feature in data_json["features"]:
        if not feature.get("geometry"):
            continue
        geom = transform(TO_LOCAL.transform, shape(feature["geometry"]))
        if not geom.is_valid:
            geom = geom.buffer(0)
        if geom.intersects(boundary):
            polygons.append(geom.intersection(boundary))
    # Floor-level records can overlap. Union once, before interpreting them as outlines.
    if not polygons:
        # This public historical service returns attribute records without geometry.
        # Its map export is public: extract approximate outlines from a solid-fill,
        # georeferenced rendering, rather than claiming access to its native vectors.
        map_path=cache/f"{slug}-cadastre-2025-map.png"
        export_path=cache/f"{slug}-cadastre-2025-map-export.json"
        if not map_path.exists():
            e=data["extent"];w=4000;h=round(w*(e[3]-e[1])/(e[2]-e[0]))
            layer={"id":170,"source":{"type":"mapLayer","mapLayerId":170},"minScale":0,"maxScale":0,
                   "definitionExpression":"tipo_construccion IN ('N','E','BQ','M','FL','T')",
                   "drawingInfo":{"renderer":{"type":"simple","symbol":{"type":"esriSFS","style":"esriSFSSolid",
                   "color":[255,255,255,255],"outline":{"type":"esriSLS","style":"esriSLSNull","color":[0,0,0,0],"width":0}}}}}
            params={"bbox":",".join(map(str,e)),"bboxSR":9377,"imageSR":9377,"size":f"{w},{h}","format":"png32",
                    "transparent":"true","dpi":24,"dynamicLayers":json.dumps([layer]),"f":"json"}
            result=get_json(CAD.rsplit("/",1)[0]+"/export",params)
            export_path.write_text(json.dumps({"params":params,"result":result}))
            download(result["href"],map_path)
        exported=json.loads(export_path.read_text())["result"];e=exported["extent"]
        pixels=np.asarray(Image.open(map_path).convert("RGBA"));occupied=(pixels[:,:,3]>127).astype("uint8")
        if not occupied.any():raise RuntimeError(f"Cadastral map export is empty for {slug}")
        affine=from_bounds(e["xmin"],e["ymin"],e["xmax"],e["ymax"],occupied.shape[1],occupied.shape[0])
        for geometry,value in shapes(occupied,mask=occupied.astype(bool),transform=affine):
            if value!=1:continue
            g=shape(geometry)
            if g.area>=2 and g.intersects(boundary):polygons.append(g.intersection(boundary))
        print(f"{slug}: cadastral outlines derived from public 2025 map at {(e['xmax']-e['xmin'])/occupied.shape[1]:.3f} m/pixel",flush=True)
    return unary_union(polygons).simplify(0.15, preserve_topology=True)

def resample(path, grid, predicate=None, nearest=False):
    with rasterio.open(path) as source:
        values = source.read(1)
        if predicate is not None:
            values = predicate(values).astype("float32")
        out = np.zeros((grid["height"], grid["width"]), dtype="float32")
        reproject(values, out, src_transform=source.transform, src_crs=source.crs,
                  dst_transform=grid["transform"], dst_crs="EPSG:9377",
                  resampling=Resampling.nearest if nearest else Resampling.average)
    return out

def population(path, boundary):
    from rasterio.windows import from_bounds as window_from_bounds
    back = Transformer.from_crs(9377, 4326, always_xy=True)
    geographic = transform(back.transform, boundary)
    with rasterio.open(path) as source:
        window = window_from_bounds(*geographic.bounds, transform=source.transform).round_offsets()
        window = rasterio.windows.Window(window.col_off - 1, window.row_off - 1,
                                         math.ceil(window.width) + 3, math.ceil(window.height) + 3)
        values = source.read(1, window=window, masked=True)
        affine = source.window_transform(window)
        total, cells = 0.0, []
        for row in range(values.shape[0]):
            for col in range(values.shape[1]):
                value = values[row, col]
                if np.ma.is_masked(value) or not np.isfinite(value) or value <= 0:
                    continue
                xy = [TO_LOCAL.transform(*(affine * p)) for p in [(col,row),(col+1,row),(col+1,row+1),(col,row+1)]]
                polygon = Polygon(xy)
                weight = polygon.intersection(boundary).area / polygon.area
                if weight <= 0:
                    continue
                total += float(value) * weight
                cells.append({"ring": xy, "count": round(float(value), 4), "fraction": round(weight, 5)})
    return round(total, 3), cells

def array(values, decimals=0):
    flat = np.asarray(values).ravel()
    if decimals:
        return [round(float(v), decimals) for v in flat]
    return np.rint(flat).astype(int).tolist()

def prepare(slug, cache, wp_paths):
    data = load_site(slug)
    boundary = boundary_for(data)
    extent = data["extent"]
    width, height = math.ceil((extent[2] - extent[0]) / 20), math.ceil((extent[3] - extent[1]) / 20)
    dx, dy = (extent[2]-extent[0])/width, (extent[3]-extent[1])/height
    affine = from_bounds(*extent, width, height)
    grid = {"width": width, "height": height, "transform": affine}
    paths = {year: landcover(data, slug, year, cache) for year in (2021, 2023, 2025)}
    footprints = cadastre(data, slug, cache)
    cx, cy = data["centre"]
    local = lambda g: transform(lambda x,y,z=None:(x-cx,y-cy), g)
    parts = list(footprints.geoms) if footprints.geom_type == "MultiPolygon" else [footprints]
    rings = [[[round(x-cx,1), round(y-cy,1)] for x,y in g.exterior.coords[:-1]] for g in parts if g.geom_type=="Polygon" and g.area>=1]
    fraction, full = np.zeros((height,width)), np.zeros((height,width),bool)
    for row in range(height):
        for col in range(width):
            cell = box(extent[0]+col*dx, extent[3]-(row+1)*dy, extent[0]+(col+1)*dx, extent[3]-row*dy)
            fraction[row,col] = boundary.intersection(cell).area / cell.area
            full[row,col] = boundary.covers(cell)
    def mask(geometries, touched=True):
        geometries=[g for g in geometries if not g.is_empty]
        return rasterize([(mapping(g),1) for g in geometries],out_shape=(height,width),transform=affine,all_touched=touched).astype(bool) if geometries else np.zeros((height,width),bool)
    def world_ring(ring): return Polygon([(x+cx,y+cy) for x,y in ring])
    hard_hazards = [world_ring(f["ring"]) for key,fs in data["hazards"].items() for f in fs if key != "massMovement" or f["grade"] == "Alta"]
    hazard = mask(hard_hazards)
    buffer = mask([world_ring(f["ring"]) for f in data["riparian"]])
    historical = [world_ring(r) for r in data["buildings"]["2021"]]
    occupied = mask([footprints]+historical)
    tree = resample(paths[2025],grid,lambda a:a==2)
    built = resample(paths[2025],grid,lambda a:a==7)
    classes = resample(paths[2025],grid,nearest=True).astype(int)
    occupied |= built > 0
    dem = np.asarray(data["heights"]).reshape(data["height"],data["width"])
    sy,sx=np.gradient(dem,(extent[3]-extent[1])/(data["height"]-1),(extent[2]-extent[0])/(data["width"]-1))
    slope_nodes=np.degrees(np.arctan(np.hypot(sx,sy)))
    rows,cols=np.indices((height,width)); coords=[(rows+.5)/height*(data["height"]-1),(cols+.5)/width*(data["width"]-1)]
    slope=map_coordinates(slope_nodes,coords,order=1,mode="nearest")
    distance=distance_transform_edt(~occupied,sampling=(dy,dx))
    flags=(~full).astype(int) | (hazard.astype(int)*2) | (buffer.astype(int)*4) | (occupied.astype(int)*8) | (np.isin(classes,[0,1,4,9,10]).astype(int)*16)
    stats, histories={},{}
    for year,path in paths.items():
        tr=resample(path,grid,lambda a:a==2);bu=resample(path,grid,lambda a:a==7)
        stats[str(year)]={"treeHa":round(float((tr*fraction).sum()*dx*dy/10000),3),"builtHa":round(float((bu*fraction).sum()*dx*dy/10000),3)}
        histories[str(year)]=array(resample(path,grid,nearest=True))
    p25,pixels=population(wp_paths[2025],boundary)
    p30,_=population(wp_paths[2030],boundary)
    for cell in pixels:
        cell["ring"]=[[round(x-cx,1),round(y-cy,1)] for x,y in cell["ring"]]
    payload={"version":1,"site":slug,"crs":"EPSG:9377","baselineYear":2025,"retrieved":datetime.now(timezone.utc).isoformat(),
             "width":width,"height":height,"extent":extent,"boundary":data["boundary"],"cellWidth":round(dx,6),"cellDepth":round(dy,6),
             "insideFraction":array(fraction,4),"treeFraction":array(tree,3),"builtFraction":array(built,3),
             "classes":array(classes),"flags":array(flags),"slope":array(slope,1),"distance":array(distance),
             "population":{"2025":p25,"2030":p30,"cells":pixels,"annualRate":round(((p30/p25)**.2-1)*100,4) if p25 else 0},
             "landcoverHistory":stats,"buildings2025":rings,"cadastreAreaHa":round(footprints.area/10000,3),
             "footprintHistory":{year:{"count":len(rs),"roofHa":round(sum(Polygon(r).area for r in rs)/10000,6)} for year,rs in data["buildings"].items()},
             "cadastreMethod":"Solid-fill municipal 2025 map export, raster-to-vector outlines; native queries returned no geometry.",
             "sources":{"landcover":LC,"cadastre":CAD,"population2025":WP.format(year=2025),"population2030":WP.format(year=2030)},
             "sha256":{path.name:hashlib.sha256(path.read_bytes()).hexdigest() for path in list(paths.values())+list(wp_paths.values())}}
    (ROOT/f"assets/{slug}-future.json").write_text(json.dumps(payload,separators=(",",":")))
    (cache/f"{slug}-validation-input.json").write_text(json.dumps({"width":width,"height":height,"cellWidth":dx,"cellDepth":dy,"insideFraction":array(fraction,4),"classes":histories,"slope":array(slope,1)}))
    print(json.dumps({"site":slug,"population":{2025:p25,2030:p30},"cadastrePolygons":len(rings),"landcover":stats,"availableCells":int(((flags==0)&(slope<=25)).sum())}),flush=True)

def main():
    parser=argparse.ArgumentParser();parser.add_argument("--cache-dir",type=Path,default=ROOT.parent/"research/raw");args=parser.parse_args()
    cache=args.cache_dir;cache.mkdir(parents=True,exist_ok=True)
    with ThreadPoolExecutor(max_workers=4) as pool:
        jobs={year:pool.submit(download,WP.format(year=year),cache/f"col-pop-{year}.tif") for year in (2025,2030)}
        lc_jobs=[pool.submit(landcover,load_site(slug),slug,year,cache) for slug in ("el-uvito","la-palma") for year in (2021,2023,2025)]
        cad_jobs=[pool.submit(cadastre,load_site(slug),slug,cache) for slug in ("el-uvito","la-palma")]
        wp_paths={year:job.result() for year,job in jobs.items()}
        for job in lc_jobs+cad_jobs:job.result()
    for slug in ("el-uvito","la-palma"):prepare(slug,cache,wp_paths)

if __name__=="__main__":main()
