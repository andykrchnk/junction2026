"""Sequential warmed adapter benchmark; artifacts and failures stay local."""

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
import traceback

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "cubicasa"))
from adapters import load_adapter


def overlay(item, summary, destination):
    from shapely import wkt

    image = Image.open(item["raster_path"]).convert("RGB")
    mask_file = summary.get("mask_artifact")
    if mask_file:
        masks = np.load(destination.parent / mask_file)["masks"]
        for index, mask in enumerate(masks):
            color = [(255, 80, 50), (30, 140, 255), (20, 190, 80)][index % 3]
            alpha = Image.fromarray(mask.astype(np.uint8) * 65)
            layer = Image.new("RGB", image.size, color)
            image = Image.composite(layer, image, alpha)
    draw = ImageDraw.Draw(image, "RGBA")
    colors = [
        (255, 50, 50, 210),
        (20, 140, 255, 210),
        (0, 160, 70, 210),
        (160, 40, 200, 210),
    ]
    for i, (label, polygons) in enumerate((summary.get("room_polygons") or {}).items()):
        for polygon in polygons:
            shape = wkt.loads(polygon["geometry_wkt"])
            draw.line(
                list(shape.exterior.coords),
                fill=colors[i % len(colors)],
                width=max(2, image.width // 700),
            )
            draw.text(
                tuple(shape.representative_point().coords)[0],
                label,
                fill=colors[i % len(colors)],
            )
    for icon in summary.get("icon_detections") or []:
        draw.rectangle(icon["bbox"], outline=(255, 130, 0, 200), width=2)
        draw.text(tuple(icon["bbox"][:2]), icon["class"], fill=(255, 60, 0, 255))
    for line in summary.get("ocr") or []:
        draw.line(
            [tuple(p) for p in line["polygon"]] + [tuple(line["polygon"][0])],
            fill=(0, 100, 255, 200),
            width=2,
        )
    image.thumbnail((2000, 2000))
    image.save(destination)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    args = parser.parse_args()
    root = Path(".local/gpu-comparison")
    samples = json.loads((root / "manifest.json").read_text())["samples"]
    out = root / "results" / args.model
    if out.exists():
        # Preserve prior campaigns and prevent a failed rerun from reusing stale results.
        history = root / "history"
        history.mkdir(exist_ok=True)
        out.rename(history / (args.model + "-" + str(time.time_ns())))
    out.mkdir(parents=True, exist_ok=True)
    torch = None
    if args.model != "paddleocr":
        import torch

        if args.model != "raster2seq":
            torch.set_num_threads(4)
        torch.manual_seed(42)
    start = time.perf_counter()
    adapter = load_adapter(args.model, "cuda")
    from shapely import wkt

    if torch:
        torch.cuda.synchronize()
    loading = time.perf_counter() - start
    config = {
        "model": args.model,
        "loading_seconds": loading,
        "warmup_count": 2,
        "repetitions": 1,
        "timing_scope": "warmed adapter wall time, batch 1: decode + preprocessing + forward + postprocess + raw/normalized serialization; overlay excluded",
        "gpu_memory": "NVML whole-device used memory sampled every 50ms, plus torch max allocated where available; baseline included",
        "seed": 42,
        "cap": "service upload limits not applied to offline benchmark",
        "runtime": subprocess.check_output(
            ["python", "-m", "pip", "freeze"], text=True
        ).splitlines(),
    }
    (out / "config.json").write_text(json.dumps(config, indent=2))
    # Baseline raw network tensor is captured without changing pretrained execution.
    raw_output = {}
    if args.model == "cubicasa":
        adapter.segmentor.model.register_forward_hook(
            lambda module, inputs, output: raw_output.update(
                tensor=output.detach().cpu().numpy()
            )
        )
    for _ in range(2):
        adapter.run(samples[0]["raster_path"], out / "warmup", False)
    records = []
    for item in samples:
        destination = out / item["id"]
        record = {"id": item["id"], "source": item["source"], "model": args.model}
        stop = threading.Event()
        usage = []

        def monitor():
            while not stop.is_set():
                try:
                    usage.append(
                        int(
                            subprocess.check_output(
                                [
                                    "nvidia-smi",
                                    "--query-gpu=memory.used",
                                    "--format=csv,noheader,nounits",
                                ],
                                text=True,
                            ).strip()
                        )
                    )
                except (OSError, ValueError, subprocess.CalledProcessError):
                    pass
                stop.wait(0.05)

        thread = threading.Thread(target=monitor, daemon=True)
        if torch:
            torch.cuda.synchronize()
            torch.cuda.reset_peak_memory_stats()
        thread.start()
        start = time.perf_counter()
        try:
            summary, artifacts = adapter.run(item["raster_path"], destination, True)
            if torch:
                torch.cuda.synchronize()
            record["seconds"] = time.perf_counter() - start
            record["status"] = "ok"
            if raw_output:
                np.savez_compressed(
                    artifacts / "raw_network.npz", output=raw_output["tensor"]
                )
            overlay(item, summary, destination / "overlay.png")
            polygons = [
                wkt.loads(p["geometry_wkt"])
                for group in (summary.get("room_polygons") or {}).values()
                for p in group
            ]
            room_only = [
                p
                for label, group in (summary.get("room_polygons") or {}).items()
                if label not in {"Outdoor", "Railing"}
                for p in group
            ]
            record.update(
                room_count=(
                    len(room_only) if summary.get("room_polygons") is not None else None
                ),
                region_count=(
                    len(polygons) if summary.get("room_polygons") is not None else None
                ),
                valid_polygons=sum(p.is_valid for p in polygons) if polygons else 0,
                invalid_polygons=sum(not p.is_valid for p in polygons),
                rejected_geometry=len(summary.get("rejected_geometry", [])),
                icon_count=(
                    len(summary["icon_detections"])
                    if summary.get("icon_detections") is not None
                    else None
                ),
                ocr_lines=len(summary["ocr"]) if "ocr" in summary else None,
            )
        except Exception as error:
            record.update(
                status="failed",
                seconds=time.perf_counter() - start,
                error=type(error).__name__ + ": " + str(error),
            )
            destination.mkdir(parents=True, exist_ok=True)
            (destination / "failure.txt").write_text(traceback.format_exc())
        finally:
            stop.set()
            thread.join()
        record["peak_device_used_mib"] = max(usage) if usage else None
        record["peak_torch_allocated_mib"] = (
            torch.cuda.max_memory_allocated() / 1024**2 if torch else None
        )
        records.append(record)
        (out / "benchmark.json").write_text(json.dumps(records, indent=2))
        print(json.dumps(record), flush=True)


if __name__ == "__main__":
    main()
