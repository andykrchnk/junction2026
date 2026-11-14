# GPU model comparison

Run from the repository root on the private NVIDIA host. The existing
`/v1/predictions` boundary owns authentication, upload validation, serialization
and request concurrency. Each worker owns one pretrained model. No training is
performed. CubiCasa remains the default; there is no frontend model selector.

## Reproduce

```bash
# Official source revisions, checkpoint URLs and SHA256s are in sources.lock.json.
# Reuse existing data first; strip the archive's junction-dataset/ prefix on extraction.
bash packages/processing/experiments/setup.sh

# Runs models sequentially, after stopping only this Compose project's services.
bash packages/processing/experiments/run.sh

docker run --rm -v "$PWD:/repo" junction-geometry:gpu-comparison \
  python packages/processing/experiments/cad_geometry.py

docker run --rm --user 0 -v "$PWD:/repo" -w /repo \
  junction-cubicasa:gpu-comparison \
  python packages/processing/experiments/compare.py

docker run --rm --user 0 -v "$PWD:/repo" -w /repo \
  junction-cubicasa:gpu-comparison \
  python packages/processing/experiments/report.py
# The report is saved in ignored .local/gpu-comparison/report.

# API binds only to host loopback. Workers have no published ports.
docker compose --project-directory . -f packages/processing/experiments/compose.yaml up -d
# Wait for /health/ready before invoking smoke.py.
python3 packages/processing/experiments/smoke.py
```

The key is generated once in ignored `.local/gpu-comparison/service.env`, mode 0600. Keep it on the host. `smoke.py` reads it without displaying it. Do not paste
`docker compose config` or container environment dumps into shared output.

For remote access, use an SSH tunnel to host loopback rather than publishing the
port. The gateway's bridge network permits loopback port publishing; model
workers attach only to the internal inference network.

```bash
# Use the private key through your backend/secret store; never put it in browser code.
curl --fail-with-body 'http://127.0.0.1:8001/v1/predictions?model=raster2seq&response_format=zip' \
  -H "X-API-Key: $INFERENCE_API_KEY" -F image=@drawing.png --output prediction.zip
```

## Models and contracts

| Selection            | Input / published checkpoint                                                                            | Supported normalized outputs                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `cubicasa` (default) | RGB raster; official CubiCasa5K checkpoint                                                              | Existing room polygons, icon components, structural junctions, masks and model-space probabilities                   |
| `raster2seq`         | RGB raster; official CubiCasa5K EMA release                                                             | Labeled room polygons; window/door line geometry and boxes; raw generated polygon sequence                           |
| `grounding-sam`      | RGB raster; IDEA Grounding DINO tiny plus Meta SAM **2.1** Hiera tiny                                   | Prompted icon boxes and instance masks; detector matching score; SAM quality retained separately                     |
| `paddleocr`          | RGB raster; PaddleOCR 2.9.1, English PP-OCRv3 detector, PP-OCRv4 recognizer, mobile v2 angle classifier | Text polygons, strings and recognition scores                                                                        |
| `roomformer`         | Published Structured3D/SceneCAD checkpoints expect projected **3D scan density maps**                   | Not enabled: these drawings/IFC files do not provide that input                                                      |
| `sympointv2`         | FloorplanCAD SVG-derived primitive features, layer IDs and CUDA pointops                                | Not enabled: the two sampled SVGs fail the published parser (`stroke`, `viewBox`); DXF/DWG are not accepted directly |

Unavailable selections return 503, unknown selections 422. A supported output
with zero predictions is `[]` or `{}`; unsupported outputs are `null`, backed by
explicit capability metadata. Scores are uncalibrated. Raster2Seq exports no
per-object score: `confidence` is **null**, and it provides no junctions or class
probability grid. Its door/window shapes may be lines: `area_px` is null.

CubiCasa's default response retains its existing schema and probability-grid
transform. Nondefault responses use the same field names where meaningful and
add model/version, capabilities and source image dimensions. The existing Hono
consumer still selects the default; it must not parse alternative models through
its current CubiCasa-only Zod contract without a separate feature change.

