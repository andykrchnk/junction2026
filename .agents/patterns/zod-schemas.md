# Zod schemas

## Rules

Use NameZod naming and z.infer. Compose the schema that owns a concept. Validate inputs and environment variables at the boundary; narrow unknown values. Do not duplicate handwritten input/output types. Schema strictness must match the actual boundary.

## Example

[packages/types/src/auth.ts](../../packages/types/src/auth.ts)

## Review

Check ownership, boundary validation and consistency with the active task. Examples demonstrate the named convention, not every choice in a reference file.
