# Room Boundary Detection

Floor plan segmentation pipeline built on the [CubiCasa5K](https://github.com/CubiCasa/CubiCasa5k) dataset and pretrained model. Given a floor plan image, the pipeline produces:

- **Room segmentation** — pixel-wise classification into 12 room types (bedroom, kitchen, bathroom, etc.)
- **Wall mask** — binary mask of all wall pixels
- **Icon detection** — localisation of doors, windows, toilets, sinks, and other fixtures (11 classes including background)
- **Vectorized polygons** — Shapely polygons for each detected room, ready for downstream GIS or BIM use
- **Confidence output** — per-object scores and compressed per-pixel class probabilities

---

## Architecture

The model is CubiCasa5K's **hourglass/FPN-style multi-task network** with heatmap,
room-segmentation, and icon-segmentation outputs:

```
Input (RGB floor plan)
      │
  Hourglass/FPN backbone
      │
  Multi-scale decoder
      │
  ┌──────┴────────┬─────────────┐
  heatmaps      rooms          icons
 (21 channels) (12 classes)  (11 classes)
```

| Head  | Classes                                                                                                      |
| ----- | ------------------------------------------------------------------------------------------------------------ |
| Rooms | Background, Outdoor, Wall, Kitchen, Living Room, Bedroom, Bath, Hallway, Railing, Storage, Garage, Undefined |
| Icons | No Icon, Window, Door, Closet, Electrical Appliance, Toilet, Sink, Sauna Bench, Fire Place, Bathtub, Chimney |

---

## Project Structure

```
room_boundary/
├── inference.py              # CLI + FloorPlanSegmentor class
├── download_weights.py       # Fetches pretrained checkpoint from GitHub
├── requirements.txt
├── model/
│   ├── __init__.py
│   └── segmentation_net.py   # CubiCasa5K model definition + class labels
└── utils/
    ├── __init__.py
    ├── preprocessor.py       # Image loading, normalisation, padding
    ├── postprocessor.py      # Masks, polygon vectorisation, icon detections
    └── visualization.py      # 2×2 overlay figure
```

---

## Setup

**Requirements:** Python 3.11, PyTorch 2.5.1 or newer

```bash
pip install -r requirements.txt
```

Download the pretrained CubiCasa5K weights:

```bash
pip install gdown
python download_weights.py
```

This saves the checkpoint to `weights/cubicasa5k.pkl`. If the automatic download fails, use the Google Drive link printed by the helper and place the checkpoint there.

---

## Usage

### Private inference API (Docker)

Run these commands from `packages/processing/cubicasa`. Install `gdown` with pip,
then run `python download_weights.py` first. Weights are mounted read-only rather
than committed to Git or sent to the Docker builder.

```bash
# Generate a key once and keep it in your deployment secret store.
export INFERENCE_API_KEY="$(openssl rand -hex 32)"

# Apple Silicon Mac: native ARM64 CPU container. Linux CPU also works.
docker build --target cpu -t cubicasa:cpu .
docker run --rm --name cubicasa -p 127.0.0.1:8001:8001 \
  -e INFERENCE_API_KEY -e INFERENCE_DEVICE=cpu \
  --mount type=bind,source="$(pwd)/weights",target=/app/weights,readonly \
  cubicasa:cpu
```

On a Linux AMD64 NVIDIA host with NVIDIA Container Toolkit installed:

```bash
docker build --target cuda -t cubicasa:cuda .
docker run --rm --name cubicasa --gpus all -p 127.0.0.1:8001:8001 \
  -e INFERENCE_API_KEY -e INFERENCE_DEVICE=cuda \
  --mount type=bind,source="$(pwd)/weights",target=/app/weights,readonly \
  cubicasa:cuda
```

Build CUDA images on AMD64, or use `docker buildx build --platform linux/amd64
--target cuda ...` when building remotely from a Mac. Standard Linux containers
on Mac use CPU; run this service natively with `INFERENCE_DEVICE=mps` to use
Apple GPU acceleration. Native setup: install PyTorch and
`pip install -r requirements-service.txt`, then run
`uvicorn service:app --host 127.0.0.1 --port 8001 --workers 1`.

```bash
# JSON includes source-pixel polygons, boxes, object scores and junctions.
curl --fail-with-body http://localhost:8001/v1/predictions \
  -H "X-API-Key: $INFERENCE_API_KEY" -F image=@floor_plan.png

# ZIP includes predictions.json, masks and probabilities.npz.
curl --fail-with-body 'http://localhost:8001/v1/predictions?response_format=zip' \
  -H "X-API-Key: $INFERENCE_API_KEY" -F image=@floor_plan.png \
  --output prediction.zip
```

The prediction route checks the key before parsing uploads. The service refuses
to start without a key of at least 32 ASCII characters. Keep this key in the
backend; the browser should call your authenticated Hono API, which calls this
service. For container-to-container calls, use a private Docker network and
`http://cubicasa:8001`; for a container calling native macOS use
`http://host.docker.internal:8001` (bind the native service to `0.0.0.0` for that).
Use TLS at your reverse proxy when traffic leaves the host/private network.

`GET /health/live` and `GET /health/ready` are public health probes. Readiness
becomes available after loading the checkpoint. One process holds one model;
one prediction runs at a time and additional predictions receive `503` with
`Retry-After`. Uploads are limited to 25 MiB and decoded images to 40 million
pixels. Configure a matching body-size limit at your proxy. Each request uses
an isolated temporary directory, cleaned after JSON generation or ZIP delivery.
The API omits Matplotlib visualizations to reduce response time and memory.

Model implementations, checkpoint paths and preprocessing live in `adapters.py`.
The compatibility endpoint accepts `model=cubicasa|cubicasa-detail|paddleocr`.
The standardized consumer endpoint is `/v1/process`, without model selection.
Deployment uses [the production Compose stack](../compose.yaml); historical
experiments are archived in `experiments/floorplans` at the repository root.

### Optional contrast-assisted door proposals

Set `CUBICASA_DOOR_CONTRAST=true` on the `cubicasa-detail` worker to enable an
auxiliary discovery pass. The default is `false`; other values fail startup.
This is an experimental recovery option, not a validated accuracy improvement.

The worker measures the source's local dark-line residual against a 15-pixel
morphological-closing background. It samples local ridge pixels with residual
at least 8 and background luminance at least 160. With fewer than 64 samples,
or a 25th-percentile residual of at least 128 on the 0–255 scale, it skips
enhancement. Otherwise it applies CLAHE to LAB lightness with clip limit 2.0
and an 8×8 tile grid. These fixed operating parameters are provisional: text,
hatching, image resolution and room fills influence the source statistic.
The score is not a calibrated quality measure or an exact output-contrast target.

The original inference result remains authoritative for rooms, walls and
existing fixtures. The auxiliary pass uses the same source dimensions and the
original's automatic building crop. It contributes at most 32 additional Door
proposals, ranked by the model's uncalibrated score, exclusively through
`review_icon_detections` with `requires_verification=true`. Candidates overlapping
an existing Door/Window or another addition (bbox IoU ≥0.1 or centers within
5 original pixels) are suppressed. Existing detections are never replaced.
The processing pipeline verifies these proposals against the **original** image
using its existing conservative recovery rules; unavailable/limited verification
leaves them removed. Direct worker consumers must honor the review contract.

`door_contrast` diagnostics in `predictions.json` and `raw.json` record the source
score, gate decision and number of additions. Optional-pass failure returns the
successful original result with status `unavailable`; it never promotes an
unverified candidate. The enhanced image and auxiliary artifacts are temporary
and removed after the pass. Original images, OCR input and verifier imagery are
unchanged. Enabling this option adds up to one full detector pass and additional
verification work; account for existing request timeouts when opting in.

### Command line

```bash
# Single image
python inference.py --checkpoint weights/cubicasa5k.pkl --image floor_plan.png

# Batch (all images in a folder)
python inference.py --checkpoint weights/cubicasa5k.pkl \
    --input_dir plans/ \
    --output_dir results/

# Fix input resolution (recommended for large sheets; aspect ratio is preserved)
python inference.py --checkpoint weights/cubicasa5k.pkl \
    --image floor_plan.png --fixed_size 1024 1024
```

Each processed image produces a sub-folder under `results/<image_stem>/`:

```
results/floor_plan/
├── room_mask.npy        # H×W uint8  (0–11)
├── icon_mask.npy        # H×W uint8  (0–10)
├── wall_mask.npy        # H×W uint8  (0 or 1)
├── predictions.json     # vectors, detections, confidence, source transform
├── probabilities.npz    # room, icon and structural heatmap probabilities
└── visualization.png    # 2×2 overlay figure
```

The `.npz` grids stay at the unpadded inference resolution to avoid multi-GB
files for large drawings. `predictions.json` contains the transform required to
map them back to source pixels. Confidence values are model scores, not
calibrated real-world probabilities; threshold them and keep human verification
for measurements or procurement decisions.

### Python API

```python
from inference import FloorPlanSegmentor

seg = FloorPlanSegmentor("weights/cubicasa5k.pkl")
result = seg.predict("floor_plan.png")

# Dense masks
result.room_mask        # np.ndarray H×W uint8
result.wall_mask        # np.ndarray H×W uint8
result.icon_mask        # np.ndarray H×W uint8

# Vectorized room boundaries (Shapely Polygons)
for room_type, polygons in result.room_polygons.items():
    print(room_type, [p.area for p in polygons])

# Icon detections include source coordinates and a confidence score
for detection in result.icon_detections:
    print(
        detection.class_name,
        detection.centroid_x,
        detection.centroid_y,
        detection.confidence,
    )
```

---

## Output Example

`visualization.png` contains a 2×2 panel:

|                     |                                        |
| ------------------- | -------------------------------------- |
| Original floor plan | Room segmentation + polygon boundaries |
| Wall mask           | Icon detections with class labels      |

---

## References

- **CubiCasa5K dataset & model:** Kalervo et al., _CubiCasa5K: A Dataset and an Improved Multi-Task Model for Floorplan Image Analysis_, SCIA 2019. [GitHub](https://github.com/CubiCasa/CubiCasa5k)

### Outdoor footprint recovery

The detailed worker supplements the official junction-grid footprint with bounded
pixels whose Outdoor model support is at least 0.5. This recovers balconies omitted
when thin railings do not produce reliable junction rectangles. Image-edge outdoor
components are excluded; walls, railings, and accepted opening barriers still clip
regions. Recovery is rejected wherever it would join multiple existing significant
regions. Existing area filtering, geometry cleanup, and class-score calculation then
apply normally. This uses model evidence, not inferred balcony rectangles or OCR
labels, and does not guarantee recovery when Outdoor evidence itself is missing.

### Thin-wall and opening detail

For source drawings larger than 2048 pixels, detailed inference proposes a building
crop from dominant connected dark linework in the original image. Multiple
substantial components or insufficient evidence retain the full sheet. The crop is
a heuristic, not a drawing-type classifier; disconnected buildings and faint scans
need review. The crop bounds and fallback reason are saved in raw artifacts.

Overlapping 1024-pixel tiles (768-pixel stride) are taken directly from the original
RGB image and letterboxed to 2048 pixels for inference. They are never cut from the
resized overview. Low-resolution sources retain the original whole-image pass to
avoid excessive magnification. Predictions are accumulated on CPU on a grid capped at a 2048-pixel long edge. Output geometry remains in original
image pixels; the probability-grid transform documents any scaling.

Outside an accepted crop, room/icon grids are background and junction heatmaps
are zero. The coarse footprint is retained only inside the crop so missing refined
grid cells cannot carve unsupported holes out of rooms; refined wall and opening
barriers may still split enclosed spaces. This costs additional inference work and
does not guarantee correct room separation or complete opening detection.

Dense Door components omitted by the junction decoder become bounded verification
proposals, with model-derived geometry and scores. Overlapping decoded openings
are excluded; at most 64 additional candidates are retained. These candidates are
marked `requires_verification` and cannot divide geometry before verification.
The standardized pipeline admits them only after positive door verification.

### Concurrent geometry requests

The detail worker uses `INFERENCE_CONCURRENCY` slots (1 by default, 1–8).
The Compose configurations set it from `GEOMETRY_CONCURRENCY`, defaulting to 3.
The loaded CubiCasa model is shared read-only; each request owns its input,
intermediate arrays, and output directory. PaddleOCR remains single-request
because its predictor is shared and mutable. Forwarded requests use the target
worker's capacity rather than holding a local inference slot.

When all slots are occupied, the worker immediately returns HTTP 503 with
`Retry-After: 5`. It does not keep a hidden queue behind an inference lock.
The pipeline preserves this response so the backend's existing retry/job policy
can reschedule the page. Requests that actually exceed the worker HTTP deadline
return 504, not a generic 502. The 180-second deadline is unchanged.
A timed-out caller does not forcibly terminate native inference; its slot stays
occupied until inference finishes, preventing oversubscription.

Worker logs include a generated request ID, model, and elapsed inference time;
credentials and drawing contents are not logged. Tune capacity for GPU memory
and drawing sizes; increasing it is not a guarantee of linear speedup.
