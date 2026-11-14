# Durable document processing

PDF/image upload stores `processingJob` progress on the drawing in the same
MongoDB update that attaches its pages. This is also the durable queue handoff:
an Agenda reconciliation job scans pending runs every two seconds and creates
an Agenda job for each run. A crash after upload but before enqueueing cannot lose
work. GridFS uploads are preserved when a failed write acknowledgement leaves
attachment ownership uncertain.

Agenda 6.2.8 with `@agendajs/mongo-backend` 4.0.5 uses the existing Atlas connection
and the `drawingJobs` collection. No Redis, separate database or open browser is
required. Agenda owns polling, locks, concurrency and job scheduling. A unique
index on the run ID prevents duplicate jobs across backend replicas; insert-only
reconciliation never overwrites an active job. Explicit retries create a new run
ID, so an older job cannot process the replacement run.

`DRAWING_PROCESSING_CONCURRENCY` sets the drawing concurrency per backend instance
(default 3, integer 1–32; restart after changing it). Agenda reserves one additional
slot for reconciliation. Each drawing job executes one bounded stage at a time;
pages within a drawing remain sequential. Multiple replicas add their configured
capacity. The limit applies to document stages, not individual downstream calls:
entity enrichment can run multiple requests within a stage, and the GPU service
may serialize inference or return backpressure.

Progress, page cursor and saved inference/entity checkpoints remain on the drawing.
Rejected pages advance immediately. Other stage failures get up to three attempts
with backoff before advancing and retaining the error. Inference backpressure
(503) reschedules for 30 seconds later without spending the failure budget.
Missing provider configuration leaves explicit partial/not-configured status and
continues. Finishing means all selected pages were attempted, not all succeeded.

Agenda persists a recurring next run before executing each stage, and the handler
reschedules it from the saved checkpoint. Completed or superseded jobs are disabled
and retained in `drawingJobs`. A crash resumes after Agenda's ten-minute lock expires;
this exceeds the existing 120s/240s provider deadlines and allows raster/storage
work. Each invocation replaces the drawing's write token, fencing late results
from a replaced worker. Graceful shutdown aborts active provider work and drains
Agenda before closing the shared connection. External calls remain at-least-once:
a crash before saving a result can repeat a call. Saved inference and completed
entity checkpoints are reused.

The frontend polls drawing queries and renders public `processing` progress and
per-page statuses. Upload and page-open do not trigger processing loops.
`drawings.analyze` queues incomplete pages; `drawings.detect` queues a selected
page. Both return promptly and enforce ownership. Retrying an active drawing does
not replace its run. Explicit retries may retry rejected pages without erasing
completed results. Existing uploads without a run require an explicit retry.

Provider credentials stay in server configuration. The browser receives neither
Agenda records nor internal write tokens and retry bookkeeping.
