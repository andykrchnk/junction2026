# Request ownership

## Rules

Use the typed tRPC client for API requests and the Better Auth client for auth endpoints. Effector effects orchestrate authentication. Reuse request-owned pending/error state. Validate external responses using shared Zod contracts. Do not introduce a competing transport abstraction or store auth credentials in domain models.

## Example

[apps/app/src/shared/trpc.ts](../../apps/app/src/shared/trpc.ts)

## Review

Check ownership, boundary validation and consistency with the active task. Examples demonstrate the named convention, not every choice in a reference file.
