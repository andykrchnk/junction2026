# MongoDB ownership

## Rules

Use the shared Mongoose Atlas connection and its native client for Better Auth. Keep `mongodb` compatible with Mongoose's driver version; do not cast across mismatched driver types. Follow Renwio's `db/<entity>.schema.ts`, model, validated DTO and `db.<entity>` exports. Better Auth owns only identity, credentials and sessions in `betterauth-*`; the application owns `users`, linked by a unique `betterAuthUserId`. Use the application user ID for resource ownership.

Resolve the application user from the verified server identity, never by client-supplied IDs or email alone. Keep signup orchestration responsible for application-user creation and identity cleanup on failure. Validate database records at the DTO boundary. Use database indexes for uniqueness, never only a preflight lookup. Keep persistence criteria separate from HTTP representations.

## Example

- [Shared connection](../../apps/server/src/db/connection.ts)
- [User schema and DTO](../../apps/server/src/db/user.schema.ts)
- [Database API](../../apps/server/src/db/index.ts)

## Review

Check ownership, boundary validation and consistency with the active task. Examples demonstrate the named convention, not every choice in a reference file.
