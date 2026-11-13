# Type ownership

## Rules

Shared API schemas and inferred types belong in @repo/types. Implementation-only types stay local. Import AppRouter as a type from @repo/server; never import server runtime into the browser. Keep workflow logic out of the types package.

## Example

[packages/types/src/auth.ts](../../packages/types/src/auth.ts)

## Review

Check ownership, boundary validation and consistency with the active task. Examples demonstrate the named convention, not every choice in a reference file.
