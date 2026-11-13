# React

## Rules

Use function components, Readonly props and shadcn/Tailwind primitives. Keep business state in Effector. Effects synchronize external systems such as the router; do not use them for derived values. Preserve labels, keyboard operation, loading, empty and error states.

## Example

[apps/app/src/features/authentication/auth-form.tsx](../../apps/app/src/features/authentication/auth-form.tsx)

## Review

Check ownership, boundary validation and consistency with the active task. Examples demonstrate the named convention, not every choice in a reference file.
