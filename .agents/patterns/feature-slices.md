# Feature-slice boundaries

## Rules

Import downward from routes/pages through features, entities, then shared/UI. State stays in its owning model.ts. Do not move one-use logic into shared just to bypass a boundary.

## Example

[apps/app/src/entities/user/model.ts](../../apps/app/src/entities/user/model.ts)

## Review

Check ownership, boundary validation and consistency with the active task. Examples demonstrate the named convention, not every choice in a reference file.
