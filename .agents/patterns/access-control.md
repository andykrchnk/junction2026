# Access control

## Rules

Resolve sessions through Better Auth on the server. Protected tRPC procedures reject unauthenticated requests independently of frontend route guards. Scope resource retrieval to the authorized user when adding user-owned resources. Never accept client-supplied identity or privileged fields as authorization.

## Example

[apps/server/src/shared/trpc.ts](../../apps/server/src/shared/trpc.ts)

## Review

Check ownership, boundary validation and consistency with the active task. Examples demonstrate the named convention, not every choice in a reference file.
