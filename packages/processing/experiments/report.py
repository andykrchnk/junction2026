"""Export the private comparison as a self-contained local report and artifact index."""

import argparse
import html
import json
from pathlib import Path
import shutil
import zipfile

from PIL import Image

ROOT = Path(".local/gpu-comparison")
MODELS = ["cubicasa", "raster2seq", "grounding-sam", "paddleocr"]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=ROOT / "report")
    args = parser.parse_args()
    out = args.output
    out.mkdir(parents=True, exist_ok=True)
    (out / "assets").mkdir(exist_ok=True)
    (out / "licenses").mkdir(exist_ok=True)
    summary = json.loads((ROOT / "comparison.json").read_text())
    manifest = json.loads((ROOT / "manifest.json").read_text())
    for name in [
        "manifest.json",
        "benchmark.csv",
        "count-accuracy.csv",
        "comparison.json",
        "service-smoke.json",
        "checkpoint-sha256.json",
        "image-ids.json",
        "sympointv2-parser-attempt.json",
        "vector-compatibility.json",
        "cad-geometry.json",
        "dxf-inspection.json",
    ]:
        shutil.copyfile(ROOT / name, out / name)
    shutil.copyfile(Path(__file__).with_name("README.md"), out / "reproduce.txt")
    shutil.copyfile(
        Path(__file__).with_name("sources.lock.json"), out / "sources.lock.json"
    )
    for item in manifest["samples"]:
        license = Path(item["license"])
        shutil.copyfile(license, out / "licenses" / (item["source"] + ".md"))
    index = []
    for path in sorted((ROOT / "results").rglob("*")):
        if path.is_file() and "warmup" not in path.parts:
            index.append({"path": str(path.resolve()), "bytes": path.stat().st_size})
    (out / "raw-artifact-index.json").write_text(json.dumps(index, indent=2))
    rows = []
    for model in summary["models"]:
        allocated = model["peak_torch_allocated_mib"]
        memory = (
            f"{allocated:.1f} MiB allocated (Torch)"
            if allocated is not None
            else f"{model['peak_device_used_mib']} MiB device used (isolated)"
        )
        rows.append(
            f"<tr><td>{model['model']}</td><td>{model['successful']}/26</td><td>{model['loading_seconds']:.2f} s</td><td>{model['warmed_pipeline_median_seconds']:.3f} s</td><td>{model['warmed_pipeline_p95_seconds']:.3f} s</td><td>{memory}</td></tr>"
        )
    rows.extend(
        [
            "<tr><td>RoomFormer</td><td>blocked: scan-density input unavailable</td><td>—</td><td>—</td><td>—</td><td>not run</td></tr>",
            "<tr><td>SymPointV2</td><td>blocked: SVG parser incompatibility</td><td>—</td><td>—</td><td>—</td><td>not run</td></tr>",
        ]
    )
    qa = "".join(
        f"<tr><td>{q['model']}</td><td>{round(q['exact_count_accuracy']*q['questions'])}/{q['questions']}</td><td>{q['mean_absolute_count_error']:.2f}</td></tr>"
        for q in summary["count_accuracy"]
    )
    gallery = []
    benchmarks = {
        model: {
            r["id"]: r
            for r in json.loads(
                (ROOT / "results" / model / "benchmark.json").read_text()
            )
        }
        for model in MODELS
    }
    for item in manifest["samples"]:
        figures = []
        for model in ["original", "cad-reference"] + MODELS:
            if model == "cad-reference":
                reference = ROOT / "cad-ground-truth" / (item["id"] + "-reference.png")
                if not reference.exists():
                    continue
            src = (
                Path(item["raster_path"])
                if model == "original"
                else ROOT / "results" / model / item["id"] / "overlay.png"
            )
            if model == "cad-reference":
                src = reference
            target = out / "assets" / (item["id"] + "-" + model + ".png")
            if model == "original":
                with Image.open(src) as image:
                    image = image.convert("RGB")
                    image.thumbnail((1600, 1600))
                    image.save(target)
            else:
                shutil.copyfile(src, target)
            caption = model
            if model not in {"original", "cad-reference"}:
                r = benchmarks[model][item["id"]]
                caption += f" · rooms {r['room_count'] if r['room_count'] is not None else 'unsupported'} · symbols {r['icon_count'] if r['icon_count'] is not None else 'unsupported'}"
                if r["ocr_lines"] is not None:
                    caption += f" · text lines {r['ocr_lines']}"
            figures.append(
                f'<figure><a href="assets/{target.name}"><img loading="lazy" src="assets/{target.name}" alt="{html.escape(caption)}"></a><figcaption>{html.escape(caption)}</figcaption></figure>'
            )
        gallery.append(
            f'<details><summary>{item["id"]}</summary><p class="path">{html.escape(item["path"])}</p><p><a href="licenses/{item["source"]}.md">Source credit and licence</a> · original raster {item["width"]}×{item["height"]}; PDF page {item["page"] if item["page"] is not None else "n/a"}. Vector siblings: {len(item["vector_inputs"])}.</p><div class="gallery">'
            + "".join(figures)
            + "</div></details>"
        )
    document = (
        """<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Private floor-plan model comparison</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:1400px;margin:40px auto;padding:0 24px;color:#172331;background:#f8fafb}h1,h2{line-height:1.2}h1{max-width:900px}p{max-width:1050px}table{border-collapse:collapse;width:100%;background:white;margin:24px 0}td,th{text-align:left;border-bottom:1px solid #d9e0e5;padding:12px}th{background:#e8eef2}code{background:#e9eef2;padding:2px 5px}a{color:#125b98}details{border:1px solid #d9e0e5;margin:12px 0;background:white;padding:16px}summary{cursor:pointer;font-weight:600}.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px}figure{margin:0}img{width:100%;height:300px;object-fit:contain;background:#eee}figcaption{font-size:13px}.path{overflow-wrap:anywhere;font-size:13px}.note{border-left:4px solid #56738a;padding-left:18px}footer{margin-top:40px;color:#536674}</style>
<h1>Four pretrained pipelines, 26 drawings, one private inference API</h1>
<p>14 November 2026 · NVIDIA A100-SXM4-80GB · driver 580.178.04 · Docker 29.9.3 · branch <code>feature/gpu-model-comparison</code>. No training, commits or pushes.</p>
<p class="note"><strong>Recommendation:</strong> retain CubiCasa as the default during review, expose Raster2Seq as an alternative geometry proposal, and use PaddleOCR for text. Neither geometry model supports unattended quantity takeoff on this panel. Keep DINO + SAM experimental: its current prompts often find whole-sheet regions rather than symbols.</p>
<h2>Model status and observed performance</h2><table><thead><tr><th>Model</th><th>Completed</th><th>Loading</th><th>Warm median</th><th>Warm p95</th><th>Peak GPU memory</th></tr></thead><tbody>"""
        + "".join(rows)
        + """</tbody></table>
<p>Batch 1, two warmups, one run per drawing. Warm wall time includes decoding, preprocessing, forward execution, postprocessing and ordinary artifact serialization; overlays and CubiCasa's extra raw-network archive are excluded. CubiCasa also writes probabilities; other models cannot. These are pipeline latencies, not a forward-only speed ranking. Torch allocated memory excludes CUDA context and reservation; Paddle's whole-device number includes them. CubiCasa's whole-device measurements had overlapping diagnostic loads and are excluded from this memory table.</p>
<p><strong>RoomFormer:</strong> blocked by input compatibility. Its official checkpoints require top-down density maps projected from 3D scans; the dataset supplies drawings and IFC models, not matching scan projections. The official checkpoint endpoint was reachable. <strong>SymPointV2:</strong> official weights downloaded and hashed, but neither sampled SVG parses: <code>KeyError: stroke</code> and <code>KeyError: viewBox</code>. Its parser expects FloorplanCAD primitive/layer features; no direct DXF/DWG path is supplied. Both remain disabled.</p>
<h2>What the outputs show</h2>
<p>Inspection of paired overlays (00, 01, 06, 12, 19 and 23) found complementary failure modes. CubiCasa often splits room regions or follows furniture/text details. Raster2Seq gives simpler boundaries on clean plans, but can omit rooms, place regions outside the plan, or assign room semantics to unsuitable areas: it labels the central courtyard on 23 as a bedroom. On 06, CubiCasa also proposes regions over an elevation; Raster2Seq largely focuses on the floor-plan portion. These are qualitative observations, not geometric accuracy measurements.</p>
<p>CubiCasa produced 436 room-region proposals and 755 icon components. Raster2Seq retained 162 room regions and 360 door/window elements, while recording 59 rejected invalid/empty or unmapped outputs. Region counts exclude Outdoor and Railing, but do not establish instance identity. All exported normalized polygons are valid; this does not show alignment or completeness. Raw rejected geometry is retained rather than silently repaired.</p>
<p>DINO + SAM produced 78 mapped detections. Full-drawing boxes appear in clean-plan examples; no precision or recall is claimed without compatible boxes/masks. SAM masks are box-prompted, not room reconstruction. PaddleOCR produced 621 text lines, including labels and dimension strings, with many omissions on small or historic text. This is the English model; multilingual accuracy and dimensional interpretation are unvalidated. OCR numbers are never converted into physical measurements.</p>
<!-- CAD_METRICS --><h2>Limited ground-truth count check</h2><table><thead><tr><th>Geometry model</th><th>Exact answers</th><th>Mean absolute count error</th></tr></thead><tbody>"""
        + qa
        + """</tbody></table>
<p>Only 12 explicitly mapped bedroom/kitchen questions across seven drawings qualify; translated duplicates are excluded. Accuracy is exact count agreement, not segmentation IoU. No ready-aligned room masks were supplied; registered Swiss CAD reference geometry is scored separately above. CubiCasa examples may overlap both geometry models' training sets; split membership is unknown after renaming. This small mixed-source sample is not a clean held-out accuracy benchmark. No confidence scores are compared as calibrated probabilities.</p>
<h2>Private service and verification</h2>
<p><code>http://127.0.0.1:8001/v1/predictions?model=cubicasa|raster2seq|grounding-sam|paddleocr</code>. CubiCasa is the default. Every working adapter passed JSON and ZIP live checks through this API. Authentication, invalid-image rejection, unknown selection, unavailable RoomFormer selection and default behavior passed. Workers have no published ports; only the gateway binds to host loopback. Credentials remain in a mode-0600 ignored file and are absent from this report.</p>
<p>Repository type checking, lint, formatting and build passed after installing both workspace and design-system dependencies. Python compilation, shell syntax, Compose configuration and full-diff pattern self-review were also performed. No tests were added or modified. See <a href="verification.txt">verification notes</a> for final check evidence and review scope.</p>
<h2>Evidence and reproduction</h2><p><a href="reproduce.txt">Reproducible commands and contract details</a> · <a href="sources.lock.json">Pinned official sources and checkpoint checksums</a> · <a href="manifest.json">Fixed sample manifest</a> · <a href="benchmark.csv">Per-drawing benchmark CSV</a> · <a href="comparison.json">Summary and between-model agreement</a> · <a href="count-accuracy.csv">Matched count evidence</a> · <a href="service-smoke.json">Live service checks</a> · <a href="raw-artifact-index.json">Raw artifact paths on the remote host</a> · <a href="comparison-artifacts.zip">Normalized outputs, raw JSON and overlays ZIP</a> · <a href="implementation.patch">Uncommitted implementation diff</a></p>
<p>The original raster/PDF/vector inputs remain under <code>datasets/stoa-dataset</code> and are Git-ignored. PDFs use page zero, RGB, 150 DPI. Original vector/CAD files are preserved unchanged. The fixed panel covers eight raster/PDF sources; IFC-only data is inventoried separately. Elevations, structural details and mixed historic sheets are explicit stress cases, not all pure floor plans. Raw numerical arrays and masks remain in the ignored experiment results directory, indexed above; they are not duplicated in the compact ZIP.</p>
<h2>All paired overlays</h2><p>Expand a drawing to compare its source image and all four outputs. Overlay images preserve original-image coordinates before thumbnailing. Each source's licence and credit accompanies the drawing.</p>
"""
        + "".join(gallery)
        + """<footer>Private Junction experiment. Source-specific data licences and separate noncommercial model terms apply. No artifacts or services were published.</footer></html>"""
    )
    cad = json.loads((ROOT / "cad-geometry.json").read_text())
    cad_rows = []
    for drawing in cad["drawings"]:
        values = [
            (
                f"{drawing['models'][model]['class_agnostic_region_union_iou']:.3f}"
                if drawing["compatible"]
                else "not scored"
            )
            for model in ["cubicasa", "raster2seq"]
        ]
        cad_rows.append(
            f"<tr><td>{drawing['id']}</td><td>{drawing['valid_cad_regions']}</td><td>{values[0]}</td><td>{values[1]}</td></tr>"
        )
    cad_section = (
        "<h2>Registered CAD geometry comparison</h2><table><tr><th>Drawing</th><th>Valid CAD regions</th><th>CubiCasa union IoU</th><th>Raster2Seq union IoU</th></tr>"
        + "".join(cad_rows)
        + "</table><p>Three Swiss DXFs provide compatible ROOM_OUTLINE reference geometry after a validated scale/translation and Y-axis inversion. Ten outline bounding boxes establish each transform; every valid closed polygon boundary independently matches the paired PDF vector paths within 0.001 point. The fourth drawing fails this gate for two regions and is not scored. Green CAD reference overlays accompany scored drawings. Nonpolygon/invalid CAD entities are excluded explicitly, without repair. This is class-agnostic CAD region-union coverage, including outdoor regions, not room-instance or semantic accuracy and not independent human annotation. It supports CubiCasa for coverage on these three drawings, while its fragmented polygons and unreliable labels remain concerns. <a href='cad-geometry.json'>Registration, exclusions and metrics</a>.</p>"
    )
    document = document.replace("<!-- CAD_METRICS -->", cad_section)
    (out / "report.html").write_text(document)
    with zipfile.ZipFile(
        out / "comparison-artifacts.zip", "w", zipfile.ZIP_DEFLATED, compresslevel=1
    ) as archive:
        for model in MODELS:
            for path in (ROOT / "results" / model).rglob("*"):
                if (
                    path.is_file()
                    and "warmup" not in path.parts
                    and path.suffix in {".json", ".png", ".txt"}
                ):
                    archive.write(path, path.relative_to(ROOT / "results"))
        for path in (out / "licenses").iterdir():
            archive.write(path, "licenses/" + path.name)
        for name in [
            "manifest.json",
            "benchmark.csv",
            "count-accuracy.csv",
            "comparison.json",
            "sources.lock.json",
            "service-smoke.json",
        ]:
            archive.write(out / name, name)
    print(out / "report.html")


if __name__ == "__main__":
    main()
