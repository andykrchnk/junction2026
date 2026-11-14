"""Live service smoke checks. Read the private key file without printing it."""

import io
import json
import time
from pathlib import Path
import urllib.error
import urllib.request
import zipfile

ROOT = Path(".local/gpu-comparison")
KEY = (ROOT / "service.env").read_text().strip().split("=", 1)[1]
DATA = (ROOT / "images/00-cubicasa5k.png").read_bytes()
BASE = "http://127.0.0.1:8001"


def post(query, key=KEY, data=DATA):
    boundary = "smoke-upload"
    body = (
        (
            f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="plan.png"\r\nContent-Type: image/png\r\n\r\n'
        ).encode()
        + data
        + f"\r\n--{boundary}--\r\n".encode()
    )
    req = urllib.request.Request(
        BASE + "/v1/predictions" + query,
        data=body,
        headers={
            "X-API-Key": key,
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=240) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


# Startup loads checkpoints; wait for readiness before measuring transport behavior.
for attempt in range(120):
    try:
        with urllib.request.urlopen(BASE + "/health/ready", timeout=2) as response:
            if response.status == 200:
                break
    except (OSError, urllib.error.URLError):
        time.sleep(0.5)
else:
    raise SystemExit("Inference API did not become ready")

records = []
for model in [
    "cubicasa",
    "cubicasa-detail",
    "raster2seq",
    "grounding-sam",
    "paddleocr",
]:
    for fmt in ["json", "zip"]:
        code, data = post(f"?model={model}&response_format={fmt}")
        record = {"model": model, "format": fmt, "status": code}
        if code == 200:
            if fmt == "zip":
                with zipfile.ZipFile(io.BytesIO(data)) as archive:
                    record["artifacts"] = archive.namelist()
                    summary = json.loads(archive.read("predictions.json"))
            else:
                summary = json.loads(data)
            record["model_matches"] = summary["model"]["name"] == model
            record["original_coordinates"] = (
                summary["coordinate_system"] == "original_image_pixels"
            )
            dimensions = (
                summary["probability_grid"]["transform"]
                if model == "cubicasa"
                else summary["image"]
            )
            record["dimensions_match"] = (
                dimensions.get("original_width", dimensions.get("width")) == 1152
                and dimensions.get("original_height", dimensions.get("height")) == 1152
            )
            record["unsupported_fields_are_null"] = all(
                summary[field] is None
                for capability, field in [
                    ("rooms", "room_polygons"),
                    ("icons", "icon_detections"),
                    ("junctions", "junctions"),
                    ("probabilities", "probability_grid"),
                ]
                if not summary["capabilities"][capability]
            )
        records.append(record)
        print(json.dumps(record), flush=True)
for label, query, key, data, expected in [
    ("auth", "", "invalid", DATA, 401),
    ("invalid_image", "", KEY, b"not an image", 422),
    ("unknown_model", "?model=missing", KEY, DATA, 422),
    ("roomformer_unavailable", "?model=roomformer", KEY, DATA, 503),
    ("default", "", KEY, DATA, 200),
]:
    code, payload = post(query, key, data)
    record = {
        "check": label,
        "status": code,
        "expected": expected,
        "passed": code == expected,
    }
    if label == "default" and code == 200:
        record["passed"] = (
            record["passed"] and json.loads(payload)["model"]["name"] == "cubicasa"
        )
    records.append(record)
    print(json.dumps(record), flush=True)
(ROOT / "service-smoke.json").write_text(json.dumps(records, indent=2))
if any(
    r.get("passed") is False
    or r.get("model_matches") is False
    or r.get("dimensions_match") is False
    or r.get("unsupported_fields_are_null") is False
    or ("model" in r and r["status"] != 200)
    for r in records
):
    raise SystemExit(1)
