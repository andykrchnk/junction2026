#!/usr/bin/env bash
set -euo pipefail
# Stop the comparison's services before measuring to keep models sequential.
# This does not affect other Docker projects.
docker compose --project-directory . -f packages/processing/experiments/compose.yaml stop
for model in cubicasa raster2seq grounding-sam paddleocr; do
    case "$model" in
        grounding-sam) image=junction-grounding ;;
        *) image="junction-$model" ;;
    esac
    docker run --rm --user 0 --gpus all \
        -v "$PWD:/repo" -v "$PWD/.local/gpu-comparison:/weights:ro" \
        -v "$PWD/packages/processing/cubicasa:/app:ro" \
        -w /repo -e PYTHONPATH=/app:/upstream \
        "$image:gpu-comparison" python -u packages/processing/experiments/benchmark.py --model "$model" \
        > ".local/gpu-comparison/benchmark-$model.log" 2>&1 || \
        printf '%s\n' "Model $model failed; see its local log. Continuing."
done
