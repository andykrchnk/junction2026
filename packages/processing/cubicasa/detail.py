"""Experimental 2048-pixel CubiCasa mode with explicit room-instance review output."""

import json
from dataclasses import asdict

import numpy as np
import torch
from shapely import affinity
from shapely.geometry import Polygon

from adapters import CUBICASA_REVISION, metadata, save_summary
from model import CubiCasa5K
from model.segmentation_net import ROOM_CLASSES, ICON_CLASSES
from utils.preprocessor import preprocess_image
from utils.room_instances import extract_instances, InstanceSettings, polygon_parts
from utils.official_postprocessing import get_polygons
from utils.geometry_cleanup import clean_instances


class CubiCasaDetailAdapter:
    def __init__(self, checkpoint, device):
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.model = CubiCasa5K.from_pretrained(str(checkpoint), self.device)
        self.settings = InstanceSettings()

    @torch.inference_mode()
    def run(self, source, output, export_probabilities):
        output.mkdir(parents=True, exist_ok=True)
        tensor, transform = preprocess_image(
            source, fixed_size=(2048, 2048), device=self.device
        )
        prediction = self.model(tensor)[0].float().cpu()
        del tensor
        rows, columns = transform.content_slices
        heatmaps = prediction[:21, rows, columns].numpy()
        rooms = torch.softmax(prediction[21:33, rows, columns], 0).numpy()
        icons = torch.softmax(prediction[33:, rows, columns], 0).numpy()
        polygons, types, footprint, room_types = get_polygons(
            (heatmaps.copy(), rooms.copy(), icons.copy()), 0.4, [1, 2]
        )
        sx = transform.original_width / transform.content_width
        sy = transform.original_height / transform.content_height
        structures = [
            {
                "shape": affinity.scale(Polygon(p), sx, sy, origin=(0, 0)),
                "type": t["type"],
                "class_id": int(t["class"]),
            }
            for p, t in zip(polygons, types)
        ]
        regions = [
            affinity.scale(part, sx, sy, origin=(0, 0))
            for shape in footprint
            for part in polygon_parts(shape)
        ]
        extracted = extract_instances(
            rooms, icons, regions, structures, transform, self.settings
        )
        cleanup = clean_instances(extracted, source, transform, rooms)
        raw = {
            "geometry_cleanup": cleanup,
            "original_instances": [
                {"id": r["id"], "geometry_wkt": r["original_geometry_wkt"]}
                for r in extracted["instances"]
            ],
            "transform": transform.to_dict(),
            "settings": asdict(self.settings),
            "official_room_regions": [
                {
                    "geometry_wkt": affinity.scale(part, sx, sy, origin=(0, 0)).wkt,
                    "class_id": int(t["class"]),
                }
                for shape, t in zip(footprint, room_types)
                for part in polygon_parts(shape)
            ],
            "official_structures": [
                {
                    "geometry_wkt": item["shape"].wkt,
                    "type": item["type"],
                    "class_id": item["class_id"],
                }
                for item in structures
            ],
        }
        (output / "raw.json").write_text(json.dumps(raw, indent=2))
        summary = {
            "room_polygons": {},
            "review_room_polygons": {},
            "room_instances": [],
            "icon_detections": [],
            "review_icon_detections": [],
            "wall_polygons": [],
            "review_wall_polygons": [],
            "junctions": None,
            "probability_grid": {
                "file": "probabilities.npz" if export_probabilities else None,
                "shape": [transform.content_height, transform.content_width],
                "transform": transform.to_dict(),
                "description": "Raw cropped model grids; source-pixel geometry is reconstructed separately.",
            },
            "image": {
                "width": transform.original_width,
                "height": transform.original_height,
            },
            "device": self.device,
            "experimental": True,
            "semantics_verified": False,
            "settings": asdict(self.settings),
            "review_check_meaning": extracted["review_check_meaning"],
        }
        summary.update(
            metadata(
                "cubicasa-detail",
                CUBICASA_REVISION + ":wall-aligned-v3:2048",
                {
                    "rooms": True,
                    "icons": True,
                    "junctions": False,
                    "probabilities": True,
                    "ocr": False,
                    "wall_geometry": True,
                    "review_proposals": True,
                },
            )
        )
        summary["class_mapping"] = {"rooms": ROOM_CLASSES, "icons": ICON_CLASSES}
        summary["score_meaning"] = (
            "Mean model class softmax within region; uncalibrated. Structural checks do not verify semantic labels."
        )
        for item in extracted["instances"]:
            shape = item["shape"]
            label = ROOM_CLASSES[item["class_id"]]
            record = {
                "geometry_wkt": shape.wkt,
                "cleanup": item["cleanup"],
                "area_px": shape.area,
                "bbox": list(shape.bounds),
                "confidence": item["class_mean_softmax"],
                "instance_id": item["id"],
                "semantics_verified": False,
                "stability_iou": item["stability_iou"],
                "review_reasons": item["review_reasons"],
                "status": item["status"],
            }
            key = "review_room_polygons" if item["review_reasons"] else "room_polygons"
            summary[key].setdefault(label, []).append(record)
            summary["room_instances"].append(
                {**record, "model_label": label, "class_scores": item["class_scores"]}
            )
        for items, review in [
            (extracted["structures"], False),
            (extracted["review_structures"], True),
        ]:
            for item in items:
                shape = item["shape"]
                record = {
                    "geometry_wkt": shape.wkt,
                    "bbox": list(shape.bounds),
                    "area_px": shape.area,
                    "confidence": item["class_mean_softmax"],
                    "mean_head_support": item["mean_head_support"],
                    "review_reasons": item["review_reasons"],
                }
                if item["type"] == "wall":
                    record["class"] = ROOM_CLASSES[item["class_id"]]
                    summary[
                        "review_wall_polygons" if review else "wall_polygons"
                    ].append(record)
                else:
                    record.update(
                        {
                            "class": ICON_CLASSES[item["class_id"]],
                            "centroid_x": shape.centroid.x,
                            "centroid_y": shape.centroid.y,
                        }
                    )
                    summary[
                        "review_icon_detections" if review else "icon_detections"
                    ].append(record)
        if export_probabilities:
            np.savez_compressed(
                output / "probabilities.npz",
                room=rooms.astype(np.float16),
                icon=icons.astype(np.float16),
                heatmap=heatmaps.astype(np.float16),
                room_classes=np.asarray(ROOM_CLASSES),
                icon_classes=np.asarray(ICON_CLASSES),
            )
        return save_summary(summary, output)
