# MongoDB ownership

## Rules

Use the shared Atlas connection. Better Auth owns its user/account/session/verification collections. Validate application-owned documents at the persistence boundary when introduced. Use database indexes for identity and uniqueness, never only a preflight lookup. Keep persistence criteria separate from HTTP representations.

## Example

[apps/server/src/db/connection.ts](../../apps/server/src/db/connection.ts)

## Review

Check ownership, boundary validation and consistency with the active task. Examples demonstrate the named convention, not every choice in a reference file.
