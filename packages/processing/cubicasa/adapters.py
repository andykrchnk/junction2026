"""Small model adapters. Optional dependencies are imported only by their worker."""

import json
import os
from pathlib import Path

from PIL import Image

CUBICASA_REVISION = "c34440266665a11f4484eb06cd2e4b7d72ad76c1"

def metadata(name, version, capabilities):
    return {
        "model": {"name": name, "version": version},
        "capabilities": capabilities,
        "coordinate_system": "original_image_pixels",
        "scores_calibrated": False,
    }


def empty_summary(width, height):
    # null means unsupported; empty lists/dicts mean supported with zero predictions.
    return {
        "room_polygons": None,
        "icon_detections": None,
        "junctions": None,
        "probability_grid": None,
        "image": {"width": width, "height": height},
    }


def save_summary(summary, output):
    output.mkdir(parents=True, exist_ok=True)
    (output / "predictions.json").write_text(
        json.dumps(summary, indent=2, allow_nan=False)
    )
    return summary, output


class CubiCasaAdapter:
    def __init__(self, checkpoint, device):
        from inference import FloorPlanSegmentor

        self.segmentor = FloorPlanSegmentor(
            str(checkpoint), device=device, fixed_size=(1024, 1024)
        )
        self.device = self.segmentor.device

    def run(self, source, output, export_probabilities):
        from inference import _result_to_json

        result, directory = self.segmentor.predict_and_save(
            source, output, save_vis=False, save_probabilities=export_probabilities
        )
        summary = _result_to_json(
            result, "probabilities.npz" if export_probabilities else None
        )
        summary.update(
            metadata(
                "cubicasa",
                CUBICASA_REVISION,
                {
                    "rooms": True,
                    "icons": True,
                    "junctions": True,
                    "probabilities": True,
                    "ocr": False,
                },
            )
        )
        summary["device"] = self.device
        summary["class_mapping"] = (
            "Existing CubiCasa ROOM_CLASSES and ICON_CLASSES; identity mapping."
        )
        return save_summary(summary, directory)


class PaddleOCRAdapter:
    def __init__(self, checkpoint, device):
        # Import Cython geometry before Paddle loads its bundled native libraries.
        import pyclipper
        from paddleocr import PaddleOCR

        self.device = device or "cuda"
        self.ocr = PaddleOCR(
            use_angle_cls=True,
            lang="en",
            use_gpu=self.device == "cuda",
            show_log=False,
            det_model_dir="/weights/ocr/det",
            rec_model_dir="/weights/ocr/rec",
            cls_model_dir="/weights/ocr/cls",
        )

    def run(self, source, output, export_probabilities):
        image = Image.open(source)
        raw = self.ocr.ocr(str(source), cls=True)
        summary = empty_summary(image.width, image.height)
        summary.update(
            metadata(
                "paddleocr",
                "2.9.1/PP-OCRv4-en",
                {
                    "rooms": False,
                    "icons": False,
                    "junctions": False,
                    "probabilities": False,
                    "ocr": True,
                },
            )
        )
        summary["ocr"] = [
            {"polygon": box, "text": text, "confidence": float(score)}
            for page in raw
            if page
            for box, (text, score) in page
        ]
        summary["device"] = self.device
        summary["dimension_interpretation"] = (
            "Text only; no inferred physical lengths or units."
        )
        output.mkdir(parents=True, exist_ok=True)
        (output / "raw.json").write_text(json.dumps(raw, ensure_ascii=False))
        return save_summary(summary, output)


def load_adapter(name, device):
    if name == "cubicasa-detail":
        from detail import CubiCasaDetailAdapter

        contrast = os.environ.get("CUBICASA_DOOR_CONTRAST", "false")
        if contrast not in {"true", "false"}:
            raise RuntimeError("CUBICASA_DOOR_CONTRAST must be true or false")
        return CubiCasaDetailAdapter(
            Path(__file__).parent / "weights/cubicasa5k.pkl",
            device,
            door_contrast=contrast == "true",
        )
    if name == "cubicasa":
        return CubiCasaAdapter(Path(__file__).parent / "weights/cubicasa5k.pkl", device)
    if name == "paddleocr":
        return PaddleOCRAdapter(None, device)
    raise ValueError("Unsupported local model")
