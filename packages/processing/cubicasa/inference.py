"""
CubiCasa5K floor plan segmentation – inference entry point.

Usage
-----
# Single image
python inference.py --checkpoint weights/cubicasa5k.pkl --image floor_plan.png

# Batch (folder)
python inference.py --checkpoint weights/cubicasa5k.pkl --input_dir plans/ --output_dir results/

# Programmatic use
    from inference import FloorPlanSegmentor
    seg = FloorPlanSegmentor("weights/cubicasa5k.pkl")
    result = seg.predict("floor_plan.png")
"""

import argparse
import json
from pathlib import Path
from typing import List, Union

import numpy as np
import torch
from PIL import Image
from tqdm import tqdm

from model import CubiCasa5K
from model.segmentation_net import ICON_CLASSES, ROOM_CLASSES
from utils import PostProcessor, preprocess_image, visualize_predictions


# ---------------------------------------------------------------------------
# High-level API
# ---------------------------------------------------------------------------

class FloorPlanSegmentor:
    """
    Simple wrapper for running CubiCasa5K inference on floor plan images.

    Parameters
    ----------
    checkpoint   : path to the .pkl / .pth pretrained weights
    device       : "cuda", "cpu", or "mps"
    fixed_size   : (H, W) if you want a fixed resolution; None = keep original
    min_room_area: minimum pixel area for a room polygon to be kept
    """

    def __init__(
        self,
        checkpoint: str,
        device: str = None,
        fixed_size=None,
        min_room_area: int = 500,
        polygon_simplify_tolerance: float = 2.0,
        min_icon_area: int = 50,
    ):
        if device is None:
            if torch.cuda.is_available():
                device = "cuda"
            elif torch.backends.mps.is_available():
                device = "mps"
            else:
                device = "cpu"

        self.device = device
        self.fixed_size = fixed_size
        self.model = CubiCasa5K.from_pretrained(checkpoint, device=device)
        self.postprocessor = PostProcessor(
            min_room_area=min_room_area,
            polygon_simplify_tolerance=polygon_simplify_tolerance,
            min_icon_area=min_icon_area,
        )

    # ------------------------------------------------------------------

    @torch.inference_mode()
    def predict(self, image: Union[str, Path, np.ndarray, Image.Image]):
        """
        Run inference on a single floor plan image.

        Returns
        -------
        result : SegmentationResult
        """
        tensor, transform = preprocess_image(
            image, fixed_size=self.fixed_size, device=self.device
        )
        output = self.model(tensor)   # (1, 44, H, W)
        return self.postprocessor.process(output, transform)

    # ------------------------------------------------------------------

    def predict_and_save(
        self,
        image_path: Union[str, Path],
        output_dir: Union[str, Path],
        save_vis: bool = True,
        save_json: bool = True,
        save_probabilities: bool = True,
    ):
        """
        Predict and write outputs to output_dir/<stem>/:
          - room_mask.npy, icon_mask.npy, wall_mask.npy
          - predictions.json  (detections, vectors, confidence and transform)
          - probabilities.npz (compact model-space class probabilities)
          - visualization.png (if save_vis=True)
        """
        image_path = Path(image_path)
        out_dir = Path(output_dir) / image_path.stem
        out_dir.mkdir(parents=True, exist_ok=True)

        result = self.predict(image_path)

        # --- Save numpy masks ---
        np.save(out_dir / "room_mask.npy", result.room_mask)
        np.save(out_dir / "icon_mask.npy", result.icon_mask)
        np.save(out_dir / "wall_mask.npy", result.wall_mask)

        if save_probabilities:
            np.savez_compressed(
                out_dir / "probabilities.npz",
                room=result.room_probabilities.astype(np.float16),
                icon=result.icon_probabilities.astype(np.float16),
                heatmap=result.heatmap_probabilities.astype(np.float16),
                room_classes=np.asarray(ROOM_CLASSES),
                icon_classes=np.asarray(ICON_CLASSES),
            )

        # --- Save JSON summary ---
        if save_json:
            summary = _result_to_json(
                result,
                probability_file="probabilities.npz" if save_probabilities else None,
            )
            with open(out_dir / "predictions.json", "w") as f:
                json.dump(summary, f, indent=2)

        # --- Save visualisation ---
        if save_vis:
            orig = np.array(Image.open(image_path).convert("RGB"))
            visualize_predictions(
                orig,
                result,
                save_path=str(out_dir / "visualization.png"),
                show=False,
            )

        return result, out_dir


