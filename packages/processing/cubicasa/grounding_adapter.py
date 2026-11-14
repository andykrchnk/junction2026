"""Grounding DINO boxes prompt SAM 2.1 masks; neither is a room reconstruction model."""

import json
from pathlib import Path

import numpy as np
import torch
from PIL import Image

from adapters import empty_summary, metadata, save_summary

DINO_REVISION = "a2bb814dd30d776dcf7e30523b00659f4f141c71"
SAM_REVISION = "2b90b9f5ceec907a1c18123530e92e794ad901a4"
PROMPT = "door. window. toilet. sink. bathtub."
MAPPING = {
    "door": "Door",
    "window": "Window",
    "toilet": "Toilet",
    "sink": "Sink",
    "bathtub": "Bathtub",
}


class GroundingSAMAdapter:
    def __init__(self, device):
        from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection
        from sam2.build_sam import build_sam2
        from sam2.sam2_image_predictor import SAM2ImagePredictor

        self.device = device or "cuda"
        self.processor = AutoProcessor.from_pretrained(
            "/weights/dino", local_files_only=True
        )
        self.detector = (
            AutoModelForZeroShotObjectDetection.from_pretrained(
                "/weights/dino", local_files_only=True
            )
            .to(self.device)
            .eval()
        )
        self.sam = SAM2ImagePredictor(
            build_sam2(
                "configs/sam2.1/sam2.1_hiera_t.yaml",
                "/weights/sam2.1_hiera_tiny.pt",
                device=self.device,
            )
        )

    def run(self, source, output, export_probabilities):
        image = Image.open(source).convert("RGB")
        inputs = self.processor(images=image, text=PROMPT, return_tensors="pt").to(
            self.device
        )
        with torch.inference_mode():
            outputs = self.detector(**inputs)
            detected = self.processor.post_process_grounded_object_detection(
                outputs,
                inputs.input_ids,
                box_threshold=0.3,
                text_threshold=0.25,
                target_sizes=[(image.height, image.width)],
            )[0]
            boxes = detected["boxes"].cpu().numpy()
            masks, mask_scores = [], []
            if len(boxes):
                self.sam.set_image(np.asarray(image))
                # One box at a time limits memory for large original drawings.
                for box in boxes:
                    mask, score, _ = self.sam.predict(box=box, multimask_output=False)
                    masks.append(mask[0].astype(bool))
                    mask_scores.append(float(score[0]))
        output.mkdir(parents=True, exist_ok=True)
        if masks:
            np.savez_compressed(output / "masks.npz", masks=np.asarray(masks))
        raw = {
            "boxes": boxes.tolist(),
            "labels": detected["labels"],
            "detector_scores": detected["scores"].cpu().tolist(),
            "sam_mask_quality_scores": mask_scores,
            "prompt": PROMPT,
            "box_threshold": 0.3,
            "text_threshold": 0.25,
        }
        (output / "raw.json").write_text(json.dumps(raw))
        summary = empty_summary(image.width, image.height)
        summary.update(
            metadata(
                "grounding-sam",
                DINO_REVISION + ":sam2.1-tiny:" + SAM_REVISION,
                {
                    "rooms": False,
                    "icons": True,
                    "junctions": False,
                    "probabilities": False,
                    "ocr": False,
                    "instance_masks": True,
                },
            )
        )
        summary.update(
            {
                "icon_detections": [],
                "unmapped_detections": [],
                "class_mapping": MAPPING,
                "mask_artifact": "masks.npz" if masks else None,
                "device": self.device,
                "score_meaning": "Grounding DINO text matching score; SAM mask quality retained separately in raw.json",
            }
        )
        for i, (box, label, score) in enumerate(
            zip(boxes, detected["labels"], raw["detector_scores"])
        ):
            if label not in MAPPING:
                summary["unmapped_detections"].append({"raw_index": i, "label": label})
                continue
            ys, xs = np.nonzero(masks[i])
            summary["icon_detections"].append(
                {
                    "class": MAPPING[label],
                    "bbox": box.tolist(),
                    "centroid_x": float(xs.mean()) if len(xs) else None,
                    "centroid_y": float(ys.mean()) if len(ys) else None,
                    "area_px": int(masks[i].sum()),
                    "confidence": score,
                    "raw_index": i,
                    "mask_index": i,
                }
            )
        return save_summary(summary, output)
