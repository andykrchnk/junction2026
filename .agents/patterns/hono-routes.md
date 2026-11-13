# Hono and tRPC routes

## Rules

HTTP routes own transport, authentication and response mapping. tRPC input/output uses shared schemas. Delegate business operations only where a real domain owner exists; avoid pass-through services. Keep auth public routes separate from protected procedures.

## Example

[apps/server/src/app/hono.ts](../../apps/server/src/app/hono.ts)

## Review

Check ownership, boundary validation and consistency with the active task. Examples demonstrate the named convention, not every choice in a reference file.
