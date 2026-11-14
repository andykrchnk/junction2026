"""Small model adapters. Optional dependencies are imported only by their worker."""

import json
from pathlib import Path

import numpy as np
from PIL import Image

CUBICASA_REVISION = "c34440266665a11f4484eb06cd2e4b7d72ad76c1"
RASTER2SEQ_REVISION = "d938188027cd4f2bed9f95c883e5cc6d80b507f5"
RASTER2SEQ_CHECKPOINT_REVISION = "58e66d2887a581e4c9750a905872901ea92e4318"
RASTER_LABELS = {
    0: "Outdoor",
    1: "Kitchen",
    2: "Living Room",
    3: "Bedroom",
    4: "Bath",
    5: "Hallway",
    6: "Storage",
    7: "Garage",
    8: "Undefined",
    9: "Window",
    10: "Door",
}


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


class Raster2SeqAdapter:
    def __init__(self, checkpoint, device):
        import torch
        from predict import get_args_parser
        from datasets.discrete_tokenizer import DiscreteTokenizer
        from datasets.transforms import ResizeAndPad
        from models import build_model

        self.device = device or "cuda"
        args = get_args_parser().parse_args([])
        for key, value in json.loads(
            Path("/weights/raster2seq-config.json").read_text()
        )["inference_args"].items():
            setattr(args, key, value)
        if args.disable_poly_refine:
            args.with_poly_refine = False
        args.lr_backbone = 0
        tokenizer = DiscreteTokenizer(
            args.num_bins, args.seq_len, add_cls=args.add_cls_token
        )
        args.vocab_size = len(tokenizer)
        self.model = (
            build_model(args, train=False, tokenizer=tokenizer).to(self.device).eval()
        )
        state = torch.load(checkpoint, map_location="cpu")["ema"]
        # The release includes transient decoding caches, which are rebuilt per input.
        cache_suffixes = (
            ".kv_cache.k_cache",
            ".kv_cache.v_cache",
            ".cross_attn.cache.v_cache",
        )
        state = {
            key: value
            for key, value in state.items()
            if not key.endswith(cache_suffixes)
        }
        self.model.load_state_dict(state, strict=True)
        self.resize = ResizeAndPad((256, 256), pad_value=255)

    def run(self, source, output, export_probabilities):
        import torch
        from engine import generate
        from shapely.geometry import Polygon, LineString

        output.mkdir(parents=True, exist_ok=True)
        image = np.asarray(Image.open(source).convert("RGB"))
        h, w = image.shape[:2]
        scale = min(256 / h, 256 / w)
        ch, cw = int(h * scale), int(w * scale)
        top, left = (256 - ch) // 2, (256 - cw) // 2
        prepared = self.resize.get_transform(image).apply_image(image)
        tensor = (
            torch.as_tensor(prepared.copy())
            .permute(2, 0, 1)
            .unsqueeze(0)
            .to(self.device)
            .float()
            / 255
        )
        with torch.inference_mode():
            raw = generate(
                self.model,
                tensor,
                semantic_rich=True,
                poly2seq=True,
                use_cache=True,
                per_token_sem_loss=True,
            )
        polygons, labels = raw["room"][0], raw["labels"][0]
        raw_json = {
            "polygons": [np.asarray(p).tolist() for p in polygons],
            "labels": [int(c) for c in labels],
            "transform": {
                "model_width": 256,
                "model_height": 256,
                "content_width": cw,
                "content_height": ch,
                "padding_left": left,
                "padding_top": top,
                "original_width": w,
                "original_height": h,
            },
        }
        (output / "raw.json").write_text(json.dumps(raw_json))
        summary = empty_summary(w, h)
        summary.update(
            metadata(
                "raster2seq",
                RASTER2SEQ_REVISION + ":" + RASTER2SEQ_CHECKPOINT_REVISION,
                {
                    "rooms": True,
                    "icons": True,
                    "junctions": False,
                    "probabilities": False,
                    "ocr": False,
                },
            )
        )
        summary.update(
            {
                "room_polygons": {},
                "icon_detections": [],
                "rejected_geometry": [],
                "class_mapping": RASTER_LABELS,
                "device": self.device,
                "checkpoint": "cubicasa5k/EMA",
                "score_meaning": "not exported by upstream generate",
            }
        )
        for points, label in zip(polygons, labels):
            label = int(label)
            if label not in RASTER_LABELS:
                summary["rejected_geometry"].append(
                    {"label": label, "reason": "unmapped upstream label"}
                )
                continue
            points = np.asarray(points, dtype=float).reshape(-1, 2)
            mapped = np.column_stack(
                ((points[:, 0] - left) * w / cw, (points[:, 1] - top) * h / ch)
            )
            if not np.isfinite(mapped).all():
                summary["rejected_geometry"].append(
                    {"label": label, "reason": "nonfinite coordinates"}
                )
                continue
            if label in {9, 10} and len(mapped) >= 2:
                shape = LineString(mapped)
                if not shape.is_valid or shape.is_empty or shape.length <= 0:
                    summary["rejected_geometry"].append(
                        {
                            "label": label,
                            "reason": "invalid or empty line",
                            "geometry_wkt": shape.wkt,
                        }
                    )
                    continue
                summary["icon_detections"].append(
                    {
                        "class": RASTER_LABELS[label],
                        "geometry_wkt": shape.wkt,
                        "bbox": list(shape.bounds),
                        "centroid_x": shape.centroid.x,
                        "centroid_y": shape.centroid.y,
                        "area_px": None,
                        "confidence": None,
                    }
                )
            elif len(mapped) >= 3:
                shape = Polygon(mapped)
                if not shape.is_valid or shape.is_empty or shape.area <= 0:
                    summary["rejected_geometry"].append(
                        {
                            "label": label,
                            "reason": "invalid or empty polygon",
                            "geometry_wkt": shape.wkt,
                        }
                    )
                    continue
                summary["room_polygons"].setdefault(RASTER_LABELS[label], []).append(
                    {
                        "geometry_wkt": shape.wkt,
                        "bbox": list(shape.bounds),
                        "area_px": shape.area,
                        "confidence": None,
                    }
                )
        return save_summary(summary, output)


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

        return CubiCasaDetailAdapter(
            Path(__file__).parent / "weights/cubicasa5k.pkl", device
        )
    if name == "cubicasa":
        return CubiCasaAdapter(Path(__file__).parent / "weights/cubicasa5k.pkl", device)
    if name == "raster2seq":
        return Raster2SeqAdapter("/weights/raster2seq-checkpoint.pth", device)
    if name == "paddleocr":
        return PaddleOCRAdapter(None, device)
    if name == "grounding-sam":
        from grounding_adapter import GroundingSAMAdapter

        return GroundingSAMAdapter(device)
    raise ValueError("Unsupported local model")
