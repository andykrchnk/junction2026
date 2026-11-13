# Effector models

## Rules

Use createEvent, createStore, createEffect, restore and sample. Declare events, stores, effects, derived stores, wiring, exports. Export stores with patronum readonly. Use useUnit in components. Do not use store/event .on, .watch or .subscribe. Each operation owns its pending and error state.

## Example

[apps/app/src/entities/user/model.ts](../../apps/app/src/entities/user/model.ts)

## Review

Check ownership, boundary validation and consistency with the active task. Examples demonstrate the named convention, not every choice in a reference file.
