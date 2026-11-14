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
