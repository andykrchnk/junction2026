# Blueprint context pipeline

A drawing session owns shared messages and `blueprints[]`. Each blueprint is one
PDF page or uploaded image and owns a singular attachment reference (including its
source page number), canonical raster, layout, `misc`, PPM candidates/result,
comments and `status`. PDF pages share their original GridFS file without copying
its bytes. The existing single-upload-per-session behavior is preserved.

The server drawing feature owns processing and persistence. Shared Zod contracts
live in `packages/types/src/blueprint.ts`; the frontend model resumes bounded tRPC
operations and the query cache supplies server state.

## Stages

1. Infer every page and persist canonical geometry, IDs and source predictions.
   Preserve the inference service's degraded OCR/verifier/coverage indicators.
2. Inspect each sheet with OpenAI and save summary, layout limitations and `misc`
   entries (`title`, `content`) for legends, abbreviations, notes and descriptions.
3. Enrich all detected rooms, then fixtures, in batches of at most three requests.
   Each request includes an overview, padded contextual crop, target candidate,
   related candidates and sheet context. Results use the existing entity IDs.
   `enrichment.result.details` stores windows, doors, furniture, related objects
   and markings. Findings carry matched entity IDs or null, precise locations and
   observed/inferred provenance. Door `connectedRoomIds:null` means supported
   outside access; `[]` means unknown. Other values reference other rooms on the
   same blueprint. Significant text, numbers, dimensions, areas, arrows and symbols
   are transcribed with locations. IDs and reference categories are checked before
   persistence.
   The model returns structured findings, not a free-form paragraph. Code renders
   `enrichment.result.description` deterministically from that JSON. The complete
   structured findings remain available even if a long text rendering is bounded.
   Room text is capped at 1000 characters; fixture text at 500, at complete-line
   boundaries. Fixtures describe only themselves and direct relationships; room
   contents belong to the room. Repeated identity, connections and generic missing
   specifications are omitted. Model fields have separate concise output limits.
   Finnish opening notation (for example `I15x12`) may be interpreted as an inferred
   nominal modular size, never a verified frame or construction-opening measurement.
4. Extract PPM candidates and create their annotations atomically, then resolve PPM
   using this blueprint and the shared conversation. Multiple incompatible scales
   on one sheet yield an unresolved result rather than a fabricated common scale.
   Candidate extraction receives sheet notes and object markings plus canonical
   detail crops. Length candidates retain canonical endpoints, real length, and
   whether units are explicit, convention-based or user-provided. Server arithmetic
   computes PPM; independent compatible references support the final estimate.
   Convention-based dimensions remain labelled inferred, requiring confirmation.
   Every localized clue creates a yellow annotation, including unresolved clues.
   Its text uses a concise clue summary plus one calculation and unit basis;
   supporting evidence remains on the candidate rather than being repeated in
   the popover. Summaries retain the label, interpretation and consequential
   uncertainty, including nominal-versus-frame/opening size distinctions.
   Enriching entities invalidates previous calibration and generated PPM annotations
   while preserving user comments. `drawings.analyze({id,retryPpm:true})` explicitly
   retries calibration without repeating completed entity descriptions.
5. Mark the blueprint ready only after every entity has a saved result, `misc` was
   assessed, and PPM extraction/resolution completed. Uncertain descriptions and an
   unresolved scale are valid completed results; failed requests are retryable.

Each page job performs one bounded stage per invocation and checkpoints successful
entities separately. Only the current batch is marked `enrichment.type:processing`
before its requests start; queued objects stay pending. Each success is immediately
checkpointed. One-second query polling refreshes the canvas and selected-object
card while processing: a fixed-size, non-interactive indicator appears at each
active object's centre, and disappears independently when it finishes. Closing
the browser does not pause scheduling: Agenda runs each blueprint page independently,
including pages within the same session, under the existing worker concurrency limit.
Owner checks, page-specific leases and layout revisions fence checkpoint writes.
Inference and analysis cannot change the same page's layout concurrently. Expired leases expose
interrupted entity work as retryable failures instead of leaving a permanent
spinner. Existing generic enrichment results remain readable (`details:null`)
and are upgraded on the next analysis flow; earlier prompt versions are upgraded
too. Only complete detailed results from the current prompt version are reused.
Processing/failure checkpoints retain `previousResult` so an upgrade failure does
not erase an existing description. No schema migration is needed for these additive
fields; the earlier blueprint-context migration is still required for pre-blueprint
records.

The original inference output remains provenance. Agent interpretations never
replace geometry or source measurements. Attributes distinguish visible evidence
from inference; descriptions carry evidence and uncertainties. Scores are not
calibrated correctness probabilities. Coverage concerns detected candidates, not a
guarantee that every physical object was detected.

## Questions and answers

The answer agent reads saved sheet context, paginated entities/comments and entity
relationships through owner-scoped, in-memory tools. Polygon areas are computed in
code; physical areas use saved PPM and remain estimates requiring applicable view
calibration. Answer references are validated and can select canvas objects. This
removes the previous first-200-objects cutoff without sending raster bytes to chat.

## Existing records

The application accepts only the blueprint schema. There is no schema version,
legacy context, automatic conversion, or fallback analysis/chat path. Drawing DTOs
and persistence helpers live in `apps/server/src/db/drawing.schema.ts`.

An explicit offline migration lives entirely under `db/migrations`:

```sh
bun --env-file=.env apps/server/src/db/migrations/blueprint-context.ts
bun --env-file=.env apps/server/src/db/migrations/blueprint-context.ts --apply
```

The default command validates and reports counts without writes. Apply uses
compare-and-set guards and rejects active operations. It converts page layouts and
comments, removes obsolete top-level fields, and requires fresh entity enrichment.
Unlinked old analysis is discarded. Only single-page calibration is carried over;
ambiguous document-wide PPM is discarded. Run this explicitly before opening old
records, or start new sessions. Application requests never run the migration.