# ---------------------------------------------------------------------------
# JSON serialisation helper
# ---------------------------------------------------------------------------

def _result_to_json(result, probability_file: str | None = "probabilities.npz") -> dict:
    summary = {
        "probability_grid": {
            "file": probability_file,
            "shape": [
                result.transform.content_height,
                result.transform.content_width,
            ],
            "transform": result.transform.to_dict(),
            "description": (
                "Probabilities are stored at the unpadded model resolution; "
                "use transform to map them to source pixels."
            ),
        },
        "icon_detections": [
            {
                "class": detection.class_name,
                "centroid_y": round(detection.centroid_y, 2),
                "centroid_x": round(detection.centroid_x, 2),
                "area_px": round(detection.area_px, 2),
                "confidence": round(detection.confidence, 4),
                "bbox": [round(value, 2) for value in detection.bbox],
            }
            for detection in result.icon_detections
        ],
        "room_polygons": {
            cls_name: [
                {
                    "geometry_wkt": polygon.wkt,
                    "area_px": round(polygon.area, 2),
                    "confidence": round(confidence, 4),
                    "bbox": [round(value, 2) for value in polygon.bounds],
                }
                for polygon, confidence in zip(
                    polygons,
                    result.room_polygon_confidences[cls_name],
                )
            ]
            for cls_name, polygons in result.room_polygons.items()
        },
        "junctions": [
            {
                "y": round(y, 2),
                "x": round(x, 2),
                "confidence": round(confidence, 4),
            }
            for y, x, confidence in result.junctions
        ],
    }
    if probability_file is None:
        summary["probability_grid"]["description"] = "Probability map export disabled."
    return summary


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _parse_args():
    p = argparse.ArgumentParser(
        description="CubiCasa5K floor plan segmentation"
    )
    p.add_argument("--checkpoint", required=True, help="Path to pretrained weights (.pkl/.pth)")
    p.add_argument("--image",      help="Single input image path")
    p.add_argument("--input_dir",  help="Directory of input images (batch mode)")
    p.add_argument("--output_dir", default="results", help="Where to write outputs")
    p.add_argument("--device",     default=None, help="cuda / cpu / mps")
    p.add_argument("--fixed_size", default=None, nargs=2, type=int,
                   metavar=("H", "W"), help="Resize input to H×W (default: keep original)")
    p.add_argument("--no_vis",     action="store_true", help="Skip visualisation PNG")
    p.add_argument("--no_json",    action="store_true", help="Skip predictions.json")
    p.add_argument("--no_probabilities", action="store_true",
                   help="Skip compressed per-class probability maps")
    p.add_argument("--min_room_area", type=int, default=500)
    return p.parse_args()


def _collect_images(args) -> List[Path]:
    exts = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp"}
    if args.image:
        return [Path(args.image)]
    if args.input_dir:
        return sorted(
            p for p in Path(args.input_dir).iterdir()
            if p.suffix.lower() in exts
        )
    raise ValueError("Provide --image or --input_dir")


def main():
    args = _parse_args()
    segmentor = FloorPlanSegmentor(
        checkpoint=args.checkpoint,
        device=args.device,
        fixed_size=tuple(args.fixed_size) if args.fixed_size else None,
        min_room_area=args.min_room_area,
    )

    images = _collect_images(args)
    print(f"Processing {len(images)} image(s)…")

    for img_path in tqdm(images):
        result, out_dir = segmentor.predict_and_save(
            img_path,
            output_dir=args.output_dir,
            save_vis=not args.no_vis,
            save_json=not args.no_json,
            save_probabilities=not args.no_probabilities,
        )
        print(f"  {img_path.name} → {out_dir}")

        n_rooms = sum(len(v) for v in result.room_polygons.values())
        n_icons = len(result.icon_detections)
        print(f"    Rooms: {n_rooms} polygons | Icons: {n_icons} detections")


if __name__ == "__main__":
    main()
