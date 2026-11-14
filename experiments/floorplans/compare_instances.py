"""Compare room-instance proposals using registered CAD; no references enter inference."""

import argparse
import csv
import json
from pathlib import Path
import sys
import time

import numpy as np
from scipy.optimize import linear_sum_assignment
from shapely import wkt
from shapely.ops import unary_union

ROOT = Path(".local/cubicasa-refinement-v2")
DATA = Path(".local/gpu-comparison")
DRAWINGS = [
    "19-swiss_dwellings",
    "20-swiss_dwellings",
    "21-swiss_dwellings",
    "00-cubicasa5k",
    "12-ifc_models",
    "23-wikimedia",
]


def instance_metrics(predicted, reference):
    scores = np.zeros((len(predicted), len(reference)))
    merges = 0
    for i, proposal in enumerate(predicted):
        covered = 0
        for j, target in enumerate(reference):
            intersection = proposal.intersection(target).area
            scores[i, j] = (
                intersection / (proposal.area + target.area - intersection)
                if intersection
                else 0
            )
            covered += intersection / target.area > 0.5
        merges += covered >= 2
    # Maximize the number of threshold-qualified matches first, then their IoU.
    qualified = scores >= 0.5
    utility = qualified * (min(scores.shape) + 1) + scores
    rows, columns = linear_sum_assignment(-utility)
    matches = int(sum(qualified[i, j] for i, j in zip(rows, columns)))
    proposed_union, target_union = unary_union(predicted), unary_union(reference)
    return {
        "proposals": len(predicted),
        "reference_regions": len(reference),
        "merged_reference_regions": int(merges),
        "matched_iou_05": matches,
        "precision_iou_05": matches / len(predicted) if predicted else 0,
        "recall_iou_05": matches / len(reference) if reference else 0,
        "union_iou": proposed_union.intersection(target_union).area
        / proposed_union.union(target_union).area,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--predict", action="store_true")
    parser.add_argument("--drawings", nargs="+", default=DRAWINGS)
    args = parser.parse_args()
    samples = {
        s["id"]: s for s in json.loads((DATA / "manifest.json").read_text())["samples"]
    }
    if args.predict:
        import torch

        sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "cubicasa"))
        from adapters import load_adapter

        torch.set_num_threads(4)
        torch.manual_seed(42)
        adapter = load_adapter("cubicasa-detail", "cuda")
        for identifier in args.drawings:
            output = ROOT / "adapter" / identifier
            if output.exists():
                history = ROOT / "history"
                history.mkdir(exist_ok=True)
                output.rename(history / (identifier + "-" + str(time.time_ns())))
            adapter.run(samples[identifier]["raster_path"], output, True)
    results = []
    for identifier in args.drawings:
        directory = ROOT / "adapter" / identifier
        summary = json.loads((directory / "predictions.json").read_text())
        raw = json.loads((directory / "raw.json").read_text())
        transform = raw["transform"]
        minimum = (
            transform["original_width"]
            * transform["original_height"]
            * summary["settings"]["minimum_area_fraction"]
        )
        walls = unary_union(
            [wkt.loads(p["geometry_wkt"]) for p in summary["wall_polygons"]]
        )
        regions = summary["room_instances"]
        record = {
            "id": identifier,
            "minimum_area_px": minimum,
            "all_candidates": len(regions),
            "passes_checks": sum(
                p["status"] == "passes_structural_checks" for p in regions
            ),
            "needs_review": sum(p["status"] == "needs_review" for p in regions),
            "max_overlap_with_accepted_walls_px": max(
                (
                    wkt.loads(p["geometry_wkt"]).intersection(walls).area
                    for p in regions
                ),
                default=0,
            ),
            "semantics_verified": False,
        }
        reference_path = DATA / "cad-ground-truth" / (identifier + ".json")
        if reference_path.exists():
            reference = json.loads(reference_path.read_text())
            if reference["compatible"]:
                truth = [
                    wkt.loads(g)
                    for g in reference["reference_polygons_wkt"]
                    if wkt.loads(g).area >= minimum
                ]
                previous = [
                    wkt.loads(p["geometry_wkt"])
                    for p in raw["official_room_regions"]
                    if wkt.loads(p["geometry_wkt"]).is_valid
                    and wkt.loads(p["geometry_wkt"]).area >= minimum
                ]
                all_candidates = [wkt.loads(p["geometry_wkt"]) for p in regions]
                visible = [
                    wkt.loads(p["geometry_wkt"])
                    for p in regions
                    if p["status"] == "passes_structural_checks"
                ]
                record["before"] = instance_metrics(previous, truth)
                record["after_all"] = instance_metrics(all_candidates, truth)
                record["after_default"] = instance_metrics(visible, truth)
                record["reference_regions_below_area_filter"] = len(
                    reference["reference_polygons_wkt"]
                ) - len(truth)
        results.append(record)
    report = {
        "scope": "Six selected drawings; three with compatible registered CAD. Exploratory, not a held-out benchmark.",
        "metric_definition": "One-to-one maximum-cardinality matching at polygon IoU >= 0.5. Merged proposal means it covers >50% of at least two CAD regions. CAD zones are not necessarily separate physical rooms.",
        "filter": "Same minimum area (0.01% of source page pixels) for both prediction sets and CAD regions. Exclusions reported.",
        "review": "Passing structural checks does not verify geometry or semantic labels. Default view may omit legitimate regions.",
        "drawings": results,
    }
    (ROOT / "instance-comparison.json").write_text(json.dumps(report, indent=2))
    with (ROOT / "instance-comparison.csv").open("w") as stream:
        rows = [
            {"id": r["id"], "mode": mode, **r[mode]}
            for r in results
            for mode in ["before", "after_all", "after_default"]
            if mode in r
        ]
        writer = csv.DictWriter(
            stream, fieldnames=list(rows[0]) if rows else ["id", "mode"]
        )
        writer.writeheader()
        writer.writerows(rows)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
