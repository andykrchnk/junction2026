# Junction 2026

Construction drawing intelligence workspace. `apps/app` is the TanStack Start dashboard; `apps/server` is the Bun/Hono API. MongoDB Atlas stores Better Auth users and sessions.

## Agent resources and workflow

Shared workflows live in `.agents/skills`; implementation conventions live in `.agents/patterns`.

1. Read the task and latest decisions, then [the pattern catalog](.agents/patterns/CATALOG.md) and affected patterns. Inspect their examples and callers before adding abstractions.
2. State the scope, request owner and state owner. Follow existing contracts and make the smallest coherent change. Do not introduce speculative services, queues, models or refactors.
3. Keep business state in Effector models and business operations with their feature. Validate untrusted data once at its boundary. Never use `any`, `@ts-ignore`, or assertions to silence type errors.
4. Verify the affected packages, inspect changed UI, and review the complete task diff with [pattern-review](.agents/skills/pattern-review/SKILL.md). Fix in-scope findings and re-review. Report verification limitations honestly.
5. Commit or publish only when authorized. Follow [CONTRIBUTING.md](CONTRIBUTING.md) and use [pr-description](.agents/skills/pr-description/SKILL.md) for PRs.

Keep `.local`, `-local`, environment files, credentials and private datasets out of shared outputs. Add dependencies only for current requirements. Explicit task instructions and executable repository configuration override reference examples.

## Frontend

TanStack Start/Router, React, Tailwind, shadcn/ui, TanStack Form, tRPC and Effector. Follow downward feature-slice dependencies: `routes/pages` → `features` → `entities` → `shared/components/ui`. Models belong in `model.ts`; expose read-only stores with `patronum` and intentional events/effects through `$$domain` APIs.

Declare model events, stores, effects, derived/restored stores, then `sample` wiring and exports. Use `sample` rather than `.on`, `.watch` or `.subscribe`; use `null` for absent entities. Consume models through `useUnit`. Keep presentation components focused and props `Readonly`. Use Zod schemas and infer types instead of duplicating contracts.

Renwio's typed tRPC client and Better Auth client own transport. Effector owns auth orchestration and session state. Do not import LEAF's REST/Farfetched request factory into this tRPC application. TanStack Query may cache server resources; never mirror its lifecycle into a second store without a distinct requirement.

## Server

Hono owns HTTP orchestration. tRPC validates shared input/output contracts and enforces authorization. Better Auth owns credentials and sessions. Use MongoDB Atlas; no database container. Keep environment validation at startup and never expose secrets through client bundles, logs or error responses.

## Verification

Use pnpm (see `packageManager`), Bun for the API runtime. Run `pnpm check-types`, `pnpm lint`, `pnpm format:check`, and `pnpm build`. Narrow checks may run during individual steps. Add meaningful regression tests when behavior warrants them; do not create tests that simply mirror implementation. Never claim unrun checks passed. Record a demo only when requested.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": true` in the root `turbo.json` or `turbo.jsonc` to opt in; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
