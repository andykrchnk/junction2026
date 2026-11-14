#!/usr/bin/env bash
set -euo pipefail
# Run from repository root. All weights, datasets and output payloads remain ignored.
python3 packages/processing/experiments/fetch_assets.py --dataset
root="$PWD"
local_root="$root/.local/gpu-comparison"
mkdir -p "$local_root/prepare-build" "$local_root/raster-build/.local/gpu-comparison/upstream" "$local_root/grounding-build" "$local_root/ocr-build"
cp packages/processing/experiments/Dockerfile.prepare "$local_root/prepare-build/Dockerfile"
docker build -t junction-prepare:gpu-comparison "$local_root/prepare-build"
docker build -t junction-geometry:gpu-comparison -f packages/processing/experiments/Dockerfile.geometry packages/processing/experiments
docker run --rm -v "$root:/repo" junction-prepare:gpu-comparison python packages/processing/experiments/prepare_dataset.py --render
docker build --target cuda -t junction-cubicasa:gpu-comparison packages/processing/cubicasa
cp -a "$local_root/upstream/raster2seq-src" "$local_root/raster-build/.local/gpu-comparison/upstream/"
cp packages/processing/experiments/Dockerfile.raster2seq "$local_root/raster-build/Dockerfile"
docker build -t junction-raster2seq:gpu-comparison "$local_root/raster-build"
python3 -c 'import shutil; shutil.copytree(".local/gpu-comparison/upstream/sam2-src", ".local/gpu-comparison/grounding-build/sam2", dirs_exist_ok=True)'
cp packages/processing/experiments/Dockerfile.grounding "$local_root/grounding-build/Dockerfile"
docker build -t junction-grounding:gpu-comparison "$local_root/grounding-build"
cp packages/processing/experiments/Dockerfile.paddleocr "$local_root/ocr-build/Dockerfile"
docker build -t junction-paddleocr:gpu-comparison "$local_root/ocr-build"
python3 - <<'PY'
import os,secrets,pathlib
p=pathlib.Path('.local/gpu-comparison/service.env')
if not p.exists():
    fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as f:f.write('INFERENCE_API_KEY='+secrets.token_hex(32)+'\n')
PY
