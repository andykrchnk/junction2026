"""Validate paired DXF/PDF registration before computing CAD region coverage."""

import json
from pathlib import Path

import ezdxf
import fitz
import numpy as np
from PIL import Image, ImageDraw
from shapely import affinity, wkt
from shapely.geometry import Polygon
from shapely.ops import unary_union

ROOT = Path(".local/gpu-comparison")


def pdf_polygon(path):
    items = path["items"]
    if len(items) == 1 and items[0][0] == "re":
        r = items[0][1]
        return Polygon([(r.x0, r.y0), (r.x1, r.y0), (r.x1, r.y1), (r.x0, r.y1)])
    if not items or any(item[0] != "l" for item in items):
        return None
    points = [tuple(items[0][1])] + [tuple(item[2]) for item in items]
    if len(points) < 4 or np.linalg.norm(np.asarray(points[0]) - points[-1]) > 1e-3:
        return None
    polygon = Polygon(points)
    return polygon if polygon.is_valid and polygon.area > 0 else None


def main():
    manifest = json.loads((ROOT / "manifest.json").read_text())
    out = ROOT / "cad-ground-truth"
    out.mkdir(exist_ok=True)
    records = []
    for item in manifest["samples"]:
        if item["source"] != "swiss_dwellings":
            continue
        source = next(
            v["path"] for v in item["vector_inputs"] if v["path"].endswith(".dxf")
        )
        document = ezdxf.readfile(source)
        entities = list(
            document.modelspace().query('LWPOLYLINE[layer=="ROOM_OUTLINE"]')
        )
        vertices = [np.asarray(p.get_points("xy")) for p in entities]
        with fitz.open(item["path"]) as pdf:
            paths = pdf[0].get_drawings()
        # The paired exports preserve the first room-outline draw order. Fit ten
        # bboxes, then independently validate every closed polygon against PDF paths.
        matrix = []
        target = []
        for points, path in zip(vertices[:10], paths[1:11]):
            lo = points.min(0)
            hi = points.max(0)
            r = path["rect"]
            matrix.extend(
                [[lo[0], 1, 0], [hi[0], 1, 0], [-hi[1], 0, 1], [-lo[1], 0, 1]]
            )
            target.extend([r.x0, r.x1, r.y0, r.y1])
        scale, tx, ty = np.linalg.lstsq(matrix, target, rcond=None)[0]
        residual = float(
            np.max(np.abs(np.asarray(matrix) @ np.array([scale, tx, ty]) - target))
        )
        pdf_shapes = [
            shape for path in paths if (shape := pdf_polygon(path)) is not None
        ]
        truth = []
        distances = []
        excluded = {"nonpolygon": 0, "invalid_or_empty": 0}
        unmatched = []
        for index, points in enumerate(vertices):
            if len(points) < 3 or (
                not entities[index].closed
                and np.linalg.norm(points[0] - points[-1]) > 1e-6
            ):
                excluded["nonpolygon"] += 1
                continue
            shape = Polygon(points)
            if not shape.is_valid or shape.is_empty or shape.area <= 1e-10:
                excluded["invalid_or_empty"] += 1
                continue
            projected = affinity.affine_transform(shape, [scale, 0, 0, -scale, tx, ty])
            candidates = [
                p
                for p in pdf_shapes
                if max(abs(a - b) for a, b in zip(p.bounds, projected.bounds)) < 0.01
            ]
            distance = min(
                (projected.boundary.hausdorff_distance(p.boundary) for p in candidates),
                default=float("inf"),
            )
            if distance > 0.001:
                unmatched.append(index)
            else:
                distances.append(distance)
            raster = affinity.scale(projected, 150 / 72, 150 / 72, origin=(0, 0))
            truth.append(raster)
        compatible = residual < 0.001 and not unmatched and bool(truth)
        row = {
            "id": item["id"],
            "dxf": source,
            "insunits": int(document.header.get("$INSUNITS", 0)),
            "registration": {
                "scale_points_per_dxf_unit": float(scale),
                "translate_x_points": float(tx),
                "translate_y_points": float(ty),
                "flip_y": True,
                "raster_scale": 150 / 72,
            },
            "fit_max_bbox_residual_points": residual,
            "validation_max_boundary_hausdorff_points": (
                max(distances) if distances else None
            ),
            "valid_cad_regions": len(truth),
            "excluded_entities": excluded,
            "unmatched_region_indices": unmatched,
            "compatible": compatible,
            "models": {},
        }
        if compatible:
            reference = unary_union(truth)
            for model in ["cubicasa", "raster2seq"]:
                path = next(
                    (ROOT / "results" / model / item["id"]).rglob("predictions.json")
                )
                prediction = json.loads(path.read_text())
                regions = [
                    wkt.loads(p["geometry_wkt"])
                    for group in prediction["room_polygons"].values()
                    for p in group
                ]
                estimated = unary_union(regions)
                row["models"][model] = {
                    "class_agnostic_region_union_iou": reference.intersection(
                        estimated
                    ).area
                    / reference.union(estimated).area
                }
            image = Image.open(item["raster_path"]).convert("RGB")
            draw = ImageDraw.Draw(image, "RGBA")
            for shape in truth:
                draw.line(list(shape.exterior.coords), fill=(0, 170, 50, 255), width=3)
            image.thumbnail((2000, 2000))
            image.save(out / (item["id"] + "-reference.png"))
        (out / (item["id"] + ".json")).write_text(
            json.dumps(
                {**row, "reference_polygons_wkt": [p.wkt for p in truth]}, indent=2
            )
        )
        records.append(row)
    result = {
        "scope": "CAD ROOM_OUTLINE union coverage against the exact paired rendering; not semantic room accuracy or independently human-labeled physical truth. Nonpolygon/invalid CAD entities excluded explicitly. No geometry repairs.",
        "registration_gate": "First ten outline bboxes fit; all valid closed region boundaries independently match PDF vector paths within 0.001 point. Failed gates are not scored.",
        "drawings": records,
    }
    (ROOT / "cad-geometry.json").write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
