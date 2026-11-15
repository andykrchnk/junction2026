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
  that source file. Service-only fixture output adds `Shower Cabin` without changing
  the geometry-worker classes or pretrained channels.
- `pipeline.py`: model orchestration, deadlines, private artifacts and fallback.
- `clients/`: private worker and Gemini transports with boundary validation.
- `stages/`: target crops, explicit annotations, verifier questions, decision rules,
  relationships and final GeoJSON normalization.

Each page runs CubiCasa detail then PaddleOCR. Each GPU worker retains its loaded
weights and queues requests behind one execution lock; busy workers do not reject
admitted pages or cause missing OCR. Different workers can overlap on the GPU.
The geometry worker HTTP admission limit is 64, leaving room for the pipeline
queue and health probes; it does not allow concurrent executions within a worker.
`PIPELINE_CONCURRENCY` admits up to 15 active pages by default (integer 1–32).
Saturated pipeline admission returns 503 with `Retry-After: 1`; the backend uses
bounded retries and reschedules persistent backpressure after one second.
Worker capacity is released before remote verification, so later pages can run
GPU work while earlier pages verify. Gemini runs at most the configured number
of concurrent requests across all pages (default eight). Fixtures, including
close-up rechecks, complete before room verification. Each room receives only
verified fixture classes substantially inside it; unresolved proposals are counted
without passing their labels. Both stages share the target cap and deadline, with
fixtures prioritized. One contextual request per candidate combines class, name
and measurement questions. Disputed or uncertain bathtub/sauna/shower/closet
candidates receive at most one close-up recheck within the same scheduling window.
Verification is capped at 500 targets, 20 measurement candidates per target and a
180-second scheduling window plus up to 30 seconds for in-flight calls. Worker
requests each have a 180-second I/O timeout; this is not a 180-second total-request SLA.
Dense drawings beyond the verification budget keep baseline classifications and
unknown measurements. Response headers identify degraded processing.

## Output semantics

Room output classes use the service vocabulary: the 12 CubiCasa room/structure
classes plus Sauna and Balcony. Fixture classes extend the CubiCasa icon vocabulary with `Shower Cabin`, covering
verified shower enclosures, cubicles and trays. A tray-only drawing does not establish
that a separate enclosure exists. Worker
validation still accepts only the original CubiCasa classes. Structural/background predictions are not returned as rooms. `No Icon`
is an internal removal decision, not an extra fixture object. Only explicitly supported classes
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
A successful partial result includes `X-Processing-Degraded` with `ocr`, `gemini`,
`verification_limit`, or `fixture_uncertainty`; the public JSON shape does not change.
`fixture_uncertainty` marks retained fixture classes that could not be verified. Their
baseline labels remain in the response; per-fixture diagnostics stay private.

Private per-request worker predictions, Gemini responses, decisions and final output
are stored in `.local/processing-pipeline/artifacts`, outside the public API and Git.
Private `timings.json` records seconds spent in geometry, OCR, fixture/room
verification and normalization, including elapsed time when a timed stage fails.
`PIPELINE_GEMINI_WORKERS` controls aggregate verification requests (default 8,
integer 1–16, validated at startup). Set it on this service; use 4 for the previous
parallelism. The shared semaphore belongs to the service settings and includes
close-up rechecks. Waiting consumes the page verification deadline. Each request
still handles one target, fixtures finish before rooms,
and the shared target budget and deadline remain unchanged. Tune concurrency against provider quotas; this is independent of the
server's drawing/entity concurrency limits. Limits are per service process; keep
one Uvicorn process per pipeline/worker as configured. Multiple replicas add
capacity. UUID artifact directories and page-local results remain independent.
The backend defaults to 15 drawing jobs, but pages in one PDF remain sequential
because its lease and cursor belong to the drawing. OpenAI analysis has its own
aggregate `DRAWING_OPENAI_CONCURRENCY` limit (default 18) per backend instance.
The detail worker's optional `CUBICASA_DOOR_CONTRAST=true` mode supplies additional
doors through the existing review-only contract. These proposals start removed
and require the same original-source Decisions checks as other recovered doors.
OCR, verifier crops, existing fixture geometry and room geometry continue to use
the original drawing. See the worker README for its experimental contrast gate,
default-off configuration and additional inference cost.
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

## Room-use resolution

