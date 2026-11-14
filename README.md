# Junction 2026

Construction drawing intelligence workspace. The application foundation follows LEAF's engineering workflow and Renwio's TanStack Start, Hono/tRPC and Better Auth patterns.

## Applications

- `apps/app` (`@repo/app`): TanStack Start in SPA mode, Fluid Functionalism components first with shadcn/ui fallback, Tailwind, TanStack Form, typed tRPC and Effector.
- `apps/server` (`@repo/server`): Hono on Bun, tRPC, Mongoose application users and Better Auth email/password identities backed by MongoDB Atlas.
- `packages/types` (`@repo/types`): shared Zod schemas and inferred contracts.
- `.agents`: scoped engineering patterns and review/PR skills. See [AGENTS.md](AGENTS.md).
- `research`: supplied challenge research and dataset inspection.

## Local development

Use Node 24+, pnpm 11.25.0 and Bun 1.2.22. The API Docker image pins Bun to match Renwio's stable runtime.

```sh
pnpm install
cp .env.example .env
cp apps/app/.env.example apps/app/.env
```

Set `MONGODB_URI` to an Atlas connection URI, `MONGODB_DB_NAME` to this project's database, and `BETTER_AUTH_SECRET` to a random value of at least 32 characters. For example, generate a secret with `openssl rand -base64 32`. URL-encode special characters in database credentials. Allow the development/deployment host through Atlas network access. MongoDB is external; no database container is needed.

```sh
pnpm dev
```

The dashboard runs at `http://localhost:3000`; the API at `http://localhost:3001`. `/register` creates an account and signs in, `/login` signs in, and `/` requires a server-validated session and application user. Sign-out revokes the session and clears the frontend identity/cache. Better Auth owns `betterauth-users`, `betterauth-accounts`, `betterauth-sessions` and `betterauth-verifications`. Passwords are handled by Better Auth, not application code.

Application profiles live in a separate `users` collection with independent IDs, a unique `betterAuthUserId` link, email and timestamps. Renwio-style schema/DTO modules are exposed through `db.user`; request context distinguishes identity, session and application user. Signup retains Better Auth's validation and rate limits, creates the application profile before returning success, and compensates by removing the identity if profile creation fails. Startup initializes the application user indexes. Mongoose and Better Auth share the same Atlas client.

`VITE_API_URL` is public and is embedded at build time. Database credentials and the auth secret belong only in the root server `.env` and server deployment variables. Email verification and password-reset email delivery are outside this PoC.

## Blueprint PoC

Create a session at `/`, upload one JPEG/PNG/PDF, review the initial analysis, then chat. The original is stored in Atlas GridFS (`blueprints.files` / `blueprints.chunks`). Application-owned `drawings` documents hold attachment metadata, immutable analysis and up to 100 question/answer turns. Sessions are private to their application user; their URLs can be bookmarked.

Set server-only `OPENAI_API_KEY`. The model is selected in `apps/server/src/shared/config.ts` and shared by analysis and chat. Auth and file upload work without a key; analysis/chat explain the missing configuration. No OpenAI key is bundled into the app, and SDK tracing is disabled for drawing content.

Uploads are limited to 20 MB and PDFs to 10 pages. A new drawing requires a new session. Analysis and chat use synchronous, non-streamed requests with a two-minute model timeout. Database leases expire after 150 seconds: refresh/reopen an interrupted session and retry. No worker, queue, local file storage or database container is required. Files, initial analysis and completed turns survive deployment. An interrupted call may incur another provider call on retry; operation IDs and leases prevent duplicate committed turns and stale writes.

The Agents SDK session is reconstructed from saved MongoDB question/answer turns for every request. Only initial analysis receives the blueprint. Subsequent answers use saved analysis, saved detector predictions and conversation history, identifying evidence by page and descriptive location. Missing facts trigger a structured clarification when the user can supply them. Clarification questions and user replies are saved in the conversation and rehydrated after refresh or redeployment. The assistant may calculate from explicit user-supplied inputs, labels those inputs separately, and keeps the original drawing analysis unchanged. If the task cannot be resolved, it returns cannot_determine rather than inventing an answer. This is a rough visual-analysis prototype, not a reliable quantity takeoff system. The first analysis includes classification, view-specific printed measurement references and selected object boxes. The preview overlays those boxes on images or PDF pages, filters them by kind and shows their evidence and assumptions. Recognition is labelled clear or uncertain, not presented as a probability. Boxes are approximate visual pointers, not room boundaries or scale calibration. Existing saved sessions remain readable without invented metadata. Corrections, file replacement and deletion controls are not implemented. A small analyzer function can later be replaced without changing the chat contract.

