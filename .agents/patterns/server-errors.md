# Server errors

## Rules

Propagate failures through Hono/tRPC and Better Auth conventions. Narrow unknown errors; preserve causes when adding useful boundary context. Return actionable public failures without credentials, connection URIs, stack traces or sensitive payloads. Do not return success after a failed operation.

## Example

[apps/server/src/app/hono.ts](../../apps/server/src/app/hono.ts)

## Review

Check ownership, boundary validation and consistency with the active task. Examples demonstrate the named convention, not every choice in a reference file.