Decisions completes fixture verification, including any close-up rechecks, before
starting room verification. Each room receives a stable `fixture_context` snapshot
of retained fixtures with more than half their geometry inside that room. Mere
adjacency and small overlaps do not supply functional evidence from neighboring
rooms. The public fixture-to-room relationships keep their existing overlap/adjacency
semantics; the stricter majority rule is only for room-use evidence.

The snapshot includes the final verified class, class/existence scores, evidence
basis, bounds and fraction inside the room. At most 64 verified fixtures are sent,
highest class score first, with the full verified count. Unresolved candidates are
counted separately without passing their unverified class labels. Removed candidates
are excluded. Missing or unresolved fixtures never establish absence. Verified
fixtures support room use alongside printed labels and visible context; they do
not impose a deterministic room class or override contradictory drawing evidence.
These snapshots remain in private decision artifacts; the public JSON is unchanged.

Decisions resolves room use from the associated printed label and visual context,
independently of outline quality. One class-choice question selects a supported room class or abstains with
`ambiguous` or `conflicting_room_uses`; the selected outcome and a structured
evidence basis are recorded internally. A resolved
class with a supporting basis is applied without the previous fixed class/evidence/
whole-space score gates. Structural classes and inconsistent decisions are not
applied to rooms. Ambiguous, conflicting, missing, or failed verification retains
the original class and score. Measurement gates are unchanged.

Resolution, basis, and geometry diagnostics remain in private decision artifacts.
The public response is unchanged. A relabelled room uses the verifier's selected-
class score, which remains uncalibrated and is not geometry confidence. There are
no translation dictionaries or label-matching rules.

## Bathtub, sauna-bench and shower-cabin verification

Fixture verification separates presence from class and records a structured evidence
basis. Bathtub criteria include basin/rim details, drains, taps and multilingual
fixture labels; sauna-bench criteria include seating tiers, slats and supporting
sauna context. Shower-cabin criteria include drains, trays, fittings and screens;
closet criteria require storage details rather than a rectangular outline alone.
Room use alone cannot establish a fixture class. Unreadable or
indistinguishable symbols can resolve to internal `ambiguous`, never a public class.

For non-opening candidates involving Bathtub, Sauna Bench or Shower Cabin, a class score of at
least 0.9 and direct symbol/associated-label evidence can establish the type when
fixture presence is more likely than absence. Generic evidence and presence scores
are retained as diagnostics rather than requiring both to exceed the old thresholds.
Other fixture corrections, removals, doors/windows and recovered openings retain
their conservative gates. These scores remain uncalibrated.

A disagreement with the detector or an uncertain bathtub/bench/shower/closet result receives a
second look: clean and marked source-image close-ups plus the surrounding crops and
sheet overview. A strong first result can survive a less certain close-up only when
the latter favors the same class over all alternatives combined, indicates fixture
presence and supplies direct evidence. Confident contradictions between views retain
the baseline and record `conflicting_views`. Failed or budget-limited rechecks also
retain the baseline and mark uncertainty. Geometry is never changed by verification.

Before deployment, compare manually reviewed tubs, real sauna benches, showers and
ambiguous linework across drawing styles. Include detector misses and false proposals,
not only successful crops, and count unresolved retained labels separately from
verified classes. A development comparison is not a held-out accuracy estimate.
Verification can relabel an existing geometry candidate as `Shower Cabin`, but it
cannot recover a shower that the geometry worker did not propose.

## Unspecified rooms and recovered openings

Decisions can select the actual CubiCasa `Undefined` class for a clearly identified
room whose functional use is not established. This differs from an `ambiguous`
verification result, which retains the original. The original class is supplied
for independent review; Garage requires vehicle-access or other clear garage
evidence. A selected Undefined class carries its own verifier class score.

Recovered opening candidates are excluded from the public response unless fixture
verification accepts a Door with existence and swing evidence. Failures retain
the exclusion. They do not become geometry barriers before verification. Exact
duplicate class/geometry targets are removed before verification.

Fixture context stays internal and geometry is unchanged. Sauna and Balcony are service-only
room classes selected by Decisions from labels and visual/fixture evidence after
inference; CubiCasa weights and worker taxonomy are unchanged. There is no Heater
fixture extension. The shared consumer schema and colors support both extensions. Names
remain printed OCR labels or null; a relabelled room uses its Decisions class score.

Balcony requires supporting label or architectural context; other or unspecified
outdoor regions remain Outdoor. Relabelling does not recover missing balcony
boundaries or expand room geometry.
