# Durable document processing

PDF upload stores an embedded `processingJob` on the drawing in the same MongoDB
update that attaches its blueprint pages. There is no gap between a successful
attachment write and queuing the work. GridFS uploads are preserved when a failed
write acknowledgement leaves attachment ownership uncertain.

The API process starts a polling worker after initializing MongoDB models/indexes.
No browser session or open tab is required. `DRAWING_PROCESSING_CONCURRENCY` sets
the number of concurrent worker slots per backend instance (default 3, integer
1–32; restart the backend after changing it). Each slot claims one bounded stage
at a time with an atomic `findOneAndUpdate`, a random lease token, a 60-second
lease and a 15-second renewal. Multiple API replicas may poll; only one owns a
particular document at a time, so pages within a document remain sequential.
With multiple replicas the total limit is the sum of their configured slots.
This limits document stages, not downstream requests within each stage; inference
service capacity may still serialize GPU work or return backpressure. Shutdown
aborts and awaits every slot. The claim index covers status, availability and
expiry. Inference backpressure (503) defers work without using the failure budget.

Each document has a persisted page cursor. Inference runs before analysis for that
page. Analysis resumes existing misc/entity/scale checkpoints. Rejected pages
advance immediately. Other stage failures get up to three attempts with backoff,
then the cursor advances and retains the page error. Missing provider configuration
leaves explicit partial/not-configured status and continues. Finishing a job means
all selected pages were attempted, not that every page succeeded.

On a crash, another process reclaims the expired job and clears obsolete stage
leases. Every inference/analysis checkpoint write is fenced by the document job
token as well as the existing stage token. A replaced worker cannot overwrite the
new owner's results. Graceful shutdown aborts active provider work and leaves the
claim available for expiry recovery. Calls are at-least-once: an external provider
request can repeat if the process dies before its result is saved. Saved inference
and completed entity checkpoints are reused.

The frontend polls existing drawing queries and renders `processing` progress and
per-page statuses. Upload and page-open no longer trigger inference/analysis loops.
`drawings.analyze` queues incomplete pages; the compatible `drawings.detect` mutation
queues a selected page. Both return promptly and enforce resource ownership.
Retrying an active document does not replace its job. Explicit retries may retry
previously rejected pages; they never erase completed results. Existing uploaded
sessions without a job can be resumed through this retry action.

No extra database or broker is needed. Jobs use the same configured Atlas database
as drawings. Provider credentials remain in server environment configuration. The
browser sees progress only, not internal lease tokens or job retry bookkeeping.