JSON does not retain server temporary files. Request ZIP to receive raw artifacts
alongside `predictions.json`. Benchmark artifacts remain under
`.local/gpu-comparison/results/<model>/<sample>/`. CubiCasa includes the raw
44-channel output tensor, masks and exported grids; Raster2Seq retains upstream
polygons/labels before validity filtering; DINO retains boxes, labels, detector
scores, SAM mask scores and full-resolution masks; OCR retains the upstream text
result. No synthetic probability maps, junctions, labels or scores are created.

## Preprocessing and mappings

The fixed manifest selects 26 drawing groups from eight raster/PDF sources using
SHA256 ordering. PDF is preferred to an image sibling, page zero is rendered at
150 DPI with PyMuPDF 1.25.5, RGB, no alpha. Original files and all vector siblings
remain unchanged, with paths and SHA256s in the manifest. The IFC-only source is
inventoried but excluded from this raster panel. Archive and repository READMEs
are kept separately; existing documentation and questions are not overwritten.

The panel includes elevations, historic mixed sheets and structural details as
negative/stress cases. In particular, samples 03–05 and 07 are not pure floor
plans; 09 is a bridge sheet; 15–18 are structural/elevation/detail sheets. There
is no floor-plan classifier or automatic refusal in these models. Review these
separately from ordinary floor plans.

- CubiCasa: existing 1024×1024 white letterbox, RGB normalized to [-1, 1], existing
  model and postprocessor. Class mapping is identity to existing labels.
- Raster2Seq: upstream 256×256 bicubic white letterbox, integer content dimensions,
  RGB /255. Invert padding and each axis scale into original raster pixels.
  `Bed Room` → `Bedroom`, `Entry` → `Hallway` (coarser destination category);
  other shared room names, `Door` and `Window` keep their meaning. Invalid/empty
  polygons and unmapped labels are recorded under `rejected_geometry`, with raw
  outputs retained. No repair or extra confidence estimation is applied. Source
  coordinates are preserved, including predictions outside the image bounds.
- Grounding DINO: Transformers 4.49.0 standard processor; prompt
  `door. window. toilet. sink. bathtub.`, box threshold 0.3, text threshold 0.25.
  Map only exact recognized labels to the existing icon classes. SAM uses each
  detector box as a prompt; full-resolution masks remain in source coordinates.
- OCR: official English pipeline, angle classification enabled. It returns source
  pixels. Text containing numbers is not automatically interpreted as a physical
  dimension; no scale or unit is inferred. Multilingual recognition is unvalidated.

The locked Raster2Seq source needs a CUDA extension build guard that permits
compiling without a visible GPU during Docker build, and `TORCH_CUDA_ARCH_LIST=8.0`.
Its official release contains transient attention caches; only those known cache
keys are discarded, then all remaining model weights load strictly. Match the
upstream CLI's `disable_poly_refine` conversion. Disable the initial ImageNet
backbone download because the checkpoint supplies the complete backbone.
Differentiable rasterization is a training loss and is not needed for inference.
The source requirements omit Plotly; pinned compatibility changes are recorded
in its Dockerfile. Import Torch before Shapely in the benchmark: the reverse
order caused a native crash with this legacy environment.

Paddle is isolated from Torch. Its GPU wheel needs the pinned CUDA 11/cuDNN 8
runtime wheels and unversioned soname links used by its loader. Import pyclipper
before Paddle to avoid the observed bundled-library import conflict. SAM's
optional connected-component CUDA extension is disabled; this does not replace
the pretrained mask model.

## Measurement and interpretation

Prior result folders are moved into ignored experiment history before a rerun,
so startup failures cannot silently reuse old successful results.
Two warmups, batch one, one measured run per drawing; model loading is reported
separately. Latency is warmed adapter **wall time**: decode, preprocessing,
forward, postprocessing and normal output serialization. Overlays and CubiCasa's
extra raw-network archive are outside the timer. CubiCasa additionally exports
probability grids; other models cannot. These numbers are not a forward-only
throughput comparison or a repeated-run stability estimate.

Torch peak allocated memory is per process and excludes driver/context/reserved
memory. Whole-device used memory is sampled every 50 ms and includes allocator
retention. CubiCasa's first campaign overlapped diagnostic loads on a few samples;
use its per-process Torch peak rather than that campaign's whole-device maximum.
Paddle's final campaign ran alone; it reports whole-device memory rather than
Torch allocation. These memory columns are intentionally distinct.

