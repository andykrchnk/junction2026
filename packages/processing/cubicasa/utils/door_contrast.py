"""Optional contrast derivative for review-only door discovery."""

import cv2
import numpy as np
from PIL import Image


def prepare_contrast(source):
    """Gate on source line contrast; never change source pixels or dimensions."""
    rgb = np.asarray(source.convert("RGB"))
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    background = cv2.morphologyEx(
        gray, cv2.MORPH_CLOSE, np.ones((15, 15), dtype=np.uint8)
    )
    residual = background.astype(np.int16) - gray.astype(np.int16)
    minima = cv2.erode(gray, np.ones((3, 3), dtype=np.uint8))
    ridge = (
        (gray.astype(np.int16) <= minima.astype(np.int16) + 1)
        & (residual >= 8)
        & (background >= 160)
    )
    samples = residual[ridge]
    score = float(np.percentile(samples, 25)) if samples.size >= 64 else None
    report = {
        "policy": "auxiliary-door-clahe-v1",
        "source_ridge_q25": score,
        "sample_count": int(samples.size),
        "skip_threshold": 128,
        "clip_limit": 2.0,
        "tile_grid": [8, 8],
        "scores_calibrated": False,
    }
    if score is None or score >= 128:
        report["status"] = "insufficient_linework" if score is None else "skipped"
        return None, report
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB)
    lab[:, :, 0] = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(
        lab[:, :, 0]
    )
    report["status"] = "enhanced"
    return Image.fromarray(cv2.cvtColor(lab, cv2.COLOR_LAB2RGB)), report


def same_opening(first, second):
    """Suppress shifted/overlapping candidates, without altering original geometry."""
    ax, ay, bx, by = first
    cx, cy, dx, dy = second
    intersection = max(0, min(bx, dx) - max(ax, cx)) * max(
        0, min(by, dy) - max(ay, cy)
    )
    union = (bx - ax) * (by - ay) + (dx - cx) * (dy - cy) - intersection
    center_distance = np.hypot((ax + bx - cx - dx) / 2, (ay + by - cy - dy) / 2)
    return (union > 0 and intersection / union >= 0.1) or center_distance <= 5


def additional_doors(original, enhanced, limit=32):
    """Retain original openings; new doors must pass the existing recovery verifier."""
    existing = [
        record["bbox"]
        for key in ("icon_detections", "review_icon_detections")
        for record in original.get(key, [])
        if record["class"] in {"Door", "Window"}
    ]
    candidates = [
        record
        for key in ("icon_detections", "review_icon_detections")
        for record in enhanced.get(key, [])
        if record["class"] == "Door"
    ]
    candidates.sort(key=lambda record: record["confidence"], reverse=True)
    additions = []
    for record in candidates:
        if any(same_opening(record["bbox"], bounds) for bounds in existing):
            continue
        additions.append(
            {
                **record,
                "requires_verification": True,
                "proposal_source": "auxiliary-door-clahe-v1",
                "review_reasons": [
                    *record.get("review_reasons", []),
                    "contrast_derivative_requires_original_source_verification",
                ],
            }
        )
        existing.append(record["bbox"])
        if len(additions) >= limit:
            break
    return additions
