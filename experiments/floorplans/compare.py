"""Summarize actual runs; count accuracy uses only explicitly mapped quantity answers."""

import csv
import json
from pathlib import Path
import statistics

from shapely import wkt
from shapely.ops import unary_union

ROOT = Path(".local/gpu-comparison")
MODELS = ["cubicasa", "raster2seq", "grounding-sam", "paddleocr"]


def prediction(model, sample):
    files = sorted((ROOT / "results" / model / sample).rglob("predictions.json"))
    return json.loads(files[0].read_text()) if files else None


def main():
    manifest = json.loads((ROOT / "manifest.json").read_text())
    records = []
    status = []
    for model in MODELS:
        folder = ROOT / "results" / model
        runs = json.loads((folder / "benchmark.json").read_text())
        config = json.loads((folder / "config.json").read_text())
        records.extend(runs)
        ok = [r for r in runs if r["status"] == "ok"]
        durations = sorted(r["seconds"] for r in ok)
        status.append(
            {
                "model": model,
                "successful": len(ok),
                "attempted": len(runs),
                "loading_seconds": config["loading_seconds"],
                "warmed_pipeline_median_seconds": statistics.median(durations),
                "warmed_pipeline_p95_seconds": durations[
                    min(len(durations) - 1, int(0.95 * len(durations)))
                ],
                "peak_torch_allocated_mib": max(
                    r["peak_torch_allocated_mib"] or 0 for r in ok
                )
                or None,
                "peak_device_used_mib": max(r["peak_device_used_mib"] or 0 for r in ok),
                "rooms": (
                    sum(r["room_count"] or 0 for r in ok)
                    if model in {"cubicasa", "raster2seq"}
                    else None
                ),
                "icons": (
                    sum(r["icon_count"] or 0 for r in ok)
                    if model != "paddleocr"
                    else None
                ),
                "ocr_lines": (
                    sum(r["ocr_lines"] or 0 for r in ok)
                    if model == "paddleocr"
                    else None
                ),
                "rejected_geometry": sum(r["rejected_geometry"] for r in ok),
            }
        )
    with (ROOT / "benchmark.csv").open("w") as f:
        writer = csv.DictWriter(
            f, fieldnames=sorted(set().union(*(r.keys() for r in records)))
        )
        writer.writeheader()
        writer.writerows(records)
    # Explicit English templates only; translated duplicate questions are excluded.
    question_mapping = {
        "How many bedrooms (makuuhuone, usually marked MH) are on this floor plan?": "Bedroom",
        "How many kitchens (including kitchenettes, open kitchens and utility kitchens) are on this floor plan?": "Kitchen",
        "How many rooms labelled 'Chambre à coucher' are there on this floor?": "Bedroom",
        "How many rooms labelled 'Schlafzimmer' are there on this floor?": "Bedroom",
        "How many rooms labelled 'Cuisine' are there on this floor?": "Kitchen",
        "How many rooms labelled 'Küche' are there on this floor?": "Kitchen",
    }
    qa = []
    for question in json.loads((ROOT / "paired-questions.json").read_text()):
        label = question_mapping.get(question["question"])
        if not label or question["type"] != "count":
            continue
        for model in ["cubicasa", "raster2seq"]:
            result = prediction(model, question["id"])
            estimated = len(result["room_polygons"].get(label, []))
            qa.append(
                {
                    "id": question["id"],
                    "model": model,
                    "class": label,
                    "expected": question["answer"],
                    "predicted": estimated,
                    "exact": estimated == question["answer"],
                    "absolute_error": abs(estimated - question["answer"]),
                    "question": question["question"],
                }
            )
    qa_summary = []
    for model in ["cubicasa", "raster2seq"]:
        data = [r for r in qa if r["model"] == model]
        qa_summary.append(
            {
                "model": model,
                "questions": len(data),
                "drawings": len(set(r["id"] for r in data)),
                "exact_count_accuracy": statistics.mean(r["exact"] for r in data),
                "mean_absolute_count_error": statistics.mean(
                    r["absolute_error"] for r in data
                ),
            }
        )
    agreement = []
    for item in manifest["samples"]:
        regions = []
        for model in ["cubicasa", "raster2seq"]:
            pred = prediction(model, item["id"])
            shapes = [
                wkt.loads(p["geometry_wkt"])
                for label, group in pred["room_polygons"].items()
                if label not in {"Outdoor", "Railing"}
                for p in group
            ]
            regions.append(unary_union(shapes))
        union = regions[0].union(regions[1]).area
        agreement.append(
            {
                "id": item["id"],
                "room_region_union_iou_between_models": (
                    regions[0].intersection(regions[1]).area / union if union else None
                ),
            }
        )
    result = {
        "models": status,
        "count_accuracy": qa_summary,
        "accuracy_scope": "Only bedroom/kitchen count questions with explicit label mapping. Small selected sample, including CubiCasa training-domain overlap. Not segmentation accuracy.",
        "geometry_agreement_scope": "Between-model region IoU is disagreement evidence, not ground-truth accuracy. Registered CAD geometry is evaluated separately in cad-geometry.json.",
        "memory_scope": "Torch allocated peak is per process. Whole-device CubiCasa sampling includes overlapping diagnostic loads and must not be treated as isolated model memory. PaddleOCR was rerun alone.",
        "model_agreement": agreement,
    }
    (ROOT / "comparison.json").write_text(json.dumps(result, indent=2))
    with (ROOT / "count-accuracy.csv").open("w") as f:
        writer = csv.DictWriter(f, fieldnames=list(qa[0]))
        writer.writeheader()
        writer.writerows(qa)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
