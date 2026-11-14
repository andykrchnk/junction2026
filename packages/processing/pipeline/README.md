# Standardized drawing processing service

`POST /v1/process` accepts a raster drawing as multipart field `image`, authenticates
with `x-api-key`, and returns only `coordinate_system`, `image`, `rooms`, and
`fixtures`. `response_format=zip` returns the same object in `predictions.json`.
`GET /v1/schema` returns the authenticated JSON Schema. The existing
`/v1/predictions` contract is proxied unchanged through this service during migration.

## Deployment

Run from the repository root with the existing CubiCasa checkpoint and PaddleOCR
weights mounted from their persistent locations. Keep the existing
`.local/gpu-comparison/service.env` private. Put the Gemini credential in
`.local/processing-pipeline/gemini-api-key` with mode `0600`; never commit it.

```bash
docker compose --project-directory "$PWD" \
  -f packages/processing/compose.yaml build inference paddleocr pipeline

docker compose --project-directory "$PWD" \
  -f packages/processing/compose.yaml up -d inference cubicasa-detail paddleocr pipeline
```

The standardized service listens at `127.0.0.1:8002`. GPU workers remain on the
private inference network. The original gateway stays at port 8001 during migration.
The orchestration container needs outbound HTTPS for Gemini; workers need no public
ports. Gemini uses a mounted secret, not a credential embedded in the image.

```bash
curl --fail http://127.0.0.1:8002/v1/process \
  -H "x-api-key: $INFERENCE_API_KEY" \
  -F image=@drawing.png
```

## Pipeline and ownership

- `service.py`: authentication, actual-body upload cap, image validation, admission,
  HTTP errors, legacy proxy and JSON/ZIP responses.
- `config.py`: deployment-owned URLs, credentials, bounded verification settings.
- `schemas.py`: public response and worker-boundary validation.
- `taxonomy.py`: loads the authoritative class constants from CubiCasa's
  `model/segmentation_net.py` through AST, without importing Torch. Docker copies
  that source file; there is no independently maintained class list.
- `pipeline.py`: model orchestration, deadlines, private artifacts and fallback.
- `clients/`: private worker and Gemini transports with boundary validation.
- `stages/`: target crops, explicit annotations, verifier questions, decision rules,
  relationships and final GeoJSON normalization.

CubiCasa detail and PaddleOCR run sequentially to bound concurrent GPU demand.
Workers retain their loaded weights. The API admits one standardized processing
request at a time; further calls receive 503 with Retry-After. Gemini runs at most
four concurrent requests, one contextual request per candidate combining class,
name and measurement questions. Each question is independent; code combines answers.
Verification is capped at 500 targets, 20 measurement candidates per target and a
180-second scheduling window plus up to 30 seconds for in-flight calls. Worker
requests each have a 180-second I/O timeout; this is not a 180-second total-request SLA.
Dense drawings beyond the verification budget keep baseline classifications and
unknown measurements. Response headers identify degraded processing.

## Output semantics

All class values are members of the exact 12-room/structure or 11-icon CubiCasa
vocabularies. Structural/background predictions are not returned as rooms. `No Icon`
is an internal removal decision, not an extra fixture object. No invented classes
are accepted from Gemini or workers. Classification never changes the geometry. The geometry worker applies bounded
wall-aligned cleanup before verification and recomputes selected-class support
over the final regions. Cleanup diagnostics remain internal.

Geometry is a GeoJSON-shaped Polygon or MultiPolygon in original-image `[x,y]`
pixels with top-left origin; it is not geographic RFC7946 longitude/latitude.
Closed rings, holes, validity, image bounds and room references are validated.
Invalid geometry proposals are omitted; no fabricated repair is performed. Fixtures
without a source polygon use the worker's bounding box. IDs are unique within each
response; cross-upload identity is not promised. Fixtures link to rooms only with
actual polygon overlap or adjacency within two original-image pixels. Other room
associations remain empty arrays.

`confidence` is the original CubiCasa support score when a class is retained, or the
Gemini class probability when relabelled. These are uncalibrated support scores, not
comparable calibrated correctness probabilities or geometry confidence. Raw scores
and resolution decisions are retained internally. Agreement alone doesn't establish
accuracy. Experimental policy gates can relabel or reject an icon, but they have not
been independently calibrated on a held-out floor-plan dataset.

Room `name` is an exact OCR token selected as unambiguously belonging to the room;
otherwise null. Names are not translated or synthesized from class labels.

Room measurements contain area/length/width/height; fixture measurements contain
width/height. Only explicitly unit-bearing annotations whose transcription,
association and property meaning pass conservative gates are returned. No scale,
polygon area, implicit drawing units or width/height ordering is guessed. Conflicting
accepted values for a property yield null. Missing superscripts and truncated OCR
numbers are rejected. Bare numbers and global-unit conventions are not resolved in
this implementation. Multi-page documents must be rendered into single-page rasters
by the caller. No human review is required by the API.

## Failure handling and diagnostics

Invalid authentication returns 401; raster uploads are limited to 25MiB and 40M
pixels, with a 26MiB multipart-envelope limit enforced before body parsing. Unsupported
formats return 415 and corrupt/multi-frame images return 422. A failed or invalid
geometry worker response returns 502. OCR failure retains geometry but returns null
names/measurements. Gemini failure retains baseline classifications and null enrichment.
A successful partial result includes `X-Processing-Degraded` with `ocr`, `gemini`, or
`verification_limit`; the public JSON shape does not change.

Private per-request worker predictions, Gemini responses, decisions and final output
are stored in `.local/processing-pipeline/artifacts`, outside the public API and Git.
Per-request identical Gemini payloads are cached by hash. There is no cross-request
cache or automatic artifact retention policy yet; operators must manage retention.
Raw image uploads and API keys are not written to these artifacts. Do not publish
this directory. The report dashboard remains an independent diagnostic tool.

## Verification

```bash
docker run --rm --entrypoint python junction-pipeline:standardized -m unittest test_contract
```

The contract regressions cover exact classes, GeoJSON holes/validity, dangling room
references, unsupported verifier labels, preservation on weak evidence, door/window
conflicts and explicit-unit handling. Run actual endpoint smoke checks with a configured
Gemini credential and the live worker containers before deployment.
