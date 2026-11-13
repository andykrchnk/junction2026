# Access control

## Rules

Resolve sessions through Better Auth on the server, then resolve the application user from `users` by `betterAuthUserId`. Keep `authUser`, `session` and application `user` distinct in request context. Protected tRPC procedures require both a valid session and an application user, independently of frontend route guards. Scope resource retrieval to the application user ID when adding user-owned resources. Never accept client-supplied identity or privileged fields as authorization.

## Example

[apps/server/src/shared/trpc.ts](../../apps/server/src/shared/trpc.ts)

## Review

Check ownership, boundary validation and consistency with the active task. Examples demonstrate the named convention, not every choice in a reference file.
