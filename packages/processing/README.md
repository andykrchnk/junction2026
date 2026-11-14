# Floor-plan processing

The production pipeline is CubiCasa geometry and bounded wall-aligned cleanup,
PaddleOCR text extraction, and Decisions verification. Consumers use
`POST /v1/process`; its response contains only the agreed drawing objects.

From the repository root:

```bash
docker compose --project-directory "$PWD" -f packages/processing/compose.yaml build inference paddleocr pipeline
docker compose --project-directory "$PWD" -f packages/processing/compose.yaml up -d
```

Persistent inputs are the existing CubiCasa weights directory,
`.local/gpu-comparison/ocr`, the private service environment file, and the Gemini
secret file. No checkpoints or credentials are copied into images. All published
ports bind to loopback. Container code is packaged into images, not bind-mounted.

The four services are the public pipeline on port 8002, the private geometry and
OCR workers, and the compatibility gateway on port 8001. The latter preserves
CubiCasa `/v1/predictions` authentication, upload handling and JSON/ZIP behavior.
Its supported selections are CubiCasa, detailed CubiCasa and OCR. Retired model
names are rejected. Remove this gateway only after legacy consumers migrate.

Production no longer depends on experiment Compose files or alternative model
libraries. Historical experiment source is archived under `experiments/floorplans`;
its archive note identifies the Git revision for reproducing the original stack.
Private datasets, weights, checkpoints, reports and benchmark outputs are retained.

See [pipeline behavior and contract](pipeline/README.md) and
[release deployment](../../deploy/processing/README.md).
