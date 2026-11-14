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
4. Extract PPM candidates and create their annotations atomically, then resolve PPM
   using this blueprint and the shared conversation. Multiple incompatible scales
   on one sheet yield an unresolved result rather than a fabricated common scale.
5. Mark the blueprint ready only after every entity has a saved result, `misc` was
   assessed, and PPM extraction/resolution completed. Uncertain descriptions and an
   unresolved scale are valid completed results; failed requests are retryable.

Each analysis mutation performs one bounded stage and checkpoints successful
entities separately. Closing the browser pauses further scheduling; reopening or
resuming analysis continues missing work. No background queue is introduced.
Owner checks, operation leases and layout revisions fence checkpoint writes.
Inference and analysis cannot change a layout concurrently.

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
