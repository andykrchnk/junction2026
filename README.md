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

Set server-only `OPENAI_API_KEY`. The model is selected in `apps/server/src/shared/config.ts` (`gpt-4.1-mini`) and shared by analysis and chat. Auth and file upload work without a key; analysis/chat explain the missing configuration. No OpenAI key is bundled into the app, and SDK tracing is disabled for drawing content.

Uploads are limited to 20 MB and PDFs to 10 pages. A new drawing requires a new session. Analysis and chat use synchronous, non-streamed requests with a two-minute model timeout. Database leases expire after 150 seconds: refresh/reopen an interrupted session and retry. No worker, queue, local file storage or database container is required. Files, initial analysis and completed turns survive deployment. An interrupted call may incur another provider call on retry; operation IDs and leases prevent duplicate committed turns and stale writes.

The Agents SDK session is reconstructed from saved MongoDB question/answer turns for every request. Only initial analysis receives the blueprint. Subsequent answers use only saved analysis and history, identifying evidence by page and descriptive location. Missing facts trigger a structured clarification when the user can supply them. Clarification questions and user replies are saved in the conversation and rehydrated after refresh or redeployment. The assistant may calculate from explicit user-supplied inputs, labels those inputs separately, and keeps the original drawing analysis unchanged. If the task cannot be resolved, it returns cannot_determine rather than inventing an answer. This is a rough visual-analysis prototype, not a reliable quantity takeoff system. The first analysis includes classification, view-specific printed measurement references and selected object boxes. The preview overlays those boxes on images or PDF pages, filters them by kind and shows their evidence and assumptions. Recognition is labelled clear or uncertain, not presented as a probability. Boxes are approximate visual pointers, not room boundaries or scale calibration. Existing saved sessions remain readable without invented metadata. Corrections, file replacement and deletion controls are not implemented. A small analyzer function can later be replaced without changing the chat contract.

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
