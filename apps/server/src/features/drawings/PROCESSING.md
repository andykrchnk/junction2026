# Durable document processing

PDF/image upload stores `processingJob` progress on the drawing in the same
MongoDB update that attaches its pages. This is also the durable queue handoff:
an Agenda reconciliation job scans pending runs every two seconds and creates
an Agenda job for each blueprint page in a run. A crash after upload but before enqueueing cannot lose
work. GridFS uploads are preserved when a failed write acknowledgement leaves
attachment ownership uncertain.

Agenda 6.2.8 with `@agendajs/mongo-backend` 4.0.5 uses the existing Atlas connection
and the `drawingJobs` collection. No Redis, separate database or open browser is
required. Agenda owns polling, locks, concurrency and job scheduling. A unique
index on the run ID and page prevents duplicate jobs across backend replicas; insert-only
reconciliation never overwrites an active job. Explicit retries create a new run
ID, so an older job cannot process the replacement run.

`DRAWING_PROCESSING_CONCURRENCY` sets the blueprint-page concurrency per backend instance
(default 15, integer 1–32; restart after changing it). Agenda reserves one additional
slot for reconciliation. Each page job executes one bounded stage at a time;
pages in the same drawing can run concurrently. Multiple replicas add their configured
capacity. The limit applies to document stages, not individual downstream calls:
entity enrichment can run multiple requests within a stage, and the GPU service
queues admitted inference behind one execution per GPU worker. The target of 15
active blueprints applies across all sessions, including pages of one PDF.
Each page has its own write token, deadline, retry count and next-run time inside
the drawing's `processingJob.tasks`. Task positions are append-only within a run;
uploads append new page tasks atomically without replacing active claims.

Progress and saved inference/entity checkpoints remain on the drawing.
Page checkpoints update their task and aggregate completion count atomically,
without replacing another page's work. Chat and manual context reviews still use
the drawing-wide foreground lease and cannot run during queued page processing.
Rejected pages complete their job immediately. Other stage failures get up to three attempts
with backoff before completing that page job and retaining the error. Inference backpressure
(503) reschedules one second later without spending the failure budget.
Missing provider configuration leaves explicit partial/not-configured status and
continues. Finishing means all selected pages were attempted, not all succeeded.
Failed or expired pages do not block siblings. Document-size limits are checked
again in the atomic result write so parallel saves cannot bypass the BSON budget.

Agenda persists a recurring next run before executing each stage, and the handler
reschedules it from the saved checkpoint. Completed or superseded jobs are disabled
and retained in `drawingJobs`. Expired page claims are recovered by reconciliation;
Agenda also retains a six-minute lock lifetime as a fallback. This
exceeds the existing 120s/240s provider deadlines and allows raster/storage
work. Each invocation replaces the page's write token, fencing late results
from a replaced worker. Graceful shutdown aborts active provider work and drains
Agenda before closing the shared connection. External calls remain at-least-once:
a crash before saving a result can repeat a call. Saved inference and completed
entity checkpoints are reused.

Existing session-level runs are upgraded after their active stage leases expire
or finish. Their completed-page cursor is preserved as completed tasks, remaining
pages retain their saved checkpoints and the current page retains its retry count.
The upgraded run receives a fresh ID to fence old jobs. Page-based runs stay
active in storage until all tasks finish, so legacy workers cannot claim them as
queued session jobs during a rolling deployment. Legacy Agenda records are
disabled; the new worker schedules only `process-blueprint` records. Completed
legacy runs remain readable without migration.

The frontend polls drawing queries and renders public `processing` progress and
per-page statuses. `completed` counts finished page jobs; `currentPage` and its
timing/retry fields describe one active (or next queued) page for compatibility.
Per-page statuses and processing activity show all parallel work. Internal task
tokens are never included in the public DTO. Upload and page-open do not trigger processing loops.
`drawings.analyze` queues incomplete pages; `drawings.detect` queues a selected
page. Both return promptly and enforce ownership. Retrying an active drawing does
not replace its run. Explicit retries may retry rejected pages without erasing
completed results. Existing uploads without a run require an explicit retry.

Provider credentials stay in server configuration. The browser receives neither
Agenda records nor internal write tokens and retry bookkeeping.

## Analysis latency

Detection saves the canonical raster and layout before detailed context analysis.
The existing canvas displays saved layouts while its drawing query polls active
processing every second; enrichment does not gate access to detected geometry.
Each completed entity is still saved individually, so progress remains visible
and retries reuse completed checkpoints.

`DRAWING_ENTITY_CONCURRENCY` controls independent entity requests within one stage
(default 6, integer 1–12; restart after changing it). Previously each stage was
fixed at three entities. A stage still finishes its room batch before starting
fixtures; it retains the same prompts, output validation, failure handling and
120-second deadline. The full-sheet entity overview is prepared once per batch
and shared read-only; each entity retains its own original-resolution crop and
canonical geometry. No entity or verification step is omitted for speed.

`DRAWING_OPENAI_CONCURRENCY` bounds aggregate context, entity and calibration
requests across drawings, including door inspection and reference lookup
(default 18, integer 1–64). Waiting requests share their
existing stage abort signal and deadline; aborted waiters do not spend capacity.
This preserves the former maximum of 18 entity requests instead of multiplying
six by 15. Chat requests are independent. Limits are per backend instance;
multiple replicas add capacity. Tune provider quotas and memory independently
from the drawing and entity batch limits.

Server logs emit `Blueprint detection stage` timings (leased detection work,
raster preparation, inference including verification; excluding cover generation)
and `Blueprint analysis stage` timings (misc,
entities or ppm, outcome and attempted/completed entity counts). They contain no
drawing text, images, credentials or raw provider errors. Worker requests also
save private `timings.json` with geometry, OCR, fixture/room verification and
normalization durations, including elapsed time for failed timed stages.
`PIPELINE_GEMINI_WORKERS` independently controls the Python pipeline's concurrent
single-target Decisions requests across all admitted pages (default 8, integer 1–16; set on the pipeline
service). It preserves fixture-before-room verification, original evidence,
acceptance rules and target/deadline budgets; set it to 4 to restore the previous
parallelism. Waiting for shared capacity consumes the existing verification
deadline. It does not batch multiple targets into one model request.

Compare the same page and completed object counts before/after changes. Separate
image preparation measurements from provider and end-to-end latency. Contrast
recovery should remain disabled for a consistent baseline. Shared overview bytes
do not establish improved model accuracy, and concurrency does not weaken checks.