`compare.py` evaluates only explicit English bedroom/kitchen count questions,
excluding translated duplicates. It records 12 question/class pairs on seven
drawings. These are counts of predicted room regions, not instance-mask IoU or
symbol detection precision. CubiCasa samples can overlap both geometry models'
training data; split membership is unknown after dataset renaming. Do not treat
this as a clean held-out benchmark. No ready-aligned room masks are shipped. Three paired Swiss DXFs supply
compatible CAD reference regions after validated registration to the PDF vector
paths. `cad_geometry.py` fits scale/translation with Y inversion using ten outline
bboxes and verifies every valid closed polygon boundary within 0.001 point against
the PDF. It scores class-agnostic region-union IoU only when the entire drawing
passes. The fourth Swiss drawing has two unmatched regions and is not scored.
Nonpolygon/invalid CAD entities are counted and excluded without repair. This
reference measures fidelity to the source CAD, including outdoor regions; it is
not an independent human annotation or a semantic/instance-room metric. Between-model union IoU is an
agreement diagnostic only. No confidence-score comparison is performed.

Source-specific credits and licences remain in `data/<source>/LICENSE.md`; keep
those credits with overlays. Data and model weights include noncommercial terms.
All artifacts and services from this experiment remain private.

## Verification

Use `python -m py_compile` for the changed Python files, `bash -n` for setup/run,
`docker compose ... config --quiet`, live `smoke.py`, and the repository's required
pnpm checks. Do not add tests. Review the full task diff with the repository's
`.agents/skills/pattern-review/SKILL.md`; call a self-review a self-review.

## Experimental CubiCasa detail mode

`model=cubicasa-detail` uses the same weights at 2048 pixels, the vendored official
structural polygonizer, and `utils/room_instances.py`. Geometry is extracted
independently of semantic class: combine the footprint, cut it by model wall and
railing probabilities plus supported wall/opening polygons, then label connected
regions. Doorway closures separate room proposals; class agreement never merges
instances. Polygon holes and source coordinates are preserved. A final subtraction
prevents overlap with the accepted vector barriers.

The normal `room_polygons` contain regions passing the current structural checks.
`review_room_polygons` and `room_instances` retain all flagged candidates and their
reasons. Threshold sensitivity, narrow connections between large lobes, and long
internal barriers can flag review. These are heuristic consistency checks, not
calibrated correctness estimates: wrong or merged geometry can still pass, and
legitimate regions may be flagged. Semantic labels remain unverified model guesses;
`confidence` remains the actual mean model-class softmax, not a correctness score.
The report uses neutral region IDs and keeps model-name guesses off by default.
Weak dense-head agreement is also recorded for wall/icon proposals; no scores,
labels, junctions or probability grids are fabricated.

The mode is optional; the original `cubicasa` default and its caller contract remain
unchanged. The detail worker has no host port and uses the same gateway protections.
Raw official polygons, review proposals and model probability grids are available
in ZIP responses. `junctions` is null because this adapter does not export them.
The current geometry investigation ran six selected drawings, with compatible CAD
references on three; it is not the original full 26-drawing benchmark.

```bash
# Recompute selected drawings; prior campaigns are moved to ignored local history.
docker run --rm --user 0 --gpus all -v "$PWD:/repo" -w /repo \
  junction-cubicasa:gpu-comparison \
  python packages/processing/experiments/compare_instances.py --predict

# Re-evaluate saved results and export a viewer (substitute a private output path).
docker run --rm --user 0 -v "$PWD:/repo" -w /repo \
  junction-cubicasa:gpu-comparison \
  python packages/processing/experiments/compare_instances.py

docker run --rm --user 0 -v "$PWD:/repo" -v /absolute/output/path:/deliverables -w /repo \
  junction-cubicasa:gpu-comparison \
  python packages/processing/experiments/export_instances_preview.py --output /deliverables
```

Evaluation now includes one-to-one CAD-region matching at IoU ≥0.5 and merged-region
counts, alongside area coverage. A merged proposal covers more than 50% of at least
two CAD regions. CAD zones may include open-plan subdivisions; this metric does not
establish physical room identity. The same minimum area of 0.01% of page pixels is
applied to both candidates and references, and exclusions are recorded. References
are loaded only by evaluation code, never by the adapter or room extractor.