## CubiCasa backend integration

Set server-only `INFERENCE_BASE_URL` and `INFERENCE_API_KEY` together. The URL is the public HTTPS base address of Andy’s service; the key must match its ASCII key of at least 32 characters. Neither value is exposed to the browser. `INFERENCE_TIMEOUT_MS` defaults to 120000 and accepts 5000–240000. With neither setting present, detection reports `not_configured` and new OpenAI analyses wait for configuration. Chat remains available for already analyzed sessions.

After upload, the frontend completes and saves NN detection for every page before starting the first OpenAI analysis. The server rejects analysis requests until those page results are ready, so other API callers cannot bypass the order. OpenAI receives the saved candidate context alongside the document and is instructed to verify rather than blindly repeat predictions. NN failure stops the first-analysis pipeline for retry instead of silently omitting context. The authenticated tRPC mutation `drawings.detect({ id, page })` processes one page at a time; the client visits pages sequentially and reopening a session resumes unfinished pages. A completed page is reused without another inference call. Per-drawing inference leases are separate from analysis/chat leases. Failures preserve completed pages and are available in `drawing.detection.error`; retry the mutation or reopen the session. Configure an HTTP proxy timeout longer than the inference timeout.

The backend normalizes image EXIF orientation and rasterizes each PDF page to PNG, respecting page rotation and limiting the longest side to 2400 pixels. It posts multipart field `image` to `/v1/predictions` with `X-API-Key`, uses bounded retries for busy responses, validates the response, and stores each completed page’s canonical PNG in GridFS. Service coordinates already refer to that exact uploaded raster; no model/padding transform is applied a second time.

`drawings.get` returns `detection.status` and `detection.pages`. Each page includes its number, dimensions, coordinate system, raw prediction and `detectedProperties`. Properties contain a room polygon (including holes), icon rectangle/centroid or junction point as GeoJSON-shaped pixel geometry, the original class label, bounding box, pixel area and score meaning. Coordinates use a top-left origin with X right and Y down; areas are pixels², not m². Scores are component-mean softmax values or structural heatmap peaks, not calibrated correctness probabilities.

To draw these geometries, fetch the matching authenticated `GET /api/drawings/:id/predictions/:page/image` and use the saved page width/height. Do not overlay pixel coordinates directly on a differently oriented or sized source image. The existing OpenAI observation overlay is separate; the NN property list is exposed for frontend integration, not silently converted to OpenAI observations. Chat receives detected counts and bounded candidate metadata, attributes them as predictions and reports incomplete page coverage. Full geometries and raw responses remain in MongoDB. Detection context is capped to leave room within MongoDB’s document limit.

## Verification

```sh
pnpm build
pnpm check-types
pnpm lint
pnpm format:check
pnpm check-infra
bun test apps/server/test/drawings.test.ts packages/types/test/analysis.test.ts
```

The project retains the TypeScript 7 compiler as `@typescript/native` and uses the TypeScript 6 compatibility API for ESLint. Generated route types are committed and regenerated by Vite. Live account lifecycle verification requires Atlas credentials. The drawing tests run two offline SDK regression cases by default. To run the Atlas integration cases (OpenAI is mocked), use:

```sh
RUN_DRAWING_TESTS=1 bun --env-file=.env test apps/server/test/drawings.test.ts
```

They create and drop only a uniquely named `junction_poc_test_*` database; the Atlas user must have permission for that database. They cover upload validation/GridFS round trips, ownership, analysis gating, retries, conversation reconstruction and stale-operation fencing. Live OpenAI quality and actual deployment recovery still require a manual end-to-end check.

## Railway

[`.railway/railway.ts`](.railway/railway.ts) declares the app and server services with repository-root Docker builds, health checks and restart policies. It provisions no database or volume. Both services follow `master` after review/merge.

1. Link the intended Railway project/environment and enable generated public domains for both services.
2. Set shared `APP_ORIGIN` to the dashboard origin and `API_URL` to the public API origin, both HTTPS with no trailing slash.
3. Set the server variables `MONGODB_URI`, `MONGODB_DB_NAME`, `BETTER_AUTH_SECRET` and `OPENAI_API_KEY`. `preserve()` retains these Railway-managed secrets; it does not generate them. Model selection lives in the server's source configuration.
4. Run `railway config plan`, review the result, then apply the configuration when deployment is authorized.
5. Verify the API `/health`, registration, login, authenticated refresh and logout. Rebuild the app when changing `API_URL`.

Atlas must allow the server's egress and the database user must have access to the selected database. Use separate secrets and databases per environment. Do not apply IaC to an unrelated existing environment: this file manages the complete two-service environment.