## Private results dashboard

The saved report dashboard is a static artifact, separate from the application
frontend and inference API. Its request owner is the report's local HTTP server;
saved experiment files own benchmark state. Optional review notes live only in
browser local storage and can be exported; they never change model predictions.
Native HTML controls preserve the existing dependency-free report delivery.

After exporting the original report and refinement viewer to the same directory:

```bash
python3 packages/processing/experiments/export_dashboard.py --output /absolute/report/directory
```

This reads saved results only. It preserves the detailed report as
`report-detailed.html` and the previous viewer as `refinement-v2.html`, then
refreshes both `report.html` and `refinement.html` with the simple dashboard.
Do not regenerate an earlier report over these entry points without rerunning
this dashboard exporter. Latest geometry covers six drawings; the initial
benchmark covers 26. Unrun results remain unavailable rather than zero.

Serve that directory on loopback only and access it through an SSH tunnel.
`dashboard-reproduction.txt` in the exported directory records the exact refresh
command. The dashboard also links the separately saved Gemini pilot when present.

## V3 boundary cleanup experiment

`compare_alignment.py` reuses the six saved v2 prediction sets and source rasters.
It runs on CPU in the existing pinned CubiCasa image; it does not load a model,
train, call an external API, or change a service adapter. `wall_alignment.py`
owns the experiment's geometry operations. The original v2 files remain intact.

Compare a simplification-only control with local line fitting. Source-image
Hough segments guide edge direction within 3 degrees; offsets fit the room-side
contour rather than a wall centerline. The tolerance is 35% of estimated wall
width, bounded to 1–3 cropped model pixels. Existing non-axis directions survive;
this does not impose a rectangular floor plan. Larger ambiguous notches can stay.

Reject edits that invalidate polygons, change hole count, move a boundary beyond
two tolerances, change area by over 2%, change over 4% of its footprint, introduce
accepted-barrier overlap, increase neighboring overlaps, or separate an existing
shared boundary by over 0.1 model pixel. Rejecting a proposal retains its v2
geometry and adds a review reason. Short-segment clusters also receive review
flags; these heuristics do not verify geometry. Model scores are retained only as
v2 provenance, with edited-polygon confidence and class-score fields set to null.

```bash
docker run --rm --user 0 --entrypoint python \
  -v "$PWD:/repo" -v /absolute/report/directory:/deliverables -w /repo \
  sha256:254ae156a8a0ab9b0435058e69a9ae0c0330d5c67a4865bad86625ad3dfef928 \
  packages/processing/experiments/compare_alignment.py --output /deliverables
python3 packages/processing/experiments/export_dashboard.py --output /absolute/report/directory
```

Previous v3 local runs move into ignored history before rerunning. Exported
measurements contain both variants, input hashes, parameters, rejection reasons,
CPU preparation and geometry timings. GPU memory is unmeasured/not applicable to
this CPU-only stage. CAD enters evaluation only, after reconstruction. Compare
all candidates and the original v2 check-passing cohort separately; v3's extra
review flags change the visible population when flagged proposals are hidden.
This is an exploratory visualization experiment, not a new accuracy benchmark.

## V4 wall reconstruction experiment

`compare_structure.py` evaluates three exploratory variants on the same six
saved drawings: wall/ink evidence, bounded notch repair, and image-based wall
faces. It reuses v2 probability arrays and v3 source-line evidence on CPU.
Naming and the separate Decisions API experiment are outside its scope.

Run it with the same pinned container and mounts as V3, replacing the script
with `packages/processing/experiments/compare_structure.py`, then refresh the
dashboard exporter. `structure-reproduction.txt` contains the full command.
The dashboard's **Wall experiment · v4** link opens `structure.html`; v3 remains
its main comparison. No service adapter is installed for v4.

All v4 polygons require review and have null names/confidence. Reconstructed
masks are heuristics, not probabilities. Geometry can change topology and has
new IDs with overlap-based parent v2 IDs. Reported lineage splits/merges are not
verified corrections. The source-face arm can overlap previous wall polygons;
that measurement is explicit in the viewer. All three variants and negative
results remain available. CAD is evaluation only. Parameters are fixed across
drawings; the source-face arm was added after the first two exploratory runs.
The large notch in the motivating example remains unresolved.
